// src/audio/velocityTimbre.ts
// 強弱（velocity）を音色にも効かせる（Issue #670・弟のフィードバック「ベロシティ＝音の大小だけ
// でなく、強くて鋭い／弱くて柔らかい」）。
//
// ピアノは強く叩くほど高い成分が増えて硬く明るい音になり、弱く弾くと丸く柔らかい音になる。
// 従来は velocity をゲイン（音量）にしか掛けていなかったので、pp でも「小さいが硬い音」のままだった。
// 段1（本ファイル）は音源に依存しない方法: 音ごとにローパスフィルタを 1 つ挟み、カットオフを
// velocity で動かす（弱いほど高域を削る）。段2（velocity レイヤーの別録音）は音源側の調査後。
//
// 純関数（velocityToCutoffHz）と Web Audio のノード生成（createVelocityFilter）を分け、
// 対応表は前者で単体テストできるようにしてある。

/** velocity が最小のときのカットオフ（Hz）。pp を「柔らかいが曇りすぎない」音にする値 */
export const VELOCITY_TIMBRE_MIN_CUTOFF_HZ = 1400;
/** velocity が最大のときのカットオフ（Hz）。ほぼ素通し（可聴域の上端付近） */
export const VELOCITY_TIMBRE_MAX_CUTOFF_HZ = 16000;
/** フィルタの Q。共鳴を作らない（0.7 ≒ バターワース） */
export const VELOCITY_TIMBRE_FILTER_Q = 0.7;

/**
 * velocity（0〜1）→ ローパスのカットオフ周波数（Hz）。
 * 耳は周波数を対数で感じるので、最小〜最大を対数補間する（0.5 で約 4.7kHz）。
 * 範囲外・非数は安全側（最大＝素通し）に丸める: 強弱の情報が無い音を勝手に曇らせない
 */
export function velocityToCutoffHz(velocity: number): number {
  if (!Number.isFinite(velocity)) return VELOCITY_TIMBRE_MAX_CUTOFF_HZ;
  const v = Math.min(1, Math.max(0, velocity));
  const ratio = VELOCITY_TIMBRE_MAX_CUTOFF_HZ / VELOCITY_TIMBRE_MIN_CUTOFF_HZ;
  return VELOCITY_TIMBRE_MIN_CUTOFF_HZ * Math.pow(ratio, v);
}

/** BiquadFilterNode を作れる最小限の AudioContext の形（テストの偽 context でも判定できるように） */
export type FilterCapableContext = Pick<BaseAudioContext, 'createBiquadFilter'>;

/**
 * 1 音ぶんのローパスフィルタを作る。context がフィルタを作れない（古い偽 context など）ときは null。
 * ノードは音ごとに 1 つだけ（#622 の教訓: ノードの大量生成は再生を途切れさせる）。
 */
export function createVelocityFilter(
  context: Partial<FilterCapableContext> | null | undefined,
  velocity: number,
  startTime?: number,
): BiquadFilterNode | null {
  if (!context || typeof context.createBiquadFilter !== 'function') return null;
  try {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = velocityToCutoffHz(velocity);
    // 予約再生（未来の startTime）でも同じ値なので、単純に value を置く。
    // setValueAtTime を使わないのは、偽 context（テスト）の AudioParam が持たないことがあるため
    filter.frequency.value = cutoff;
    filter.Q.value = VELOCITY_TIMBRE_FILTER_Q;
    void startTime;
    return filter;
  } catch {
    return null;
  }
}
