// StaffCanvas と PianoSystemCanvas の両方で使っていた
// 「音名(key) ⇄ MIDI番号」の変換ロジックを共有化したもの。
// 半音移動（Alt+↑↓ など）で使う。

import { keyAccidentalSemitoneOffset, type KeyAccidental } from './noteKeyUtils';

// 各音名(ラテン文字)から半音（ピッチクラス）への対応表。
// 例: c=0, d=2 のように、ドから何半音上かを表す。
const LETTER_TO_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * "c#/4" のような VexFlow 形式の音名文字列を MIDI 番号に変換する。
 * フォーマットに一致しない場合は null を返す。
 * C4 = 60 を基準にしている（一般的な MIDI の中央ハと同じ）。
 */
export function keyToMidi(key: string): number | null {
  // ## / bb（ダブルシャープ・ダブルフラット）は1文字の #/b より先に並べる。
  // 逆順だと "c##/4" の2つ目の # が余って解析に失敗する。
  const m = key.match(/^([a-g])(##|bb|[#b])?[/ ]([0-9]+)$/i);
  if (!m) return null;
  // 半音差は noteKeyUtils と同じ関数で求める（記号が増えたときの直し忘れ防止）。
  // オクターブ加算より前にピッチクラスを 0..11 へ丸めてはいけない:
  // b##/3（=C#4）や cbb/4（=Bb3）のようにオクターブ境界をまたぐダブル記号が
  // 1オクターブずれて再生される（#430 Codex round1 P1）。丸めずにそのまま加算する
  const offset = LETTER_TO_PC[m[1].toLowerCase()] + keyAccidentalSemitoneOffset((m[2] ?? '') as KeyAccidental);
  return 12 * (parseInt(m[3], 10) + 1) + offset; // C4=60
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

/**
 * ダブルシャープ（##）・ダブルフラット（bb）付きの音高キーを、
 * 同じ高さの通常表記へ読み替える。例: "c##/4" → "d/4"、"ebb/3" → "d/3"
 *
 * 再生エンジン（内蔵音源・SoundFont）は音名テーブルやサンプル名が
 * 1文字の #/b しか持たないため、鳴らす直前にここで読み替える。
 * 対象外のキー（通常の音高キーや解析できない文字列）はそのまま返す。
 */
export function respellDoubleAccidentalKey(key: string): string {
  const m = key.match(/^([a-g])(##|bb)[/ ]([0-9]+)$/i);
  if (!m) return key;
  let midi = keyToMidi(key);
  if (midi === null) return key;
  // cbb/0 のようにオクターブ 0 の下端をまたぐと読み替え先が負のオクターブ（bb/-1）になるが、
  // 再生エンジンは負のオクターブを受理しない（内蔵音源は A4 へフォールバック・SoundFont は
  // 不正音名）。MusicXML 読込から到達しうるため、最低オクターブ内へ丸めて必ず鳴る音にする
  // （#430 round2 P2。1オクターブ上で鳴るのは近似だが、無音や A4 化よりずっとまし）
  while (midi < 12) midi += 12;
  // ## は上げた結果なのでシャープ表記、bb は下げた結果なのでフラット表記に寄せると
  // 元の綴りに近い読み替えになる（鳴る高さはどちらでも同じ）。
  return midiToKey(midi, m[2] === '##');
}
