import type { MeasureData, NoteEvent } from '../types/storage';
import { Accidental, Dot, Formatter, GraceNote, GraceNoteGroup, StaveNote, Voice } from 'vexflow';
import { createVexFlowTuplets, vexFlowDotCount } from './vexFlowTimingUtils';
import {
  createMeasureAccidentalState,
  getKeySignatureFifths,
  microtoneAccidentalCode,
  resolveDisplayAccidentalsForKeys,
  snapshotAccidentalState,
  shiftKeySignatureByFifths,
  type KeySignature,
  type MeasureAccidentalState,
} from './noteKeyUtils';
import { resolveMeasureKeySignature } from './keySignatureMeasureUtils';
import type { ClefType } from '../components/clefUtils';

// VexFlow が符頭・符尾・ビームを並べるために必要な、音価ごとの最低横幅。
// とくに16分音符以上は、音価そのものは短くても符尾やビームが横に張り出すため、
// 四分音符より狭く見積もると描画後に音符同士が重なる。
const EVENT_BASE_WIDTH = 8;
const FLAG_EXTRA_WIDTH: Record<NoteEvent['dur'], number> = {
  '1': 0,
  '2': 0,
  '4': 0,
  '8': 0,
  '16': 4,
  '32': 6,
  '64': 8,
};
const MEASURE_SIDE_PADDING = 18;
const ACCIDENTAL_WIDTH = 6;
const GRACE_NOTE_WIDTH = 8;

export const MIN_MEASURE_CONTENT_WIDTH = 52;
export const LONG_HALF_MIN_WIDTH = 80;
export const LONG_WHOLE_MIN_WIDTH = 92;
// PianoSystemCanvas と ScorePage が同じ物理幅を使えるよう、段組みの基準をここへ集約する。
// viewport の CSS transform とは独立した、VexFlow の論理座標→物理SVG座標の倍率。
//
// VexFlow の StaveNote / Formatter はデフォルトで五線の高さ約40論理単位を前提にした
// 比較的大きな符頭・符尾サイズで最低幅を計算する。これをそのまま等倍（=1）で物理
// ページ幅（182mm ≒ 688px）へ当てはめると、五線の高さが約10.6mmという実際の印刷譜
// （一般的に六〜七分＝約6〜7mm）より大幅に大きいサイズになってしまい、1小節の最低幅が
// 実際に必要な幅の2倍前後まで膨れる。結果として「読込直後にほぼ全小節が1小節/段へ
// 膨張する」不具合の主因になっていた（.claude/specs/multi-part-beat-alignment/design.md 参照）。
// 0.4 は実測（print-test-score.json の代表的な1小節=約330論理px）から、
// 段あたり4小節という一般的な組版密度に収まる実寸相当のスケールとして選んだ値。
export const SCORE_LAYOUT_RENDER_SCALE = 0.4;
export const SYSTEM_PAGE_SIDE_PADDING = 4;
export const SYSTEM_TARGET_FILL = 0.99;
export const SYSTEM_FIRST_CLEF_PADDING = 50;
export const SYSTEM_MAX_LABEL_WIDTH = 74;
// .print-page は box-sizing:border-box で左右14mmのpaddingを持つ。Canvas 親の実幅は
// この本文182mmであり、A4全幅からの別計算をしない（CSSとの二重定義を避ける）。
export const PRINT_SCORE_AREA_WIDTH_PX = 182 * (96 / 25.4);

/** 楽器名がある最悪ケースでも、Canvas の alloc と一致する小節本文の物理幅。 */
export function worstCaseSystemContentBudget(): number {
  const innerWidth = PRINT_SCORE_AREA_WIDTH_PX - SYSTEM_PAGE_SIDE_PADDING * 2 - SYSTEM_MAX_LABEL_WIDTH;
  return Math.max(1, innerWidth * SYSTEM_TARGET_FILL - SYSTEM_FIRST_CLEF_PADDING);
}

