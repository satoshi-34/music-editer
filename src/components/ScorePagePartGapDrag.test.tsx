// 段の中のパート境界ドラッグで「パート間隔」を変える（Issue #572）の実マウント配線テスト。
//
// 受け入れ（Issue #572）:
// - ピアノ譜で右手と左手の間の境界をドラッグ→「パート間隔」の数値が連動して変わる
// - 段の間隔のバンドと取り違えない（境界ごとに動くのは掴んだ場所だけ）
// - 実マウント配線テスト（#539 の ScorePageSystemGapDrag.test.tsx と同水準）で固定する
//
// 仕様2「#539 に完全準拠」のうち、ズーム補正・pointer 規約（#536）・上書き値起点・
// 遊び（3px）は共通部品（LayoutGapDragBand）を #523 と共用しているので、ここでは
// この Issue で新しく配線した部分（境界の位置・境界ごとの移動量・値の行き先・Undo）を
// 中心に固定する。
//
// Undo について（round1 P1-1 で差し戻し）: 初版は「パート間隔は表示設定だから履歴の外」と
// していたが、受入条件は #539 と同じ「ドラッグ全体で1件・無変化なら0件」のまま。
// 音符の大きさ（#571）と同じく partSpacingOffsetPx を Undo/Redo のスナップショットへ入れ、
// 帯は段の間隔・角の◢と同じ beginLayoutValueDrag / endLayoutValueDrag に相乗りしている。
//
// 帯を出す条件（仕様4）: #614（#571 の整えるモード）が main へ入ったので、
// 段の上端の帯・角の◢と同じく「レイアウトタブを開いている間」だけ出る（段の選択は不要）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { ensembleSecondStaffPartId } from '../utils/instrumentationPartUtils';
import { computeLayout, STAVE_TOP_LINE_OFFSET } from '../utils/measureLayoutUtils';
import type { InstrumentPartDefinition, MeasureData, PartData, ScoreType } from '../types/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;
const MEASURE_COUNT = 8;
/** パート間隔の保存先（ScorePage の PART_SPACING_OFFSET_KEY と同じ文字列） */
const PART_SPACING_OFFSET_KEY = 'score-part-spacing-offset';
/** 段内のパート数（描画に使う computeLayout の引数と同じ意味。編成譜は大譜表を2段と数える） */
const PART_COUNT: Record<string, number> = { single: 1, piano: 2, quartet: 4, ensemble: 3 };

/** 全音符1つだけの小節（幅が細く、段あたり小節数の自動計画が安定する） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
}

function makeInstrumentPart(overrides: Partial<InstrumentPartDefinition> & { id: string }): InstrumentPartDefinition {
  return {
    name: overrides.id,
    abbreviation: overrides.id,
    family: 'woodwind',
    clef: 'treble',
    staffCount: 1,
    transposition: 'C',
    bracketGroup: 'woodwinds',
    order: 0,
    ...overrides,
  };
}

function seedWork(scoreType: ScoreType) {
  const measures = () => Array.from({ length: MEASURE_COUNT }, sparseMeasure);
  const parts: PartData[] = scoreType === 'piano'
    ? [
      { partId: 'right', clef: 'treble' as const, measures: measures() },
      { partId: 'left', clef: 'bass' as const, measures: measures() },
    ]
    : scoreType === 'quartet'
      ? [
        { partId: 'violin-1', clef: 'treble' as const, measures: measures() },
        { partId: 'violin-2', clef: 'treble' as const, measures: measures() },
        { partId: 'viola', clef: 'alto' as const, measures: measures() },
        { partId: 'cello', clef: 'bass' as const, measures: measures() },
      ]
      : scoreType === 'ensemble'
        // フルート（1段）＋ハープ（大譜表＝2段）の編成。段の中の五線は3本になり、
        // パート境界は2つ（フルート↔ハープ上段 / ハープ上段↔ハープ下段）。
        // 大譜表を含む編成は totalEnsembleStaffCount の経路を通るので、
        // ピアノ・四重奏では保証できない（round1 P2-2）
        ? [
          { partId: 'flute', clef: 'treble' as const, measures: measures() },
          { partId: 'harp', clef: 'treble' as const, measures: measures() },
          { partId: ensembleSecondStaffPartId('harp'), clef: 'bass' as const, measures: measures() },
        ]
        : [{ partId: 'melody', clef: 'treble' as const, measures: measures() }];
  const data = createSavedScoreData(
    { title: 'パート境界ドラッグテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    scoreType,
    'C',
    [4, 4],
    scoreType === 'ensemble'
      ? {
        presetId: 'custom',
        name: 'テスト編成',
        parts: [
          makeInstrumentPart({ id: 'flute', name: 'Flute', abbreviation: 'Fl.' }),
          makeInstrumentPart({ id: 'harp', name: 'Harp', abbreviation: 'Hp.', staffCount: 2, bracketGroup: 'strings', order: 1 }),
        ],
      }
      : undefined
  );
  const created = createWork('パート境界ドラッグテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

async function renderScore(scoreType: ScoreType) {
  seedWork(scoreType);
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
}

/** ツールバーのタブを切り替える（表示名は TOOLBAR_TAB_BUTTONS の正本） */
function openTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

