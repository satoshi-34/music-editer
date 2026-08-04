// Issue #175: 非アクティブ声部の淡色表示がビーム（連桁＝8分音符などを繋ぐ横棒）に
// 効かず、黒いまま残っていた不具合の回帰テスト。
//
// 音符本体（符頭・符幹）は StaveNote.setStyle() で薄いグレーにしていたが、
// VexFlow の Beam.draw() / Tuplet.draw() は setStyle() したスタイルを自分では
// 適用しない（内部で Element.applyStyle を呼ばない）ため、ビームと連符の
// 括弧・数字だけが黒く残り、「今どちらの声部を編集しているか」が分かりにくかった。
//
// 修正では drawWithStyle()（VexFlow が ctx.save() → applyStyle() → draw() →
// ctx.restore() を行ってくれるメソッド）へ切り替えている。
// その結果、ビーム／連符を包む <g class="vf-beam"> / <g class="vf-tuplet"> に
// fill・stroke 属性が付くので、ここではその属性を検査する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

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
// PianoSystemCanvas 内の INACTIVE_VOICE_COLOR と同じ値。
const INACTIVE_VOICE_COLOR = '#9ca3af';

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

// ビームのグループ要素は描画順に並ぶ（声部1 → 声部2）。
function beamGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-beam')) as SVGGElement[];
}

function tupletGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-tuplet')) as SVGGElement[];
}

