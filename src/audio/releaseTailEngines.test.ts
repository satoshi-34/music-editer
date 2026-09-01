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

type MockGainParam = {
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
};

describe('内蔵音源（SimpleAudioEngine）のリリースの尻尾（Issue #525）', () => {
  let createdOscillators: MockOscillator[];
  let createdGains: { gain: MockGainParam }[];

  beforeEach(() => {
    createdOscillators = [];
    createdGains = [];
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
    const createMockGainNode = () => {
      const node = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(), disconnect: vi.fn(),
      };
      createdGains.push(node);
      return node;
    };
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

  it('短い音符では音色固有の尻尾も音符長までに抑える（round1 P2）', async () => {
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    engine.setSoundProfile(profileWithRelease(1));
    engine.setInstrument(InstrumentType.GUITAR);
    const startTime = 5;
    const sixteenth = 0.125;
    await simpleInternals(engine).playNoteAtTime(440, sixteenth, startTime, 0.5);

    // ギター固有の 0.54 秒ではなく、max(0.12, 音符長 0.125) = 0.125 秒で止まる
    const stoppedAt = createdOscillators[0].stop.mock.calls[0][0] as number;
    expect(stoppedAt).toBeCloseTo(startTime + sixteenth + 0.125, 5);
  });

  it('音価の終端に明示のオートメーション点があり、尻尾でほぼゼロへ減衰する（round1 P2）', async () => {
    const whole = 4;
    const startTime = 5;
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    createdGains.length = 0;
    engine.setSoundProfile(profileWithRelease(0.5));
    await simpleInternals(engine).playNoteAtTime(440, whole, startTime, 0.5);

    // 音符用の GainNode を特定する（出力の下ならし等で別の GainNode も作られ得るため全走査）
    const expCalls = createdGains.flatMap(
      (node) => node.gain.exponentialRampToValueAtTime.mock.calls as [number, number][],
    );
    // 音価の終端（startTime+duration）ちょうどの点がある
    expect(expCalls.some(([, time]) => Math.abs(time - (startTime + whole)) < 1e-6)).toBe(true);
    // 尻尾の終端でほぼゼロ（0.0001）へ落とす
    const tail = resolveReleaseTailSeconds(0.5, whole);
    expect(expCalls.some(([value, time]) => value === 0.0001 && Math.abs(time - (startTime + whole + tail)) < 1e-6)).toBe(true);
  });

  it('64分音符でもオートメーション点が時刻順に並ぶ（round2 P2: 終端後に音量が上がらない）', async () => {
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    createdGains.length = 0;
    engine.setSoundProfile(profileWithRelease(1));
    engine.setInstrument(InstrumentType.STRINGS); // attack が長い音色
    const startTime = 5;
    const sixtyFourth = 0.0156; // 240BPM の 64分音符相当
    await simpleInternals(engine).playNoteAtTime(440, sixtyFourth, startTime, 0.5);

    const noteEnd = startTime + sixtyFourth;
    const times = createdGains.flatMap((node) => [
      ...node.gain.setValueAtTime.mock.calls,
      ...node.gain.linearRampToValueAtTime.mock.calls,
      ...node.gain.exponentialRampToValueAtTime.mock.calls,
    ].map((call) => call[1] as number)).filter((t) => t >= startTime);
    // 音価終端より後ろにあるのは尻尾の終端だけ（attack/decay が終端を跨がない）
    const afterEnd = times.filter((t) => t > noteEnd + 1e-9);
    expect(afterEnd.length).toBe(1);
    expect(Math.max(...times.filter((t) => t <= noteEnd + 1e-9))).toBeLessThanOrEqual(noteEnd + 1e-9);
  });

  it('Safari 簡易経路は登録だけで配線を増やさない（round2 P1: 二重配線の検出）', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17 Safari/605' });
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    createdGains.length = 0;
    engine.setSoundProfile(profileWithRelease(0.5));
    await simpleInternals(engine).playNoteAtTime(440, 4, 5, 0.5);

    // 簡易経路は oscillator→gainNode の直結1本だけ（層ゲインを作らない）。
    // registerOscillators を経由すると connect が2回（並列加算）になる
    expect(createdOscillators[0].connect.mock.calls.length).toBe(1);
  });

  it('stopAll は Safari 簡易経路の音（予約済み含む）も止める（round1 P1）', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17 Safari/605' });
    const engine = new SimpleAudioEngine();
    await engine.initialize();
    createdOscillators.length = 0;
    engine.setSoundProfile(profileWithRelease(1));
    await simpleInternals(engine).playNoteAtTime(440, 4, 5, 0.5);
    const osc = createdOscillators[0];
    expect(osc.stop.mock.calls.length).toBe(1); // 予約どおりの停止時刻

    engine.stopAll();
    // 台帳に登録されているので、stopAll で「今すぐ」の停止も予約される
    expect(osc.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(osc.stop.mock.calls.at(-1)![0] as number).toBeCloseTo(0, 5);
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

  it('stopAll は出力経路を世代交代し、旧音の尻尾が後から漏れない（round1/2 P1）', () => {
    const masterGain = { gain: { value: 0.8 }, connect: vi.fn(), disconnect: vi.fn() };
    const oldPlayer = { stop: vi.fn(), connect: vi.fn() };
    const engine = new SoundFontEngine();
    const internals = engine as unknown as {
      context: unknown;
      masterGainNode: unknown;
      playerCache: Map<string, unknown>;
    };
    internals.context = { currentTime: 10 };
    internals.masterGainNode = masterGain;
    internals.playerCache.set('k', oldPlayer);

    engine.stopAll();

    // 旧マスターは destination から切り離され（尻尾は行き場を失う）、
    // 旧マスターへ配線済みの player キャッシュも捨てられる。
    // ゲインを戻す方式（0.08秒後に復帰）だと戻した瞬間に旧音の尻尾が再び聞こえる
    expect(oldPlayer.stop).toHaveBeenCalled();
    expect(masterGain.disconnect).toHaveBeenCalled();
    expect(internals.masterGainNode).toBeNull();
    expect(internals.playerCache.size).toBe(0);
  });

  it('player 作成中に stopAll が走ったら旧世代を捨てて作り直す（round3 P1）', async () => {
    const engine = new SoundFontEngine();
    const internals = engine as unknown as {
      context: unknown;
      masterGainNode: unknown;
      playerCache: Map<string, unknown>;
      loadModule: () => Promise<unknown>;
      ensureContext: () => unknown;
      getPlayerForInstrument: (instrument: InstrumentType) => Promise<unknown>;
    };
    const ctx = { currentTime: 0, destination: {}, createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }) };
    internals.context = ctx;
    internals.ensureContext = () => ctx;

    // 1回目の instrument 作成を保留にして、その間に stopAll を走らせる
    const madePlayers: { stop: ReturnType<typeof vi.fn> }[] = [];
    let resolveFirst: ((p: unknown) => void) | null = null;
    const instrumentMock = vi.fn(() => {
      const player = { stop: vi.fn(), connect: vi.fn() };
      madePlayers.push(player);
      if (madePlayers.length === 1) {
        return new Promise((resolve) => { resolveFirst = () => resolve(player); });
      }
      return Promise.resolve(player);
    });
    internals.loadModule = async () => ({ instrument: instrumentMock });

    const pending = internals.getPlayerForInstrument(InstrumentType.PIANO);
    // loadModule の await を進めて、1回目の instrument 作成が保留になるのを待つ
    await vi.waitFor(() => { expect(instrumentMock).toHaveBeenCalled(); });
    engine.stopAll(); // 世代交代（先読みも1回走る）
    resolveFirst!(null as never);
    const player = await pending;

    // 返るのは新世代で作り直した player（保留中だった1個目ではない）。
    // 1個目は停止され、キャッシュにも入らない
    expect(player).not.toBe(madePlayers[0]);
    expect(madePlayers[0].stop).toHaveBeenCalled();
    expect(Array.from(internals.playerCache.values())).not.toContain(madePlayers[0]);
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
