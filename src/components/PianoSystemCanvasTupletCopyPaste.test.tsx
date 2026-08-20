// Issue #234: 連符グループ単位のコピー＆ペースト（小節未満の部分コピペ 段1）。
//
// 運用者の実用例は「月光の三連符を何度も置き直す」なので、
//   1. 連符の音符を選んで Cmd+C → そのグループ全体がコピーされる
//   2. 休符をクリック1回で貼れる（同じ小節でも別の小節でも）
//   3. 貼られたグループは元と別のグループ id を持つ（ビーム・"3" 表示が独立する）
//   4. 容量が足りないときは何も起きない（壊れない）
// の4点を、実際のクリック・キー操作で固定する（Issue の受入条件1〜4に対応）。
//
// 小節単位のコピペ（ScorePage 側の Cmd+C/V）を壊していないことは、
// 「小節が選択されているあいだはキャンバス側がグループをコピーしない」ことで担保する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';
import { getTupletClipboardGroup, setTupletClipboardGroup } from '../utils/tupletClipboard';
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn()
    };
  })
}));

const TEST_CONTAINER_WIDTH = 700;

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （PianoSystemCanvasRestToTuplet.test.tsx と同じ前提）。
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

// ヒット領域は五線の上3加線（line -3）から下3加線（line 7）までの固定範囲。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

function noteHit(svg: SVGSVGElement, measureIndex: number, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="${measureIndex}"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

/** 音符・休符の本体をクリックする（line は五線基準の高さ。b/4 は line 2）。 */
function clickAt(svg: SVGSVGElement, measureIndex: number, noteIndex: number, line: number) {
  const hit = noteHit(svg, measureIndex, noteIndex);
  fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, line) });
}

/**
 * 休符の「時間枠（列）」の端をクリックする（Issue #325）。
 * where: 'left' = 列の左端寄り、'right' = 列の右端寄り。
 * 記号の描画中心 ±18 の帯からは確実に外れる位置を選ぶ（4分休符の列は幅240前後）。
 */
function clickAtColumnEdge(
  svg: SVGSVGElement,
  measureIndex: number,
  noteIndex: number,
  line: number,
  where: 'left' | 'right'
) {
  const hit = noteHit(svg, measureIndex, noteIndex);
  const x = parseFloat(hit.getAttribute('x')!);
  const width = parseFloat(hit.getAttribute('width')!);
  // 端そのものだと丸めで隣のセルへ落ちうるので、2単位だけ内側を押す
  const clientX = where === 'left' ? x + 2 : x + width - 2;
  // 記号帯（±18）の外であることをテスト自身でも確かめておく（列が細い譜面では前提が崩れるため）
  expect(Math.abs(clientX - centerXOf(hit))).toBeGreaterThan(18);
  fireEvent.click(hit, { clientX, clientY: yForLine(hit, line) });
}

const TRIPLET = { numNotes: 3, notesOccupied: 2 };
const SOURCE_GROUP_ID = 'group-source';

/** 8分3連グループ（音符1つ＋連符内休符2つ・実長1拍）。 */
function tripletGroup(id: string, noteKey = 'b/4'): NoteEvent[] {
  const tuplet = { id, ...TRIPLET };
  return [
    { dur: '8', isRest: false, keys: [noteKey], tuplet },
    { dur: '8', isRest: true, keys: ['b/4'], tuplet },
    { dur: '8', isRest: true, keys: ['b/4'], tuplet },
  ];
}

const quarterRest = (): NoteEvent => ({ dur: '4', isRest: true, keys: ['b/4'] });
const quarterNote = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });

