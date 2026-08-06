// Issue #186（声部2のタイ／スラー 段1）: 描画収集の声部対応の回帰テスト。
//
// これまで弧（タイ／スラー）と松葉の描画収集は measure.events（＝声部1）だけを走査していたため、
// 声部2の events に arcs があってもまったく描かれなかった。段1では「描けるようにする」ところまでを扱い、
// 入力・選択・ドラッグ編集の解禁は段3で行う（設計メモ `.claude/specs/voice2-arc-support/design.md` §3・§12）。
//
// ここで機械的に固定したいのは次の4点:
//   1. 声部2の events に持たせた弧が描画される（声部1の弧と取り違えない）
//   2. 段をまたぐ声部2の弧が、開始側の段と終点側の段の両方にセグメントを描く
//   3. 声部1だけの譜面の描画・当たり判定が従来のまま（リグレッション）
//   4. 編集していない声部の弧は掴めない（当たり判定を作らない）
//      ※ 段1では「声部2は常に掴めない」だったが、段3（Issue #190）で
//        「アクティブでない声部の弧は掴めない」へ意味が変わっている
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

// 弧の同定キー。PianoSystemCanvas の arcKeyP() が発行する形式に合わせる
// （p=パート / v=声部 / m=開始小節 / e=開始イベント / a=何本目の弧）。
function arcKey(partIndex: number, voiceIndex: number, fromMeasure: number, fromEvent: number, arcIndex: number) {
  return `p${partIndex}v${voiceIndex}m${fromMeasure}e${fromEvent}a${arcIndex}`;
}

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

