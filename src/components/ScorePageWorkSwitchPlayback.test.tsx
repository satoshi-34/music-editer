// 作品切替直後の再生（Issue #609）の ScorePage 配線テスト。
// 運用者QA: 作品Aを再生→停止→作品一覧でBへ切替→再生、で **A が流れた**（画面はB）。
// 原因は、切替の復元（applyLoadedScoreData）が非同期なのに再生ボタンは復元中も押せ、
// handlePlay が押した時点の譜面 state（＝まだA）で小節列を組むこと。
// ここでは実操作（作品一覧→再生ボタン）で「切替後に鳴るのは必ず切替先」を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import { SCORE_EDIT_NOTICE_EVENT, type ScoreEditNoticeDetail } from '../utils/scoreEditorNotices';

const playPartsMock = vi.fn();
const stopAllMock = vi.fn();
const initializeMock = vi.fn();
const suspendMock = vi.fn();
const resumeMock = vi.fn();
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: initializeMock,
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: playPartsMock,
    suspend: suspendMock,
    resume: resumeMock,
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
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** 1小節・全音符1つの作品を作る。音高で「どの作品が鳴ったか」を見分ける */
function seedWork(title: string, key: string): string {
  const events = [{ dur: '1' as const, isRest: false, keys: [key] }];
  const data = createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  return created.data.id;
}

/** playParts に渡った小節列から、先頭パートの音高だけを取り出す */
function playedKeys(callIndex: number): string[] {
  const parts = playPartsMock.mock.calls[callIndex][0] as { measures: { events: { keys?: string[] }[] }[] }[];
  return parts[0].measures.flatMap((m) => m.events.flatMap((ev) => ev.keys ?? []));
}

function openPlaybackTab() {
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
}

/** 作品一覧を開いてタイトルで選ぶ（実操作と同じ経路）。await しない＝復元中のまま返す */
function selectWork(title: string) {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  fireEvent.click(screen.getByTestId('work-list-toggle'));
  fireEvent.click(screen.getByText(title));
}

async function renderWithWorks() {
  seedWork('作品B', 'e/4');
  const idA = seedWork('作品A', 'c/5');
  setLastOpenedWorkId(idA);
  render(<ScorePage />);
  await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
}

