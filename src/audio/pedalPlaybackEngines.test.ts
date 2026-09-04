// ペダル記号を再生へ反映する（Issue #549）ときの、両音源に共通の契約テスト。
//
// 固定する契約:
//   1. ペダル区間の音は、音価を過ぎても解除位置まで鳴り続ける（鳴り終わりだけが動く）
//   2. 開始時刻・小節送りは一切変わらない（テンポ・リズムは不変）
//   3. ペダル記号が無い譜面は従来どおり（回帰なし）
//   4. 停止ボタン（stopAll）はペダル保持中の音も止める
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCHEDULE_LEAD_SECONDS } from './scheduleLead';
import { resetAllDevTuning, setDevTuningOverride } from '../utils/devTuning';

import { SimpleAudioEngine } from './SimpleAudioEngine';
import { SoundFontEngine } from './SoundFontEngine';
import { InstrumentType } from './SoundSource';
import type { PlaybackPart } from './PlaybackEngine';

/** 4/4・BPM60（1拍 = 1秒）の1小節ぶん。1拍目の音だけ pedalExtendBeatsByKey を差し替えられる */
function measuresWithPedal(pedalExtendBeatsByKey?: Record<string, number>): PlaybackPart['measures'] {
  return [
    {
      measureBeats: 4,
      bpm: 60,
      events: [
        { dur: '4', isRest: false, keys: ['c/4'], pedalExtendBeatsByKey },
        { dur: '4', isRest: false, keys: ['d/4'] },
        { dur: '4', isRest: false, keys: ['e/4'] },
        { dur: '4', isRest: false, keys: ['f/4'] },
      ],
    },
  ];
}

// 先読み窓（#622）は既定 4 秒。ここの多くのテストは「playParts が返った時点で譜面全体が
// 予約済み」を前提にしているので、窓を最大まで広げて従来の検証をそのまま保つ。
// 窓の進行そのものは scheduleWindow.test.ts と各エンジンの #622 テストで固定している
beforeEach(() => { setDevTuningOverride('audio.lookahead', 12); });
afterEach(() => { resetAllDevTuning(); vi.useRealTimers(); });

