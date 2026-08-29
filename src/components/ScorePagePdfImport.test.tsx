// PDF楽譜の取り込み（Issue #487）の ScorePage 配線テスト。
// fetch をモックして「PDF を選ぶ → 変換API → 返ってきた .mxl が既存の読込経路へ流れる」
// までを固定する。変換エンジン（Audiveris）そのものはコンテナ側の責務なので触らない。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

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
// 読込失敗時の alert は jsdom に実装が無いので差し替える（失敗を静かに素通りさせない）
const alertMock = vi.fn();
Object.defineProperty(window, 'alert', { value: alertMock });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** 読込先の作品を種まきする（空ストレージだと自動保存の行き先が無い） */
function seedEmptyWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '読込前', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single'
  );
  const created = createWork('読込前');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

const SINGLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>PDFから変換した曲</work-title></work>
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const CONTAINER_XML = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`;

/** 変換API が返す .mxl（= ZIP）を組み立てる */
function convertedMxl() {
  return zipSync({
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'score.xml': strToU8(SINGLE_XML),
  });
}

/** 隠しファイル入力へ PDF を流し込む（「PDF (β)」ボタンが click する先） */
function choosePdf(name = 'moonlight.pdf') {
  const input = Array.from(document.querySelectorAll('input[type="file"]'))
    .find((i) => (i.getAttribute('accept') ?? '').includes('.pdf')) as HTMLInputElement;
  expect(input).toBeTruthy();
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], name, { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
}

async function renderScorePage() {
  seedEmptyWork();
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-hit')).toBeTruthy();
  }, { timeout: 15000 });
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
}

describe('ScorePage: PDF楽譜の取り込み（#487）', () => {
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('変換APIのURLが未設定なら「PDF (β)」ボタンを出さない（本番は非表示のまま）', async () => {
    vi.stubEnv('VITE_OMR_API_URL', '');
    await renderScorePage();

    expect(screen.queryByRole('button', { name: 'PDF (β)' })).toBeNull();
    // 隠しファイル入力ごと出さない（押せないボタンだけ残さない）
    const pdfInput = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((i) => (i.getAttribute('accept') ?? '').includes('.pdf'));
    expect(pdfInput).toBeUndefined();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('PDF を選ぶと変換APIへ送られ、返ってきた .mxl が読み込まれる', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    const mxl = convertedMxl();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => mxl.buffer.slice(mxl.byteOffset, mxl.byteOffset + mxl.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderScorePage();
    expect(screen.getByRole('button', { name: 'PDF (β)' })).toBeTruthy();
    choosePdf();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }, { timeout: 15000 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8080/convert');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');

    // 変換結果が既存の MusicXML 読込経路を通り、画面（タイトルと音符）まで反映される
    await waitFor(() => {
      expect(alertMock).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('PDFから変換した曲');
      expect(document.querySelectorAll('rect.vf-note-hit').length).toBeGreaterThan(0);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('変換に失敗したら理由と代替手順を知らせ、譜面は変えない（#318）', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ error: { reason: 'tooManyPages', message: 'ページ数が多すぎます' } }),
    }));

    await renderScorePage();
    choosePdf('long-score.pdf');

    await waitFor(() => {
      expect(document.body.textContent).toContain('ページ数が多すぎて変換できません');
      // 代替手順（手元で Audiveris 変換 →「MusicXML (.mxl)」で開く）を必ず添える
      expect(document.body.textContent).toContain('Audiveris');
    }, { timeout: 15000 });
    // 譜面は差し替わっていない
    expect(document.body.textContent).not.toContain('PDFから変換した曲');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
