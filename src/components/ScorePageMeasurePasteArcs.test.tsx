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
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

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

/** 4小節。1小節目→2小節目へ伸びるスラー（＝コピー範囲の内側をまたぐ弧）を持つ単旋律 */
function seedFourMeasuresWithSpanningSlur() {
  const withSlur = [{
    dur: '1' as const, isRest: false, keys: ['c/5'],
    arcs: [{ fromKey: 'c/5', toKey: 'd/5', toMeasureIndex: 1, toEventIndex: 0, kind: 'slur' as const }],
  }];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['d/5'] }];
  const mk = (e: typeof plain) => ({ events: e, voices: [{ id: 'voice-1', events: e }] });
  const data = createSavedScoreData(
    { title: '複数小節コピペテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [mk(withSlur), mk(plain), mk(plain), mk(plain)] }],
    1,
    4,
    'single'
  );
  const created = createWork('複数小節コピペテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** Violin I の1小節目に「2小節目へ伸びる（＝コピー範囲外を指す）スラー」を持つ四重奏 */
function seedQuartetWithOutgoingSlur() {
  const withSlur = [{
    dur: '1' as const, isRest: false, keys: ['c/5'],
    arcs: [{ fromKey: 'c/5', toKey: 'd/5', toMeasureIndex: 1, toEventIndex: 0, kind: 'slur' as const }],
  }];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const measuresFor = (first: typeof plain) => ([
    { events: first, voices: [{ id: 'voice-1', events: first }] },
    { events: plain, voices: [{ id: 'voice-1', events: plain }] },
  ]);
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: '四重奏コピペ通知テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: measuresFor(i === 0 ? withSlur : plain),
    })),
    1,
    2,
    'quartet'
  );
  const created = createWork('四重奏コピペ通知テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/**
 * 小節の当たり判定は x 座標の昇順が小節順（同じ x のものは別の段・重ね）。
 * data 属性が無いので distinct な x の小さい順で引く
 */
function measureHitByX(index: number): SVGRectElement | undefined {
  const hits = Array.from(document.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
  const byX = new Map<number, SVGRectElement>();
  hits.forEach((h) => {
    const x = Math.round(parseFloat(h.getAttribute('x') ?? '0'));
    if (!byX.has(x)) byX.set(x, h);
  });
  return [...byX.entries()].sort((a, b) => a[0] - b[0])[index]?.[1];
}

describe('ScorePage: 小節コピペでのスラー終点の付け替え（実機報告 2026-08-24）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let notices: string[] = [];
  let noticeListener: (e: Event) => void;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
    notices = [];
    noticeListener = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
  });

  afterEach(() => {
    window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
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
    const first = measureHitByX(0) as SVGRectElement;
    expect(first).toBeTruthy();
    // 小節選択は mousedown 起点（ドラッグ範囲選択があるため）
    fireEvent.mouseDown(first, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(first, { clientX: 10, clientY: 10 });
    fireEvent.click(first, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    // 2小節目を選んで貼り付け
    const second = measureHitByX(1) as SVGRectElement;
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

  // 複数小節をまとめて貼る経路。1小節だけの付け替えが合っていても、範囲内をまたぐ弧の
  // 「何小節先か」という相対関係まで保たれるとは限らないので別に固定する
  it('1〜2小節目を3〜4小節目へ貼ると、またぐスラーは3→4小節目になる', async () => {
    seedFourMeasuresWithSpanningSlur();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(await screen.findByRole('button', { name: /小節選択/ }, { timeout: 15000 }));
    const noteHit = (m: number) =>
      document.querySelector(`rect.vf-note-hit[data-measure="${m}"]`) as SVGRectElement | null;

    // 1小節目を選び、Shift+→ で2小節目まで範囲を広げてコピー
    const m0 = noteHit(0);
    expect(m0).toBeTruthy();
    fireEvent.mouseDown(m0!, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(m0!, { clientX: 10, clientY: 10 });
    fireEvent.click(m0!, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    // 3小節目を選んで貼る
    const m2 = noteHit(2);
    expect(m2).toBeTruthy();
    fireEvent.mouseDown(m2!, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(m2!, { clientX: 10, clientY: 10 });
    fireEvent.click(m2!, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    await waitFor(() => {
      const measures = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures;
      const arc = measures?.[2]?.events?.[0]?.arcs?.[0];
      expect(arc).toBeTruthy();
      // 「1つ先の小節」という関係が保たれる（1 → 3）
      expect(arc!.toMeasureIndex).toBe(3);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 通知の件数を setter の updater 内で数えていると、React の updater は遅延・再実行され得るため
  // （StrictMode では意図的に2回走る）件数が倍になったり出なかったりする。
  // 四重奏は setQuartetParts(prev => ...) 経由なので、その経路で件数を固定する
  // （#401 Codex round1 P2）
  it('四重奏でも、範囲外へ伸びる弧を落とした通知が1回だけ正しい件数で出る', async () => {
    seedQuartetWithOutgoingSlur();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const selectTool = await screen.findByRole('button', { name: /小節選択/ }, { timeout: 15000 });
    fireEvent.click(selectTool);

    // 四重奏は段が4つあり x だけでは小節を引きにくいので、音符の当たり判定から辿る
    const noteHit = (m: number) =>
      document.querySelector(`rect.vf-note-hit[data-measure="${m}"]`) as SVGRectElement | null;
    const first = noteHit(0);
    expect(first).toBeTruthy();
    fireEvent.mouseDown(first!, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(first!, { clientX: 10, clientY: 10 });
    fireEvent.click(first!, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    const second = noteHit(1);
    expect(second).toBeTruthy();
    fireEvent.mouseDown(second!, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(second!, { clientX: 10, clientY: 10 });
    fireEvent.click(second!, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    // Violin I の1本だけが範囲外（2小節目へ伸びる）。他3パートには弧が無い
    await waitFor(() => {
      expect(notices.some((n) => n.includes('コピー範囲の外へつながっていた'))).toBe(true);
    }, { timeout: 15000 });
    const dropNotices = notices.filter((n) => n.includes('コピー範囲の外へつながっていた'));
    expect(dropNotices).toHaveLength(1);
    expect(dropNotices[0]).toContain('1件');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
