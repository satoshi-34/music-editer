// 選択範囲（小節）の移調ユーティリティ。
// 「小節選択＋クリップボード」機構（ScorePage.tsx の Cmd+C/V）に乗せる形で、
// 選択中の小節だけをまとめて半音単位で移調する。
//
// 異名同音（同じ音を # で書くか b で書くか）の綴りは、
// 移調楽器の記譜音変換（noteKeyUtils.ts の shiftKeySignatureByFifths 等）と同じ考え方で、
// 「その時点で有効な調号が♭系ならフラット寄り、♯系またはCならシャープ寄り」という
// シンプルな規則にする（本格的な五線譜アルゴリズムではなく実用上の近似）。
// 理由: 既存の移調楽器ロジックは「調号そのもの」を五度圏でずらす変換であり、
// 個々の音符の綴りを都度選び直す機能ではないため、そのまま再利用はできない。
// 代わりに getKeySignatureFifths() で調号の♯♭方向だけを取り出して再利用する。

import { parseNoteKey, keyAccidentalSemitoneOffset, getKeySignatureFifths, type KeySignature } from './noteKeyUtils';
import type { MeasureData, NoteEvent, VoiceData } from '../types/storage';

// VexFlow の octave は 0〜9 のみ有効（noteKeyUtils.ts の parseNoteKey と同じ制約）。
// 移調した結果がこの範囲を外れたら「対応できない音域」として弾く。
const MIN_OCTAVE = 0;
const MAX_OCTAVE = 9;

const LETTER_TO_PITCH_CLASS: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

// シャープ系の綴り（♯優先）。移調楽器の記譜と同じく「白鍵+♯」で統一する。
const SHARP_SPELLING: Array<{ letter: string; accidental: '' | '#' }> = [
  { letter: 'c', accidental: '' },
  { letter: 'c', accidental: '#' },
  { letter: 'd', accidental: '' },
  { letter: 'd', accidental: '#' },
  { letter: 'e', accidental: '' },
  { letter: 'f', accidental: '' },
  { letter: 'f', accidental: '#' },
  { letter: 'g', accidental: '' },
  { letter: 'g', accidental: '#' },
  { letter: 'a', accidental: '' },
  { letter: 'a', accidental: '#' },
  { letter: 'b', accidental: '' },
];

// フラット系の綴り（♭優先）。
const FLAT_SPELLING: Array<{ letter: string; accidental: '' | 'b' }> = [
  { letter: 'c', accidental: '' },
  { letter: 'd', accidental: 'b' },
  { letter: 'd', accidental: '' },
  { letter: 'e', accidental: 'b' },
  { letter: 'e', accidental: '' },
  { letter: 'f', accidental: '' },
  { letter: 'g', accidental: 'b' },
  { letter: 'g', accidental: '' },
  { letter: 'a', accidental: 'b' },
  { letter: 'a', accidental: '' },
  { letter: 'b', accidental: 'b' },
  { letter: 'b', accidental: '' },
];

/**
 * 調号から「♭系で綴るべきか」を判定する。
 * fifths が負（F, Bb, Eb...）なら♭系、0（C）または正（♯系）ならシャープ系にする。
 */
export function shouldPreferFlatSpelling(keySignature?: KeySignature): boolean {
  if (!keySignature) return false;
  return getKeySignatureFifths(keySignature) < 0;
}

/**
 * 音高キー1つを半音単位で移調する。
 * 戻り値が null のときは、対応する音域（オクターブ0〜9）を外れたことを意味する
 * （呼び出し側は操作全体を中止すること。部分適用しない）。
 *
 * @param key VexFlow形式の音高キー（例: "c/4", "f#/3"）
 * @param semitones 移調する半音数（正=上、負=下）
 * @param preferKeySignature 綴りの基準にする調号。省略時はシャープ系で綴る。
 */
export function transposeKey(
  key: string,
  semitones: number,
  preferKeySignature?: KeySignature
): string | null {
  const parsed = parseNoteKey(key);
  if (!parsed) {
    return key; // 解析できないキーはそのまま返す（既存の transposeKeyBySemitones と同じ方針）
  }
  if (semitones === 0) {
    return parsed.vexflowKey;
  }

  const baseClass = LETTER_TO_PITCH_CLASS[parsed.letter];
  const absolute = baseClass + keyAccidentalSemitoneOffset(parsed.accidental) + parsed.octave * 12 + semitones;

  const octave = Math.floor(absolute / 12);
  if (octave < MIN_OCTAVE || octave > MAX_OCTAVE) {
    return null; // 対応音域（オクターブ0〜9）を外れた
  }

  const pitchClass = ((absolute % 12) + 12) % 12;
  const preferFlats = shouldPreferFlatSpelling(preferKeySignature);
  const spelling = preferFlats ? FLAT_SPELLING[pitchClass] : SHARP_SPELLING[pitchClass];
  return `${spelling.letter}${spelling.accidental}/${octave}`;
}

