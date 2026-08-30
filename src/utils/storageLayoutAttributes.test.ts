// 作品の属性としてのレイアウト（音符の大きさ・ページ余白）の保存形式テスト（Issue #477）。
//
// MusicXML の <defaults> から引き継いだ値は「表示設定」ではなく作品の属性として保存する
// （#495 の用紙サイズと同じ原則）。ここで固定したいのは:
//   1. 既定値のままの作品では項目自体を書き出さない＝既存の保存データと差分が出ない
//   2. 既定と違う値だけを保存し、読み直しでそのまま戻る
//   3. 壊れた値・範囲外の値でも読み込みを止めず、スライダーの範囲へ丸める
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

const METADATA = { title: 'レイアウト属性', subtitle: '', lyricist: '', composer: '', arranger: '' };
const MEASURE: MeasureData = {
  events: [{ dur: '1', isRest: false, keys: ['c/5'] }],
  voices: [{ id: 'voice-1', events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }],
};
const PARTS: PartData[] = [{ partId: 'melody', clef: 'treble', measures: [MEASURE] }];

function create(notationSizeMultiplier?: number, pageMargins?: { sideMm: number; topMm: number; bottomMm: number }) {
  return createSavedScoreData(
    METADATA, PARTS, 1, 1, 'single', 'C', [4, 4],
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    notationSizeMultiplier, pageMargins,
  );
}

describe('作品の属性としてのレイアウト（Issue #477）', () => {
  beforeEach(() => localStorageMock.clear());

  it('渡さなければ項目自体を持たない（旧データ・既存の呼び出しと差分ゼロ）', () => {
    const data = create();
    expect(data.notationSizeMultiplier).toBeUndefined();
    expect(data.pageMargins).toBeUndefined();
  });

  it('工場出荷既定値（単旋律は150%・余白14/14/12mm）と同じなら書き出さない', () => {
    const data = create(1.5, { sideMm: 14, topMm: 14, bottomMm: 12 });
    expect(data.notationSizeMultiplier).toBeUndefined();
    expect(data.pageMargins).toBeUndefined();
  });

  it('既定と違う値は作品の属性として保存し、読み直しでそのまま戻る', () => {
    const data = create(1.2, { sideMm: 12, topMm: 16, bottomMm: 16 });
    expect(data.notationSizeMultiplier).toBe(1.2);
    expect(data.pageMargins).toEqual({ sideMm: 12, topMm: 16, bottomMm: 16 });

    expect(saveScoreData(data).success).toBe(true);
    const restored = loadScoreData();
    expect(restored.data?.notationSizeMultiplier).toBe(1.2);
    expect(restored.data?.pageMargins).toEqual({ sideMm: 12, topMm: 16, bottomMm: 16 });
  });

  it('範囲外の値はスライダーの範囲へクランプして保存する', () => {
    const data = create(9, { sideMm: 100, topMm: 0, bottomMm: 100 });
    expect(data.notationSizeMultiplier).toBe(2.0);
    expect(data.pageMargins).toEqual({ sideMm: 25, topMm: 8, bottomMm: 25 });
  });

  it('手編集などで壊れた値が入っていても読み込みは止めず、範囲へ丸める', () => {
    const broken = {
      ...create(1.2, { sideMm: 12, topMm: 16, bottomMm: 16 }),
      notationSizeMultiplier: 99,
      pageMargins: { sideMm: 'とても広い', topMm: 16, bottomMm: 16 },
    };
    expect(saveScoreData(broken as never).success).toBe(true);
    const restored = loadScoreData();
    expect(restored.success).toBe(true);
    expect(restored.data?.notationSizeMultiplier).toBe(2.0);
    // 数値でない項目だけ既定（14mm）へ倒し、他はそのまま
    expect(restored.data?.pageMargins).toEqual({ sideMm: 14, topMm: 16, bottomMm: 16 });
  });
});
