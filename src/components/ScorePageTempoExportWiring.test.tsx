// 全体テンポの MusicXML 書き出し/読み込み配線テスト（#518・Codex round1 P2）。
//
// ユーティリティ単体（musicXmlTempo.test.ts）は scoreToMusicXml へ直接 { globalBpm } を
// 渡すため、ScorePage の書き出しハンドラが globalBpm を渡し忘れる配線漏れ・
// 読み込みハンドラが globalBpm を再生パネルへ反映し忘れる配線漏れを検出できない。
// ここでは実操作（ファイルタブから書き出し / 読み込み）で両方向を固定する。
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

function seedWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: 'テンポ配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single', 'C'
  );
  const created = createWork('テンポ配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: 全体テンポの MusicXML 書き出し/読み込み配線（#518）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let exportedXml: string | null;
  let origCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
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

  it('再生パネルの全体テンポが書き出しへ渡り、読み込みでパネルへ戻る', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 書き出し方向: 再生パネルのテンポを既定値ではない 132 へ変えてから書き出す。
    // 既定値 120 のまま確かめると、ハンドラが 120 をハードコードしても通ってしまう（round2 P3）
    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    const tempoInputForExport = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
    fireEvent.change(tempoInputForExport, { target: { value: '132' } });
    fireEvent.blur(tempoInputForExport);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => { expect(exportedXml ?? '').toContain('<sound tempo="132"/>'); }, { timeout: 15000 });

    // 読み込み方向: 先頭小節に <sound tempo="126"> を持つ XML を読み込むと、
    // 再生パネルのテンポ入力が 126 になること（従来は 120 のままだった）
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>126</per-minute></metronome></direction-type><sound tempo="126"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
    const input = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((i) => (i.getAttribute('accept') ?? '').includes('.mxl')) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [new File([xml], 'tempo.xml', { type: 'application/xml' })] } });

    fireEvent.click(screen.getByRole('tab', { name: '再生・音色' }));
    await waitFor(() => {
      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
      expect(tempoInput.value).toBe('126');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('連符入り作品の実マウント書き出しで divisions とテンポが共存する（#519×#518 統合）', async () => {
    // 8分3連×1組 + 4分休符×3 = 4拍
    const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
    const events = [
      { dur: '8' as const, isRest: false, keys: ['c/4'], tuplet },
      { dur: '8' as const, isRest: false, keys: ['d/4'], tuplet },
      { dur: '8' as const, isRest: false, keys: ['e/4'], tuplet },
      { dur: '4' as const, isRest: true, keys: ['b/4'] },
      { dur: '4' as const, isRest: true, keys: ['b/4'] },
      { dur: '4' as const, isRest: true, keys: ['b/4'] },
    ];
    const data = createSavedScoreData(
      { title: '連符テンポ統合', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
      1, 1, 'single', 'C'
    );
    const created = createWork('連符テンポ統合');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
    await waitFor(() => {
      // #519: 連符に合わせた divisions（16×3=48）と、#518: 全体テンポ direction+メタが同じ出力に共存する
      expect(exportedXml ?? '').toContain('<divisions>48</divisions>');
      expect(exportedXml ?? '').toContain('<sound tempo="120"/>');
      expect(exportedXml ?? '').toContain('<miscellaneous-field name="music-editer.global-bpm">120</miscellaneous-field>');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
