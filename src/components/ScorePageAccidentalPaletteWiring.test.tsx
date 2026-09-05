// 統合後の臨時記号パレット（#548）の ScorePage 配線テスト（round1 P2-5）。
//
// 既存の受入テストは Palette / PianoSystemCanvas への props 直接注入なので、
// 「実際にボタンを押して tool state が変わり、譜面クリックの結果が保存まで届く」
// 経路が切れても緑のままになる。ここでは round1 で差し戻された4点を実マウントで固定する:
//   1. 微分音（¼♯）を ▾ から選んで、音の無い高さをクリック → 微分音付きの音符が入る
//   2. 通常の ♯ で調号領域をクリック → 調号が1つシャープ側へ動く（微分音との分岐が壊れていない）
//   3. 段またぎ（renderStaff）した和音の符頭クリック → その1音だけに付く（和音全体へ付かない）
//   4. ¼♯ で休符をクリック → 置換された音符に微分音が乗る
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';
import type { PartData } from '../types/storage';

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

let workId = '';

/** 単段（メロディ1本）の作品を作る。events はそのまま1小節目に入る */
function seedSingle(events: PartData['measures'][number]['events']) {
  const data = createSavedScoreData(
    { title: '臨時記号配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('臨時記号配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/**
 * ピアノ譜（右手・左手）の作品を作る。右手の1音目は和音で、`renderStaff: 'below'` で
 * 左手の五線へ描き移してある（段またぎ）。所属は右手のままなので、クリック判定は
 * 左手のクレフ（bass）で行われるのに、更新側が右手のクレフで引き直すと解決に失敗する
 * ＝ round1 P2-1 の状況をそのまま再現する。
 */
function seedCrossStaffChord() {
  const rightEvents = [
    { dur: '2' as const, isRest: false, keys: ['e/3', 'g/3'], renderStaff: 'below' as const },
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
  ];
  const leftEvents = [
    { dur: '1' as const, isRest: true, keys: ['d/3'] },
  ];
  const data = createSavedScoreData(
    { title: '段またぎ和音', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right', clef: 'treble', measures: [{ events: rightEvents, voices: [{ id: 'voice-1', events: rightEvents }] }] },
      { partId: 'left', clef: 'bass', measures: [{ events: leftEvents, voices: [{ id: 'voice-1', events: leftEvents }] }] },
    ],
    1, 1, 'piano'
  );
  const created = createWork('段またぎ和音');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** jsdom はレイアウトを持たないので、SVG の表示サイズを固定して座標換算を成立させる */
function mockSvgLayout(svg: SVGSVGElement): number {
  const width = parseFloat(svg.getAttribute('width') ?? '0') || CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  return width;
}

/** SVG 内部座標 → クリック座標（ScorePage は viewBox で縮尺しているので比率を掛ける） */
function clickRatio(svg: SVGSVGElement, width: number): number {
  const vb = (svg.getAttribute('viewBox') ?? '').split(/\s+/);
  return vb.length === 4 && parseFloat(vb[2]) > 0 ? width / parseFloat(vb[2]) : 1;
}

function noteHit(index: number, partIndex?: number): SVGRectElement {
  // 段またぎした音符は隣の五線に描かれるが、データ上の所属（data-part）は変わらない。
  // ピアノ譜では両手ぶんの当たり判定が同じ SVG に並ぶので、part で絞れるようにしてある。
  const partFilter = partIndex === undefined ? '' : `[data-part="${partIndex}"]`;
  const hit = document.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${index}"]${partFilter}`
  ) as SVGRectElement | null;
  expect(hit, `イベント${index}の当たり判定`).toBeTruthy();
  return hit!;
}

/** 統合後のパレット: 「♯▾」などのプルダウンを開いて変種を選ぶ */
function selectAccidentalVariant(familyMenu: RegExp, variant: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: familyMenu }));
  fireEvent.click(screen.getByRole('button', { name: variant }));
}

async function waitForScore() {
  await waitFor(() => { expect(document.querySelector('rect.vf-note-hit')).toBeTruthy(); }, { timeout: 15000 });
}

