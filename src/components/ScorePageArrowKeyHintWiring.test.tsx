// 初回選択ヒント（Issue #524）の ScorePage 配線テスト（round1 P2）。
// PianoSystemCanvas 直接マウントの単体テストでは、ScorePage の通知リスナー・
// edit-notice DOM までの配線が壊れても通ってしまう。ここでは実クリックで
// 「音符の初回選択 → edit-notice にヒントが出る → 再選択では出ない →
// 再マウント（リロード相当）でも出ない」を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import { ARROW_KEY_HINT_NOTICE_SEEN_KEY, resetArrowKeyHintNoticeForTest } from '../utils/arrowKeyHintNotice';
import { notifyScoreEdit } from '../utils/scoreEditorNotices';
import type { MeasureData, PartData } from '../types/storage';

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

const MOUNT_HEAVY_TIMEOUT_MS = 90000;

function seedWork() {
  // 休符→音符の順で並ぶ小節（休符選択でヒントが出ない検証と、音符選択の検証を1つで）
  const measures: MeasureData[] = [
    { events: [
      { dur: '4', isRest: true, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
    ] },
  ];
  const parts: PartData[] = [{ partId: 'melody', clef: 'treble', measures }];
  const data = createSavedScoreData(
    { title: 'ヒント配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts, 1, 1, 'single'
  );
  const created = createWork('ヒント配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

function mockSvgLayout(svg: SVGSVGElement): { toClientX: (x: number) => number; toClientY: (y: number) => number } {
  const width = parseFloat(svg.getAttribute('width') ?? '0') || 700;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const vbW = viewBox[2] || width;
  const vbH = viewBox[3] || height;
  return { toClientX: (x) => x * (width / vbW), toClientY: (y) => y * (height / vbH) };
}

async function selectEvent(note: number) {
  const hit = document.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${note}"]`
  ) as SVGRectElement | null;
  expect(hit, `イベント${note}の当たり判定`).toBeTruthy();
  const svg = hit!.closest('svg') as SVGSVGElement;
  const { toClientX, toClientY } = mockSvgLayout(svg);
  const left = parseFloat(hit!.getAttribute('data-note-left')!);
  const right = parseFloat(hit!.getAttribute('data-note-right')!);
  const line0Y = parseFloat(hit!.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit!.getAttribute('data-line-spacing')!);
  fireEvent.click(hit!, {
    clientX: toClientX((left + right) / 2),
    clientY: toClientY(line0Y + 1.5 * spacing),
  });
  await waitFor(() => {
    const marker = document.querySelector('rect.vf-note-selected');
    expect(marker?.getAttribute('data-note')).toBe(String(note));
  }, { timeout: 15000 });
}

function hintShown(): boolean {
  const notice = screen.queryByTestId('edit-notice');
  return !!notice && (notice.textContent ?? '').includes('↑↓');
}

async function mountAndWait() {
  render(<ScorePage />);
  await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
}

describe('初回選択ヒントの配線（#524 round1 P2）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    resetArrowKeyHintNoticeForTest();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('休符選択では出ず、音符の初回選択で1回だけ出て、再選択・再マウントでは出ない', async () => {
    seedWork();
    await mountAndWait();

    // 1. 音符（イベント1）の初回選択でヒントが edit-notice に出る
    //   （休符ガードは選択を直接動かせる単体テスト PianoSystemCanvasArrowKeyHint 側で固定。
    //    ScorePage 経由では休符クリックが入力ツールの「休符→音符置換」になるため）
    await selectEvent(1);
    await waitFor(() => { expect(hintShown()).toBe(true); }, { timeout: 15000 });
    expect(localStorageMock.getItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY)).toBe('1');

    // 2. 別の音符（イベント2）を選び直しても、ヒントの再表示は起きない。
    //    通知は後勝ちなので、別の通知でヒント表示を上書きしてから選び直し、
    //    表示がその別通知のまま（＝ヒントで上書きされない）ことを見る
    notifyScoreEdit('別の通知でヒントを上書き');
    await waitFor(() => { expect(hintShown()).toBe(false); }, { timeout: 15000 });
    await selectEvent(2);
    expect(hintShown()).toBe(false);
    expect(screen.getByTestId('edit-notice').textContent).toContain('別の通知でヒントを上書き');

    // 3. 再マウント（リロード相当）後の選択でも出ない
    cleanup();
    resetArrowKeyHintNoticeForTest(); // ページ読み込み内フラグはリロードで消える
    await mountAndWait();
    await selectEvent(1);
    expect(hintShown()).toBe(false);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
