// Issue #217: 連続する三連符のビーム（連桁＝8分音符などを繋ぐ横棒）が
// 拍単位（2+2+2）で組まれ、連符単位（3+3）にならなかった不具合の回帰テスト。
//
// 原因は描画順序で、`Beam.generateBeams` を `createVexFlowTuplets` より先に
// 呼んでいたこと。ビーム生成は音符の tick（拍の内部単位）を足し上げて拍の
// 区切りを決めるが、連符の 2/3 倍率を音符へ掛けるのは Tuplet の生成時なので、
// 順序が逆だと 8分3連が「素の8分音符」として2個ずつ束ねられてしまう。
//
// ここでは実際に描画された `<g class="vf-beam">` の個数で束の分かれ方を固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

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

function beamGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-beam')) as SVGGElement[];
}

// VexFlow は「連桁でつないだ音符の符幹（g.vf-stem）」をビームの g の中へ移して描く。
// そのため符幹の数を数えれば「1つの束が何個の音符をまとめたか」がそのまま分かる。
// 束の個数だけでは、3個が 2+1 に割れたケース（余りの1個は束にならず消える）を
// 見逃してしまうため、必ずこちらで中身まで確認する。
function beamedNoteCounts(svg: SVGSVGElement): number[] {
  return beamGroups(svg).map(beam => beam.querySelectorAll('g.vf-stem').length);
}

function tupletGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.querySelectorAll('g.vf-tuplet')) as SVGGElement[];
}

/** 同じ id を共有する連符グループ（音符のみ・休符なし）を作る */
function tupletNotes(
  id: string,
  keys: string[],
  dur: NoteEvent['dur'],
  numNotes: number,
  notesOccupied: number
): NoteEvent[] {
  return keys.map((key) => ({
    dur,
    isRest: false,
    keys: [key],
    tuplet: { id, numNotes, notesOccupied },
  }));
}

const quarter = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });

describe('PianoSystemCanvas 連符のビームは連符単位で束ねる（Issue #217）', () => {
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
    return { container, svg };
  }

  it('8分三連符を2組続けると、ビームが 3+3 の2組になる（拍単位の 2+2+2 に割れない）', () => {
    // 4/4 の前半2拍を8分三連符2組、後半2拍を4分音符で埋める。
    const events: NoteEvent[] = [
      ...tupletNotes('triplet-1', ['c/5', 'd/5', 'e/5'], '8', 3, 2),
      ...tupletNotes('triplet-2', ['f/5', 'e/5', 'd/5'], '8', 3, 2),
      quarter('c/5'),
      quarter('c/5'),
    ];
    const { svg } = renderScore([{ events }]);

    // 修正前はここが [2, 2, 2]（拍単位）になっていた。
    expect(beamedNoteCounts(svg)).toEqual([3, 3]);
    // 「3」の数字（連符の表示）も連符グループの数どおり2つ。
    expect(tupletGroups(svg).length).toBe(2);
  });

  it('単声部（声部トグル無し）でも三連符1組が3個で束なる', () => {
    const events: NoteEvent[] = [
      ...tupletNotes('triplet-1', ['c/5', 'd/5', 'e/5'], '8', 3, 2),
      quarter('c/5'),
      quarter('c/5'),
      quarter('c/5'),
    ];
    const { svg } = renderScore([{ events }]);

    // 修正前は [2]（3個目が束から外れて単独になる）だった。
    expect(beamedNoteCounts(svg)).toEqual([3]);
    expect(tupletGroups(svg).length).toBe(1);
  });

  it('連符ではない8分音符のビームは従来どおり拍単位（2+2）のまま', () => {
    const eighth = (key: string): NoteEvent => ({ dur: '8', isRest: false, keys: [key] });
    const events: NoteEvent[] = [
      eighth('c/5'), eighth('d/5'), eighth('e/5'), eighth('f/5'),
      quarter('c/5'),
      quarter('c/5'),
    ];
    const { svg } = renderScore([{ events }]);

    // 8分音符4個 → 拍ごとに2個ずつで2束（連符対応で拍単位の束が壊れていないこと）。
    expect(beamedNoteCounts(svg)).toEqual([2, 2]);
    expect(tupletGroups(svg).length).toBe(0);
  });

  it('声部2の三連符も連符単位で束なる（声部1の束と合わせて数が合う）', () => {
    const voice1: NoteEvent[] = [
      quarter('c/5'), quarter('c/5'), quarter('c/5'), quarter('c/5'),
    ];
    const voice2: NoteEvent[] = [
      ...tupletNotes('triplet-v2-1', ['e/4', 'f/4', 'g/4'], '8', 3, 2),
      ...tupletNotes('triplet-v2-2', ['g/4', 'f/4', 'e/4'], '8', 3, 2),
      quarter('e/4'),
      quarter('e/4'),
    ];
    const { svg } = renderScore([{
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    }], 1);

    // 声部1は4分音符だけでビーム無し。声部2の三連符2組ぶんだけが束になる。
    expect(beamedNoteCounts(svg)).toEqual([3, 3]);
    expect(tupletGroups(svg).length).toBe(2);
  });

  it('5連符（16分×5）も連符単位で1つの束になる', () => {
    const events: NoteEvent[] = [
      ...tupletNotes('quint-1', ['c/5', 'd/5', 'e/5', 'f/5', 'g/5'], '16', 5, 4),
      quarter('c/5'),
      quarter('c/5'),
      quarter('c/5'),
    ];
    const { svg } = renderScore([{ events }]);

    // 素の16分音符として数えると 4+1 に割れる（修正前は [4]）。連符単位なら5個で1束。
    expect(beamedNoteCounts(svg)).toEqual([5]);
    expect(tupletGroups(svg).length).toBe(1);
  });
});
