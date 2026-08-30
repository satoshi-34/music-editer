// 用紙サイズ（A4/B4/A3・Issue #495）の統合テスト（配線テスト）。
//
// AGENTS.md の「統合テスト（配線）ルール」に従い、props 直接注入ではなく ScorePage を
// 実際にマウントし、レイアウトタブのチップを実際にクリックして紙面の DOM が変わることまで見る。
// 単体テスト（utils/pageSize.test.ts・utils/pageSizeLayout.test.ts）は寸法と保存形式を
// 見ているので、ここでは「画面から用紙サイズへ実際に届くか」だけを担当する。
//
// 受入条件のうちここで固定するもの:
// 1. 画面が選択サイズに追従する（.spread の CSS 変数・印刷用 @page の両方）
// 2. 保存→再読込でサイズが保持される／旧データ（pageSize 無し）は A4 で開く
// 4. サイズ変更時に通知が出る（#318）
// 5. A4 のままなら従来と同じ（CSS 変数は A4 実寸・@page の上書きを差し込まない）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
  loadWorkAutosaveData,
} from '../utils/storage';
import type { PartData, SavedScoreData } from '../types/storage';

// 段割り計画へ渡る紙幅予算を観測するスパイ（round1 P1 の退行検出用）。
// 実装はそのまま使い、呼び出し引数だけ記録する
const planSpy = vi.hoisted(() => vi.fn());
vi.mock('../utils/measureLayoutUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/measureLayoutUtils')>();
  planSpy.mockImplementation(actual.planSystemMeasureRanges);
  return { ...actual, planSystemMeasureRanges: planSpy };
});

// 幅フィット計算へ渡る用紙IDを観測するスパイ（round1 P2 の退行検出用）。
// effect は依存配列の変更でしか再実行されないため、pageSize が依存から漏れると
// 「B4 の作品を開いてもズームの初期フィットが A4 幅のまま」になる
const pageWidthSpy = vi.hoisted(() => vi.fn());
vi.mock('../utils/viewZoomUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/viewZoomUtils')>();
  pageWidthSpy.mockImplementation(actual.pageWidthPxForSize);
  return { ...actual, pageWidthPxForSize: pageWidthSpy };
});

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

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;

