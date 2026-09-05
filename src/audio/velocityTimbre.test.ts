// 強弱→音色（velocity → ローパスのカットオフ・Issue #670）の対応表とノード生成。
import { describe, it, expect, vi } from 'vitest';
import {
  velocityToCutoffHz, createVelocityFilter, createVelocityFilterChain, velocityToAttackSeconds, isVelocityPassThrough,
  VELOCITY_TIMBRE_FILTER_STAGES, VELOCITY_TIMBRE_MAX_EXTRA_ATTACK_SEC, effectiveMinCutoffHz, normalizeVelocityTimbreStrength,
  VELOCITY_TIMBRE_MIN_CUTOFF_HZ, VELOCITY_TIMBRE_MAX_CUTOFF_HZ, VELOCITY_TIMBRE_FILTER_Q,
  VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY,
} from './velocityTimbre';

describe('velocityToCutoffHz', () => {
  it('弱い音ほど低い（対数補間）。境界 0.5 以上は素通し＝従来の音', () => {
    expect(velocityToCutoffHz(0)).toBeCloseTo(VELOCITY_TIMBRE_MIN_CUTOFF_HZ, 6);
    expect(velocityToCutoffHz(0.22)).toBeLessThan(velocityToCutoffHz(0.35));
    // 対数補間: 境界の半分（0.25）で最小と最大の幾何平均
    expect(velocityToCutoffHz(VELOCITY_TIMBRE_PASS_THROUGH_VELOCITY / 2))
      .toBeCloseTo(Math.sqrt(VELOCITY_TIMBRE_MIN_CUTOFF_HZ * VELOCITY_TIMBRE_MAX_CUTOFF_HZ), 3);
  });

  it('強弱記号の無い音（0.5）・mf（0.58）・f 以上は 1 音も変えない（round1 P1）', () => {
    expect(velocityToCutoffHz(0.5)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(velocityToCutoffHz(0.58)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(velocityToCutoffHz(0.9)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(velocityToCutoffHz(1)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(isVelocityPassThrough(0.5)).toBe(true);
    expect(isVelocityPassThrough(0.49)).toBe(false);
  });

  it('範囲外・非数は安全側（素通し＝最大）に丸める', () => {
    expect(velocityToCutoffHz(1.5)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(velocityToCutoffHz(-1)).toBeCloseTo(VELOCITY_TIMBRE_MIN_CUTOFF_HZ, 6);
    expect(velocityToCutoffHz(Number.NaN)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
  });
});

describe('createVelocityFilter', () => {
  it('ローパスを 1 つ作り、カットオフと Q を設定する', () => {
    const filter = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn() };
    const context = { createBiquadFilter: vi.fn(() => filter) };
    const created = createVelocityFilter(context as never, 0.3);
    expect(created).toBe(filter);
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBeCloseTo(velocityToCutoffHz(0.3), 6);
    expect(filter.Q.value).toBe(VELOCITY_TIMBRE_FILTER_Q);
  });

  it('素通しの velocity（0.5 以上）ではフィルタを作らない（ノードを増やさない）', () => {
    const context = { createBiquadFilter: vi.fn() };
    expect(createVelocityFilter(context as never, 0.5)).toBeNull();
    expect(createVelocityFilter(context as never, 0.9)).toBeNull();
    expect(context.createBiquadFilter).not.toHaveBeenCalled();
  });

  it('フィルタを作れない context では null（素通しで鳴らす）', () => {
    expect(createVelocityFilter({} as never, 0.5)).toBeNull();
    expect(createVelocityFilter(null, 0.5)).toBeNull();
    const throwing = { createBiquadFilter: () => { throw new Error('x'); } };
    expect(createVelocityFilter(throwing as never, 0.5)).toBeNull();
  });
});

describe('createVelocityFilterChain / velocityToAttackSeconds（#670 段2: もっと柔らかく）', () => {
  const makeContext = (failAt?: number) => {
    let count = 0;
    const filters: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    return {
      filters,
      createBiquadFilter: vi.fn(() => {
        if (failAt !== undefined && count === failAt) throw new Error('boom');
        count++;
        const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        filters.push(f); return f;
      }),
    };
  };

  it('弱い音では段数ぶんのローパスを直列につなぎ、input と output を返す', () => {
    const ctx = makeContext();
    const chain = createVelocityFilterChain(ctx as never, 0.22);
    expect(chain).not.toBeNull();
    expect(chain!.nodes.length).toBe(VELOCITY_TIMBRE_FILTER_STAGES);
    expect(chain!.input).toBe(ctx.filters[0]);
    expect(chain!.output).toBe(ctx.filters[VELOCITY_TIMBRE_FILTER_STAGES - 1]);
    for (let i = 0; i < VELOCITY_TIMBRE_FILTER_STAGES - 1; i++) {
      expect(ctx.filters[i].connect).toHaveBeenCalledWith(ctx.filters[i + 1]);
    }
    // 出口はまだどこにもつながない（呼び出し側がマスターへつなぐ）
    expect(ctx.filters[VELOCITY_TIMBRE_FILTER_STAGES - 1].connect).not.toHaveBeenCalled();
  });

  it('素通しの velocity では null。途中で作れなくなったら作った分を外して null', () => {
    expect(createVelocityFilterChain(makeContext() as never, 0.5)).toBeNull();
    const ctx = makeContext(1);
    expect(createVelocityFilterChain(ctx as never, 0.22)).toBeNull();
    expect(ctx.filters.length).toBe(1);
    expect(ctx.filters[0].disconnect).toHaveBeenCalled();
  });

  it('立ち上がり: 0.5 以上は base のまま、弱いほど長く、v=0 で最大分だけ足す', () => {
    expect(velocityToAttackSeconds(0.5, 0.01)).toBe(0.01);
    expect(velocityToAttackSeconds(0.9, 0.01)).toBe(0.01);
    expect(velocityToAttackSeconds(0.22, 0.01)).toBeGreaterThan(0.01);
    expect(velocityToAttackSeconds(0.22, 0.01)).toBeLessThan(velocityToAttackSeconds(0.1, 0.01));
    expect(velocityToAttackSeconds(0, 0.01)).toBeCloseTo(0.01 + VELOCITY_TIMBRE_MAX_EXTRA_ATTACK_SEC, 6);
  });
});

describe('強さ（velocityTimbreStrength）', () => {
  it('1 で下限 600Hz、0 で最大（効果なし）、0.5 は対数の真ん中（約 3.1kHz）。非数・範囲外は丸める', () => {
    expect(effectiveMinCutoffHz(1)).toBeCloseTo(VELOCITY_TIMBRE_MIN_CUTOFF_HZ, 6);
    expect(effectiveMinCutoffHz(0)).toBeCloseTo(VELOCITY_TIMBRE_MAX_CUTOFF_HZ, 6);
    expect(effectiveMinCutoffHz(0.5)).toBeCloseTo(Math.sqrt(VELOCITY_TIMBRE_MIN_CUTOFF_HZ * VELOCITY_TIMBRE_MAX_CUTOFF_HZ), 3);
    expect(normalizeVelocityTimbreStrength(Number.NaN)).toBe(1);
    expect(normalizeVelocityTimbreStrength(2)).toBe(1);
    expect(normalizeVelocityTimbreStrength(-1)).toBe(0);
  });

  it('弱いほうへの効きが強さで薄まる: カットオフは上がり、立ち上がりの追加は縮む。0.5 以上は変わらない', () => {
    expect(velocityToCutoffHz(0.22, 0.5)).toBeGreaterThan(velocityToCutoffHz(0.22, 1));
    expect(velocityToCutoffHz(0.22, 0)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(velocityToCutoffHz(0.6, 0.3)).toBe(VELOCITY_TIMBRE_MAX_CUTOFF_HZ);
    expect(velocityToAttackSeconds(0, 0.01, 0.5)).toBeCloseTo(0.01 + VELOCITY_TIMBRE_MAX_EXTRA_ATTACK_SEC * 0.5, 6);
    expect(velocityToAttackSeconds(0, 0.01, 0)).toBe(0.01);
  });

  it('強さ 0 ではフィルタの束を作らない', () => {
    const ctx = { createBiquadFilter: vi.fn() };
    expect(createVelocityFilterChain(ctx as never, 0.22, 0)).toBeNull();
    expect(ctx.createBiquadFilter).not.toHaveBeenCalled();
  });
});
