// レイアウトタブを「整えるモード」にする（Issue #571）の実マウント配線テスト。
//
// 受入条件（Issue #571 本文＋運用者裁定コメント）:
// 1. レイアウトタブを開くと、選択なしで段2以降の上端バンドが見える
// 2. その状態でバンドをドラッグすると段の選択→調整が1操作でできる（掴んだ段が選択される）
// 3. 音符・休符タブへ戻るとバンドが消える
// 4. 選択なしでも「段を選べば小節数・間隔を調整できる」ことが分かる
//    （五線の面が段の選択になり、そこから ◀▶ のパネルへ到達できる）
// 5. 当たり判定は3層: 帯＝間隔 / 面＝段の選択 / 角＝音符の大きさ（全体）
// 6. 角ハンドルは「この段だけ」と誤解させない（吹き出しに「（全体）」・スライダーと値が同期）
//
// レンダー手法は ScorePageSystemGapDrag.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { MeasureData, PartData } from '../types/storage';

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
const MEASURE_COUNT = 8;

/** 全音符1つだけの小節（幅が細く、段あたり小節数の自動計画が安定する） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
}

function seedWork() {
  const parts: PartData[] = [
    { partId: 'melody', clef: 'treble' as const, measures: Array.from({ length: MEASURE_COUNT }, sparseMeasure) },
  ];
  const data = createSavedScoreData(
    { title: '整えるモードテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    'single'
  );
  const created = createWork('整えるモードテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

async function renderScore() {
  seedWork();
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
}

/** ツールバーのタブを切り替える（表示名は TOOLBAR_TAB_BUTTONS の正本） */
function openTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

/** 画面に出ている段（選択できるもの）の先頭小節を、上から順に並べて返す */
function systemStartMeasures(): number[] {
  return Array.from(document.querySelectorAll('[data-testid^="system-frame-"]'))
    .map((el) => Number((el as HTMLElement).dataset.testid!.replace('system-frame-', '')));
}

/** 段のラッパーに実際に効いている marginTop（＝段の間隔の反映結果） */
function frameMarginTop(startMeasure: number): string {
  return (screen.getByTestId(`system-frame-${startMeasure}`) as HTMLElement).style.marginTop;
}

/** 「音符の大きさ」スライダーのいまの値（%） */
function notationSizePercent(): number {
  return Number((screen.getByLabelText('音符の大きさ') as HTMLInputElement).value);
}

/** 主ポインタの左ボタンで掴む（#536 の規約どおり isPrimary / button / pointerId をそろえる） */
function grab(handle: HTMLElement, clientX: number, clientY: number) {
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX, clientY });
}

