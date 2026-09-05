// src/audio/mainPathAnalyser.test.ts
// 実音経路（マスターゲイン直後）の診断 Analyser まわりの単体テスト（issue #618）。
// 実ブラウザの Web Audio は使えないため、必要な最小限のモックだけを組み立てる。
import { describe, it, expect, vi } from 'vitest';

import {
  ensureMainPathAnalyser,
  tapOutputToMainPathAnalyser,
  readMainPathPeak,
  startMainPathPeakWatch,
  getMainPathPeakResolution,
} from './mainPathAnalyser';

/** 指定した振幅の波形を返す偽 Analyser（float 版） */
function createFloatAnalyser(amplitude: number, context?: unknown): AnalyserNode {
  return {
    context,
    fftSize: 8,
    getFloatTimeDomainData(data: Float32Array) {
      data.fill(0);
      // 1 サンプルだけ山を作る。ピークが拾えているかを見たいので満たすのは 1 点でよい
      data[0] = amplitude;
    },
  } as unknown as AnalyserNode;
}

describe('ensureMainPathAnalyser', () => {
  it('同じ context なら作り直さず使い回す', () => {
    const context = { createAnalyser: vi.fn() } as unknown as AudioContext;
    const existing = createFloatAnalyser(0, context);
    expect(ensureMainPathAnalyser(context, existing)).toBe(existing);
    expect((context as unknown as { createAnalyser: ReturnType<typeof vi.fn> }).createAnalyser).not.toHaveBeenCalled();
  });

  it('context が変わったら新しく作る', () => {
    const oldContext = {} as AudioContext;
    const created = { fftSize: 0 } as AnalyserNode;
    const context = { createAnalyser: () => created } as unknown as AudioContext;
    expect(ensureMainPathAnalyser(context, createFloatAnalyser(0, oldContext))).toBe(created);
  });

  it('createAnalyser が使えない環境では null（再生を巻き込まない）', () => {
    const context = { createAnalyser: () => { throw new Error('unsupported'); } } as unknown as AudioContext;
    expect(ensureMainPathAnalyser(context, null)).toBeNull();
  });
});

describe('tapOutputToMainPathAnalyser', () => {
  it('マスターゲインの出口を Analyser へ分岐する', () => {
    const connect = vi.fn();
    const analyser = createFloatAnalyser(0);
    tapOutputToMainPathAnalyser({ connect } as unknown as AudioNode, analyser);
    expect(connect).toHaveBeenCalledWith(analyser);
  });

  it('Analyser が無い・接続に失敗しても例外にしない', () => {
    const failing = { connect: () => { throw new Error('connect failed'); } } as unknown as AudioNode;
    expect(() => tapOutputToMainPathAnalyser(failing, null)).not.toThrow();
    expect(() => tapOutputToMainPathAnalyser(failing, createFloatAnalyser(0))).not.toThrow();
  });
});

describe('readMainPathPeak', () => {
  it('float 波形のピーク（絶対値）を返す', () => {
    expect(readMainPathPeak(createFloatAnalyser(-0.4))).toBeCloseTo(0.4, 5);
  });

  it('float が無いブラウザでは 8bit 波形（128 中心）から求める', () => {
    const analyser = {
      fftSize: 4,
      getByteTimeDomainData(data: Uint8Array) {
        data.fill(128);
        data[0] = 192; // 128 から +64 ＝ 0.5
      },
    } as unknown as AnalyserNode;
    expect(readMainPathPeak(analyser)).toBeCloseTo(0.5, 5);
  });

  it('Analyser が無い・読めないときは null', () => {
    expect(readMainPathPeak(null)).toBeNull();
    const broken = {
      fftSize: 4,
      getFloatTimeDomainData() { throw new Error('cannot read'); },
    } as unknown as AnalyserNode;
    expect(readMainPathPeak(broken)).toBeNull();
  });
});

describe('startMainPathPeakWatch', () => {
  it('観測している間の最大値を持ち回る（短い音を取りこぼさない）', () => {
    vi.useFakeTimers();
    try {
      let amplitude = 0.3;
      const analyser = {
        fftSize: 4,
        getFloatTimeDomainData(data: Float32Array) {
          data.fill(0);
          data[0] = amplitude;
        },
      } as unknown as AnalyserNode;

      const watch = startMainPathPeakWatch(analyser, { intervalMs: 10 });
      vi.advanceTimersByTime(10);
      // 音が鳴り終わって無音に戻っても、山の値が残っていることを確かめる
      amplitude = 0;
      vi.advanceTimersByTime(50);
      expect(watch.getPeak()).toBeCloseTo(0.3, 5);
      watch.stop();
      // stop 後は観測が増えない（setInterval が残っていない）
      amplitude = 0.9;
      vi.advanceTimersByTime(50);
      expect(watch.getPeak()).toBeCloseTo(0.3, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Analyser が無いときは null のまま（stop しても落ちない）', () => {
    const watch = startMainPathPeakWatch(null);
    expect(watch.getPeak()).toBeNull();
    expect(() => watch.stop()).not.toThrow();
  });
});

describe('getMainPathPeakResolution（#618 round1 P3）', () => {
  it('浮動小数で読めるなら量子化の下限は無い（0）', () => {
    const analyser = {
      getFloatTimeDomainData(data: Float32Array) { data.fill(0); },
    } as unknown as AnalyserNode;
    expect(getMainPathPeakResolution(analyser)).toBe(0);
  });

  it('8bit しか読めないなら 1 目盛は 1/128（これより細かいしきい値では判定できない）', () => {
    const analyser = {
      getByteTimeDomainData(data: Uint8Array) { data.fill(128); },
    } as unknown as AnalyserNode;
    expect(getMainPathPeakResolution(analyser)).toBeCloseTo(1 / 128, 6);
  });

  it('どちらも読めない・Analyser が無いときは null', () => {
    expect(getMainPathPeakResolution({} as unknown as AnalyserNode)).toBeNull();
    expect(getMainPathPeakResolution(null)).toBeNull();
  });
});
