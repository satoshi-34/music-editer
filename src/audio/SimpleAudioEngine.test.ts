// src/audio/SimpleAudioEngine.test.ts
// SimpleAudioEngine の停止処理テスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAllDevTuning, setDevTuningOverride } from '../utils/devTuning';
import { SimpleAudioEngine } from './SimpleAudioEngine';

// 先読み窓（#622）は既定 4 秒。ここの多くのテストは「playParts が返った時点で譜面全体が
// 予約済み」を前提にしているので、窓を最大まで広げて従来の検証をそのまま保つ。
// 窓の進行そのものは scheduleWindow.test.ts と各エンジンの #622 テストで固定している
beforeEach(() => { setDevTuningOverride('audio.lookahead', 12); });
afterEach(() => { resetAllDevTuning(); });

describe('SimpleAudioEngine', () => {
  let engine: SimpleAudioEngine;
  let mockOscillatorA: any;
  let mockOscillatorB: any;
  let createdOscillators: any[];
  let createdGains: any[];
  let createdFilters: Array<{ type: string; frequency: { value: number }; Q: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;
  let mockContext: any;

  beforeEach(() => {
    createdOscillators = [];
    createdGains = [];
    createdFilters = [];

    const createMockOscillator = () => ({
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      detune: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn((eventName: string, callback: () => void) => {
        if (eventName === 'ended') {
          queueMicrotask(callback);
        }
      })
    });
    const createMockGainNode = () => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn(),
      disconnect: vi.fn()
    });

    mockOscillatorA = createMockOscillator();
    mockOscillatorB = createMockOscillator();

    createdOscillators.push(
      createMockOscillator(),
      mockOscillatorA,
      createMockOscillator(),
      mockOscillatorB,
      createMockOscillator(),
      createMockOscillator()
    );
    createdGains.push(
      createMockGainNode(),
      createMockGainNode(),
      createMockGainNode(),
      createMockGainNode(),
      createMockGainNode(),
      createMockGainNode()
    );

    mockContext = {
      state: 'running',
      currentTime: 12.5,
      destination: {},
      resume: vi.fn().mockImplementation(async () => {
        mockContext.state = 'running';
      }),
      close: vi.fn(),
      createOscillator: vi.fn(() => createdOscillators.shift() ?? createMockOscillator()),
      createGain: vi.fn(() => createdGains.shift() ?? createMockGainNode()),
      // 強弱→音色（#670）のローパス。作った順に記録して、velocity との対応を検証する
      createBiquadFilter: vi.fn(() => {
        const filter = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        createdFilters.push(filter);
        return filter;
      })
    };

    vi.stubGlobal('AudioContext', vi.fn(function () {
      return mockContext;
    }));
    engine = new SimpleAudioEngine();
  });

  it('stopAll で再生中と予約済みの音をまとめて停止できる', async () => {
    await engine.initialize();
    await engine.playNote(440, 0.5);
    await (engine as any).playNoteAtTime(660, 0.75, 20);

    engine.stopAll();

    expect((engine as any).oscillators.size).toBe(0);
    expect(mockOscillatorA.disconnect).toHaveBeenCalled();
    expect(mockOscillatorB.disconnect).toHaveBeenCalled();
  });

  it('suspended の既存 AudioContext を再開してから再利用できる', async () => {
    await engine.initialize();
    mockContext.state = 'suspended';

    await engine.initialize();

    expect(mockContext.resume).toHaveBeenCalled();
  });

  it('先頭の窓の予約が失敗したら playParts が失敗として伝え、以後の窓も作らない（#622 round1/2 P2）', async () => {
    await engine.initialize();
    resetAllDevTuning();
    const spy = vi.spyOn(engine as unknown as { playNoteAtTime: () => Promise<void> }, 'playNoteAtTime')
      .mockRejectedValue(new Error('予約失敗'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // 60BPM の全音符 × 10 小節（40 秒）。窓 4 秒なので先頭は 1 音
      await expect(engine.playParts([{ measures: Array.from({ length: 10 }, () => ({
        measureBeats: 4, bpm: 60, events: [{ dur: '1', isRest: false, keys: ['c/4'] }],
      })) }], 60)).rejects.toThrow('予約失敗');
      const calls = spy.mock.calls.length;
      expect(calls).toBe(1);
      // この harness の時計は 12.5 秒から始まるので、そこから 10 秒進める
      (engine as unknown as { context: { currentTime: number } }).context.currentTime = 22.5;
      await vi.advanceTimersByTimeAsync(1000);
      expect(spy.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('後続の窓の予約失敗は onSchedulingFailure で伝わり、以後の窓は作らない（#622 round2 P2）', async () => {
    await engine.initialize();
    resetAllDevTuning();
    const spy = vi.spyOn(engine as unknown as { playNoteAtTime: () => Promise<void> }, 'playNoteAtTime')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('後続失敗'));
    const failures: unknown[] = [];
    const unsubscribe = engine.onSchedulingFailure((e) => failures.push(e));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await engine.playParts([{ measures: Array.from({ length: 10 }, () => ({
        measureBeats: 4, bpm: 60, events: [{ dur: '1', isRest: false, keys: ['c/4'] }],
      })) }], 60);
      expect(failures).toHaveLength(0);
      // この harness の時計は 12.5 秒から始まるので、そこから 10 秒進める
      (engine as unknown as { context: { currentTime: number } }).context.currentTime = 22.5;
      await vi.advanceTimersByTimeAsync(600);
      expect(failures.map((e) => (e as Error).message)).toEqual(['後続失敗']);
      const calls = spy.mock.calls.length;
      (engine as unknown as { context: { currentTime: number } }).context.currentTime = 42.5;
      await vi.advanceTimersByTimeAsync(1000);
      expect(spy.mock.calls.length).toBe(calls);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('playScore で event.velocity を発音時の強さに反映できる', async () => {
    await engine.initialize();
    const playNoteAtTimeSpy = vi.spyOn(engine as any, 'playNoteAtTime').mockResolvedValue(undefined);

    await engine.playScore([
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'], velocity: 0.22 },
          { dur: '4', isRest: false, keys: ['d/4'], velocity: 0.74 }
        ]
      }
    ], 120);

    // 第5引数は尻尾の長さ（同時発音数の上限で詰められた音用・#605）。ここでは値を問わない
    expect(playNoteAtTimeSpy).toHaveBeenNthCalledWith(1, expect.any(Number), expect.any(Number), expect.any(Number), 0.22, expect.any(Number), expect.anything());
    expect(playNoteAtTimeSpy).toHaveBeenNthCalledWith(2, expect.any(Number), expect.any(Number), expect.any(Number), 0.74, expect.any(Number), expect.anything());
  });

  describe('強弱を音色にも効かせる（Issue #670）', () => {
    it('譜面再生では音ごとにローパスを 1 つ挟み、弱い音ほどカットオフが低い', async () => {
      await engine.initialize();
      await engine.playParts([{
        measures: [{ measureBeats: 4, events: [
          { dur: '4', isRest: false, keys: ['c/4'], velocity: 0.22 },
          { dur: '4', isRest: false, keys: ['d/4'], velocity: 0.74 },
        ] }],
      }], 120);
      expect(createdFilters.length).toBe(2);
      expect(createdFilters[0].type).toBe('lowpass');
      expect(createdFilters[0].frequency.value).toBeLessThan(createdFilters[1].frequency.value);
      // 配線: ゲイン → フィルタ → 出力（フィルタが出力へつながっている）
      createdFilters.forEach((filter) => { expect(filter.connect).toHaveBeenCalledTimes(1); });
    });

    it('OFF にすると従来どおりフィルタを作らない', async () => {
      await engine.initialize();
      engine.setVelocityTimbreEnabled(false);
      await engine.playParts([{
        measures: [{ measureBeats: 4, events: [{ dur: '4', isRest: false, keys: ['c/4'], velocity: 0.22 }] }],
      }], 120);
      expect(createdFilters.length).toBe(0);
    });

    it('確認音（velocity 無し）にはフィルタを挟まない', async () => {
      await engine.initialize();
      await engine.playNoteByName('C4', 0.3);
      expect(createdFilters.length).toBe(0);
    });
  });

  describe('タイで結ばれた音の再生（Issue #445）', () => {
    /**
     * 内部メソッド playNoteAtTime を型付きで覗くための入り口。
     * 「いつ・どの高さを・何秒鳴らす予約をしたか」だけを見たいので、
     * 実際の発音はスパイで差し替える。
     */
    type PlayNoteAtTimeHost = {
      playNoteAtTime: (frequency: number, duration: number, startTime: number, velocity?: number) => Promise<void>;
    };
    const internals = (target: SimpleAudioEngine) => target as unknown as PlayNoteAtTimeHost;

    it('タイ2音は「1回の発音・合計の長さ」で鳴る', async () => {
      await engine.initialize();
      const playNoteAtTimeSpy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);

      // 4分音符 + タイ + 4分音符（BPM 120 なら 1拍 = 0.5秒）
      await engine.playScore([
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], tieExtendBeatsByKey: { 'c/4': 1 } },
            { dur: '4', isRest: false, keys: ['c/4'], tieSuppressedKeys: ['c/4'] }
          ]
        }
      ], 120);

      // 発音は1回だけ（継続音は鳴らさない）
      expect(playNoteAtTimeSpy).toHaveBeenCalledTimes(1);
      // 長さは 0.5秒 + 0.5秒 = 1.0秒
      const [, duration] = playNoteAtTimeSpy.mock.calls[0];
      expect(duration).toBeCloseTo(1.0, 5);
    });

    it('テンポ変更をまたぐタイは、またいだ先のテンポで積算される（#458 round2 P2）', async () => {
      await engine.initialize();
      const playNoteAtTimeSpy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);

      // 1小節目 60BPM の4拍目（=1拍1.0秒）から、2小節目 120BPM の頭1拍（=0.5秒）へタイ
      await engine.playScore([
        {
          bpm: 60,
          measureBeats: 4,
          events: [
            { dur: '1', isRest: true, keys: ['b/4'], startBeat: 0, durationScale: 0 } as never,
            { dur: '4', isRest: false, keys: ['c/4'], startBeat: 3, tieExtendBeatsByKey: { 'c/4': 1 } } as never,
          ],
        },
        {
          bpm: 120,
          measureBeats: 4,
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], startBeat: 0, tieSuppressedKeys: ['c/4'] } as never,
          ],
        },
      ] as never, 60);

      const tied = playNoteAtTimeSpy.mock.calls.find(([, duration]) => duration > 0.9);
      expect(tied).toBeTruthy();
      // 開始小節BPM一律だと 2拍×1.0秒=2.0秒。正しくは 1.0+0.5=1.5秒
      expect(tied![1]).toBeCloseTo(1.5, 5);
    });

    it('全体テンポ60（小節bpm省略）のタイは、既定120ではなく実効60で数える（#458 round2 P2）', async () => {
      await engine.initialize();
      const playNoteAtTimeSpy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);

      await engine.playScore([
        {
          measureBeats: 4,
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], startBeat: 0, tieExtendBeatsByKey: { 'c/4': 1 } } as never,
            { dur: '4', isRest: false, keys: ['c/4'], startBeat: 1, tieSuppressedKeys: ['c/4'] } as never,
          ],
        },
      ] as never, 60);

      const tied = playNoteAtTimeSpy.mock.calls.find(([, duration]) => duration > 1.0);
      expect(tied).toBeTruthy();
      // 60BPM の 2拍 = 2.0秒（固定120退行だと 1.0秒になる）
      expect(tied![1]).toBeCloseTo(2.0, 5);
    });

    it('タイの継続音を止めても次の音の位置はずれない', async () => {
      await engine.initialize();
      const playNoteAtTimeSpy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);

      await engine.playScore([
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], tieExtendBeatsByKey: { 'c/4': 1 } },
            { dur: '4', isRest: false, keys: ['c/4'], tieSuppressedKeys: ['c/4'] },
            { dur: '4', isRest: false, keys: ['d/4'] }
          ],
          measureBeats: 4
        }
      ], 120);

      expect(playNoteAtTimeSpy).toHaveBeenCalledTimes(2);
      const [, , tieStartTime] = playNoteAtTimeSpy.mock.calls[0];
      const [, , nextNoteStartTime] = playNoteAtTimeSpy.mock.calls[1];
      // 3音目は「2音ぶん（1.0秒）あと」から始まる＝タイでテンポが崩れていない
      expect(nextNoteStartTime - tieStartTime).toBeCloseTo(1.0, 5);
    });

    it('タイが無い譜面では発音回数も長さも従来どおり', async () => {
      await engine.initialize();
      const playNoteAtTimeSpy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);

      await engine.playScore([
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'] },
            { dur: '4', isRest: false, keys: ['c/4'] }
          ]
        }
      ], 120);

      expect(playNoteAtTimeSpy).toHaveBeenCalledTimes(2);
      expect(playNoteAtTimeSpy.mock.calls[0][1]).toBeCloseTo(0.5, 5);
    });
  });

  describe('スウィングON時のタイの長さ（Codex round1 P1）', () => {
    type PlayNoteAtTimeHost = {
      playNoteAtTime: (frequency: number, duration: number, startTime: number, velocity?: number) => Promise<void>;
    };
    const internals = (target: SimpleAudioEngine) => target as unknown as PlayNoteAtTimeHost;

    it('表拍8分+裏拍8分のタイは、スウィングでも合計1拍で鳴り終わる', async () => {
      await engine.initialize();
      engine.setSwingEnabled(true);
      const spy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);
      await engine.playScore([
        {
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tieExtendBeatsByKey: { 'c/4': 0.5 } },
            { dur: '8', isRest: false, keys: ['c/4'], tieSuppressedKeys: ['c/4'] }
          ],
          measureBeats: 4
        }
      ], 120);
      expect(spy).toHaveBeenCalledTimes(1);
      // 表拍開始は動かないので、鳴りは 1拍 = 0.5秒（2/3+0.5 の 7/6 拍にならない）
      expect(spy.mock.calls[0][1]).toBeCloseTo(0.5, 5);
    });

    it('裏拍から始まるタイは、スウィング後の開始から連鎖終端までの長さで鳴る', async () => {
      await engine.initialize();
      engine.setSwingEnabled(true);
      const spy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);
      await engine.playScore([
        {
          events: [
            { dur: '8', isRest: false, keys: ['d/4'] },
            { dur: '8', isRest: false, keys: ['c/4'], tieExtendBeatsByKey: { 'c/4': 1 } },
            { dur: '4', isRest: false, keys: ['c/4'], tieSuppressedKeys: ['c/4'] }
          ],
          measureBeats: 4
        }
      ], 120);
      expect(spy).toHaveBeenCalledTimes(2);
      // 裏拍開始は 2/3 拍へ動く。連鎖終端は記譜どおり 2 拍目 → 鳴りは 4/3 拍 = 2/3 秒
      expect(spy.mock.calls[1][1]).toBeCloseTo((4 / 3) * 0.5, 5);
    });
  });

  describe('スウィングON時の小節送り（Codex round2 P1）', () => {
    type PlayNoteAtTimeHost = {
      playNoteAtTime: (frequency: number, duration: number, startTime: number, velocity?: number) => Promise<void>;
    };
    const internals = (target: SimpleAudioEngine) => target as unknown as PlayNoteAtTimeHost;

    it('複数声部の小節でも、スウィングは小節線（次小節の開始）を動かさない', async () => {
      await engine.initialize();
      engine.setSwingEnabled(true);
      const spy = vi.spyOn(internals(engine), 'playNoteAtTime').mockResolvedValue(undefined);
      await engine.playScore([
        {
          // startBeat つき（複数声部扱い）で、4拍目裏の8分が最後にある小節
          events: [
            { dur: '2', isRest: false, keys: ['c/4'], startBeat: 0 },
            { dur: '8', isRest: false, keys: ['d/4'], startBeat: 3.5 },
          ],
          measureBeats: 4
        },
        { events: [{ dur: '4', isRest: false, keys: ['e/4'], startBeat: 0 }], measureBeats: 4 }
      ], 120, 0);
      expect(spy).toHaveBeenCalledTimes(3);
      // 2小節目の頭は「スウィング後の 4+1/6 拍」ではなく記譜どおり 4拍目 = 2.0秒
      expect(spy.mock.calls[2][2]).toBeCloseTo(2.0, 5);
    });
  });

  describe('durationToSeconds の付点・連符反映（PR #479 で発覚した既存の穴の修正）', () => {
    it('付点は 1.5 倍・複付点は 1.75 倍・三連は 2/3 倍で計算される', () => {
      const base = engine.durationToSeconds('4', 120);
      expect(base).toBeCloseTo(0.5, 10);
      expect(engine.durationToSeconds('4', 120, 1)).toBeCloseTo(0.75, 10);
      expect(engine.durationToSeconds('4', 120, 2)).toBeCloseTo(0.875, 10);
      expect(engine.durationToSeconds('8', 120, undefined, { numNotes: 3, notesOccupied: 2 }))
        .toBeCloseTo(0.25 * (2 / 3), 10);
    });

    it('2連符(2:3)は 1.5 倍・4連符(4:3)は 0.75 倍で計算される（Issue #472）', () => {
      // 2連符は「音が伸びる」唯一の連符。倍率が notesOccupied/numNotes に統一されているので
      // 1未満に丸められたりせず、8分音符1個ぶんが付点8分音符と同じ長さで鳴る。
      expect(engine.durationToSeconds('8', 120, undefined, { numNotes: 2, notesOccupied: 3 }))
        .toBeCloseTo(0.25 * 1.5, 10);
      expect(engine.durationToSeconds('8', 120, undefined, { numNotes: 4, notesOccupied: 3 }))
        .toBeCloseTo(0.25 * 0.75, 10);
    });
  });

  describe('ダブルシャープ・ダブルフラットの周波数計算（Issue #423）', () => {
    it('𝄪 は全音上、𝄫 は全音下の音として鳴る', () => {
      const d4 = engine.noteToFrequency('d/4');
      // c##/4（ドのダブルシャープ）と ebb/4（ミのダブルフラット）はどちらも実音レの高さ
      expect(engine.noteToFrequency('c##/4')).toBeCloseTo(d4, 6);
      expect(engine.noteToFrequency('ebb/4')).toBeCloseTo(d4, 6);
      // 1文字の臨時記号の扱いは変わらない
      expect(engine.noteToFrequency('c#/4')).toBeLessThan(d4);
    });
  });

  describe('微分音（四分音）の周波数計算', () => {
    it('noteToFrequency は centsOffset 未指定なら半音単位の周波数のまま', () => {
      const c4 = engine.noteToFrequency('c/4');
      expect(c4).toBeCloseTo(261.63, 1);
    });

    it('noteToFrequency は +50セントで半音の半分だけ周波数を上げる', () => {
      const c4 = engine.noteToFrequency('c/4');
      const c4QuarterSharp = engine.noteToFrequency('c/4', 50);
      // 半音（100セント）上げた周波数との中間になるはず
      const cSharp4 = engine.noteToFrequency('c/4', 100);
      expect(c4QuarterSharp).toBeGreaterThan(c4);
      expect(c4QuarterSharp).toBeLessThan(cSharp4);
      expect(c4QuarterSharp / c4).toBeCloseTo(Math.pow(2, 50 / 1200), 6);
    });

    it('noteToFrequency は -50セントで半音の半分だけ周波数を下げる', () => {
      const c4 = engine.noteToFrequency('c/4');
      const c4QuarterFlat = engine.noteToFrequency('c/4', -50);
      expect(c4QuarterFlat).toBeLessThan(c4);
      expect(c4QuarterFlat / c4).toBeCloseTo(Math.pow(2, -50 / 1200), 6);
    });

    it('playScore は先頭音（keyIndex 0）の microtone をセントオフセットとして反映する', async () => {
      await engine.initialize();
      const playNoteAtTimeSpy = vi.spyOn(engine as any, 'playNoteAtTime').mockResolvedValue(undefined);
      const noteToFrequencySpy = vi.spyOn(engine, 'noteToFrequency');

      await engine.playScore([
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], microtones: [{ keyIndex: 0, type: 'quarterSharp' }] }
          ]
        }
      ], 120);

      expect(noteToFrequencySpy).toHaveBeenCalledWith('c/4', 50);
      expect(playNoteAtTimeSpy).toHaveBeenCalled();
    });
  });
});
