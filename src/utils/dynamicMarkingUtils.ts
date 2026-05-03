import type {
  AbsoluteDynamicMarking,
  DynamicMarking,
  DynamicMarkingValue,
  MeasureData,
  NoteEvent,
  RelativeDynamicMarking
} from '../types/storage';

export const ABSOLUTE_DYNAMIC_VALUES: AbsoluteDynamicMarking[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
export const RELATIVE_DYNAMIC_VALUES: RelativeDynamicMarking[] = ['cresc', 'dim'];

const ABSOLUTE_DYNAMIC_SET = new Set<string>(ABSOLUTE_DYNAMIC_VALUES);
const RELATIVE_DYNAMIC_SET = new Set<string>(RELATIVE_DYNAMIC_VALUES);
const DEFAULT_DYNAMIC_VELOCITY = 0.5;
const RELATIVE_DYNAMIC_DELTA = 0.2;

const ABSOLUTE_DYNAMIC_VELOCITY_MAP: Record<AbsoluteDynamicMarking, number> = {
  pp: 0.22,
  p: 0.34,
  mp: 0.46,
  mf: 0.58,
  f: 0.74,
  ff: 0.9,
};

type RelativePlan = {
  startFlatIndex: number;
  step: number;
  remainingSoundingEvents: number;
};

function clampVelocity(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function buildDynamicEventKey(measureIndex: number, eventIndex: number): string {
  return `${measureIndex}-${eventIndex}`;
}

export function isAbsoluteDynamicMarkingValue(value: unknown): value is AbsoluteDynamicMarking {
  return typeof value === 'string' && ABSOLUTE_DYNAMIC_SET.has(value);
}

export function isRelativeDynamicMarkingValue(value: unknown): value is RelativeDynamicMarking {
  return typeof value === 'string' && RELATIVE_DYNAMIC_SET.has(value);
}

export function isDynamicMarkingValue(value: unknown): value is DynamicMarkingValue {
  return isAbsoluteDynamicMarkingValue(value) || isRelativeDynamicMarkingValue(value);
}

export function isAbsoluteDynamicMarking(marking: DynamicMarking): boolean {
  return isAbsoluteDynamicMarkingValue(marking.value);
}

export function isRelativeDynamicMarking(marking: DynamicMarking): boolean {
  return isRelativeDynamicMarkingValue(marking.value);
}

export function formatDynamicMarking(marking: DynamicMarking): string {
  return marking.value === 'cresc' ? 'cresc.' : marking.value === 'dim' ? 'dim.' : marking.value;
}

export function getAbsoluteDynamicVelocity(value: AbsoluteDynamicMarking): number {
  return ABSOLUTE_DYNAMIC_VELOCITY_MAP[value];
}

export function getAbsoluteDynamicFromEvent(event: NoteEvent): AbsoluteDynamicMarking | null {
  const marking = event.dynamics?.find(
    (candidate): candidate is DynamicMarking & { value: AbsoluteDynamicMarking } => isAbsoluteDynamicMarking(candidate)
  );
  return marking ? marking.value : null;
}

export function getRelativeDynamicFromEvent(event: NoteEvent): RelativeDynamicMarking | null {
  const marking = event.dynamics?.find(
    (candidate): candidate is DynamicMarking & { value: RelativeDynamicMarking } => isRelativeDynamicMarking(candidate)
  );
  return marking ? marking.value : null;
}

export function getPreviewVelocityForEvent(event: NoteEvent): number {
  const absolute = getAbsoluteDynamicFromEvent(event);
  return absolute ? getAbsoluteDynamicVelocity(absolute) : DEFAULT_DYNAMIC_VELOCITY;
}

export function applyDynamicMarkingToEvent(event: NoteEvent, value: DynamicMarkingValue): NoteEvent {
  if (event.isRest) {
    return event;
  }

  const nextIsAbsolute = isAbsoluteDynamicMarkingValue(value);
  const currentDynamics = event.dynamics ?? [];
  const kept = currentDynamics.filter((marking) => (
    nextIsAbsolute ? !isAbsoluteDynamicMarking(marking) : !isRelativeDynamicMarking(marking)
  ));
  const sameMarkingExists = currentDynamics.some((marking) => marking.value === value);

  if (sameMarkingExists) {
    return kept.length > 0 ? { ...event, dynamics: kept } : { ...event, dynamics: undefined };
  }

  const nextDynamics = nextIsAbsolute
    ? [{ value }, ...kept]
    : [...kept, { value }];
  return { ...event, dynamics: nextDynamics };
}

function isSoundingEvent(event: NoteEvent): boolean {
  return !event.isRest && Array.isArray(event.keys) && event.keys.length > 0;
}

function createRelativePlan(
  flattenedEvents: Array<{ event: NoteEvent }>,
  startFlatIndex: number,
  currentVelocity: number,
  relative: RelativeDynamicMarking
): RelativePlan | null {
  let nextAbsoluteFlatIndex: number | null = null;
  let targetVelocity: number | null = null;

  for (let index = startFlatIndex + 1; index < flattenedEvents.length; index++) {
    const absolute = getAbsoluteDynamicFromEvent(flattenedEvents[index].event);
    if (!absolute) {
      continue;
    }
    nextAbsoluteFlatIndex = index;
    targetVelocity = getAbsoluteDynamicVelocity(absolute);
    break;
  }

  const futureSoundingIndices: number[] = [];
  for (let index = startFlatIndex + 1; index < flattenedEvents.length; index++) {
    if (nextAbsoluteFlatIndex !== null && index >= nextAbsoluteFlatIndex) {
      break;
    }
    if (isSoundingEvent(flattenedEvents[index].event)) {
      futureSoundingIndices.push(index);
    }
  }

  if (futureSoundingIndices.length === 0) {
    return null;
  }

  const fallbackTarget = clampVelocity(
    currentVelocity + (relative === 'cresc' ? RELATIVE_DYNAMIC_DELTA : -RELATIVE_DYNAMIC_DELTA)
  );
  const effectiveTarget = targetVelocity ?? fallbackTarget;
  const denominator = targetVelocity === null
    ? futureSoundingIndices.length
    : futureSoundingIndices.length + 1;

  return {
    startFlatIndex,
    step: (effectiveTarget - currentVelocity) / Math.max(1, denominator),
    remainingSoundingEvents: futureSoundingIndices.length,
  };
}

/**
 * 譜面上の強弱記号を、各音符のベロシティへ変換する。
 * 絶対強弱（p, mf など）は固定値、
 * 変化強弱（cresc., dim.）は次の絶対強弱まで段階的に増減させる。
 */
export function resolveDynamicVelocities(measures: MeasureData[]): Map<string, number> {
  const flattenedEvents = measures.flatMap((measure, measureIndex) =>
    measure.events.map((event, eventIndex) => ({ measureIndex, eventIndex, event }))
  );

  const velocities = new Map<string, number>();
  let currentVelocity = DEFAULT_DYNAMIC_VELOCITY;
  let relativePlan: RelativePlan | null = null;

  flattenedEvents.forEach((entry, flatIndex) => {
    const absolute = getAbsoluteDynamicFromEvent(entry.event);

    if (absolute) {
      // 絶対強弱は「今ここからの基準音量」を即座に更新する。
      currentVelocity = getAbsoluteDynamicVelocity(absolute);
      relativePlan = null;
    } else if (relativePlan && relativePlan.startFlatIndex !== flatIndex && isSoundingEvent(entry.event)) {
      // cresc. / dim. の途中では、次の音符ごとに少しずつベロシティを動かす。
      currentVelocity = clampVelocity(currentVelocity + relativePlan.step);
      relativePlan.remainingSoundingEvents -= 1;
      if (relativePlan.remainingSoundingEvents <= 0) {
        relativePlan = null;
      }
    }

    if (isSoundingEvent(entry.event)) {
      velocities.set(buildDynamicEventKey(entry.measureIndex, entry.eventIndex), currentVelocity);
    }

    const relative = getRelativeDynamicFromEvent(entry.event);
    if (relative) {
      relativePlan = createRelativePlan(flattenedEvents, flatIndex, currentVelocity, relative);
    }
  });

  return velocities;
}
