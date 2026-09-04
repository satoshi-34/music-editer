// Issue #569（連符ボタンの1個+▾ 集約）の ScorePage 配線テスト。
//
// Palette 単体テスト（PaletteTupletVariant）は onChange の中身までしか見ないので、
// ScorePage が受け取った連符ツールを譜面へ渡す配線が切れても通ってしまう。
// ここでは実クリックだけで
//   （1）既定の3連符が1クリックのまま置けること
//   （2）▾ で選んだ5連符が「選ぶ→譜面をクリック」の2手で置けること
//        （タブを往復しても選択が残ること＝保持が ScorePage 側にあること・round1 P2）
// を、保存データ（比率）と描画（vf-tuplet）の両方で固定する。
//
// ScorePage の全体マウントは重いので、1ファイル1マウント（2小節に続けて置く）にしている。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, within } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, loadWorkAutosaveData, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
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

/** 4/4 の空小節1つ。連符は必ずこの1小節目へ置く（どの小節へ入ったかで揺れないため） */
function seedWork(title: string) {
  const events: never[] = [];
  const data = createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single', 'C', [4, 4]
  );
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/**
 * 1小節目の背景（rect.vf-hit）をクリックして音符を置く。
 * どの小節を指すかで結果が揺れないよう、常に「いちばん最初に現れる背景」＝1小節目だけを使う
 * （段は複数あり、後ろの段には音符を置けない空段の埋め草も混ざるため）。
 */
function clickFirstMeasureBackground() {
  const background = document.querySelector('rect.vf-hit') as SVGRectElement | null;
  expect(background, '小節背景').toBeTruthy();
  const svg = background!.ownerSVGElement as SVGSVGElement;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 700, bottom: height, width: 700, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  const x = parseFloat(background!.getAttribute('x')!) + parseFloat(background!.getAttribute('width')!) / 2;
  const y = parseFloat(background!.getAttribute('y')!) + parseFloat(background!.getAttribute('height')!) / 2;
  fireEvent.click(background!, { clientX: x, clientY: y });
}

/** 保存データから、指定小節に入った連符グループの比率を読む */
async function expectSavedTuplet(workId: string, measureIndex: number, numNotes: number, notesOccupied: number) {
  await waitFor(() => {
    const saved = loadWorkAutosaveData(workId);
    expect(saved.success).toBe(true);
    const events = saved.data?.parts?.[0]?.measures?.[measureIndex]?.events ?? [];
    const tupletEvents = events.filter(ev => ev.tuplet);
    expect(tupletEvents.length).toBe(numNotes);
    expect(tupletEvents[0].tuplet?.numNotes).toBe(numNotes);
    expect(tupletEvents[0].tuplet?.notesOccupied).toBe(notesOccupied);
  }, { timeout: 15000 });
}

describe('連符ボタン1個+▾ の ScorePage 配線（#569）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('既定の3連符は、連符ボタンを1クリックするだけで置ける（従来のワークフロー）', async () => {
    const workId = seedWork('既定3連符の配線');
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 8分音符ツール + 連符ボタン1クリック（プルダウンを開かない）
    fireEvent.click(screen.getByRole('button', { name: '音符 8分' }));
    fireEvent.click(screen.getByRole('button', { name: /^3連符（3:2）/ }));
    clickFirstMeasureBackground();

    await expectSavedTuplet(workId, 0, 3, 2);
    await waitFor(() => {
      expect(document.querySelectorAll('g.vf-tuplet').length).toBeGreaterThan(0);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('5連符は ▾ →「5連符」の2クリックで選べ、そのまま譜面へ置ける', async () => {
    const workId = seedWork('5連符の配線');
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('button', { name: '音符 8分' }));
    // クリック1: ▾ を開く
    fireEvent.click(screen.getByRole('button', { name: /^連符の種類を選ぶ/ }));
    const menu = document.querySelector('[role="group"][aria-label^="連符の種類を選ぶ"]') as HTMLElement | null;
    expect(menu, 'プルダウン').toBeTruthy();
    // クリック2: 5連符を選ぶ（選んだ時点で有効になるので、押し直しは要らない）
    fireEvent.click(within(menu!).getByRole('button', { name: /^5連符（5:4）/ }));

    // ボタンの表示も選んだ連符へ変わる（次からは1クリックで5連符）
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^5連符（5:4）/ }).textContent).toBe('5連符');
    }, { timeout: 15000 });

    // いったん連符をOFFにしてから「演奏記号」タブへ行って戻る。
    // パレットは音符タブ以外ではアンマウントされるので、選んだ連符を Palette の state に
    // 置いていると、ここで既定の3連符へ戻ってしまう（#569 round1 P2 の差し戻し理由）。
    // OFFにしてから往復するのは、ONのままだと「いま有効な連符」から表示を作れてしまい、
    // 保持が効いているのかどうかを見分けられないため。
    fireEvent.click(screen.getByRole('button', { name: /^5連符（5:4）/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^5連符（5:4）/ }).getAttribute('aria-pressed')).toBe('false');
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /連符（/ }).length).toBe(0);
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '音符・休符' }));

    // 戻ってきても5連符のまま。押し直し1クリックで有効になる（▾ を開き直さなくてよい）
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^5連符（5:4）/ }).textContent).toBe('5連符');
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /^5連符（5:4）/ }));

    clickFirstMeasureBackground();

    // 選んだ連符が ScorePage を通って譜面まで届いている（5:4 のグループが保存される）
    await expectSavedTuplet(workId, 0, 5, 4);
    await waitFor(() => {
      expect(document.querySelectorAll('g.vf-tuplet').length).toBeGreaterThan(0);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
