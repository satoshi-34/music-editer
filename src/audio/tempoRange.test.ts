import { describe, expect, it } from 'vitest';
import { MIN_BPM, MAX_BPM, clampBpm, normalizeSavedGlobalBpm, TEMPO_RANGE_MESSAGE } from './tempoRange';

describe('tempoRange', () => {
  it('有効範囲は 30〜240（Grave 〜 Prestissimo）', () => {
    expect(MIN_BPM).toBe(30);
    expect(MAX_BPM).toBe(240);
  });

  it('範囲内の値はそのまま返す', () => {
    expect(clampBpm(56, 120)).toBe(56);
    expect(clampBpm(MIN_BPM, 120)).toBe(MIN_BPM);
    expect(clampBpm(MAX_BPM, 120)).toBe(MAX_BPM);
  });

  it('範囲外の値は端へ寄せる', () => {
    expect(clampBpm(29, 120)).toBe(MIN_BPM);
    expect(clampBpm(10, 120)).toBe(MIN_BPM);
    expect(clampBpm(241, 120)).toBe(MAX_BPM);
    expect(clampBpm(9999, 120)).toBe(MAX_BPM);
  });

  it('数値として扱えない値は fallback を返す（巻き戻し用）', () => {
    expect(clampBpm(NaN, 120)).toBe(120);
    expect(clampBpm(Infinity, 120)).toBe(120);
    expect(clampBpm(-Infinity, 99)).toBe(99);
  });

  describe('normalizeSavedGlobalBpm（作品ごとの全体テンポ・Issue #543）', () => {
    it('保存されている有効な値はそのまま採用する', () => {
      expect(normalizeSavedGlobalBpm(112)).toBe(112);
      expect(normalizeSavedGlobalBpm(54)).toBe(54);
    });

    it('範囲外の値は端へ寄せる（保存データが手書きで壊れていても鳴らせる）', () => {
      expect(normalizeSavedGlobalBpm(1000)).toBe(MAX_BPM);
      expect(normalizeSavedGlobalBpm(1)).toBe(MIN_BPM);
    });

    it('テンポ未保存・壊れた値は undefined（＝アプリ全体設定に従う）', () => {
      // 0 や負値を素通しすると 60 / 0 = Infinity で再生が止まるため、必ず弾く
      expect(normalizeSavedGlobalBpm(undefined)).toBeUndefined();
      expect(normalizeSavedGlobalBpm(0)).toBeUndefined();
      expect(normalizeSavedGlobalBpm(-120)).toBeUndefined();
      expect(normalizeSavedGlobalBpm(NaN)).toBeUndefined();
      expect(normalizeSavedGlobalBpm(Infinity)).toBeUndefined();
      expect(normalizeSavedGlobalBpm('112')).toBeUndefined();
      expect(normalizeSavedGlobalBpm(null)).toBeUndefined();
    });
  });

  it('案内文に有効範囲がそのまま載る', () => {
    expect(TEMPO_RANGE_MESSAGE).toBe('テンポは30〜240の範囲で設定してください');
  });
});
