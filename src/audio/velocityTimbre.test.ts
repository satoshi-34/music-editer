// 強弱→音色（velocity → ローパスのカットオフ・Issue #670）の対応表とノード生成。
import { describe, it, expect, vi } from 'vitest';
import {
  velocityToCutoffHz, createVelocityFilter, isVelocityPassThrough,
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
