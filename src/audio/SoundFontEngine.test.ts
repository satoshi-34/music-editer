import { describe, expect, it, vi } from 'vitest';
import { SCHEDULE_LEAD_SECONDS } from './scheduleLead';
import { resetAllDevTuning, setDevTuningOverride } from '../utils/devTuning';
import { resolveReleaseTailSeconds } from './releaseTail';

import { InstrumentType } from './SoundSource';
import {
  SoundFontEngine,
  mapInstrumentTypeToSoundFontName,
  resolveSoundFontName
} from './SoundFontEngine';

describe('SoundFontEngine helpers', () => {
  it('楽器タイプを SoundFont の既知名へ変換できる', () => {
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.PIANO)).toBe('acoustic_grand_piano');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.CLARINET)).toBe('clarinet');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.HORN)).toBe('french_horn');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.STRINGS)).toBe('string_ensemble_1');
    expect(mapInstrumentTypeToSoundFontName(InstrumentType.PERCUSSION)).toBe('taiko_drum');
  });

  it('SoundFont パック名が空なら既定値へフォールバックする', () => {
    expect(resolveSoundFontName('')).toBe('MusyngKite');
    expect(resolveSoundFontName('   ')).toBe('MusyngKite');
    expect(resolveSoundFontName('FluidR3_GM')).toBe('FluidR3_GM');
  });

  it('未知の SoundFont パック名は既定値へ戻す', () => {
    expect(resolveSoundFontName('Kontakt')).toBe('MusyngKite');
    expect(resolveSoundFontName('MyCustomPack')).toBe('MusyngKite');
  });

  it('再生オプション生成で velocity を gain に反映する', () => {
    const engine = new SoundFontEngine();

    const quietOptions = (engine as any).buildPlaybackOptions(0.5, 0.22);
    const loudOptions = (engine as any).buildPlaybackOptions(0.5, 0.74);

    expect(quietOptions.gain).toBeLessThan(loudOptions.gain);
    expect(quietOptions.gain).toBeGreaterThan(0);
    expect(loudOptions.gain).toBeLessThanOrEqual(1);
  });

  it('付点音符は dots に応じて1.5倍・1.75倍の長さに変換される', () => {
    const engine = new SoundFontEngine();
    const bpm = 120;
    // BPM=120 なら4分音符=0.5秒。付点4分音符は 0.5 * 1.5 = 0.75秒になるはず。
    const quarterSeconds = (engine as any).durationToSeconds('4', bpm);
    const dottedQuarterSeconds = (engine as any).durationToSeconds('4', bpm, 1);
    const doubleDottedQuarterSeconds = (engine as any).durationToSeconds('4', bpm, 2);

    expect(dottedQuarterSeconds).toBeCloseTo(quarterSeconds * 1.5);
    expect(doubleDottedQuarterSeconds).toBeCloseTo(quarterSeconds * 1.75);
  });
});

/**
 * SoundFont ファイルの読み込みなど、外へ出る内部メソッドを型付きで差し替えるための入り口。
 */
type SoundFontEngineInternals = {
  getPlayerForInstrument: (instrument: InstrumentType) => Promise<{ play: (...args: unknown[]) => unknown }>;
  buildPlaybackOptions: (duration: number, velocity?: number) => { gain: number; attack: number; release: number; duration: number };
};
const internals = (target: SoundFontEngine) => target as unknown as SoundFontEngineInternals;

/**
 * SoundFont の実ファイルは読みに行かず、play を記録するだけの偽 player を差し込む。
 * これで「いつ・どの音を・何秒鳴らすよう予約したか」だけを検証できる。
 * タイ再生（#445）とテンポ変更（#458）の両方から使う共通の足場。
 */
const setupEngineWithFakePlayer = async () => {
  const play = vi.fn();
  vi.stubGlobal('AudioContext', vi.fn(function () {
    return { state: 'running', currentTime: 0, destination: {}, resume: vi.fn(), createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })) };
  }));
  const engine = new SoundFontEngine();
  vi.spyOn(internals(engine), 'getPlayerForInstrument').mockResolvedValue({ play });
  await engine.initialize();
  return { engine, play };
};

