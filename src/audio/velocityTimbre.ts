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
/** 素通しのときのカットオフ（Hz）。可聴域の上端付近＝従来と同じ音 */
export const VELOCITY_TIMBRE_MAX_CUTOFF_HZ = 16000;
/**
 * ここ以上の velocity は素通し（従来どおりの音）。強弱記号の無い音は 0.5（DEFAULT_DYNAMIC_VELOCITY）、
 * mf は 0.58 で届くので、「記号の無い譜面・mf 以上は 1 音も変えない」を保証する境界。
 * 変わるのは mp（0.45）より下＝弱い側だけ（round1 P1: 中点 4.7kHz で無記号譜面が一律にこもった）
 */
export const VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY = 0.5;
/**
 * ローパスの Q（Web Audio の lowpass では dB 単位）。0 dB＝カットオフ付近に山を作らない。
 * 共鳴を付けると「フィルタっぽい」音になるので付けない
 */
export const VELOCITY_TIMBRE_FILTER_Q = 0;

/**
 * velocity（0〜1）→ ローパスのカットオフ周波数（Hz）。
 * - 素通し境界（0.5）以上: 最大（従来の音）。範囲外・非数も素通し（強弱の情報が無い音を曇らせない）
 * - それ未満: 最小（v=0）〜最大（v=0.5）を対数補間（耳は周波数を対数で感じる）。
 *   pp（0.22）で約 4.1kHz、p（0.35）で約 7.7kHz
 */
export function velocityToCutoffHz(velocity: number): number {
  if (!Number.isFinite(velocity)) return VELOCITY_TIMBRE_MAX_CUTOFF_HZ;
  if (velocity >= VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY) return VELOCITY_TIMBRE_MAX_CUTOFF_HZ;
  const v = Math.max(0, velocity) / VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY;
  const ratio = VELOCITY_TIMBRE_MAX_CUTOFF_HZ / VELOCITY_TIMBRE_MIN_CUTOFF_HZ;
  return VELOCITY_TIMBRE_MIN_CUTOFF_HZ * Math.pow(ratio, v);
}

/** 素通しでよい velocity か（フィルタを作らなくてよい＝ノードを 1 つ節約できる） */
export function isVelocityPassThrough(velocity: number): boolean {
  return !Number.isFinite(velocity) || velocity >= VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY;
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
): BiquadFilterNode | null {
  // 素通しの音にはフィルタを挟まない（音も変わらないし、ノードも増やさない）
  if (isVelocityPassThrough(velocity)) return null;
  if (!context || typeof context.createBiquadFilter !== 'function') return null;
  try {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = velocityToCutoffHz(velocity);
    // 予約再生（未来の startTime）でも同じ値なので、単純に value を置く。
    // setValueAtTime を使わないのは、偽 context（テスト）の AudioParam が持たないことがあるため
    filter.frequency.value = cutoff;
    filter.Q.value = VELOCITY_TIMBRE_FILTER_Q;
    return filter;
  } catch {
    return null;
  }
}
