// Issue #524: ↑↓（音高）・←→（隣の音符へ）・Delete は実装済み・ヘルプ記載済みなのに、
// 運用者・テスターとも存在に気づいていなかった（「機能があるのに知られない」）。
//
// ここで固定するのは譜面側（PianoSystemCanvas）の3点:
//   1. 音符を**初めて**選択したときに、キーボード操作のヒント通知が出る
//   2. 2つ目の音符を選び直しても、もう出ない（同じ読み込み中に何度も出ない）
//   3. 既読が localStorage に残っている状態でマウントしたら出ない（再読込後も出ない）
//
// レンダー手法・座標のモックは PianoSystemCanvasDeleteNotice.test.tsx と同じ。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import {
  SCORE_EDIT_NOTICE_EVENT,
  type ScoreEditNoticeDetail,
} from '../utils/scoreEditorNotices';
import {
  ARROW_KEY_HINT_NOTICE_MESSAGE,
  ARROW_KEY_HINT_NOTICE_SEEN_KEY,
  resetArrowKeyHintNoticeForTest,
} from '../utils/arrowKeyHintNotice';

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
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
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

/** 2音だけの小節（1つ目を選んだあと、2つ目を選び直せるようにする） */
const TWO_NOTES: MeasureData[] = [{
  events: [
    { dur: '4', isRest: false, keys: ['c/5'] },
    { dur: '4', isRest: false, keys: ['e/5'] },
    { dur: '2', isRest: true, keys: ['b/4'] },
  ],
}];

describe('PianoSystemCanvas 音符の初回選択で矢印キーのヒントを出す（Issue #524）', () => {
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
    // 既読フラグ・読み込み内フラグの両方を初期状態（未読）へ戻す
    localStorage.removeItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY);
    resetArrowKeyHintNoticeForTest();
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
    localStorage.removeItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY);
    resetArrowKeyHintNoticeForTest();
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

  /** 音符の符頭をクリックして選択する */
  function selectNote(svg: SVGSVGElement, noteIndex: number, line: number) {
    const hit = noteHit(svg, noteIndex);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, line) });
  }

  const hintCount = (messages: string[]) =>
    messages.filter((m) => m === ARROW_KEY_HINT_NOTICE_MESSAGE).length;

  it('受入1: 音符を初めて選択するとヒントが出て、既読が記録される', async () => {
    const { svg, container } = renderScore(TWO_NOTES);

    selectNote(svg, 0, 1.5);

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
    await waitFor(() => expect(hintCount(notices)).toBe(1));
    expect(localStorage.getItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY)).not.toBeNull();
  });

  it('受入1: 2つ目の音符を選び直しても、ヒントは二度と出ない', async () => {
    const { svg, container } = renderScore(TWO_NOTES);

    selectNote(svg, 0, 1.5);
    await waitFor(() => expect(hintCount(notices)).toBe(1));

    // 別の音符を選び直す（選択が付け替わっても通知は増えない）
    selectNote(svg, 1, 1);
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
    expect(hintCount(notices)).toBe(1);
  });

  it('受入1: 既読の状態で開き直したら（再読込相当）ヒントは出ない', async () => {
    // 前回の訪問で既読になっている状態を作る
    localStorage.setItem(ARROW_KEY_HINT_NOTICE_SEEN_KEY, '1');
    resetArrowKeyHintNoticeForTest(); // ページ読み込みし直し相当
    const { svg, container } = renderScore(TWO_NOTES);

    selectNote(svg, 0, 1.5);

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
    expect(hintCount(notices)).toBe(0);
  });

  it('受入3: ヒントは通知イベントだけで、譜面の DOM に新しい要素を足さない', async () => {
    const { svg, container } = renderScore(TWO_NOTES);
    const beforeCount = container.querySelectorAll('*').length;

    selectNote(svg, 0, 1.5);
    await waitFor(() => expect(hintCount(notices)).toBe(1));

    // 選択ハイライト（rect.vf-note-selected）以外に要素が増えていないこと。
    // ヒントの表示は ScorePage 側の通知欄が担当するので、譜面側は素通しでよい。
    const added = container.querySelectorAll('*').length - beforeCount;
    expect(added).toBeLessThanOrEqual(container.querySelectorAll('rect.vf-note-selected').length);
  });
});
