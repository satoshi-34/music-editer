// 拍子の記号表記（#422）の書き出し配線テスト（Codex round1 P1）。
//
// ユーティリティ単体（timeSignatureUtils / musicXmlExport）のテストは
// timeSignatureStyle を直接渡すため、ScorePage の buildCurrentScoreData が
// style を落としている配線漏れを検出できなかった。ここでは実操作
// （設定タブで記号表示に切替→ファイルタブから MusicXML 書出）で、
// 出力 XML に symbol="cut" が付くことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
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

/** 2/2 の単旋律作品を種まきする（記号=アッラ・ブレーヴェの対象拍子） */
function seedWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '拍子記号書出', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single', 'C', [2, 2]
  );
  const created = createWork('拍子記号書出');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: 拍子の記号表記が MusicXML 書き出しへ届く（#422）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let exportedXml: string | null;
  let origCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
    exportedXml = null;
    origCreateObjectURL = URL.createObjectURL;
    // ダウンロードの Blob を横取りして XML 本文を読む（jsdom は実ダウンロードできない）
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        // jsdom の Blob には text() が無い環境があるため FileReader で読む
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

  it('記号表示に切り替えて書き出すと symbol="cut" が付き、数字表示では付かない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // まず数字表示のまま書き出す → symbol は付かない
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });
    // Issue #507: 書き出しはファイル名の確認ダイアログを経由する（既定名のままOK）
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => { expect(exportedXml ?? '').toContain('<time>'); }, { timeout: 15000 });
    expect(exportedXml ?? '').not.toContain('symbol=');

    // 設定タブで記号表示へ切替 → 書き出しに symbol="cut"
    exportedXml = null;
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(await screen.findByLabelText('拍子を記号で表示', {}, { timeout: 15000 }));
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });
    // Issue #507: 書き出しはファイル名の確認ダイアログを経由する（既定名のままOK）
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => {
      expect(exportedXml ?? '').toContain('<time symbol="cut">');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