function seedWork(data: SavedScoreData, title: string) {
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/** 用紙サイズの検証に必要な最小限の譜面（音符の中身はレイアウトの本筋ではない） */
function seedSingleWork(pageSize?: 'a4' | 'b4' | 'a3') {
  const parts: PartData[] = [
    {
      partId: 'melody',
      clef: 'treble',
      measures: Array.from({ length: 4 }, () => ({ events: [{ dur: '1' as const, isRest: false, keys: ['c/5'] }] })),
    },
  ];
  const data = createSavedScoreData(
    { title: '用紙サイズテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts, 1, 4, 'single', 'C', [4, 4],
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    pageSize,
  );
  return seedWork(data, '用紙サイズテスト');
}

/** レイアウトタブを開いて用紙サイズのチップを押す */
async function clickPageSizeChip(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
  const group = await screen.findByRole('group', { name: '用紙サイズ' });
  const chip = Array.from(group.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
  expect(chip, `用紙サイズのチップ「${label}」が見つからない`).toBeTruthy();
  fireEvent.click(chip!);
}

/** .spread に注入された用紙サイズの CSS 変数を読む（App.css はこれを width/height へ渡すだけ） */
function readPaperVars() {
  const spread = document.querySelector('.spread') as HTMLElement | null;
  expect(spread, '.spread が見つからない').toBeTruthy();
  return {
    width: spread!.style.getPropertyValue('--paper-width').trim(),
    height: spread!.style.getPropertyValue('--paper-height').trim(),
  };
}

/** 印刷用に差し込まれた @page 上書き <style> を読む（A4 のときは差し込まれない） */
function readInjectedPageStyle(): string | null {
  const style = document.head.querySelector('style[data-page-size]');
  return style ? style.textContent : null;
}

describe('用紙サイズの配線（Issue #495）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style[data-page-size]').forEach(el => el.remove());
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('受入5: 既定（A4）では従来どおり A4 実寸で、印刷の @page 上書きも差し込まない', async () => {
    seedSingleWork();
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    await waitFor(() => {
      expect(readPaperVars()).toEqual({ width: '210mm', height: '297mm' });
    });
    // A4 のときに <style> を足さないことが、既存譜面の印刷結果を1pxも変えない保証になる
    expect(readInjectedPageStyle()).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入1・4: B4 を選ぶと紙面・印刷サイズが追従し、組み直しの通知が出る', async () => {
    seedSingleWork();
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    await clickPageSizeChip('B4');

    // 画面（.spread の CSS 変数 → App.css の .page-wrapper / .print-page）
    await waitFor(() => {
      expect(readPaperVars()).toEqual({ width: '257mm', height: '364mm' });
    });
    // 印刷（@page は var() を読めないため <style> の差し込みで上書きする）
    await waitFor(() => {
      const injected = readInjectedPageStyle();
      expect(injected).toContain('257mm 364mm');
      // margin: 0 を落とすと既定の @page 余白が復活して紙面が左へずれる
      expect(injected).toContain('margin: 0');
    });
    // 行き止まりは喋る（#318）: 段の組み直しが起きることを黙って行わない
    expect(await screen.findByText(/用紙サイズを B4 に変更しました/)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入1: B4 を選ぶと段組みの計算も B4 の紙幅予算で再実行される（round1 P1: CSS変数だけの追従では足りない）', async () => {
    // 用紙チップの切り替えが useMemo の依存（paperWidthMm）へ届いていないと、
    // CSS のページ枠だけ広がって段割り計画は A4 幅の予算のまま再実行されない。
    // 計画関数（planSystemMeasureRanges）へ渡る紙幅予算が B4 で広がることを直接固定する
    seedSingleWork();
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    const budgetsSoFar = () => planSpy.mock.calls.map((call) => call[2] as number);
    await waitFor(() => { expect(budgetsSoFar().length).toBeGreaterThan(0); });
    const a4Budget = budgetsSoFar().at(-1)!;

    await clickPageSizeChip('B4');

    await waitFor(() => {
      // B4（257mm）は A4（210mm）より広いぶん、段あたりの内容幅の予算も広がる
      expect(budgetsSoFar().at(-1)!).toBeGreaterThan(a4Budget * 1.1);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入2: B4 の作品を開くと、ズームの初期フィットも B4 の紙幅で計算される（round1 P2）', async () => {
    seedSingleWork('b4');
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    // 保存作品の復元は非同期なので、B4 が state に入った後の再フィットまで待つ。
    // pageSize が effect の依存から漏れていると、最後の呼び出しが 'a4'（初期state）のまま残る
    await waitFor(() => {
      const ids = pageWidthSpy.mock.calls.map((call) => call[0]);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.at(-1)).toBe('b4');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入1: A3 を選び直すと A3 実寸へ切り替わり、前の判型の <style> は残らない', async () => {
    seedSingleWork();
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    await clickPageSizeChip('B4');
    await waitFor(() => expect(readInjectedPageStyle()).toContain('257mm'));

    await clickPageSizeChip('A3');
    await waitFor(() => {
      expect(readPaperVars()).toEqual({ width: '297mm', height: '420mm' });
    });
    await waitFor(() => {
      // 差し込んだ <style> は常に1枚だけ（切替のたびに増えると古い判型が勝ち続ける）
      expect(document.head.querySelectorAll('style[data-page-size]').length).toBe(1);
      expect(readInjectedPageStyle()).toContain('297mm 420mm');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入1・5: A4 へ戻すと A4 実寸に戻り、@page の上書きも取り除かれる', async () => {
    seedSingleWork();
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    await clickPageSizeChip('B4');
    await waitFor(() => expect(readInjectedPageStyle()).toContain('257mm'));

    await clickPageSizeChip('A4');
    await waitFor(() => {
      expect(readPaperVars()).toEqual({ width: '210mm', height: '297mm' });
      expect(readInjectedPageStyle()).toBeNull();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入2: 選んだ用紙サイズが自動保存され、開き直しても同じ判型で開く', async () => {
    const workId = seedSingleWork();
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });

    await clickPageSizeChip('B4');
    await waitFor(() => expect(readPaperVars().width).toBe('257mm'));

    // 自動保存が用紙サイズを載せるまで待つ（保存形式＝作品の属性として持つことの確認）
    await waitFor(() => {
      const saved = loadWorkAutosaveData(workId);
      expect(saved.success && saved.data?.pageSize).toBe('b4');
    }, { timeout: 15000 });

    // 開き直し（アンマウント→再マウント）で B4 のまま復元される
    cleanup();
    document.head.querySelectorAll('style[data-page-size]').forEach(el => el.remove());
    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });
    await waitFor(() => {
      expect(readPaperVars()).toEqual({ width: '257mm', height: '364mm' });
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入2: 用紙サイズを持たない旧データは A4 として開く', async () => {
    const parts: PartData[] = [
      { partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] },
    ];
    // 3.6.0 以前の保存データを模す（pageSize 項目そのものが無い）
    const legacy = {
      version: '3.6.0',
      timestamp: Date.now(),
      metadata: { title: '旧データ', subtitle: '', lyricist: '', composer: '', arranger: '' },
      scoreType: 'single' as const,
      parts,
      systems: 1,
      measuresPerSystem: 4,
    } as SavedScoreData;
    expect(legacy.pageSize).toBeUndefined();
    seedWork(legacy, '旧データ');

    render(<ScorePage />);
    await screen.findByRole('tab', { name: 'レイアウト' });
    await waitFor(() => {
      expect(readPaperVars()).toEqual({ width: '210mm', height: '297mm' });
    });
    expect(readInjectedPageStyle()).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
