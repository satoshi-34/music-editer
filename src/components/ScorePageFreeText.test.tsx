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
import { SCORE_TEXT_FONT_FAMILY } from '../utils/engravingDefaults';
import { resolveTitleFontOption } from '../utils/titleFontOptions';

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

  // 実機所感 2026-08-27: 矢印キーで場所を変えたい（⤢/✥ の記号調整と同じ手触り）。
  // どの入力欄にフォーカスがあっても矢印キーで動き、譜面のテキストがライブ追従し、
  // Enter の1回で保存されることを固定する
  it('矢印キーで注釈が動き（ライブ追従）、Enter で保存される', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    await typeAnnotation('nudge target');
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText?.text).toBe('nudge target');
    }, { timeout: 15000 });

    // 開き直して、本文入力欄にフォーカスがあるまま矢印キー（→→・Shift+↓）
    clickMeasureOfPart(0);
    const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    const svgText = () => document.querySelector('text[data-free-text]') as SVGTextElement;
    const baseX = parseFloat(svgText().getAttribute('data-base-x')!);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });

    // 入力欄と譜面の両方がライブ更新される（まだ保存はされない）
    expect((screen.getByLabelText('自由注釈の横位置（px）') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('自由注釈の縦位置（px）') as HTMLInputElement).value).toBe('10');
    expect(parseFloat(svgText().getAttribute('x')!)).toBeCloseTo(baseX + 2, 5);

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      const ft = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText;
      expect(ft?.offsetX).toBe(2);
      expect(ft?.offsetY).toBe(10);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 実機所感 2026-08-27: 置いた注釈テキストを**直接クリック**して編集を開きたい
  // （他の記号は演奏記号タブでクリック選択できるのに、注釈だけTツール経由だった非一貫の解消）
  it('演奏記号タブでは、注釈テキストのクリックで編集オーバーレイが開く', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    await typeAnnotation('click me');
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText?.text).toBe('click me');
    }, { timeout: 15000 });

    // 別のツールに切り替えても、演奏記号タブ内ならテキストを直接押せる
    // （強弱グループの先頭ボタンを押す。名前はグリフ描画で拾えないため role 一覧から選ぶ）
    const symbolButtons = screen.getAllByRole('button').filter((b) => b.getAttribute('title')?.includes('強弱'));
    if (symbolButtons[0]) fireEvent.click(symbolButtons[0]);
    await waitFor(() => {
      // テキストの上に判定 rect（symbol-hit-region）が重なっている
      const svgText = document.querySelector('text[data-free-text]');
      expect(svgText).toBeTruthy();
    }, { timeout: 15000 });
    const hit = Array.from(document.querySelectorAll('rect.symbol-hit-region'))
      .find((r) => r.classList.contains('vf-screen-only')) as SVGRectElement;
    expect(hit).toBeTruthy();
    fireEvent.click(hit, { clientX: 100, clientY: 40 });

    // 現在値入りで編集オーバーレイが開く
    const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    expect(input.value).toBe('click me');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // #429 round1 P1/P2 のリグレッション:
  // - 矢印キーが window 側へ伝播しない（残留した音符選択が動かない）
  // - Escape で閉じるとライブ移動のプレビューが保存値へ戻る
  it('矢印キーは伝播せず、Escape でプレビューが元の位置へ戻る', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    await typeAnnotation('escape check');
    await waitFor(() => {
      expect(loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText?.text).toBe('escape check');
    }, { timeout: 15000 });

    clickMeasureOfPart(0);
    const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    const svgText = () => document.querySelector('text[data-free-text]') as SVGTextElement;
    const baseX = parseFloat(svgText().getAttribute('data-base-x')!);

    // window へ矢印キーが漏れないこと（漏れると残留音符選択の音高移動が走る・P1）
    let leaked = 0;
    const listener = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') leaked += 1; };
    window.addEventListener('keydown', listener);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    window.removeEventListener('keydown', listener);
    expect(leaked).toBe(0);
    expect(parseFloat(svgText().getAttribute('x')!)).toBeCloseTo(baseX + 2, 5);

    // Escape → 保存せず閉じ、プレビューが保存値（オフセット0）へ戻る（P2）
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(parseFloat(svgText().getAttribute('x')!)).toBeCloseTo(baseX, 5);
    }, { timeout: 15000 });
    const ft = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText;
    expect(ft?.offsetX ?? 0).toBe(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // #429 round1 P2: クランプは注釈仕様の ±200。記号用の ±100 だと 150 から → で 101 へ飛ぶ
  it('横位置150からの矢印は151になる（±200のクランプ）', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'clamp' } });
    const xInput = screen.getByLabelText('自由注釈の横位置（px）') as HTMLInputElement;
    fireEvent.change(xInput, { target: { value: '150' } });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(xInput.value).toBe('151');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // ── 書体選択（Issue #432） ────────────────────────────────────────────
  it('書体を選んで確定すると保存され、SVG の font-family が変わる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    const input = await screen.findByLabelText('自由注釈テキスト', {}, { timeout: 15000 }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'con pedale' } });
    const fontSelect = screen.getByLabelText('自由注釈の書体') as HTMLSelectElement;
    // 開いた時点では「既定」が選ばれている
    expect(fontSelect.value).toBe('default');
    fireEvent.change(fontSelect, { target: { value: 'mincho' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const ft = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText;
      expect(ft?.text).toBe('con pedale');
      expect(ft?.fontId).toBe('mincho');
    }, { timeout: 15000 });

    // 譜面の描画も選んだ書体になり、イタリックが外れている
    await waitFor(() => {
      const svgText = document.querySelector('text[data-free-text]') as SVGTextElement;
      expect(svgText.getAttribute('font-family')).toBe(resolveTitleFontOption('mincho').stack);
      expect(svgText.getAttribute('font-style')).toBe('normal');
    }, { timeout: 15000 });

    // 開き直すと現在の書体が選ばれた状態で出る
    clickMeasureOfPart(0);
    await waitFor(() => {
      expect((screen.getByLabelText('自由注釈の書体') as HTMLSelectElement).value).toBe('mincho');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 既定のまま置いた注釈は、書体セレクトが増えても見た目が 1px も変わらないこと（回帰防止）
  it('書体を選ばずに置いた注釈は従来どおりイタリックのセリフ体で、fontId を保存しない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await selectFreeTextTool();
    clickMeasureOfPart(0);
    await typeAnnotation('senza sordini');

    await waitFor(() => {
      const ft = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.freeText;
      expect(ft?.text).toBe('senza sordini');
      expect(ft?.fontId).toBeUndefined();
    }, { timeout: 15000 });
    const svgText = document.querySelector('text[data-free-text]') as SVGTextElement;
    expect(svgText.getAttribute('font-family')).toBe(SCORE_TEXT_FONT_FAMILY);
    expect(svgText.getAttribute('font-style')).toBe('italic');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // #432 Codex round1 P2: PDF書き出し前の「注釈のWebフォント読み込み待ち」の配線。
  // この集約処理（handleExportPdf 内）を消しても他のテストは通ってしまうため、
  // 実マウントで「fonts.load に注釈本文が渡る」「読み込み完了までは print しない」
  // 「完了後に print する」を固定する
  it('PDF書き出しは、注釈のWebフォント読み込み完了を待ってから print する', async () => {
    // fonts.load を「手動で解決できる」モックにする
    let resolveLoads: (() => void) | null = null;
    const gate = new Promise<void>((r) => { resolveLoads = r; });
    const loadMock = vi.fn(() => gate.then(() => []));
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: loadMock, ready: Promise.resolve() },
    });
    // Webフォント付きの注釈を仕込む
    const seeded = loadWorkAutosaveData; // 参照維持（lint対策なし・下で使用）
    void seeded;
    seedWork();
    {
      const data = loadWorkAutosaveData(workId).data!;
      data.parts[0].measures[0].freeText = { text: 'espressivo', fontId: 'noto-serif-jp' };
      saveWorkAutosaveData(workId, data);
    }
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('text[data-free-text]')).toBeTruthy();
    }, { timeout: 15000 });

    const printMock = window.print as ReturnType<typeof vi.fn>;
    printMock.mockClear();
    loadMock.mockClear();

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'pdf' } });

    // <link> は jsdom では onload が発火しないため手で起こす（読み込み完了の再現）
    await waitFor(() => {
      expect(document.querySelector('link#title-font-noto-serif-jp')).toBeTruthy();
    }, { timeout: 15000 });
    document.querySelector('link#title-font-noto-serif-jp')!.dispatchEvent(new Event('load'));

    // fonts.load へ注釈本文が渡る（unicode-range 分割配信対応の要）
    await waitFor(() => {
      expect(loadMock.mock.calls.some((c) => String(c[1] ?? '').includes('espressivo'))).toBe(true);
    }, { timeout: 15000 });
    // 読み込みが終わるまでは print されない
    expect(printMock).not.toHaveBeenCalled();

    // 読み込み完了 → print される
    resolveLoads!();
    await waitFor(() => {
      expect(printMock).toHaveBeenCalled();
    }, { timeout: 15000 });
    Reflect.deleteProperty(document, 'fonts');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