describe('SoundFontEngine のタイ再生（Issue #445）', () => {
  it('先頭の音は「今」ではなく先読みリードぶん先に予約される（Issue #610）', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();
    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        events: [{ dur: '4', isRest: false, keys: ['C4'] }],
      }],
    }], 120);
    expect(play).toHaveBeenCalledTimes(1);
    // 偽の AudioContext は currentTime: 0。内蔵音源と同じ定数ぶん先に予約する
    expect(play.mock.calls[0][1]).toBeCloseTo(SCHEDULE_LEAD_SECONDS, 5);

    // dev の上書きが実際の予約時刻へ届く（定数を直接使う退行を検出）
    setDevTuningOverride('audio.scheduleLead', 0.3);
    try {
      play.mockClear();
      await engine.playParts([{
        measures: [{ measureBeats: 4, events: [{ dur: '4', isRest: false, keys: ['C4'] }] }],
      }], 120);
      expect(play.mock.calls[0][1]).toBeCloseTo(0.3, 5);
    } finally {
      resetAllDevTuning();
    }
  });

  it('同時発音数の上限を超える和音は、上限ぶんだけ予約される（Issue #605）', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();
    setDevTuningOverride('audio.maxPolyphony', 4);
    try {
      await engine.playParts([{
        measures: [{
          measureBeats: 4,
          events: [{ dur: '1', isRest: false, keys: ['C3', 'E3', 'G3', 'C4', 'E4', 'G4'] }],
        }],
      }], 120);
      expect(play).toHaveBeenCalledTimes(4);
      // 残った音は入力順の後ろ側（新しい側）
      expect(play.mock.calls.map((call) => call[0])).toEqual(['G3', 'C4', 'E4', 'G4']);
    } finally {
      resetAllDevTuning();
    }
  });

  it('ペダルで伸びた古い音は、上限に達した時点で新しい音の開始時刻まで詰められる（Issue #605）', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();
    setDevTuningOverride('audio.maxPolyphony', 2);
    try {
      // 120BPM: 4分=0.5秒。3音とも小節末まで踏みっぱなし（延長 3/2/1 拍）
      await engine.playParts([{
        measures: [{
          measureBeats: 4,
          events: [
            { dur: '4', isRest: false, keys: ['C4'], pedalExtendBeatsByKey: { C4: 3 } },
            { dur: '4', isRest: false, keys: ['D4'], pedalExtendBeatsByKey: { D4: 2 } },
            { dur: '4', isRest: false, keys: ['E4'], pedalExtendBeatsByKey: { E4: 1 } },
          ],
        }],
      }], 120);
      expect(play).toHaveBeenCalledTimes(3);
      // C4 は本来 2.0 秒（小節末まで）だが、3音目 E4 が始まる 1.0 秒で**余韻ごと**終わる
      // （round1 P1: 余韻を含めないと詰めた音の尻尾と新しい音が重なって上限を超える）。
      // 鳴らす長さは 1.0 − 余韻
      const tail = resolveReleaseTailSeconds(
        (engine as unknown as { soundProfile: { release: number } }).soundProfile.release, 2.0);
      expect(tail).toBeGreaterThan(0);
      const c4 = play.mock.calls.find((call) => call[0] === 'C4')!;
      expect(c4[2].duration).toBeCloseTo(internals(engine).buildPlaybackOptions(1.0 - tail).duration, 5);
      const d4 = play.mock.calls.find((call) => call[0] === 'D4')!;
      expect(d4[2].duration).toBeCloseTo(internals(engine).buildPlaybackOptions(1.5).duration, 5);
    } finally {
      resetAllDevTuning();
    }
  });

  it('タイ2音は「1回の発音・合計の長さ」で予約される', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    // BPM=120 なら4分音符=0.5秒。タイで結んだ2音は 1.0秒 の1音として鳴るはず。
    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        events: [
          { dur: '4', isRest: false, keys: ['C4'], tieExtendBeatsByKey: { C4: 1 } },
          { dur: '4', isRest: false, keys: ['C4'], tieSuppressedKeys: ['C4'] },
        ],
      }],
    }], 120);

    expect(play).toHaveBeenCalledTimes(1);
    // 予約される duration には音色設定ぶんの余韻が足されるので、
    // 「1.0秒ぶんの音を予約したときの値」と比べる。
    const expectedDuration = internals(engine).buildPlaybackOptions(1.0).duration;
    expect(play.mock.calls[0][2].duration).toBeCloseTo(expectedDuration, 5);
  });

  it('テンポ変更をまたぐタイは、またいだ先のテンポで積算される（#458 round2 P2）', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    // 1小節目 60BPM の4拍目から、2小節目 120BPM の頭1拍へタイ → 1.0+0.5=1.5秒
    await engine.playParts([{
      measures: [
        {
          bpm: 60,
          measureBeats: 4,
          events: [
            { dur: '2', isRest: true, keys: ['B4'] },
            { dur: '4', isRest: true, keys: ['B4'] },
            { dur: '4', isRest: false, keys: ['C4'], tieExtendBeatsByKey: { C4: 1 } },
          ],
        },
        {
          bpm: 120,
          measureBeats: 4,
          events: [
            { dur: '4', isRest: false, keys: ['C4'], tieSuppressedKeys: ['C4'] },
          ],
        },
      ],
    }], 60);

    expect(play).toHaveBeenCalledTimes(1);
    // 開始小節BPM一律だと 2拍×1.0秒=2.0秒。正しくは 1.5秒
    const expectedDuration = internals(engine).buildPlaybackOptions(1.5).duration;
    expect(play.mock.calls[0][2].duration).toBeCloseTo(expectedDuration, 5);
  });

  it('全体テンポ60（小節bpm省略）のタイは、既定120ではなく実効60で数える（#458 round2 P2）', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        events: [
          { dur: '4', isRest: false, keys: ['C4'], tieExtendBeatsByKey: { C4: 1 } },
          { dur: '4', isRest: false, keys: ['C4'], tieSuppressedKeys: ['C4'] },
        ],
      }],
    }], 60);

    expect(play).toHaveBeenCalledTimes(1);
    // 60BPM の2拍=2.0秒（固定120退行だと1.0秒）
    const expectedDuration = internals(engine).buildPlaybackOptions(2.0).duration;
    expect(play.mock.calls[0][2].duration).toBeCloseTo(expectedDuration, 5);
  });

  it('和音では結ばれた音だけが伸び、結ばれていない音は2回鳴る', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    await engine.playParts([{
      measures: [{
        measureBeats: 4,
        events: [
          { dur: '4', isRest: false, keys: ['C4', 'E4'], tieExtendBeatsByKey: { E4: 1 } },
          { dur: '4', isRest: false, keys: ['C4', 'E4'], tieSuppressedKeys: ['E4'] },
        ],
      }],
    }], 120);

    const played = play.mock.calls.map((call) => ({ note: call[0], duration: call[2].duration }));
    // C4 は2回（各0.5秒）、E4 は1回（1.0秒）
    expect(played.filter((p) => p.note === 'C4')).toHaveLength(2);
    const e4 = played.filter((p) => p.note === 'E4');
    expect(e4).toHaveLength(1);
    expect(e4[0].duration).toBeCloseTo(internals(engine).buildPlaybackOptions(1.0).duration, 5);
    expect(played.filter((p) => p.note === 'C4')[0].duration)
      .toBeCloseTo(internals(engine).buildPlaybackOptions(0.5).duration, 5);
  });
});

