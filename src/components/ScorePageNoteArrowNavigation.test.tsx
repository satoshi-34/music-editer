// src/components/ScorePageNoteArrowNavigation.test.tsx
// Issue #442: 音符を選択している状態の ←/→ で、選択が隣のイベントへ移る。
//
// 画面まで通して固定するのは4点:
//   1. 同じ小節の中で隣の音符へ移る
//   2. 小節の境界を越えて移る（空の小節は飛ばす）
//   3. 段（システム）をまたいでも移る（選択状態は段ごとに別インスタンスが持っている）
//   4. 曲頭・最後のイベントで押しても動かず、理由が通知に出る（#318「行き止まりは喋る」）
//
// レンダー手法（autosave シード + ScorePage 直接マウント）は ScorePagePartLayout.test.tsx と同じ。
// 「隣の探し方」そのものは utils/noteNavigationUtils.test.ts で固定している。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId, loadWorkAutosaveData } from '../utils/storage';
import type { MeasureData, PartData } from '../types/storage';

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
const TEST_CONTAINER_WIDTH = 700;

/**
 * 譜面を仕込む。
 * - 小節1: 4分音符4つ（同じ小節内の移動を見る）
 * - 小節2: 全音符1つ（小節をまたぐ移動を見る）
 * - 小節3: 空（飛ばされることを見る）
 * - 小節4: 4分音符1つ（曲の最後のイベント）
 *
 * 「1段目は2小節」の上書きを付けて、小節2 → 小節4 の移動が必ず段をまたぐようにする。
 */
