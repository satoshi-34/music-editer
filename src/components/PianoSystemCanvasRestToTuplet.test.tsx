// Issue #224: 満杯の小節で連符グループを削除すると1拍の通常休符に戻るのに、
// その休符を連符ツールでクリックしても連符へ戻せず「連符→休符」が一方通行だった不具合の回帰テスト。
//
// 休符クリックの置換（buildRestEditReplacement）は音価ツールぶんの分岐しか持たず、
// 連符ツールが選ばれていても「普通の8分音符と休符に分割する」か、休符本体から
// 外れたクリックでは満杯ガードに当たって何も起きないかのどちらかだった。
//
// ここで固定するのは次の4点（Issue の受入条件1〜4に対応）:
//   1. 4/4 満杯の小節の4分休符を3連符ツールでクリック →「音符1＋連符内休符2」に置き換わる
//   2. 2分休符なら連符グループ＋残り1拍の4分休符になる
//   3. グループより短い休符（8分休符）では何も起きない
//   4. 連符ツールを使っていない音価ツールでの置換・分割は従来どおり
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';

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

// ヒット領域は五線の上3加線（line -3）から下3加線（line 7）までの固定範囲で作られる。
// rect の高さを10等分すれば1ライン分の間隔が求まり、任意の line のY座標を逆算できる。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

// 休符記号の描画X範囲の中央（＝「休符本体をクリックした」と判定される位置）。
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

const quarter = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });

describe('PianoSystemCanvas 休符を連符グループで置き換える（Issue #224）', () => {
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

  function renderScore(data: MeasureData[], tool: Record<string, unknown>) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange };
  }

  /**
   * 音価ツール（音符側）を選んでいるあいだ、休符の置換は1クリックで確定する（Issue #233）。
   * 以前は「1回目で選択・2回目で置換」の2段階だったが、三連符主体の曲で入力テンポを
   * 大きく削いでいたため1クリック化した。
   */
  function clickRest(svg: SVGSVGElement, noteIndex: number, line: number) {
    const hit = noteHit(svg, noteIndex);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, line) });
  }

  it('受入1: 満杯の小節に残った4分休符を3連符ツールでクリックすると連符グループへ置き換わる', async () => {
    // 4/4 が音符3つ＋4分休符1つで満杯（＝連符グループを削除した直後の状態）。
    // 満杯なので「小節の末尾へ追加」の経路では連符を置けない。
    const data: MeasureData[] = [{
      events: [
        quarter('c/5'), quarter('d/5'), quarter('e/5'),
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    clickRest(svg, 3, 2);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 音符3つはそのまま、4分休符1つが3イベント（音符1＋連符内休符2）に置き換わる。
    expect(updated).toHaveLength(6);
    expect(updated.slice(0, 3)).toEqual([quarter('c/5'), quarter('d/5'), quarter('e/5')]);
    const group = updated.slice(3);
    expect(group[0].isRest).toBe(false);
    expect(group[1].isRest).toBe(true);
    expect(group[2].isRest).toBe(true);
    group.forEach((ev) => {
      expect(ev.dur).toBe('8');
      expect(ev.tuplet?.numNotes).toBe(3);
      expect(ev.tuplet?.notesOccupied).toBe(2);
    });
    // 3つとも同じグループ（同じ id）に属する
    expect(new Set(group.map((ev) => ev.tuplet?.id)).size).toBe(1);
  });

  it('受入2: 2分休符を3連符ツールでクリックすると、連符グループ＋残り1拍の4分休符になる', async () => {
    const data: MeasureData[] = [{
      events: [
        quarter('c/5'), quarter('d/5'),
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    clickRest(svg, 2, 2);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 4分音符2 + 連符3 + 余りの4分休符1
    expect(updated).toHaveLength(6);
    expect(updated.slice(2, 5).every((ev) => !!ev.tuplet)).toBe(true);
    const leftover = updated[5];
    expect(leftover.isRest).toBe(true);
    expect(leftover.dur).toBe('4');
    // 余りの休符は連符グループに巻き込まれない（tuplet を持たない）
    expect(leftover.tuplet).toBeUndefined();
  });

  it('受入3: グループより短い8分休符では、満杯の小節で何も起きない', async () => {
    // 4/4 が音符3つ＋8分休符2つで満杯。8分3連グループは1拍ぶんなので8分休符には入らない。
    const data: MeasureData[] = [{
      events: [
        quarter('c/5'), quarter('d/5'), quarter('e/5'),
        { dur: '8', isRest: true, keys: ['b/4'] },
        { dur: '8', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    // 置けない休符は、1クリック化（Issue #233）後も何度押しても譜面データが変わらない。
    clickRest(svg, 3, 2);
    clickRest(svg, 3, 2);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入4: 連符ツールを使わない音価ツールの置換・分割は従来どおり', async () => {
    const data: MeasureData[] = [{
      events: [
        quarter('c/5'), quarter('d/5'), quarter('e/5'),
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    // 8分音符ツール（連符トグル無し）で4分休符をクリック → 8分音符＋8分休符に分割される。
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false });

    clickRest(svg, 3, 2);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    expect(updated).toHaveLength(5);
    expect(updated[3].dur).toBe('8');
    expect(updated[4].dur).toBe('8');
    // 分割で生まれた2つはどちらも連符ではない
    expect(updated[3].tuplet).toBeUndefined();
    expect(updated[4].tuplet).toBeUndefined();
    // 片方が音符、もう片方が休符（クリック位置によって前後が決まる既存仕様）
    expect(updated.slice(3, 5).filter((ev) => ev.isRest)).toHaveLength(1);
  });

  it('連符内の休符は従来どおり（同じ音価なら音符へ置換され、グループは分割されない）', async () => {
    // 既に置かれている8分3連の2つ目（連符内休符）を、3連符ツールのままクリックする。
    // ここで新しい連符グループを作ってしまうと連符が入れ子になって壊れるため、
    // 従来の保守的な仕様（同音価なら音符へ置換）が優先されることを固定する。
    const tuplet = { id: 't-1', ...TRIPLET };
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet },
        quarter('d/5'), quarter('e/5'), quarter('f/5'),
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    clickRest(svg, 1, 4);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 個数は変わらず、2つ目だけが音符になり、元のグループ id を保つ。
    expect(updated).toHaveLength(6);
    expect(updated[1].isRest).toBe(false);
    expect(updated[1].tuplet?.id).toBe('t-1');
  });

  it('置き換え後の小節が実際に連符（ブラケット）付きで描画される', async () => {
    const data: MeasureData[] = [{
      events: [
        quarter('c/5'), quarter('d/5'), quarter('e/5'),
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    // 置き換え前は連符が1つも無い。
    expect(svg.querySelectorAll('g.vf-tuplet').length).toBe(0);

    clickRest(svg, 3, 2);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    // 置き換え後のデータを描き直すと、連符の数字（g.vf-tuplet）が1つ増える。
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const { svg: redrawn } = renderScore(updated, { duration: '8', isRest: false, tuplet: TRIPLET });
    expect(redrawn.querySelectorAll('g.vf-tuplet').length).toBe(1);
  });
});
