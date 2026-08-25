// ピアノ譜の拍スライス・レイヤー限定（裁定A・2026-08-25）の ScorePage 統合テスト。
//
// PianoSystemCanvasLayerSlice.test.tsx は境界のスナップまでしか見ない。
// ここでは作品を復元した実経路で、ドラッグ→Cmd+C→レイヤー切替→Cmd+V が
// 選択レイヤーだけに効くことと、レイヤー切替後の欠けたコピーを断ること（Codex P1）を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';
import { SCORE_EDIT_NOTICE_EVENT, type ScoreEditNoticeDetail } from '../utils/scoreEditorNotices';

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

/** 月光型: 右手=4分音符4つ・左手=全音符。2小節（2小節目は両手とも空） */
function seedWork() {
  const rh = [
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['d/5'] },
    { dur: '4' as const, isRest: false, keys: ['e/5'] },
    { dur: '4' as const, isRest: false, keys: ['f/5'] },
  ];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
  const data = createSavedScoreData(
    { title: 'レイヤースライス', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [
        { events: rh, voices: [{ id: 'voice-1', events: rh }] },
        { events: [], voices: [{ id: 'voice-1', events: [] }] },
      ] },
      { partId: 'left-hand', clef: 'bass', measures: [
        { events: lh, voices: [{ id: 'voice-1', events: lh }] },
        { events: [], voices: [{ id: 'voice-1', events: [] }] },
      ] },
    ],
    1, 2, 'piano'
  );
  const created = createWork('レイヤースライス');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

function mockSvgLayout() {
  // 音符ヒットはアクティブレイヤーに音が無いと消えるので、小節ヒットで探す
  const svg = Array.from(document.querySelectorAll('svg'))
    .find((c) => c.querySelector('rect.vf-hit')) as SVGSVGElement;
  const width = 900;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  return svg;
}

/** 右手（アクティブレイヤー）の音符X座標（昇順）。ヒットはアクティブレイヤー分しか無い */
function activeNoteXs(svg: SVGSVGElement): number[] {
  return Array.from(svg.querySelectorAll('.vf-note-hit[data-measure="0"]'))
    .map((r) => parseFloat(r.getAttribute('x') ?? '0'))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
}