describe('ScorePage: レイアウトタブ＝整えるモード（Issue #571）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom は実レイアウトを持たないので、譜面の幅（小節幅の配分に使う）を固定する。
    // 高さ（offsetHeight）は 0 のままで、ドラッグ側は「実測できない＝等倍」として扱う
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('音符・休符タブでは掴みしろが出ない（譜面を書いている間の見た目は変えない）', async () => {
    await renderScore();
    expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
    expect(document.querySelector('.system-select-surface')).toBeNull();
    expect(document.querySelector('.score-area.layout-adjust-mode')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('レイアウトタブを開くと、選択なしで段2以降の上端バンドが出る（受入1）', async () => {
    await renderScore();
    openTab('レイアウト');

    const starts = systemStartMeasures();
    expect(starts.length).toBeGreaterThan(1);
    await waitFor(() => {
      // 2段目以降には帯が出る（どの段も選択していない状態のまま）
      expect(screen.getByTestId(`system-gap-drag-${starts[1]}`)).toBeTruthy();
    });
    // ページの先頭の段には出ない（上に動かせる境界が無いため・#523 round1 P1 の維持）
    expect(screen.queryByTestId(`system-gap-drag-${starts[0]}`)).toBeNull();
    // 選択そのものは起きていない（パネルはまだ出ない）
    expect(document.querySelector('[data-testid^="system-layout-panel-"]')).toBeNull();
    // CSS が掴みしろを薄く見せる先（.layout-adjust-mode）も付いている
    expect(document.querySelector('.score-area.layout-adjust-mode')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('音符・休符タブへ戻るとバンドが消える（受入3）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-drag-${starts[1]}`)).toBeTruthy();
    });

    openTab('音符・休符');
    await waitFor(() => {
      expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
    });
    expect(document.querySelector('.system-select-surface')).toBeNull();
    expect(document.querySelector('.score-area.layout-adjust-mode')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('選択していない段のバンドを掴むと、その段が選ばれてそのまま間隔が変わる（受入2）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[1];
    const handle = await screen.findByTestId(`system-gap-drag-${target}`);

    // 掴んだ瞬間に段が選ばれる（＝小節数 ◀▶ のパネルもその場で出る）
    grab(handle as HTMLElement, 300, 200);
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${target}`)).toBeTruthy();
    });

    // 掴んだまま下へ引くと、その境界＝この段の間隔が動く（選択のやり直しは要らない）
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 220 });
    await waitFor(() => {
      expect(frameMarginTop(target)).toBe('20px');
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 220 });
    expect(frameMarginTop(target)).toBe('20px');
    // パネルの数値も同じ state を見ている
    expect(screen.getByTestId(`system-gap-value-${target}`).textContent).toBe('+20px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('五線の面をクリックすると段が選ばれ、小節数（◀▶）のパネルへ到達できる（受入4）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[0];

    const surface = await screen.findByTestId(`system-select-surface-${target}`);
    // 「何ができるのか」はホバーのヒントで伝える（行き止まりを黙って作らない）
    expect(surface.getAttribute('title')).toContain('小節数');
    fireEvent.click(surface);

    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${target}`)).toBeTruthy();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('選択中の段の右下角を斜めに引くと譜面全体の音符の大きさが変わり、Undo 1回で戻る（受入5・6）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[0];
    const before = notationSizePercent();

    // 角ハンドルは選択中の段にだけ出る（選択前は出ない）
    expect(screen.queryByTestId(`notation-size-drag-${target}`)).toBeNull();
    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    const corner = await screen.findByTestId(`notation-size-drag-${target}`);

    // 外（右下）へ 50px + 50px 引くと +20%（(50+50)/2 × 0.4）
    grab(corner as HTMLElement, 400, 300);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 450, clientY: 350 });
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before + 20);
    });
    // 吹き出しは「（全体）」を必ず出す（この段だけと誤解させないため・運用者裁定）
    const hint = screen.getByTestId(`notation-size-drag-value-${target}`);
    expect(hint.textContent).toBe(`音符の大きさ（全体）: ${before + 20}%`);

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 450, clientY: 350 });
    expect(notationSizePercent()).toBe(before + 20);
    expect(screen.queryByTestId(`notation-size-drag-value-${target}`)).toBeNull();

    // Undo はドラッグ全体で1件（#523 の規約に準拠）
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('スライダーで変えた音符の大きさも Undo 1回で戻る（角ハンドルと同じ1操作＝1件）', async () => {
    // 大きさは Undo/Redo のスナップショットに入っているので、スライダー側でも
    // 操作ごとに履歴を積む必要がある。積まないと、スライダーで変えた値が
    // 無関係な Undo で古い値へ戻ってしまう（Issue #571）
    await renderScore();
    openTab('レイアウト');
    const slider = screen.getByLabelText('音符の大きさ') as HTMLInputElement;
    const before = notationSizePercent();

    fireEvent.pointerDown(slider, { button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.change(slider, { target: { value: String(before + 10) } });
    fireEvent.change(slider, { target: { value: String(before + 20) } });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(notationSizePercent()).toBe(before + 20);

    // つまみを動かし続けた1回ぶんは履歴1件（何段階動かしても1回で戻る）
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('角ハンドルを掴んだだけ（動かさずに離す）では履歴も値も変わらない', async () => {
    await renderScore();
    openTab('レイアウト');
    const target = systemStartMeasures()[0];
    const before = notationSizePercent();
    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    const corner = await screen.findByTestId(`notation-size-drag-${target}`);

    grab(corner as HTMLElement, 400, 300);
    // 遊び（3px）の中しか動かさない
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 401, clientY: 301 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 401, clientY: 301 });

    expect(notationSizePercent()).toBe(before);
    // 「元に戻す」が空振りしない（＝履歴が1件も増えていない）ことは、
    // ボタンが無効のままであることで確かめる
    expect((screen.getByTitle(/元に戻す/) as HTMLButtonElement).disabled).toBe(true);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
