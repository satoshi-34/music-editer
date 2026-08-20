// Issue #168: 声部2（下声）でも3連符（連符）を入力できるようにした対応の回帰テスト。
//
// これまでは doInsert の連符分岐に `activeVoiceIndex === 0` というガードがあり、
// 声部2がアクティブなときに連符ツールを使っても「何も起こらない」状態だった。
// さらに、その分岐だけは挿入先が `m.events`（＝声部1）直書きになっていたため、
// ガードを外すだけでは声部2のつもりの操作が声部1を書き換えてしまう。
//
// ここで機械的に固定したいのは次の4点:
//   1. 声部2に「音符1＋連符内休符2」のグループが入り、声部1のイベントは変化しない
//   2. 声部1・声部2の両方に連符がある小節が、例外なく両声部ぶん描画される
//   3. 声部2の空き拍が足りないときは何もしない（声部1と同じガード）
//   4. 連符内休符の音符置換・連符グループごとの削除が声部2でも正しく効く
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

// パレットの「3連符」ボタンが tool にセットする値（3個を2個ぶんの時間に詰める）。
const TRIPLET = { numNotes: 3, notesOccupied: 2 };

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、狙った位置を素直に指定できる。
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

// 音符のヒット領域は「五線の上3加線（line -3）から下3加線（line 7）まで」の
// 固定範囲で作られる（PianoSystemCanvas の CHORD_LEDGER_TOP / BOT）。
// rect の高さを10等分すれば1ライン分の間隔が求まり、任意の line のY座標を逆算できる。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

// 符頭の描画X範囲の中央（＝確実に「その音符をクリックした」と判定される位置）。
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

// 小節の背景（空き部分）をクリックする。声部2がまだ空の小節では、
// 音符のヒット領域が作られないのでクリックは必ずここに来る。
function clickMeasureBackground(svg: SVGSVGElement) {
  const bg = svg.querySelector('rect.vf-hit') as SVGRectElement;
  expect(bg).toBeTruthy();
  const x = parseFloat(bg.getAttribute('x')!);
  const y = parseFloat(bg.getAttribute('y')!);
  const w = parseFloat(bg.getAttribute('width')!);
  const h = parseFloat(bg.getAttribute('height')!);
  fireEvent.click(bg, { clientX: x + w / 2, clientY: y + h / 2 });
}

