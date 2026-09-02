// Issue #568 の配線テスト（統合テスト）。
//
// ペダル記号入りの MusicXML を、実際の「ファイル」タブ → ファイル選択の経路で読み込み、
// **画面に Ped / ✱ が描かれる**ことを固定する。純関数側（parse・往復・持ち越し）は
// src/utils/musicXmlPedal.test.ts が担当し、ここは
// 「読込 → ScorePage state → SVG 描画」まで配線が通っていることを見る（round2 P2）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

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

const MOUNT_HEAVY_TIMEOUT_MS = 120000;

function seedEmptyWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '読込前', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 4, 'single'
  );
  const created = createWork('読込前');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

const PEDAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>ペダル配線</work-title></work>
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>16</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><pedal type="start" line="no"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>32</duration><type>half</type></note>
      <direction placement="below"><direction-type><pedal type="stop" line="no"/></direction-type></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>32</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

describe('ScorePage: ペダル記号入り MusicXML の読込配線（#568）', () => {
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

  it('読み込んだペダル記号が SVG に Ped / ✱ として描かれる', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 30000 });

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const input = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((i) => (i.getAttribute('accept') ?? '').includes('.mxl')) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, {
      target: { files: [new File([PEDAL_XML], 'pedal.musicxml', { type: 'application/xml' })] },
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('ペダル配線');
    }, { timeout: 30000 });

    // 描画側のペダル表記（Ped と ✱）が SVG のテキストに出ること
    await waitFor(() => {
      const svgText = Array.from(document.querySelectorAll('svg text'))
        .map((t) => t.textContent ?? '').join('');
      expect(svgText).toContain('Ped');
      expect(svgText).toContain('✱');
    }, { timeout: 30000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
