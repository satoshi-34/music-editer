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
