import type {
  AbsoluteDynamicMarking,
  DynamicMarking,
  DynamicMarkingValue,
  MeasureData,
  NoteEvent,
  RelativeDynamicMarking
} from '../types/storage';
import { getPrimaryVoiceEvents } from './voiceMeasureUtils';
import { ENGRAVING_TEXT_UNITS, spToUnits } from './engravingDefaults';

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

/**
 * 絶対強弱の SMuFL グリフ（Bravura で描く合字。Issue #380）。
 * 市販譜の強弱は専用グリフ（太いイタリック体）で、通常フォントの "pp" とは字形が違う。
 * 音符・臨時記号は既に VexFlow 5 同梱の Bravura（SMuFL）なので、強弱も同じフォントで揃える。
 * cresc./dim. などの文字系表記は SMuFL に対応グリフが無いため対象外（テキストのまま）。
 * コードポイントは SMuFL 仕様の Dynamics 範囲（U+E520〜）。
 */
const DYNAMIC_GLYPHS: Record<AbsoluteDynamicMarking, string> = {
  pp: '\uE52B', // dynamicPP
  p: '\uE520',  // dynamicPiano
  mp: '\uE52C', // dynamicMP
  mf: '\uE52D', // dynamicMF
  f: '\uE522',  // dynamicForte
  ff: '\uE52F', // dynamicFF
};

/** SMuFL グリフで描ける強弱ならそのグリフ文字を、文字系（cresc/dim）なら null を返す */
export function dynamicGlyphFor(marking: DynamicMarking): string | null {
  return marking.value === 'cresc' || marking.value === 'dim' ? null : DYNAMIC_GLYPHS[marking.value];
}

/**
 * グリフの字面幅（単位 sp・標準倍率時）。衝突回避（#373）の文字箱概算に使う。
 * Bravura 公式メタデータ（glyphBBoxes）の実幅に 5〜10% の安全側マージンを乗せた
 * 保守的な包絡値（過小評価すると隣接音符の符幹・加線とグリフ端の重なりを見逃す。
 * 過大評価側の実害は「わずかに早めに避ける」だけ）。
 */
const DYNAMIC_GLYPH_WIDTH_SP: Record<AbsoluteDynamicMarking, number> = {
  p: 1.9,
  pp: 3.4,
  mp: 3.0,
  mf: 3.4,
  f: 2.2,
  ff: 3.3,
};

/**
 * 衝突回避（#373）用の、この強弱エントリの文字箱幅（SVG論理単位）。
 * 絶対強弱は Bravura グリフの実幅（DYNAMIC_GLYPH_WIDTH_SP）、cresc/dim は
 * 文字数ベースの概算。複数記号の併記は最も幅の広いものを使う。
 * 旧・文字数のみの概算はグリフ実幅（例: pp 約3.2sp）を過小評価し、
 * 隣接音符とグリフ端だけが重なるケースを見逃していた（#380 Codex round2 P2）。
 */
export function estimateDynamicMarkingsWidthUnits(markings: DynamicMarking[], scale: number): number {
  const letterFontSize = ENGRAVING_TEXT_UNITS.dynamics * scale;
  return markings.reduce((best, marking) => {
    const glyphWidthSp = dynamicGlyphWidthSp(marking);
    const width = glyphWidthSp != null
      ? spToUnits(glyphWidthSp) * scale
      : formatDynamicMarking(marking).length * letterFontSize * 0.62;
    return Math.max(best, width);
  }, 0);
}

/** グリフの字面幅（sp）。文字系（cresc/dim）は null（文字数ベースの概算に委ねる） */
export function dynamicGlyphWidthSp(marking: DynamicMarking): number | null {
  return marking.value === 'cresc' || marking.value === 'dim' ? null : DYNAMIC_GLYPH_WIDTH_SP[marking.value];
}

/**
 * グリフの字面の縦範囲（単位 sp・ベースライン基準・標準倍率時）。クリック判定の
 * クランプに使う。Bravura 公式メタデータでは f 系のアセンダが約 1.78sp・
 * p 系のディセンダが約 0.9sp と**非対称**なので、上下別の包絡値を持つ
 * （対称 ±1.4sp だと f/mf/ff の上端が判定からはみ出す）。
 */
export const DYNAMIC_GLYPH_ASCENT_SP = 1.8;
export const DYNAMIC_GLYPH_DESCENT_SP = 1.0;

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
    // 主声部の読みは正規アクセサ（#244 段5-3）。再生列挙（ScorePlayer）と同じ並び・件数で
    // 読まないと、鏡が古い異常データで別音符へ強弱が割り当てられてしまう
    getPrimaryVoiceEvents(measure).map((event, eventIndex) => ({ measureIndex, eventIndex, event }))
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

    // 松葉（ヘアピン）もテキストの cresc. / dim. と同じ扱いで
    // 「次の絶対強弱（なければ ±0.2）まで段階的に変化」させる。
    // 終了音符位置での打ち切りはしない簡易仕様（テキスト表記との挙動統一を優先）。
    const relative = getRelativeDynamicFromEvent(entry.event) ?? entry.event.hairpins?.[0]?.type ?? null;
    if (relative) {
      relativePlan = createRelativePlan(flattenedEvents, flatIndex, currentVelocity, relative);
    }
  });

  return velocities;
}
