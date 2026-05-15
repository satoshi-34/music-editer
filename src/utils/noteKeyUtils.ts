// 音高キーと臨時記号の共通ユーティリティ
// 描画・保存バリデーションの両方で同じ判定を使い、
// 「画面では読めるのに保存で弾かれる」ズレを防ぐ。

export type KeyAccidental = '' | '#' | 'b';
export type DisplayAccidental = '#' | 'b' | 'n';
export type AccidentalToolKind = 'sharp' | 'flat' | 'natural';
export type KeySignature =
  'C' | 'G' | 'D' | 'A' | 'E' | 'B' | 'F#' | 'C#' |
  'F' | 'Bb' | 'Eb' | 'Ab' | 'Db' | 'Gb' | 'Cb';

const SHARP_ORDER: ParsedNoteKey['letter'][] = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_ORDER: ParsedNoteKey['letter'][] = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIGNATURE_ACCIDENTAL_COUNT: Record<KeySignature, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Cb: -7,
};

const KEY_SIGNATURE_BY_COUNT: Record<number, KeySignature> = {
  '-7': 'Cb',
  '-6': 'Gb',
  '-5': 'Db',
  '-4': 'Ab',
  '-3': 'Eb',
  '-2': 'Bb',
  '-1': 'F',
  '0': 'C',
  '1': 'G',
  '2': 'D',
  '3': 'A',
  '4': 'E',
  '5': 'B',
  '6': 'F#',
  '7': 'C#',
};

export const KEY_SIGNATURE_OPTIONS: Array<{ value: KeySignature; label: string }> = [
  { value: 'C', label: '調号なし（C dur / a moll）' },
  { value: 'G', label: '♯1つ（G dur / e moll）' },
  { value: 'D', label: '♯2つ（D dur / h moll）' },
  { value: 'A', label: '♯3つ（A dur / fis moll）' },
  { value: 'E', label: '♯4つ（E dur / cis moll）' },
  { value: 'B', label: '♯5つ（H dur / gis moll）' },
  { value: 'F#', label: '♯6つ（Fis dur / dis moll）' },
  { value: 'C#', label: '♯7つ（Cis dur / ais moll）' },
  { value: 'F', label: '♭1つ（F dur / d moll）' },
  { value: 'Bb', label: '♭2つ（B dur / g moll）' },
  { value: 'Eb', label: '♭3つ（Es dur / c moll）' },
  { value: 'Ab', label: '♭4つ（As dur / f moll）' },
  { value: 'Db', label: '♭5つ（Des dur / b moll）' },
  { value: 'Gb', label: '♭6つ（Ges dur / es moll）' },
  { value: 'Cb', label: '♭7つ（Ces dur / as moll）' },
];

export interface ParsedNoteKey {
  originalKey: string;
  vexflowKey: string;
  letter: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  accidental: KeyAccidental;
  octave: number;
  /**
   * 臨時記号の効力は「音名 + オクターブ」単位で管理する。
   * たとえば F#4 と F4 は同じ状態キーを共有し、
   * 小節内で F# のあとに F が来たらナチュラルを出せる。
   */
  accidentalStateKey: string;
}

