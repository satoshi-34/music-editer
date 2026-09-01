// 作品ごとの全体テンポ（Issue #543）の配線テスト。
//
// storage.test.ts は createSavedScoreData が globalBpm を保存できることまでしか見ない。
// 「作品を開いたらその作品のテンポが再生パネルへ戻る」「別の作品へ切り替えたら
// 前の作品のテンポが残らない」は ScorePage の配線（読込経路での反映・自動保存への同梱）が
// 効いていないと成立しないため、実操作（作品一覧からの切替）で固定する。
//
// マウントが重いので1ファイル1テストにまとめている（複数マウントすると
// jsdom 上でレンダーが終わらなくなることがある）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
  loadWorkAutosaveData, saveScoreData, getLastOpenedWorkId,
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

/** テンポだけが違う作品を1つ作り、その作品IDを返す */
function seedWork(title: string, globalBpm?: number): string {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title, subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single', 'C', [4, 4],
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    globalBpm,
  );
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  return created.data.id;
}

/** 作品一覧を開いてタイトルで選び直す（実際の操作と同じ経路） */
function switchToWork(title: string) {
  // 作品一覧はファイルタブの中にある（テンポ入力は再生・音色タブなので毎回切り替える）
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  fireEvent.click(screen.getByTestId('work-list-toggle'));
  fireEvent.click(screen.getByText(title));
}

/** 再生・音色タブのテンポ入力が指定値になるまで待つ */
async function expectTempoToBe(bpm: string) {
  fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
  await waitFor(() => {
    const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
    expect(tempoInput.value).toBe(bpm);
  }, { timeout: 15000 });
}

