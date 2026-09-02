// Issue #548: 臨時記号パレットの統合（案D・クリック先で意味を決める）の**受入テスト草案**。
//
// 設計メモ: .claude/specs/accidental-palette-unification/design.md
//
// ⚠ この describe は **意図的に skip している**。統合はまだ実装しておらず、
//   ここに書いてあるのは「実装段で満たすべき合格基準」だから。
//   実装段では `describe.skip` の `.skip` を外し、全ケースを緑にすることが完了条件になる。
//   設計時の期待と実装が食い違った場合は、黙って書き換えず「なぜ違ったか」を PR 本文に書く。
//
// ケース番号は設計メモ §5 の表と対応している。
// ケース7（Undo 1回で戻る）・ケース9（既存データの回帰）は、既存の
// `ScorePageInputAccidentalWiring.test.tsx` / `ScorePageDoubleAccidentalWiring.test.tsx` を
// 統合後のラベル・クリック位置へ移行することで担保する（設計メモ §6 の移行表）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

import Palette from './Palette';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { Tool } from './Palette';
import type { MeasureData } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
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
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

/** 統合後の aria-label の前提（設計メモ §3-6）: `臨時記号: <名前>（…）` で始まる1種類だけ */
const LABEL_PREFIX = {
  sharp: '臨時記号: シャープ',
  flat: '臨時記号: フラット',
  natural: '臨時記号: ナチュラル',
  quarterSharp: '臨時記号: 四分音上げ',
} as const;

function buttonByLabelPrefix(container: HTMLElement, prefix: string): HTMLButtonElement {
  const btn = container.querySelector(`button[aria-label^="${prefix}"]`) as HTMLButtonElement | null;
  expect(btn, `${prefix} のボタン`).toBeTruthy();
  return btn!;
}

// jsdom はレイアウトを持たないため、描画幅を固定してクリック座標を計算できるようにする
// （既存の PianoSystemCanvasInputAccidental.test.tsx と同じ手当て）
const TEST_CONTAINER_WIDTH = 700;

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

