// リリースの尻尾（Issue #525）の長さ計算のテスト。
// 「余韻スライダーで長さが変わる」「短い音符では濁らないよう抑える」の2点を固定する。
import { describe, it, expect } from 'vitest';
import {
  resolveReleaseTailSeconds,
  MIN_RELEASE_TAIL_SECONDS,
  MAX_RELEASE_TAIL_SECONDS,
  SHORT_NOTE_MIN_TAIL_SECONDS,
} from './releaseTail';

describe('resolveReleaseTailSeconds（Issue #525）', () => {
  it('余韻スライダーが小さいほど短く、大きいほど長い（0〜1 で最短〜最長）', () => {
    const whole = 4;  // 全音符（BPM60 の 4/4）
    expect(resolveReleaseTailSeconds(0, whole)).toBeCloseTo(MIN_RELEASE_TAIL_SECONDS, 5);
    expect(resolveReleaseTailSeconds(1, whole)).toBeCloseTo(MAX_RELEASE_TAIL_SECONDS, 5);
    expect(resolveReleaseTailSeconds(0.5, whole)).toBeCloseTo(0.45, 5);
    expect(resolveReleaseTailSeconds(0.25, whole))
      .toBeLessThan(resolveReleaseTailSeconds(0.75, whole));
  });

  it('短い音符の尻尾は音符自身の長さまでに抑える（速いパッセージが濁らないように）', () => {
    // 16分音符（BPM120 で 0.125秒）。0.45秒の尻尾をそのまま付けると次の音に何重にも重なる
    expect(resolveReleaseTailSeconds(0.5, 0.125)).toBeCloseTo(0.125, 5);
    // 0.2秒の音なら 0.2秒まで
    expect(resolveReleaseTailSeconds(0.5, 0.2)).toBeCloseTo(0.2, 5);
    // ごく短い音（32分音符など）でも、プツンと切れないだけの尻尾は必ず残す
    expect(resolveReleaseTailSeconds(0.5, 0.06)).toBeCloseTo(SHORT_NOTE_MIN_TAIL_SECONDS, 5);
    // 長い音は上限どおり
    expect(resolveReleaseTailSeconds(0.5, 2)).toBeCloseTo(0.45, 5);
  });

  it('スライダーや音価が壊れた値でも安全な長さを返す', () => {
    expect(resolveReleaseTailSeconds(Number.NaN, 4)).toBeCloseTo(MIN_RELEASE_TAIL_SECONDS, 5);
    expect(resolveReleaseTailSeconds(5, 4)).toBeCloseTo(MAX_RELEASE_TAIL_SECONDS, 5);
    expect(resolveReleaseTailSeconds(0.5, Number.NaN)).toBeCloseTo(SHORT_NOTE_MIN_TAIL_SECONDS, 5);
    expect(resolveReleaseTailSeconds(0.5, -1)).toBeCloseTo(SHORT_NOTE_MIN_TAIL_SECONDS, 5);
  });
});