describe('PianoSystemCanvas 声部2の弧の描画収集（Issue #186 段1）', () => {
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

  // 声部1（上声）＝4分音符4つ、声部2（下声）＝4分音符4つ。
  // 声部2の1つ目と2つ目の音符をタイで結んだ状態を手で用意する。
  function twoVoiceMeasureWithVoice2Tie(): MeasureData {
    return {
      events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')],
      voices: [
        { id: 'voice-1', events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            {
              ...quarter('e/3'),
              arcs: [{ kind: 'tie', fromKey: 'e/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 1 }],
            },
            quarter('e/3'),
            quarter('g/3'),
            quarter('g/3'),
          ],
        },
      ],
    };
  }

  it('声部2の events に持たせた弧が描画される（声部1側には弧が生えない）', () => {
    const { svg } = renderScore([twoVoiceMeasureWithVoice2Tie()]);

    // 声部2（v1）の弧だけが描かれている。
    expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}"]`)).toBeTruthy();
    expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`)).toBeNull();
    expect(svg.querySelectorAll('path[data-arc-key]')).toHaveLength(1);
  });

  it('非アクティブ声部（ここでは声部2）の弧は掴めない（当たり判定を作らない）', () => {
    // ここは activeVoiceIndex=0（声部1を編集中）で描画している。
    // 段1では「保存先が声部1直書きだから掴ませない」という理由だったが、
    // 保存先を声部にそろえた段3（Issue #190）以降は「編集していない声部の弧は掴ませない」
    // （音符の当たり判定をアクティブ声部にしか作らない既存方針と同じ）という理由に変わった。
    // 声部2をアクティブにすれば掴めることは PianoSystemCanvasVoice2ArcEditing.test.tsx で固定する。
    const { svg } = renderScore([twoVoiceMeasureWithVoice2Tie()]);

    expect(svg.querySelector('path[data-arc-key-hit]')).toBeNull();
  });

  it('声部1だけの譜面では、従来どおり弧が描かれ当たり判定も付く（リグレッション）', () => {
    const data: MeasureData[] = [{
      events: [
        {
          ...quarter('c/5'),
          arcs: [{ kind: 'slur', fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }],
        },
        quarter('d/5'),
        quarter('e/5'),
        quarter('f/5'),
      ],
    }];
    const { svg } = renderScore(data);

    expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`)).toBeTruthy();
    expect(svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 0, 0, 0, 0)}"]`)).toBeTruthy();
  });

  describe('段またぎ（行またぎ）', () => {
    // 小節0の声部2から、小節1の声部2へ張られたタイ。
    function crossSystemScore(): MeasureData[] {
      const voice2First = {
        id: 'voice-2',
        stemDirection: 'down' as const,
        events: [
          {
            dur: '1' as const,
            isRest: false,
            keys: ['e/3'],
            arcs: [{ kind: 'tie' as const, fromKey: 'e/3', toKey: 'e/3', toMeasureIndex: 1, toEventIndex: 0 }],
          },
        ],
      };
      return [
        {
          events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')],
          voices: [
            { id: 'voice-1', events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')] },
            voice2First,
          ],
        },
        {
          events: [quarter('g/5'), quarter('a/5'), quarter('b/5'), quarter('c/6')],
          voices: [
            { id: 'voice-1', events: [quarter('g/5'), quarter('a/5'), quarter('b/5'), quarter('c/6')] },
            { id: 'voice-2', stemDirection: 'down', events: [{ dur: '1', isRest: false, keys: ['e/3'] }] },
          ],
        },
      ];
    }

    it('開始側の段には第1セグメントが描かれる', () => {
      const data = crossSystemScore();
      const { svg } = renderScore(data, { startMeasureIndex: 0, measuresPerSystem: 1 });

      expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}-1"]`)).toBeTruthy();
    });

    it('終点側の段にも第2セグメントが描かれる（buildIncomingArcIndex が声部2を拾う）', () => {
      const data = crossSystemScore();
      // 終点だけがこの段にある状態。開始音符は別Canvasなので、
      // incomingArcIndex（全声部走査）から逆引きできないと第2セグメントが出ない。
      const { svg } = renderScore(data, {
        startMeasureIndex: 1,
        measuresPerSystem: 1,
        incomingArcIndex: buildIncomingArcIndex([data]),
      });

      expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}-2"]`)).toBeTruthy();
    });
  });

  it('表示専用のパディング休符は弧の終点にならない（位置マップへ入れない）', () => {
    // 声部2は2拍ぶんしか入力されていないので、表示用に末尾へ休符が補完される。
    // その補完分（インデックス2）を終点に指す弧は「終点が見つからない」扱いになり、
    // 完全な弧ではなく段境界用の第1セグメントだけが描かれる。
    // ここが崩れると、見た目だけの休符に弧が繋がってしまう。
    const data: MeasureData[] = [{
      events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')],
      voices: [
        { id: 'voice-1', events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')] },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            {
              ...quarter('e/3'),
              arcs: [{ kind: 'slur', fromKey: 'e/3', toKey: 'e/3', toMeasureIndex: 0, toEventIndex: 2 }],
            },
            quarter('e/3'),
          ],
        },
      ],
    }];
    const { svg } = renderScore(data);

    expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}"]`)).toBeNull();
    expect(svg.querySelector(`path[data-arc-key="${arcKey(0, 1, 0, 0, 0)}-1"]`)).toBeTruthy();
  });

  it('声部1のスラーの形は、声部2の音高に影響されない', () => {
    // スラーは途中の音符を避けて膨らむ（障害物回避）。その障害物の集め方は
    // 「声部1しか位置マップに載っていなかった頃」と同じままにしてある（設計メモ §6 の最終判断は段4）。
    // 声部2の音高だけを変えた2つの譜面で、声部1のスラーのパスがまったく同じになることを確認する。
    const makeData = (voice2Key: string): MeasureData[] => ([{
      events: [
        {
          ...quarter('c/5'),
          arcs: [{ kind: 'slur', fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }],
        },
        quarter('d/5'),
        quarter('e/5'),
        quarter('f/5'),
      ],
      voices: [
        {
          id: 'voice-1',
          events: [
            {
              ...quarter('c/5'),
              arcs: [{ kind: 'slur' as const, fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }],
            },
            quarter('d/5'),
            quarter('e/5'),
            quarter('f/5'),
          ],
        },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [quarter(voice2Key), quarter(voice2Key), quarter(voice2Key), quarter(voice2Key)],
        },
      ],
    }]);

    const low = renderScore(makeData('c/3'));
    const lowPath = low.svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`);
    expect(lowPath).toBeTruthy();
    const lowD = lowPath!.getAttribute('d');

    const high = renderScore(makeData('c/4'));
    const highPath = high.svg.querySelector(`path[data-arc-key="${arcKey(0, 0, 0, 0, 0)}"]`);
    expect(highPath).toBeTruthy();

    expect(highPath!.getAttribute('d')).toBe(lowD);
  });
});
