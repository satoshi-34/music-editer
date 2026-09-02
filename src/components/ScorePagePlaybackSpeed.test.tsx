// 再生速度（%）の ScorePage 配線テスト（Issue #544）。
//
// playbackSpeed.test.ts は純粋関数だけを見るため、ScorePage がその関数を呼んでいなくても
// 通ってしまう（配線の削除を検出できない）。ここでは実操作でスライダーを動かしてから
// 再生ボタンを押し、再生エンジンへ実際に渡った値（playParts の引数）を固定する。
// 併せて「再生速度は書き出しに影響しない」（受入2）も実操作で確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
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
    { title: '再生速度配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
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
  const created = createWork('再生速度配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
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

describe('ScorePage: 再生速度（%）の配線（Issue #544）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let exportedXml: string | null;
  let origCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    localStorageMock.clear();
    playPartsMock.mockClear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
    // 書き出しは Blob → createObjectURL で流れるので、ここで中身を取り出せるようにする
    exportedXml = null;
    origCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        const reader = new FileReader();
        reader.onload = () => { exportedXml = String(reader.result); };
        reader.readAsText(blob);
        return 'blob:mock';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: origCreateObjectURL });
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('既定（100%）では従来と同一のテンポで鳴る（受入3の回帰）', async () => {
    seedWorkWithTempoMarking();
    await renderAndOpenPlaybackTab();

    expect((screen.getByLabelText('再生速度（%）') as HTMLInputElement).value).toBe('100');

    const { measures, globalBpm } = await play();

    // 1小節目は全体テンポ 120、2小節目は Allegro の目安 132（#458 と同じ値）
    expect(measures[0].bpm).toBe(120);
    expect(measures[1].bpm).toBe(132);
    expect(globalBpm).toBe(120);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('50% で全小節がちょうど半分の速さになり、標語の相対関係が保たれる（受入1・4）', async () => {
    seedWorkWithTempoMarking();
    await renderAndOpenPlaybackTab();

    fireEvent.change(screen.getByLabelText('再生速度（%）'), { target: { value: '50' } });
    expect(screen.getByText('再生速度: 50%')).toBeInTheDocument();

    const { measures, globalBpm } = await play();

    // 各小節がちょうど半分。エンジンは 60 / bpm 秒で1拍を数えるので、実時間は2倍になる
    expect(measures[0].bpm).toBe(60);
    expect(measures[1].bpm).toBe(66);
    // 標語の相対関係（120 : 132）は 60 : 66 のまま保たれている
    expect(measures[1].bpm! / measures[0].bpm!).toBeCloseTo(132 / 120, 10);
    // 小節ごとの指定が無いときにエンジンが使う基準テンポにも同じ倍率が掛かる
    expect(globalBpm).toBe(60);

    // 「等倍に戻す」で 100% に戻り、次の再生は元のテンポへ戻る
    fireEvent.click(screen.getByRole('button', { name: '再生速度を等倍に戻す' }));
    expect(screen.getByText('再生速度: 100%')).toBeInTheDocument();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('実効テンポが譜面の下限 30BPM を割っても丸め直されない（#544 round1 P1）', async () => {
    seedWorkWithTempoMarking();
    await renderAndOpenPlaybackTab();

    // 基準テンポ 40 × 25% = 実効 10BPM。譜面用の clampBpm（30〜240）へ丸め直す経路が
    // 残っていると、エンジン・終了タイマーが 30BPM として動き、実音とずれる
    fireEvent.change(screen.getByLabelText('テンポ（BPM）'), { target: { value: '40' } });
    fireEvent.blur(screen.getByLabelText('テンポ（BPM）'));
    fireEvent.change(screen.getByLabelText('再生速度（%）'), { target: { value: '25' } });

    const { measures, globalBpm } = await play();
    expect(measures[0].bpm).toBe(10);
    expect(globalBpm).toBe(10);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('再生速度は再読込後も保持され、作品の保存データへは混入しない', async () => {
    seedWorkWithTempoMarking();
    await renderAndOpenPlaybackTab();

    fireEvent.change(screen.getByLabelText('再生速度（%）'), { target: { value: '50' } });
    expect(screen.getByText('再生速度: 50%')).toBeInTheDocument();

    // 作品の保存データ（globalBpm）は基準テンポのまま。再生速度が保存へ漏れると、
    // 50% で聴いていた作品が次に開いたとき半分のテンポの曲になってしまう
    const savedKeys = Array.from({ length: localStorageMock.length }, (_, i) => localStorageMock.key(i) ?? '');
    for (const key of savedKeys) {
      const raw = localStorageMock.getItem(key) ?? '';
      if (raw.includes('"globalBpm"')) {
        expect(JSON.parse(raw).globalBpm ?? 120).toBe(120);
      }
    }

    // 再マウント（再読込相当）でもスライダーは 50% のまま（localStorage 永続化）
    cleanup();
    playPartsMock.mockClear();
    await renderAndOpenPlaybackTab();
    expect((screen.getByLabelText('再生速度（%）') as HTMLInputElement).value).toBe('50');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('再生速度は書き出した MusicXML に影響しない（受入2）', async () => {
    seedWorkWithTempoMarking();
    await renderAndOpenPlaybackTab();

    // 速度を 50% にしても、書き出しへ乗るのは譜面のテンポ（120）のままであること。
    // 再生速度が書き出しへ漏れると、聴くために速度を落とした状態で書き出した
    // ファイルが別のテンポの曲になってしまう
    fireEvent.change(screen.getByLabelText('再生速度（%）'), { target: { value: '50' } });

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));

    await waitFor(() => { expect(exportedXml ?? '').toContain('<sound tempo="120"/>'); }, { timeout: 15000 });
    expect(exportedXml ?? '').not.toContain('tempo="60"');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
