// 弱起（アウフタクト）の保存形式テスト（Issue #473 段1）。
// 設計メモ .claude/specs/anacrusis-pickup-measure/design.md §2-3・§4「段1」に対応する。
// ここで固定したいのは:
//   1. 弱起なしの作品では項目自体を書き出さない＝既存の保存データと差分が出ない
//   2. 弱起（MeasureData.pickupBeats）ありの作品は保存 → 読み直しでそのまま戻る
//   3. 不変条件1（正の有限・その小節の拍子未満）を検証の境界で弾く
import { describe, it, expect, beforeEach } from 'vitest';
import { createSavedScoreData, loadScoreData, saveScoreData, validateSavedScoreData } from './storage';
import type { MeasureData, PartData } from '../types/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const METADATA = { title: '弱起テスト', subtitle: '', lyricist: '', composer: '', arranger: '' };
const quarter = { dur: '4' as const, isRest: false, keys: ['c/5'] };

function build(measures: MeasureData[], timeSignature: [number, number] = [4, 4]) {
  const parts: PartData[] = [{ partId: 'melody', clef: 'treble', measures }];
  return createSavedScoreData(METADATA, parts, 1, 2, 'single', 'C', timeSignature);
}

describe('弱起（アウフタクト）の保存（Issue #473）', () => {
  beforeEach(() => localStorageMock.clear());

  it('弱起の指定が無ければ項目自体を持たない（旧データと差分ゼロ）', () => {
    const data = build([{ events: [quarter] }]);
    expect(JSON.stringify(data)).not.toContain('pickupBeats');
  });

  it('弱起の拍数は保存され、読み直してもそのまま戻る', () => {
    const data = build([{ events: [quarter], pickupBeats: 1 }, { events: [quarter] }]);
    expect(saveScoreData(data).success).toBe(true);
    const restored = loadScoreData();
    expect(restored.success).toBe(true);
    expect(restored.data?.parts[0].measures[0].pickupBeats).toBe(1);
    expect(restored.data?.parts[0].measures[1].pickupBeats).toBeUndefined();
  });

  it('曲中の小節に付いた弱起も保存・復元できる', () => {
    const data = build([{ events: [quarter] }, { events: [quarter], pickupBeats: 2 }]);
    expect(saveScoreData(data).success).toBe(true);
    expect(loadScoreData().data?.parts[0].measures[1].pickupBeats).toBe(2);
  });

  it('0・負数・数値でない値は無効なデータとして弾く（不変条件1）', () => {
    for (const invalid of [0, -1, '1', NaN]) {
      const broken = build([{ events: [quarter], pickupBeats: invalid as number }]);
      expect(validateSavedScoreData(broken)).toBe(false);
    }
  });

  it('その小節で有効な拍子ぶん以上の値も弾く（不完全小節ではないため）', () => {
    expect(validateSavedScoreData(build([{ events: [quarter], pickupBeats: 4 }]))).toBe(false);
    // 3/8 は 1.5 拍
    expect(validateSavedScoreData(build([{ events: [quarter], pickupBeats: 1.5 }], [3, 8]))).toBe(false);
    expect(validateSavedScoreData(build([{ events: [quarter], pickupBeats: 0.5 }], [3, 8]))).toBe(true);
  });

  it('途中拍子変更のある小節は、その小節の拍子で判定する', () => {
    // 2小節目から 3/4（3拍）なので、2.5 拍の弱起は成り立つ
    const ok = build([{ events: [quarter] }, { events: [quarter], timeSignature: [3, 4], pickupBeats: 2.5 }]);
    expect(validateSavedScoreData(ok)).toBe(true);
    const ng = build([{ events: [quarter] }, { events: [quarter], timeSignature: [3, 4], pickupBeats: 3 }]);
    expect(validateSavedScoreData(ng)).toBe(false);
  });

  it('弱起の項目を持たない旧データも従来どおり読める（後方互換）', () => {
    const legacy = build([{ events: [quarter] }, { events: [quarter] }]);
    expect(saveScoreData(legacy).success).toBe(true);
    const restored = loadScoreData();
    expect(restored.success).toBe(true);
    expect(restored.data?.parts[0].measures[0].pickupBeats).toBeUndefined();
  });

  describe('境界での正規化（round3 P1-2 / P2-2: 弾かずに直す）', () => {
    it('拍子ぶん以上の pickupBeats は保存時に落とされ、保存は成功する（自動保存が止まらない）', () => {
      const data = createSavedScoreData(
        { title: 't', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [{ partId: 'melody', clef: 'treble', measures: [
          { events: [], pickupBeats: 4 } as never,   // 4/4 で 4 拍＝不完全小節ではない
          { events: [] },
        ] }],
        1, 1, 'single'
      );
      const saved = saveScoreData(data);
      expect(saved.success).toBe(true);
      const loaded = loadScoreData();
      expect(loaded.success).toBe(true);
      expect((loaded.data!.parts[0].measures[0] as { pickupBeats?: number }).pickupBeats).toBeUndefined();
    });

    it('パート間で食い違う pickupBeats はパート0の値へそろえて保存する（不変条件2）', () => {
      const data = createSavedScoreData(
        { title: 't', subtitle: '', lyricist: '', composer: '', arranger: '' },
        [
          { partId: 'right-hand', clef: 'treble', measures: [{ events: [], pickupBeats: 1 } as never, { events: [] }] },
          { partId: 'left-hand', clef: 'bass', measures: [{ events: [] }, { events: [], pickupBeats: 2 } as never] },
        ],
        1, 1, 'piano'
      );
      expect(saveScoreData(data).success).toBe(true);
      const loaded = loadScoreData();
      expect(loaded.success).toBe(true);
      const m = (i: number, j: number) => (loaded.data!.parts[i].measures[j] as { pickupBeats?: number }).pickupBeats;
      expect([m(0, 0), m(1, 0)]).toEqual([1, 1]);
      expect([m(0, 1), m(1, 1)]).toEqual([undefined, undefined]);
    });
  });
});