describe('SoundFontEngine の小節ごとのテンポ（Issue #458）', () => {
  it('bpm が付いた小節は、その小節の音がその速さで予約される', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    // 1小節目は引数の全体テンポ 60（4分音符=1秒）、2小節目は bpm=120（4分音符=0.5秒）
    await engine.playParts([{
      measures: [
        { measureBeats: 4, events: [{ dur: '4', isRest: false, keys: ['C4'] }] },
        { measureBeats: 4, bpm: 120, events: [{ dur: '4', isRest: false, keys: ['D4'] }] },
      ],
    }], 60);

    const played = play.mock.calls.map((call) => ({ note: call[0], at: call[1] - SCHEDULE_LEAD_SECONDS /* 先読みリード（#610）を除いた相対時刻 */, duration: call[2].duration }));
    expect(played).toHaveLength(2);
    // 1小節目: 60BPM なので頭は 0秒・長さは1秒ぶん
    expect(played[0].at).toBeCloseTo(0, 6);
    expect(played[0].duration).toBeCloseTo(internals(engine).buildPlaybackOptions(1.0).duration, 5);
    // 2小節目の頭は「1小節目ぶん（4拍 × 1秒）」の直後。長さは 120BPM の 0.5秒
    expect(played[1].at).toBeCloseTo(4, 6);
    expect(played[1].duration).toBeCloseTo(internals(engine).buildPlaybackOptions(0.5).duration, 5);
  });

  it('bpm が付いた小節は、次の小節の開始位置もその速さで進む', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    await engine.playParts([{
      measures: [
        { measureBeats: 4, bpm: 120, events: [{ dur: '4', isRest: false, keys: ['C4'] }] },
        { measureBeats: 4, bpm: 120, events: [{ dur: '4', isRest: false, keys: ['D4'] }] },
      ],
    }], 60);

    const played = play.mock.calls.map((call) => ({ note: call[0], at: call[1] - SCHEDULE_LEAD_SECONDS /* 先読みリード（#610）を除いた相対時刻 */ }));
    // 120BPM の小節は 4拍 × 0.5秒 = 2秒。次の小節はその直後から始まる
    expect(played[1].at).toBeCloseTo(2, 6);
  });

  it('bpm の無い小節は従来どおり引数の全体テンポで鳴る（後方互換）', async () => {
    const { engine, play } = await setupEngineWithFakePlayer();

    await engine.playParts([{
      measures: [
        { measureBeats: 4, events: [{ dur: '4', isRest: false, keys: ['C4'] }] },
        { measureBeats: 4, events: [{ dur: '4', isRest: false, keys: ['D4'] }] },
      ],
    }], 120);

    const played = play.mock.calls.map((call) => ({ at: call[1] - SCHEDULE_LEAD_SECONDS /* 先読みリード（#610）を除いた相対時刻 */ }));
    // 120BPM = 1小節2秒
    expect(played[1].at).toBeCloseTo(2, 6);
  });
});
