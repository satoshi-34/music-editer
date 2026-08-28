// 圧縮MusicXML（.mxl）読込の ScorePage 配線テスト（Issue #465）。
// input[type=file] への change から、ZIP 展開 → parseMusicXml → 画面反映までの実経路と、
// 壊れた .mxl の理由つき通知（#318）を固定する。フィクスチャは fflate.zipSync で生成。
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
  <work><work-title>mxlの曲</work-title></work>
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

async function importFile(bytes: Uint8Array, name: string) {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  const input = Array.from(document.querySelectorAll('input[type="file"]'))
    .find((i) => (i.getAttribute('accept') ?? '').includes('.mxl')) as HTMLInputElement;
  expect(input).toBeTruthy();
  const file = new File([new Uint8Array(bytes)], name, { type: 'application/vnd.recordare.musicxml' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ScorePage: .mxl（圧縮MusicXML）の読込（#465）', () => {
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

  it('.mxl を選ぶと展開して読み込まれ、タイトルと音符が画面に出る', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const mxl = zipSync({
      'META-INF/container.xml': strToU8(CONTAINER_XML),
      'score.xml': strToU8(SINGLE_XML),
    });
    await importFile(mxl, 'moonlight.mxl');

    await waitFor(() => {
      expect(document.body.textContent).toContain('mxlの曲');
      expect(document.querySelectorAll('rect.vf-note-hit').length).toBeGreaterThan(0);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('非圧縮の .xml も従来どおり読み込める（バイト列読み替えの回帰確認）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await importFile(strToU8(SINGLE_XML), 'plain.xml');
    await waitFor(() => {
      expect(document.body.textContent).toContain('mxlの曲');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('XML の入っていない ZIP は理由つきで通知され、譜面は変わらない（#318）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const badMxl = zipSync({ 'readme.txt': strToU8('no xml') });
    await importFile(badMxl, 'broken.mxl');

    await waitFor(() => {
      expect(document.body.textContent).toContain('MusicXML が見つかりませんでした');
    }, { timeout: 15000 });
    // 元の譜面（読込前）が保たれている
    expect(document.body.textContent).toContain('読込前');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('PK で始まる壊れた ZIP の .mxl は展開失敗として通知される', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const valid = zipSync({ 'score.xml': strToU8(SINGLE_XML) });
    await importFile(valid.slice(0, Math.floor(valid.length / 2)), 'truncated.mxl');

    await waitFor(() => {
      expect(document.body.textContent).toContain('展開できませんでした');
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('読込前');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ZIP マジックの無い .mxl（先頭破損）は notZip として通知される', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await importFile(strToU8('this is not a zip at all'), 'headless.mxl');

    await waitFor(() => {
      expect(document.body.textContent).toContain('圧縮MusicXML（ZIP）として読めませんでした');
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('読込前');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