describe('内蔵音源（SimpleAudioEngine）のペダル保持（Issue #549）', () => {
  type MockOscillator = { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  let createdOscillators: MockOscillator[];

  beforeEach(() => {
    createdOscillators = [];
    const createMockOscillator = () => {
      const osc = {
        type: 'sine' as OscillatorType,
        frequency: { setValueAtTime: vi.fn() },
        detune: { setValueAtTime: vi.fn() },
        connect: vi.fn(), disconnect: vi.fn(),
        start: vi.fn(), stop: vi.fn(),
        addEventListener: vi.fn(),
      };
      createdOscillators.push(osc);
      return osc;
    };
    const mockContext = {
      state: 'running', currentTime: 0, destination: {},
      resume: vi.fn(), close: vi.fn(),
      createOscillator: vi.fn(createMockOscillator),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(), disconnect: vi.fn(),
      })),
    };
    vi.stubGlobal('AudioContext', vi.fn(function () { return mockContext; }));
    // Safari 判定は簡易経路へ落ちるため、通常経路を通す UA にしておく
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120' });
  });

  /** 1小節を再生し、1拍目の音の start / stop 予約時刻を返す */
  async function playFirstNote(pedalExtendBeatsByKey?: Record<string, number>) {
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    // initialize が作る出力の下ならし（無音のオシレーター）は数えない
    createdOscillators.length = 0;
    await engine.playParts([{ measures: measuresWithPedal(pedalExtendBeatsByKey) }], 60);
    const first = createdOscillators[0];
    return {
      engine,
      first,
      startedAt: first.start.mock.calls[0][0] as number,
      stoppedAt: first.stop.mock.calls[0][0] as number,
      // 2拍目の音（開始時刻が動いていないことの確認用）
      secondStartedAt: createdOscillators[1].start.mock.calls[0][0] as number,
    };
  }

  it('先頭の音は「今」ではなく先読みリードぶん先に予約される（Issue #610）', async () => {
    const { startedAt, stoppedAt } = await playFirstNote();
    // mockContext.currentTime は 0。リードが無いと start(0) となり、予約ループの
    // 実時間ぶん先頭の音がアタック途中から鳴る
    expect(startedAt).toBeCloseTo(SCHEDULE_LEAD_SECONDS, 5);
    // dev の上書きが実際の予約時刻へ届き、停止側も同じ量だけ平行移動する（音の長さは不変）
    setDevTuningOverride('audio.scheduleLead', 0.3);
    try {
      const shifted = await playFirstNote();
      expect(shifted.startedAt).toBeCloseTo(0.3, 5);
      expect(shifted.stoppedAt - shifted.startedAt).toBeCloseTo(stoppedAt - startedAt, 5);
    } finally {
      resetAllDevTuning();
    }
  });

  it('同時発音数の上限を超える分は予約されない（Issue #605・内蔵側も同じ規約）', async () => {
    // 1音あたりのオシレーター数を先に測る（音色によって 1〜3 本）
    const single = new SimpleAudioEngine();
    await single.initialize();
    createdOscillators.length = 0;
    await single.playParts([{ measures: [{ measureBeats: 4, bpm: 60, events: [
      { dur: '1', isRest: false, keys: ['c/4'] },
    ] }] }], 60);
    const perNote = createdOscillators.length;
    expect(perNote).toBeGreaterThan(0);

    setDevTuningOverride('audio.maxPolyphony', 2);
    try {
      const engine = new SimpleAudioEngine();
      await engine.initialize();
      createdOscillators.length = 0;
      // 同時刻（startBeat 0）に 5 音。内蔵音源は1イベント1音なので、5 イベントで積む
      await engine.playParts([{ measures: [{ measureBeats: 4, bpm: 60, events: [
        { dur: '1', isRest: false, keys: ['c/4'], startBeat: 0 },
        { dur: '1', isRest: false, keys: ['e/4'], startBeat: 0 },
        { dur: '1', isRest: false, keys: ['g/4'], startBeat: 0 },
        { dur: '1', isRest: false, keys: ['c/5'], startBeat: 0 },
        { dur: '1', isRest: false, keys: ['e/5'], startBeat: 0 },
      ] }] }], 60);
      expect(createdOscillators.length).toBe(perNote * 2);
    } finally {
      resetAllDevTuning();
    }
  });

  it('内蔵側も、詰められた音は音本体を残して尻尾だけ切られる（#605 round2 P1）', async () => {
    setDevTuningOverride('audio.maxPolyphony', 1);
    try {
      const engine = new SimpleAudioEngine();
      await engine.initialize();
      createdOscillators.length = 0;
      // 60BPM の4分（1秒）が2つ。上限1なので1音目は2音目の開始（1秒）で尻尾ごと終わる
      await engine.playParts([{ measures: [{ measureBeats: 4, bpm: 60, events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: false, keys: ['d/4'] },
      ] }] }], 60);
      const first = createdOscillators[0];
      const startedAt = first.start.mock.calls[0][0] as number;
      const stoppedAt = first.stop.mock.calls[0][0] as number;
      // 音本体 1 秒はそのまま、尻尾は最小 1ms だけ
      expect(stoppedAt - startedAt).toBeCloseTo(1.001, 4);
    } finally {
      resetAllDevTuning();
    }
  });

  it('Safari 簡易経路でも、詰められた音の尻尾は上書きどおり切られる（#605 round3 P1）', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17 Safari/605' });
    setDevTuningOverride('audio.maxPolyphony', 1);
    try {
      const engine = new SimpleAudioEngine();
      await engine.initialize();
      createdOscillators.length = 0;
      await engine.playParts([{ measures: [{ measureBeats: 4, bpm: 60, events: [
        { dur: '4', isRest: false, keys: ['c/4'] },
        { dur: '4', isRest: false, keys: ['d/4'] },
      ] }] }], 60);
      const first = createdOscillators[0];
      const startedAt = first.start.mock.calls[0][0] as number;
      const stoppedAt = first.stop.mock.calls[0][0] as number;
      expect(stoppedAt - startedAt).toBeCloseTo(1.001, 4);
    } finally {
      resetAllDevTuning();
    }
  });

  it('内蔵側も、長い譜面は先読み窓ぶんだけ先にオシレーターを作り、stopAll で止まる（Issue #622）', async () => {
    // initialize は内部で実時間の待ちを使うので、偽タイマーは予約の直前から
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    const context = (engine as unknown as { context: { currentTime: number } }).context;
    // 1音あたりのオシレーター本数を先に測る
    await engine.playParts([{ measures: [{ measureBeats: 4, bpm: 60, events: [{ dur: '1', isRest: false, keys: ['c/4'] }] }] }], 60);
    const perNote = createdOscillators.length;
    expect(perNote).toBeGreaterThan(0);
    engine.stopAll();
    createdOscillators.length = 0;
    // このテストだけは本番既定（4 秒）で数える（ファイル全体の 12 秒上書きを外す）
    resetAllDevTuning();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // 60BPM の全音符 × 10小節 = 40秒（開始 0,4,...36）。窓 [0,4) なら先頭は1音
      await engine.playParts([{ measures: Array.from({ length: 10 }, () => ({
        measureBeats: 4, bpm: 60, events: [{ dur: '1', isRest: false, keys: ['c/4'] }],
      })) }], 60);
      expect(createdOscillators.length).toBe(perNote * 1);
      context.currentTime = 10;
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);
      expect(createdOscillators.length).toBe(perNote * 4);
      const atStop = createdOscillators.length;
      engine.stopAll();
      context.currentTime = 100;
      await vi.advanceTimersByTimeAsync(2000);
      expect(createdOscillators.length).toBe(atStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it('スタッカート（durationScale < 1）でもペダル中は解除位置まで響く（round1 P3: 内蔵側も固定）', async () => {
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        bpm: 60,
        events: [
          { dur: '4', isRest: false, keys: ['c/4'], durationScale: 0.5, pedalExtendBeatsByKey: { 'c/4': 3 } },
        ],
      }],
    }], 60);
    const first = createdOscillators[0];
    const startedAt = first.start.mock.calls[0][0] as number;
    const stoppedAt = first.stop.mock.calls[0][0] as number;
    // max（掛け算に退行すると 0.5×4=2秒側になり落ちる）: 解除位置=4秒+尻尾
    expect(stoppedAt - startedAt).toBeGreaterThanOrEqual(4);
  });

  it('ペダル区間の音は解除位置（音価 + 延長）まで鳴り続ける', async () => {
    const withoutPedal = await playFirstNote();
    // 4分音符（BPM60 = 1秒）を、3拍ぶん先の解除位置まで延ばす
    const withPedal = await playFirstNote({ 'c/4': 3 });

    // 鳴り終わりが 3秒ぶん後ろへ動く（尻尾は #525 の分がどちらにも同じだけ乗る）
    expect(withPedal.stoppedAt - withoutPedal.stoppedAt).toBeCloseTo(3, 5);
  });

  it('開始時刻・次の音の位置は変わらない（テンポ・リズムは不変）', async () => {
    const withoutPedal = await playFirstNote();
    const withPedal = await playFirstNote({ 'c/4': 3 });

    expect(withPedal.startedAt).toBeCloseTo(withoutPedal.startedAt, 5);
    expect(withPedal.secondStartedAt).toBeCloseTo(withoutPedal.secondStartedAt, 5);
  });

  it('ペダル指定が無い譜面は従来どおりの長さで鳴る（回帰なし）', async () => {
    const plain = await playFirstNote();
    const empty = await playFirstNote({});

    expect(empty.stoppedAt).toBeCloseTo(plain.stoppedAt, 5);
  });

  it('停止ボタン（stopAll）はペダルで保持中の音も止める', async () => {
    const { engine, first } = await playFirstNote({ 'c/4': 3 });
    expect(first.stop.mock.calls.length).toBe(1); // 予約どおりの停止だけ

    engine.stopAll();

    // 台帳に登録されているので「今すぐ」の停止が追加で予約される
    expect(first.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(first.stop.mock.calls.at(-1)![0] as number).toBeCloseTo(0, 5);
  });
});

