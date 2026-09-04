import type {
  AbsoluteDynamicMarking,
  DynamicMarking,
  DynamicMarkingValue,
  MeasureData,
  NoteEvent,
  RelativeDynamicMarking
} from '../types/storage';
import { getEventDurationBeats, getMeasureVoices, getPrimaryVoiceEvents } from './voiceMeasureUtils';
import { dynamicSymbol } from './editorContextLabels';
import { ENGRAVING_TEXT_UNITS, spToUnits } from './engravingDefaults';

export const ABSOLUTE_DYNAMIC_VALUES: AbsoluteDynamicMarking[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
export const RELATIVE_DYNAMIC_VALUES: RelativeDynamicMarking[] = ['cresc', 'dim', 'descresc'];

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
  // 表記の正本は editorContextLabels（パレットのボタン・文脈バーと同じ言葉）。
  // ここでコピーして書き直すと、片方だけ直して表記がずれる事故になる。
  return dynamicSymbol(marking.value);
}

/**
 * 絶対強弱の SMuFL グリフ計測値（Issue #380）。
 * 市販譜の強弱は専用グリフ（太いイタリック体）で、通常フォントの "pp" とは字形が違う。
 * 音符・臨時記号は既に VexFlow 5 同梱の Bravura（SMuFL）なので、強弱も同じフォントで揃える。
 * cresc./dim. などの文字系表記は SMuFL に対応グリフが無いため対象外（テキストのまま）。
 *
 * 値はすべて **Bravura 公式メタデータ（redist/Bravura.json）の実測値**（単位 sp・y は上向き正）:
 * - codepoint: SMuFL 仕様の Dynamics 範囲（U+E520〜）
 * - opticalCenterSp: 光学中心の x（glyphsWithAnchors.opticalCenter）。text-anchor="middle" は
 *   文字送り（advance）中央で揃えてしまい、f では光学中心と約0.53sp ずれるため、
 *   描画はこの値で音符中心へ合わせる
 * - leftSp/rightSp: 字面の横範囲（glyphBBoxes。イタリック体のため左右にオーバーハングがある）
 * - topSp/bottomSp: 字面の縦範囲（ベースライン基準。f 系は上に高く p 系は下に深い非対称）
 */
export interface DynamicGlyphMetrics {
  codepoint: string;
  opticalCenterSp: number;
  leftSp: number;
  rightSp: number;
  topSp: number;
  bottomSp: number;
}

const DYNAMIC_GLYPH_METRICS: Record<AbsoluteDynamicMarking, DynamicGlyphMetrics> = {
  p:  { codepoint: '\uE520', opticalCenterSp: 1.22,  leftSp: -0.356, rightSp: 1.464, topSp: 1.096, bottomSp: -0.568 }, // dynamicPiano
  pp: { codepoint: '\uE52B', opticalCenterSp: 1.708, leftSp: -0.328, rightSp: 2.912, topSp: 1.096, bottomSp: -0.568 }, // dynamicPP
  mp: { codepoint: '\uE52C', opticalCenterSp: 1.848, leftSp: -0.08,  rightSp: 3.3,   topSp: 1.096, bottomSp: -0.568 }, // dynamicMP
  mf: { codepoint: '\uE52D', opticalCenterSp: 1.796, leftSp: -0.08,  rightSp: 3.272, topSp: 1.724, bottomSp: -0.66 },  // dynamicMF
  f:  { codepoint: '\uE522', opticalCenterSp: 1.256, leftSp: -0.564, rightSp: 1.456, topSp: 1.776, bottomSp: -0.608 }, // dynamicForte
  ff: { codepoint: '\uE52F', opticalCenterSp: 1.852, leftSp: -0.54,  rightSp: 2.44,  topSp: 1.776, bottomSp: -0.608 }, // dynamicFF
};