// 声部1・声部2それぞれに「8分音符2つ（＝ビーム1本）＋4分音符2つ」を持つ小節。
// 両声部にビームがあるので、「アクティブ側は黒・非アクティブ側だけグレー」を
// 1回の描画で同時に確かめられる。
function makeTwoVoiceBeamedMeasure(): MeasureData[] {
  const voice1 = [
    { dur: '8' as const, isRest: false, keys: ['c/5'] },
    { dur: '8' as const, isRest: false, keys: ['d/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
  ];
  const voice2 = [
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '8' as const, isRest: false, keys: ['e/4'] },
    { dur: '8' as const, isRest: false, keys: ['f/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
  ];
  return [{
    events: voice1,
    voices: [
      { id: 'voice-1', events: voice1 },
      { id: 'voice-2', stemDirection: 'down', events: voice2 },
    ],
  }];
}

// 声部1に3連符（8分×3＝1拍）を持ち、声部2は4分音符だけの小節。
// 連符の括弧・数字の色を確かめるために使う。
// 連符を声部1（voiceIndex=0）側に置いているのは、追加声部では末尾の休符が
// GhostNote（符幹なし）で描かれる仕様があり、連符の描画自体が別途壊れる
// 既知の問題（Issue #168 の調査コメント参照）を巻き込まないため。
function makeTupletInVoice1Measure(): MeasureData[] {
  const tuplet = { id: 'tuplet-1', numNotes: 3, notesOccupied: 2 };
  const voice1 = [
    { dur: '8' as const, isRest: false, keys: ['c/5'], tuplet },
    { dur: '8' as const, isRest: false, keys: ['d/5'], tuplet },
    { dur: '8' as const, isRest: false, keys: ['e/5'], tuplet },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
    { dur: '4' as const, isRest: false, keys: ['c/5'] },
  ];
  const voice2 = [
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
    { dur: '4' as const, isRest: false, keys: ['e/4'] },
  ];
  return [{
    events: voice1,
    voices: [
      { id: 'voice-1', events: voice1 },
      { id: 'voice-2', stemDirection: 'down', events: voice2 },
    ],
  }];
}

describe('PianoSystemCanvas 非アクティブ声部のビーム・連符の淡色表示（Issue #175）', () => {
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

  function renderScore(data: MeasureData[], activeVoiceIndex?: number) {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        {...(activeVoiceIndex !== undefined ? { activeVoiceIndex } : {})}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg };
  }

  it('声部2がアクティブなとき、声部1のビームだけがグレーになる', () => {
    const { svg } = renderScore(makeTwoVoiceBeamedMeasure(), 1);

    const beams = beamGroups(svg);
    expect(beams.length).toBe(2);

    // 描画順は声部1 → 声部2。非アクティブな声部1のビームだけが淡色。
    expect(beams[0].getAttribute('fill')).toBe(INACTIVE_VOICE_COLOR);
    expect(beams[0].getAttribute('stroke')).toBe(INACTIVE_VOICE_COLOR);
    // アクティブな声部2のビームは従来どおり（色指定なし＝黒のまま）。
    expect(beams[1].getAttribute('fill')).not.toBe(INACTIVE_VOICE_COLOR);
    expect(beams[1].getAttribute('stroke')).not.toBe(INACTIVE_VOICE_COLOR);
  });

  it('声部1がアクティブなとき、声部2のビームだけがグレーになる（逆方向も同じ）', () => {
    const { svg } = renderScore(makeTwoVoiceBeamedMeasure(), 0);

    const beams = beamGroups(svg);
    expect(beams.length).toBe(2);

    expect(beams[0].getAttribute('fill')).not.toBe(INACTIVE_VOICE_COLOR);
    expect(beams[0].getAttribute('stroke')).not.toBe(INACTIVE_VOICE_COLOR);
    expect(beams[1].getAttribute('fill')).toBe(INACTIVE_VOICE_COLOR);
    expect(beams[1].getAttribute('stroke')).toBe(INACTIVE_VOICE_COLOR);
  });

  it('単声部の小節ではビームの色が従来どおり（色指定なし＝黒）', () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '8', isRest: false, keys: ['c/5'] },
        { dur: '8', isRest: false, keys: ['d/5'] },
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['c/5'] },
        { dur: '4', isRest: false, keys: ['c/5'] },
      ],
    }];
    // 声部トグルの無い画面（activeVoiceIndex を渡さない）でも同じであることを見る。
    const { svg } = renderScore(data);

    const beams = beamGroups(svg);
    expect(beams.length).toBe(1);
    expect(beams[0].getAttribute('fill')).toBeNull();
    expect(beams[0].getAttribute('stroke')).toBeNull();
  });

  it('非アクティブ声部の連符（括弧・数字）もグレーになる', () => {
    const { svg } = renderScore(makeTupletInVoice1Measure(), 1);

    const tuplets = tupletGroups(svg);
    expect(tuplets.length).toBe(1);
    expect(tuplets[0].getAttribute('fill')).toBe(INACTIVE_VOICE_COLOR);
    expect(tuplets[0].getAttribute('stroke')).toBe(INACTIVE_VOICE_COLOR);
  });

  it('アクティブ声部の連符は従来どおり色指定なし（黒）のまま', () => {
    const { svg } = renderScore(makeTupletInVoice1Measure(), 0);

    const tuplets = tupletGroups(svg);
    expect(tuplets.length).toBe(1);
    expect(tuplets[0].getAttribute('fill')).toBeNull();
    expect(tuplets[0].getAttribute('stroke')).toBeNull();
  });

  it('淡色化は g 要素の fill / stroke 属性で行われる（印刷CSSが黒へ戻せる形になっている）', () => {
    // App.css の @media print には
    //   .print-page svg g[fill]:not([fill="none"]) { fill: var(--print-ink) !important; }
    //   .print-page svg g[stroke]:not([stroke="none"]) { stroke: var(--print-ink) !important; }
    // というルールがあり、属性で色が付いていれば印刷・PDFでは黒に戻る。
    // インラインの style 属性で色を付けてしまうと !important のこのルールでも
    // 上書きできない場合があるため、「style ではなく属性」であることを固定する。
    const { svg } = renderScore(makeTwoVoiceBeamedMeasure(), 1);

    const inactiveBeam = beamGroups(svg)[0];
    expect(inactiveBeam.getAttribute('fill')).toBe(INACTIVE_VOICE_COLOR);
    expect(inactiveBeam.getAttribute('stroke')).toBe(INACTIVE_VOICE_COLOR);
    expect(inactiveBeam.getAttribute('style')).toBeNull();
    // ビーム本体の path 自体には色が付いておらず、上の g から継承している
    // （＝印刷CSSの g ルール1本で黒へ戻せる）。
    const beamPath = inactiveBeam.querySelector('path:not([fill="none"])') as SVGPathElement;
    expect(beamPath).toBeTruthy();
    expect(beamPath.getAttribute('fill')).toBeNull();
  });
});