/**
 * 帯が出る条件（整えるモード＝レイアウトタブ）にする。#614（#571）以降、帯は
 * 段の選択ではなくこのタブの表示で出入りする。
 */
function enterLayoutAdjustMode() {
  openTab('レイアウト');
}

/** 画面に出ている段（選択できるもの）の先頭小節を、上から順に並べて返す */
function systemStartMeasures(): number[] {
  return Array.from(document.querySelectorAll('[data-testid^="system-frame-"]'))
    .map((el) => Number((el as HTMLElement).dataset.testid!.replace('system-frame-', '')));
}

function partBand(start: number, boundaryIndex: number): HTMLElement {
  return screen.getByTestId(`part-gap-drag-${start}-${boundaryIndex}`) as HTMLElement;
}

/** 帯に入っている top（レイアウトpx）。境界の位置そのもの */
function bandTopPx(start: number, boundaryIndex: number): number {
  return parseFloat(partBand(start, boundaryIndex).style.top);
}

/**
 * 「論理座標1単位あたり何レイアウトpx か」（＝実効描画倍率）を、描かれた SVG から逆算する。
 * 音符の大きさの既定値（譜種で違う）をテストへ焼き込まないための逃げ道で、
 * SVG の高さ属性は `computeLayout().sysH × 倍率` そのもの（PianoSystemCanvas の
 * renderer.resize）なので、その比が倍率になる。帯の位置から逆算すると
 * 「帯が正しい位置にあるか」を帯自身で確かめることになってしまうため、ここは独立させる。
 */
function readRenderScale(scoreType: ScoreType, offsetPx: number): number {
  const svg = document.querySelector('.system-select-inner svg');
  const height = parseFloat(svg!.getAttribute('height')!);
  return height / computeLayout(PART_COUNT[scoreType], offsetPx).sysH;
}

/**
 * 実際に描かれた五線そのものの上端（第1線）の y（VexFlow の論理単位）を、上から順に返す。
 * VexFlow の SVG 出力では、五線の5本の横線は `<path d="M x y L x y">` として描かれるので、
 * `.vf-stave` の最初の path の y を読めば「その五線の第1線」が分かる（jsdom には
 * getBBox が無いため、属性を直に読むのがこの環境で唯一の実測手段）。
 * 帯はこの位置に重なっていなければならない（ブラウザ実測で、computeLayout の staveYs を
 * そのまま使うと VexFlow が五線の上に取る余白ぶん＝STAVE_TOP_LINE_OFFSET だけ
 * 上にずれることが分かった）。
 */
