// 段の選択+フローティングパネル（Issue #482 = #450 の実装段階1）の実マウント配線テスト。
//
// 受入条件（Issue #482）:
// 1. 五線の左右端クリックで段が選択され、横にパネルが出る。Esc / 譜面の他の場所クリックで消える
// 2. 小節数・間隔の変更が、従来の段下コントロール行と同じ state（systemMeasureOverrides /
//    systemRowGapOverrides）を動かす＝段割りが実際に変わり、Undo で戻る
// 3. 段下のコントロール行が描画されない
// レンダー手法は ScorePageArcSelectionArrowKeys.test.tsx 等と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import type { MeasureData } from '../types/storage';

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

/** 8小節・2小節/段の単旋律作品を仕込む（＝1段目は小節0〜1から始まる） */
function seedWork() {
  const data = createSavedScoreData(
    { title: '段選択テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: Array.from({ length: MEASURE_COUNT }, sparseMeasure),
    }],
    1,
    2,
    'single'
  );
  const created = createWork('段選択テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** 最初の内容段（音符ヒット領域を持つ最初の svg）に含まれる小節の数 */
function firstSystemMeasureCount(): number {
  const svgs = Array.from(document.querySelectorAll('svg'));
  const first = svgs.find((svg) => svg.querySelector('rect.vf-note-hit'));
  expect(first).toBeTruthy();
  const values = Array.from(first!.querySelectorAll('rect.vf-note-hit'))
    .map((rect) => rect.getAttribute('data-measure'))
    .filter((value): value is string => value !== null);
  return new Set(values).size;
}

/** 譜面が描き終わるまで待つ */
async function renderScore() {
  seedWork();
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
}

/** 1段目（先頭小節0）の左端をクリックして選択する */
function selectFirstSystemFromLeftEdge() {
  const edge = screen.getByTestId('system-select-left-0');
  fireEvent.click(edge);
}

describe('ScorePage: 段の選択とレイアウト調整パネル（Issue #482）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom は実レイアウトを持たないので、譜面の幅（小節幅の配分に使う）を固定する
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('段下のコントロール行は描画されない（譜面上に常設物を残さない）', async () => {
    await renderScore();
    expect(document.querySelector('.system-measure-override-controls')).toBeNull();
    // 段の下ではなく、選択したときだけ出るパネルへ移設されている
    expect(document.querySelector('.system-layout-panel')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('左端クリックで段が選択され、パネルが出る。Esc で選択が解ける', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();

    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });
    // 選択中の段には薄い枠のクラスが付く
    expect(screen.getByTestId('system-frame-0').className).toContain('system-select-frame--selected');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('system-layout-panel-0')).toBeNull();
    });
    expect(screen.getByTestId('system-frame-0').className).not.toContain('system-select-frame--selected');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('譜面の他の場所を押すと選択が解ける', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });

    fireEvent.mouseDown(document.querySelector('rect.vf-note-hit')!);
    await waitFor(() => {
      expect(screen.queryByTestId('system-layout-panel-0')).toBeNull();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パネルの ▶ が段の小節数を実際に増やし、Undo で戻る', async () => {
    await renderScore();
    const before = firstSystemMeasureCount();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });
    expect(screen.getByTestId('system-measure-count-0').textContent).toBe(`${before}小節`);

    fireEvent.click(screen.getByTestId('system-measure-increase-0'));
    await waitFor(() => {
      expect(firstSystemMeasureCount()).toBe(before + 1);
    }, { timeout: 15000 });
    expect(screen.getByTestId('system-measure-count-0').textContent).toBe(`${before + 1}小節`);

    // 従来の段下行と同じ state・同じ履歴の積み方なので、Undo で元の段割りへ戻る
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(firstSystemMeasureCount()).toBe(before);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パネルの ＋ が段の間隔を広げ、数値の直接入力でも変えられる', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });
    expect(screen.getByTestId('system-gap-value-0').textContent).toBe('+0px');

    fireEvent.click(screen.getByTestId('system-gap-increase-0'));
    await waitFor(() => {
      expect(screen.getByTestId('system-gap-value-0').textContent).toBe('+4px');
    });
    // 段の間隔は段のラッパーの marginTop として反映される（従来の段下行と同じ経路）
    expect((screen.getByTestId('system-frame-0') as HTMLElement).style.marginTop).toBe('4px');

    // 数値をクリックすると直接入力欄になり、Enter で確定する（途中変更オーバーレイと同じ型）
    fireEvent.click(screen.getByTestId('system-gap-value-0'));
    const input = await screen.findByTestId('system-gap-input-0');
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '12' } });
    await waitFor(() => {
      expect((screen.getByTestId('system-frame-0') as HTMLElement).style.marginTop).toBe('12px');
    }, { timeout: 15000 });
    // Enter は確定と同時に段の選択も解く（譜面上に常設物を残さない）
    expect(screen.queryByTestId('system-layout-panel-0')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