// 受け入れる形式:
// - VexFlow: c/4, f#/5, bb/3
// - Tone.js 風: C4, F#5, Bb3
const NOTE_KEY_PATTERN = /^([a-gA-G])([#b]?)(?:\/)?([0-9]+)$/;

export function parseNoteKey(key: string): ParsedNoteKey | null {
  const match = key.match(NOTE_KEY_PATTERN);
  if (!match) {
    return null;
  }

  const letter = match[1].toLowerCase() as ParsedNoteKey['letter'];
  const accidental = (match[2] || '') as KeyAccidental;
  const octave = Number.parseInt(match[3], 10);

  if (!Number.isInteger(octave) || octave < 0 || octave > 9) {
    return null;
  }

  return {
    originalKey: key,
    vexflowKey: `${letter}${accidental}/${octave}`,
    letter,
    accidental,
    octave,
    accidentalStateKey: `${letter}/${octave}`,
  };
}

export function isValidNoteKeyString(key: unknown): key is string {
  return typeof key === 'string' && parseNoteKey(key) !== null;
}

export function isValidKeySignature(value: unknown): value is KeySignature {
  return typeof value === 'string' && value in KEY_SIGNATURE_ACCIDENTAL_COUNT;
}

export function normalizeKeySignature(value: unknown): KeySignature {
  return isValidKeySignature(value) ? value : 'C';
}

export function hasVisibleKeySignature(keySignature: KeySignature): boolean {
  return KEY_SIGNATURE_ACCIDENTAL_COUNT[keySignature] !== 0;
}

export function getKeySignatureAccidentalMap(keySignature: KeySignature): Map<ParsedNoteKey['letter'], KeyAccidental> {
  const count = KEY_SIGNATURE_ACCIDENTAL_COUNT[keySignature];
  const accidentalMap = new Map<ParsedNoteKey['letter'], KeyAccidental>();

  if (count > 0) {
    SHARP_ORDER.slice(0, count).forEach(letter => accidentalMap.set(letter, '#'));
  } else if (count < 0) {
    FLAT_ORDER.slice(0, Math.abs(count)).forEach(letter => accidentalMap.set(letter, 'b'));
  }

  return accidentalMap;
}

export function applyKeySignatureToNaturalKey(key: string, keySignature: KeySignature): string {
  const parsed = parseNoteKey(key);
  if (!parsed) {
    return key;
  }

  // 明示的な臨時記号がある場合は、それがユーザーの意図なのでそのまま使う。
  if (parsed.accidental !== '') {
    return parsed.vexflowKey;
  }

  const signatureAccidental = getKeySignatureAccidentalMap(keySignature).get(parsed.letter) ?? '';
  return `${parsed.letter}${signatureAccidental}/${parsed.octave}`;
}

export function shiftKeySignatureByAccidental(
  currentKeySignature: KeySignature,
  accidental: AccidentalToolKind
): KeySignature {
  const currentCount = KEY_SIGNATURE_ACCIDENTAL_COUNT[currentKeySignature] ?? 0;

  // 行頭の記号クリックは「その記号系の調号へ入る」操作に寄せる。
  // たとえば G（♯1つ）で ♭ を押したときは C に戻すのではなく、
  // まず F（♭1つ）へ切り替える方が見た目の期待に合いやすい。
  if (accidental === 'natural') {
    return 'C';
  }

  if (accidental === 'sharp') {
    const nextCount = currentCount < 0 ? 1 : Math.min(7, currentCount + 1);
    return KEY_SIGNATURE_BY_COUNT[nextCount];
  }

  const nextCount = currentCount > 0 ? -1 : Math.max(-7, currentCount - 1);
  return KEY_SIGNATURE_BY_COUNT[nextCount];
}

export function setKeyAccidental(key: string, kind: AccidentalToolKind): string {
  const parsed = parseNoteKey(key);
  if (!parsed) {
    return key;
  }

  const accidental = kind === 'sharp' ? '#' : kind === 'flat' ? 'b' : '';
  return `${parsed.letter}${accidental}/${parsed.octave}`;
}

export type MeasureAccidentalState = Map<string, KeyAccidental>;

export function createMeasureAccidentalState(keySignature: KeySignature = 'C'): MeasureAccidentalState {
  const state = new Map<string, KeyAccidental>();
  const signatureMap = getKeySignatureAccidentalMap(keySignature);

  // 調号の効力はオクターブをまたいでかかるため、
  // 各オクターブへ初期状態を先に入れておく。
  for (let octave = 0; octave <= 9; octave += 1) {
    signatureMap.forEach((accidental, letter) => {
      state.set(`${letter}/${octave}`, accidental);
    });
  }

  return state;
}

/**
 * 小節内の過去状態を見て、その音に「今この位置で表示すべき臨時記号」を返す。
 * 返り値が null のときは、同じ小節内ですでに効力が続いているため記号を省略できる。
 */
export function resolveDisplayAccidental(
  key: string,
  accidentalState: MeasureAccidentalState
): DisplayAccidental | null {
  const parsed = parseNoteKey(key);
  if (!parsed) {
    return null;
  }

  const previousAccidental = accidentalState.get(parsed.accidentalStateKey) ?? '';
  accidentalState.set(parsed.accidentalStateKey, parsed.accidental);

  if (parsed.accidental === previousAccidental) {
    return null;
  }

  if (parsed.accidental === '') {
    return previousAccidental === '' ? null : 'n';
  }

  return parsed.accidental;
}

export function resolveDisplayAccidentalsForKeys(
  keys: string[],
  accidentalState: MeasureAccidentalState
): Array<DisplayAccidental | null> {
  return keys.map(key => resolveDisplayAccidental(key, accidentalState));
}

/**
 * 移調楽器の「記譜音 ↔ 実音」変換に使う半音差。
 *
 * 値の符号は「実音 → 記譜音 への加算」。たとえば B♭管クラリネットは、
 * 実音 C を記譜では D（半音 +2 上）に書くので `Bb` は `+2`。
 *
 * - `Bb`: B♭管（クラリネット、トランペットなど）→ 長2度上に記譜
 * - `Eb`: E♭管（アルトサックスなど）→ 長6度上に記譜（+9半音）
 * - `F`:  F管（ホルン、イングリッシュホルンなど）→ 完全5度上に記譜（+7半音）
 * - `G`:  G管（アルトフルートなど）→ 完全4度上に記譜（+5半音）
 * - `octave-down`: コントラバスなど → 1オクターブ上に記譜
 * - `C` / `none`: 移調なし
 */
export const TRANSPOSITION_WRITTEN_OFFSET_SEMITONES: Record<string, number> = {
  C: 0,
  none: 0,
  Bb: 2,
  Eb: 9,
  F: 7,
  G: 5,
  'octave-down': 12,
};

/**
 * 移調楽器の「記譜音側の調号」を求めるための五度圏オフセット。
 *
 * 半音差が +2（長2度上）なら、五度圏上は +2（シャープが 2 つ増える）の方向へ動く。
 * これに従って、たとえば実音 C メジャー → B♭管は記譜 D メジャー（♯2）になる。
 *
 * - `Bb`: 長2度上  → +2 fifths
 * - `Eb`: 長6度上  → +3 fifths
 * - `F`:  完全5度上 → +1 fifth
 * - `G`:  完全4度上 → -1 fifth
 * - `octave-down`: オクターブ上（同じ調号）
 * - `C` / `none`: 移調なし
 */
export const TRANSPOSITION_WRITTEN_OFFSET_FIFTHS: Record<string, number> = {
  C: 0,
  none: 0,
  Bb: 2,
  Eb: 3,
  F: 1,
  G: -1,
  'octave-down': 0,
};

/**
 * 五度圏オフセットを実音の調号に加算して、記譜音側の調号を返す。
 *
 * 例: concert = C（0）に対して `+2` を加えると D（♯2）。
 * 範囲外（±7 を超える）になった場合は、12 で巻き戻して
 * 異名同音の調号にそろえる（例: ♯8 → ♭4）。
 */
export function shiftKeySignatureByFifths(
  base: KeySignature,
  fifths: number
): KeySignature {
  const baseCount = KEY_SIGNATURE_ACCIDENTAL_COUNT[base] ?? 0;
  let next = baseCount + fifths;
  while (next > 7) next -= 12;
  while (next < -7) next += 12;
  return KEY_SIGNATURE_BY_COUNT[next] ?? base;
}

// 半音単位の絶対 MIDI 値計算用テーブル。VexFlow の "c/4" は MIDI 60。
const LETTER_TO_PITCH_CLASS: Record<ParsedNoteKey['letter'], number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};
// 半音 → 「文字 + 臨時記号」への戻し変換。
// シャープ系で統一しておくと、移調後に同じ表記体系で復元できる。
const PITCH_CLASS_TO_LETTER: Array<{ letter: ParsedNoteKey['letter']; accidental: KeyAccidental }> = [
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

/**
 * 音高キーを半音単位で移調する。
 *
 * 例: `transposeKeyBySemitones('c/4', 2)` → `d/4`
 *
 * 異名同音は気にせず「シャープ系」で書き戻す。
 * 移調表示はあくまで「奏者が読む譜面」を一時的に出すための機能で、
 * 厳密な楽典的綴り（D♭ vs C# など）はまだ扱わない。
 */
export function transposeKeyBySemitones(key: string, semitones: number): string {
  const parsed = parseNoteKey(key);
  if (!parsed) {
    return key;
  }
  // 半音差ゼロでは綴り（フラット/シャープ）を変えたくないので、解析できたキーをそのまま返す。
  if (semitones === 0) {
    return parsed.vexflowKey;
  }
  const baseClass = LETTER_TO_PITCH_CLASS[parsed.letter];
  const accidentalOffset = parsed.accidental === '#' ? 1 : parsed.accidental === 'b' ? -1 : 0;
  const absolute = baseClass + accidentalOffset + parsed.octave * 12 + semitones;

  // 範囲外（負の値や巨大値）を作らないよう、12 で割って整数オクターブと半音に分ける。
  const octave = Math.floor(absolute / 12);
  const pitchClass = ((absolute % 12) + 12) % 12;
  const { letter, accidental } = PITCH_CLASS_TO_LETTER[pitchClass];
  return `${letter}${accidental}/${octave}`;
}
