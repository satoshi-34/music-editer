// 記号ドラッグ（Issue #522）の ScorePage 配線テスト（round1 P3）。
// PianoSystemCanvas 直接マウントの単体テストでは、ScorePage の演奏記号タブ→
// symbolsClickable→保存（作品データ）→Undo までの配線が壊れても通ってしまう。
// ここでは実経路（タブ切替→記号クリックで✥→ポインタドラッグ）で固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, loadWorkAutosaveData, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

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

function attrNumber(el: Element, name: string, fallback: number): number {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// jsdom はレイアウトしないので、座標変換（clientToGroup）が使う実測値を SVG 全体に作る
function mockSvgLayoutOnPrototype() {
  SVGSVGElement.prototype.getBoundingClientRect = function (this: SVGSVGElement) {
    const width = attrNumber(this, 'width', 700);
    const height = attrNumber(this, 'height', 100);
    return { left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(SVGSVGElement.prototype, 'width', {
    get(this: SVGSVGElement) { return { baseVal: { value: attrNumber(this, 'width', 700) } }; },
    configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, 'height', {
    get(this: SVGSVGElement) { return { baseVal: { value: attrNumber(this, 'height', 100) } }; },
    configurable: true,
  });
}

function restoreSvgLayoutOnPrototype() {
  Reflect.deleteProperty(SVGSVGElement.prototype, 'getBoundingClientRect');
  Reflect.deleteProperty(SVGSVGElement.prototype, 'width');
  Reflect.deleteProperty(SVGSVGElement.prototype, 'height');
}

function seedWork() {
  const events = [{ dur: '1' as const, isRest: false, keys: ['b/4'], dynamics: [{ value: 'pp' as const }] }];
  const data = createSavedScoreData(
    { title: '記号ドラッグ配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('記号ドラッグ配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

describe('記号ドラッグの配線（#522 round1 P3）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    mockSvgLayoutOnPrototype();
    // jsdom には getBBox が無く、記号のクリック判定 rect が生成されないため固定値で代用
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    restoreSvgLayoutOnPrototype();
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('演奏記号タブ→記号クリック→ドラッグで保存され、Undo 1回で戻る', async () => {
    const workId = seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 演奏記号タブで記号がクリック可能になる → pp をクリックして✥オーバーレイを開く
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    // タブ切替で SVG が描き直され、クリック判定 rect が付くのを待つ
    await waitFor(() => {
      expect(document.querySelector('.symbol-hit-region')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(document.querySelector('.symbol-hit-region')!, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(document.querySelector('.symbol-adjust-overlay')?.textContent).toContain('記号位置調整');
    }, { timeout: 15000 });

    // つかんで運んで離す（実装と同じく move/up は window で受ける）
    fireEvent.pointerDown(document.querySelector('.symbol-hit-region')!, { clientX: 10, clientY: 10, button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 25, pointerId: 1 });

    // 自動保存で作品データに offset が入る（保存はドラッグ確定の1回）
    await waitFor(() => {
      const saved = loadWorkAutosaveData(workId);
      expect(saved.success).toBe(true);
      const ev = saved.data?.parts?.[0]?.measures?.[0]?.events?.[0];
      // 既定の画面ズーム 130% では画面20px の移動が SVG 内部 30 単位（20×1.5）になる。
      // クライアント座標→内部座標の換算（clientToGroup）が効いている証拠でもある
      expect(ev?.symbolAdjust?.dynamics).toMatchObject({ offsetX: 30, offsetY: 23 });
    }, { timeout: 15000 });

    // Undo 1回で移動前へ戻る（保存がドラッグ1回=履歴1件である証拠）
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await waitFor(() => {
      const saved = loadWorkAutosaveData(workId);
      const ev = saved.data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.symbolAdjust?.dynamics ?? null).toBeNull();
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