/** グリフ計測値。文字系（cresc/dim/descresc）は null */
export function dynamicGlyphMetricsFor(marking: DynamicMarking): DynamicGlyphMetrics | null {
  return isRelativeDynamicMarkingValue(marking.value) ? null : DYNAMIC_GLYPH_METRICS[marking.value];
}

/** SMuFL グリフで描ける強弱ならそのグリフ文字を、文字系（cresc/dim/descresc）なら null を返す */
export function dynamicGlyphFor(marking: DynamicMarking): string | null {
  return dynamicGlyphMetricsFor(marking)?.codepoint ?? null;
}

/**
 * 同一音符の複数記号の描画順（絶対強弱を先・変化強弱の文字表記を後）。
 * 描画と衝突概算が同じ行割りを共有するためにここへ一本化する。
 */
export function orderedDynamicMarkings(markings: DynamicMarking[]): DynamicMarking[] {
  return [...markings].sort((left, right) => {
    const leftPriority = isRelativeDynamicMarkingValue(left.value) ? 1 : 0;
    const rightPriority = isRelativeDynamicMarkingValue(right.value) ? 1 : 0;
    return leftPriority - rightPriority;
  });
}

/**
 * 衝突回避（#373）用の、この強弱エントリ全体（複数記号の行を含む）の文字箱。
 * 絶対強弱は Bravura 公式メタデータの字面（左右オーバーハング・非対称な上下・
 * 光学中心の描画位置補正込み）、cresc/dim は文字数ベースの概算。
 * 旧・文字数のみの概算はグリフの実字面（例: pp 幅3.24sp・f 上1.776sp）を
 * 過小評価し、隣接音符との端の重なりを見逃していた（#380 Codex round2-3 P2）。
 *
 * 行割り（絶対強弱→cresc/dim の順・14px 間隔）は描画側と orderedDynamicMarkings を
 * 共有しており、各行の箱の合併を返す。
 */
