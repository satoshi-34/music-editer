// Shared pitch conversion utilities for all clef types.
// StaffCanvas and PianoSystemCanvas both import from here.

// 'tenor' はテナー記号（C 記号を第4線に置くもの）。チェロ・ファゴット・トロンボーンの
// 高音域で使う。VexFlow は 'tenor' をそのままサポートしている。
export type ClefType = 'treble' | 'bass' | 'alto' | 'tenor';

// ===== treble (line 0 = F5) =====
function lineToKeyTreble(line: number): string {
  const s = Math.round(line * 2) / 2;
  const stepsDown = Math.round(s * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown, oct = 5; // F5: idx=3
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineTreble(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = +m[3] * 7 + (idxMap[m[1].toLowerCase()] ?? 0);
  const base = 5 * 7 + idxMap['f']; // F5
  return (base - target) / 2;
}

// ===== bass (line 0 = A3) =====
function lineToKeyBass(line: number): string {
  const s = Math.round(line * 2) / 2;
  const stepsDown = Math.round(s * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 5 - stepsDown, oct = 3; // A3: idx=5
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineBass(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = +m[3] * 7 + (idxMap[m[1].toLowerCase()] ?? 0);
  const base = 3 * 7 + idxMap['a']; // A3
  return (base - target) / 2;
}

// ===== alto (C clef, line 0 = G4, line 2 = C4) =====
function lineToKeyAlto(line: number): string {
  const s = Math.round(line * 2) / 2;
  const stepsDown = Math.round(s * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 4 - stepsDown, oct = 4; // G4: idx=4
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineAlto(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = +m[3] * 7 + (idxMap[m[1].toLowerCase()] ?? 0);
  const base = 4 * 7 + idxMap['g']; // G4 = 32
  return (base - target) / 2;
}

// ===== tenor (C clef, 第4線 = C4。line 0 = E4（最上線）) =====
function lineToKeyTenor(line: number): string {
  const s = Math.round(line * 2) / 2;
  const stepsDown = Math.round(s * 2);
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 2 - stepsDown, oct = 4; // E4: idx=2
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
function keyToLineTenor(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = +m[3] * 7 + (idxMap[m[1].toLowerCase()] ?? 0);
  const base = 4 * 7 + idxMap['e']; // E4
  return (base - target) / 2;
}

// ===== Public dispatchers =====

export function lineToKey(clef: ClefType, line: number): string {
  if (clef === 'bass') return lineToKeyBass(line);
  if (clef === 'alto') return lineToKeyAlto(line);
  if (clef === 'tenor') return lineToKeyTenor(line);
  return lineToKeyTreble(line);
}

export function keyToLine(clef: ClefType, key: string): number {
  if (clef === 'bass') return keyToLineBass(key);
  if (clef === 'alto') return keyToLineAlto(key);
  if (clef === 'tenor') return keyToLineTenor(key);
  return keyToLineTreble(key);
}

// 休符は「編集データとして保存したい見た目位置」と、
// VexFlow に一時的に渡す既定位置を分けて扱う。
// 後者を残しておくと、複数声部で alignRests を使う既存挙動を壊しにくい。
const DEFAULT_REST_FORMATTER_LINE = 2;
const DEFAULT_REST_DISPLAY_LINE = 2;

export function restKey(clef: ClefType): string {
  return lineToKey(clef, DEFAULT_REST_FORMATTER_LINE);
}

export function defaultRestDisplayKey(clef: ClefType): string {
  return lineToKey(clef, DEFAULT_REST_DISPLAY_LINE);
}

// 2声部が共存する小節では、休符も声部1(上声)/声部2(下声)で重なってしまうため、
// それぞれ五線の中央（DEFAULT_REST_DISPLAY_LINE）から上下にずらして避ける。
// line は数値が小さいほど五線の上（高い位置）になる（lineToKeyTreble 等の実装を参照）。
const VOICE_REST_LINE_SHIFT = 1;

/**
 * 声部数を考慮した休符の描画位置(line)を返す。
 * 声部が1つだけの小節では、従来通り DEFAULT_REST_DISPLAY_LINE のまま
 * （リグレッション防止のためここでは分岐を増やさない）。
 * 声部が2つ以上ある小節では、声部1をやや上寄り、声部2以降をやや下寄りにする。
 */
export function restDisplayLineForVoice(voiceIndex: number, voiceCount: number): number {
  if (voiceCount <= 1) {
    return DEFAULT_REST_DISPLAY_LINE;
  }
  return voiceIndex === 0
    ? DEFAULT_REST_DISPLAY_LINE - VOICE_REST_LINE_SHIFT
    : DEFAULT_REST_DISPLAY_LINE + VOICE_REST_LINE_SHIFT;
}

/**
 * 声部数を考慮した休符の描画キー（VexFlow に渡す keys[0]）を返す。
 * makeVFNote 側で「ユーザーが休符位置をカスタマイズしていない」場合にだけ使われる。
 */
export function restKeyForVoice(clef: ClefType, voiceIndex: number, voiceCount: number): string {
  return lineToKey(clef, restDisplayLineForVoice(voiceIndex, voiceCount));
}
