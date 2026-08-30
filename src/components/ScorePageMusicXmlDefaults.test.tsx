// MusicXML の <defaults>（作品のレイアウト指定）引き継ぎの配線テスト（Issue #477）。
//
// Finale の書き出しは <defaults> に「その作品をどう組むか」（五線の大きさ・判型・余白）を
// 持っている。従来の読込はこれを全部捨てて既定サイズで組んでいたため、実曲を持ち込むと
// 「この小節は最小の1小節/段でも紙幅を超えます」警告が出ていた。
// ここでは (1) ファイル指定の引き継ぎ、(2) それでも収まらないときの自動縮小と通知、
// (3) 引き継いだ値が作品として保存されること、を実経路（input[type=file] の change）で固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, getLastOpenedWorkId, loadWorkAutosaveData, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import { staffHeightMmForNotationSize } from '../utils/musicXmlDefaults';

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

/**
 * 「音符の大きさ n%」に対応する <scaling> を作る。
 * MusicXML では 40 tenths ＝ 五線の高さなので、五線高(mm) をそのまま millimeters に書けばよい。
 */
function scalingFor(percent: number): string {
  return `<scaling><millimeters>${staffHeightMmForNotationSize(percent / 100).toFixed(4)}</millimeters><tenths>40</tenths></scaling>`;
}

/** mm → tenths（<scaling> の比で決まる。ここでは percent 指定の縮尺に合わせる） */
function tenthsFor(mm: number, percent: number): string {
  return (mm / (staffHeightMmForNotationSize(percent / 100) / 40)).toFixed(2);
}

function pageLayout(percent: number, marginMm: number): string {
  return `<page-layout>
      <page-height>${tenthsFor(297, percent)}</page-height>
      <page-width>${tenthsFor(210, percent)}</page-width>
      <page-margins type="both">
        <left-margin>${tenthsFor(marginMm, percent)}</left-margin>
        <right-margin>${tenthsFor(marginMm, percent)}</right-margin>
        <top-margin>${tenthsFor(marginMm, percent)}</top-margin>
        <bottom-margin>${tenthsFor(marginMm, percent)}</bottom-margin>
      </page-margins>
    </page-layout>`;
}

/** 32分音符を n 個並べた密な小節（実曲の細かいパッセージ相当）。 */
function denseNotes(n: number): string {
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  return Array.from({ length: n }, (_, i) => `
      <note>
        <pitch><step>${steps[i % steps.length]}</step><alter>1</alter><octave>5</octave></pitch>
        <duration>1</duration><voice>1</voice><type>32nd</type>
      </note>`).join('');
}

function scoreXml(defaultsXml: string, notesXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>defaults の曲</work-title></work>
  <defaults>${defaultsXml}</defaults>
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>8</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>${notesXml}
    </measure>
  </part>
</score-partwise>`;
}

async function importXml(xml: string, name = 'defaults.xml') {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  const input = Array.from(document.querySelectorAll('input[type="file"]'))
    .find((i) => (i.getAttribute('accept') ?? '').includes('.mxl')) as HTMLInputElement;
  expect(input).toBeTruthy();
  const file = new File([xml], name, { type: 'application/xml' });
  fireEvent.change(input, { target: { files: [file] } });
}

/** レイアウトタブの「音符の大きさ」スライダー（80〜200% の range）。 */
function notationSizeSlider(): HTMLInputElement {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
  const slider = Array.from(document.querySelectorAll('input[type="range"]'))
    .find((i) => i.getAttribute('min') === '80' && i.getAttribute('max') === '200') as HTMLInputElement;
  expect(slider).toBeTruthy();
  return slider;
}

/** レイアウトタブの「ページ余白（左右）」スライダー（8〜25mm の range のうち先頭）。 */
function sideMarginSlider(): HTMLInputElement {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
  const slider = Array.from(document.querySelectorAll('input[type="range"]'))
    .find((i) => i.getAttribute('min') === '8' && i.getAttribute('max') === '25') as HTMLInputElement;
  expect(slider).toBeTruthy();
  return slider;
}

describe('ScorePage: MusicXML の <defaults> を作品のレイアウトとして引き継ぐ（#477）', () => {
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

  it('ファイル指定の縮尺・余白を引き継いで開く（既定の150%・14mm ではなくファイルの値になる）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await importXml(scoreXml(`${scalingFor(120)}${pageLayout(120, 12)}`, `
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>32</duration><voice>1</voice><type>whole</type></note>`));

    await waitFor(() => {
      expect(document.body.textContent).toContain('defaults の曲');
    }, { timeout: 15000 });

    expect(notationSizeSlider().value).toBe('120');
    expect(sideMarginSlider().value).toBe('12');
    // 引き継いだことは黙らずに知らせる（#318）
    expect(document.body.textContent).toContain('音符の大きさを120%にしました');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ファイル指定どおりでは紙幅に収まらない場合は、収まる大きさまで下げて通知する', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 200%・余白25mm・32分×32 の密な小節＝ファイル指定のままでは1小節すら紙幅に入らない
    await importXml(scoreXml(`${scalingFor(200)}${pageLayout(200, 25)}`, denseNotes(32)));

    // 通知は数秒で消えるため、読込完了の合図としてこの通知そのものを待つ
    await waitFor(() => {
      expect(document.body.textContent).toContain('紙幅に収まらない小節があったため');
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('defaults の曲');
    expect(Number(notationSizeSlider().value)).toBeLessThan(200);
    // 受入条件1: 読み込んだ直後に紙幅超過の警告が出ていない
    expect(document.body.textContent).not.toContain('この小節は最小の1小節/段でも紙幅を超えます');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('引き継いだレイアウトは作品として保存される（保存→再読込で保持する）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await importXml(scoreXml(`${scalingFor(120)}${pageLayout(120, 12)}`, `
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>32</duration><voice>1</voice><type>whole</type></note>`));

    await waitFor(() => {
      expect(document.body.textContent).toContain('defaults の曲');
    }, { timeout: 15000 });

    // 自動保存（1.5秒デバウンス）で作品データへ書かれ、読み直しても同じ値で戻る
    await waitFor(() => {
      const workId = getLastOpenedWorkId();
      expect(workId).toBeTruthy();
      const restored = loadWorkAutosaveData(workId as string);
      expect(restored.data?.metadata.title).toBe('defaults の曲');
      expect(restored.data?.notationSizeMultiplier).toBe(1.2);
      expect(restored.data?.pageMargins).toEqual({ sideMm: 12, topMm: 12, bottomMm: 12 });
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
