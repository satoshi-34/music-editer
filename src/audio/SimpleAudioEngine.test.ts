// src/audio/SimpleAudioEngine.test.ts
// SimpleAudioEngine の停止処理テスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleAudioEngine } from './SimpleAudioEngine';

describe('SimpleAudioEngine', () => {
  let engine: SimpleAudioEngine;
  let mockOscillatorA: any;
  let mockOscillatorB: any;
  let createdOscillators: any[];
  let createdGains: any[];
  let mockContext: any;

  beforeEach(() => {
    createdOscillators = [];
    createdGains = [];

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
      createGain: vi.fn(() => createdGains.shift() ?? createMockGainNode())
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

    expect(playNoteAtTimeSpy).toHaveBeenNthCalledWith(1, expect.any(Number), expect.any(Number), expect.any(Number), 0.22);
    expect(playNoteAtTimeSpy).toHaveBeenNthCalledWith(2, expect.any(Number), expect.any(Number), expect.any(Number), 0.74);
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
