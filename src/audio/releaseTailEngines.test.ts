// 長い音符のリリースの尻尾（Issue #525）が、内蔵音源と SoundFont の**両方**に入っていることのテスト。
//
// 固定する契約:
//   1. 音価の終わりで即カットせず、そのあとに減衰の尻尾が続く
//   2. 音の開始時刻は一切変わらない（テンポ・リズムは不変）
//   3. 「音色」の余韻スライダー（profile.release）で尻尾の長さが変わる
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SimpleAudioEngine } from './SimpleAudioEngine';
import { SoundFontEngine } from './SoundFontEngine';
import { InstrumentType } from './SoundSource';
import { DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS } from './playbackSettings';
import { MIN_RELEASE_TAIL_SECONDS, MAX_RELEASE_TAIL_SECONDS, resolveReleaseTailSeconds } from './releaseTail';

/** テストで直接呼びたい内部メソッドの入り口（他の音声テストと同じ書き方で any を使わない） */
type SimpleAudioEngineInternals = {
  playNoteAtTime: (frequency: number, duration: number, startTime: number, velocity?: number) => Promise<void>;
};
type SoundFontEngineInternals = {
  buildPlaybackOptions: (duration: number, velocity?: number) => { gain: number; attack: number; release: number; duration: number };
};
const simpleInternals = (target: SimpleAudioEngine) => target as unknown as SimpleAudioEngineInternals;
const soundFontInternals = (target: SoundFontEngine) => target as unknown as SoundFontEngineInternals;

/** 発音の予約時刻だけを見たいので、オシレーターは start / stop の記録だけ持つ */
type MockOscillator = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

/** 余韻スライダーだけを差し替えた音色設定を作る */
const profileWithRelease = (release: number) => ({
  ...DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile,
  release,
});

describe('内蔵音源（SimpleAudioEngine）のリリースの尻尾（Issue #525）', () => {
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
    const createMockGainNode = () => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(), disconnect: vi.fn(),
    });
    const mockContext = {
      state: 'running', currentTime: 0, destination: {},
      resume: vi.fn(), close: vi.fn(),
      createOscillator: vi.fn(createMockOscillator),
      createGain: vi.fn(createMockGainNode),
    };
    vi.stubGlobal('AudioContext', vi.fn(function () { return mockContext; }));
    // Safari 判定は簡易経路へ落ちるため、通常経路を通す UA にしておく
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120' });
  });

  /** 指定の音価・余韻設定で1音を予約し、「いつ止めたか」を返す */
  async function scheduleNote(durationSeconds: number, release: number) {
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    // initialize は出力の下ならし（無音のオシレーター）を1本作るので、
    // ここから先に作られたものだけを「この音符の発音」として見る
    createdOscillators.length = 0;
    engine.setSoundProfile(profileWithRelease(release));
    const startTime = 5;
    await simpleInternals(engine).playNoteAtTime(440, durationSeconds, startTime, 0.5);
    const osc = createdOscillators[0];
    return {
      startedAt: osc.start.mock.calls[0][0] as number,
      stoppedAt: osc.stop.mock.calls[0][0] as number,
      startTime,
    };
  }

  it('全音符は音価ちょうどでは止まらず、そのあとに尻尾が続く', async () => {
    const whole = 4;  // BPM60 の 4/4 で全音符
    const { startedAt, stoppedAt, startTime } = await scheduleNote(whole, 0.5);

    // 開始は記譜どおり（テンポは不変）
    expect(startedAt).toBeCloseTo(startTime, 5);
    // 止まるのは音価の終わりより後。長さは共通の計算どおり
    expect(stoppedAt).toBeCloseTo(startTime + whole + resolveReleaseTailSeconds(0.5, whole), 5);
    expect(stoppedAt).toBeGreaterThan(startTime + whole + MIN_RELEASE_TAIL_SECONDS - 0.001);
  });

  it('余韻スライダーを上げると尻尾が長くなる（開始時刻は変わらない）', async () => {
    const whole = 4;
    const short = await scheduleNote(whole, 0);
    const long = await scheduleNote(whole, 1);

    expect(short.startedAt).toBeCloseTo(long.startedAt, 5);
    expect(long.stoppedAt - short.stoppedAt)
      .toBeCloseTo(MAX_RELEASE_TAIL_SECONDS - MIN_RELEASE_TAIL_SECONDS, 5);
  });

  it('音色ごとの余韻（ギターの tailSeconds）が共通の下限より長い場合は、その長さを保つ', async () => {
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    engine.setSoundProfile(profileWithRelease(1));
    engine.setInstrument(InstrumentType.GUITAR);
    const startTime = 5;
    const whole = 4;
    await simpleInternals(engine).playNoteAtTime(440, whole, startTime, 0.5);

    // ギターは tailSeconds 0.3（余韻スライダー最大で 0.3×1.8=0.54）。
    // 共通の下限（最大 0.6）と比べて長い方が採られる
    const stoppedAt = createdOscillators[0].stop.mock.calls[0][0] as number;
    expect(stoppedAt).toBeGreaterThanOrEqual(startTime + whole + MAX_RELEASE_TAIL_SECONDS - 0.001);
  });
});

describe('SoundFont のリリースの尻尾（Issue #525）', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', vi.fn(function () {
      return { state: 'running', currentTime: 0, destination: {}, resume: vi.fn(), createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })) };
    }));
  });

  it('duration は記譜どおりで、尻尾は release として渡る', () => {
    const engine = new SoundFontEngine();
    engine.setSoundProfile(profileWithRelease(0.5));
    const whole = 4;
    const options = soundFontInternals(engine).buildPlaybackOptions(whole);

    // duration を伸ばすと次の音との重なりが音価に依存して増えるため、尻尾は release 側に持たせる
    expect(options.duration).toBeCloseTo(whole, 5);
    expect(options.release).toBeCloseTo(resolveReleaseTailSeconds(0.5, whole), 5);
    expect(options.release).toBeGreaterThanOrEqual(MIN_RELEASE_TAIL_SECONDS);
  });

  it('余韻スライダーで尻尾の長さが変わる', () => {
    const engine = new SoundFontEngine();
    const whole = 4;
    engine.setSoundProfile(profileWithRelease(0));
    const shortest = soundFontInternals(engine).buildPlaybackOptions(whole).release;
    engine.setSoundProfile(profileWithRelease(1));
    const longest = soundFontInternals(engine).buildPlaybackOptions(whole).release;

    expect(shortest).toBeCloseTo(MIN_RELEASE_TAIL_SECONDS, 5);
    expect(longest).toBeCloseTo(MAX_RELEASE_TAIL_SECONDS, 5);
  });
});