describe('作品切替直後の再生は切替先が鳴る（Issue #609）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockReset();
    // 起点は呼び出し時刻にする（0 だと経過時間が巨大になり、即座に鳴り終わった扱いになる）
    playPartsMock.mockImplementation(async () => ({ scheduledAtMs: Date.now() }));
    initializeMock.mockReset();
    initializeMock.mockResolvedValue(undefined);
    suspendMock.mockReset();
    suspendMock.mockResolvedValue(undefined);
    resumeMock.mockReset();
    resumeMock.mockResolvedValue(undefined);
    stopAllMock.mockReset();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('A再生→停止→Bへ切替→即再生: 復元中は始めず理由を伝え、復元後の再生はBが鳴る（仕様1・2）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    expect(playedKeys(0)).toEqual(['c/5']);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));

    const notices: string[] = [];
    const onNotice = (e: Event) => { notices.push((e as CustomEvent<ScoreEditNoticeDetail>).detail.message); };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      // 切替を待たずに再生タブへ戻って「再生」を押す（復元の await 中）
      selectWork('作品B');
      openPlaybackTab();
      const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
      // ボタンは無効で、理由がツールチップに出る
      expect(playButton.disabled).toBe(true);
      expect(playButton.title).toContain('読み込み中');
      // 無効なボタンの click は React に届かないので、handlePlay の**別の入口**（小節番号を
      // 指定した再生・#545）から復元中に要求を送る。この入口は無効化していないので、
      // handlePlay 入口のガード（ref）が効いていなければ A の小節列で playParts が呼ばれる
      fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '1' } });
      fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));
      // 復元が終わるとボタンが戻る
      await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
    // 復元中の要求で前の作品（A）が鳴っていない。理由は通知で伝わる（#318）
    expect(playPartsMock).toHaveBeenCalledTimes(1);
    expect(notices.join('\n')).toContain('読み込んでいる途中');

    // 復元後に押せば、鳴るのはB
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('A再生中→Bへ切替: 切替時に stopAll が呼ばれて停止し、その後の再生はBが鳴る（仕様3）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    stopAllMock.mockClear();

    selectWork('作品B');
    // 切替でAの予約（先読み窓の後続を含む）が世代交代で黙る
    expect(stopAllMock).toHaveBeenCalled();
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('A一時停止中→Bへ切替→再生: 再開（resume）ではなくBを最初から鳴らす（仕様4）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再開' })).toBeTruthy(); }, { timeout: 15000 });

    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    // 一時停止は切替で解かれ、ボタンは「再生」に戻る（「再開」のままだと resume で A の続きが鳴る）
    const playButton = await screen.findByRole('button', { name: '再生' }, { timeout: 15000 }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);
  it('再生開始の準備（initialize）待ちの間にBへ切り替えると、Aは予約されない（round1 P1）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    // 音源の準備を止めておく（SoundFont の読み込み待ちに相当）
    let finishInitialize: () => void = () => {};
    initializeMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishInitialize = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(initializeMock).toHaveBeenCalled(); });
    expect(playPartsMock).not.toHaveBeenCalled();

    // 準備待ちのまま作品を切り替え、そのあとで準備が明ける
    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    finishInitialize();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 失効した要求は A を予約しない。「再生中」にも戻らない
    expect(playPartsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '一時停止' })).toBeNull();

    // 改めて押せば B が鳴る
    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    expect(playedKeys(0)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('予約（playParts）待ちの間にBへ切り替えると、明けた時点で止めて「再生中」に戻らない（round1 P1）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    let finishPlayParts: () => void = () => {};
    playPartsMock.mockImplementationOnce(() => new Promise<{ scheduledAtMs: number }>((resolve) => {
      finishPlayParts = () => resolve({ scheduledAtMs: Date.now() });
    }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });
    expect(playedKeys(0)).toEqual(['c/5']);
    stopAllMock.mockClear();

    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    finishPlayParts();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 予約済みだった A の音は止められ、UI は再生中にならない
    expect(stopAllMock).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '一時停止' })).toBeNull();

    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('一時停止（suspend）待ちの間にBへ切り替えると paused に戻らず、Bの再生は最初から鳴る（round2 P1）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    let finishSuspend: () => void = () => {};
    suspendMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSuspend = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await waitFor(() => { expect(suspendMock).toHaveBeenCalled(); });

    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    finishSuspend();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 古い一時停止が stopped を paused で上書きしない（「再開」が出ない）
    expect(screen.queryByRole('button', { name: '再開' })).toBeNull();
    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    // resume 経路ではなく、B の小節列で playParts が呼ばれる
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('再開（resume）待ちの間にBへ切り替えると、明けても「再生中」に戻らない（round2 P1）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再開' })).toBeTruthy(); }, { timeout: 15000 });
    let finishResume: () => void = () => {};
    resumeMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishResume = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '再開' }));
    await waitFor(() => { expect(resumeMock).toHaveBeenCalled(); });
    stopAllMock.mockClear();

    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    finishResume();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 明けた再開は playing にもタイマーにも戻らず、音は止め直される
    expect(screen.queryByRole('button', { name: '一時停止' })).toBeNull();
    expect(stopAllMock).toHaveBeenCalled();
    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('Aの予約待ちが明ける前にBを再生した場合、Aの後始末でBを止めない（round3 P1）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    let finishPlayParts: () => void = () => {};
    playPartsMock.mockImplementationOnce(() => new Promise<{ scheduledAtMs: number }>((resolve) => {
      finishPlayParts = () => resolve({ scheduledAtMs: Date.now() });
    }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(1); }, { timeout: 15000 });

    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    // 切替の時点で A は止められている（予約待ちでも stopAll が走る）
    expect(stopAllMock).toHaveBeenCalled();
    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    expect(playedKeys(1)).toEqual(['e/4']);
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });

    // ここで A の古い予約待ちが明ける。B は止まらず「再生中」のまま
    stopAllMock.mockClear();
    finishPlayParts();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stopAllMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('Aの再開待ちが明ける前にBを再生した場合も、Bを止めない（round3 P1）', async () => {
    await renderWithWorks();
    openPlaybackTab();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: '再開' })).toBeTruthy(); }, { timeout: 15000 });
    let finishResume: () => void = () => {};
    resumeMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishResume = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '再開' }));
    await waitFor(() => { expect(resumeMock).toHaveBeenCalled(); });

    selectWork('作品B');
    openPlaybackTab();
    await waitFor(() => { expect(screen.getAllByText('作品B').length).toBeGreaterThan(0); }, { timeout: 15000 });
    const playButton = screen.getByRole('button', { name: '再生' }) as HTMLButtonElement;
    await waitFor(() => { expect(playButton.disabled).toBe(false); }, { timeout: 15000 });
    fireEvent.click(playButton);
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalledTimes(2); }, { timeout: 15000 });
    await waitFor(() => { expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy(); }, { timeout: 15000 });

    stopAllMock.mockClear();
    finishResume();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stopAllMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