describe('ScorePage: ピアノ譜のレイヤー限定スライス（裁定A）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let notices: string[];
  let noticeListener: (e: Event) => void;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
    notices = [];
    noticeListener = (e: Event) => {
      const detail = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
  });

  afterEach(() => {
    window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, noticeListener);
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  async function setupAndSlice(): Promise<SVGSVGElement> {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('button', { name: /小節選択/ }));
    // ツール切替の再レンダーで SVG が作り直されるので、モックは切替後に貼る
    const svg = mockSvgLayout();
    const xs = activeNoteXs(svg);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    const hit = svg.querySelector('rect.vf-hit') as SVGRectElement;
    // 2音目〜3音目（1〜2拍）をドラッグ
    fireEvent.mouseDown(hit, { button: 0, clientX: xs[1] + 2, clientY: 100 });
    fireEvent.mouseMove(hit, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: xs[2] + 2, clientY: 100 });
    return svg;
  }

  it('右手レイヤーでコピーして貼っても、左手は無傷のまま右手だけ変わる', async () => {
    const svg = await setupAndSlice();
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    expect(notices.some((n) => n.includes('コピー'))).toBe(true);

    // 貼り先: 1小節目を丸ごと選択（先頭へ貼る）。コピーしたのは2音目(d/5)の1拍ぶんなので、
    // 貼り付け後は右手の先頭が d/5 になる
    const m0 = svg.querySelector('rect.vf-hit') as SVGRectElement;
    const m0x = parseFloat(m0.getAttribute('x')!);
    fireEvent.mouseDown(m0, { button: 0, clientX: m0x + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: m0x + 2, clientY: 100 });
    fireEvent.click(m0, { clientX: m0x + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      const rh = parts?.[0]?.measures?.[0]?.events ?? [];
      expect(rh[0]?.keys?.[0]).toBe('d/5');
      // 左手の全音符は無傷（レイヤー限定の核心）
      const lh = parts?.[1]?.measures?.[0]?.events ?? [];
      expect(lh.length).toBe(1);
      expect(lh[0].isRest).toBe(false);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Codex P1: 範囲を選んだあとにレイヤーを切り替えると、境界が新レイヤーの切れ目に
  // 合わない。黙って欠けたコピーを作らず断る
  it('範囲選択後に左手（全音符）へ切り替えてコピーすると、断りの通知が出る', async () => {
    await setupAndSlice();
    fireEvent.click(screen.getByRole('button', { name: '左手・声部1' }));
    fireEvent.keyDown(window, { key: 'c', metaKey: true });

    expect(notices.some((n) => n.includes('切れ目に合っていません'))).toBe(true);
    expect(notices.some((n) => n.includes('コピーしました'))).toBe(false);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 片手だけの piano JSON をファイル読込→右手でコピー→左手へ貼る、の実経路カバレッジ。
  // 読込直後 leftHandData は undefined になるが、キャンバスの初期同期が最初のレンダーで
  // 空配列へ実体化するため、貼り付け時点では常に実体化済み（#412 round3 で実測）。
  // よってこのテストは ?? [] ガードの検出器ではなく、経路が通ることの固定
  it('右手でコピーし、ファイル読込で未実体化になった左手へ貼れる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 左手パーツを持たない piano JSON を読み込む → leftHandData が undefined になる
    const rh = [
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['d/5'] },
      { dur: '2' as const, isRest: false, keys: ['e/5'] },
    ];
    const imported = createSavedScoreData(
      { title: '片手読込', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'right-hand', clef: 'treble', measures: [{ events: rh, voices: [{ id: 'voice-1', events: rh }] }] }],
      1, 1, 'piano'
    );
    const file = new File([JSON.stringify(imported)], 'one-hand.score.json', { type: 'application/json' });
    // ファイル入力は「ファイル」タブの中にある
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const input = document.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(document.body.textContent).toContain('片手読込');
    }, { timeout: 15000 });

    // 右手の2音目（1〜2拍）を選んでコピー（小節選択ツールは音符・休符タブ）
    fireEvent.click(screen.getByRole('tab', { name: '音符・休符' }));
    fireEvent.click(screen.getByRole('button', { name: /小節選択/ }));
    const svg = mockSvgLayout();
    const xs = activeNoteXs(svg);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    const hit = svg.querySelector('rect.vf-hit') as SVGRectElement;
    fireEvent.mouseDown(hit, { button: 0, clientX: xs[1] + 2, clientY: 100 });
    fireEvent.mouseMove(hit, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: xs[2] + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    expect(notices.some((n) => n.includes('コピー'))).toBe(true);

    // 左手（未実体化）へ切り替えて、1小節目へ貼る
    fireEvent.click(screen.getByRole('button', { name: '左手・声部1' }));
    const svgB = mockSvgLayout();
    const m0 = svgB.querySelector('rect.vf-hit') as SVGRectElement;
    const m0x = parseFloat(m0.getAttribute('x')!);
    fireEvent.mouseDown(m0, { button: 0, clientX: m0x + 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: m0x + 2, clientY: 100 });
    fireEvent.click(m0, { clientX: m0x + 2, clientY: 100 });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    // 左手に d/5 が入ったことを自動保存データで確認する。ガードが無いと
    // 貼り付けが例外/無反応になり、ここへ到達しない
    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts ?? [];
      const bass = parts.find((p) => p.clef === 'bass');
      expect(bass).toBeTruthy();
      expect((bass!.measures?.[0]?.events ?? []).some(
        (ev) => !ev.isRest && ev.keys?.[0] === 'd/5')).toBe(true);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('スライス削除は右手（選択レイヤー）だけを休符化し、左手の全音符は残る', async () => {
    await setupAndSlice();
    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      const rh = parts?.[0]?.measures?.[0]?.events ?? [];
      // 右手: 1〜2拍が休符になっている（休符が増えた）
      expect(rh.some((ev) => ev.isRest)).toBe(true);
      // 左手: 全音符のまま
      const lh = parts?.[1]?.measures?.[0]?.events ?? [];
      expect(lh.length).toBe(1);
      expect(lh[0].isRest).toBe(false);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