function seedWork() {
  const measures: MeasureData[] = [
    { events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['c/5'] },
    ] },
    { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] },
    { events: [] },
    { events: [{ dur: '4', isRest: false, keys: ['c/5'] }] },
  ];
  const parts: PartData[] = [{ partId: 'melody', clef: 'treble', measures }];
  const data = createSavedScoreData(
    { title: '矢印キー移動テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    2,
    4,
    'single'
  );
  data.systemMeasureOverrides = [{ startMeasure: 0, count: 2 }];
  const created = createWork('矢印キー移動テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

// jsdom はレイアウトを持たないので、SVG の見た目サイズを width/height 属性どおりに見せる。
// 譜面SVGは viewBox（内部座標）と width/height（見た目）が別倍率なので、クリック座標は
// 「見た目px = 内部座標 × width属性 ÷ viewBox幅」で換算する必要がある。
function mockSvgLayout(svg: SVGSVGElement): { toClientX: (x: number) => number; toClientY: (y: number) => number } {
  const width = parseFloat(svg.getAttribute('width') ?? '0') || TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const vbW = viewBox[2] || width;
  const vbH = viewBox[3] || height;
  return { toClientX: (x) => x * (width / vbW), toClientY: (y) => y * (height / vbH) };
}

/** 音符の符頭をクリックして選択する（c/5 はト音記号の第3線と第2線の間 = line 1.5） */
async function selectNote(measure: number, note: number) {
  // 直前の操作（段またぎの移動など）による再描画が CI の遅いランナーでは
  // まだ終わっていないことがあるため、当たり判定が生えるまで待ってから選択する
  //（#568 の CI で「小節1のイベント0の当たり判定: null」が2回連続で再現）
  await waitFor(() => {
    expect(
      document.querySelector(`rect.vf-note-hit[data-measure="${measure}"][data-note="${note}"]`),
      `小節${measure + 1}のイベント${note}の当たり判定`
    ).toBeTruthy();
  }, { timeout: 15000 });
  const hit = document.querySelector(
    `rect.vf-note-hit[data-measure="${measure}"][data-note="${note}"]`
  ) as SVGRectElement | null;
  const svg = hit!.closest('svg') as SVGSVGElement;
  const { toClientX, toClientY } = mockSvgLayout(svg);
  // jsdom には getBBox が無く符頭の幅が 0 になるため、left と right は同じ値になる
  const left = parseFloat(hit!.getAttribute('data-note-left')!);
  const right = parseFloat(hit!.getAttribute('data-note-right')!);
  const line0Y = parseFloat(hit!.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit!.getAttribute('data-line-spacing')!);
  fireEvent.click(hit!, {
    clientX: toClientX((left + right) / 2),
    clientY: toClientY(line0Y + 1.5 * spacing),
  });
  await waitFor(() => {
    expect(selectedPosition()).toEqual({ measure, note });
  }, { timeout: 15000 });
}

/** いま青枠が出ているイベントの位置（出ていなければ null） */
function selectedPosition(): { measure: number; note: number } | null {
  const marker = document.querySelector('rect.vf-note-selected');
  if (!marker) return null;
  return {
    measure: Number(marker.getAttribute('data-measure')),
    note: Number(marker.getAttribute('data-note')),
  };
}

async function pressArrow(key: 'ArrowLeft' | 'ArrowRight', expected: { measure: number; note: number }) {
  fireEvent.keyDown(window, { key });
  await waitFor(() => {
    expect(selectedPosition()).toEqual(expected);
  }, { timeout: 15000 });
}

describe('音符選択中の ←/→ で選択を隣のイベントへ移す（Issue #442）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // clear で setupTests の既読既定も消えるため、初回選択ヒント（#524）を既読へ戻す。
    // このテストは選択操作を多用するので、ヒント通知が混ざると件数検証が揺れる
    localStorageMock.setItem('music-score-app-arrow-key-hint-notice-seen', '1');
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('→ で小節内・小節またぎ・段またぎを進み、← で戻れる', async () => {
    seedWork();
    render(<ScorePage />);
    // 復元を待つ（音符が描かれてから操作する）
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="3"]')).toBeTruthy();
    }, { timeout: 15000 });

    await selectNote(0, 0);

    // 1. 同じ小節の中を進む
    await pressArrow('ArrowRight', { measure: 0, note: 1 });
    await pressArrow('ArrowRight', { measure: 0, note: 2 });
    await pressArrow('ArrowRight', { measure: 0, note: 3 });

    // 2. 小節の境界を越えて次の小節の先頭へ
    await pressArrow('ArrowRight', { measure: 1, note: 0 });

    // 3. 空の小節（小節3）を飛ばし、段をまたいで小節4の音符へ
    await pressArrow('ArrowRight', { measure: 3, note: 0 });

    // 4. ← で同じ道を戻れる（段またぎ・小節またぎとも）
    await pressArrow('ArrowLeft', { measure: 1, note: 0 });
    await pressArrow('ArrowLeft', { measure: 0, note: 3 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('最後のイベントでさらに → を押すと、動かずに理由を通知する', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="3"]')).toBeTruthy();
    }, { timeout: 15000 });

    await selectNote(3, 0);
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    const notice = await screen.findByTestId('edit-notice', undefined, { timeout: 15000 });
    expect(notice).toHaveTextContent('最後の音符です');
    // 選択は動かない（青枠は最後の音符に残る）
    expect(selectedPosition()).toEqual({ measure: 3, note: 0 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('曲頭のイベントでさらに ← を押すと、動かずに理由を通知する', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="0"]')).toBeTruthy();
    }, { timeout: 15000 });

    await selectNote(0, 0);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    const notice = await screen.findByTestId('edit-notice', undefined, { timeout: 15000 });
    expect(notice).toHaveTextContent('最初の音符です');
    expect(selectedPosition()).toEqual({ measure: 0, note: 0 });
  }, MOUNT_HEAVY_TIMEOUT_MS);


  // Codex round1 P2-1: 小節選択が残ったまま音符選択で ←/→ を押したとき、
  // 音符だけが移り、小節ハイライトは動かない（preventDefault が ScorePage 側の
  // 小節移動を確実に止めていることの負のテスト。外すとこのテストは失敗する）
  it('小節選択を残したまま → を押しても、小節ハイライトは動かず音符だけ移る', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="1"]')).toBeTruthy();
    }, { timeout: 15000 });

    // Shift+クリックで小節2（vf-hit の2つ目）を選択（他ツール中でも小節選択できる経路）
    const measureHit = document.querySelectorAll('rect.vf-hit')[1] as SVGRectElement;
    expect(measureHit).toBeTruthy();
    fireEvent.click(measureHit, { shiftKey: true, clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(document.querySelectorAll('rect.vf-measure-selected').length).toBe(1);
    }, { timeout: 15000 });
    const highlightedX = () =>
      (document.querySelector('rect.vf-measure-selected') as SVGRectElement).getAttribute('x');
    const xBefore = highlightedX();

    // 音符を選択してから →
    await selectNote(0, 0);
    await pressArrow('ArrowRight', { measure: 0, note: 1 });

    // 小節ハイライトは同じ小節のまま（←/→ が小節選択の移動に化けていない）
    expect(document.querySelectorAll('rect.vf-measure-selected').length).toBe(1);
    expect(highlightedX()).toBe(xBefore);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round1 P2-2: 声部2でも実配線で動くこと（小節を越えても声部2に留まり、
  // 移動先へ ↑ が声部2のデータとして効く）
  it('ピアノ譜の声部2でも → が小節を越えて働き、移動先の ↑ が声部2に効く', async () => {
    // 右手2小節。声部1は全音符、声部2は 4分×4（小節1）+ 4分1つ（小節2）
    const v1m0 = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
    const v1m1 = [{ dur: '1' as const, isRest: false, keys: ['c/5'] }];
    const v2m0 = [
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
      { dur: '4' as const, isRest: false, keys: ['e/4'] },
    ];
    const v2m1 = [{ dur: '4' as const, isRest: false, keys: ['g/4'] }];
    const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
    const rhMeasure = (v1: typeof v1m0, v2: typeof v2m0 | typeof v2m1): MeasureData => ({
      events: v1,
      voices: [
        { id: 'voice-1', events: v1 },
        { id: 'voice-2', events: v2 },
      ],
    });
    const lhMeasure = (): MeasureData => ({ events: lh, voices: [{ id: 'voice-1', events: lh }] });
    const data = createSavedScoreData(
      { title: '声部2の矢印移動', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'right-hand', clef: 'treble', measures: [rhMeasure(v1m0, v2m0), rhMeasure(v1m1, v2m1)] },
        { partId: 'left-hand', clef: 'bass', measures: [lhMeasure(), lhMeasure()] },
      ],
      1, 2, 'piano'
    );
    const created = createWork('声部2の矢印移動');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);
    const voiceWorkId = created.data.id;

    render(<ScorePage />);
    // 当たり判定はアクティブレイヤー（初期=右手・声部1）の音符ぶんだけ生成される
    await waitFor(() => {
      expect(document.querySelectorAll('rect.vf-note-hit').length).toBeGreaterThanOrEqual(2);
    }, { timeout: 15000 });

    // 右手・声部2 レイヤーへ切り替え → 声部2の当たり判定（4分×4）が生えるのを待って選択
    fireEvent.click(screen.getByRole('button', { name: '右手・声部2' }));
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="0"][data-note="3"]')).toBeTruthy();
    }, { timeout: 15000 });
    await selectNote(0, 3);

    // → で小節を越えて声部2の小節2先頭へ
    await pressArrow('ArrowRight', { measure: 1, note: 0 });

    // 移動先で ↑ を押すと、**声部2**（voices[1]）の音高が変わる（g/4 → a/4 相当）
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => {
      const saved = loadWorkAutosaveData(voiceWorkId).data;
      const v2 = saved?.parts?.[0]?.measures?.[1]?.voices?.[1]?.events?.[0];
      expect(v2?.keys?.[0]).not.toBe('g/4');
      // 声部1（全音符）は巻き添えにならない
      const v1 = saved?.parts?.[0]?.measures?.[1]?.voices?.[0]?.events?.[0];
      expect(v1?.keys?.[0]).toBe('c/5');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 入力欄フォーカス中は ←/→ が選択移動に化けない（テキスト編集を壊さない）
  it('入力欄にフォーカスがある間は ←/→ で選択が動かない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit[data-measure="0"]')).toBeTruthy();
    }, { timeout: 15000 });
    await selectNote(0, 0);

    // ズームのスライダー（常設の入力欄）へフォーカスして →
    const input = document.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    // 少し待っても選択は動かない
    await new Promise((r) => setTimeout(r, 300));
    expect(selectedPosition()).toEqual({ measure: 0, note: 0 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
