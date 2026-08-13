// Issue #239: 2声部が共存する小節では、声部2の符幹（stem＝符頭から伸びる棒）は
// 音高によらず常に下向きでなければならない。極端に低い音の連符グループだけが
// 上向きで描かれ、1つの声部の中で向きが混在して見える、という報告があった。
//
// この向きの固定は2段構えになっている。
//  1. `resolveVoiceStemDirections`（voiceMeasureUtils）が声部1=up / 声部2=down を決め、
//     `makeVFNote` が音符1つずつに `setStemDirection` する
//  2. `Beam.generateBeams` に `maintainStemDirections` を渡し、ビーム（連桁）を
//     組むときに VexFlow の自動判定へ戻されないようにする
//
// 2 が効いていないと、VexFlow は「音符の平均の高さ」で束ごとに向きを決め直す。
// その自動判定は五線の中央より低い音を上向きにするため、極端な低音の連符だけが
// 上向きになる＝報告どおりの見え方になる。ここでは実際に描画された符幹の
// 座標から向きを読み取り、束ごとではなく声部ごとにそろうことを固定する。
//
// なお `voiceMeasureUtils.test.ts` は 1 の純ロジックだけを見ているため、
// 連符・ビームを通した描画結果まで確認するテストはこちらに置く。
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

/**
 * 描画された符幹の向きを、左から右の順（＝譜面の時間順）に取り出す。
 *
 * VexFlow は符幹を `<g class="vf-stem"><path d="M x y1 L x y2"/></g>` で描く。
 * SVG の y は下へ行くほど大きいので、終点の y が始点より小さければ上向きになる。
 * 連桁でつながった音符の符幹はビームの `<g>` の中へ移動するが、`querySelectorAll`
 * は入れ子も拾うため、束になっていてもいなくても同じように数えられる。
 * DOM の並び順は束ごとにまとまっていて時間順ではないので、x 座標で並べ直す。
 */
function stemDirectionsLeftToRight(svg: SVGSVGElement): Array<'up' | 'down'> {
  return Array.from(svg.querySelectorAll('g.vf-stem path'))
    .map((path) => {
      const d = path.getAttribute('d') ?? '';
      const matched = d.match(/^M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)$/);
      if (!matched) {
        throw new Error(`符幹のパスを解釈できませんでした: ${d}`);
      }
      return {
        x: Number(matched[1]),
        direction: Number(matched[4]) < Number(matched[2]) ? ('up' as const) : ('down' as const),
      };
    })
    .sort((a, b) => a.x - b.x)
    .map((stem) => stem.direction);
}

/** 同じ id を共有する3連符（音符のみ・休符なし）を作る */
function tripletNotes(id: string, keys: string[]): NoteEvent[] {
  return keys.map((key) => ({
    dur: '8',
    isRest: false,
    keys: [key],
    tuplet: { id, numNotes: 3, notesOccupied: 2 },
  }));
}

const quarter = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });
/** 声部1側を「符幹を持たないもの」で埋めるための4分休符 */
const quarterRest = (): NoteEvent => ({ dur: '4', isRest: true, keys: ['b/4'] });

// Issue 本文の実例そのもの。ト音記号の五線から大きく下へ外れた、加線が何本も要る音域。
// VexFlow の自動判定（音符の平均の高さで決める）に任せると上向きになる。
const EXTREME_LOW = ['b/1', 'd#/2', 'g#/2'];
// 逆に、自動判定なら下向きになる極端な高音域。
const EXTREME_HIGH = ['c/7', 'e/7', 'g/7'];

