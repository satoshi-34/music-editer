// Ped/✱ と五線下の低音の衝突回避（Issue #604）の ScorePage 実マウント配線テスト。
// 保存済みのピアノ作品（左手に深い加線の和音＋ペダル）を起動時復元で開き、
// 画面に描かれた Ped が固定位置より下にあり、かつ段の SVG の中に収まる（段の下余白が
// 譜面データから広がっている）ことを、実際の入口（ScorePage）で固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';
import { SCORE_LAYOUT_RENDER_SCALE } from '../utils/measureLayoutUtils';

vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn(),
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

function seedPianoWork(leftKeys: string[]) {
  const right = [
    { dur: '2' as const, isRest: false, keys: ['e/5'] },
    { dur: '2' as const, isRest: false, keys: ['e/5'] },
  ];
  const left = [
    { dur: '2' as const, isRest: false, keys: leftKeys, pedalMark: 'down' as const },
    { dur: '2' as const, isRest: false, keys: ['d/3'], pedalMark: 'up' as const },
  ];
  const data = createSavedScoreData(
    { title: 'ペダル配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [{ events: right, voices: [{ id: 'voice-1', events: right }] }] },
      { partId: 'left-hand', clef: 'bass', measures: [{ events: left, voices: [{ id: 'voice-1', events: left }] }] },
    ],
    1, 1, 'piano'
  );
  const created = createWork('ペダル配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

function pedTextY(): number {
  const texts = Array.from(document.querySelectorAll('svg text')).filter((el) => el.textContent === 'Ped');
  expect(texts.length).toBe(1);
  return parseFloat(texts[0].getAttribute('y')!);
}

async function renderAndReadPed(leftKeys: string[]): Promise<{ pedY: number; svgHeightLogical: number }> {
  seedPianoWork(leftKeys);
  render(<ScorePage />);
  await waitFor(() => { expect(document.querySelectorAll('svg text').length).toBeGreaterThan(0); }, { timeout: 15000 });
  await waitFor(() => { expect(document.querySelector('.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
  const pedY = pedTextY();
  const svg = document.querySelector('.vf-note-hit')!.closest('svg') as SVGSVGElement;
  const svgHeightLogical = parseFloat(svg.getAttribute('height')!) / SCORE_LAYOUT_RENDER_SCALE;
  cleanup();
  localStorageMock.clear();
  return { pedY, svgHeightLogical };
}

describe('ScorePage: Ped と五線下の低音の衝突回避（Issue #604）', () => {
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
  });

  it('深い加線の和音（c#/2）では Ped が低音の無い場合より下に出て、段の SVG に収まる（段の下余白がデータから広がる）', async () => {
    // 同じ作品の左手だけを差し替えて、固定位置（低音なし）との差で見る
    const plain = await renderAndReadPed(['d/3']);
    const low = await renderAndReadPed(['c#/2', 'c#/3']);
    expect(low.pedY).toBeGreaterThan(plain.pedY);
    // baseline + ディセント（3）が段の箱に収まる（印刷/PDF で欠けない）
    expect(low.pedY + 3).toBeLessThanOrEqual(low.svgHeightLogical + 0.01);
    // 段の高さは低音ぶんだけ広がっている（低音の無い作品の高さは変わらない）
    expect(low.svgHeightLogical).toBeGreaterThan(plain.svgHeightLogical);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
