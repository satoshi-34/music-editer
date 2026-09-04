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
 * 大譜表（ピアノ）では強弱記号は両手に共通の「その時点の音量」（Issue #626）。
 * 右手に付いた p が左手の伴奏に効かず、伴奏が旋律より大きく鳴っていた（運用者QA 2026-09-04・悲愴）。
 *
 * 各パートの各声部に付いた強弱（絶対・cresc./dim.・松葉）を小節ごとに集め、他のパートの
 * 主声部で**同じ拍位置以降の最初の音**へ写す（その音に同種の記号が無いときだけ）。
 * 写した結果に対して従来の resolveDynamicVelocities をパートごとに掛けるので、
 * 傾斜（cresc./dim.）の計算は変えない。元データは変更しない（浅い複製を返す）。
 * 四重奏・編成譜は各パートに自分の強弱が書かれるので、呼び出し側でピアノのときだけ使う。
 */
export function mergeGrandStaffDynamics(partsMeasures: MeasureData[][]): MeasureData[][] {
  if (partsMeasures.length <= 1) return partsMeasures;
  type Marking = { measureIndex: number; beat: number; order: number; dynamics?: DynamicMarking[]; hairpins?: NoteEvent['hairpins'] };
  // 全パート・全声部の記号を「小節・拍位置」つきで集め、時系列順に並べる
  const markings: Marking[] = [];
  partsMeasures.forEach((measures) => {
    measures.forEach((measure, measureIndex) => {
      getMeasureVoices(measure).forEach((voice) => {
        let beat = 0;
        voice.events.forEach((event) => {
          if (event.dynamics?.length || event.hairpins?.length) {
            markings.push({ measureIndex, beat, order: markings.length, dynamics: event.dynamics, hairpins: event.hairpins });
          }
          beat += getEventDurationBeats(event);
        });
      });
    });
  });
  if (markings.length === 0) return partsMeasures;
  markings.sort((left, right) => (left.measureIndex - right.measureIndex) || (left.beat - right.beat) || (left.order - right.order));

  return partsMeasures.map((measures) => {
    // このパートの主声部の音を「小節・拍位置」つきで一列にする（写し先の探索用）
    const slots: { measureIndex: number; eventIndex: number; beat: number }[] = [];
    measures.forEach((measure, measureIndex) => {
      let beat = 0;
      getPrimaryVoiceEvents(measure).forEach((event, eventIndex) => {
        slots.push({ measureIndex, eventIndex, beat });
        beat += getEventDurationBeats(event);
      });
    });
    if (slots.length === 0) return measures;
    // 写し先ごとの上書き。自分の記号がある音には写さない。同じ写し先に複数の記号が集まったら
    // 時系列で**後の**記号を採る（round1 P2: 先に処理した cresc. が後の f を隠さない）
    const copied = new Map<string, { dynamics?: DynamicMarking[]; hairpins?: NoteEvent['hairpins'] }>();
    markings.forEach((marking) => {
      // 記号の拍位置以降の最初の音。同じ小節に無ければ次の小節以降へ持ち越す
      // （round1 P1: 小節末の音へ戻すと記号が時間的に逆行する）
      const slot = slots.find((candidate) =>
        candidate.measureIndex > marking.measureIndex
        || (candidate.measureIndex === marking.measureIndex && candidate.beat >= marking.beat - 1e-6));
      if (!slot) return;
      const key = `${slot.measureIndex}:${slot.eventIndex}`;
      const entry = copied.get(key) ?? {};
      if (marking.dynamics?.length) entry.dynamics = marking.dynamics;
      if (marking.hairpins?.length) entry.hairpins = marking.hairpins;
      copied.set(key, entry);
    });
    if (copied.size === 0) return measures;
    return measures.map((measure, measureIndex) => {
      const primary = getPrimaryVoiceEvents(measure);
      let changed = false;
      const merged = primary.map((event, eventIndex) => {
        const entry = copied.get(`${measureIndex}:${eventIndex}`);
        if (!entry) return event;
        const next = { ...event };
        if (entry.dynamics && !event.dynamics?.length) {
          next.dynamics = entry.dynamics.map((dynamic) => ({ ...dynamic }));
          changed = true;
        }
        if (entry.hairpins && !event.hairpins?.length) {
          next.hairpins = entry.hairpins.map((hairpin) => ({ ...hairpin }));
          changed = true;
        }
        return changed ? next : event;
      });
      if (!changed) return measure;
      const voices = measure.voices
        ? measure.voices.map((voice, index) => (index === 0 ? { ...voice, events: merged } : voice))
        : undefined;
      return { ...measure, events: merged, ...(voices ? { voices } : {}) };
    });
  });
}

export function findPrimaryEventIndexAtBeat(measure: MeasureData, beat: number): number {
  const primary = getPrimaryVoiceEvents(measure);
  let cursor = 0;
  let found = -1;
  let firstSoundingAfter = -1;
  for (let index = 0; index < primary.length; index++) {
    const sounding = !primary[index].isRest;
    if (cursor <= beat + 1e-6) {
      // 休符は velocity を持たない（resolveDynamicVelocities は発音イベントだけに保存する）
      // ので、同じ拍位置以前の**発音**イベントを返す（round1 P1）
      if (sounding) found = index;
    } else if (sounding && firstSoundingAfter < 0) {
      firstSoundingAfter = index;
    }
    cursor += getEventDurationBeats(primary[index]);
  }
  // 前に発音が無ければ（小節頭が休符）、後の最初の発音を借りる（その時点の基準音量は同じ）
  return found >= 0 ? found : firstSoundingAfter;
}
