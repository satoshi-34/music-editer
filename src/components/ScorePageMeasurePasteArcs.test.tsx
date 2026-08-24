// 小節コピペでスラーの終点が貼り付け先へ付け替わることの ScorePage 配線テスト。
//
// measurePasteUtils.test.ts は純粋関数だけを見るため、貼り付け処理が
// その関数を呼んでいなければ通ってしまう（実際、元のバグは「付け替える関数が無い」
// ではなく「貼り付けが素の代入だった」）。ここでは作品を復元した実経路で
// 「小節選択 → Cmd+C → 別の小節を選択 → Cmd+V」を行い、保存データの
// toMeasureIndex が貼り付け先を指すことを固定する。
//
// 実機報告（2026-08-24・月光の清書中）: 1小節目を2小節目へ貼ったら、2小節目の
// スラー4本すべてが 1小節目を指したまま残り、小節をまたぐ長い弧として描かれた。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
  loadWorkAutosaveData,
} from '../utils/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

let workId = '';

/** 1小節目に「小節内で完結するスラー」を持ち、2小節目は空の単旋律作品 */
function seedWorkWithInnerSlur() {
  const events = [
    {
      dur: '4' as const,
      isRest: false,
      keys: ['c/4'],
      arcs: [{
        fromKey: 'c/4',
        toKey: 'e/4',
        toMeasureIndex: 0,
        toEventIndex: 1,
        kind: 'slur' as const,
      }],
    },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
  ];
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: 'コピペ配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        { events, voices: [{ id: 'voice-1', events }] },
        // 2小節目にも中身を置く（空小節だと小節の当たり判定を押しても選択されない）
        { events: rest, voices: [{ id: 'voice-1', events: rest }] },
      ],
    }],
    1,
    2,
    'single'
  );
  const created = createWork('コピペ配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

describe('ScorePage: 小節コピペでのスラー終点の付け替え（実機報告 2026-08-24）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('1小節目を2小節目へ貼ると、スラーの終点も2小節目を指す', async () => {
    seedWorkWithInnerSlur();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 小節選択ツール（「音符・休符」タブ）
    const selectTool = await screen.findByRole('button', { name: /小節選択/ }, { timeout: 15000 });
    fireEvent.click(selectTool);

    // 小節の当たり判定（rect.vf-hit）には小節番号の data 属性が無いため、描画順で引く。
    // 単旋律2小節なので [0]=1小節目・[1]=2小節目
    // 小節の当たり判定は x 座標の昇順が小節順（同じ x のものはスライス表示用の重ね）。
    // data 属性が無いので、distinct な x の小さい順で引く
    const measureHit = (index: number) => {
      const hits = Array.from(document.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
      const byX = new Map<number, SVGRectElement>();
      hits.forEach((h) => {
        const x = Math.round(parseFloat(h.getAttribute('x') ?? '0'));
        if (!byX.has(x)) byX.set(x, h);
      });
      return [...byX.entries()].sort((a2, b2) => a2[0] - b2[0])[index]?.[1];
    };
    const first = measureHit(0) as SVGRectElement;
    expect(first).toBeTruthy();
    // 小節選択は mousedown 起点（ドラッグ範囲選択があるため）
    fireEvent.mouseDown(first, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(first, { clientX: 10, clientY: 10 });
    fireEvent.click(first, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    // 2小節目を選んで貼り付け
    const second = measureHit(1) as SVGRectElement;
    expect(second).toBeTruthy();
    fireEvent.mouseDown(second, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(second, { clientX: 10, clientY: 10 });
    fireEvent.click(second, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    // 自動保存されたデータで、2小節目のスラーが2小節目を指していることを確かめる。
    // 「1小節目を指したまま」が実機で起きた壊れ方
    await waitFor(() => {
      const loaded = loadWorkAutosaveData(workId);
      const part = loaded.data?.parts?.[0];
      const arc = part?.measures?.[1]?.events?.[0]?.arcs?.[0];
      expect(arc).toBeTruthy();
      expect(arc!.toMeasureIndex).toBe(1);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
