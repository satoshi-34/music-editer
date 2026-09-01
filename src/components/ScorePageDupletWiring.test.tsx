// 2連符・4連符（Issue #472）の ScorePage 配線テスト（round1 P2）。
// PianoSystemCanvas への props 直接注入の単体テスト（PianoSystemCanvasDupletPlacement）
// だけでは、Palette のボタン→ScorePage の tool 中継が切れても通ってしまう。
// ここでは実クリック（パレットの「2連符」/「4連符」→ 譜面クリック）で、
// 保存データに 2:3 / 4:3 の連符グループが入ることを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
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

function seedWork(title: string) {
  // 2連符が使われる代表拍子 6/8 の空小節（単体テスト PianoSystemCanvasDupletPlacement と
  // 同じ「小節背景クリック=新規挿入」経路を ScorePage 側から通す）
  const events: never[] = [];
  const data = createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single', 'C', [6, 8]
  );
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

function clickMeasureBackground() {
  const background = document.querySelector('rect.vf-hit') as SVGRectElement;
  expect(background).toBeTruthy();
  const svg = background.ownerSVGElement as SVGSVGElement;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 700, bottom: height, width: 700, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  const x = parseFloat(background.getAttribute('x')!) + parseFloat(background.getAttribute('width')!) / 2;
  const y = parseFloat(background.getAttribute('y')!) + parseFloat(background.getAttribute('height')!) / 2;
  fireEvent.click(background, { clientX: x, clientY: y });
}

async function placeTuplet(workId: string, buttonName: RegExp, numNotes: number, notesOccupied: number) {
  render(<ScorePage />);
  await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

  // 8分音符ツール + N連符トグル ON → 空小節の背景をクリック（新規挿入経路）
  fireEvent.click(screen.getByRole('button', { name: '音符 8分' }));
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  clickMeasureBackground();

  await waitFor(() => {
    const saved = loadWorkAutosaveData(workId);
    expect(saved.success).toBe(true);
    const events = saved.data?.parts?.[0]?.measures?.[0]?.events ?? [];
    const tupletEvents = events.filter(ev => ev.tuplet);
    // 音符1+休符(N-1)のグループが 1つ入り、比率が N:notesOccupied
    expect(tupletEvents.length).toBe(numNotes);
    expect(tupletEvents[0].tuplet?.numNotes).toBe(numNotes);
    expect(tupletEvents[0].tuplet?.notesOccupied).toBe(notesOccupied);
  }, { timeout: 15000 });

  // 保存だけでなく描画も壊れていないこと（round2 P2）: 再描画された SVG に
  // 連符グループ（ブラケット+数字。vf-tuplet）が現れる
  await waitFor(() => {
    const tupletGroups = document.querySelectorAll('g.vf-tuplet');
    expect(tupletGroups.length).toBeGreaterThan(0);
    // 数字（N）がテキストとして描画されている（VexFlow はグリフの rect で数字を組む）
    expect(tupletGroups[0].querySelectorAll('rect').length).toBeGreaterThan(0);
  }, { timeout: 15000 });
}

describe('2連符・4連符のパレット配線（#472 round1 P2）', () => {
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

  it('パレットの「2連符」→譜面クリックで 2:3 のグループが保存される', async () => {
    const workId = seedWork('2連符配線');
    await placeTuplet(workId, /^2連符（2:3）/, 2, 3);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パレットの「4連符」→譜面クリックで 4:3 のグループが保存される', async () => {
    const workId = seedWork('4連符配線');
    await placeTuplet(workId, /^4連符（4:3）/, 4, 3);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