function renderedStaveTopYs(): number[] {
  const ys = new Set<number>();
  document.querySelectorAll('.system-select-inner .vf-stave').forEach((g) => {
    const d = g.querySelector('path')?.getAttribute('d');
    const m = d?.match(/^M[\s]*[-\d.]+[\s]+([-\d.]+)/);
    // VexFlow は線を1pxくっきり描くために y+0.5 の位置へ引く。その 0.5 を戻す
    if (m) ys.add(Math.round(Number(m[1]) - 0.5));
  });
  return [...ys].sort((a, b) => a - b);
}

/** 境界 i の帯が、実際に描かれた i+1 番目の五線の上端に重なっていること */
function expectBandOnStaveTop(start: number, boundaryIndex: number, scale: number) {
  const staveTops = renderedStaveTopYs();
  expect(staveTops.length).toBeGreaterThan(boundaryIndex + 1);
  expect(bandTopPx(start, boundaryIndex)).toBeCloseTo(staveTops[boundaryIndex + 1] * scale, 1);
}

/** レイアウトタブの「パート間隔」スライダーの現在値（＝保存される全体設定） */
function readPartSpacingSliderValue(): number {
  return Number((screen.getByLabelText('パート間隔') as HTMLInputElement).value);
}

/** 主ポインタの左ボタンで掴む（#536 の規約どおり isPrimary / button / pointerId をそろえる） */
function grab(handle: HTMLElement, clientY: number, pointerId = 1, pointerType = 'mouse') {
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId, pointerType, clientX: 300, clientY });
}

