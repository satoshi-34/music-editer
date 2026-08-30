// MusicXML の <defaults>（作品のレイアウト指定）引き継ぎの配線テスト（Issue #477）。
//
// Finale の書き出しは <defaults> に「その作品をどう組むか」（五線の大きさ・判型・余白）を
// 持っている。従来の読込はこれを全部捨てて既定サイズで組んでいたため、実曲を持ち込むと
// 「この小節は最小の1小節/段でも紙幅を超えます」警告が出ていた。
// ここでは (1) ファイル指定の引き継ぎ、(2) それでも収まらないときの自動縮小と通知、
// (3) 引き継いだ値が作品として保存されること、を実経路（input[type=file] の change）で固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage, { readPersonalPageMarginSettings } from './ScorePage';
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

  it('B4 の判型は用紙サイズとして引き継がれる（round1 P2: A4 以外の配線）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 100% スケーリング（7.0mm/40tenths ≒ 0.175mm/tenth）で B4（257×364mm）を指定
    const scaling = '<scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>';
    const layout = `<page-layout>
      <page-height>${Math.round(364 / 0.175)}</page-height>
      <page-width>${Math.round(257 / 0.175)}</page-width>
      <page-margins type="both">
        <left-margin>80</left-margin><right-margin>80</right-margin>
        <top-margin>80</top-margin><bottom-margin>69</bottom-margin>
      </page-margins>
    </page-layout>`;
    await importXml(scoreXml(`${scaling}${layout}`, `
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>32</duration><voice>1</voice><type>whole</type></note>`));
    await waitFor(() => { expect(document.body.textContent).toContain('defaults の曲'); }, { timeout: 15000 });

    // 用紙サイズが B4 になる（.spread の CSS 変数で確認・#496 の配線）
    await waitFor(() => {
      const spread = document.querySelector('.spread') as HTMLElement | null;
      expect(spread?.style.getPropertyValue('--paper-width').trim()).toBe('257mm');
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('Finale 実測値のゴールデンパス: 6.9674mm/40tenths・余白86tenths は警告なしで開ける（round1 P2）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 実物の Finale 書き出しと同じ値（#477 の実測例）。16分音符×16 の実密度でも
    // ファイル指定の縮尺のまま紙幅に収まること（=紙幅超過警告が出ない）
    const scaling = '<scaling><millimeters>6.9674</millimeters><tenths>40</tenths></scaling>';
    const layout = `<page-layout>
      <page-height>1705</page-height>
      <page-width>1206</page-width>
      <page-margins type="both">
        <left-margin>86</left-margin><right-margin>86</right-margin>
        <top-margin>86</top-margin><bottom-margin>86</bottom-margin>
      </page-margins>
    </page-layout>`;
    const sixteenths = Array.from({ length: 16 }, () =>
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>16th</type></note>'
    ).join('');
    await importXml(scoreXml(`${scaling}${layout}`, sixteenths));
    await waitFor(() => { expect(document.body.textContent).toContain('defaults の曲'); }, { timeout: 15000 });

    expect(document.body.textContent).not.toContain('紙幅を超えます');
    // 判型は A4 相当（210×297mm）へ解決される
    const spread = document.querySelector('.spread') as HTMLElement | null;
    expect(spread?.style.getPropertyValue('--paper-width').trim()).toBe('210mm');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('<defaults> の無いファイルは縮尺を変えず、収まる値の提案だけ通知する（round1 P1）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 表示設定を大きめ（200%・余白25mm）にして、defaults 無しファイルが
    // 紙幅に収まらない状況を作る（既存の「収まらない場合」テストと同じ密度条件）
    localStorageMock.setItem('score-notation-size', '2');
    localStorageMock.setItem('score-page-margin-side', '25');
    cleanup();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });
    const before = notationSizeSlider().value;
    expect(before).toBe('200');
    await importXml(scoreXml('', denseNotes(32)));
    await waitFor(() => { expect(document.body.textContent).toContain('defaults の曲'); }, { timeout: 15000 });

    // 縮尺は変わらない（開いただけで作品の縮尺が変更・保存される、を起こさない）
    expect(notationSizeSlider().value).toBe(before);
    // 提案だけが通知される
    expect(document.body.textContent).toContain('にすると収まります');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('属性つき作品から属性なし作品へ切り替えると、縮尺・余白は表示設定へ戻る（round1 P1: 前の作品の値が混入しない）', async () => {
    // 表示設定: 130%・左右10mm
    localStorageMock.setItem('score-notation-size', '1.3');
    localStorageMock.setItem('score-page-margin-side', '10');

    // 属性なし作品（旧データ相当）を先に作る
    const plain = createSavedScoreData(
      { title: '属性なし', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] }],
      1, 1, 'single'
    );
    delete (plain as { notationSizeMultiplier?: number }).notationSizeMultiplier;
    delete (plain as { pageMargins?: unknown }).pageMargins;
    const plainWork = createWork('属性なし');
    if (!plainWork.success || !plainWork.data) throw new Error('createWork failed');
    saveWorkAutosaveData(plainWork.data.id, plain);

    // 属性つき（120%・12mm）の作品を「前回の続き」にする
    const attributed = createSavedScoreData(
      { title: '属性つき', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] }],
      1, 1, 'single', 'C', [4, 4],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, 1.2, { sideMm: 12, topMm: 14, bottomMm: 12 },
    );
    const attrWork = createWork('属性つき');
    if (!attrWork.success || !attrWork.data) throw new Error('createWork failed');
    saveWorkAutosaveData(attrWork.data.id, attributed);
    setLastOpenedWorkId(attrWork.data.id);

    render(<ScorePage />);
    await waitFor(() => { expect(document.body.textContent).toContain('属性つき'); }, { timeout: 15000 });
    expect(notationSizeSlider().value).toBe('120');
    expect(sideMarginSlider().value).toBe('12');

    // 作品一覧から属性なし作品へ切り替える（一覧ボタンはファイルタブにある）
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.click(screen.getByRole('button', { name: /作品一覧/ }));
    const items = await screen.findAllByRole('button', { name: /属性なし/ });
    const openButton = items.find((b) => b.className.includes('work-list-item-open'));
    expect(openButton).toBeTruthy();
    fireEvent.click(openButton!);
    await waitFor(() => {
      expect(document.querySelector('.score-title')?.textContent).toContain('属性なし');
    }, { timeout: 15000 });

    // 前の作品の 120%/12mm ではなく、表示設定の 130%/10mm へ戻る
    expect(notationSizeSlider().value).toBe('130');
    expect(sideMarginSlider().value).toBe('10');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('縮尺スライダーだけを変えても自動保存へ反映される（round1/round2 P1: layoutAttrRevision 経路）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });
    const workId = getLastOpenedWorkId();
    expect(workId).toBeTruthy();

    // 譜面本体には触れず、スライダーだけを 120% へ
    fireEvent.change(notationSizeSlider(), { target: { value: '120' } });

    // デバウンス（1.5秒）後の自動保存で作品属性が更新される
    await waitFor(() => {
      const saved = loadWorkAutosaveData(workId!);
      expect(saved.success).toBe(true);
      expect(saved.data?.notationSizeMultiplier).toBeCloseTo(1.2, 5);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('<defaults> の無い取り込みは、現在の縮尺・余白を一切変えない（round2 P1: 個人設定へも戻さない）', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 15000 });

    // 現在の作品を 120%/12mm にし、個人設定はそれと異なる 130%/10mm にしておく
    fireEvent.change(notationSizeSlider(), { target: { value: '120' } });
    fireEvent.change(sideMarginSlider(), { target: { value: '12' } });
    localStorageMock.setItem('score-notation-size', '1.3');
    localStorageMock.setItem('score-page-margin-side', '10');

    await importXml(scoreXml('', `
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>32</duration><voice>1</voice><type>whole</type></note>`));
    await waitFor(() => { expect(document.body.textContent).toContain('defaults の曲'); }, { timeout: 15000 });

    // 取り込みは作品切替ではないので、120%/12mm のまま（130/10 へ化けない）
    expect(notationSizeSlider().value).toBe('120');
    expect(sideMarginSlider().value).toBe('12');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('旧・縦余白キーの換算は state 初期化と同順（生値−2mm→クランプ。round4 P2）', () => {
    // 旧値26mm: 下= (26−2)=24mm（先にクランプすると 25−2=23 になってしまう）
    localStorageMock.setItem('score-page-margin-vertical', '26');
    const margins = readPersonalPageMarginSettings();
    expect(margins.topMm).toBe(25); // 上は 26 → 上限25へクランプ
    expect(margins.bottomMm).toBe(24);
  });
});
