// StaffCanvas と PianoSystemCanvas の両方で使っていた
// 「音名(key) ⇄ MIDI番号」の変換ロジックを共有化したもの。
// 半音移動（Alt+↑↓ など）で使う。

// 各音名(ラテン文字)から半音（ピッチクラス）への対応表。
// 例: c=0, d=2 のように、ドから何半音上かを表す。
const LETTER_TO_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * "c#/4" のような VexFlow 形式の音名文字列を MIDI 番号に変換する。
 * フォーマットに一致しない場合は null を返す。
 * C4 = 60 を基準にしている（一般的な MIDI の中央ハと同じ）。
 */
export function keyToMidi(key: string): number | null {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i);
  if (!m) return null;
  let pc = LETTER_TO_PC[m[1].toLowerCase()];
  if (m[2] === '#') pc += 1;
  else if (m[2] === 'b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return 12 * (parseInt(m[3], 10) + 1) + pc; // C4=60
}

/**
 * MIDI 番号を VexFlow 形式の音名文字列に変換する。
 * preferSharp が true ならシャープ表記（c#）、false ならフラット表記（db）を使う。
 * 例: 61 → preferSharp=true なら "c#/4"、false なら "db/4"
 */
export function midiToKey(midi: number, preferSharp: boolean): string {
  const SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const name = preferSharp ? SHARP[pc] : FLAT[pc];
  return `${name}/${oct}`;
}
