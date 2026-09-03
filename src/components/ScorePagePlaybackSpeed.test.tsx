// 再生速度（%）の撤去（Issue #588）の ScorePage 配線テスト。
//
// #544 で入れた再生速度（%）は「テンポだけでよい」という運用者裁定で未リリースのまま
// 取り下げになった。ここで固定するのは撤去そのものではなく、**撤去してもこれまでどおり
// 鳴ること**（速度 UI が無い・譜面のテンポと速度標語がそのまま再生へ届く・古い保存データが
// 残っていても壊れない）の3点で、#544 のときの回帰観点を形を変えて引き継いでいる。
//
// 元のファイル名を変えていないのは、#544 の配線テストがどう変わったかを履歴で
// 追えるようにするため。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, within } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';

/** 再生エンジンを丸ごと差し替えて「何を鳴らすよう指示されたか」だけを記録する */
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

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** アプリ全体の再生設定の保存先（ScorePage の PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY と同じ） */
const RUNTIME_SETTINGS_KEY = 'playback-sound-runtime-settings';

/** 1小節目は指定なし（全体テンポ 120）、2小節目の先頭に Allegro（目安 132）を置いた単旋律 */
function seedWorkWithTempoMarking() {
  const first = [
    { dur: '4' as const, isRest: false, keys: ['c/4'] },
    { dur: '4' as const, isRest: false, keys: ['d/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '4' as const, isRest: false, keys: ['f/4'] },
  ];
  const second = [
    { dur: '4' as const, isRest: false, keys: ['g/4'], tempoMarking: 'Allegro' },
    { dur: '4' as const, isRest: false, keys: ['a/4'] },
    { dur: '4' as const, isRest: false, keys: ['b/4'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
  ];

  const data = createSavedScoreData(
    { title: '速度撤去のテンポ配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'melody',
      clef: 'treble',
      measures: [
        { events: first, voices: [{ id: 'voice-1', events: first }] },
        { events: second, voices: [{ id: 'voice-1', events: second }] },
      ],
    }] as never,
    1,
    2,
    'single'
  );
  const created = createWork('速度撤去のテンポ配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/** 譜面が描けるまで待って、再生タブを開く */
async function renderAndOpenPlaybackTab() {
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
}

/** 再生ボタンを押して、playParts へ渡った（小節列, 基準テンポ）を返す */
async function play() {
  fireEvent.click(screen.getByRole('button', { name: '再生' }));
  await waitFor(() => {
    expect(playPartsMock).toHaveBeenCalled();
  }, { timeout: 15000 });
  const [parts, globalBpm] = playPartsMock.mock.calls[0] as [Array<{ measures: Array<{ bpm?: number }> }>, number];
  return { measures: parts[0].measures, globalBpm };
}

describe('ScorePage: 再生速度（%）の撤去（Issue #588）', () => {
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

  it('速度UIが無く、譜面のテンポと速度標語がそのまま再生へ届く（受入1）', async () => {
    seedWorkWithTempoMarking();
    await renderAndOpenPlaybackTab();

    // 速度スライダー・「等倍に戻す」ボタン・見出しのいずれも残っていないこと。
    // どれか1つでも残っていると、撤去したはずの操作口が画面に生き残る
    expect(screen.queryByLabelText('再生速度（%）')).toBeNull();
    expect(screen.queryByRole('button', { name: '再生速度を等倍に戻す' })).toBeNull();
    // 検索対象は再生パネル（.playback-controls）の中だけに絞る。
    // 画面全体を対象にすると、譜面のタイトルなど無関係な文字列まで拾ってしまう
    const panel = document.querySelector('.playback-controls') as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(within(panel as HTMLElement).queryByText(/再生速度/)).toBeNull();

    // テンポ側（作品の基準テンポ）は残す。速度と一緒に消えていないことまで見る
    expect(screen.getByLabelText('テンポ（BPM）')).toBeInTheDocument();
    expect(screen.getByText('作品の基準テンポ')).toBeInTheDocument();

    const { measures, globalBpm } = await play();

    // 1小節目は全体テンポ 120、2小節目は Allegro の目安 132（#458 と同じ値）。
    // 倍率の配管は残したまま常に等倍を渡す形にしたので、#544 以前と同じ値になる
    expect(measures[0].bpm).toBe(120);
    expect(measures[1].bpm).toBe(132);
    expect(globalBpm).toBe(120);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('古い保存データに playbackSpeedPercent が残っていても無視され、保存し直しでも混入しない（受入2）', async () => {
    seedWorkWithTempoMarking();
    // #544 を使っていた環境の localStorage を再現する。50% が生き残っていると
    // 「UI は無いのに半分の速さで鳴る」という直しようのない状態になってしまう
    localStorageMock.setItem(RUNTIME_SETTINGS_KEY, JSON.stringify({
      engineMode: 'soundfont',
      pluginName: 'MusyngKite',
      previewAccidentalOnApply: true,
      swingEnabled: false,
      playbackSpeedPercent: 50,
      profile: { brightness: 0.5, attack: 0.5, release: 0.5, richness: 0.5, volume: 0.5 },
    }));

    await renderAndOpenPlaybackTab();

    const { measures, globalBpm } = await play();
    expect(measures[0].bpm).toBe(120);
    expect(measures[1].bpm).toBe(132);
    expect(globalBpm).toBe(120);

    // 読み込んだ設定はサニタイズ後の形で保存し直されるので、旧フィールドは消えている。
    // 他の設定（音源パック名など）はそのまま引き継がれること
    const stored = JSON.parse(localStorageMock.getItem(RUNTIME_SETTINGS_KEY) ?? '{}');
    expect(stored).not.toHaveProperty('playbackSpeedPercent');
    expect(stored.pluginName).toBe('MusyngKite');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