describe('PianoSystemCanvas 声部2の3連符入力（Issue #168）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(
    data: MeasureData[],
    tool: Record<string, unknown>,
    activeVoiceIndex: number
  ) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={activeVoiceIndex}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange };
  }

  it('声部2アクティブで3連符ツールを使うと、声部2に「音符1＋連符内休符2」が入る（声部1は不変）', async () => {
    // 声部2をまだ一度も使っていない小節（voices フィールドが無い）。
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['d/5'] },
      ],
    }];
    const { svg, onChange } = renderScore(
      data,
      { duration: '8', isRest: false, tuplet: TRIPLET },
      1
    );

    clickMeasureBackground(svg);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    const voice2 = updated[0].voices?.[1]?.events ?? [];
    // Issue #322 以降、小節の途中をクリックしたときはその拍まで手前が休符で埋まるため、
    // 連符グループの前に連符ではない休符が付くことがある（グループ自体の中身は変わらない）。
    const leadingRests = voice2.slice(0, voice2.length - 3);
    const group = voice2.slice(-3);
    expect(leadingRests.every((ev) => ev.isRest && !ev.tuplet)).toBe(true);
    expect(group).toHaveLength(3);
    // 先頭が音符、残り2つが連符内の休符。
    expect(group[0].isRest).toBe(false);
    expect(group[1].isRest).toBe(true);
    expect(group[2].isRest).toBe(true);
    // 3つとも同じ連符グループ（同じ id・同じ比率）に属している。
    const ids = group.map((ev) => ev.tuplet?.id);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(1);
    group.forEach((ev) => {
      expect(ev.tuplet?.numNotes).toBe(3);
      expect(ev.tuplet?.notesOccupied).toBe(2);
      expect(ev.dur).toBe('8');
    });

    // 声部1（events）はクリック前とまったく同じまま（誤って書き込まれていない）。
    expect(updated[0].events).toEqual([
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
    ]);
  });

  it('声部2の空き拍が足りないときは、3連符を置いても何も起こらない', () => {
    // 声部2が既に4拍（4分音符4つ）で埋まっている小節。
    // 8分3連は1拍ぶんなので、4/4 の小節にはもう入らない。
    const data: MeasureData[] = [{
      events: [{ dur: '1', isRest: false, keys: ['c/5'] }],
      voices: [
        { id: 'voice-1', events: [{ dur: '1', isRest: false, keys: ['c/5'] }] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '4', isRest: false, keys: ['e/4'] },
            { dur: '4', isRest: false, keys: ['e/4'] },
            { dur: '4', isRest: false, keys: ['e/4'] },
            { dur: '4', isRest: false, keys: ['e/4'] },
          ],
        },
      ],
    }];
    const { svg, onChange } = renderScore(
      data,
      { duration: '8', isRest: false, tuplet: TRIPLET },
      1
    );

    clickMeasureBackground(svg);

    // 空き容量ガードに引っかかるので、setScore（＝onChange）自体が呼ばれない。
    expect(onChange).not.toHaveBeenCalled();
  });

  it('声部1・声部2の両方に連符がある小節が、両声部ぶん描画される', () => {
    // 「月光」第1楽章のような、上声＝旋律／下声＝3連符伴奏の書法を単純化したもの。
    // ここでは崩れずに両方が描かれること（＝連符が声部ごとに生成・描画されること）を見る。
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet: { id: 't-v1', ...TRIPLET } },
        { dur: '8', isRest: false, keys: ['d/5'], tuplet: { id: 't-v1', ...TRIPLET } },
        { dur: '8', isRest: false, keys: ['e/5'], tuplet: { id: 't-v1', ...TRIPLET } },
        { dur: '2', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['c/5'] },
      ],
      voices: [
        {
          id: 'voice-1',
          events: [
            { dur: '8', isRest: false, keys: ['c/5'], tuplet: { id: 't-v1', ...TRIPLET } },
            { dur: '8', isRest: false, keys: ['d/5'], tuplet: { id: 't-v1', ...TRIPLET } },
            { dur: '8', isRest: false, keys: ['e/5'], tuplet: { id: 't-v1', ...TRIPLET } },
            { dur: '2', isRest: false, keys: ['c/5'] },
            { dur: '4', isRest: false, keys: ['c/5'] },
          ],
        },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '8', isRest: false, keys: ['g/3'], tuplet: { id: 't-v2', ...TRIPLET } },
            { dur: '8', isRest: false, keys: ['c/4'], tuplet: { id: 't-v2', ...TRIPLET } },
            { dur: '8', isRest: false, keys: ['e/4'], tuplet: { id: 't-v2', ...TRIPLET } },
            { dur: '2', isRest: false, keys: ['g/3'] },
            { dur: '4', isRest: false, keys: ['g/3'] },
          ],
        },
      ],
    }];

    // 連符の描画に失敗すると PianoSystemCanvas が console.error で握り潰すため、
    // 「例外が出ていないこと」もあわせて確認する。
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { svg } = renderScore(data, { duration: '4', isRest: false }, 0);

      // VexFlow の Tuplet は draw 時に <g class="vf-tuplet"> を作る。
      // 声部1・声部2それぞれの連符で1つずつ、合計2つ描かれていれば
      // 「連符が声部ごとに描画されている」ことになる。
      expect(svg.querySelectorAll('g.vf-tuplet').length).toBe(2);

      const tupletDrawErrors = consoleErrorSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('連符の描画')
      );
      expect(tupletDrawErrors).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('声部2の連符内休符を同じ音価の音符ツールでクリックすると、連符情報を保ったまま音符へ置き換わる', async () => {
    // 声部2に「8分3連（音符1＋休符2）」が既にある状態。
    // 連符の後ろに4分音符を足しているのは、追加声部の「末尾の休符」は拍合わせ用の
    // ダミーとみなされ非表示（GhostNote）で描かれる既存仕様があり、
    // そのままだと連符内の休符をクリックできないため。
    const tuplet = { id: 't-v2', ...TRIPLET };
    const data: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['c/5'] }],
      voices: [
        { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/5'] }] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '8', isRest: false, keys: ['e/4'], tuplet },
            { dur: '8', isRest: true, keys: ['b/4'], tuplet },
            { dur: '8', isRest: true, keys: ['b/4'], tuplet },
            { dur: '4', isRest: false, keys: ['e/4'] },
          ],
        },
      ],
    }];
    const { svg, onChange } = renderScore(
      data,
      { duration: '8', isRest: false, tuplet: TRIPLET },
      1
    );

    // 連符内の2つ目（休符）を1クリックで音符へ置換する（Issue #233 で2段階操作を廃止）。
    const hit = noteHit(svg, 1);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    const voice2 = updated[0].voices?.[1]?.events;
    // 個数は変わらず（分割はしない仕様）、2つ目だけが音符になり tuplet 情報は維持される。
    expect(voice2).toHaveLength(4);
    expect(voice2![1].isRest).toBe(false);
    expect(voice2![1].tuplet?.id).toBe('t-v2');
    // 声部1は変化しない。
    expect(updated[0].events).toEqual([{ dur: '4', isRest: false, keys: ['c/5'] }]);
  });

  it('声部2の連符内の音符を Delete すると、グループ全体が同じ長さの通常の休符へ置き換わる', async () => {
    // 連符の一部だけ消すと、残りが tuplet.id を持ったまま半端な音価で残り
    // 描画・再生が壊れる。声部1と同じく「グループごと通常の休符へ」が正しい挙動。
    const tuplet = { id: 't-v2', ...TRIPLET };
    const data: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['c/5'] }],
      voices: [
        { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/5'] }] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '8', isRest: false, keys: ['e/4'], tuplet },
            { dur: '8', isRest: true, keys: ['b/4'], tuplet },
            { dur: '8', isRest: true, keys: ['b/4'], tuplet },
          ],
        },
      ],
    }];
    const { container, svg, onChange } = renderScore(
      data,
      { duration: '4', isRest: false },
      1
    );

    const hit = noteHit(svg, 0);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, 4) });
    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    const voice2 = updated[0].voices?.[1]?.events;
    // 8分3連は合計1拍なので、通常の4分休符1つに置き換わる。
    expect(voice2).toHaveLength(1);
    expect(voice2![0].isRest).toBe(true);
    expect(voice2![0].dur).toBe('4');
    expect(voice2![0].tuplet).toBeUndefined();
    // 声部1は変化しない。
    expect(updated[0].events).toEqual([{ dur: '4', isRest: false, keys: ['c/5'] }]);
  });
});
