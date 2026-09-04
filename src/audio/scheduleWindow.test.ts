// src/audio/scheduleWindow.test.ts — Issue #622 先読み窓の逐次スケジューリング
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOOKAHEAD_SECONDS, createWindowedScheduler, lookaheadSeconds, takeDueVoices } from './scheduleWindow';
import { DEV_TUNING_ENTRIES, resetAllDevTuning, setDevTuningOverride } from '../utils/devTuning';

describe('takeDueVoices', () => {
  const sorted = [0, 1, 2, 3, 10].map((t) => ({ startTime: t }));
  it('cursor から untilTime より前の音を順に取り出す', () => {
    expect(takeDueVoices(sorted, 0, 2.5)).toEqual({ due: sorted.slice(0, 3), nextCursor: 3 });
    expect(takeDueVoices(sorted, 3, 4)).toEqual({ due: [sorted[3]], nextCursor: 4 });
  });
  it('該当が無ければ空・末尾を越えない', () => {
    expect(takeDueVoices(sorted, 4, 5)).toEqual({ due: [], nextCursor: 4 });
    expect(takeDueVoices(sorted, 5, 100)).toEqual({ due: [], nextCursor: 5 });
  });
});

describe('createWindowedScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); resetAllDevTuning(); });

  function setup(times: number[], lookahead = 4, tickMs = 500) {
    let now = 0;
    const played: number[] = [];
    const scheduler = createWindowedScheduler({
      voices: times.map((t) => ({ startTime: t })),
      now: () => now,
      play: (v) => played.push(v.startTime),
      lookaheadSeconds: lookahead,
      tickMs,
    });
    return { scheduler, played, setNow: (t: number) => { now = t; } };
  }

  it('先頭の窓は start() の中で同期的に予約される（頭欠け防止 #610 を保つ）', () => {
    const { scheduler, played } = setup([0, 1, 3.9, 4, 8]);
    scheduler.start();
    expect(played).toEqual([0, 1, 3.9]);
    expect(scheduler.stats()).toEqual({ scheduled: 3, total: 5, active: true });
  });

  it('時計が進むとタイマーごとに次の窓を予約し、最後まで来たら止まる', () => {
    const { scheduler, played, setNow } = setup([0, 1, 3.9, 4, 8]);
    scheduler.start();
    setNow(0.5);
    vi.advanceTimersByTime(500);
    expect(played).toEqual([0, 1, 3.9, 4]);
    setNow(4.5);
    vi.advanceTimersByTime(500);
    expect(played).toEqual([0, 1, 3.9, 4, 8]);
    expect(scheduler.stats().active).toBe(false);
    // 終わった後はタイマーが残らない
    expect(vi.getTimerCount()).toBe(0);
  });

  it('一時停止（時計が止まる）中は窓が進まず、再開すれば続く', () => {
    const { scheduler, played, setNow } = setup([0, 5, 6]);
    scheduler.start();
    expect(played).toEqual([0]);
    // suspend 中: currentTime は進まない
    vi.advanceTimersByTime(3000);
    expect(played).toEqual([0]);
    setNow(2);
    vi.advanceTimersByTime(500);
    expect(played).toEqual([0, 5]);
  });

  it('stop() 以後は窓を作らない（解除し損ねた発火も無視）', () => {
    const { scheduler, played, setNow } = setup([0, 5, 6]);
    scheduler.start();
    scheduler.stop();
    setNow(10);
    vi.advanceTimersByTime(2000);
    expect(played).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('後続の窓の同期例外で窓を止め、onError へ伝える（以後の窓は作らない）', () => {
    let now = 0;
    const errors: unknown[] = [];
    const played: number[] = [];
    const scheduler = createWindowedScheduler({
      voices: [0, 5, 6, 12].map((t) => ({ startTime: t })),
      now: () => now,
      play: (v) => { if (v.startTime === 6) throw new Error('boom'); played.push(v.startTime); },
      onError: (e) => errors.push(e),
      lookaheadSeconds: 4,
      tickMs: 500,
    });
    scheduler.start();
    expect(played).toEqual([0]);
    now = 3;
    vi.advanceTimersByTime(500);
    expect(played).toEqual([0, 5]);
    expect(errors.map((e) => (e as Error).message)).toEqual(['boom']);
    expect(scheduler.stats().active).toBe(false);
    now = 20;
    vi.advanceTimersByTime(1000);
    expect(played).toEqual([0, 5]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('予約が返した Promise の拒否でも窓を止め、onError へ伝える', async () => {
    let now = 0;
    const errors: unknown[] = [];
    const played: number[] = [];
    const scheduler = createWindowedScheduler({
      voices: [0, 5, 6].map((t) => ({ startTime: t })),
      now: () => now,
      play: async (v) => { played.push(v.startTime); if (v.startTime === 5) throw new Error('later'); },
      onError: (e) => errors.push(e),
      lookaheadSeconds: 4,
      tickMs: 500,
    });
    scheduler.start();
    now = 2;
    await vi.advanceTimersByTimeAsync(500);
    expect(played).toEqual([0, 5]);
    expect(errors.map((e) => (e as Error).message)).toEqual(['later']);
    now = 10;
    await vi.advanceTimersByTimeAsync(1000);
    expect(played).toEqual([0, 5]);
  });

  it('先頭の窓の同期例外は start() から投げ、onError は呼ばない（呼び出し側が playParts の失敗にする）', () => {
    const errors: unknown[] = [];
    const scheduler = createWindowedScheduler({
      voices: [0, 1, 5].map((t) => ({ startTime: t })),
      now: () => 0,
      play: (v) => { if (v.startTime === 1) throw new Error('head'); },
      onError: (e) => errors.push(e),
      lookaheadSeconds: 4,
      tickMs: 500,
    });
    expect(() => scheduler.start()).toThrow('head');
    expect(errors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('先頭の窓の Promise 拒否は onError を呼ばず（呼び出し側の await に任せる）、窓だけ止める', async () => {
    const errors: unknown[] = [];
    let now = 0;
    const played: number[] = [];
    const scheduler = createWindowedScheduler({
      voices: [0, 5].map((t) => ({ startTime: t })),
      now: () => now,
      play: async (v) => { played.push(v.startTime); if (v.startTime === 0) throw new Error('head-async'); },
      onError: (e) => errors.push(e),
      lookaheadSeconds: 4,
      tickMs: 500,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([]);
    now = 10;
    await vi.advanceTimersByTimeAsync(1000);
    expect(played).toEqual([0]);
  });

  it('最後の窓を投入し終えた後の非同期な失敗も onError へ伝える（round3 P2）', async () => {
    const errors: unknown[] = [];
    let now = 0;
    let rejectLast: (e: Error) => void = () => {};
    const scheduler = createWindowedScheduler({
      voices: [0, 5].map((t) => ({ startTime: t })),
      now: () => now,
      play: (v) => v.startTime === 5 ? new Promise<void>((_, reject) => { rejectLast = reject; }) : undefined,
      onError: (e) => errors.push(e),
      lookaheadSeconds: 4,
      tickMs: 500,
    });
    scheduler.start();
    now = 2;
    await vi.advanceTimersByTimeAsync(500);
    expect(scheduler.stats()).toEqual({ scheduled: 2, total: 2, active: false });
    rejectLast(new Error('last'));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors.map((e) => (e as Error).message)).toEqual(['last']);
  });

  it('入力が時刻順でなくても（右手→左手の順）開始時刻順に予約する', () => {
    const { scheduler, played } = setup([3, 0, 1]);
    scheduler.start();
    expect(played).toEqual([0, 1, 3]);
  });

  it('既定 4 秒で、dev 調整パネルの登録値・上書きが実効値に届く', () => {
    expect(LOOKAHEAD_SECONDS).toBe(4);
    expect(lookaheadSeconds()).toBe(4);
    const entry = DEV_TUNING_ENTRIES.find((e) => e.key === 'audio.lookahead');
    expect(entry?.defaultValue).toBe(LOOKAHEAD_SECONDS);
    expect(entry?.constName).toBe('LOOKAHEAD_SECONDS');
    setDevTuningOverride('audio.lookahead', 2);
    expect(lookaheadSeconds()).toBe(2);
  });
});
