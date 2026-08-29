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
import SystemLayoutPanel from './SystemLayoutPanel';
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

/** 譜種ごとの作品を仕込む（4譜種すべての SystemSelectFrame 配線を固定するため） */
function seedTypedWork(scoreType: 'single' | 'piano' | 'quartet' | 'ensemble') {
  const measures = () => Array.from({ length: MEASURE_COUNT }, sparseMeasure);
  const parts =
    scoreType === 'single' ? [{ partId: 'melody', clef: 'treble' as const, measures: measures() }]
    : scoreType === 'piano' ? [
        { partId: 'right-hand', clef: 'treble' as const, measures: measures() },
        { partId: 'left-hand', clef: 'bass' as const, measures: measures() },
      ]
    : scoreType === 'quartet' ? [
        { partId: 'violin-1', clef: 'treble' as const, measures: measures() },
        { partId: 'violin-2', clef: 'treble' as const, measures: measures() },
        { partId: 'viola', clef: 'alto' as const, measures: measures() },
        { partId: 'cello', clef: 'bass' as const, measures: measures() },
      ]
    : [
        // 編成譜は既定編成（室内オーケストラ）の先頭パートにだけ音を入れる。
        // 残りのパートは復元時に空配列で補われる（実装の既定挙動）
        { partId: 'flute', clef: 'treble' as const, measures: measures() },
      ];
  const data = createSavedScoreData(
    { title: '段選択テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    scoreType
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
async function renderScore(scoreType: 'single' | 'piano' | 'quartet' | 'ensemble' = 'single') {
  seedTypedWork(scoreType);
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

  // Codex round1 P1: document の mousedown（選択解除）が blur より先に走り、
  // 入力欄がアンマウントされて「フォーカスを外して確定」が失われるレース
  it('直接入力の途中で譜面の他の場所を押しても、入力していた値で確定される', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('system-gap-value-0'));
    const input = await screen.findByTestId('system-gap-input-0');
    fireEvent.change(input, { target: { value: '12' } });
    // Enter を押さずに譜面をクリック → パネルは閉じるが、値は失われない
    fireEvent.mouseDown(document.querySelector('rect.vf-note-hit')!);
    await waitFor(() => {
      expect(screen.queryByTestId('system-layout-panel-0')).toBeNull();
    });
    await waitFor(() => {
      expect((screen.getByTestId('system-frame-0') as HTMLElement).style.marginTop).toBe('12px');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('小節数も直接入力で変えられる', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('system-measure-count-0'));
    const input = await screen.findByTestId('system-measure-input-0');
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '1' } });
    await waitFor(() => {
      expect(firstSystemMeasureCount()).toBe(1);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round1 P2: 範囲外の入力を黙って捨てない（#318「行き止まりは喋る」）
  it('範囲外の間隔を入力すると端の値へ丸め、その旨を通知する', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('system-gap-value-0'));
    const input = await screen.findByTestId('system-gap-input-0');
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '999' } });
    // 上限（+50px）へ丸めて適用され、丸めた理由が画面に出る
    await waitFor(() => {
      expect((screen.getByTestId('system-frame-0') as HTMLElement).style.marginTop).toBe('50px');
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('間隔は -60〜50 の範囲で指定できます');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round3 P2: 空文字での確定は Number('')===0 に化けず、変更せず理由を通知する
  it('入力を消して確定しても値は変わらず、読み取れなかった旨を通知する', async () => {
    await renderScore();
    selectFirstSystemFromLeftEdge();
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('system-measure-count-0'));
    const input = await screen.findByTestId('system-measure-input-0');
    fireEvent.keyDown(input, { key: 'Enter', target: { value: '' } });
    await waitFor(() => {
      expect(document.body.textContent).toContain('小節数を数値として読み取れなかった');
    }, { timeout: 15000 });
    // 段割りは変わらない（空文字が 0 → 1小節へ化けない）
    expect(firstSystemMeasureCount()).toBe(2);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round3 P2: 編集バッファ段（内容末尾より後ろ）の実配線。
  // ScorePage が maxMeasureCount へ「最低でも現在値」を渡していないと、
  // 値を変えない確定だけで段がクランプで縮む（round2 P2 の配線側の固定）
  it('＋小節を追加で作ったバッファ段では、値を変えない確定で小節数が縮まない', async () => {
    await renderScore();
    // バッファ段（内容8小節の直後・start=8）を2小節ぶん作る
    const addButton = screen.getByRole('button', { name: '＋ 小節を追加' });
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    await waitFor(() => {
      expect(screen.getAllByTestId('system-select-left-8').length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    fireEvent.click(screen.getAllByTestId('system-select-left-8')[0]);
    await waitFor(() => {
      expect(screen.getByTestId('system-layout-panel-8')).toBeTruthy();
    });
    expect(screen.getByTestId('system-measure-count-8').textContent).toBe('2小節');

    // 直接入力を開き、値を変えずに blur で確定 → クランプで縮まない・丸め通知も出ない
    fireEvent.click(screen.getByTestId('system-measure-count-8'));
    const input = await screen.findByTestId('system-measure-input-8');
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.queryByTestId('system-measure-input-8')).toBeNull();
    });
    expect(screen.getByTestId('system-measure-count-8').textContent).toBe('2小節');
    expect(document.body.textContent).not.toContain('丸めて適用しました');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round1 P2: 4譜種すべての Staff コンポーネントで SystemSelectFrame の配線が生きている
  for (const scoreType of ['piano', 'quartet', 'ensemble'] as const) {
    it(`${scoreType} でも右端クリックで段が選択され、パネルが出る`, async () => {
      await renderScore(scoreType);
      const edge = screen.getAllByTestId('system-select-right-0')[0];
      fireEvent.click(edge);
      await waitFor(() => {
        expect(screen.getByTestId('system-layout-panel-0')).toBeTruthy();
      }, { timeout: 15000 });
    }, MOUNT_HEAVY_TIMEOUT_MS);
  }
});

// SystemLayoutPanel 単体: 確定経路の呼び出し回数を厳密に固定する
// （ScorePage 実マウントでは差分の合算結果しか見えず、二重確定を見逃すため）
describe('SystemLayoutPanel: 直接入力の確定は一度だけ（Codex round2 P1）', () => {
  function renderPanel(overrides: Partial<React.ComponentProps<typeof SystemLayoutPanel>> = {}) {
    const onGapDelta = vi.fn();
    const onMeasureDelta = vi.fn();
    render(
      <SystemLayoutPanel
        systemLabel="段1"
        side="left"
        startMeasure={0}
        measureCount={2}
        maxMeasureCount={4}
        canDecreaseMeasure
        canIncreaseMeasure
        onMeasureDelta={onMeasureDelta}
        gapPx={0}
        gapMinPx={-60}
        gapMaxPx={50}
        gapStepPx={4}
        onGapDelta={onGapDelta}
        onClose={() => {}}
        onNotice={() => {}}
        {...overrides}
      />
    );
    return { onGapDelta, onMeasureDelta };
  }

  afterEach(() => cleanup());

  it('通常の blur で一度だけ確定される（クリーンアップで二重適用されない）', async () => {
    const { onGapDelta } = renderPanel();
    fireEvent.click(screen.getByTestId('system-gap-value-0'));
    const input = await screen.findByTestId('system-gap-input-0');
    fireEvent.change(input, { target: { value: '12' } });
    // blur → onCommit → setEditing(null) → 入力欄アンマウント（クリーンアップが走る）
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.queryByTestId('system-gap-input-0')).toBeNull();
    });
    expect(onGapDelta).toHaveBeenCalledTimes(1);
    expect(onGapDelta).toHaveBeenCalledWith(12);
  });

  it('編集バッファ段（上限=現在値）では、値を変えない確定で小節数が動かない', async () => {
    // ScorePage 側は maxMeasureCount に最低でも現在値を渡す（round2 P2）。
    // その前提で、現在値のままの確定が no-op になることを固定する
    const { onMeasureDelta } = renderPanel({ measureCount: 3, maxMeasureCount: 3 });
    fireEvent.click(screen.getByTestId('system-measure-count-0'));
    const input = await screen.findByTestId('system-measure-input-0');
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.queryByTestId('system-measure-input-0')).toBeNull();
    });
    expect(onMeasureDelta).not.toHaveBeenCalled();
  });
});