describe('SoundFont のペダル保持（Issue #549）', () => {
  type PlayCall = { note: string; time: number; options: { duration: number } };

  /** 予約内容（音名・時刻・長さ）だけを記録する player へ差し替えて1小節を再生する */
  async function playAndCapture(part: PlaybackPart): Promise<PlayCall[]> {
    const calls: PlayCall[] = [];
    const engine = new SoundFontEngine();
    const internals = engine as unknown as {
      initialize: () => Promise<void>;
      ensureContext: () => unknown;
      getPlayerForInstrument: (instrument: InstrumentType) => Promise<unknown>;
    };
    internals.initialize = async () => {};
    internals.ensureContext = () => ({ currentTime: 0 });
    internals.getPlayerForInstrument = async () => ({
      play: (note: string, time: number, options: { duration: number }) => {
        calls.push({ note, time, options });
      },
    });

    await engine.playParts([part], 60);
    return calls;
  }

  it('ペダル区間の音は解除位置まで鳴り、開始時刻は変わらない', async () => {
    const plain = await playAndCapture({ measures: measuresWithPedal() });
    const pedal = await playAndCapture({ measures: measuresWithPedal({ 'c/4': 3 }) });

    // 1拍目の音だけが長くなる（BPM60 なので 1拍 = 1秒）
    expect(plain[0].options.duration).toBeCloseTo(1, 5);
    expect(pedal[0].options.duration).toBeCloseTo(4, 5);
    // 開始時刻はどちらも記譜どおり
    expect(pedal[0].time).toBeCloseTo(plain[0].time, 5);
    expect(pedal[1].time).toBeCloseTo(plain[1].time, 5);
    // ペダル指定の無い音は従来どおり
    expect(pedal[1].options.duration).toBeCloseTo(plain[1].options.duration, 5);
  });

  it('和音では指定されたキーだけが延び、他の音は従来どおり', async () => {
    const calls = await playAndCapture({
      measures: [{
        measureBeats: 4,
        bpm: 60,
        events: [
          { dur: '4', isRest: false, keys: ['c/4', 'e/4'], pedalExtendBeatsByKey: { 'c/4': 3 } },
        ],
      }],
    });

    expect(calls.find((call) => call.note.startsWith('C4'))?.options.duration).toBeCloseTo(4, 5);
    expect(calls.find((call) => call.note.startsWith('E4'))?.options.duration).toBeCloseTo(1, 5);
  });

  it('スタッカート（durationScale < 1）でもペダル中は解除位置まで響く', async () => {
    const calls = await playAndCapture({
      measures: [{
        measureBeats: 4,
        bpm: 60,
        events: [
          { dur: '4', isRest: false, keys: ['c/4'], durationScale: 0.5, pedalExtendBeatsByKey: { 'c/4': 3 } },
        ],
      }],
    });

    // 0.5秒（スタッカート）ではなく、解除位置の 4秒まで鳴る
    expect(calls[0].options.duration).toBeCloseTo(4, 5);
  });
});
