// Issue #192（声部2のタイ／スラー 段4）: 浄書品質の回帰テスト。
//
// 段4で決めたのは次の2点（設計メモ `.claude/specs/voice2-arc-support/design.md` §5・§6）。
//   1. 2声部が共存する小節では、弧の向きを音高ではなく声部で決める
//      （声部1＝上向き・声部2＝下向き。符幹の向き固定と同じ発想）
//   2. スラーが避ける音符は自声部のものだけにする（他声部の音符では膨らまない）
//
// ここで固定したいのは「実際に描かれた弧の向き・形」なので、
// SVG の path の d 属性から制御点の位置を読み取って上下を判定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { buildIncomingArcIndex } from '../utils/incomingArcUtils';

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

function arcKey(partIndex: number, voiceIndex: number, fromMeasure: number, fromEvent: number, arcIndex: number) {
  return `p${partIndex}v${voiceIndex}m${fromMeasure}e${fromEvent}a${arcIndex}`;
}

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

/**
 * 弧のパスが上向きか（弧が音符の上側にふくらむか）を判定する。
 * タイは `M x1 y1 Q cpX cpY x2 y2`、スラーは `M x1 y1 C c1x c1y c2x c2y x2 y2` で、
 * どちらも「4番目の数値」が最初の制御点のY座標になっている。
 * SVG のY座標は下ほど大きいので、制御点が始点より小さい＝上へふくらんでいる。
 */
function isUpwardArc(pathEl: Element | null): boolean {
  expect(pathEl).toBeTruthy();
  const d = pathEl!.getAttribute('d') ?? '';
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  expect(nums.length).toBeGreaterThanOrEqual(6);
  const startY = nums[1];
  const controlY = nums[3];
  return controlY < startY;
}

