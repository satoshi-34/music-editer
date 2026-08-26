// src/components/PianoSystemCanvasSymbolToolNotice.test.tsx
// Issue #330（#318 棚卸しC群）: 記号系ツールを対象外の音符・休符へ使ったときに理由を伝える。
//
// ここで固定するのは「無言だった行き止まりが喋るようになったこと」だけで、
// 効かないこと自体（＝記号は音符に付くもの・調整は付いている記号にだけ効く）は変えていない。
//   C-1. 休符に強弱・カスタム記号・サイズ/位置調整ツールを使ったとき
//   C-2. その記号が付いていない音符でカスタム記号のサイズ・位置調整を押したとき
//   C-3. 調整できる記号が1つも無い音符で ⤢ / ✥ を押したとき
//
// レンダー手法・座標のモックは PianoSystemCanvasDeadEndNotice.test.tsx と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { CustomSymbolDef, MeasureData } from '../types/storage';
import {
  SCORE_EDIT_NOTICE_EVENT,
  type ScoreEditNoticeDetail,
} from '../utils/scoreEditorNotices';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function () {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function () {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

const TEST_CONTAINER_WIDTH = 700;

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （クリック座標 = SVG 内部座標にそろえるため）。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

function yForLine(hit: SVGRectElement, line: number): number {
  const line0Y = parseFloat(hit.getAttribute('data-line0-y')!);
  const spacing = parseFloat(hit.getAttribute('data-line-spacing')!);
  return line0Y + line * spacing;
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

/** 音符（index 0）と休符（index 1）が並ぶ小節 */
const NOTE_AND_REST: MeasureData[] = [{
  events: [
    { dur: '4', isRest: false, keys: ['c/5'] },
    { dur: '4', isRest: true, keys: ['b/4'] },
    { dur: '2', isRest: true, keys: ['b/4'] },
  ],
}];

const SYMBOL_DEFS: CustomSymbolDef[] = [{ id: 'sym-1', name: 'かたつむり', shapes: [] }];

describe('記号系ツールを対象外へ使ったときの通知（Issue #330）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  let notices: string[];
  let noticeListener: (e: Event) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
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
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(data: MeasureData[], tool: unknown) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        customSymbolDefs={SYMBOL_DEFS}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChange };
  }

  /** 対象の当たり判定の中心を押す（休符・音符とも同じ入口を通る） */
  function clickEvent(svg: SVGSVGElement, noteIndex: number) {
    const hit = noteHit(svg, noteIndex);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });
  }

  describe('C-1: 休符に記号系ツールを使ったとき', () => {
    it('強弱ツールでは「休符には付けられない」と代替手順が出る', async () => {
      const { svg, onChange } = renderScore(NOTE_AND_REST, { mode: 'dynamic', dynamic: 'f' });
      clickEvent(svg, 1);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('休符には強弱記号を付けられません');
      // 次の一手（代替手順）まで言う。理由だけでは行き止まりのまま
      expect(notices[0]).toContain('音符をクリックしてください');
      // 拒否そのものは従来どおり＝譜面は変わらない
      expect(onChange).not.toHaveBeenCalled();
    });

    // 運指は休符には描画されない（符頭の上に出す記号のため）が、保存自体はできてしまう。
    // 入力欄を開くと「入力したのに何も出ない」無言の行き止まりになるので、開く前に断る
    // （#398 round7 P2）。他のテキスト系は休符でも描画されるので従来どおり受け付ける。
    it('運指ツールでは休符に入力欄を開かず「付けられません」と出る', async () => {
      const { svg, onChange } = renderScore(NOTE_AND_REST, { mode: 'textElement', textKind: 'fingering' });
      clickEvent(svg, 1);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('休符には運指（指番号）を付けられません');
      expect(notices[0]).toContain('音符をクリックしてください');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('歌詞ツールは休符でも入力欄が開く（休符にも描画されるため）', async () => {
      const { svg } = renderScore(NOTE_AND_REST, { mode: 'textElement', textKind: 'lyrics' });
      clickEvent(svg, 1);

      await waitFor(() => {
        expect(document.querySelector('input')).toBeTruthy();
      });
      expect(notices).toHaveLength(0);
    });

    it('カスタム記号ツールでは記号の名前を差し込んで伝える', async () => {
      const { svg, onChange } = renderScore(NOTE_AND_REST, { mode: 'customSymbol', symbolId: 'sym-1' });
      clickEvent(svg, 1);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('かたつむり');
      expect(notices[0]).toContain('付けられません');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('カスタム記号のサイズ調整ツールでも休符では使えないと出る', async () => {
      const { svg } = renderScore(NOTE_AND_REST, { mode: 'customSymbolResize', symbolId: 'sym-1' });
      clickEvent(svg, 1);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('「かたつむり」のサイズ調整');
      expect(notices[0]).toContain('休符には');
    });

    // 何も付いていない休符で✥を押したとき。「休符だから使えない」ではなく
    // 「まだ何も付いていない」と言う。休符にもテキスト系は付けられるので、
    // 前者は事実に反する（#398 round6 P2）。
    it('何も付いていない休符で✥を押すと、休符に付けられる記号を案内する', async () => {
      const { svg } = renderScore(NOTE_AND_REST, { mode: 'symbolAdjustOffset' });
      clickEvent(svg, 1);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('この休符には調整できる記号がありません');
      expect(notices[0]).toContain('コード記号');
      // 「休符には使えません」という旧文言に戻っていないこと
      expect(notices[0]).not.toContain('休符には記号の');
    });

    // ただし「休符だから一律に拒否」ではない。テキスト系（歌詞・コード記号・テンポ表記・
    // 発想標語）とオッターバは休符にも付けられるので、付いているなら調整できる。
    // 以前は列挙前に休符を弾いていたため、付いているのに触れない行き止まりだった
    // （#398 Codex round5 P2）。
    it('休符でもコード記号が付いていれば✥で調整の小窓が開く', async () => {
      const restWithChord: MeasureData[] = [{
        events: [
          { dur: '4', isRest: false, keys: ['c/5'] },
          { dur: '4', isRest: true, keys: ['b/4'], chordSymbol: 'C' },
          { dur: '2', isRest: true, keys: ['b/4'] },
        ],
      }];
      const { svg } = renderScore(restWithChord, { mode: 'symbolAdjustOffset' });
      clickEvent(svg, 1);

      await waitFor(() => {
        expect(document.body.textContent).toContain('横');
      });
      // 拒否通知は出ない
      expect(notices).toHaveLength(0);
    });
  });

  describe('オッターバの付け外し通知（#318・実機で「置けない」と誤認 2026-08-26）', () => {
    // 括弧は開始+終了のペアで初めて描かれる。開始だけの状態が無言だと
    // 「クリックが効いていない」ように見える
    it('8va開始を置くと、終了の置き方まで案内される', async () => {
      const { svg, onChange } = renderScore(NOTE_AND_REST, { mode: 'ottava', ottavaType: '8va' });
      clickEvent(svg, 0);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('8vaの開始を付けました');
      expect(notices[0]).toContain('8va終了');
      expect(onChange).toHaveBeenCalled();
    });

    it('同じ音符をもう一度クリックすると外れたことが通知される', async () => {
      const withOttava: MeasureData[] = [{
        events: [
          { dur: '4', isRest: false, keys: ['c/5'], ottava: '8va' },
          { dur: '4', isRest: true, keys: ['b/4'] },
          { dur: '2', isRest: true, keys: ['b/4'] },
        ],
      }];
      const { svg } = renderScore(withOttava, { mode: 'ottava', ottavaType: '8va' });
      clickEvent(svg, 0);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('8vaを外しました');
    });
  });

  describe('C-2: その記号が付いていない音符で調整ツールを押したとき', () => {
    it('サイズ調整では「まだ付いていない」ことと先に付ける手順が出る', async () => {
      const { svg } = renderScore(NOTE_AND_REST, { mode: 'customSymbolResize', symbolId: 'sym-1' });
      clickEvent(svg, 0);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('「かたつむり」が付いていません');
      expect(notices[0]).toContain('先に記号を付けてから');
    });

    it('記号が付いている音符では通知を出さずに調整を開く（従来どおり）', async () => {
      const data: MeasureData[] = [{
        events: [
          { dur: '4', isRest: false, keys: ['c/5'], customSymbols: [{ symbolId: 'sym-1' }] },
          { dur: '2', isRest: true, keys: ['b/4'] },
          { dur: '4', isRest: true, keys: ['b/4'] },
        ],
      }];
      const { svg } = renderScore(data, { mode: 'customSymbolResize', symbolId: 'sym-1' });
      clickEvent(svg, 0);

      // 調整オーバーレイ（％入力）が開き、行き止まりの通知は出ない
      await waitFor(() => {
        expect(document.querySelector('input')).toBeTruthy();
      });
      expect(notices).toHaveLength(0);
    });
  });

  describe('C-3: 調整できる記号が1つも無い音符で ⤢ / ✥ を押したとき', () => {
    it('調整できる記号が無いことと、先に記号を付ける手順が出る', async () => {
      const { svg } = renderScore(NOTE_AND_REST, { mode: 'symbolAdjustResize' });
      clickEvent(svg, 0);

      await waitFor(() => expect(notices).toHaveLength(1));
      expect(notices[0]).toContain('調整できる記号がありません');
      expect(notices[0]).toContain('⤢');
    });
  });
});