describe('ScorePage: 作品ごとの全体テンポ（Issue #543）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('作品を切り替えるとその作品のテンポに戻る（旧作品はアプリ全体設定のまま）', async () => {
    // アプリ全体設定（従来の唯一の保存先）を既定値ではない 40 にしておく。
    // これが「保存済み作品を開いても無関係な 40 が出る」という Issue の再現条件
    localStorage.setItem('music-app-tempo-settings', JSON.stringify({
      bpm: 40, timeSignature: [4, 4], version: '1.0.0', lastUpdated: Date.now(),
    }));
    // テンポを持たない旧作品を最初に開く
    const legacyId = seedWork('旧作品');
    seedWork('作品A', 112);
    seedWork('作品B', 54);
    setLastOpenedWorkId(legacyId);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 受入3: テンポ未保存の旧作品は従来どおりアプリ全体設定（40）で開く
    await expectTempoToBe('40');

    // 受入1: 作品Aは♩=112、作品Bは♩=54。交互に開いてもそれぞれのテンポに戻る
    switchToWork('作品A');
    await expectTempoToBe('112');

    switchToWork('作品B');
    await expectTempoToBe('54');

    // 戻ってきても A のテンポが保たれている（B のテンポが残らない）
    switchToWork('作品A');
    await expectTempoToBe('112');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('BPM だけ変更しても自動保存で作品へ書かれる（round1 P2: 依存配列の検出）', async () => {
    const id = seedWork('BPMのみ', 112);
    setLastOpenedWorkId(id);
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    await expectTempoToBe('112');

    // テンポ**だけ**を変える（譜面・タイトルは触らない）
    const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
    fireEvent.change(tempoInput, { target: { value: '96' } });
    fireEvent.blur(tempoInput);

    // 自動保存（1.5秒デバウンス）だけで作品へ 96 が入る。
    // 依存配列から tempoSettings.bpm を外すとここが 112 のまま落ちる
    await waitFor(() => {
      const saved = loadWorkAutosaveData(id);
      expect(saved.success).toBe(true);
      expect(saved.data?.globalBpm).toBe(96);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('BPM 変更直後に作品を切り替えても、前作品の値が切替先へ書かれない（round1 P2: 切替競合）', async () => {
    const idA = seedWork('競合A', 112);
    const idB = seedWork('競合B', 54);
    setLastOpenedWorkId(idA);
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
    await expectTempoToBe('112');

    // A の BPM を 98 へ変えて、自動保存を待たずすぐ B へ切り替える
    const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
    fireEvent.change(tempoInput, { target: { value: '98' } });
    fireEvent.blur(tempoInput);
    switchToWork('競合B');
    await expectTempoToBe('54');

    // 両作品の保存値: A には 98 が入り、B は 54 のまま（98 が漏れない）
    await waitFor(() => {
      const savedA = loadWorkAutosaveData(idA);
      const savedB = loadWorkAutosaveData(idB);
      expect(savedA.data?.globalBpm).toBe(98);
      expect(savedB.data?.globalBpm).toBe(54);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('MIDI 書き出しの実操作で作品テンポが Set Tempo に乗る（round1/2 P2: ScorePage 配線）', async () => {
    const id = seedWork('MIDI配線', 112);
    setLastOpenedWorkId(id);

    // ダウンロードの Blob を横取りしてバイト列を読む
    let midiBytes: Uint8Array | null = null;
    // descriptor ごと退避して finally で完全復元する（round3 P3: 値だけ戻すと
    // 後続テストへグローバル状態が漏れる）
    const origCreateDesc = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const origRevokeDesc = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        const reader = new FileReader();
        reader.onload = () => { midiBytes = new Uint8Array(reader.result as ArrayBuffer); };
        reader.readAsArrayBuffer(blob);
        return 'blob:mock';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      render(<ScorePage />);
      await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
      await expectTempoToBe('112');

      fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
      fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'midi' } });
      fireEvent.click(screen.getByTestId('confirm-dialog-ok'));

      // Set Tempo メタイベント: FF 51 03 + µs/四分音符（112bpm = 535714µs = 0x082CA2）。
      // buildCurrentScoreData から globalBpm を外すと 120（0x07A120）になって落ちる
      await waitFor(() => {
        expect(midiBytes).not.toBeNull();
        const hex = Array.from(midiBytes!).map((b) => b.toString(16).padStart(2, '0')).join(' ');
        const tempoUs = Math.round(60000000 / 112);
        const tempoHex = [16, 8, 0].map((sh) => ((tempoUs >> sh) & 0xff).toString(16).padStart(2, '0')).join(' ');
        expect(hex).toContain(`ff 51 03 ${tempoHex}`);
      }, { timeout: 15000 });
    } finally {
      if (origCreateDesc) Object.defineProperty(URL, 'createObjectURL', origCreateDesc);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (origRevokeDesc) Object.defineProperty(URL, 'revokeObjectURL', origRevokeDesc);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('旧手動保存の取り込みで globalBpm が同期保存の時点から明示される（round1 P3）', async () => {
    // 旧スロット（アプリ全体保存）へテンポ未保存の旧データを仕込む
    const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
    const legacy = createSavedScoreData(
      { title: '旧保存', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
      1, 1, 'single'
    );
    saveScoreData(legacy);
    localStorage.setItem('music-app-tempo-settings', JSON.stringify({
      bpm: 88, timeSignature: [4, 4], version: '1.0.0', lastUpdated: Date.now(),
    }));
    const startId = seedWork('起点');
    setLastOpenedWorkId(startId);

    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.click(screen.getByRole('button', { name: '以前の手動保存' }));

    // 取り込み完了（新作品へ切替）だけを待つ。保存値の検証は**待たずに1回だけ**行う
    //（round3 P2: waitFor で保存値を再取得すると、後続の自動保存が 88 を補った場合も
    // 通ってしまい「同期保存の時点で明示」を固定できない）
    await waitFor(() => {
      expect(getLastOpenedWorkId()).not.toBe(startId);
    }, { timeout: 15000 });
    const newId = getLastOpenedWorkId();
    const saved = loadWorkAutosaveData(newId!);
    expect(saved.success).toBe(true);
    // 3151 付近の明示代入を消すと、この時点（自動保存の1.5秒デバウンス前）では
    // undefined のままになり落ちる
    expect(saved.data?.globalBpm).toBe(88);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