export function estimateDynamicMarkingsCollisionRect(
  markings: DynamicMarking[],
  scale: number,
  anchorX: number,
  baselineY: number,
): { x: number; y: number; w: number; h: number } {
  const u = (sp: number) => spToUnits(sp) * scale;
  const letterFontSize = ENGRAVING_TEXT_UNITS.expressiveText * scale;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  orderedDynamicMarkings(markings).forEach((marking, row) => {
    const rowBase = baselineY + row * 14;
    const metrics = dynamicGlyphMetricsFor(marking);
    if (metrics) {
      // 描画と同じく光学中心を anchorX に合わせた原点から字面範囲を取る
      const originX = anchorX - u(metrics.opticalCenterSp);
      minX = Math.min(minX, originX + u(metrics.leftSp));
      maxX = Math.max(maxX, originX + u(metrics.rightSp));
      minY = Math.min(minY, rowBase - u(metrics.topSp));
      maxY = Math.max(maxY, rowBase - u(metrics.bottomSp));
    } else {
      const w = Math.max(letterFontSize * 0.62, formatDynamicMarking(marking).length * letterFontSize * 0.62);
      minX = Math.min(minX, anchorX - w / 2);
      maxX = Math.max(maxX, anchorX + w / 2);
      minY = Math.min(minY, rowBase - letterFontSize * 0.55);
      maxY = Math.max(maxY, rowBase + letterFontSize * 0.2);
    }
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

/**
 * 任意の拍位置の「いまの基準音量」を返す時系列（Issue #626）。
 *
 * 大譜表（ピアノ）では強弱記号は両手に共通の「その時点の音量」なので、片手に付いた p が
 * 他方の伴奏に効かない従来の解決（パート単位・主声部の音ごと）では、伴奏が旋律より大きく
 * 鳴っていた（運用者QA 2026-09-04・悲愴）。ここでは全パート・全声部の記号を絶対拍位置で
 * 1本の時系列にし、どのパート・どの声部の音も**自分の拍位置**で引く。
 *   - 絶対強弱（p / f …）はその位置から基準音量を切り替える
 *   - cresc. / dim.（文字・松葉）はその位置から**次の絶対強弱の位置**まで直線で変化する。
 *     次が無ければ ±0.2 を終端（最後の記号から先の残り）までかけて変化する
 * 四重奏・編成譜は各パートに自分の強弱が書かれるので、呼び出し側でパートごとに作る。
 * 従来の resolveDynamicVelocities（音ごとの段階変化）はプレビュー等の既存用途に残す。
 */
export interface DynamicVelocityTimeline {
  velocityAt(absoluteBeat: number): number;
  /** 計測・テスト用: 記号の数 */
  readonly markingCount: number;
}

export function buildDynamicVelocityTimeline(
  partsMeasures: readonly (readonly MeasureData[])[],
  beatsPerMeasure: number,
): DynamicVelocityTimeline {
  type Marking = { at: number; order: number; absolute: AbsoluteDynamicMarking | null; relative: RelativeDynamicMarking | null };
  const markings: Marking[] = [];
  let endBeat = 0;
  partsMeasures.forEach((measures) => {
    endBeat = Math.max(endBeat, measures.length * beatsPerMeasure);
    measures.forEach((measure, measureIndex) => {
      getMeasureVoices(measure).forEach((voice) => {
        let beat = 0;
        voice.events.forEach((event) => {
          const absolute = getAbsoluteDynamicFromEvent(event);
          const relative = getRelativeDynamicFromEvent(event) ?? event.hairpins?.[0]?.type ?? null;
          if (absolute || relative) {
            markings.push({ at: measureIndex * beatsPerMeasure + beat, order: markings.length, absolute, relative });
          }
          beat += getEventDurationBeats(event);
        });
      });
    });
  });
  markings.sort((left, right) => (left.at - right.at) || (left.order - right.order));

  // 区間ごとの「開始音量・終了音量・開始位置・終了位置」を前から積む
  type Segment = { from: number; to: number; startLevel: number; endLevel: number };
  const segments: Segment[] = [];
  let level = DEFAULT_DYNAMIC_VELOCITY;
  markings.forEach((marking, index) => {
    if (marking.absolute) {
      level = getAbsoluteDynamicVelocity(marking.absolute);
      segments.push({ from: marking.at, to: marking.at, startLevel: level, endLevel: level });
    }
    // 同じ音に p と cresc. が両方付いていれば、p に切り替えてから cresc. を始める
    if (!marking.relative) return;
    // 次の絶対強弱まで（無ければ終端まで ±0.2）
    const nextAbsolute = markings.slice(index + 1).find((candidate) => candidate.absolute);
    const to = nextAbsolute ? nextAbsolute.at : Math.max(endBeat, marking.at);
    const target = nextAbsolute
      ? getAbsoluteDynamicVelocity(nextAbsolute.absolute!)
      : clampVelocity(level + (marking.relative === 'cresc' ? RELATIVE_DYNAMIC_DELTA : -RELATIVE_DYNAMIC_DELTA));
    segments.push({ from: marking.at, to, startLevel: level, endLevel: target });
    // 次の記号（相対）が来たときは、その位置での音量から続ける
    level = target;
  });

  const velocityAt = (absoluteBeat: number): number => {
    // 位置以前の最後の区間を二分探索で引く（性能: 音ごとに O(log 記号数)）
    let low = 0;
    let high = segments.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (segments[mid].from <= absoluteBeat + 1e-6) { found = mid; low = mid + 1; } else { high = mid - 1; }
    }
    if (found < 0) return DEFAULT_DYNAMIC_VELOCITY;
    const segment = segments[found];
    if (segment.to <= segment.from) return segment.endLevel;
    const ratio = Math.min(1, Math.max(0, (absoluteBeat - segment.from) / (segment.to - segment.from)));
    return clampVelocity(segment.startLevel + (segment.endLevel - segment.startLevel) * ratio);
  };
  return { velocityAt, markingCount: markings.length };
}
