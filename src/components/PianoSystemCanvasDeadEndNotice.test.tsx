// src/components/PianoSystemCanvasDeadEndNotice.test.tsx
// Issue #318「行き止まりは喋る」: 操作が効かない場面で、理由と代替手順を必ず画面へ出す。
//
// ここで固定するのは「無言だった行き止まり」が喋るようになったことだけで、
// 効かないこと自体（＝拒否の判定）は従来どおり変えていない。
//   1. 小節の拍がいっぱいのとき、音符も連符グループも入らない理由を伝える
//   2. 段またぎ表示（⇵）の対象外（休符・単段編成）をクリックしたとき理由を伝える
//   3. 段またぎを切り替えたとき「所属は変わらない」ことまで伝える（#322 の誤解の防止）
//   4. 連符ではない音符へ連符数字トグルを試したとき理由を伝える
//
// レンダー手法・座標のモックは PianoSystemCanvasDeleteNotice.test.tsx と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';
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

/** 単一パート譜での音符の当たり判定 */
function noteHit(svg: SVGSVGElement, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

/** 多段譜での音符の当たり判定（パートは data-cycle-id の "note:p<番号>:" で見分ける） */
function noteHitOfPart(svg: SVGSVGElement, partIndex: number, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-cycle-id^="note:p${partIndex}:"][data-note="${noteIndex}"][data-hit-part="fixed"]`
  ) as SVGRectElement;
  expect(hit, `part${partIndex} の音符${noteIndex}のヒット領域`).toBeTruthy();
  return hit;
}

/** 4/4 が音符で埋まった小節（これ以上は1音も入らない） */
function fullMeasure(): MeasureData {
  return {
    events: (['c/5', 'd/5', 'e/5', 'f/5'] as const).map((key): NoteEvent => ({
      dur: '4', isRest: false, keys: [key],
    })),
  };
}

describe('PianoSystemCanvas の「行き止まりは喋る」通知（Issue #318）', () => {
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

  function renderScore(
    parts: { clef: 'treble' | 'bass'; data: MeasureData[] }[],
    tool: unknown = { duration: '4', isRest: false },
  ) {
    const onChanges = parts.map(() => vi.fn());
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={parts.map((p, i) => ({ clef: p.clef, data: p.data, onChange: onChanges[i] }))}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChanges };
  }

  it('拍がいっぱいの小節へ音符を置こうとすると、理由と代替手順が出る', async () => {
    const { svg, onChanges } = renderScore([{ clef: 'treble', data: [fullMeasure()] }]);
    // 最後の音符の右外側（＝挿入ゾーン）を押して、末尾への追加を試みる
    const hit = noteHit(svg, 3);
    const right = parseFloat(hit.getAttribute('data-note-right')!);
    fireEvent.click(hit, { clientX: right + 6, clientY: yForLine(hit, 2) });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toContain('この小節は拍がいっぱい');
    // 次の一手（代替手順）まで言う。理由だけでは行き止まりのまま
    expect(notices[0]).toContain('次の小節');
    // 拒否そのものは従来どおり＝譜面は変わらない
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('拍がいっぱいの小節へ連符グループを置こうとしたときも同じ理由が出る', async () => {
    const { svg, onChanges } = renderScore(
      [{ clef: 'treble', data: [fullMeasure()] }],
      { duration: '8', isRest: false, tuplet: { numNotes: 3, notesOccupied: 2 } },
    );
    const hit = noteHit(svg, 3);
    const right = parseFloat(hit.getAttribute('data-note-right')!);
    fireEvent.click(hit, { clientX: right + 6, clientY: yForLine(hit, 2) });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toContain('この小節は拍がいっぱい');
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('段またぎ表示（⇵）で休符を押すと、休符が対象外である理由が出る', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChanges } = renderScore(
      [{ clef: 'treble', data }, { clef: 'bass', data: [{ events: [{ dur: '1', isRest: true, keys: ['d/3'] }] }] }],
      { mode: 'crossStaffToggle' },
    );
    const hit = noteHitOfPart(svg, 0, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toContain('休符は段またぎ表示にできません');
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('段またぎ表示（⇵）を単段の譜面で使うと、2段以上必要なことが出る', async () => {
    const { svg, onChanges } = renderScore(
      [{ clef: 'treble', data: [{ events: [{ dur: '1', isRest: false, keys: ['c/5'] }] }] }],
      { mode: 'crossStaffToggle' },
    );
    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 2) });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toContain('五線が2段以上ある譜面');
    expect(onChanges[0]).not.toHaveBeenCalled();
  });

  it('段またぎ表示を切り替えたときは「所属は変わらない」ことまで伝える', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChanges } = renderScore(
      [{ clef: 'treble', data }, { clef: 'bass', data: [{ events: [{ dur: '1', isRest: true, keys: ['d/3'] }] }] }],
      { mode: 'crossStaffToggle' },
    );
    const hit = noteHitOfPart(svg, 0, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 0) });

    await waitFor(() => expect(onChanges[0]).toHaveBeenCalled());
    // 実際に下の五線へ載せ替わっている（従来どおりの結果）
    const updated = onChanges[0].mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[0].renderStaff).toBe('below');
    // 通知は「表示を移した」と「所属は変わらない」の両方を言う（#322 の誤解の防止）
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('下の五線へ表示を移しました');
    expect(notices[0]).toContain('所属は声部1のまま変わりません');
  });

  it('連符ではない音符へ連符数字トグルを使うと、対象が連符だけであることが出る', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg } = renderScore([{ clef: 'treble', data }], { mode: 'tupletNumberToggle' });
    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 0) });

    await waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toContain('連符ではないため');
  });
});