describe('PianoSystemCanvas 連符グループのコピー＆ペースト（Issue #234）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // クリップボードはモジュール変数なので、テスト間で持ち越さないよう毎回空にする。
    setTupletClipboardGroup(null);
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    setTupletClipboardGroup(null);
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(
    data: MeasureData[],
    tool: Record<string, unknown> = { duration: '4', isRest: false },
    extraProps: Record<string, unknown> = {}
  ) {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <PianoSystemCanvas
        measuresPerSystem={data.length}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        {...extraProps}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange, unmount };
  }

  /** 連符の先頭音符を選んで Cmd+C を押す（＝グループのコピー操作）。 */
  function copyGroupFromFirstNote(svg: SVGSVGElement, measureIndex = 0, noteIndex = 0) {
    clickAt(svg, measureIndex, noteIndex, 2);
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
  }

  it('受入1a: 三連符1組をコピーして、同じ小節の休符へ1クリックで貼れる', async () => {
    // 4/4 = 3連符（1拍）＋4分休符3つ
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data);

    copyGroupFromFirstNote(svg);
    expect(getTupletClipboardGroup()).toHaveLength(3);

    // 2拍目の4分休符（イベント3）をクリック1回で貼り付け
    clickAt(svg, 0, 3, 2);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 元グループ3 + 貼り付けたグループ3 + 残りの4分休符2
    expect(updated).toHaveLength(8);
    const pasted = updated.slice(3, 6);
    expect(pasted.map((ev) => ev.isRest)).toEqual([false, true, true]);
    pasted.forEach((ev) => {
      expect(ev.dur).toBe('8');
      expect(ev.tuplet?.numNotes).toBe(3);
      expect(ev.tuplet?.notesOccupied).toBe(2);
    });
    // 貼られた音符の音高はコピー元と同じ
    expect(pasted[0].keys).toEqual(['b/4']);
  });

  it('受入1b: 別の小節の休符へも1クリックで貼れる', async () => {
    const data: MeasureData[] = [
      { events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()] },
      { events: [quarterRest(), quarterRest(), quarterRest(), quarterRest()] },
    ];
    const { svg, onChange } = renderScore(data);

    copyGroupFromFirstNote(svg);
    // 2小節目の先頭の4分休符へ貼る
    clickAt(svg, 1, 0, 2);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updatedMeasures = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const target = updatedMeasures[1].events;

    expect(target).toHaveLength(6);
    expect(target.slice(0, 3).every((ev) => !!ev.tuplet)).toBe(true);
    // 1小節目は変わらない
    expect(updatedMeasures[0].events).toHaveLength(6);
  });

  it('受入2: 貼られたグループは独立したグループ id を持ち、連符として描画される', async () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange, unmount } = renderScore(data);
    // 貼り付け前は連符のブラケット・数字が1つだけ
    expect(svg.querySelectorAll('g.vf-tuplet').length).toBe(1);

    copyGroupFromFirstNote(svg);
    clickAt(svg, 0, 3, 2);
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const events = updated[0].events;
    const sourceIds = new Set(events.slice(0, 3).map((ev) => ev.tuplet?.id));
    const pastedIds = new Set(events.slice(3, 6).map((ev) => ev.tuplet?.id));
    // グループ内は同じ id・グループ同士は別の id（元グループの id は使い回さない）
    expect(sourceIds.size).toBe(1);
    expect(pastedIds.size).toBe(1);
    expect([...pastedIds][0]).not.toBe(SOURCE_GROUP_ID);
    expect([...pastedIds][0]).not.toBe([...sourceIds][0]);

    // 描き直すと "3" の表示（g.vf-tuplet）が2つになる
    unmount();
    const { svg: redrawn } = renderScore(updated);
    expect(redrawn.querySelectorAll('g.vf-tuplet').length).toBe(2);
  });

  it('受入2b: 長い休符へ貼ると、余りは通常の休符として後ろに残る（#224 と同じ分割規則）', async () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), { dur: '2', isRest: true, keys: ['b/4'] }, quarterRest()],
    }];
    const { svg, onChange } = renderScore(data);

    copyGroupFromFirstNote(svg);
    clickAt(svg, 0, 3, 2);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 元グループ3 + 貼り付け3 + 余りの4分休符1 + もとの4分休符1
    expect(updated).toHaveLength(8);
    expect(updated[6].isRest).toBe(true);
    expect(updated[6].dur).toBe('4');
    expect(updated[6].tuplet).toBeUndefined();
  });

  it('受入4a: グループより短い休符には貼れず、譜面は変わらない', async () => {
    const data: MeasureData[] = [{
      events: [
        ...tripletGroup(SOURCE_GROUP_ID),
        { dur: '8', isRest: true, keys: ['b/4'] },
        { dur: '8', isRest: true, keys: ['b/4'] },
        quarterRest(), quarterRest(),
      ],
    }];
    const { svg, onChange } = renderScore(data);

    copyGroupFromFirstNote(svg);
    // 8分休符（1/2拍）には1拍のグループが入らない
    clickAt(svg, 0, 3, 2);
    clickAt(svg, 0, 3, 2);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入4b: 小節が満杯のときは Cmd+V で追加されない', async () => {
    // 先頭を b/4（クリック位置 line 2 と同じ高さ）にして、クリックが「選択」になるようにする
    // （違う高さをクリックすると和音に音が足される既存仕様に当たってしまうため）。
    const data: MeasureData[] = [{
      events: [quarterNote('b/4'), quarterNote('d/5'), quarterNote('e/5'), quarterNote('f/5')],
    }];
    // 別の小節からコピーした想定で、クリップボードへ直接グループを入れておく
    setTupletClipboardGroup(tripletGroup(SOURCE_GROUP_ID));
    const { svg, onChange } = renderScore(data);

    clickAt(svg, 0, 0, 2);
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('小節に空きがあれば Cmd+V で末尾へ追加される', async () => {
    const data: MeasureData[] = [{ events: [quarterNote('b/4'), quarterNote('d/5')] }];
    setTupletClipboardGroup(tripletGroup(SOURCE_GROUP_ID));
    const { svg, onChange } = renderScore(data);

    // 音符を選んでから Cmd+V（貼り付け先の小節は「選択中の音符がある小節」）
    clickAt(svg, 0, 0, 2);
    fireEvent.keyDown(window, { key: 'v', metaKey: true });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(updated).toHaveLength(5);
    expect(updated.slice(2).every((ev) => !!ev.tuplet)).toBe(true);
    expect(updated[2].tuplet?.id).not.toBe(SOURCE_GROUP_ID);
  });

  it('受入3: 小節が選択されているあいだは、Cmd+C がグループのコピーにならない（小節コピー優先）', () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg } = renderScore(data, { duration: '4', isRest: false }, { selectedMeasures: { start: 0, end: 0 } });

    copyGroupFromFirstNote(svg);

    // 小節コピー（ScorePage 側）に譲るので、グループのクリップボードは空のまま
    expect(getTupletClipboardGroup()).toBeNull();
  });

  it('連符の外の音符では Cmd+C しても何もコピーされない', () => {
    const data: MeasureData[] = [{
      events: [quarterNote('c/5'), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg } = renderScore(data);

    copyGroupFromFirstNote(svg);

    expect(getTupletClipboardGroup()).toBeNull();
  });

  it('クリップボードが空なら、休符クリックは従来どおり音符の置換になる', async () => {
    const data: MeasureData[] = [{
      events: [quarterNote('c/5'), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { duration: '4', isRest: false });

    clickAt(svg, 0, 1, 2);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(updated).toHaveLength(4);
    expect(updated[1].isRest).toBe(false);
    expect(updated[1].tuplet).toBeUndefined();
  });

  // ── Issue #325: コピー中は休符の列全体を当たり判定にする ──
  //
  // 症状: 貼り付けが成立するのは休符の記号の描画中心±18 の帯だけで、列（4分休符で幅240前後）の
  // 残り9割をクリックすると隣接挿入へ流れ、満杯の小節では無言で何も起きなかった。
  it('受入1c: コピー中は、休符の列の左端をクリックしても貼れる（記号帯の外）', async () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data);

    copyGroupFromFirstNote(svg);
    clickAtColumnEdge(svg, 0, 3, 2, 'left');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    // 元グループ3 + 貼り付けたグループ3 + 残りの4分休符2（記号帯クリックと同じ結果）
    expect(updated).toHaveLength(8);
    expect(updated.slice(3, 6).every((ev) => !!ev.tuplet)).toBe(true);
    expect(updated[3].tuplet?.id).not.toBe(SOURCE_GROUP_ID);
  });

  it('受入1d: コピー中は、休符の列の右端をクリックしても貼れる（隣接挿入にならない）', async () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data);

    copyGroupFromFirstNote(svg);
    clickAtColumnEdge(svg, 0, 3, 2, 'right');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(updated).toHaveLength(8);
    // 「4分音符が1つ増える」隣接挿入だったころの結果（7イベント・連符なし）になっていないこと
    expect(updated.slice(3, 6).every((ev) => !!ev.tuplet)).toBe(true);
  });

  it('コピー中でなければ、列の端のクリックは従来どおり隣接挿入のまま（回帰なし）', async () => {
    // 8分音符を1つ足せる空き（3拍ぶんのイベント）を残しておく。
    // 満杯の小節では挿入そのものが容量チェックで止まるため、判定の違いを見られない。
    const data: MeasureData[] = [{
      events: [quarterNote('c/5'), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false });

    // クリップボードは空（beforeEach で null）。列の右端は休符の置換ではなく挿入になる
    clickAtColumnEdge(svg, 0, 1, 2, 'right');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    // 休符はそのまま残り、8分音符が1つ増える（＝置換ではなく挿入）
    expect(updated.length).toBeGreaterThan(3);
    expect(updated.some((ev) => !ev.isRest && ev.dur === '8')).toBe(true);
    expect(updated[1].isRest).toBe(true);
    expect(updated[1].dur).toBe('4');
  });

  it('貼れない休符では、列のどこを押しても譜面が変わらず、理由が通知される（#318 の行き止まりは喋る）', async () => {
    const data: MeasureData[] = [{
      events: [
        ...tripletGroup(SOURCE_GROUP_ID),
        { dur: '8', isRest: true, keys: ['b/4'] },
        { dur: '8', isRest: true, keys: ['b/4'] },
        quarterRest(), quarterRest(),
      ],
    }];
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail.message);
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      const { svg, onChange } = renderScore(data);

      copyGroupFromFirstNote(svg);
      // 8分休符（1/2拍）には1拍のグループが入らない。記号帯の外でも「無言で挿入」にはしない
      clickAtColumnEdge(svg, 0, 3, 2, 'right');

      expect(onChange).not.toHaveBeenCalled();
      expect(notices.some((m) => m.includes('拍が足りない'))).toBe(true);
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });

  it('Escape でコピー状態を解除すると、休符クリックは通常の音符入力へ戻る', async () => {
    const data: MeasureData[] = [{
      events: [...tripletGroup(SOURCE_GROUP_ID), quarterRest(), quarterRest(), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { duration: '4', isRest: false });

    copyGroupFromFirstNote(svg);
    expect(getTupletClipboardGroup()).toHaveLength(3);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getTupletClipboardGroup()).toBeNull();

    // 解除後の休符クリックは4分音符への置換（従来どおり）
    clickAt(svg, 0, 3, 2);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(updated).toHaveLength(6);
    expect(updated[3].isRest).toBe(false);
    expect(updated[3].tuplet).toBeUndefined();
  });
});
