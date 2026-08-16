// src/components/PianoSystemCanvasDeleteNotice.test.tsx
// Issue #238: 選択が残った音符に意図しない Delete が届くと無言で消える問題への対処。
//
// ここで固定するのは譜面側（PianoSystemCanvas）の2点:
//   1. Delete で消したときに「何を消したか」の通知イベントを出す
//   2. 選択解除の要求イベントを受け取ったら選択を手放し、以降の Delete が譜面に届かない
//
// レンダー手法・座標のモックは PianoSystemCanvasStaleSelectionAfterUndo.test.tsx と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import {
  SCORE_EDIT_NOTICE_EVENT,
  SCORE_SELECTION_CLEAR_EVENT,
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

describe('PianoSystemCanvas の削除通知と選択の自動解除（Issue #238）', () => {
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

  function renderScore(data: MeasureData[]) {
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { ...view, svg, onChange };
  }

  it('音符を Delete で消すと、何を消したかの通知が出る', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, container } = renderScore(data);
    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 1.5) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('音符を削除しました');
    // Undo で戻せることを必ず添える（確認ダイアログを出さない方針の代わり）
    expect(notices[0]).toContain('Cmd/Ctrl+Z');
  });

  it('連符の中の音符を消すと「連符内の音符を休符にしました」と伝える（Issue #283）', async () => {
    // 仕様変更前はここでグループごと消えていた（文言も「3連符グループを削除しました」だった）。
    // 今は「♪♪♪ → ♪休♪」のようにグループが残るので、文言もそれに合わせる。
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } },
        { dur: '8', isRest: false, keys: ['d/5'], tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } },
        { dur: '8', isRest: false, keys: ['e/5'], tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, container } = renderScore(data);
    const hit = noteHit(svg, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 1) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    // 実際の結果（真ん中だけが連符内の休符になり、グループは3イベントのまま）
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(5);
    expect(updated[0].events[1].isRest).toBe(true);
    expect(updated[0].events[1].tuplet?.id).toBe('t1');

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('連符内の音符を休符にしました');
  });

  it('グループに残る最後の音符を消したときは「3連符グループを削除しました」と伝える', async () => {
    // 実機で起きた事故（三連符が気づかぬうちに丸ごと消える）の文言は、
    // 実際にグループごと消えるこの経路で引き続き出す。
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: true, keys: ['b/4'], tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } },
        { dur: '8', isRest: false, keys: ['d/5'], tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 } },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, container } = renderScore(data);
    const hit = noteHit(svg, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 1) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('3連符グループを削除しました');
  });

  it('選択解除の要求が来たら選択を手放し、以降の Delete が譜面に届かない', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange, container } = renderScore(data);
    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 1.5) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    // タブ切り替え・ツール変更・再生開始のときに ScorePage が出す要求
    window.dispatchEvent(new Event(SCORE_SELECTION_CLEAR_EVENT));
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeNull();
    });

    onChange.mockClear();
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise(r => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });
});
