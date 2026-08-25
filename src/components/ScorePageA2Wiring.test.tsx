// UI案A2（Issue #405 段3）の ScorePage 配線テスト。
//
// PianoSystemCanvasActiveLayerHighlight.test.tsx は props を直接注入するため、
// ScorePage 側の `highlightActiveLayer={...}` を消しても通ってしまう
// （#409 Codex round1 P2）。ここでは作品を復元した実経路で、
// ?ui=a2 のときだけ譜面側の表示が出ることを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import ScorePage from './ScorePage';
import { UI_VARIANT_STORAGE_KEY } from '../utils/uiVariant';
import { ACTIVE_LAYER_BAND_COLOR } from '../editor/hitResolution';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
} from '../utils/storage';

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

/** 両手に音符があるピアノ譜（レイヤーの概念がある譜種） */
function seedPianoWork() {
  const rh = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
  const data = createSavedScoreData(
    { title: 'A2配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [{ events: rh, voices: [{ id: 'voice-1', events: rh }] }] },
      { partId: 'left-hand', clef: 'bass', measures: [{ events: lh, voices: [{ id: 'voice-1', events: lh }] }] },
    ],
    1, 1, 'piano'
  );
  const created = createWork('A2配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** A2 の色帯（アクティブなレイヤーの五線の背後に敷く矩形） */
function bands(): Element[] {
  return Array.from(document.querySelectorAll('rect.vf-active-layer-band'));
}

describe('ScorePage: A2 譜面側レイヤー表示の配線（Issue #405 段3）', () => {
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('?ui=a2 のとき、譜面に色帯が出る', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => expect(bands().length).toBeGreaterThan(0), { timeout: 15000 });
    // 帯の濃さは定数から取られている（0.08時代の実機所感「違いが分からない」への調整値。
    // ハードコードへ退行して定数を変えても効かない、を防ぐ）
    expect(bands()[0].getAttribute('fill')).toBe(ACTIVE_LAYER_BAND_COLOR);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('A3（両方込み）でも色帯が出る', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a3');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => expect(bands().length).toBeGreaterThan(0), { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('対照群（current）では色帯が出ない（既存の譜面が変わらない）', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'current');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    expect(bands().length).toBe(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('本番ビルド相当（DEV=false）では、?ui=a2 でも色帯が出ない', async () => {
    vi.stubEnv('DEV', false);
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    expect(bands().length).toBe(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 「帯が出る」だけでは、activeLayerPartIndex を固定した退行を検出できない。
  // 実際にレイヤーを切り替えて帯が追随することまで見る（#409 Codex round5 P2）
  // レイヤーチップは Undo/Redo の隣へ常設した（実機所感 2026-08-25）。
  // 記号を付けるときもアクティブレイヤーの音符しかクリックできない（#316）ため、
  // 「音符・休符」タブ内だと記号1つ付けるのにタブ往復が要った
  it('レイヤーチップは演奏記号タブでも押せる（タブ非依存の常設）', async () => {
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    const chip = screen.getByRole('button', { name: '左手・声部1' });
    fireEvent.click(chip);
    expect(chip.className).toContain('active');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 履歴グループから分離した兄弟要素なので、折り畳みの隠しセレクタに個別指定が要る
  // （#410 round3 P2: 折り畳んでもチップだけ残っていた）
  it('ツールバーを折り畳むとレイヤーチップも隠れる（CSSの対象に入っている）', async () => {
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    const chips = document.querySelector('.toolbar-layer-chips');
    expect(chips).toBeTruthy();
    // jsdom はCSSを解釈しないので、DOM側の契約（専用クラスが付いていて
    // .toolbar 配下にあること）を固定する。CSS側は AppCss テストで見る
    expect(chips!.closest('header.toolbar')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('左手レイヤーへ切り替えると、色帯も左手の五線へ移る', async () => {
    localStorageMock.setItem(UI_VARIANT_STORAGE_KEY, 'a2');
    seedPianoWork();
    render(<ScorePage />);

    await waitFor(() => expect(bands().length).toBeGreaterThan(0), { timeout: 15000 });
    const rightY = Number(bands()[0].getAttribute('y'));

    // レイヤー切替チップは「音符・休符」タブにある
    fireEvent.click(screen.getByRole('button', { name: '左手・声部1' }));

    await waitFor(() => {
      const y = Number(bands()[0]?.getAttribute('y'));
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThan(rightY);   // 左手の五線は右手より下
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
