// 統合後の臨時記号パレット（#548）で「▾ で選んだ変種がタブを離れても残る」ことを
// ScorePage の実マウントで固定する配線テスト（round2 P2-3）。
//
// なぜ独自 Harness ではなく実 ScorePage なのか:
// 変種の保持は Palette のローカル state ではなく **ScorePage が持つ**（round1 P2）。
// props 直渡しの Palette 再マウントで確かめると、ScorePage が
// `accidentalVariantKeys` と `onAccidentalVariantKeyChange` を渡すのをやめても緑のままで、
// 配線が消えたことに気づけない。
//
// 手順に「いったん OFF にする」を必ず挟むのは、ON のままだと ScorePage の
// `lastNotesToolRef`（タブへ戻るとき直前のツールを復元する仕組み）でボタンの見た目が
// 戻ってしまい、変種の保持が働かなくても通ってしまうため。
//
// ScorePage の実マウントは1ファイル1テストにまとめている（複数マウントすると
// ローカルの jsdom 実行が終わらなくなる既知の症状があるため）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId,
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

const MOUNT_HEAVY_TIMEOUT_MS = 60000;
const CONTAINER_WIDTH = 900;

/** 単旋律の作品を1つ用意して「最後に開いた作品」にする */
function seedWork() {
  const events = [{ dur: '4' as const, isRest: false, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '変種の保持', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('変種の保持');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** ♯ 系のボタン（▾ の左側の本体）。aria-label は「臨時記号: <名前>（…）」で始まる */
function sharpFamilyButton(): HTMLButtonElement {
  const btn = document.querySelector('button[aria-label^="臨時記号: シャープ"], button[aria-label^="臨時記号: ダブルシャープ"], button[aria-label^="臨時記号: 四分音上げ"]') as HTMLButtonElement | null;
  expect(btn, '♯系のボタン').toBeTruthy();
  return btn!;
}

describe('臨時記号の変種の保持は ScorePage が持つ（#548 round2 P2-3）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => CONTAINER_WIDTH, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('𝄪 を選んで OFF にし、別タブへ行って戻ってもボタンは 𝄪 のまま', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 最初は既定の ♯ が出ている
    expect(sharpFamilyButton().getAttribute('aria-label')).toMatch(/^臨時記号: シャープ/);

    // ▾ から 𝄪（ダブルシャープ）を選ぶ。選んだ時点で ON になる仕様
    fireEvent.click(screen.getByRole('button', { name: /^シャープ系の種類を選ぶ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^臨時記号: ダブルシャープ/ }));
    await waitFor(() => {
      expect(sharpFamilyButton().getAttribute('aria-label')).toMatch(/^臨時記号: ダブルシャープ/);
    });

    // いったん OFF に戻す（ON のままだと lastNotesToolRef の復元でも通ってしまう）
    fireEvent.click(sharpFamilyButton());
    await waitFor(() => {
      // OFF でもボタンの見た目（＝選んだ変種）は 𝄪 のまま残る
      expect(sharpFamilyButton().getAttribute('aria-label')).toMatch(/^臨時記号: ダブルシャープ/);
    });

    // 別タブ（演奏記号）へ移ると、音符・休符タブのパレットはアンマウントされる
    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    await waitFor(() => {
      expect(document.querySelector('button[aria-label^="臨時記号: "]')).toBeNull();
    });

    // 戻ってきたときに 𝄪 のままなら、保持しているのは Palette ではなく ScorePage である
    fireEvent.click(screen.getByRole('tab', { name: '音符・休符' }));
    await waitFor(() => {
      expect(sharpFamilyButton().getAttribute('aria-label')).toMatch(/^臨時記号: ダブルシャープ/);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
