// 弱起（アウフタクト・Issue #473）の受入: 検聴セットのトルコ行進曲（K.331 第3楽章・冒頭8小節）。
// 運用者裁定（2026-09-04）: このアセットは弱起未対応のため「先頭に4分休符を足して完全小節にする」
// 整形をしてあった。本対応後はその整形が不要＝弱起小節（2/4 の曲頭に 16 分×4 ＝ 1 拍）として
// 読み込み・表示・再生できることを、実マウントで固定する。
// 固定データは src/test-fixtures/turkishMarchPickup.ts（整形を外し measures[0].pickupBeats=1）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createWork, listWorks, loadWorkAutosaveData, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import type { SavedScoreData } from '../types/storage';
import { turkishMarchPickupFixture as fixture } from '../test-fixtures/turkishMarchPickup';

const playPartsMock = vi.fn();
vi.mock('../audio/createPlaybackEngine', () => ({
  createPlaybackEngine: () => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    playNoteByName: vi.fn().mockResolvedValue(undefined),
    playParts: playPartsMock,
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

function seedWork(data: SavedScoreData) {
  const created = createWork(data.metadata.title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** 同じ譜面から弱起だけを外した版（整形前の状態＝先頭小節が 1 拍しか無い不完全小節） */
function withoutPickup(data: SavedScoreData): SavedScoreData {
  return {
    ...data,
    parts: data.parts.map((part) => ({
      ...part,
      measures: part.measures.map((measure, index) => {
        if (index !== 0) return measure;
        const { pickupBeats: _removed, ...rest } = measure as typeof measure & { pickupBeats?: number };
        return rest;
      }),
    })),
  };
}

async function mountAndCount(data: SavedScoreData): Promise<number> {
  seedWork(data);
  render(<ScorePage />);
  await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
  // 描画が落ち着くまで待つ（段割りの再計算で描画数が一時的に変わる）
  let last = -1;
  await waitFor(() => {
    const now = document.querySelectorAll('.vf-stavenote').length;
    expect(now).toBe(last);
    last = now;
  }, { timeout: 15000, interval: 300 }).catch(() => { /* 安定判定の失敗は次の比較で検出する */ });
  return document.querySelectorAll('.vf-stavenote').length;
}

describe('弱起の受入: トルコ行進曲（8小節・検聴版）を弱起小節のまま読み込める（Issue #473）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockReset();
    playPartsMock.mockImplementation(async () => ({ scheduledAtMs: Date.now() }));
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('弱起なし版と比べて、先頭小節の補完休符（右手・左手 1 つずつ）だけが消える', async () => {
    const plain = await mountAndCount(withoutPickup(fixture));
    cleanup();
    localStorageMock.clear();
    const pickup = await mountAndCount(fixture);
    // 弱起なし: 1 拍しか無い先頭小節を右手・左手とも 1 拍ぶんの休符で埋める（＝2 つ多い）
    expect(plain - pickup).toBe(2);
    // 先頭小節（当たり判定は選択中のレイヤー＝右手・声部1 のぶん）: 16 分×4 で、整形用の先頭休符は無い
    expect(document.querySelectorAll('rect.vf-note-hit[data-measure="0"]').length).toBe(4);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('再生は弱起 1 拍 → 2/4 の 2 拍で進み、小節番号の入力は 0（弱起）から', async () => {
    await mountAndCount(fixture);
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalled(); }, { timeout: 15000 });
    const parts = playPartsMock.mock.calls[0][0] as Array<{ measures: Array<{ measureBeats?: number }> }>;
    parts.forEach((part) => {
      expect(part.measures[0].measureBeats).toBe(1);
      expect(part.measures[1].measureBeats).toBe(2);
    });
    expect((screen.getByLabelText('再生を開始する小節番号') as HTMLInputElement).min).toBe('0');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ピアノ譜（2パート）でも弱起の解除は Undo 1 回で両手そろって戻る（受入・round3 P1-1）', async () => {
    await mountAndCount(fixture);
    // 演奏記号タブの弱起ツールで先頭小節を開き「（解除）」
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    fireEvent.click(screen.getByRole('button', { name: /弱起/ }));
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.click(document.querySelector('rect.vf-hit') as SVGRectElement, { clientX: 10, clientY: 10 });
    const select = () => Array.from(document.querySelectorAll('select')).find((el) =>
      Array.from(el.options).some((option) => option.value === 'none' && option.text.includes('解除')));
    await waitFor(() => { expect(select()).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.change(select()!, { target: { value: 'none' } });
    const pickupOf = (partIndex: number) => {
      const works = listWorks();
      const data = loadWorkAutosaveData(works[0].id).data;
      return (data?.parts[partIndex].measures[0] as { pickupBeats?: number } | undefined)?.pickupBeats;
    };
    await waitFor(() => {
      expect([pickupOf(0), pickupOf(1)]).toEqual([undefined, undefined]);
    }, { timeout: 15000 });
    // Undo 1 回で右手・左手とも弱起に戻る（片手だけ戻る中間状態で止まらない）
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect([pickupOf(0), pickupOf(1)]).toEqual([1, 1]);
    }, { timeout: 15000 });
    expect((screen.getByTitle(/元に戻す/) as HTMLButtonElement).disabled).toBe(true);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
