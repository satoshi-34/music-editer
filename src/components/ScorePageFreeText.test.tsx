// 自由注釈テキスト（#421）の ScorePage 配線テスト（Codex round1 P1）。
//
// PianoSystemCanvasFreeText.test.tsx は props 直注入のキャンバス単体なので、
// パレットの「自由注釈テキスト」→小節クリック→入力→親 state→自動保存という
// 実配線と、受入条件（月光冒頭の指示文2つ＝右手上・左手上、段組変更への追従、
// 空欄確定での削除）を固定できない。ここで実経路をまとめて固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
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

let workId = '';

/** 月光型の2小節ピアノ譜（右手・左手とも音符あり） */
function seedWork() {
  const rh = [
    { dur: '2' as const, isRest: false, keys: ['c/5'] },
    { dur: '2' as const, isRest: false, keys: ['d/5'] },
  ];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
  const mk = (e: typeof rh | typeof lh) => ({ events: e, voices: [{ id: 'voice-1', events: e }] });
  const data = createSavedScoreData(
    { title: '自由注釈', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [mk(rh), mk(rh)] },
      { partId: 'left-hand', clef: 'bass', measures: [mk(lh), mk(lh)] },
    ],
    1, 2, 'piano'
  );
  const created = createWork('自由注釈');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** jsdom はレイアウトを持たないため、SVG の画面座標=論理座標になるようモックする */
function mockSvgLayout(): SVGSVGElement {
  const svg = Array.from(document.querySelectorAll('svg'))
    .find((c) => c.querySelector('rect.vf-hit')) as SVGSVGElement;
  const width = parseFloat(svg.getAttribute('width') ?? '0') || 900;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  return svg;
}

/** 指定パートの小節ヒットを、その rect 自身の座標でクリックする */
function clickMeasureOfPart(partIndex: number) {
  const svg = mockSvgLayout();
  // vf-hit は「パート×小節」ぶんある（2小節×2段=4枚）。y でグループ化して段を選び、
  // その段の中で x が最小の rect（=1小節目）をクリックする
  const hits = (Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[])
    .map((h) => ({ h, x: parseFloat(h.getAttribute('x') ?? '0'), y: parseFloat(h.getAttribute('y') ?? '0') }));
  const ys = Array.from(new Set(hits.map((r) => r.y))).sort((a, b) => a - b);
  const rowY = ys[partIndex] ?? ys[0];
  const row = hits.filter((r) => r.y === rowY).sort((a, b) => a.x - b.x);
  const target = row[0];
  fireEvent.click(target.h, { clientX: target.x + 20, clientY: target.y + 10 });
}

async function selectFreeTextTool() {
  fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
  fireEvent.click(await screen.findByRole('button', { name: /自由注釈テキスト/ }, { timeout: 15000 }));
}

async function typeAnnotation(text: string) {
  const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ScorePage: 自由注釈テキストの配線（#421）', () => {
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

  it('月光冒頭の指示文2つ（右手上・左手上）を置けて保存され、SVG に描かれる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    await typeAnnotation('Si deve suonare delicatissimamente');

    clickMeasureOfPart(1);
    await typeAnnotation('sempre pianissimo e senza sordini');

    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      expect(parts?.[0]?.measures?.[0]?.freeText?.text).toBe('Si deve suonare delicatissimamente');
      expect(parts?.[1]?.measures?.[0]?.freeText?.text).toBe('sempre pianissimo e senza sordini');
    }, { timeout: 15000 });
    // SVG にも両方描かれている
    expect(document.body.textContent).toContain('Si deve suonare delicatissimamente');
    expect(document.body.textContent).toContain('sempre pianissimo e senza sordini');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex round1 P1: 入力欄を開いたまま別の小節をクリックすると、key が無い実装では
  // 前の小節の入力値が残り、別の対象へ上書き保存される
  it('入力欄を開いたまま別の小節をクリックしても、前の入力値が持ち越されない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    // 右手1小節目を開いて途中まで打つ（確定しない）
    clickMeasureOfPart(0);
    const input1 = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    fireEvent.change(input1, { target: { value: '途中の下書き' } });

    // 開いたまま左手の小節をクリック → 入力欄は新しい対象として空で開き直す
    clickMeasureOfPart(1);
    await waitFor(() => {
      const input2 = screen.getByLabelText('自由注釈テキスト') as HTMLInputElement;
      expect(input2.value).toBe('');
    }, { timeout: 15000 });

    // ここで確定しても、左手には「途中の下書き」が保存されない
    await typeAnnotation('sordini');
    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      expect(parts?.[1]?.measures?.[0]?.freeText?.text).toBe('sordini');
      expect(parts?.[0]?.measures?.[0]?.freeText).toBeUndefined();
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('空欄で確定すると注釈が削除される', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    await typeAnnotation('あとで消す');
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText?.text).toBe('あとで消す');
    }, { timeout: 15000 });

    // もう一度開くと現在値が入っている → 空にして確定＝削除
    clickMeasureOfPart(0);
    const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    expect(input.value).toBe('あとで消す');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText).toBeUndefined();
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
