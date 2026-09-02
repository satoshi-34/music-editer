// 段の境界（上端）ドラッグで段の間隔を変える（Issue #523 = #450 の子2）の実マウント配線テスト。
//
// 受入条件（Issue #523）:
// 1. 境界ドラッグで段間隔が変わり、パネルの数値・保存（＝同じ systemRowGapOverrides）と一致する
// 2. #482 の選択・パネル操作に回帰がない（掴んでも選択が解けない・選択していない段には帯が無い）
// 3. ドラッグ中の値表示がある
// 4. Undo 単位が1操作（何px動かしても「元に戻す」1回で掴む前へ戻る）
//
// round1 の差し戻しで追加した固定（何を守るためのテストか）:
//   - 掴んだ境界そのものが動く: 帯は段の「上端」に出て、動くのは自分の間隔。
//     上の段の marginTop は動かない（自段だけを見ていると取り違えを見逃す）
//   - ページの先頭の段には帯を出さない（上に境界が無いので、動かすとページ全体がずれるだけ）
//   - 起点は「いま効いている margin-top」ではなく「現在の上書き値」（全体設定への追従を壊さない）
//   - pointer イベント規約（#536）: pointerId 追跡・pointercancel・タッチ
//   - 値が結局変わらなければ Undo 履歴を残さない
// レンダー手法は ScorePageSystemSelectPanel.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { MeasureData, PartData, ScoreType } from '../types/storage';

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

