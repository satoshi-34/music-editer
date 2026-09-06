// 弱起（アウフタクト）の ScorePage 配線テスト（Issue #473・Codex round1 P2）。
//
// 単体テスト（measureCapacityUtils.test.ts など）は純粋関数だけを見るため、
// パレット → ScorePage → Canvas → 保存 → 再生という実配線が切れていても通ってしまう。
// ここでは実マウントで次の4点を固定する:
//   1. ツールで小節をクリック → 弱起を選ぶと、全パートの小節データへ同じ値が書かれる
//   2. 弱起の小節は表示用の補完休符が消え、次の小節の番号が 1 になる
//   3. 再生エンジンへ渡る measureBeats が弱起の拍数になる（無音が入らない）
//   4. 「（解除）」で普通の小節へ戻せる
// （弱起の小節に音符が入らない＝入力上限と、小節番号の繰り下がりは
//  PianoSystemCanvasPickup.test.tsx で見る）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';

/** 再生エンジンを差し替えて「何を鳴らすよう指示されたか」だけを記録する（実音は鳴らさない） */
const playPartsMock = vi.fn().mockResolvedValue(undefined);
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

const quarter = (key: string) => ({ dur: '4' as const, isRest: false, keys: [key] });
const mk = (events: ReturnType<typeof quarter>[], extra: Record<string, unknown> = {}) =>
  ({ events, voices: [{ id: 'voice-1', events }], ...extra });

let workId = '';

/**
 * 単旋律・2小節の作品を用意する。
 * 1小節目は4分音符1つだけ（＝弱起にしたい中身）、2小節目は4分音符4つの完全小節。
 * pickupBeats を渡すと、最初から弱起が設定された保存データになる（復元の確認用）。
 */
