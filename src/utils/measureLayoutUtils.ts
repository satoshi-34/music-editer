import type { MeasureData, NoteEvent } from '../types/storage';

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