function seedWork(scoreType: ScoreType = 'single') {
  const measures = () => Array.from({ length: MEASURE_COUNT }, sparseMeasure);
  const parts: PartData[] = scoreType === 'piano'
    ? [
      { partId: 'right', clef: 'treble' as const, measures: measures() },
      { partId: 'left', clef: 'bass' as const, measures: measures() },
    ]
    : [{ partId: 'melody', clef: 'treble' as const, measures: measures() }];
  const data = createSavedScoreData(
    { title: '境界ドラッグテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    scoreType
  );
  const created = createWork('境界ドラッグテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

async function renderScore(scoreType: ScoreType = 'single') {
  seedWork(scoreType);
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
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

/**
 * 「上に段がある段」（＝境界帯が出る段）を1つ選び、帯と前後の段の先頭小節を返す。
 * 段割りの結果（jsdom と実ブラウザで小節幅が違う）に依存しないよう、
 * 番号を決め打たずに上から順に選び直して最初に帯が出た段を使う。
 */
async function selectSystemWithBoundary(): Promise<{ start: number; aboveStart: number; handle: HTMLElement }> {
  const starts = systemStartMeasures();
  for (let i = 1; i < starts.length; i++) {
    fireEvent.click(screen.getByTestId(`system-select-left-${starts[i]}`));
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${starts[i]}`)).toBeTruthy();
    });
    const handle = screen.queryByTestId(`system-gap-drag-${starts[i]}`);
    if (handle) return { start: starts[i], aboveStart: starts[i - 1], handle: handle as HTMLElement };
  }
  throw new Error('境界帯を持つ段（上に段がある段）が見つからなかった');
}

/** 主ポインタの左ボタンで掴む（#536 の規約どおり isPrimary / button / pointerId をそろえる） */
function grab(handle: HTMLElement, clientY: number, pointerId = 1, pointerType = 'mouse') {
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId, pointerType, clientX: 300, clientY });
}

describe('ScorePage: 段の境界ドラッグで段の間隔を変える（Issue #523）', () => {
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

  it('選択していない段には境界帯が出ない（譜面上に常設物を残さない）', async () => {
    await renderScore();
    expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ページの先頭の段には帯を出さない（上に動かせる境界が無いため・round1 P1）', async () => {
    await renderScore();
    const firstStart = systemStartMeasures()[0];
    fireEvent.click(screen.getByTestId(`system-select-left-${firstStart}`));
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${firstStart}`)).toBeTruthy();
    });
    // パネル（数値指定）は出るが、掴みしろは出さない
    expect(screen.queryByTestId(`system-gap-drag-${firstStart}`)).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('上端を下へドラッグすると掴んだ境界だけが動く（自分の間隔が広がり、上の段は動かない）', async () => {
    await renderScore();
    const { start, aboveStart, handle } = await selectSystemWithBoundary();
    expect(screen.getByTestId(`system-gap-value-${start}`).textContent).toBe('+0px');

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 218 });
    // 掴んだ時点の上書き（0px）＋総移動量（+18px）が、掴んだ境界＝この段の marginTop に入る
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('18px');
    });
    // 上の段は1pxも動かない（round1 P1: 掴んだ境界と別の場所が動いていないこと）
    expect(frameMarginTop(aboveStart)).toBe('');
    // 同じ state を見ているパネルの数値もリアルタイムで一致する（受入条件1）
    expect(screen.getByTestId(`system-gap-value-${start}`).textContent).toBe('+18px');

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 218 });
    // 離した時点の値が確定値。掴んでいた段の選択も解けない（続けて微調整できる）
    expect(frameMarginTop(start)).toBe('18px');
    expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ドラッグ中はカーソル付近に現在値が出て、離すと消える（受入条件3）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();
    expect(screen.queryByTestId(`system-gap-drag-value-${start}`)).toBeNull();

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 212 });
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-drag-value-${start}`).textContent).toBe('+12px');
    });

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 190 });
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-drag-value-${start}`).textContent).toBe('-10px');
    });

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 320, clientY: 190 });
    await waitFor(() => {
      expect(screen.queryByTestId(`system-gap-drag-value-${start}`)).toBeNull();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('何px動かしても「元に戻す」1回で掴む前の間隔へ戻る（受入条件4）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();

    grab(handle, 200);
    // 途中の値を何度も通しても、履歴に積むのは値が変わり始めた1件だけ
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 205 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 210 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 224 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 224 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('24px');
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('掴む前と同じ値へ戻して離すと、Undo 履歴を残さない（round1 P2）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();

    // 直前に1回だけ別の操作（パネルの ＋）をしておき、その履歴が残ることで
    // 「ドラッグが履歴を増やしていない」ことを Undo 1回で確かめられるようにする
    fireEvent.click(screen.getByTestId(`system-gap-increase-${start}`));
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('4px');
    });

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 220 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('24px');
    });
    // 掴んだ位置まで戻してから離す（＝結果として何も変えていない）
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 200 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('4px');
    });

    // Undo 1回でパネルの ＋ の前（上書きなし）まで戻る。ドラッグが履歴を1件消費していたら
    // ここは '4px' のままになる
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('遊び（3px）に満たない動きでは値が変わらない（押した指の震えで動かさない）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 202 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 202 });

    expect(frameMarginTop(start)).toBe('');
    expect(screen.getByTestId(`system-gap-value-${start}`).textContent).toBe('+0px');
    // 選択も解けないまま（掴み損ねただけの操作で状態が変わらない）
    expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パネルで付けた間隔の続きから掴める（上書き済みの段でも指と1:1で動く）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();

    // 先にパネルの ＋ で +4px にしてから掴む
    fireEvent.click(screen.getByTestId(`system-gap-increase-${start}`));
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('4px');
    });

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 210 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('14px');
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 210 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('全体設定で段が詰めてあっても、起点は「その段の上書き値」（round1 P2）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();
    const frame = screen.getByTestId(`system-frame-${start}`) as HTMLElement;
    // 全体の「段の間隔」が -30px（ピアノ譜の既定）で効いている状態を作る。
    // 起点に「いま効いている margin-top」を使う実装だと、-30 + 10 = -20px が
    // この段の上書きとして保存され、以後この段だけ全体設定へ追従しなくなる
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string | null) => (
      el === frame
        ? ({ ...realGetComputedStyle(el, pseudo ?? undefined), marginTop: '-30px' } as CSSStyleDeclaration)
        : realGetComputedStyle(el, pseudo ?? undefined)
    )) as typeof window.getComputedStyle);

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 210 });
    await waitFor(() => {
      // 上書きは「動かしたぶん」だけ。全体設定 -30px は上書きへ焼き込まれない
      expect(frameMarginTop(start)).toBe('10px');
    });
    expect(screen.getByTestId(`system-gap-value-${start}`).textContent).toBe('+10px');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 210 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('画面の拡大率（ズーム）ぶんを割り戻して、指と段が1:1で動く', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();
    const frame = screen.getByTestId(`system-frame-${start}`) as HTMLElement;
    // 表示倍率 150%（レイアウト100px の段が画面上では150px で見えている）を作る
    Object.defineProperty(frame, 'offsetHeight', { value: 100, configurable: true });
    frame.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 900, bottom: 150, width: 900, height: 150, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    grab(handle, 200);
    // 画面で30px 動かしたら、レイアウト上は 30 / 1.5 = 20px 動く
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 230 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('20px');
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 230 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('タッチでも動き、掴んでいない別の指（別 pointerId）では動かない（#536 の規約）', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();

    grab(handle, 200, 7, 'touch');
    // 別の指の移動は無視する（多点タッチでの混線防止）
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 300, clientY: 260 });
    expect(frameMarginTop(start)).toBe('');

    fireEvent.pointerMove(window, { pointerId: 7, clientX: 300, clientY: 216 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('16px');
    });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 300, clientY: 216 });
    expect(frameMarginTop(start)).toBe('16px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('pointercancel（OS がポインタを取り上げた）では掴む前の値へ戻す', async () => {
    await renderScore();
    const { start, handle } = await selectSystemWithBoundary();

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 222 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('22px');
    });

    fireEvent.pointerCancel(window, { pointerId: 1 });
    await waitFor(() => {
      // 利用者が決めた値ではないので、掴む前へ戻す（吹き出しも消える）
      expect(frameMarginTop(start)).toBe('');
    });
    expect(screen.queryByTestId(`system-gap-drag-value-${start}`)).toBeNull();

    // 取り上げられた後は、その指を追わない（残ったリスナーで値が動き続けない）
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 300 });
    expect(frameMarginTop(start)).toBe('');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ピアノ譜（大譜表）でも同じように境界を掴める', async () => {
    await renderScore('piano');
    const { start, aboveStart, handle } = await selectSystemWithBoundary();

    grab(handle, 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 214 });
    await waitFor(() => {
      expect(frameMarginTop(start)).toBe('14px');
    });
    expect(frameMarginTop(aboveStart)).toBe('');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 214 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
