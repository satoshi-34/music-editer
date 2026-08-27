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
  const m = key.match(/^([a-g])(##|bb|[#b])?[/ ]([0-9]+)$/i); if (!m) return 2;
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
  const m = key.match(/^([a-g])(##|bb|[#b])?[/ ]([0-9]+)$/i); if (!m) return 2;
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
  const m = key.match(/^([a-g])(##|bb|[#b])?[/ ]([0-9]+)$/i); if (!m) return 2;
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
  const m = key.match(/^([a-g])(##|bb|[#b])?[/ ]([0-9]+)$/i); if (!m) return 2;
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

// 全休符は標準の浄書では「第4線からぶら下げる」位置になり、2分休符以下の
// 「五線中央に置く」位置とは異なる（SMuFLの休符グリフはこの前提で設計されている）。
const WHOLE_REST_DISPLAY_LINE = 1;

export function wholeRestDisplayKey(clef: ClefType): string {
  return lineToKey(clef, WHOLE_REST_DISPLAY_LINE);
}

/**
 * duration に応じた単声部の既定休符位置を返す。
 * 全休符（duration === '1'）だけ標準位置が異なるため、ここで振り分ける。
 */
export function defaultRestDisplayKeyForDuration(clef: ClefType, duration: string): string {
  return duration === '1' ? wholeRestDisplayKey(clef) : defaultRestDisplayKey(clef);
}

// ===== 保存済み休符データの自己修復（Issue #56） =====
//
// 「音価によらない旧既定位置」で保存された休符は、再読込時に音価に応じた
// 標準位置へ引き上げたい（ユーザーが手動でカスタマイズした休符は温存する）。
// この判定に使う「歴代の既定位置」の集合は、git 履歴を実際に確認して決めている
// （PR #15 / #16 / #54 および初出の e7f171d コミットまで遡って確認済み）。
//
// 確認できた事実:
// ・単声部の新規休符・保存データの既定値として実際にハードコードされていたのは
//   「五線中央（line 2）」だけで、この値は e7f171d（ピアノ大譜表追加時に bass 記号の
//   既定値 'd/3' が最初に登場）から PR #54（8137c46）で音価別振り分けが入る直前まで
//   一貫していた。PR #15/#16 の変更は「保存キーの line 値」自体を動かしたものではなく、
//   VexFlow 側の centerAlignment/Formatter 設定を調整して見た目（グリフの下端位置）を
//   変えたもの（コミットログ「休符の下端が五線の第二線に重なるよう修正」参照）。
// ・897cb79（NoteEvent.keys[] 化・和音対応）～ 1f02fd3（PR #15）の間だけ、新規休符の
//   挿入がクリックした高さをそのまま保存する実装になっていた。この期間のキーは
//   ユーザーの実際のクリック位置に依存する不定値であり、「既定値」として一意に
//   特定できる固定キーが存在しない。したがって自動判定の対象には含めていない
//   （この期間の休符は、下記の手動リセット操作でのみ標準位置へ戻せる）。
const LEGACY_DEFAULT_REST_DISPLAY_LINES: readonly number[] = [DEFAULT_REST_DISPLAY_LINE];

/**
 * 保存された休符キーが「歴代の既定位置」のいずれかと一致するかを判定する。
 * キーが無い（undefined/空文字）場合も、既定値扱いとして true を返す
 * （makeVFNote 側の従来のフォールバック挙動を踏襲）。
 */
export function isLegacyDefaultRestKey(clef: ClefType, key: string | undefined): boolean {
  if (!key) return true;
  const line = keyToLine(clef, key);
  return LEGACY_DEFAULT_REST_DISPLAY_LINES.some((legacyLine) => Math.abs(line - legacyLine) < 1e-6);
}

/**
 * 保存された休符キーを描画用に解決する。
 * 歴代の既定位置（isLegacyDefaultRestKey）に一致するキーだけ、音価に応じた
 * 標準位置（全休符=第4線、2分休符以下=五線中央）へ引き上げる。
 * 一致しないキー（ユーザーが手動でカスタマイズした休符）はそのまま返す。
 */
export function resolveLegacyRestDisplayKey(
  clef: ClefType,
  duration: string,
  storedKey: string | undefined
): string {
  return isLegacyDefaultRestKey(clef, storedKey)
    ? defaultRestDisplayKeyForDuration(clef, duration)
    : (storedKey as string);
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

/**
 * 「この休符が本来置かれるべき標準位置」を1か所で決める関数（Issue #227）。
 *
 * 休符の標準位置は次の2系統に分かれる:
 * ・2声部が共存する小節 … 声部1=やや上/声部2=やや下（重なりを避けるため。音価は見ない）
 * ・単声部の小節 … 音価に応じた浄書位置（全休符だけ第4線ぶら下げ、それ以外は五線中央）
 *
 * 以前はこの振り分けが「拍を埋める詰め物休符」と「0キーによる位置リセット」で
 * 別々に書かれており、0キー側だけ声部を見ていなかった（＝声部2の休符を 0 で戻すと
 * 声部1の高さへ行ってしまう）。同じ判断を二重に持たないよう、両方からこの関数を呼ぶ。
 */
export function standardRestDisplayKey(
  clef: ClefType,
  duration: string,
  voiceIndex: number,
  voiceCount: number
): string {
  return voiceCount > 1
    ? restKeyForVoice(clef, voiceIndex, voiceCount)
    : defaultRestDisplayKeyForDuration(clef, duration);
}
