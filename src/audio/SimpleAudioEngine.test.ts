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
});
