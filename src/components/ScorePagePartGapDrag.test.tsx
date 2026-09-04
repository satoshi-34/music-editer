// 段の中のパート境界ドラッグで「パート間隔」を変える（Issue #572）の実マウント配線テスト。
//
// 受け入れ（Issue #572）:
// - ピアノ譜で右手と左手の間の境界をドラッグ→「パート間隔」の数値が連動して変わる
// - 段の間隔のバンドと取り違えない（境界ごとに動くのは掴んだ場所だけ）
// - 実マウント配線テスト（#539 の ScorePageSystemGapDrag.test.tsx と同水準）で固定する
//
// 仕様2「#539 に完全準拠」のうち、ズーム補正・pointer 規約（#536）・上書き値起点・
// 遊び（3px）は共通部品（LayoutGapDragBand）を #523 と共用しているので、ここでは
// この Issue で新しく配線した部分（境界の位置・境界ごとの移動量・値の行き先）を中心に固定する。
//
// Undo について: パート間隔はレイアウトタブのスライダーと同じ「ブラウザに保存する表示設定」で、
// 譜面データの履歴（pushHistory）の対象ではない。したがってドラッグでも履歴を積まない
// （積むと「元に戻す」がパート間隔を戻さずに譜面だけ巻き戻す食い違いになる）。
// その意図を「ドラッグは履歴を1件も消費しない」テストで固定してある。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { computeLayout, STAVE_TOP_LINE_OFFSET } from '../utils/measureLayoutUtils';
import type { MeasureData, PartData, ScoreType } from '../types/storage';

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
/** 段内のパート数（描画に使う computeLayout の引数と同じ意味） */
const PART_COUNT: Record<string, number> = { single: 1, piano: 2, quartet: 4 };

/** 全音符1つだけの小節（幅が細く、段あたり小節数の自動計画が安定する） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
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
      : [{ partId: 'melody', clef: 'treble' as const, measures: measures() }];
  const data = createSavedScoreData(
    { title: 'パート境界ドラッグテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    scoreType
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

/** 画面に出ている段（選択できるもの）の先頭小節を、上から順に並べて返す */
function systemStartMeasures(): number[] {
  return Array.from(document.querySelectorAll('[data-testid^="system-frame-"]'))
    .map((el) => Number((el as HTMLElement).dataset.testid!.replace('system-frame-', '')));
}

/**
 * その段を選択状態にして、パネルが出るまで待つ。すでに選ばれているときは何もしない。
 * 端の当たり判定はトグル（同じ端をもう一度押すと閉じる）なので、選択済みで押すと
 * かえって解除されてしまう。ここで冪等（何回呼んでも同じ結果）にしておく。
 */
async function ensureSystemSelected(start: number): Promise<number> {
  if (screen.queryByTestId(`system-layout-panel-${start}`)) return start;
  fireEvent.click(screen.getByTestId(`system-select-left-${start}`));
  await waitFor(() => {
    expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy();
  });
  return start;
}

/** 先頭の段を選択して、そのパネルが出るまで待つ */
async function selectFirstSystem(): Promise<number> {
  return ensureSystemSelected(systemStartMeasures()[0]);
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

/** レイアウトタブを開いて「パート間隔」スライダーの現在値を読む */
function readPartSpacingSliderValue(): number {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
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

  it('選択していない段にはパート境界の帯が出ない（譜面上に常設物を残さない）', async () => {
    await renderScore('piano');
    expect(document.querySelector('.system-gap-drag-handle--part')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('単旋律譜には帯を出さない（段の中にパート境界が無い）', async () => {
    await renderScore('single');
    const start = await selectFirstSystem();
    expect(screen.queryByTestId(`part-gap-drag-${start}-0`)).toBeNull();
    // 段の上端の帯（#523）とパネルは従来どおり
    expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ピアノ譜: 右手と左手の境界を下へドラッグすると、パート間隔の数値が連動して増える（受入1）', async () => {
    await renderScore('piano');
    const start = await selectFirstSystem();
    const before = readPartSpacingSliderValue();
    // 数値を読むためにタブを押すと段の選択が解けるので、選び直してから掴む
    await selectFirstSystem();
    const scale = readRenderScale('piano', before);
    expect(scale).toBeGreaterThan(0);
    // 掴む前に、帯が「実際に描かれた左手の五線の上端」に重なっていることを確かめる
    expectBandOnStaveTop(start, 0, scale);

    const band = partBand(start, 0);
    grab(band, 200);
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
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('段の間隔の帯とは取り違えない（パート帯は段の marginTop を動かさない・その逆も）', async () => {
    await renderScore('piano');
    const start = await selectFirstSystem();
    const frame = screen.getByTestId(`system-frame-${start}`) as HTMLElement;
    const partSpacingBefore = readPartSpacingSliderValue();
    await selectFirstSystem();

    // パート境界を掴んでも、段の間隔（ラッパーの marginTop）は1pxも動かない
    grab(partBand(start, 0), 200);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 240 });
    await waitFor(() => {
      expect(bandTopPx(start, 0)).toBeGreaterThan(0);
    });
    expect(frame.style.marginTop).toBe('');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 240 });

    // 逆に、段の上端の帯（#523）を掴んでもパート間隔は変わらない。
    // 段の上端の帯は「上に段がある段」にしか出ないので、2段目を選び直して確かめる
    const starts = systemStartMeasures();
    const partSpacingAfterPartDrag = readPartSpacingSliderValue();
    fireEvent.click(screen.getByTestId(`system-select-left-${starts[1]}`));
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-drag-${starts[1]}`)).toBeTruthy();
    });
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
    const start = await selectFirstSystem();
    const before = readPartSpacingSliderValue();
    await selectFirstSystem();
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

  it('画面の拡大率（ズーム）ぶんを割り戻して、指と境界が1:1で動く', async () => {
    await renderScore('piano');
    const start = await selectFirstSystem();
    const before = readPartSpacingSliderValue();
    await selectFirstSystem();
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
    const start = await selectFirstSystem();
    const before = readPartSpacingSliderValue();
    await selectFirstSystem();
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
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パート間隔のドラッグは Undo 履歴を1件も使わない（譜面データの履歴と混ぜない）', async () => {
    await renderScore('piano');
    const starts = systemStartMeasures();
    // 履歴に残る操作を1つだけ作る（段の間隔の ＋ は systemRowGapOverrides＝譜面データ側）
    fireEvent.click(screen.getByTestId(`system-select-left-${starts[1]}`));
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-increase-${starts[1]}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`system-gap-increase-${starts[1]}`));
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('4px');
    });

    // そのあとパート境界をドラッグする
    grab(partBand(starts[1], 0), 200, 3);
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 300, clientY: 230 });
    await waitFor(() => {
      expect(bandTopPx(starts[1], 0)).toBeGreaterThan(0);
    });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 300, clientY: 230 });

    // 「元に戻す」1回で段の間隔の ＋ まで戻る。ドラッグが履歴を1件積んでいたら
    // ここは '4px' のままになる
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect((screen.getByTestId(`system-frame-${starts[1]}`) as HTMLElement).style.marginTop).toBe('');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('帯を mousedown（pointer の互換イベント）で押しても段の選択が解けない', async () => {
    await renderScore('piano');
    const start = await selectFirstSystem();
    fireEvent.mouseDown(partBand(start, 0), { button: 0 });
    expect(screen.getByTestId(`system-layout-panel-${start}`)).toBeTruthy();
    expect(screen.getByTestId(`part-gap-drag-${start}-0`)).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
