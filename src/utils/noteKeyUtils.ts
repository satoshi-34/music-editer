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
