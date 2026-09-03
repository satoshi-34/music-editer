// Issue #596: dev チューニングの契約テスト。
// 一番大事なのは「上書きが無ければ既定値そのまま＝既存挙動ゼロ差分」。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEV_TUNING_ENTRIES,
  DEV_TUNING_STORAGE_KEY,
  devTuned,
  formatDevTuningForCode,
  resetAllDevTuning,
  setDevTuningOverride,
} from './devTuning';

/** テストが localStorage を直接書いたあと、モジュール内キャッシュを捨てさせる */
function resetCacheForTest() {
  window.dispatchEvent(new StorageEvent('storage', { key: DEV_TUNING_STORAGE_KEY }));
}
import {
  engravingMinimumWidthFromIdeal,
  VEXFLOW_IDEAL_WIDTH_COMPRESSION,
} from './measureLayoutUtils';

beforeEach(() => {
  resetAllDevTuning();
});

describe('devTuned', () => {
  it('上書きが無ければ既定値をそのまま返す（既存挙動ゼロ差分）', () => {
    for (const entry of DEV_TUNING_ENTRIES) {
      expect(devTuned(entry.key, entry.defaultValue)).toBe(entry.defaultValue);
    }
    // 実際の読み出し点（圧縮率）も既定どおり
    expect(engravingMinimumWidthFromIdeal(100)).toBeCloseTo(100 * VEXFLOW_IDEAL_WIDTH_COMPRESSION, 10);
  });

  it('上書きするとレジストリの範囲へクランプして効き、null で既定へ戻る', () => {
    setDevTuningOverride('layout.compression', 0.8);
    expect(devTuned('layout.compression', VEXFLOW_IDEAL_WIDTH_COMPRESSION)).toBe(0.8);
    expect(engravingMinimumWidthFromIdeal(100)).toBeCloseTo(80, 10);

    // 範囲外は**保存の瞬間に**端へ（0.4〜1.0）。表示・コピー値と実効値がズレない
    setDevTuningOverride('layout.compression', 5);
    expect(devTuned('layout.compression', VEXFLOW_IDEAL_WIDTH_COMPRESSION)).toBe(1);
    expect(JSON.parse(window.localStorage.getItem(DEV_TUNING_STORAGE_KEY) ?? '{}')['layout.compression']).toBe(1);

    setDevTuningOverride('layout.compression', null);
    expect(devTuned('layout.compression', VEXFLOW_IDEAL_WIDTH_COMPRESSION)).toBe(VEXFLOW_IDEAL_WIDTH_COMPRESSION);
  });

  it('未登録キー・壊れた保存値は既定値に落ち、全リセットでキーごと消える', () => {
    window.localStorage.setItem(DEV_TUNING_STORAGE_KEY, '{"layout.compression":"abc","unknown":1}');
    resetCacheForTest();
    expect(devTuned('layout.compression', 0.64)).toBe(0.64);
    expect(devTuned('unknown', 7)).toBe(7);
    window.localStorage.setItem(DEV_TUNING_STORAGE_KEY, 'not-json');
    resetCacheForTest();
    expect(devTuned('layout.compression', 0.64)).toBe(0.64);

    // 旧形式（読込クランプ前）の範囲外値が localStorage に残っていても、読込時に範囲へ寄る
    window.localStorage.setItem(DEV_TUNING_STORAGE_KEY, '{"layout.compression":5}');
    resetCacheForTest();
    expect(devTuned('layout.compression', 0.64)).toBe(1);

    setDevTuningOverride('layout.compression', 0.7);
    resetAllDevTuning();
    expect(window.localStorage.getItem(DEV_TUNING_STORAGE_KEY)).toBeNull();
    expect(devTuned('layout.compression', 0.64)).toBe(0.64);
  });

  it('レジストリの定義が妥当（既定値が範囲内・キー重複なし）', () => {
    const keys = new Set<string>();
    for (const e of DEV_TUNING_ENTRIES) {
      expect(e.defaultValue).toBeGreaterThanOrEqual(e.min);
      expect(e.defaultValue).toBeLessThanOrEqual(e.max);
      expect(keys.has(e.key)).toBe(false);
      keys.add(e.key);
    }
  });

  it('コード形式のコピーは「既定と違う上書き」だけを定数行にする', () => {
    expect(formatDevTuningForCode()).toBe('(上書きなし)');
    setDevTuningOverride('layout.compression', 0.7);
    setDevTuningOverride('layout.measureSidePadding', 18); // 既定と同じ → 出さない
    const code = formatDevTuningForCode();
    expect(code).toBe('export const VEXFLOW_IDEAL_WIDTH_COMPRESSION = 0.7;');
  });
});
