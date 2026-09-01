// 小節番号を指定した途中再生（Issue #545）の ScorePage 配線テスト。
//
// 番号→小節インデックスの解決そのものは playbackPositionUtils.test.ts（純粋関数）で
// 網羅している。ここでは「再生・音色」タブの入力欄から実際に操作して、
// 再生エンジン（playParts）へ渡る小節列が指定小節から始まること＝配線を固定する。
// props 直接注入のテストだと ScorePage 側の受け渡しを消しても通ってしまうため
// （AGENTS.md「統合テスト（配線テスト）ルール」）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

/**
 * 再生エンジンを丸ごと差し替えて、「何を鳴らすよう指示されたか」だけを記録する。
 * 実際の音は鳴らさない（jsdom には AudioContext が無い）。
 */
const playPartsMock = vi.fn().mockResolvedValue(undefined);
const stopAllMock = vi.fn();
/** stopAll と playParts の呼び出し順を横断で記録する（再生中ジャンプの停止→頭出し検証用） */
const callOrder: string[] = [];
playPartsMock.mockImplementation(() => { callOrder.push('playParts'); return Promise.resolve(undefined); });
stopAllMock.mockImplementation(() => { callOrder.push('stopAll'); });
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: playPartsMock,
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stopAll: stopAllMock,
    dispose: vi.fn(),
    setInstrument: vi.fn(),
    setSoundProfile: vi.fn(),
    setSwingEnabled: vi.fn(),
    getAudioContext: () => null,
  }),
}));

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

/** 4分音符4つで1小節を作る（すべて同じ高さにして、何小節目かを音で見分けられるようにする） */
function measureOf(key: string, tempoMarking?: string) {
  const events = [0, 1, 2, 3].map((index) => ({
    dur: '4' as const,
    isRest: false,
    keys: [key],
    // 標語は小節の先頭音符にだけ置く
    ...(index === 0 && tempoMarking ? { tempoMarking } : {}),
  }));
  return { events, voices: [{ id: 'voice-1', events }] };
}

/**
 * 4小節の単旋律を作品として仕込む。
 * 2小節目に Allegro（=132）を置き、「開始位置より前のテンポ指定が引き継がれるか」も見る。
 */
function seedFourMeasureWork() {
  const data = createSavedScoreData(
    { title: '小節番号から再生', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        measureOf('c/4'),
        measureOf('d/4', 'Allegro'),
        measureOf('g/4'),
        measureOf('a/4'),
      ],
    }] as never,
    1,
    4,
    'single'
  );
  const created = createWork('小節番号から再生');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** 譜面の復元を待ってから「再生・音色」タブを開く */
async function renderAndOpenPlaybackTab() {
  render(<ScorePage />);

  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });

  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
}

describe('ScorePage: 小節番号を指定した途中再生（Issue #545）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    stopAllMock.mockClear();
    callOrder.length = 0;
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('番号を入れて再生すると、その小節からエンジンへ渡る（手前のテンポ指定も引き継ぐ）', async () => {
    seedFourMeasureWork();
    await renderAndOpenPlaybackTab();

    fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));

    await waitFor(() => {
      expect(playPartsMock).toHaveBeenCalled();
    }, { timeout: 15000 });

    const measures = playPartsMock.mock.calls[0][0][0].measures as Array<{
      bpm?: number;
      events: Array<{ keys: string[] }>;
    }>;

    // 3小節目（g/4）から末尾までの2小節だけが渡る
    expect(measures.length).toBe(2);
    expect(measures[0].events[0].keys).toEqual(['g/4']);
    expect(measures[1].events[0].keys).toEqual(['a/4']);
    // 2小節目に置いた Allegro は開始位置より手前だが、テンポは引き継がれる
    // （絞り込み前の全列でテンポを解決してから切り出す経路の担保）
    expect(measures[0].bpm).toBe(132);

    // 開始小節は画面にも出す（#318「操作は画面に出す」）
    await waitFor(() => {
      expect(screen.getByTestId('edit-notice').textContent).toContain('3小節目から再生します');
    }, { timeout: 5000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('総小節数を超える番号は理由つきで弾き、再生は始まらない（#318）', async () => {
    seedFourMeasureWork();
    await renderAndOpenPlaybackTab();

    fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));

    await waitFor(() => {
      expect(screen.getByTestId('edit-notice').textContent).toContain('この作品は4小節までのため');
    }, { timeout: 5000 });
    expect(playPartsMock).not.toHaveBeenCalled();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('再生中に番号を指定すると、停止（stopAll）してからその小節で鳴らし直す（round1 P2）', async () => {
    seedFourMeasureWork();
    await renderAndOpenPlaybackTab();

    // まず通常再生を開始する
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });

    // 再生中に番号ジャンプ → stopAll が先に走ってから2回目の playParts
    fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    const secondPlayAt = callOrder.lastIndexOf('playParts');
    const lastStopAt = callOrder.lastIndexOf('stopAll');
    expect(lastStopAt).toBeGreaterThan(-1);
    expect(lastStopAt).toBeLessThan(secondPlayAt);

    // 2回目はちゃんと2小節目の頭から
    const measures = playPartsMock.mock.calls[1][0][0].measures as Array<unknown>;
    expect(measures.length).toBe(3); // 4小節中、2小節目から末尾まで
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('番号ジャンプは小節の選択と Undo 履歴を変えない（round1 P2）', async () => {
    seedFourMeasureWork();
    await renderAndOpenPlaybackTab();

    // Undo 履歴の基準: ジャンプ前に「元に戻す」が無効であること
    const undoButton = screen.getByRole('button', { name: '元に戻す' }) as HTMLButtonElement;
    const undoDisabledBefore = undoButton.disabled;

    fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalled(); }, { timeout: 15000 });

    // 選択マーカーが増えず、Undo の有効状態も変わらない（履歴が積まれていない）
    expect(document.querySelector('rect.vf-measure-selected')).toBeNull();
    expect((screen.getByRole('button', { name: '元に戻す' }) as HTMLButtonElement).disabled).toBe(undoDisabledBefore);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('小節を選択したまま番号再生すると、案内が Escape での選択解除に言及する（round2 P2）', async () => {
    seedFourMeasureWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 音符・休符タブの小節選択ツールで1小節目を選択する
    const selectTool = await screen.findByRole('button', { name: /小節選択/ }, { timeout: 15000 });
    fireEvent.click(selectTool);
    const hits = Array.from(document.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
    const byX = new Map<number, SVGRectElement>();
    hits.forEach((h) => {
      const x = Math.round(parseFloat(h.getAttribute('x') ?? '0'));
      if (!byX.has(x)) byX.set(x, h);
    });
    const first = [...byX.entries()].sort((a, b) => a[0] - b[0])[0]?.[1] as SVGRectElement;
    expect(first).toBeTruthy();
    fireEvent.mouseDown(first, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(first, { clientX: 10, clientY: 10 });
    fireEvent.click(first, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(document.querySelector('rect.vf-measure-selected')).toBeTruthy();
    }, { timeout: 15000 });

    // 選択が残ったまま番号再生 → 案内は「Escape で選択を外し…」の側になる
    //（引数を常に false に退行させるとこのテストが落ちる）
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));
    await waitFor(() => {
      const notice = screen.queryByTestId('edit-notice');
      expect(notice?.textContent).toContain('3小節目から再生します');
      expect(notice?.textContent).toContain('Escape で小節の選択を外し');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