/**
 * 音高キーの配列（和音・前打音の複数音など）をまとめて移調する。
 * 1音でも音域を外れたら null を返す（全体を中止するため）。
 */
export function transposeKeys(
  keys: string[],
  semitones: number,
  preferKeySignature?: KeySignature
): string[] | null {
  const result: string[] = [];
  for (const key of keys) {
    const transposed = transposeKey(key, semitones, preferKeySignature);
    if (transposed === null) {
      return null;
    }
    result.push(transposed);
  }
  return result;
}

/**
 * 1つの NoteEvent を移調する。
 * - 休符（isRest）は音高を持たないので変更しない
 * - keys（単音・和音の音高）と graceNotes（前打音）の keys を移調する
 * - microtones は keyIndex（keys 配列内の位置）で紐づくだけで音高情報自体は持たないため、そのまま維持する
 * 音域を外れた場合は null を返す。
 */
export function transposeNoteEvent(
  event: NoteEvent,
  semitones: number,
  preferKeySignature?: KeySignature
): NoteEvent | null {
  if (event.isRest) {
    return event; // 休符は移調対象外
  }

  const transposedKeys = transposeKeys(event.keys, semitones, preferKeySignature);
  if (transposedKeys === null) {
    return null;
  }

  let transposedGraceNotes: NoteEvent['graceNotes'];
  if (event.graceNotes) {
    transposedGraceNotes = [];
    for (const grace of event.graceNotes) {
      const keys = transposeKeys(grace.keys, semitones, preferKeySignature);
      if (keys === null) {
        return null;
      }
      transposedGraceNotes.push({ ...grace, keys });
    }
  }

  return {
    ...event,
    keys: transposedKeys,
    ...(event.graceNotes ? { graceNotes: transposedGraceNotes } : {}),
  };
}

/**
 * 1つの声部（NoteEvent 配列）をまとめて移調する。音域を外れたら null。
 */
function transposeEvents(
  events: NoteEvent[],
  semitones: number,
  preferKeySignature?: KeySignature
): NoteEvent[] | null {
  const result: NoteEvent[] = [];
  for (const event of events) {
    const transposed = transposeNoteEvent(event, semitones, preferKeySignature);
    if (transposed === null) {
      return null;
    }
    result.push(transposed);
  }
  return result;
}

/**
 * 1小節分（events と voices の両方）をまとめて移調する。
 * events・voices 内の全声部が対象。テンポ・拍子・調号・クレフなどの構造属性は変更しない。
 * 音域を外れたら null（呼び出し側で操作全体を中止する）。
 */
export function transposeMeasure(
  measure: MeasureData,
  semitones: number,
  preferKeySignature?: KeySignature
): MeasureData | null {
  const transposedEvents = transposeEvents(measure.events, semitones, preferKeySignature);
  if (transposedEvents === null) {
    return null;
  }

  let transposedVoices: VoiceData[] | undefined;
  if (measure.voices) {
    transposedVoices = [];
    for (const voice of measure.voices) {
      const events = transposeEvents(voice.events, semitones, preferKeySignature);
      if (events === null) {
        return null;
      }
      transposedVoices.push({ ...voice, events });
    }
  }

  return {
    ...measure,
    events: transposedEvents,
    ...(measure.voices ? { voices: transposedVoices } : {}),
  };
}

export type TransposeRangeResult =
  | { ok: true; measures: MeasureData[] }
  | { ok: false; error: string };

/**
 * 小節配列のうち [start, end]（両端含む・絶対インデックス）の範囲だけを移調する。
 * 範囲外の小節はそのまま。1音でも対応音域（オクターブ0〜9）を外れたら
 * 操作全体を中止し、元の配列と同じ内容の measures は返さず error を返す（部分適用しない）。
 *
 * preferKeySignature は範囲内の各小節ごとに呼び出し側で解決した「その時点の有効調号」を渡す想定
 * （resolveMeasureKeySignature を使う）。省略時は全小節シャープ系で綴る。
 */
export function transposeMeasureRange(
  measures: MeasureData[],
  start: number,
  end: number,
  semitones: number,
  resolveKeySignatureForIndex?: (index: number) => KeySignature
): TransposeRangeResult {
  const copy = [...measures];
  for (let i = start; i <= end; i++) {
    const measure = copy[i];
    if (!measure) continue;
    const preferKeySignature = resolveKeySignatureForIndex?.(i);
    const transposed = transposeMeasure(measure, semitones, preferKeySignature);
    if (transposed === null) {
      return {
        ok: false,
        error: `${i + 1}小節目に対応音域（オクターブ0〜9）を外れる音があるため、移調できませんでした。`,
      };
    }
    copy[i] = transposed;
  }
  return { ok: true, measures: copy };
}
