// Issue #233: 休符を音符へ置き換えるのに「1回目のクリックで選択・2回目で置換」の
// 2クリックが必要で、三連符が主体の曲（月光第1楽章は三連符が約700個）では
// 音符の 2/3 がこの2クリック操作になり入力テンポを大きく削いでいた問題の回帰テスト。
//
// ここで固定するのは次の4点（Issue の受入条件1〜4に対応）:
//   1. 3連符ツールで置いたグループの休符2つが「各1クリック」で音符になる
//   2. 通常の休符も音価ツールなら1クリックで置換・分割される
//   3. 休符ツール（音符を置かないツール）でのクリックは従来どおり選択になる
//   4. 置換1回につき onChange（＝Undo 1回ぶんの履歴）も1回だけ
// あわせて、1クリックで確定するようになったぶん重要になった
// 「押す前に結果が分かる」ホバーカーソルも固定する。
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
const quarterRest = (): NoteEvent => ({ dur: '4', isRest: true, keys: ['b/4'] });

describe('PianoSystemCanvas 休符の置換を1クリックにする（Issue #233）', () => {
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

  function clickRest(svg: SVGSVGElement, noteIndex: number, line: number) {
    const hit = noteHit(svg, noteIndex);
    fireEvent.click(hit, { clientX: centerXOf(hit), clientY: yForLine(hit, line) });
  }

  it('受入1: 連符グループの休符2つが、各1クリックで音符になる', async () => {
    // 3連符ボタン→クリックでグループを置いた直後の状態（音符1＋連符内休符2）。
    // 実機では「グループ配置1クリック＋休符2つで2クリック＝合計3クリック」で
    // 三連符1組が完成することを確認する Issue の受入条件1に対応する。
    const tuplet = { id: 't-1', ...TRIPLET };
    const tripletRest = (): NoteEvent => ({ dur: '8', isRest: true, keys: ['b/4'], tuplet });
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet },
        tripletRest(),
        tripletRest(),
        quarter('d/5'), quarter('e/5'), quarter('f/5'),
      ],
    }];
    const { svg, onChange } = renderScore(data, { duration: '8', isRest: false, tuplet: TRIPLET });

    // 2つ目（連符内休符）を1クリック。選択のための空クリックは挟まない。
    clickRest(svg, 1, 4);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const afterFirst = (onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(afterFirst[1].isRest).toBe(false);
    // 連符グループの一員のまま置き換わる（グループが壊れない）。
    expect(afterFirst[1].tuplet?.id).toBe('t-1');
    // 3つ目はまだ休符。
    expect(afterFirst[2].isRest).toBe(true);

    // 置き換わったデータを描き直し、3つ目も1クリックで音符にする。
    const { svg: svg2, onChange: onChange2 } = renderScore(
      [{ events: afterFirst }],
      { duration: '8', isRest: false, tuplet: TRIPLET }
    );
    clickRest(svg2, 2, 4);
    await waitFor(() => {
      expect(onChange2).toHaveBeenCalled();
    });
    const afterSecond = (onChange2.mock.calls.at(-1)![0] as MeasureData[])[0].events;

    // 3つとも音符になり、グループ id も音価も保たれている。
    expect(afterSecond.slice(0, 3).every((ev) => !ev.isRest)).toBe(true);
    expect(new Set(afterSecond.slice(0, 3).map((ev) => ev.tuplet?.id))).toEqual(new Set(['t-1']));
    expect(afterSecond).toHaveLength(6);
  });

  it('受入2: 連符ではない普通の休符も、音価ツールの1クリックで置換・分割される', async () => {
    const data: MeasureData[] = [{
      events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarterRest()],
    }];
    // 同音価（4分音符ツール）→ そのまま置換。
    const sameDuration = renderScore(data, { duration: '4', isRest: false });
    clickRest(sameDuration.svg, 3, 2);
    await waitFor(() => {
      expect(sameDuration.onChange).toHaveBeenCalled();
    });
    const replaced = (sameDuration.onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(replaced).toHaveLength(4);
    expect(replaced[3].isRest).toBe(false);
    expect(replaced[3].dur).toBe('4');

    // より短い音価（8分音符ツール）→ 1クリックで分割（8分音符＋8分休符）。
    const shorter = renderScore(data, { duration: '8', isRest: false });
    clickRest(shorter.svg, 3, 2);
    await waitFor(() => {
      expect(shorter.onChange).toHaveBeenCalled();
    });
    const split = (shorter.onChange.mock.calls.at(-1)![0] as MeasureData[])[0].events;
    expect(split).toHaveLength(5);
    expect(split.slice(3).map((ev) => ev.dur)).toEqual(['8', '8']);
    expect(split.slice(3).filter((ev) => ev.isRest)).toHaveLength(1);
  });

  it('受入3: 休符ツールでの休符クリックは置換にならず、選択になる', async () => {
    // 休符の位置調整・0キーリセットの入口を残すため、
    // 「音符を置かないツール」では従来どおり選択のままにする。
    const data: MeasureData[] = [{
      events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarterRest()],
    }];
    const { container, svg, onChange } = renderScore(data, { duration: '4', isRest: true });

    clickRest(svg, 3, 2);

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
    // 選択されただけで、譜面データは1バイトも変わらない。
    expect(onChange).not.toHaveBeenCalled();
  });

  it('受入3の続き: 空きのある小節でも、休符本体クリックで音符・休符が増えない（連符が壊れない）', async () => {
    // 以前は「置換できないクリック」を doInsert() へ流していたため、
    // 空き拍のある小節では休符ツールで連符内の休符を選ぼうとしただけで
    // グループの中へ休符が割り込み、連符ごと壊れていた（ブラウザ実機で確認）。
    // 1クリック化で「休符を選びたいときは休符ツール」の重要性が上がったので、
    // 選択の入口が譜面を壊さないことを固定する。
    const tuplet = { id: 't-1', ...TRIPLET };
    const data: MeasureData[] = [{
      // 8分3連（1拍）＋4分音符1つ ＝ 2拍。4/4 なので2拍空いている。
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet },
        quarter('d/5'),
      ],
    }];
    const { container, svg, onChange } = renderScore(data, { duration: '8', isRest: true });

    clickRest(svg, 1, 2);

    await waitFor(() => {
      expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
    // 連符のブラケット（数字の 3）も描かれたまま。
    expect(svg.querySelectorAll('g.vf-tuplet').length).toBe(1);
  });

  it('受入4: 置換1回につき onChange は1回だけ（Undo 1回で戻せる）', async () => {
    const data: MeasureData[] = [{
      events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarterRest()],
    }];
    const { svg, onChange } = renderScore(data, { duration: '4', isRest: false });

    clickRest(svg, 3, 2);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    // 履歴（Undo）は onChange 1回＝1エントリなので、置換が2重に積まれないことを固定する。
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ホバーカーソル: 音価ツールで置ける休符は copy、置けない休符は not-allowed', () => {
    // 1クリックで確定するようになったぶん、「押したらどうなるか」がホバーで
    // 分かることの重要性が上がっている（Issue #224 では連符ツールだけの表示だった）。
    const tuplet = { id: 't-1', ...TRIPLET };
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'], tuplet },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet },
        { dur: '8', isRest: true, keys: ['b/4'], tuplet },
        quarter('d/5'), quarter('e/5'), quarterRest(),
      ],
    }];
    // 8分音符ツール: 連符内の8分休符は同音価なので置ける。
    const placeable = renderScore(data, { duration: '8', isRest: false });
    const placeableHit = noteHit(placeable.svg, 1);
    fireEvent.mouseMove(placeableHit, {
      clientX: centerXOf(placeableHit),
      clientY: yForLine(placeableHit, 4),
    });
    expect(placeableHit.style.cursor).toBe('copy');

    // 2分音符ツール: 連符内の8分休符には音価が合わず置けない（分割もしない仕様）。
    const blocked = renderScore(data, { duration: '2', isRest: false });
    const blockedHit = noteHit(blocked.svg, 1);
    fireEvent.mouseMove(blockedHit, {
      clientX: centerXOf(blockedHit),
      clientY: yForLine(blockedHit, 4),
    });
    expect(blockedHit.style.cursor).toBe('not-allowed');
  });
});