function seedWork(pickupBeats?: number) {
  const first = mk([quarter('g/4')], pickupBeats === undefined ? {} : { pickupBeats });
  const second = mk([quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')]);
  const data = createSavedScoreData(
    { title: '弱起配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [first, second] }] as never,
    // 段数2・段あたり2小節。小節番号は「段の先頭小節（曲頭を除く）」にだけ描かれるので、
    // 2段目の先頭に番号が出る形にしておく（弱起の効き目を番号で観測するため）
    2, 2, 'single'
  );
  const created = createWork('弱起配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** 弱起オーバーレイのセレクト（「（解除）」と拍数の選択肢を持つもの）を探す */
const pickupSelect = () => Array.from(document.querySelectorAll('select')).find((select) =>
  Array.from(select.options).some((option) => option.value === '1' && option.text.includes('4分音符')));


async function mountScore() {
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-hit')).toBeTruthy();
  }, { timeout: 15000 });
}

/** 小節の背景（当たり判定の rect）。描画順＝小節順なので添字でその小節を選べる */
const measureHits = (): SVGRectElement[] =>
  Array.from(document.querySelectorAll('rect.vf-hit')) as SVGRectElement[];

/** 画面に描かれている音符・休符の数（表示専用の補完休符も含む） */
const drawnNoteCount = (): number => document.querySelectorAll('.vf-stavenote').length;

/**
 * 演奏記号タブの弱起ツールを選び、指定した小節の背景をクリックする。
 * パレットのボタンは「もう一度押すと解除」なので、既にツールを選んである
 * 2回目以降は selectTool: false で呼ぶ（押すとツールが外れてしまうため）
 */
async function openPickupOverlay(measureIndex: number, options: { selectTool?: boolean } = {}) {
  if (options.selectTool !== false) {
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    fireEvent.click(screen.getByRole('button', { name: /弱起/ }));
  }
  // ツールを切り替えると譜面が描き直されるので、当たり判定が出そろうまで待つ
  await waitFor(() => { expect(measureHits()[measureIndex]).toBeTruthy(); }, { timeout: 15000 });
  fireEvent.click(measureHits()[measureIndex], { clientX: 10, clientY: 10 });
}

describe('ScorePage: 弱起（アウフタクト）の配線（Issue #473）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  // ScorePage の実マウントは重い（VexFlow の描画を伴う）ため、このファイルでは
  // 1回のマウントで「設定 → 保存 → 表示 → 解除 → 再生」までを一続きに確かめる。
  // 入力上限（弱起の小節に音符が入らない）はキャンバス単体テスト側で見る。
  it('ツールで弱起を設定 → 保存・表示・再生へ届き、「（解除）」で元に戻る', async () => {
    seedWork();
    await mountScore();
    // 弱起にする前: 1小節目の足りない3拍が表示用の休符で埋められている
    const beforeCount = drawnNoteCount();

    await openPickupOverlay(0);
    await waitFor(() => { expect(pickupSelect()).toBeTruthy(); }, { timeout: 15000 });
    // 弱起ツールを選んだ状態での描画数（Undo 後の比較基準。ツールによって描かれる
    // 補助要素が変わるので、同じツールのまま測る）
    const beforeWithTool = drawnNoteCount();
    fireEvent.change(pickupSelect()!, { target: { value: '1' } });

    // 保存データ（自動保存）へ弱起が書かれる。2小節目には書かれない
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.pickupBeats).toBe(1);
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[1]?.pickupBeats).toBeUndefined();
    }, { timeout: 15000 });

    // 画面: 1小節目を埋めていた補完休符が消える（小節番号の繰り下がりはキャンバス側のテストで確認）
    await waitFor(() => {
      expect(drawnNoteCount()).toBeLessThanOrEqual(beforeCount - 3);
    }, { timeout: 15000 });
    const withPickup = drawnNoteCount();

    // 受入（運用者裁定 2026-09-04）: 弱起化は Undo 1回で戻る（可逆）。やり直すで再び弱起になる
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.pickupBeats).toBeUndefined();
    }, { timeout: 15000 });
    await waitFor(() => { expect(drawnNoteCount()).toBe(beforeWithTool); }, { timeout: 15000 });
    fireEvent.click(screen.getByTitle(/やり直す/));
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.pickupBeats).toBe(1);
    }, { timeout: 15000 });
    await waitFor(() => { expect(drawnNoteCount()).toBe(withPickup); }, { timeout: 15000 });

    // 小節番号を指定した再生（#545）は画面の番号（弱起 = 0、次が 1）で受け付ける:
    // 「1」で 2 番目の小節（実インデックス 1）から鳴り、案内も「1小節目から」
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    expect((screen.getByLabelText('再生を開始する小節番号') as HTMLInputElement).min).toBe('0');
    fireEvent.change(screen.getByLabelText('再生を開始する小節番号'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '指定した小節から再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalled(); }, { timeout: 15000 });
    {
      const fromNumber = playPartsMock.mock.calls[0][0][0].measures as Array<{ measureBeats?: number }>;
      // 弱起（1拍）の小節は含まれず、2番目の小節（4拍）から末尾まで
      expect(fromNumber[0].measureBeats).toBe(4);
    }
    await waitFor(() => {
      expect(screen.getByTestId('edit-notice').textContent).toContain('1小節目から再生します');
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    playPartsMock.mockClear();
    // タブを切り替えるとツールは既定（4分音符）へ戻る仕様なので、弱起ツールを選び直す
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    fireEvent.click(screen.getByRole('button', { name: /弱起/ }));

    // 「（解除）」で普通の小節へ戻る: 補完休符が戻り、番号も従来どおりになる
    await openPickupOverlay(0, { selectTool: false });
    await waitFor(() => { expect(pickupSelect()).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.change(pickupSelect()!, { target: { value: 'none' } });
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.pickupBeats).toBeUndefined();
    }, { timeout: 15000 });
    await waitFor(() => {
      // 解除すると足りない拍が再び表示用の休符で埋まる（描かれる音符が増える）
      expect(drawnNoteCount()).toBeGreaterThan(withPickup);
    }, { timeout: 15000 });

    // もう一度弱起にしてから再生する（再生中は譜面が編集できなくなるので最後に確かめる）。
    // エンジンへ渡る measureBeats が弱起の拍数（1拍）になる＝弱起の直後に無音が入らない
    await openPickupOverlay(0, { selectTool: false });
    await waitFor(() => { expect(pickupSelect()).toBeTruthy(); }, { timeout: 15000 });
    fireEvent.change(pickupSelect()!, { target: { value: '1' } });

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalled(); }, { timeout: 15000 });
    const measures = playPartsMock.mock.calls[0][0][0].measures as Array<{ measureBeats?: number }>;
    expect(measures[0].measureBeats).toBe(1);
    expect(measures[1].measureBeats).toBe(4);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