describe('PianoSystemCanvas 弧の向きの既定値と障害物スコープ（Issue #192 段4）', () => {
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
    options?: {
      startMeasureIndex?: number;
      measuresPerSystem?: number;
      incomingArcIndex?: ReturnType<typeof buildIncomingArcIndex>;
    }
  ) {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={options?.measuresPerSystem ?? 1}
        startMeasureIndex={options?.startMeasureIndex ?? 0}
        incomingArcIndex={options?.incomingArcIndex}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={0}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    return { container, svg };
  }

  /**
   * 2声部の小節を作る。
   * @param voice1Slur 声部1の1〜3音目にスラーを張るか
   * @param voice2Slur 声部2の1〜3音目にスラーを張るか
   */
  function twoVoiceMeasure(options: {
    voice1Keys: string[];
    voice2Keys: string[];
    voice1Slur?: boolean;
    voice2Slur?: boolean;
    voice2Flip?: boolean;
  }): MeasureData {
    const slurTo2 = (kind: 'slur' | 'tie', keys: string[], flip?: boolean) => ([{
      kind,
      fromKey: keys[0],
      toKey: keys[2],
      toMeasureIndex: 0,
      toEventIndex: 2,
      ...(flip ? { flipDirection: true } : {}),
    }]);
    const voice1Events = options.voice1Keys.map((k, i) => (
      i === 0 && options.voice1Slur
        ? { ...quarter(k), arcs: slurTo2('slur', options.voice1Keys) }
        : quarter(k)
    ));
    const voice2Events = options.voice2Keys.map((k, i) => (
      i === 0 && options.voice2Slur
        ? { ...quarter(k), arcs: slurTo2('slur', options.voice2Keys, options.voice2Flip) }
        : quarter(k)
    ));
    return {
      events: voice1Events,
      voices: [
        { id: 'voice-1', events: voice1Events },
        { id: 'voice-2', stemDirection: 'down', events: voice2Events },
      ],
    };
  }

  const HIGH_KEYS = ['c/5', 'd/5', 'e/5', 'f/5'];
  const LOW_KEYS = ['e/3', 'f/3', 'g/3', 'a/3'];

  it('受入1: 2声部小節の声部2のスラーは、音高に関係なく既定で下向きになる', () => {
    // 声部2に高い音（本来なら音高判定で上向きになる音域）を置いても下向きになる。
    const { svg } = renderScore([twoVoiceMeasure({
      voice1Keys: HIGH_KEYS,
      voice2Keys: HIGH_KEYS,
      voice2Slur: true,
    })]);

    expect(isUpwardArc(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}"]`))).toBe(false);
  });

  it('受入1: flipDirection（手動反転）は従来どおり効く', () => {
    const { svg } = renderScore([twoVoiceMeasure({
      voice1Keys: HIGH_KEYS,
      voice2Keys: HIGH_KEYS,
      voice2Slur: true,
      voice2Flip: true,
    })]);

    expect(isUpwardArc(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}"]`))).toBe(true);
  });

  it('2声部小節の声部1のスラーは、低い音域でも上向きになる（意図した仕様変更）', () => {
    // 声部1に低い音を置くと、従来（音高判定）は下向きだった。
    // 2声部書法では上声＝上向きが慣行なので、ここが変わるのは意図した変更。
    const { svg } = renderScore([twoVoiceMeasure({
      voice1Keys: LOW_KEYS,
      voice2Keys: LOW_KEYS,
      voice1Slur: true,
    })]);

    expect(isUpwardArc(svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`))).toBe(true);
  });

  it('受入2: 声部を持たない小節では、従来どおり音高で向きが決まる（リグレッション）', () => {
    // 声部トグルの無い譜種（単旋律・四重奏・編成譜）は voices を持たないので、
    // ここと同じ経路を通る。高い音域なら上向き、低い音域なら下向きのまま。
    const singleVoice = (keys: string[]): MeasureData[] => ([{
      events: keys.map((k, i) => (
        i === 0
          ? { ...quarter(k), arcs: [{ kind: 'slur' as const, fromKey: keys[0], toKey: keys[2], toMeasureIndex: 0, toEventIndex: 2 }] }
          : quarter(k)
      )),
    }]);

    const high = renderScore(singleVoice(HIGH_KEYS));
    expect(isUpwardArc(high.svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`))).toBe(true);

    const low = renderScore(singleVoice(LOW_KEYS));
    expect(isUpwardArc(low.svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`))).toBe(false);
  });

  it('受入3: 声部2のスラーの形は、声部1の音高を変えても一切変わらない（障害物は自声部限定）', () => {
    // 声部1に極端に高い音を並べても、声部2のスラーが避けようとして膨らまないこと。
    const makeData = (voice1Keys: string[]): MeasureData[] => ([twoVoiceMeasure({
      voice1Keys,
      voice2Keys: LOW_KEYS,
      voice2Slur: true,
    })]);

    const withHighVoice1 = renderScore(makeData(['c/6', 'd/6', 'e/6', 'f/6']));
    const highD = withHighVoice1.svg
      .querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}"]`)!
      .getAttribute('d');
    expect(highD).toBeTruthy();

    const withLowVoice1 = renderScore(makeData(['c/4', 'd/4', 'e/4', 'f/4']));
    const lowD = withLowVoice1.svg
      .querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}"]`)!
      .getAttribute('d');

    expect(lowD).toBe(highD);
  });

  describe('段またぎ（行またぎ）でも向きが食い違わない', () => {
    // 小節0の声部2から小節1の声部2へ張ったタイ。両方の段で下向きになることを確かめる。
    function crossSystemScore(): MeasureData[] {
      const whole = (key: string) => ({ dur: '1' as const, isRest: false, keys: [key] });
      return [
        {
          events: [whole('c/5')],
          voices: [
            { id: 'voice-1', events: [whole('c/5')] },
            {
              id: 'voice-2',
              stemDirection: 'down' as const,
              events: [{
                ...whole('c/5'),
                // 音高だけなら上向きになる高さにして、声部で向きが決まることを確かめる
                arcs: [{ kind: 'tie' as const, fromKey: 'c/5', toKey: 'c/5', toMeasureIndex: 1, toEventIndex: 0 }],
              }],
            },
          ],
        },
        {
          events: [whole('c/5')],
          voices: [
            { id: 'voice-1', events: [whole('c/5')] },
            { id: 'voice-2', stemDirection: 'down' as const, events: [whole('c/5')] },
          ],
        },
      ];
    }

    it('開始側の段の第1セグメントが下向き', () => {
      const data = crossSystemScore();
      const { svg } = renderScore(data, { startMeasureIndex: 0, measuresPerSystem: 1 });

      expect(isUpwardArc(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}-1"]`))).toBe(false);
    });

    it('終点側の段の第2セグメントも下向き（incomingArcIndex 経由でも同じ判定になる）', () => {
      const data = crossSystemScore();
      const { svg } = renderScore(data, {
        startMeasureIndex: 1,
        measuresPerSystem: 1,
        incomingArcIndex: buildIncomingArcIndex([data]),
      });

      expect(isUpwardArc(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}-2"]`))).toBe(false);
    });
  });
});
