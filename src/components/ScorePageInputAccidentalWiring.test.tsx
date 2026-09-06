// 入力用臨時記号（Issue #470）の ScorePage 配線テスト（round1 P2）。
// PianoSystemCanvas への props 直接注入の単体テストだけでは、ScorePage からの
// ボタン配線・保存・Undo 単位が切れても通ってしまう。ここでは実クリックで
// 「♯入力トグル → 譜面クリック → ♯付き音符が保存される → Undo 1回で戻る」を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, getLastOpenedWorkId, loadWorkAutosaveData, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

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

function seedWork() {
  // 音符1つ+休符（クリック入力は既存の音符の当たり判定を基準に「その後ろへ置く」ため、
  // 起点になる音符を1つ用意しておく。単体テスト PianoSystemCanvasInputAccidental と同じ流儀）
  const events = [
    { dur: '4' as const, isRest: false, keys: ['b/4'] },
    { dur: '4' as const, isRest: true, keys: ['b/4'] },
    { dur: '4' as const, isRest: true, keys: ['b/4'] },
  ];
  const data = createSavedScoreData(
    { title: '入力臨時記号', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('入力臨時記号');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

function clickAfterFirstNote() {
  const hitForSvg = document.querySelector('rect.vf-note-hit') as SVGRectElement;
  const svg = hitForSvg?.ownerSVGElement as SVGSVGElement;
  expect(svg).toBeTruthy();
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 700, bottom: height, width: 700, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  // 2つ目のイベント（休符）の当たり判定をクリック=「休符を音符へ置き換える」
  // （単体テスト PianoSystemCanvasInputAccidental の休符ケースと同じ経路）
  const hit = document.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
  expect(hit).toBeTruthy();
  const x = parseFloat(hit.getAttribute('x')!) + parseFloat(hit.getAttribute('width')!) / 2;
  const y = parseFloat(hit.getAttribute('y')!) + parseFloat(hit.getAttribute('height')!) / 2;
  fireEvent.click(hit, { clientX: x, clientY: y });
}

describe('入力用臨時記号の配線（#470 round1 P2）', () => {
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

  it('♯入力トグル→譜面クリックで ♯付き音符が入り、保存され、Undo 1回で戻る', async () => {
    const workId = seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 4分音符 + 入力用♯ をON
    fireEvent.click(screen.getByRole('button', { name: '音符 4分' }));
    const sharpToggleButton = screen.getByRole('button', { name: /^臨時記号: シャープ/ });
    fireEvent.click(sharpToggleButton);
    expect(sharpToggleButton.style.border).toContain('2px'); // ON になっている前提を固定
    clickAfterFirstNote();

    // 自動保存（1.5秒デバウンス）で ♯付き音符が作品へ入る
    await waitFor(() => {
      const saved = loadWorkAutosaveData(workId);
      expect(saved.success).toBe(true);
      const events = saved.data?.parts?.[0]?.measures?.[0]?.events ?? [];
      const notes = events.filter(ev => !ev.isRest);
      expect(notes.length).toBe(2); // 起点の音符+置いた音符
      // 置いた音符（位置はクリック座標次第なので特定しない）に ♯ が付いている
      expect(notes.some(note => JSON.stringify(note.keys).includes('#'))).toBe(true);
    }, { timeout: 15000 });

    // Undo 1回で配置ごと戻る（「音符を置く+♯」が1操作である証拠）
    fireEvent.click(screen.getByRole('button', { name: /元に戻す/ }));
    await waitFor(() => {
      const saved = loadWorkAutosaveData(getLastOpenedWorkId()!);
      const events = saved.data?.parts?.[0]?.measures?.[0]?.events ?? [];
      // Undo 1回で「置いた♯付き音符」ごと消え、起点の1音だけへ戻る
      expect(events.filter(ev => !ev.isRest).length).toBe(1);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('R キーで休符へ切り替えると入力用臨時記号は外れる（ON表示のまま効かない状態を作らない）', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('button', { name: '音符 4分' }));
    const sharpToggle = screen.getByRole('button', { name: /^臨時記号: シャープ/ });
    fireEvent.click(sharpToggle);
    expect(sharpToggle.style.border).toContain('2px'); // ON 表示

    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      // 休符モードでは ♯入力トグルが OFF 表示へ戻る（#318: ONなのに効かない、を作らない）
      expect(sharpToggle.style.border).not.toContain('2px');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