describe('ScorePage: 段の中のパート境界ドラッグでパート間隔を変える（Issue #572）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom は実レイアウトを持たないので、譜面の幅（小節幅の配分に使う）を固定する。
    // 高さ（offsetHeight）は 0 のままで、ドラッグ側は「実測できない＝等倍」として扱う
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('音符・休符タブでは帯が出ない（譜面を書いている間の見た目は変えない）', async () => {
    await renderScore('piano');
    expect(document.querySelector('.system-gap-drag-handle--part')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('整えるモード中は、段を選んでいなくても全段にパート境界の帯が出る（仕様4・#571）', async () => {
    await renderScore('piano');
    const starts = systemStartMeasures();
    enterLayoutAdjustMode();
    await waitFor(() => {
      expect(screen.getByTestId(`part-gap-drag-${starts[0]}-0`)).toBeTruthy();
    });
    // 段を1つも選んでいない（パネルが出ていない）状態でも、2段目以降にも出ている
    expect(screen.queryByTestId(`system-layout-panel-${starts[0]}`)).toBeNull();
    expect(screen.getByTestId(`part-gap-drag-${starts[1]}-0`)).toBeTruthy();

    // 掴むとその段がそのまま選択される（掴む→調整が1操作。#571 と同じ作法）
    grab(partBand(starts[1], 0), 200);
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${starts[1]}`)).toBeTruthy();
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 200 });

    // 音符・休符タブへ戻すと帯は消える（選択が残っていても譜面には出さない）
    openTab('音符・休符');
    await waitFor(() => {
      expect(document.querySelector('.system-gap-drag-handle--part')).toBeNull();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('単旋律譜には帯を出さない（段の中にパート境界が無い）', async () => {
    await renderScore('single');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => {
      // 段の上端の帯（#523）は2段目以降に出る＝整えるモードにはなっている
      expect(document.querySelector('.system-gap-drag-handle')).toBeTruthy();
    });
    expect(screen.queryByTestId(`part-gap-drag-${start}-0`)).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ピアノ譜: 右手と左手の境界を下へドラッグすると、パート間隔の数値が連動して増える（受入1）', async () => {
    await renderScore('piano');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    const scale = readRenderScale('piano', before);
    expect(scale).toBeGreaterThan(0);
    // 掴む前に、帯が「実際に描かれた左手の五線の上端」に重なっていることを確かめる
    expectBandOnStaveTop(start, 0, scale);

    grab(partBand(start, 0), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 230 });
    // 最初の境界は「間隔1つぶん」で動くので、画面30px ÷ 倍率 が値の増分になる
    const expected = before + Math.round(30 / scale);
    await waitFor(() => {
      // 帯そのものが指について下がる（掴んだ境界が動く）
      expect(bandTopPx(start, 0)).toBeCloseTo(
        (computeLayout(2, expected).staveYs[1] + STAVE_TOP_LINE_OFFSET) * scale, 3
      );
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 230 });
    // 広がった五線の位置にも帯が付いてきている（再描画後の実測との突き合わせ）
    await waitFor(() => {
      expectBandOnStaveTop(start, 0, readRenderScale('piano', expected));
    });

    // レイアウトタブの数値（＝保存される全体設定）も同じ値になっている
    expect(readPartSpacingSliderValue()).toBe(expected);
    expect(localStorage.getItem(PART_SPACING_OFFSET_KEY)).toBe(String(expected));
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('段の間隔の帯とは取り違えない（パート帯は段の marginTop を動かさない・その逆も）', async () => {
    await renderScore('piano');
    const starts = systemStartMeasures();
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${starts[0]}-0`)).toBeTruthy(); });
    const frame = screen.getByTestId(`system-frame-${starts[0]}`) as HTMLElement;
    const partSpacingBefore = readPartSpacingSliderValue();

    // パート境界を掴んでも、段の間隔（ラッパーの marginTop）は1pxも動かない
    grab(partBand(starts[0], 0), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 240 });
    await waitFor(() => {
      expect(bandTopPx(starts[0], 0)).toBeGreaterThan(0);
    });
    expect(frame.style.marginTop).toBe('');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 240 });

    // 逆に、段の上端の帯（#523）を掴んでもパート間隔は変わらない。
    // 段の上端の帯は「ページの先頭ではない段」にしか出ないので2段目で確かめる
    const partSpacingAfterPartDrag = readPartSpacingSliderValue();
    grab(screen.getByTestId(`system-gap-drag-${starts[1]}`) as HTMLElement, 200, 2);
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 300, clientY: 218 });
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('18px');
    });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 300, clientY: 218 });
    expect(readPartSpacingSliderValue()).toBe(partSpacingAfterPartDrag);
    expect(partSpacingAfterPartDrag).not.toBe(partSpacingBefore);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('弦楽四重奏: 段内の境界の数だけ帯が出て、下の境界ほど1目盛りで大きく動く（掴んだ境界が指に付く）', async () => {
    await renderScore('quartet');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    // 4パート＝境界は3つ（1-2 / 2-3 / 3-4）
    expect(screen.getByTestId(`part-gap-drag-${start}-2`)).toBeTruthy();
    expect(screen.queryByTestId(`part-gap-drag-${start}-3`)).toBeNull();
    const scale = readRenderScale('quartet', before);
    // 3つの帯がそれぞれ「実際に描かれた2・3・4番目の五線の上端」に重なっている
    [0, 1, 2].forEach((i) => expectBandOnStaveTop(start, i, scale));

    // 2番目の境界（index 1）は、その上に間隔が2つ積み上がっている。
    // 画面で 30px 下げたときの値の増分は 30 ÷ (倍率 × 2)
    grab(partBand(start, 1), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 230 });
    const expected = before + Math.round(30 / (scale * 2));
    await waitFor(() => {
      expect(bandTopPx(start, 1)).toBeCloseTo(
        (computeLayout(4, expected).staveYs[2] + STAVE_TOP_LINE_OFFSET) * scale, 3
      );
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 230 });
    expect(readPartSpacingSliderValue()).toBe(expected);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('編成譜（大譜表を含む）でも、五線の本数どおりに帯が出て値が連動する（round1 P2-2）', async () => {
    await renderScore('ensemble');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    // フルート1段＋ハープの大譜表2段＝五線3本なので、境界は2つ
    // （パート数ではなく totalEnsembleStaffCount で数えていないとここが1つになる）
    expect(screen.getByTestId(`part-gap-drag-${start}-1`)).toBeTruthy();
    expect(screen.queryByTestId(`part-gap-drag-${start}-2`)).toBeNull();
    const scale = readRenderScale('ensemble', before);
    [0, 1].forEach((i) => expectBandOnStaveTop(start, i, scale));

    // 2番目の境界（ハープの上段↔下段）も、上に間隔が2つ積み上がるぶんを割り戻している
    grab(partBand(start, 1), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 230 });
    const expected = before + Math.round(30 / (scale * 2));
    await waitFor(() => {
      expect(bandTopPx(start, 1)).toBeCloseTo(
        (computeLayout(3, expected).staveYs[2] + STAVE_TOP_LINE_OFFSET) * scale, 3
      );
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 230 });
    expect(readPartSpacingSliderValue()).toBe(expected);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('画面の拡大率（ズーム）ぶんを割り戻して、指と境界が1:1で動く', async () => {
    await renderScore('piano');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    const scale = readRenderScale('piano', before);
    const frame = screen.getByTestId(`system-frame-${start}`) as HTMLElement;
    // 表示倍率 150%（レイアウト100px の段が画面上では150px で見えている）を作る
    Object.defineProperty(frame, 'offsetHeight', { value: 100, configurable: true });
    frame.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 900, bottom: 150, width: 900, height: 150, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    grab(partBand(start, 0), 200);
    // 画面で45px 動かしたら、レイアウト上は 45 / 1.5 = 30px ぶんの移動として扱う
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 245 });
    const expected = before + Math.round(30 / scale);
    await waitFor(() => {
      expect(bandTopPx(start, 0)).toBeCloseTo(
        (computeLayout(2, expected).staveYs[1] + STAVE_TOP_LINE_OFFSET) * scale, 3
      );
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 245 });
    expect(readPartSpacingSliderValue()).toBe(expected);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('pointercancel（OS がポインタを取り上げた）では掴む前の値へ戻す', async () => {
    await renderScore('piano');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    const topBefore = bandTopPx(start, 0);

    grab(partBand(start, 0), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 230 });
    await waitFor(() => {
      expect(bandTopPx(start, 0)).toBeGreaterThan(topBefore);
    });

    fireEvent.pointerCancel(window, { pointerId: 1 });
    await waitFor(() => {
      expect(bandTopPx(start, 0)).toBeCloseTo(topBefore, 3);
    });
    expect(readPartSpacingSliderValue()).toBe(before);
    expect(localStorage.getItem(PART_SPACING_OFFSET_KEY)).toBe(String(before));
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ドラッグ中に帯がアンマウントされたら（タブを離れる）掴む前の値へ戻り、履歴も残らない（round1 P2-1）', async () => {
    await renderScore('piano');
    const starts = systemStartMeasures();
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${starts[0]}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    // 履歴に残る操作を1つだけ作る（段の間隔の ＋ は systemRowGapOverrides＝譜面データ側）
    fireEvent.click(screen.getByTestId(`system-select-left-${starts[1]}`));
    await waitFor(() => { expect(screen.getByTestId(`system-gap-increase-${starts[1]}`)).toBeTruthy(); });
    fireEvent.click(screen.getByTestId(`system-gap-increase-${starts[1]}`));
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('4px');
    });

    // 引いている途中で帯を画面から外す。#614 以降、帯は段の選択ではなく
    // 「レイアウトタブを開いているか」で出入りするので、タブの切り替えが
    // 「ドラッグ中のアンマウント」にあたる（Esc の選択解除では帯は消えない）
    grab(partBand(starts[0], 0), 200, 3);
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 300, clientY: 230 });
    await waitFor(() => { expect(readPartSpacingSliderValue()).not.toBe(before); });
    openTab('音符・休符');
    await waitFor(() => {
      expect(document.querySelector('.system-gap-drag-handle--part')).toBeNull();
    });
    // 値も保存先も掴む前へ戻っている
    enterLayoutAdjustMode();
    await waitFor(() => { expect(readPartSpacingSliderValue()).toBe(before); });
    expect(localStorage.getItem(PART_SPACING_OFFSET_KEY)).toBe(String(before));

    // 積みかけた履歴も取り消されている＝「元に戻す」1回で段の間隔の ＋ まで戻る
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ドラッグ1回＝「元に戻す」1回でパート間隔が掴む前へ戻る（仕様2・round1 P1-1）', async () => {
    await renderScore('piano');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();

    // 30px 引く間に値は何度も変わるが、履歴に積まれるのは最初の1件だけ
    grab(partBand(start, 0), 200);
    [210, 215, 220, 225, 230].forEach((clientY) => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY });
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 230 });
    await waitFor(() => { expect(readPartSpacingSliderValue()).toBeGreaterThan(before); });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(readPartSpacingSliderValue()).toBe(before);
    }, { timeout: 15000 });
    // 保存先も一緒に戻る（state だけ戻すと次回起動で戻す前の値が復活する）
    expect(localStorage.getItem(PART_SPACING_OFFSET_KEY)).toBe(String(before));
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('掴む前と同じ値に戻して離したときは履歴を1件も使わない（仕様2・無変化なら0件）', async () => {
    await renderScore('piano');
    const starts = systemStartMeasures();
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${starts[0]}-0`)).toBeTruthy(); });
    const before = readPartSpacingSliderValue();
    // 履歴に残る操作を1つだけ作る
    fireEvent.click(screen.getByTestId(`system-select-left-${starts[1]}`));
    await waitFor(() => { expect(screen.getByTestId(`system-gap-increase-${starts[1]}`)).toBeTruthy(); });
    fireEvent.click(screen.getByTestId(`system-gap-increase-${starts[1]}`));
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('4px');
    });

    // 引いてから同じ位置へ戻して離す
    grab(partBand(starts[0], 0), 200, 4);
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 300, clientY: 230 });
    await waitFor(() => { expect(readPartSpacingSliderValue()).toBeGreaterThan(before); });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 300, clientY: 200 });
    await waitFor(() => { expect(readPartSpacingSliderValue()).toBe(before); });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 300, clientY: 200 });

    // 「元に戻す」1回で段の間隔の ＋ まで戻る（ドラッグが履歴を消費していたら '4px' のまま）
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('レイアウトタブのスライダーも、つまみ操作1回＝「元に戻す」1回で戻る', async () => {
    await renderScore('piano');
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByLabelText('パート間隔')).toBeTruthy(); });
    const slider = screen.getByLabelText('パート間隔') as HTMLInputElement;
    const before = Number(slider.value);

    // 1回のつまみ操作（押す→連続で値が変わる→離す）
    fireEvent.pointerDown(slider, { button: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse' });
    [before + 3, before + 6, before + 9].forEach((v) => {
      fireEvent.change(slider, { target: { value: String(v) } });
    });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    await waitFor(() => { expect(readPartSpacingSliderValue()).toBe(before + 9); });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(readPartSpacingSliderValue()).toBe(before);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('帯を mousedown（pointer の互換イベント）で押しても段の選択が解けない', async () => {
    await renderScore('piano');
    const start = systemStartMeasures()[0];
    enterLayoutAdjustMode();
    await waitFor(() => { expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy(); });
    fireEvent.click(screen.getByTestId(`system-select-left-${start}`));
    await waitFor(() => { expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy(); });

    fireEvent.mouseDown(partBand(start, 0), { button: 0 });
    expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy();
    expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