describe.skip('#548 臨時記号パレットの統合（案D）の受入基準', () => {
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
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });

  /** 五線ライン→クリックY（ヒット領域は五線ライン -3〜7 をカバーしている） */
  function clickYForLine(hit: SVGRectElement, line: number): number {
    const y = parseFloat(hit.getAttribute('y')!);
    const h = parseFloat(hit.getAttribute('height')!);
    return y + (line - (-3)) * (h / 10);
  }

  function renderCanvas(data: MeasureData[], tool: Tool) {
    const onChange = vi.fn();
    const rendered = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = rendered.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { svg, onChange };
  }

  function noteHit(svg: SVGSVGElement, index: number): SVGRectElement {
    const hit = svg.querySelector(`rect.vf-note-hit[data-measure="0"][data-note="${index}"]`) as SVGRectElement | null;
    expect(hit, `イベント${index}の当たり判定`).toBeTruthy();
    return hit!;
  }

  // ── パレット側（段1a で緑になる） ───────────────────────────────

  it('ケース3: 臨時記号を選んだまま音価を変えても、記号の選択は保持される', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false, accidental: 'sharp' }} onChange={onChange} section="notes" />
    );
    // 8分音符のボタン（既存の aria-label をそのまま使う）
    fireEvent.click(buttonByLabelPrefix(container, '8分音符'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ duration: '8', accidental: 'sharp' }));
  });

  it('ケース4: ON中に同じ記号を押すと OFF に戻る', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false, accidental: 'sharp' }} onChange={onChange} section="notes" />
    );
    fireEvent.click(buttonByLabelPrefix(container, LABEL_PREFIX.sharp));
    expect(onChange).toHaveBeenCalledWith({ duration: '4', isRest: false, accidental: undefined });
  });

  it('ケース5: ON中に別の記号を押すと切り替わる（両方 ON にならない）', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false, accidental: 'sharp' }} onChange={onChange} section="notes" />
    );
    fireEvent.click(buttonByLabelPrefix(container, LABEL_PREFIX.flat));
    expect(onChange).toHaveBeenCalledWith({ duration: '4', isRest: false, accidental: 'flat' });
  });

  it('ケース6: 休符ツール中に臨時記号を ON にすると、同じ音価の音符へ切り替わる', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '8', isRest: true }} onChange={onChange} section="notes" />
    );
    fireEvent.click(buttonByLabelPrefix(container, LABEL_PREFIX.natural));
    expect(onChange).toHaveBeenCalledWith({ duration: '8', isRest: undefined, accidental: 'natural' });
  });

  it('ケース10: 臨時記号のボタンは1組だけで、同じ記号のボタンが2つ出ない', () => {
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false }} onChange={vi.fn()} section="notes" />
    );
    // 旧・入力家族のラベルは消えていること
    expect(container.querySelector('button[aria-label^="入力時に付ける臨時記号"]')).toBeNull();
    // 旧・付与家族のラベル（「シャープ（選択して音符をクリック）」）も消えていること
    expect(container.querySelector('button[aria-label^="シャープ（"]')).toBeNull();
    // 統合後のラベルはシャープにつき1つだけ
    expect(container.querySelectorAll(`button[aria-label^="${LABEL_PREFIX.sharp}"]`)).toHaveLength(1);
  });

  it('ケース14: 臨時記号と微分音は排他（後から押した方だけ ON になる）', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Palette value={{ duration: '4', isRest: false, accidental: 'sharp' }} onChange={onChange} section="notes" />
    );
    fireEvent.click(buttonByLabelPrefix(container, LABEL_PREFIX.quarterSharp));
    expect(onChange).toHaveBeenCalledWith(
      // 段1a で Tool へ microtone 属性が入る（設計メモ §3-1）。それまでは型に無いので比較だけ書く
      expect.objectContaining({ duration: '4', accidental: undefined, microtone: 'quarterSharp' })
    );
  });

  // ── 譜面側（段1b で緑になる） ─────────────────────────────────

  it('ケース1: 符頭をクリックすると、その音に付与される（音符は増えず、音価も変わらない）', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '2', isRest: false, keys: ['b/4'] },
        { dur: '2', isRest: false, keys: ['b/4'] },
      ],
    }];
    // 8分音符＋♯を持った状態でも、符頭クリックは「付与」だけを行う
    const { svg, onChange } = renderCanvas(data, { duration: '8', isRest: false, accidental: 'sharp' });

    const hit = noteHit(svg, 0);
    const noteLeft = parseFloat(hit.getAttribute('data-note-left')!);
    const noteRight = parseFloat(hit.getAttribute('data-note-right')!);
    fireEvent.click(hit, { clientX: (noteLeft + noteRight) / 2, clientY: clickYForLine(hit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(2);          // 音符は増えない
    expect(updated[0].events[0].keys).toEqual(['b#/4']); // ♯が付く
    expect(updated[0].events[0].dur).toBe('2');          // 音価は変わらない
  });

  it('ケース2: 音の無い高さをクリックすると、記号付きの音符が置かれる', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false, accidental: 'sharp' });

    // 符頭のX範囲から外れたセル右端＝挿入の経路（#470 の既存テストと同じ位置）
    const hit = noteHit(svg, 2);
    const x = parseFloat(hit.getAttribute('x')!);
    const w = parseFloat(hit.getAttribute('width')!);
    fireEvent.click(hit, { clientX: x + w - 3, clientY: clickYForLine(hit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(4);
    expect(updated[0].events[3].keys).toEqual(['b#/4']);
  });

  it('ケース8: 微分音でも「符頭で付与・空きで入力」が成り立つ', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    // microtone 属性は段1a で Tool 型へ入る（設計メモ §3-1）。それまでは型を通すためにキャストする
    const microtoneTool = { duration: '4', isRest: false, microtone: 'quarterSharp' } as unknown as Tool;
    const { svg, onChange } = renderCanvas(data, microtoneTool);

    // 付与: 符頭をクリック
    const hit = noteHit(svg, 0);
    const noteLeft = parseFloat(hit.getAttribute('data-note-left')!);
    const noteRight = parseFloat(hit.getAttribute('data-note-right')!);
    fireEvent.click(hit, { clientX: (noteLeft + noteRight) / 2, clientY: clickYForLine(hit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const afterApply = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(afterApply[0].events).toHaveLength(3);
    expect(afterApply[0].events[0].microtones).toEqual([{ keyIndex: 0, type: 'quarterSharp' }]);

    // 入力: 符頭から外れたセル右端をクリック
    const lastHit = noteHit(svg, 2);
    const x = parseFloat(lastHit.getAttribute('x')!);
    const w = parseFloat(lastHit.getAttribute('width')!);
    fireEvent.click(lastHit, { clientX: x + w - 3, clientY: clickYForLine(lastHit, 2) });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)![0] as MeasureData[];
      expect(latest[0].events.length).toBeGreaterThan(3);
    });
    const afterInsert = onChange.mock.calls.at(-1)![0] as MeasureData[];
    const inserted = afterInsert[0].events.at(-1)!;
    expect(inserted.microtones).toEqual([{ keyIndex: 0, type: 'quarterSharp' }]);
  });

  it('ケース11: 先頭段の調号領域クリックは調号変更のまま（音符が生えない）', async () => {
    const data: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['b/4'] }] }];
    const onKeySignatureChange = vi.fn();
    const onChange = vi.fn();
    const rendered = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false, accidental: 'sharp' }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        keySignature="C"
        onKeySignatureChange={onKeySignatureChange}
      />
    );
    const svg = rendered.container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);

    // 調号領域は先頭段の左端（音部記号のすぐ右）。デバッグ矩形が出ているのでその中心を突く
    const zone = svg.querySelector('rect.vf-key-signature-debug') as SVGRectElement | null;
    expect(zone, '調号領域のヒット矩形').toBeTruthy();
    const zx = parseFloat(zone!.getAttribute('x')!);
    const zw = parseFloat(zone!.getAttribute('width')!);
    const zy = parseFloat(zone!.getAttribute('y')!);
    const zh = parseFloat(zone!.getAttribute('height')!);
    fireEvent.click(zone!.previousElementSibling ?? svg, { clientX: zx + zw / 2, clientY: zy + zh / 2 });

    await waitFor(() => { expect(onKeySignatureChange).toHaveBeenCalledWith('G', 0); });
    expect(onChange).not.toHaveBeenCalled(); // 譜面データは変わらない＝音符が生えない
  });

  it('ケース12: 休符本体をクリックすると、記号付きの音符へ置換される', async () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false, accidental: 'flat' });

    const restHit = noteHit(svg, 1);
    const restNote = svg.querySelector('.vf-stavenote[data-note="1"]') as SVGGElement | null;
    const rect = restNote?.getBoundingClientRect();
    const centerX = rect && rect.width > 0
      ? rect.left + rect.width / 2
      : parseFloat(restHit.getAttribute('x')!) + parseFloat(restHit.getAttribute('width')!) / 2;
    fireEvent.click(restHit, { clientX: centerX, clientY: clickYForLine(restHit, 2) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events[1].isRest).toBe(false);
    expect(updated[0].events[1].keys).toEqual(['bb/4']);
  });

  it('ケース13: 既存音符の別の高さ（符頭X範囲内）をクリックすると、記号付きで和音に足される', async () => {
    const data: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['b/4'] }] }];
    const { svg, onChange } = renderCanvas(data, { duration: '4', isRest: false, accidental: 'sharp' });

    const hit = noteHit(svg, 0);
    const noteLeft = parseFloat(hit.getAttribute('data-note-left')!);
    const noteRight = parseFloat(hit.getAttribute('data-note-right')!);
    // 既存の音（ライン2 = b/4）とは違う高さ（ライン0 = f/5）を符頭X範囲内でクリック
    fireEvent.click(hit, { clientX: (noteLeft + noteRight) / 2, clientY: clickYForLine(hit, 0) });

    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(1);
    expect(updated[0].events[0].keys).toContain('f#/5');
  });
});
