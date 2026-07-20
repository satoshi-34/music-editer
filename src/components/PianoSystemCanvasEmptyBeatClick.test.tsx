// ユーザーテストで発見されたバグの再現テスト:
// 単旋律モードで小節に3音入れた後、4拍目の空き領域をクリックしても
// 音符が追加されず、最後の音符の「選択」になってしまう。
//
// 原因: 最後の音符の透明ヒット領域（rect.vf-note-hit）は小節右端まで広がっており、
// クリックYが既存音符と同じ五線ライン（音高）だと、X位置がどれだけ音符から
// 離れていても「和音内の既存音を個別選択」の分岐（findKeyIndexAtLine）に入り、
// 挿入（doInsert）へ到達しなかった。
// 段ごとの小節数オーバーライドで小節幅が広がると空き領域が大きくなり、
// この誤判定を確実に踏むようになる。
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

// jsdom はレイアウトを持たないため、そのままでは描画幅（parentElement.clientWidth）が
// 0 になり、小節ジオメトリが縮退してクリック座標のテストができない。
// clientWidth を固定値にスタブして、実ブラウザに近い横幅で描画させる。
const TEST_CONTAINER_WIDTH = 700;

// クリック座標→五線座標の変換（clientToGroup）は svg.getBoundingClientRect() と
// svg.width/height.baseVal に依存する。jsdom では両方とも実寸を返さないので、
// 描画幅と同じ寸法を返すようモックし「クライアント座標 = SVG内座標」にする。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as any;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

describe('PianoSystemCanvas 空き拍領域のクリック', () => {
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
      delete (HTMLElement.prototype as any).clientWidth;
    }
  });

  it('最後の音符と同じ音高の高さで空き拍領域をクリックしたら選択ではなく音符追加になる', async () => {
    // 4/4 の小節に4分音符3つ（4拍目が空き）。すべて b/4（中央線）にして、
    // 「同じ高さの空き領域クリック」で個別選択に吸われる問題を再現する。
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);

    // 最後の音符（data-note="2"）のヒット領域は小節右端まで広がっている
    const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
    expect(lastHit).toBeTruthy();

    const x = parseFloat(lastHit.getAttribute('x')!);
    const w = parseFloat(lastHit.getAttribute('width')!);
    const y = parseFloat(lastHit.getAttribute('y')!);
    const h = parseFloat(lastHit.getAttribute('height')!);

    // ヒット領域のYは五線ライン -3〜7（PianoSystemCanvas の CHORD_LEDGER_TOP/BOT）を
    // カバーしているので、そこから b/4（treble の中央線 = ライン2）のY座標を逆算する
    const lineSpacing = h / 10; // (7 - (-3)) = 10 ライン分
    const clickY = y + (2 - (-3)) * lineSpacing;
    // 小節右端ぎりぎり（符頭から十分離れた空き拍領域）をクリックする
    const clickX = x + w - 3;

    fireEvent.click(lastHit, { clientX: clickX, clientY: clickY });

    // 「選択」ではなく4つ目の音符が追加されること
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(updated[0].events).toHaveLength(4);
    // クリック位置（4拍目・b/4 の高さ）どおり「末尾に b/4」が入ること。
    // 座標変換が壊れて (0,0) 扱いになると先頭挿入・別音高になるので、
    // ここまで検証して初めて「空き拍クリック→追加」の再現テストとして意味を持つ。
    expect(updated[0].events[3].isRest).toBe(false);
    expect(updated[0].events[3].keys).toEqual(['b/4']);
  });

  it('符頭のすぐ近くを同じ音高でクリックした場合は従来どおり個別選択になる（音符は増えない）', () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    mockSvgLayout(svg);

    // 真ん中の音符（data-note="1"）のヒット領域は左右とも隣の音符との中間点で
    // 区切られた狭い範囲なので、その中央 ≒ 符頭付近。ここを同じ音高でクリックする。
    const midHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
    const y = parseFloat(midHit.getAttribute('y')!);
    const h = parseFloat(midHit.getAttribute('height')!);
    const lineSpacing = h / 10;
    const clickY = y + (2 - (-3)) * lineSpacing;
    const x = parseFloat(midHit.getAttribute('x')!);
    const w = parseFloat(midHit.getAttribute('width')!);
    fireEvent.click(midHit, { clientX: x + w / 2, clientY: clickY });

    // 個別選択なので音符数は変わらない（onChange が呼ばれても events は3つのまま）
    if (onChange.mock.calls.length > 0) {
      const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
      expect(updated[0].events).toHaveLength(3);
    }
  });
});
