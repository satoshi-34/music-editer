// src/audio/velocityTimbre.ts
// 強弱（velocity）を音色にも効かせる（Issue #670・ユーザーのフィードバック「ベロシティ＝音の大小だけ
// でなく、強くて鋭い／弱くて柔らかい」）。
//
// ピアノは強く叩くほど高い成分が増えて硬く明るい音になり、弱く弾くと丸く柔らかい音になる。
// 従来は velocity をゲイン（音量）にしか掛けていなかったので、pp でも「小さいが硬い音」のままだった。
// 段1（本ファイル）は音源に依存しない方法: 音ごとにローパスフィルタを 1 つ挟み、カットオフを
// velocity で動かす（弱いほど高域を削る）。段2（velocity レイヤーの別録音）は音源側の調査後。
//
// 純関数（velocityToCutoffHz）と Web Audio のノード生成（createVelocityFilter）を分け、
// 対応表は前者で単体テストできるようにしてある。

/**
 * velocity が最小のときのカットオフ（Hz）。
 * 初版 1400（pp ≈ 4.1kHz）は運用者の検聴（Op.28-20 の pp・2026-09-05）で「柔らかさが足りない」→ 600 に下げた
 * （pp 0.22 ≈ 2.5kHz、p 0.35 ≈ 6kHz）。さらに下げると pp がこもって輪郭が消えるので、次に強めるなら段数（傾き）で
 */
export const VELOCITY_TIMBRE_MIN_CUTOFF_HZ = 600;
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
 * ローパスの段数。1 段（12dB/oct）では「まだ柔らかさが足りない」（ユーザー 2026-09-06）ので 2 段（24dB/oct）。
 * カットオフは同じで、そこから上の落ち方が急になる（下限をさらに下げるとこもって輪郭が消えるので段数で強める）
 */
export const VELOCITY_TIMBRE_FILTER_STAGES = 2;
/**
 * 弱い音の立ち上がりに足す時間（秒・velocity 0 のとき）。弱い音は音量と高音だけでなく
 * 「鍵盤を押す速さ」も遅いので、鳴り始めをわずかに鈍らせる。0.5 以上は足さない
 */
export const VELOCITY_TIMBRE_MAX_EXTRA_ATTACK_SEC = 0.035;

/**
 * velocity（0〜1）→ ローパスのカットオフ周波数（Hz）。
 * - 素通し境界（0.5）以上: 最大（従来の音）。範囲外・非数も素通し（強弱の情報が無い音を曇らせない）
 * - それ未満: 最小（v=0）〜最大（v=0.5）を対数補間（耳は周波数を対数で感じる）。
 *   pp（0.22）で約 2.5kHz、p（0.35）で約 6kHz
 */
export function velocityToCutoffHz(velocity: number, strength: number = 1): number {
  if (!Number.isFinite(velocity)) return VELOCITY_TIMBRE_MAX_CUTOFF_HZ;
  if (velocity >= VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY) return VELOCITY_TIMBRE_MAX_CUTOFF_HZ;
  const v = Math.max(0, velocity) / VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY;
  const minCutoff = effectiveMinCutoffHz(strength);
  const ratio = VELOCITY_TIMBRE_MAX_CUTOFF_HZ / minCutoff;
  return minCutoff * Math.pow(ratio, v);
}

/** 強さ（0〜1）を 0〜1 に丸める。非数は既定の 1 */
export function normalizeVelocityTimbreStrength(strength: number | undefined): number {
  if (typeof strength !== 'number' || !Number.isFinite(strength)) return 1;
  return Math.min(1, Math.max(0, strength));
}

/**
 * 強さ → 実効の下限カットオフ（Hz）。1 で 600Hz、0 で最大（＝効果なし）、間は対数で補間
 * （0.5 で約 3.1kHz）。耳は周波数を対数で感じるので、スライダーの真ん中が「半分の柔らかさ」になる
 */
export function effectiveMinCutoffHz(strength: number): number {
  const k = normalizeVelocityTimbreStrength(strength);
  return VELOCITY_TIMBRE_MAX_CUTOFF_HZ * Math.pow(VELOCITY_TIMBRE_MIN_CUTOFF_HZ / VELOCITY_TIMBRE_MAX_CUTOFF_HZ, k);
}

/**
 * velocity（0〜1）→ 立ち上がり時間（秒）。素通し境界以上は baseAttack のまま。
 * それ未満は弱いほど長く（線形）: pp 0.22 で約 +0.02s、v=0 で +0.035s
 */
export function velocityToAttackSeconds(velocity: number, baseAttack: number, strength: number = 1): number {
  if (isVelocityPassThrough(velocity)) return baseAttack;
  const softness = 1 - Math.max(0, velocity) / VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY;
  return baseAttack + softness * VELOCITY_TIMBRE_MAX_EXTRA_ATTACK_SEC * normalizeVelocityTimbreStrength(strength);
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
/** 直列につないだローパスの束。音ノード → input、output → マスターにつなぐ */
export interface VelocityFilterChain {
  input: BiquadFilterNode;
  output: BiquadFilterNode;
  nodes: BiquadFilterNode[];
}

/**
 * 1 音ぶんのローパスを VELOCITY_TIMBRE_FILTER_STAGES 段作って直列につなぐ。
 * 作れない context・素通しの velocity では null（呼び出し側は従来どおり直結する）。
 * 途中で失敗したら作った分を外して null（無音にしない）
 */
export function createVelocityFilterChain(
  context: Partial<FilterCapableContext> | null | undefined,
  velocity: number,
  strength: number = 1,
): VelocityFilterChain | null {
  // 強さ 0 は効果なし＝フィルタを作らない
  if (isVelocityPassThrough(velocity) || normalizeVelocityTimbreStrength(strength) <= 0) return null;
  const nodes: BiquadFilterNode[] = [];
  try {
    for (let i = 0; i < VELOCITY_TIMBRE_FILTER_STAGES; i++) {
      const filter = createVelocityFilter(context, velocity, strength);
      if (!filter) throw new Error('filter unavailable');
      if (nodes.length > 0) nodes[nodes.length - 1].connect(filter);
      nodes.push(filter);
    }
    return { input: nodes[0], output: nodes[nodes.length - 1], nodes };
  } catch {
    for (const n of nodes) { try { n.disconnect(); } catch { /* 偽ノード */ } }
    return null;
  }
}

export function createVelocityFilter(
  context: Partial<FilterCapableContext> | null | undefined,
  velocity: number,
  strength: number = 1,
): BiquadFilterNode | null {
  // 素通しの音にはフィルタを挟まない（音も変わらないし、ノードも増やさない）
  if (isVelocityPassThrough(velocity)) return null;
  if (!context || typeof context.createBiquadFilter !== 'function') return null;
  try {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const cutoff = velocityToCutoffHz(velocity, strength);
    // 予約再生（未来の startTime）でも同じ値なので、単純に value を置く。
    // setValueAtTime を使わないのは、偽 context（テスト）の AudioParam が持たないことがあるため
    filter.frequency.value = cutoff;
    filter.Q.value = VELOCITY_TIMBRE_FILTER_Q;
    return filter;
  } catch {
    return null;
  }
}