describe('PianoSystemCanvas 2声部の符幹の向きは音高で揺れない（Issue #239）', () => {
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
    return svg;
  }

  /**
   * 声部1を休符だけにした2声部小節を作る。
   * 休符には符幹が無いので、描画される符幹はすべて声部2のものになり、
   * 「どの符幹がどちらの声部か」を座標から推測せずに済む。
   */
  function measureWithVoice2Only(voice2: NoteEvent[]): MeasureData {
    const voice1 = [quarterRest(), quarterRest(), quarterRest(), quarterRest()];
    return {
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    };
  }

  it('声部2の極端な低音の連符でも符幹は下向きのまま', () => {
    // 4/4 の前半2拍を極端な低音の三連符2組で埋める。
    // 向きの固定が効かないと、この音域は VexFlow の自動判定で上向きになる。
    const svg = renderScore([measureWithVoice2Only([
      ...tripletNotes('low-1', EXTREME_LOW),
      ...tripletNotes('low-2', EXTREME_LOW),
      quarter('e/4'),
      quarter('e/4'),
    ])], 1);

    expect(stemDirectionsLeftToRight(svg)).toEqual([
      'down', 'down', 'down',
      'down', 'down', 'down',
      'down', 'down',
    ]);
  });

  it('声部2の極端な高音の連符でも符幹は下向きのまま', () => {
    const svg = renderScore([measureWithVoice2Only([
      ...tripletNotes('high-1', EXTREME_HIGH),
      ...tripletNotes('high-2', EXTREME_HIGH),
      quarter('e/4'),
      quarter('e/4'),
    ])], 1);

    expect(stemDirectionsLeftToRight(svg)).toEqual([
      'down', 'down', 'down',
      'down', 'down', 'down',
      'down', 'down',
    ]);
  });

  it('声部2の中で音域が大きく動いても、グループごとに向きが変わらない', () => {
    // Issue 本文の「極端な低音のグループだけ上向き、他のグループは下向き」を
    // そのまま並べた形。1小節の中で向きが混在しないことを固定する。
    const svg = renderScore([measureWithVoice2Only([
      ...tripletNotes('low', EXTREME_LOW),
      ...tripletNotes('mid', ['g#/3', 'c#/4', 'e/4']),
      ...tripletNotes('high', EXTREME_HIGH),
      ...tripletNotes('back-to-low', EXTREME_LOW),
    ])], 1);

    expect(stemDirectionsLeftToRight(svg)).toEqual(Array(12).fill('down'));
  });

  it('声部1は極端な高音の連符でも上向きのまま（自動判定なら下向きになる音域）', () => {
    // 声部2を休符だけにして、描画される符幹をすべて声部1のものにする。
    const voice1: NoteEvent[] = [
      ...tripletNotes('high-1', EXTREME_HIGH),
      ...tripletNotes('high-2', EXTREME_HIGH),
      quarter('c/7'),
      quarter('c/7'),
    ];
    const voice2 = [quarterRest(), quarterRest(), quarterRest(), quarterRest()];
    const svg = renderScore([{
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    }], 0);

    expect(stemDirectionsLeftToRight(svg)).toEqual([
      'up', 'up', 'up',
      'up', 'up', 'up',
      'up', 'up',
    ]);
  });

  it('2声部が並ぶ小節では、声部1が上向き・声部2が下向きで同時に成り立つ', () => {
    // 声部1の4分音符と声部2の三連符が同じ拍に重なる、実際の使い方に近い形。
    // 左から順に「声部1の4分音符 → 声部2の三連符3つ」が拍ごとに繰り返される。
    const voice1 = [quarter('c/5'), quarter('c/5'), quarter('c/5'), quarter('c/5')];
    const voice2 = [
      ...tripletNotes('low', EXTREME_LOW),
      ...tripletNotes('mid', ['g#/3', 'c#/4', 'e/4']),
      quarter('e/4'),
      quarter('e/4'),
    ];
    const svg = renderScore([{
      events: voice1,
      voices: [
        { id: 'voice-1', events: voice1 },
        { id: 'voice-2', stemDirection: 'down', events: voice2 },
      ],
    }], 1);

    expect(stemDirectionsLeftToRight(svg)).toEqual([
      // 1拍目: 声部1の4分音符 + 声部2の三連符（極端な低音）
      'up', 'down', 'down', 'down',
      // 2拍目: 声部1の4分音符 + 声部2の三連符（中音域）
      'up', 'down', 'down', 'down',
      // 3・4拍目: 声部1・声部2とも4分音符が1つずつ
      'up', 'down',
      'up', 'down',
    ]);
  });

  it('声部が1つだけの小節は、従来どおり VexFlow の自動判定に任せる', () => {
    // 単声部（声部トグルの無い譜種を含む）では向きを固定しない。
    // 極端な低音は自動判定で上向きになるのが従来の挙動で、ここを変えていないことを固定する。
    const svg = renderScore([{
      events: [
        ...tripletNotes('low', EXTREME_LOW),
        quarter('c/5'),
        quarter('c/5'),
        quarter('c/5'),
      ],
    }]);

    const directions = stemDirectionsLeftToRight(svg);
    expect(directions.slice(0, 3)).toEqual(['up', 'up', 'up']);
    // 五線の上寄りの c/5 は自動判定で下向き。声部の固定が単声部へ漏れていないことの裏付け。
    expect(directions.slice(3)).toEqual(['down', 'down', 'down']);
  });
});