function accidentalCount(event: NoteEvent): number {
  // レイアウト計算は VexFlow の描画前に走る。編集中の途中データや旧形式の保存データでは
  // keys がまだ配列になっていないことがあるため、ここで空配列として扱って描画全体を止めない。
  const keys = Array.isArray(event.keys) ? event.keys : [];
  return keys.filter((key) => /^[a-g][#b]/i.test(key)).length;
}

function eventMinimumWidth(event: NoteEvent): number {
  const graceNotes = Array.isArray(event.graceNotes) ? event.graceNotes.length : 0;
  return EVENT_BASE_WIDTH
    + (FLAG_EXTRA_WIDTH[event.dur] ?? 0)
    + accidentalCount(event) * ACCIDENTAL_WIDTH
    + graceNotes * GRACE_NOTE_WIDTH;
}

/**
 * 小節の実描画に必要な最低横幅を見積もる。
 *
 * この値は均等配置の重み付けではなく「この幅より狭ければ改段する」判定専用。
 * 16分音符を1個あたり12px（符頭8px + ビーム等4px）確保することで、
 * VexFlow が実際に必要とする幅より小さく見積もって重なるのを防ぐ。
 */
export function measureMinimumContentWidth(measure?: MeasureData): number {
  if (!measure?.events?.length) {
    return MIN_MEASURE_CONTENT_WIDTH;
  }

  const contentWidth = measure.events.reduce(
    (width, event) => width + eventMinimumWidth(event),
    MEASURE_SIDE_PADDING,
  );
  const hasWhole = measure.events.some((event) => event.dur === '1');
  const hasHalf = measure.events.some((event) => event.dur === '2');

  if (hasWhole) {
    return Math.max(contentWidth, LONG_WHOLE_MIN_WIDTH);
  }
  if (hasHalf) {
    return Math.max(contentWidth, LONG_HALF_MIN_WIDTH);
  }
  return Math.max(contentWidth, MIN_MEASURE_CONTENT_WIDTH);
}

// 音価 → 拍数（4/4基準）。開始拍（オンセット）の計算に使う
const DURATION_BEATS: Record<NoteEvent['dur'], number> = {
  '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625,
};

/** イベントが占有する拍数（付点・連符込み） */
function eventOccupiedBeatsForLayout(event: NoteEvent): number {
  let beats = DURATION_BEATS[event.dur] ?? 1;
  if (event.dots === 1) beats *= 1.5;
  else if (event.dots === 2) beats *= 1.75;
  if (event.tuplet) beats *= event.tuplet.notesOccupied / event.tuplet.numNotes;
  return beats;
}

/**
 * 同じ小節位置にある複数パート（＋各パートの追加声部）をまとめて描画する場合の
 * 最低横幅を見積もる。
 *
 * 複数パートを1回の VexFlow Formatter で合同フォーマットすると、
 * 「同じ開始拍の音符は同じ列を共有し、異なる開始拍はそれぞれ独立した列になる」
 * ため、必要な横幅は各パート単体の最大値ではなく「開始拍の和集合」で決まる。
 * 例: 右手が3連符×2＋4分×2、左手が8分×8の小節は、単体ではどちらも8列だが、
 * 合同では開始拍がほとんど重ならず13列必要になる。
 * ここではその実挙動に合わせ、開始拍ごとに（その拍で始まるイベントの最大幅を
 * その列の幅として）合計する。
 */
export function combinedMeasureMinimumContentWidth(measures: (MeasureData | undefined)[]): number {
  // key: 開始拍を1/960拍単位へ丸めた整数（浮動小数の誤差で同じ拍が別列に割れるのを防ぐ）
  const columnWidths = new Map<number, number>();
  let hasWhole = false;
  let hasHalf = false;
  let hasAnyEvent = false;

  for (const measure of measures) {
    if (!measure) continue;
    // 主声部（events）＋追加声部（voices[1] 以降）。voices[0] は events の複製なので除外
    const voiceEventLists: NoteEvent[][] = [Array.isArray(measure.events) ? measure.events : []];
    if (Array.isArray(measure.voices)) {
      measure.voices.slice(1).forEach((voice) => {
        if (Array.isArray(voice?.events)) voiceEventLists.push(voice.events);
      });
    }
    for (const events of voiceEventLists) {
      let onsetBeats = 0;
      for (const event of events) {
        hasAnyEvent = true;
        if (event.dur === '1') hasWhole = true;
        if (event.dur === '2') hasHalf = true;
        const columnKey = Math.round(onsetBeats * 960);
        const width = eventMinimumWidth(event);
        columnWidths.set(columnKey, Math.max(columnWidths.get(columnKey) ?? 0, width));
        onsetBeats += eventOccupiedBeatsForLayout(event);
      }
    }
  }

  if (!hasAnyEvent) {
    return MIN_MEASURE_CONTENT_WIDTH;
  }
  let contentWidth = MEASURE_SIDE_PADDING;
  for (const width of columnWidths.values()) contentWidth += width;

  if (hasWhole) {
    return Math.max(contentWidth, LONG_WHOLE_MIN_WIDTH);
  }
  if (hasHalf) {
    return Math.max(contentWidth, LONG_HALF_MIN_WIDTH);
  }
  return Math.max(contentWidth, MIN_MEASURE_CONTENT_WIDTH);
}

const VEXFLOW_DURATION: Record<NoteEvent['dur'], string> = {
  '1': 'w', '2': 'h', '4': 'q', '8': '8', '16': '16', '32': '32', '64': '64',
};
// VexFlow の preCalculateMinTotalWidth は、SVG の実測前には臨時記号列の左張り出しを
// 小さく返す版がある。そのため実際に表示すると確定した記号だけ 1 列ぶんを安全確保する。
// 判定自体は下の本描画と共通の状態機械なので、調号内の # / b を二重計上しない。
const DISPLAYED_ACCIDENTAL_SAFE_WIDTH = 22;
const GRACE_GROUP_SAFE_WIDTH = 14;
export type MeasureLayoutPartContext = {
  /** 全小節を渡し、段頭でも本描画と同じ courtesy accidental を再現する。 */
  measures: MeasureData[];
  /** 調号変更の正本。多段譜では最上段パートが共有調号を保持する。 */
  keySignatureMeasures?: MeasureData[];
  clef: ClefType;
  /** 移調楽器など、パート固有の調号。省略時はスコア全体の調号を使う。 */
  keySignature?: KeySignature;
};

export type VexFlowMeasurementOptions = {
  measureIndex?: number;
  keySignature?: KeySignature;
  parts?: MeasureLayoutPartContext[];
  /** Planner が線形passで準備した状態。指定時は先頭からの再走査をしない。 */
  runtimeParts?: Array<{ clef: ClefType; accidentalState: MeasureAccidentalState; prevMeasureState?: MeasureAccidentalState }>;
};

function addRenderedModifiersForMeasurement(
  note: StaveNote,
  event: NoteEvent,
  accidentalState: MeasureAccidentalState,
  prevMeasureState?: MeasureAccidentalState,
): number {
  let safetyWidth = 0;
  // 文字列中の # / b を機械的に数えるのではなく、本描画と同じ状態機械で
  // 「この位置で実際に表示される」♯・♭・♮・courtesy accidental だけを付与する。
  resolveDisplayAccidentalsForKeys(event.keys, accidentalState, prevMeasureState).forEach((result, index) => {
    if (!result) return;
    const accidental = new Accidental(result.type);
    if (result.cautionary) (accidental as any).setAsCautionary?.();
    (note as any).addModifier?.(accidental, index);
    safetyWidth += DISPLAYED_ACCIDENTAL_SAFE_WIDTH;
  });
  event.microtones?.forEach(({ keyIndex, type }) => {
    if (keyIndex < 0 || keyIndex >= event.keys.length) return;
    (note as any).addModifier?.(new Accidental(microtoneAccidentalCode(type)), keyIndex);
    safetyWidth += DISPLAYED_ACCIDENTAL_SAFE_WIDTH;
  });
  if (event.graceNotes?.length) {
    const graceNotes = event.graceNotes.map((grace) => (
      new GraceNote({ keys: grace.keys, duration: '8', slash: grace.slash })
    ));
    (note as any).addModifier?.(new GraceNoteGroup(graceNotes), 0);
    safetyWidth += graceNotes.length * GRACE_GROUP_SAFE_WIDTH;
  }
  return safetyWidth;
}

function createMeasurementVoice(
  events: NoteEvent[],
  timeSignature: [number, number],
  clef: ClefType,
  accidentalState: MeasureAccidentalState,
  prevMeasureState?: MeasureAccidentalState,
): { voice: Voice; modifierSafetyWidth: number } | null {
  if (events.length === 0) return null;

  let modifierSafetyWidth = 0;
  const notes = events.map((event) => {
    const duration = VEXFLOW_DURATION[event.dur] ?? 'q';
    const isRest = event.isRest || !Array.isArray(event.keys) || event.keys.length === 0;
    const note = new StaveNote({
      clef,
      keys: isRest ? ['b/4'] : event.keys,
      duration: isRest ? `${duration}r` : duration,
      dots: vexFlowDotCount(event.dots),
    });
    // `dots` は tick 用、Dot は ModifierContext が必要幅へ付点の張り出しを反映するため。
    for (let dot = 0; dot < vexFlowDotCount(event.dots); dot += 1) {
      Dot.buildAndAttach([note], { all: true });
    }
    if (!isRest) modifierSafetyWidth += addRenderedModifiersForMeasurement(note, event, accidentalState, prevMeasureState);
    return note;
  });

  // Tuplet のコンストラクタが各音符へ tick 倍率を適用する。ここでも本描画と同じ順序を守る。
  createVexFlowTuplets(events, notes);
  const voice = new Voice({ time: { num_beats: timeSignature[0], beat_value: timeSignature[1] } } as any);
  voice.setMode((Voice as any).Mode.SOFT ?? 1);
  voice.addTickables(notes);
  return { voice, modifierSafetyWidth };
}

function measurementPartState(
  part: MeasureLayoutPartContext | undefined,
  measureIndex: number,
  fallbackKeySignature: KeySignature,
): { clef: ClefType; accidentalState: MeasureAccidentalState; prevMeasureState?: MeasureAccidentalState } {
  const measures = part?.measures ?? [];
  let previous: MeasureAccidentalState | undefined;
  // 本描画と同じく主声部だけを次小節の courtesy 判定へ引き継ぐ。
  for (let index = 0; index <= measureIndex; index += 1) {
    const globalKey = resolveMeasureKeySignature(part?.keySignatureMeasures ?? measures, index, fallbackKeySignature);
    // 移調パートは初期調号との差分（fifths）を途中調号変更にも同じように適用する。
    // ここは PianoSystemCanvas の stave 描画と同じ計算で、調号由来の natural まで一致させる。
    const shift = part?.keySignature
      ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(fallbackKeySignature)
      : 0;
    const effectiveKey = shift === 0 ? globalKey : shiftKeySignatureByFifths(globalKey, shift);
    if (index === measureIndex) {
      // 現小節は createMeasurementVoice がイベントごとに状態を更新するため、
      // ここでは調号で初期化した新しい state と前小節の snapshot だけを渡す。
      return { clef: part?.clef ?? 'treble', accidentalState: createMeasureAccidentalState(effectiveKey), prevMeasureState: previous };
    }
    const state = createMeasureAccidentalState(effectiveKey);
    const events = measures[index]?.events ?? [];
    events.forEach((event) => {
      if (!event.isRest && Array.isArray(event.keys)) {
        resolveDisplayAccidentalsForKeys(event.keys, state, index === measureIndex ? previous : undefined);
      }
    });
    previous = snapshotAccidentalState(state);
  }
  return { clef: part?.clef ?? 'treble', accidentalState: createMeasureAccidentalState(fallbackKeySignature) };
}

/**
 * 合同 Formatter が実際に必要とする最小幅を VexFlow へ問い合わせる。
 *
 * 既存の開始拍ベース推定は、編集中の不完全データでも安全に動くため残す。一方で、
 * ここで得られる値は付点、連符、和音、臨時記号の ModifierContext を含む実測値なので、
 * 取得できる場合は必ずこちらを優先して小節幅を決める。
 */
export function vexFlowCombinedMeasureMinimumContentWidth(
  measures: (MeasureData | undefined)[],
  timeSignature: [number, number],
  options: VexFlowMeasurementOptions = {},
): number | undefined {
  try {
    const voices: Voice[] = [];
    let modifierSafetyWidth = 0;
    const measureIndex = options.measureIndex ?? 0;
    const fallbackKeySignature = options.keySignature ?? 'C';
    measures.forEach((measure, partIndex) => {
      if (!measure) return;
      const partState = options.runtimeParts?.[partIndex]
        ?? measurementPartState(options.parts?.[partIndex], measureIndex, fallbackKeySignature);
      const eventLists: NoteEvent[][] = [Array.isArray(measure.events) ? measure.events : []];
      if (Array.isArray(measure.voices)) {
        measure.voices.slice(1).forEach((voice) => {
          if (Array.isArray(voice?.events)) eventLists.push(voice.events);
        });
      }
      eventLists.forEach((events, voiceIndex) => {
        const voice = createMeasurementVoice(
          events,
          timeSignature,
          partState.clef,
          partState.accidentalState,
          voiceIndex === 0 ? partState.prevMeasureState : undefined,
        );
        if (voice) {
          voices.push(voice.voice);
          modifierSafetyWidth += voice.modifierSafetyWidth;
        }
      });
    });
    if (voices.length === 0) return undefined;

    // 合同描画と同じく先に joinVoices して TickContext を共有する。
    // これを省くと、各 Voice が単独の列として計測され、右手・左手の拍が揃う実際の
    // Formatter より必要幅を小さく出すケースがある。
    const formatter = new Formatter().joinVoices(voices);
    const width = formatter.preCalculateMinTotalWidth(voices);
    return Number.isFinite(width)
      ? Math.ceil(width + MEASURE_SIDE_PADDING + modifierSafetyWidth)
      : undefined;
  } catch {
    // 壊れた旧データや、声部間で合計拍数が一致しない編集中の状態では Formatter が例外を出す。
    // その間も編集を続けられるよう、呼び出し元は従来の安全な推定値へフォールバックする。
    return undefined;
  }
}

/**
 * 合同フォーマットした小節へ横幅を配る。
 *
 * 改段数は ScorePage がスコア全体で先に決める。この関数は「確定済みの段」にだけ
 * 余白を配るため、ここで勝手に縮小して衝突を隠すことはしない。
 */
export function allocateCombinedMeasureWidths(
  minimumWidths: number[],
  availableWidth: number,
  renderScale = SCORE_LAYOUT_RENDER_SCALE,
): { contentWidths: number[]; doesFit: boolean } {
  const usableWidth = Math.max(1, availableWidth);
  // minWidth は VexFlow の論理幅。ctx.scale(s, s) で描く実Canvasでは minWidth*s が
  // 必要な物理幅になる。Stave には contentWidth/s を渡して論理幅を戻す。
  const physicalMinimumWidths = minimumWidths.map((width) => width * renderScale);
  const sumMin = physicalMinimumWidths.reduce((sum, width) => sum + width, 0);
  const extra = Math.max(0, usableWidth - sumMin);
  return {
    // 密な小節の最低幅を正しく計測した後なら、比例配分は密な小節に追加の呼吸を渡せる。
    contentWidths: physicalMinimumWidths.map((width) => (
      sumMin > 0 ? width + extra * (width / sumMin) : width + extra / minimumWidths.length
    )),
    doesFit: sumMin <= usableWidth,
  };
}

export type EffectiveMeasuresPerSystemPlan = {
  effectiveMeasuresPerSystem: number;
  /** 1小節でも最低倍率に収まらない場合だけ true。呼び出し側で警告できる。 */
  hasUnavoidableOverflow: boolean;
  /** ScorePage からCanvasへ渡す、小節ごとの安全幅込み論理幅。 */
  minimumWidths: number[];
};

export type SystemMeasureRange = {
  start: number;
  count: number;
  minimumWidths: number[];
  totalWidth: number;
  overflow: boolean;
};

/**
 * 小節幅は一度だけ計測し、現在位置から希望値以下で入る最大個数を貪欲に選ぶ。
 * range は絶対小節番号を保持するため、ページ境界でも小節の重複・欠落を起こさない。
 */
export function planSystemMeasureRanges(
  minimumWidths: number[],
  requestedMeasuresPerSystem: number,
  availableWidth: number,
): SystemMeasureRange[] {
  const requested = Math.max(1, Math.floor(requestedMeasuresPerSystem));
  const ranges: SystemMeasureRange[] = [];
  for (let start = 0; start < minimumWidths.length;) {
    const maxCount = Math.min(requested, minimumWidths.length - start);
    let count = maxCount;
    while (count > 1 && minimumWidths.slice(start, start + count).reduce((sum, width) => sum + width, 0) > availableWidth) {
      count -= 1;
    }
    const widths = minimumWidths.slice(start, start + count);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    ranges.push({ start, count, minimumWidths: widths, totalWidth, overflow: totalWidth > availableWidth });
    start += count;
  }
  return ranges;
}

/** 保存される編集枠と実データの末尾、両方を失わない段数へ換算する。 */
export function effectiveSystemCount(
  totalSystemsBefore: number,
  requestedMeasuresPerSystem: number,
  effectiveMeasuresPerSystem: number,
  contentMeasureCount: number,
): number {
  const effective = Math.max(1, effectiveMeasuresPerSystem);
  const editingCapacity = Math.max(1, totalSystemsBefore) * Math.max(1, requestedMeasuresPerSystem);
  return Math.max(
    Math.ceil(editingCapacity / effective),
    Math.ceil(Math.max(0, contentMeasureCount) / effective),
  );
}

export type MeasurePlannerSafetyOptions = {
  /**
   * true のときだけ「和音の全キーが臨時記号になる最悪ケース」を確保する。
   * これは Ensemble の記譜音表示専用の対策で、この計画段階では移調前データを渡すため、
   * 実際に描画される時点で初めて臨時記号が増える可能性があるための安全マージン。
   * ピアノ・四重奏など移調をしないパートでは vexFlowCombinedMeasureMinimumContentWidth が
   * 実際に表示される臨時記号だけを既に正確に加算しているため、ここで重ねて足すと
   * 小節の最低幅を過大評価し、1段に入る小節数が不当に減ってしまう。
   */
  includeTranspositionAccidentalWorstCase?: boolean;
};

export function measurePlannerSafetyPadding(
  measures: (MeasureData | undefined)[],
  options: MeasurePlannerSafetyOptions = {},
): number {
  let padding = 0;
  measures.forEach((measure) => {
    if (!measure) return;
    if (options.includeTranspositionAccidentalWorstCase) {
      const voices = [measure.events ?? [], ...(measure.voices?.slice(1).map((voice) => voice.events ?? []) ?? [])];
      voices.forEach((events) => events.forEach((event) => {
        if (!event.isRest) padding += (event.keys?.length ?? 0) * 10;
      }));
    }
    // microtones・grace notes は vexFlowCombinedMeasureMinimumContentWidth 側の
    // modifierSafetyWidth で既に実測込みで加算済みのため、ここでは重複計上しない。
    // 段内の途中調号・途中clef・途中拍子は Canvas のstave開始modifierも幅を使う。
    if (measure.keySignature) padding += 42;
    if (measure.clef) padding += 28;
    if (measure.timeSignature) padding += 30;
  });
  return padding;
}

/**
 * 固定 startMeasureIndex のラッパー群を壊さないため、段ごとではなくスコア全体で
 * 同じ小節数を選ぶ。指定値から 4→3→2→1 と下げ、各連続グループが印刷最小倍率で
 * 入る最大値を返す。これにより次ページの開始小節も常に `systemIndex * count` で決まる。
 */
export function planEffectiveMeasuresPerSystem(
  parts: MeasureLayoutPartContext[],
  timeSignature: [number, number],
  keySignature: KeySignature,
  requestedMeasuresPerSystem: number,
  availableWidth: number,
  renderScale = SCORE_LAYOUT_RENDER_SCALE,
  safetyOptions: MeasurePlannerSafetyOptions = {},
): EffectiveMeasuresPerSystemPlan {
  const requested = Math.max(1, Math.floor(requestedMeasuresPerSystem));
  const measureCount = Math.max(0, ...parts.map((part) => part.measures.length));
  // 状態は先頭から1回だけ前進させる。vexFlowCombined... の通常経路が持つ
  // measureIndexまでの再走査を避け、長い譜面でも VexFlow 計測回数を小節数に抑える。
  let runningGlobalKey = keySignature;
  const runningClefs = parts.map((part) => part.clef);
  const previousStates: Array<MeasureAccidentalState | undefined> = parts.map(() => undefined);
  // VexFlow を呼ぶのは各小節につき1回だけ。候補 4→3→2→1 はこの配列の prefix sum を
  // 参照するだけにし、長い譜面を候補ごとに再フォーマットしない。
  const physicalWidths = Array.from({ length: measureCount }, (_, index) => {
    const measures = parts.map((part) => part.measures[index]);
    const keyMeasure = parts[0]?.keySignatureMeasures?.[index] ?? parts[0]?.measures[index];
    if (keyMeasure?.keySignature) runningGlobalKey = keyMeasure.keySignature;
    const runtimeParts = parts.map((part, partIndex) => {
      const current = part.measures[index];
      if (current?.clef) runningClefs[partIndex] = current.clef;
      const shift = part.keySignature
        ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(keySignature)
        : 0;
      const effectiveKey = shift === 0 ? runningGlobalKey : shiftKeySignatureByFifths(runningGlobalKey, shift);
      return {
        clef: runningClefs[partIndex],
        accidentalState: createMeasureAccidentalState(effectiveKey),
        prevMeasureState: previousStates[partIndex],
      };
    });
    const estimated = combinedMeasureMinimumContentWidth(measures);
    const measured = vexFlowCombinedMeasureMinimumContentWidth(measures, timeSignature, {
      measureIndex: index,
      keySignature,
      parts,
      runtimeParts,
    });
    // 本描画と同じく主声部だけを次小節のcourtesy用snapshotへ引き継ぐ。
    runtimeParts.forEach((runtime, partIndex) => {
      const events = parts[partIndex].measures[index]?.events ?? [];
      events.forEach((event) => {
        if (!event.isRest && Array.isArray(event.keys)) {
          resolveDisplayAccidentalsForKeys(event.keys, runtime.accidentalState);
        }
      });
      previousStates[partIndex] = snapshotAccidentalState(runtime.accidentalState);
    });
    return (Math.max(estimated, measured ?? 0) + measurePlannerSafetyPadding(measures, safetyOptions)) * renderScale;
  });
  const prefixSums = [0];
  physicalWidths.forEach((width) => prefixSums.push(prefixSums[prefixSums.length - 1] + width));

  for (let candidate = requested; candidate >= 1; candidate -= 1) {
    let fits = true;
    for (let start = 0; start < measureCount; start += candidate) {
      const end = Math.min(start + candidate, measureCount);
      const required = prefixSums[end] - prefixSums[start];
      if (required > availableWidth) {
        fits = false;
        break;
      }
    }
    if (fits) return {
      effectiveMeasuresPerSystem: candidate,
      hasUnavoidableOverflow: false,
      minimumWidths: physicalWidths.map((width) => width / renderScale),
    };
  }
  return {
    effectiveMeasuresPerSystem: 1,
    hasUnavoidableOverflow: measureCount > 0,
    minimumWidths: physicalWidths.map((width) => width / renderScale),
  };
}