describe('統合後の臨時記号パレットの ScorePage 配線（#548 round1 P2-5）', () => {
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

  it('¼♯ を ▾ から選んで空きをクリックすると、微分音付きの音符が保存される', async () => {
    seedSingle([
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
    ]);
    render(<ScorePage />);
    await waitForScore();

    selectAccidentalVariant(/^シャープ系の種類を選ぶ/, /^臨時記号: 四分音上げ/);

    // 符頭のX範囲から外れたセル右端＝「音の無い高さ」＝入力の経路
    const hit = noteHit(2);
    const svg = hit.ownerSVGElement as SVGSVGElement;
    const ratio = clickRatio(svg, mockSvgLayout(svg));
    const x = parseFloat(hit.getAttribute('x')!) + parseFloat(hit.getAttribute('width')!) - 3;
    const y = parseFloat(hit.getAttribute('y')!) + parseFloat(hit.getAttribute('height')!) / 2;
    fireEvent.click(hit, { clientX: x * ratio, clientY: y * ratio });

    await waitFor(() => {
      const events = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events ?? [];
      expect(events.length).toBeGreaterThan(3);
      expect(events.at(-1)?.microtones).toEqual([{ keyIndex: 0, type: 'quarterSharp' }]);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('通常の ♯ で調号領域をクリックすると、調号がシャープ側へ1つ動く', async () => {
    seedSingle([{ dur: '1', isRest: false, keys: ['b/4'] }]);
    render(<ScorePage />);
    await waitForScore();

    // ♯（既定の変種）をON。プルダウンを開かずボタン本体を押す経路
    fireEvent.click(screen.getByRole('button', { name: /^臨時記号: シャープ/ }));

    // 調号領域は先頭段の左端（音部記号のすぐ右）。当たり判定と同じ矩形がデバッグ用に
    // 描かれているので、その中心を突く（受入テストのケース11と同じ狙い方）。
    const hit = noteHit(0);
    const svg = hit.ownerSVGElement as SVGSVGElement;
    const ratio = clickRatio(svg, mockSvgLayout(svg));
    const zone = svg.querySelector('rect.vf-key-signature-debug') as SVGRectElement | null;
    expect(zone, '調号領域のヒット矩形').toBeTruthy();
    const zx = parseFloat(zone!.getAttribute('x')!) + parseFloat(zone!.getAttribute('width')!) / 2;
    const zy = parseFloat(zone!.getAttribute('y')!) + parseFloat(zone!.getAttribute('height')!) / 2;
    fireEvent.click(zone!.previousElementSibling ?? svg, { clientX: zx * ratio, clientY: zy * ratio });

    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.keySignature).toBe('G');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('段またぎした和音の符頭をクリックすると、その1音だけに付く（和音全体へ付かない）', async () => {
    seedCrossStaffChord();
    render(<ScorePage />);
    await waitForScore();

    fireEvent.click(screen.getByRole('button', { name: /^臨時記号: シャープ/ }));

    // 段またぎした音符は左手の五線に描かれるが、所属は右手（data-part="0"）のまま。
    const hit = noteHit(0, 0);
    const svg = hit.ownerSVGElement as SVGSVGElement;
    const ratio = clickRatio(svg, mockSvgLayout(svg));
    const noteLeft = parseFloat(hit.getAttribute('data-note-left')!);
    const noteRight = parseFloat(hit.getAttribute('data-note-right')!);
    const line0Y = parseFloat(hit.getAttribute('data-line0-y')!);
    const spacing = parseFloat(hit.getAttribute('data-line-spacing')!);
    // ヘ音記号では A3 が第1線（line 0）。g/3 はその半段下＝line 0.5 で、
    // もう1音の e/3（line 1.5）とは1段離れているので、上側の符頭だけを狙える。
    const y = line0Y + 0.5 * spacing;
    fireEvent.click(hit, { clientX: ((noteLeft + noteRight) / 2) * ratio, clientY: y * ratio });

    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.keys?.some((key) => key.includes('#'))).toBe(true);
    }, { timeout: 15000 });
    const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
    // 和音全体へ付いていない＝#548 で廃止した一括付与が復活していない
    expect(ev?.keys?.filter((key) => key.includes('#')).length).toBe(1);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('♯をONにしたまま数字キーで音価を変えても、記号は外れない（マウスと同じ挙動）', async () => {
    seedSingle([{ dur: '4', isRest: false, keys: ['b/4'] }]);
    render(<ScorePage />);
    await waitForScore();

    const sharpButton = screen.getByRole('button', { name: /^臨時記号: シャープ/ });
    fireEvent.click(sharpButton);
    expect(sharpButton.style.border).toContain('2px'); // ON になっている前提を固定

    // 数字キー「4」＝8分音符。ツールを丸ごと差し替えていると、ここで ♯ が黙って落ちる
    fireEvent.keyDown(window, { key: '4' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '音符 8分' }).style.border).toContain('2px');
    });
    // ♯ は ON のまま（パレットの音価ボタンで持ち替えたときと同じ結果）
    expect(screen.getByRole('button', { name: /^臨時記号: シャープ/ }).style.border).toContain('2px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('¼♯ で休符をクリックすると、置換された音符に微分音が乗る', async () => {
    seedSingle([
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: true, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
    ]);
    render(<ScorePage />);
    await waitForScore();

    selectAccidentalVariant(/^シャープ系の種類を選ぶ/, /^臨時記号: 四分音上げ/);

    const hit = noteHit(1);
    const svg = hit.ownerSVGElement as SVGSVGElement;
    const ratio = clickRatio(svg, mockSvgLayout(svg));
    const restNote = svg.querySelector('.vf-stavenote[data-note="1"]') as SVGGElement | null;
    const rect = restNote?.getBoundingClientRect();
    const centerX = rect && rect.width > 0
      ? rect.left + rect.width / 2
      : (parseFloat(hit.getAttribute('x')!) + parseFloat(hit.getAttribute('width')!) / 2) * ratio;
    const y = parseFloat(hit.getAttribute('y')!) + parseFloat(hit.getAttribute('height')!) / 2;
    fireEvent.click(hit, { clientX: centerX, clientY: y * ratio });

    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[1];
      expect(ev?.isRest).toBe(false);
      expect(ev?.microtones).toEqual([{ keyIndex: 0, type: 'quarterSharp' }]);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
