// src/audio/releaseTail.ts
// 「音符を鳴らし終わったあとに残す余韻（リリースの尻尾）」の長さを決める計算（Issue #525）。
//
// なぜ要るか:
//   実際のピアノは、音価の終わりでプツンと消えるのではなく、ダンパーが降りたあとも
//   短い減衰の尻尾が残る。音価ちょうどで止めると、長い音（2分・全音符）ほど
//   「早く切られた」硬い印象になる（運用者の検聴・2026-08-31）。
//
// ここに置く理由:
//   内蔵音源（SimpleAudioEngine）と SoundFont（SoundFontEngine）の**両方**が同じ尻尾を持つ必要があり、
//   別々に係数を書くと片方だけ調整されて音の印象が食い違う。長さの決め方はこの1か所に集約する。

/** 音を離したあとに残す余韻の最短（秒）。「音色」の余韻スライダーが最小のときの値 */
export const MIN_RELEASE_TAIL_SECONDS = 0.3;
/** 同じく最長（秒）。スライダーが最大のときの値 */
export const MAX_RELEASE_TAIL_SECONDS = 0.6;
/**
 * 短い音符でも最低限は残す長さ（秒）。
 * 16分音符のような短い音に 0.3〜0.6 秒の尻尾を丸ごと付けると、
 * 速いパッセージで前の音の尻尾が積み重なって濁る（仕様案3の「濁りすぎない」対策）。
 * そこで短い音の尻尾は音符自身の長さまでに抑えつつ、この値だけは必ず残して
 * 「プツンと切れる」感じにはしない。
 */
export const SHORT_NOTE_MIN_TAIL_SECONDS = 0.12;

/** 0〜1 の範囲へ丸める（スライダー値が壊れていても計算を壊さないための保険） */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 音を離したあとに残す余韻の長さ（秒）を求める。
 *
 * @param profileRelease 「音色」設定の余韻スライダー（0〜1）。大きいほど長く残る
 * @param noteDurationSeconds その音符を鳴らす長さ（秒）。短い音の尻尾を抑えるために使う
 *
 * 返す値は**音の開始時刻や次の音までの間隔には一切影響しない**。
 * 尻尾は次の音に重なってよい（実ピアノのペダル感）という方針のため、
 * 呼び出し側は「鳴らし終わりの時刻」だけを後ろへ伸ばす。
 */
export function resolveReleaseTailSeconds(profileRelease: number, noteDurationSeconds: number): number {
  const base = MIN_RELEASE_TAIL_SECONDS
    + clamp01(profileRelease) * (MAX_RELEASE_TAIL_SECONDS - MIN_RELEASE_TAIL_SECONDS);
  const duration = Number.isFinite(noteDurationSeconds) ? Math.max(0, noteDurationSeconds) : 0;
  // 音符自身より長い尻尾は付けない（ただし SHORT_NOTE_MIN_TAIL_SECONDS は下回らない）
  return Math.min(base, Math.max(SHORT_NOTE_MIN_TAIL_SECONDS, duration));
}
