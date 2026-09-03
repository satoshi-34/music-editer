// 再生速度（%）の純粋関数テスト（Issue #544）
import { describe, it, expect } from 'vitest';
import {
  MIN_PLAYBACK_SPEED_PERCENT,
  MAX_PLAYBACK_SPEED_PERCENT,
  DEFAULT_PLAYBACK_SPEED_PERCENT,
  MIN_EFFECTIVE_BPM,
  MAX_EFFECTIVE_BPM,
  clampPlaybackSpeedPercent,
  applyPlaybackSpeedToBpm,
  applyPlaybackSpeedToBpms,
  clampEffectiveBpm,
} from './playbackSpeed';

describe('clampPlaybackSpeedPercent', () => {
  it('範囲内はそのまま、範囲外は端へ寄せる', () => {
    expect(clampPlaybackSpeedPercent(75, 100)).toBe(75);
    expect(clampPlaybackSpeedPercent(10, 100)).toBe(MIN_PLAYBACK_SPEED_PERCENT);
    expect(clampPlaybackSpeedPercent(500, 100)).toBe(MAX_PLAYBACK_SPEED_PERCENT);
  });

  it('数値として読めない値では fallback を返す', () => {
    expect(clampPlaybackSpeedPercent(Number.NaN, 80)).toBe(80);
    expect(clampPlaybackSpeedPercent(Number.POSITIVE_INFINITY, 80)).toBe(80);
  });
});

describe('applyPlaybackSpeedToBpm / applyPlaybackSpeedToBpms', () => {
  it('100% では元の値と完全に同一（受入3の回帰）', () => {
    expect(applyPlaybackSpeedToBpm(132, 100)).toBe(132);
    expect(applyPlaybackSpeedToBpms([120, 132, 76], 100)).toEqual([120, 132, 76]);
  });

  it('50% で半分・200% で2倍になる', () => {
    expect(applyPlaybackSpeedToBpm(120, 50)).toBe(60);
    expect(applyPlaybackSpeedToBpm(120, 200)).toBe(240);
  });

  it('全小節へ同じ倍率が掛かるので、標語が作る相対関係は保たれる（受入1）', () => {
    const notated = [120, 132, 76];
    const halved = applyPlaybackSpeedToBpms(notated, 50);

    expect(halved).toEqual([60, 66, 38]);
    // 「1小節あたりの実時間」の比が、速度を変えても崩れないこと
    for (let i = 0; i < notated.length; i++) {
      expect(60 / halved[i]).toBeCloseTo((60 / notated[i]) * 2, 10);
    }
  });

  it('譜面に書けるテンポの上限（240）を超えても丸めない', () => {
    // 丸めてしまうと「速度を上げても速い曲だけ速くならない」ことになる
    expect(applyPlaybackSpeedToBpm(200, 200)).toBe(400);
  });

  it('範囲外の速度は端へ寄せてから掛ける', () => {
    expect(applyPlaybackSpeedToBpm(120, 1000)).toBe(120 * (MAX_PLAYBACK_SPEED_PERCENT / 100));
  });
});

describe('clampEffectiveBpm', () => {
  it('再生速度を掛けたあとの実効テンポをそのまま通す', () => {
    // 譜面の範囲（30〜240）で丸めると、タイの実時間だけ倍率に追従しなくなる
    expect(clampEffectiveBpm(400, 120)).toBe(400);
    expect(clampEffectiveBpm(20, 120)).toBe(20);
  });

  it('倍率込みの範囲を外れる値と壊れた値は弾く', () => {
    expect(clampEffectiveBpm(0, 120)).toBe(MIN_EFFECTIVE_BPM);
    expect(clampEffectiveBpm(100000, 120)).toBe(MAX_EFFECTIVE_BPM);
    expect(clampEffectiveBpm(Number.NaN, 120)).toBe(120);
  });
});
