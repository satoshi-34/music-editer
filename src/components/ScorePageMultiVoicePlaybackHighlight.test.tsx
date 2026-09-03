// 再生ハイライトが「鳴っている全声部」に出ることの ScorePage 配線テスト（Issue #411）。
//
// playbackPositionUtils / playbackHighlightUtils の単体テストは純粋関数だけを見るため、
// ScorePage が targets を PlaybackHighlight まで渡していなければ通ってしまう
// （配線の削除を検出できない）。ここでは作品を復元した実経路で再生ボタンを押し、
// 実際に SVG へ差し込まれた帯（rect.vf-playback-band）の位置を見る。
//
// 1ファイル1テストにしているのは、ScorePage を同じファイルで何度もマウントすると
// 譜面描画のタイマーが積み上がってテストが終わらなくなるため（既存の重いマウント
// テストと同じ方針）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

/** 再生エンジンを丸ごと差し替える（jsdom には AudioContext が無い）。音は鳴らさない */
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
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
// 自動スクロールは jsdom に実装が無いので黙らせる（帯の位置には影響しない）
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/**
 * 2声のピアノ譜を1曲だけ用意する。
 * - 右手 声部1: 4分音符4つ（拍ごとに横位置が動く）
 * - 右手 声部2: 全音符1つ（1小節ずっと鳴り続ける。横位置は1拍目のまま）
 * - 左手 声部1: 全音符1つ（同上）
 *
 * 「2拍目」の瞬間には、右手声部1の2つ目の音（横位置が右へ動いた）と、
 * 鳴り続けている声部2・左手（1拍目の横位置）が同時に鳴っている。
 * 全声部を光らせるなら帯は2本、選択中レイヤーしか光らないなら1本になる。
 */
function seedTwoVoicePianoWork() {
  const rightVoice1 = [
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['d/5'] },
    { dur: '4' as const, isRest: false, keys: ['e/5'] },
    { dur: '4' as const, isRest: false, keys: ['f/5'] },
  ];
  const rightVoice2 = [{ dur: '1' as const, isRest: false, keys: ['g/4'] }];
  const leftVoice1 = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];

  const data = createSavedScoreData(
    { title: '全声部ハイライト配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      {
        partId: 'right-hand',
        clef: 'treble',
        measures: [{
          events: rightVoice1,
          voices: [
            { id: 'voice-1', events: rightVoice1 },
            { id: 'voice-2', events: rightVoice2 },
          ],
        }],
      },
      {
        partId: 'left-hand',
        clef: 'bass',
        measures: [{
          events: leftVoice1,
          voices: [{ id: 'voice-1', events: leftVoice1 }],
        }],
      },
    ] as never,
    1,
    1,
    'piano'
  );
  const created = createWork('全声部ハイライト配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** その音符の当たり判定から符頭の中心X（SVG 内部座標）を求める */
function noteCenterX(selector: string): number {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`当たり判定が見つからない: ${selector}`);
  const left = Number(el.getAttribute('data-note-left'));
  const right = Number(el.getAttribute('data-note-right'));
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error(`符頭の範囲が読めない: ${selector}`);
  }
  return (left + right) / 2;
}

/** いま出ている帯のどれかが、その X を覆っているか */
function isCoveredByBand(centerX: number): boolean {
  return Array.from(document.querySelectorAll('rect.vf-playback-band')).some((band) => {
    const x = Number(band.getAttribute('x'));
    const width = Number(band.getAttribute('width'));
    return Number.isFinite(x) && Number.isFinite(width) && x <= centerX && centerX <= x + width;
  });
}

describe('ScorePage: 再生ハイライトは鳴っている全声部に出る（Issue #411）', () => {
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

  it('右手の2拍目では、伸びている右手声部2と左手にも帯が出る（選択中レイヤーだけではない）', async () => {
    seedTwoVoicePianoWork();

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 非アクティブ声部（右手の声部2・左手）の当たり判定も描かれていることを先に確かめる。
    // これが無いとハイライトの探しようが無い（#258 で入った選択専用ヒット領域）
    const rightVoice2Center = noteCenterX(
      'rect.vf-inactive-voice-note-hit[data-part="0"][data-voice="1"][data-measure="0"][data-note="0"]'
    );
    const leftHandCenter = noteCenterX(
      'rect[data-part="1"][data-voice="0"][data-measure="0"][data-note="0"]'
    );

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => { expect(playPartsMock).toHaveBeenCalled(); }, { timeout: 15000 });

    // 2拍目（120BPM で 500ms 後）まで待つ。右手声部1が2つ目の音へ進み、
    // 声部2と左手は1拍目の音を伸ばしたまま
    const rightVoice1SecondCenter = noteCenterX(
      'rect.vf-note-hit[data-part="0"][data-voice="0"][data-measure="0"][data-note="1"]'
    );
    await waitFor(() => {
      expect(isCoveredByBand(rightVoice1SecondCenter)).toBe(true);
    }, { timeout: 15000 });

    // 本題: 選択していないレイヤー（右手の声部2・左手）も光っている
    expect(isCoveredByBand(rightVoice2Center)).toBe(true);
    expect(isCoveredByBand(leftHandCenter)).toBe(true);
    // 横位置が離れているので帯は2本以上（1本にまとめると間の何も鳴っていない場所まで塗る）
    expect(document.querySelectorAll('rect.vf-playback-band').length).toBeGreaterThanOrEqual(2);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
