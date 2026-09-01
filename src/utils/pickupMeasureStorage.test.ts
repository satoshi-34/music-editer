// 弱起（アウフタクト）の保存形式テスト（Issue #473 段1）。
// 設計メモ .claude/specs/pickup-measure/design.md §5「段1」の受入テスト 9〜11 に対応する。
// ここで固定したいのは:
//   1. 弱起なしの作品では項目自体を書き出さない＝既存の保存データと差分が出ない
//   2. 弱起ありの作品は保存 → 読み直しでそのまま戻る
//   3. 壊れた値・拍子ぶん以上の値でも読み込みを止めず、「弱起なし」へ倒す
import { describe, it, expect, beforeEach } from 'vitest';
import { createSavedScoreData, loadScoreData, saveScoreData } from './storage';
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
const MEASURE: MeasureData = {
  events: [{ dur: '4', isRest: false, keys: ['c/5'] }],
  voices: [{ id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/5'] }] }],
};
const PARTS: PartData[] = [{ partId: 'melody', clef: 'treble', measures: [MEASURE] }];

function create(pickupBeats?: number, timeSignature: [number, number] = [4, 4]) {
  return createSavedScoreData(
    METADATA, PARTS, 1, 1, 'single', 'C', timeSignature,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, pickupBeats,
  );
}

describe('弱起（アウフタクト）の保存（Issue #473）', () => {
  beforeEach(() => localStorageMock.clear());

  it('渡さなければ項目自体を持たない（旧データ・既存の呼び出しと差分ゼロ）', () => {
    const data = create();
    expect(data.pickupBeats).toBeUndefined();
    // JSON にも現れない（undefined は JSON.stringify で落ちる）
    expect(JSON.stringify(data)).not.toContain('pickupBeats');
  });

  it('弱起の拍数は保存され、読み直してもそのまま戻る', () => {
    const data = create(1);
    expect(data.pickupBeats).toBe(1);

    expect(saveScoreData(data).success).toBe(true);
    expect(loadScoreData().data?.pickupBeats).toBe(1);
  });

  it('拍子ぶん以上の値は弱起ではないので落とす', () => {
    expect(create(4).pickupBeats).toBeUndefined();
    // 3/8 は 1.5 拍（4分音符=1拍換算）
    expect(create(1.5, [3, 8]).pickupBeats).toBeUndefined();
    expect(create(0.5, [3, 8]).pickupBeats).toBe(0.5);
  });

  it('壊れた保存データ（手編集された JSON）を読んでも止まらず、弱起なしへ倒れる', () => {
    const broken = { ...create(1), pickupBeats: 99 };
    expect(saveScoreData(broken).success).toBe(true);
    expect(loadScoreData().data?.pickupBeats).toBeUndefined();
  });

  it('弱起の項目を持たない旧データも従来どおり読める', () => {
    const legacy = create();
    expect(saveScoreData(legacy).success).toBe(true);
    const restored = loadScoreData();
    expect(restored.success).toBe(true);
    expect(restored.data?.pickupBeats).toBeUndefined();
  });
});
