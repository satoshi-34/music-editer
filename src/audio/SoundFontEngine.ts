import type { Player as SoundFontPlayer } from 'soundfont-player';

import type { PlaybackEngine, PlaybackPart } from './PlaybackEngine';
import type { PlaybackSoundProfile } from './playbackSettings';
import { DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS, getMasterVolumeGain } from './playbackSettings';
import { InstrumentType } from './SoundSource';
import { getDurationBeats, tupletBeatsMultiplier } from '../utils/voiceMeasureUtils';
import { applySwingToTiming } from '../utils/swingUtils';
import { respellDoubleAccidentalKey } from '../utils/noteMidiUtils';

type SoundFontModule = typeof import('soundfont-player');

const DEFAULT_SOUNDFONT_NAME = 'MusyngKite';
const KNOWN_SOUNDFONT_NAMES = new Set([
  'MusyngKite',
  'FluidR3_GM',
  'FatBoy',
  'GeneralUser_GS'
]);

/**
 * アプリ内の楽器名を、SoundFont 側の楽器名へ変換する。
 * SoundFont に同名がない楽器は、近いキャラクターの既存音色へ寄せる。
 */
export function mapInstrumentTypeToSoundFontName(instrument: InstrumentType): string {
  switch (instrument) {
    case InstrumentType.PIANO:
      return 'acoustic_grand_piano';
    case InstrumentType.ORGAN:
      return 'church_organ';
    case InstrumentType.GUITAR:
      return 'acoustic_guitar_steel';
    case InstrumentType.PICCOLO:
      return 'piccolo';
    case InstrumentType.FLUTE:
      return 'flute';
    case InstrumentType.OBOE:
      return 'oboe';
    case InstrumentType.ENGLISH_HORN:
      return 'english_horn';
    case InstrumentType.CLARINET:
      return 'clarinet';
    case InstrumentType.BASSOON:
      return 'bassoon';
    case InstrumentType.SOPRANO_SAX:
      return 'soprano_sax';
    case InstrumentType.ALTO_SAX:
      return 'alto_sax';
    case InstrumentType.TENOR_SAX:
      return 'tenor_sax';
    case InstrumentType.BARITONE_SAX:
      return 'baritone_sax';
    case InstrumentType.TRUMPET:
      return 'trumpet';
    case InstrumentType.TROMBONE:
      return 'trombone';
    case InstrumentType.HORN:
      return 'french_horn';
    case InstrumentType.EUPHONIUM:
      return 'trombone';
    case InstrumentType.TUBA:
      return 'tuba';
    case InstrumentType.TIMPANI:
      return 'timpani';
    case InstrumentType.VIOLIN:
      return 'violin';
    case InstrumentType.VIOLA:
      return 'viola';
    case InstrumentType.CELLO:
      return 'cello';
    case InstrumentType.CONTRABASS:
      return 'contrabass';
    case InstrumentType.PERCUSSION:
      return 'taiko_drum';
    case InstrumentType.STRINGS:
      return 'string_ensemble_1';
    case InstrumentType.BRASS:
      return 'brass_section';
    case InstrumentType.WOODWIND:
      return 'clarinet';
    default:
      return 'acoustic_grand_piano';
  }
}

/**
 * SoundFont パック名を正規化する。
 * 入力が空なら、まずは汎用的で扱いやすい MusyngKite を使う。
 */
export function resolveSoundFontName(rawName: string): string {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return DEFAULT_SOUNDFONT_NAME;
  }

  // SoundFont パック名は外部 URL の一部として使われるため、
  // 既知の安定した候補以外は既定値へ戻して「無音だけどエラーも分かりにくい」状態を減らす。
  if (!KNOWN_SOUNDFONT_NAMES.has(trimmed)) {
    console.warn('[SoundFontEngine] 未対応のSoundFontパック名が指定されたため、既定値へ戻します:', trimmed);
    return DEFAULT_SOUNDFONT_NAME;
  }

  return trimmed;
}

/**
 * SoundFont ベースの再生エンジン。
 * 波形を手作りする代わりに、既存の楽器サンプルを読み込んで鳴らす。
 */
export class SoundFontEngine implements PlaybackEngine {
  private context: AudioContext | null = null;
  private module: SoundFontModule | null = null;
  private currentInstrument: InstrumentType = InstrumentType.PIANO;
  private soundProfile: PlaybackSoundProfile = DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile;
  // スウィング再生のON/OFF。記譜は変えず、再生タイミングだけに影響する。
  private swingEnabled: boolean = DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.swingEnabled;
  private readonly soundfontName: string;
  // playerCache は「同じ楽器をもう一度使うときに、毎回ネット読み込みし直さない」ための置き場。
  // キーは「SoundFontパック名 + 楽器名」の組み合わせにしている。
  private readonly playerCache = new Map<string, SoundFontPlayer>();
  // すべての player の出力をこの GainNode 経由で destination へ流す。
  // ここの gain を変えるだけで全体音量（音量スライダー）が効く。
  private masterGainNode: GainNode | null = null;

  constructor(soundfontName: string = DEFAULT_SOUNDFONT_NAME) {
    this.soundfontName = resolveSoundFontName(soundfontName);
    console.log('[SoundFontEngine] SoundFontEngineが初期化されました:', this.soundfontName);
  }

  async initialize(): Promise<void> {
    // SoundFont でも AudioContext は必要。
    // ここでは「まだ context がない」「一度閉じた」のどちらでも、新しく作り直す。
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      console.log('[SoundFontEngine] AudioContextを作成しました');
    }

    // ブラウザ都合で suspended に戻っている場合は、先に resume してから音源を触る。
    if (this.context.state === 'suspended') {
      await this.context.resume();
      console.log('[SoundFontEngine] AudioContextを再開しました');
    }

    // 初回はここで SoundFont ファイルの読み込みも行う。
    // 2回目以降は playerCache から再利用される。
    await this.getPlayerForCurrentInstrument();
  }

  async playNoteByName(note: string, duration: number = 0.5): Promise<void> {
    await this.initialize();
    const player = await this.getPlayerForCurrentInstrument();
    const context = this.ensureContext();
    const normalizedNote = this.normalizeNoteFormat(note);
    player.play(normalizedNote, context.currentTime, this.buildPlaybackOptions(duration));
    console.log('[SoundFontEngine] 音符を再生:', normalizedNote, duration, '秒');
  }

  async playParts(parts: PlaybackPart[], bpm: number = 120): Promise<void> {
    await this.initialize();
    const context = this.ensureContext();
    const playableParts = await Promise.all(parts.map(async (part) => ({
      part,
      player: await this.getPlayerForInstrument(part.instrument ?? this.currentInstrument),
    })));
    const startTime = context.currentTime;

    // 各パートは同じ「今この瞬間」を基準に予約する。
    // こうすると Promise を待たずに、和音や複数パートが同時にそろって鳴る。
    playableParts.forEach(({ part, player }) => {
      let partTime = startTime;
      for (const measure of part.measures) {
        // measureStartTime は「この小節の頭が絶対時刻でどこか」を固定するための値。
        // startBeat 付きイベントはここを基準に予約すると、
        // 上声と下声が同じ拍から鳴る小節でもずれにくい。
        const measureStartTime = partTime;
        const measureBeats = typeof measure.measureBeats === 'number' ? measure.measureBeats : 4;
        // 途中テンポ変更・速度標語で「この小節だけ速さが違う」ことがある（Issue #458）。
        // 画面側が解決済みの BPM を小節へ載せてくるので、以降の秒換算はすべてこの値で行う。
        // 指定が無い小節は従来どおり引数の全体テンポで鳴らす（後方互換）
        const measureBpm = typeof measure.bpm === 'number' && Number.isFinite(measure.bpm) && measure.bpm > 0
          ? measure.bpm
          : bpm;
        const measureSeconds = measureBeats * (60 / measureBpm);
        if (!measure?.events || measure.events.length === 0) {
          // 空小節でも拍子どおりの長さだけ進める。
          // 3/8 の譜面を 4/4 扱いしてしまうと、左右手がここでずれ始める。
          partTime += measureSeconds;
          continue;
        }

        // スウィングは複合拍子（6/8 等）では対象外にする（swingUtils 参照）。
        const swingActiveForMeasure = this.swingEnabled && !measure.isCompoundMeter;
        // startBeat を持たない単声部イベント用に、小節頭からの拍位置を自前で積み上げていく。
        let sequentialBeatPosition = 0;

        for (const event of measure.events) {
          const durationBeats = getDurationBeats(event.dur as never, event.dots) * tupletBeatsMultiplier((event as any).tuplet);
          const duration = this.durationToSeconds(event.dur, measureBpm, event.dots, (event as any).tuplet);
          // 和音・複数声部で同時発音位置をそろえるための開始拍。
          // startBeat が無い単声部イベントは、直前までの累積位置を使う。
          const nominalStartBeat = typeof event.startBeat === 'number' ? event.startBeat : sequentialBeatPosition;

          // スウィング変換は「鳴らす瞬間の開始位置・長さ」だけに効かせる。
          // 次の音符の並び（sequentialBeatPosition や measure 終端の計算）は
          // 変換前の拍数のまま進めることで、スウィングON/OFFで小節の長さ自体はズレないようにする。
          const swingTiming = swingActiveForMeasure
            ? applySwingToTiming({ startBeat: nominalStartBeat, durationBeats }, event.dur, event.dots, (event as any).tuplet)
            : { startBeat: nominalStartBeat, durationBeats };

          // アーティキュレーションで「鳴らす長さ」だけ伸縮させる。
          // タイミング（次の音までの間隔）は duration のまま据え置く。
          const soundDuration = (swingTiming.durationBeats * (60 / measureBpm)) * (event.durationScale ?? 1);
          const eventStartTime = measureStartTime + (swingTiming.startBeat * (60 / measureBpm));
          if (!event.isRest && event.keys.length > 0) {
            // 和音は keys を1つずつ同じ時刻で予約する。
            // SoundFont 側は単音 player なので、「同時刻に複数 start」を積む形で和音にする。
            const velocity = this.normalizePlaybackVelocity(event.velocity);
            // 既知の制限: soundfont-player は detune/playbackRate 相当のセント単位ピッチシフトを
            // 提供していない（サンプル自体の音高固定のため）。そのため微分音（四分音, event.microtones）
            // は SoundFont 再生では反映されず、記譜どおりの半音に丸まって鳴る（README参照）。
            event.keys.forEach(key => {
              // タイの継続音は開始音の中で鳴り続けているので、ここでは鳴らさない。
              // （鳴らすと「タン・タン」と2回聞こえてしまう）
              if (event.tieSuppressedKeys?.includes(key)) return;
              // タイの開始音は、連鎖の終端（記譜どおりの位置）まで鳴らす。
              // スウィングで開始が動いても終端は動かないため、終端から逆算する
              // （変換後の長さへ extend を足すと表拍/裏拍で長短の誤差が出る・Codex round1 P1）。
              // 開始位置と次の音までの間隔は変えないので、テンポは崩れない。
              const tieExtendBeats = event.tieExtendBeatsByKey?.[key] ?? 0;
              const tiedSoundDuration = tieExtendBeats > 0
                ? ((nominalStartBeat + durationBeats + tieExtendBeats) - swingTiming.startBeat)
                  * (60 / measureBpm) * (event.durationScale ?? 1)
                : soundDuration;
              player.play(
                this.normalizeNoteFormat(key),
                eventStartTime,
                this.buildPlaybackOptions(tiedSoundDuration, velocity)
              );
            });
          }
          if (typeof event.startBeat !== 'number') {
            // startBeat が無いイベントは、従来どおり「前から順に並ぶ単声部」として進める。
            // ここは変換前の duration を使い、スウィングでも小節内の合計拍数がズレないようにする。
            partTime += duration;
            sequentialBeatPosition += durationBeats;
          }
        }
        if (measure.events.some((event) => typeof event.startBeat === 'number')) {
          const measureEndOffset = measure.events.reduce((maxEnd, event) => {
            const startBeat = typeof event.startBeat === 'number'
              ? event.startBeat
              : 0;
            // 付点音符の終端位置も dots を考慮しないと、複数声部小節の
            // 終わりが実際より短く見積もられ、次小節が前倒しになる。
            const endBeat = startBeat + getDurationBeats(event.dur as never, event.dots) * tupletBeatsMultiplier((event as any).tuplet);
            return Math.max(maxEnd, endBeat);
          }, 0);
          // 複数声部の小節は、最後の発音位置だけでなく小節本来の長さも守る。
          // これで「休符で埋めた後半」があっても次小節の頭が前倒しにならない。
          partTime = measureStartTime + Math.max(measureEndOffset * (60 / measureBpm), measureSeconds);
        } else {
          // 単声部でも、入力途中で小節がまだ埋まり切っていない場合がある。
          // 再生では拍子を優先して次小節位置をそろえる。
          partTime = Math.max(partTime, measureStartTime + measureSeconds);
        }
      }
    });

    console.log('[SoundFontEngine] 譜面再生をスケジュールしました:', parts.length, 'パート');
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') {
      await this.context.suspend();
      console.log('[SoundFontEngine] AudioContextを一時停止しました');
    }
  }

  async resume(): Promise<void> {
    await this.initialize();
    console.log('[SoundFontEngine] AudioContextを再開しました');
  }

  stopAll(): void {
    const stopTime = this.context?.currentTime;
    this.playerCache.forEach(player => {
      try {
        player.stop(stopTime);
      } catch (error) {
        console.warn('[SoundFontEngine] stopAll中の停止エラーを無視します:', error);
      }
    });
    console.log('[SoundFontEngine] すべての再生を停止しました');
  }

  dispose(): void {
    try {
      this.stopAll();
      this.playerCache.clear();
      if (this.context) {
        this.context.close();
        this.context = null;
      }
      // 閉じた context に属する GainNode は再利用できないため捨てる
      this.masterGainNode = null;
      console.log('[SoundFontEngine] リソースを解放しました');
    } catch (error) {
      console.error('[SoundFontEngine] dispose中にエラーが発生しました:', error);
    }
  }

  setInstrument(instrument: InstrumentType): void {
    this.currentInstrument = instrument;
    console.log('[SoundFontEngine] 音色を切り替えました:', instrument);
  }

  setSoundProfile(profile: PlaybackSoundProfile): void {
    this.soundProfile = profile;
    // 音量スライダーは再生中でも即座に効かせたいので、マスター GainNode に直接反映する
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = getMasterVolumeGain(profile);
    }
    console.log('[SoundFontEngine] 音色プロファイルを更新しました:', profile);
  }

  setSwingEnabled(enabled: boolean): void {
    this.swingEnabled = enabled;
    console.log('[SoundFontEngine] スウィング再生を切り替えました:', enabled);
  }

  /**
   * player の接続先（マスター GainNode）を返す。
   * AudioContext が作り直されたときは古い GainNode を使えないため、
   * 「いまの context に属しているか」を確認して必要なら作り直す。
   */
  private getOutputNode(context: AudioContext): AudioNode {
    if (!this.masterGainNode || this.masterGainNode.context !== context) {
      this.masterGainNode = context.createGain();
      this.masterGainNode.gain.value = getMasterVolumeGain(this.soundProfile);
      this.masterGainNode.connect(context.destination);
    }
    return this.masterGainNode;
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      throw new Error('AudioContextが初期化されていません');
    }
    return this.context;
  }

  /**
   * 診断専用: 内部の AudioContext を返す。
   * Safari silent failure（issue #14）のヘルスチェックが使う。再生制御には使わない。
   */
  getAudioContext(): AudioContext | null {
    return this.context;
  }

  private async getPlayerForCurrentInstrument(): Promise<SoundFontPlayer> {
    return this.getPlayerForInstrument(this.currentInstrument);
  }

  private async getPlayerForInstrument(instrument: InstrumentType): Promise<SoundFontPlayer> {
    const instrumentName = mapInstrumentTypeToSoundFontName(instrument);
    const cacheKey = `${this.soundfontName}:${instrumentName}`;
    const cached = this.playerCache.get(cacheKey);
    if (cached) {
      // すでに読み込んだ楽器は、ネットアクセスなしでそのまま再利用する。
      return cached;
    }

    const module = await this.loadModule();
    const context = this.ensureContext();

    // notes を絞ると初回ダウンロード量は減らせるが、
    // まずは「どの音域でも鳴る」ことを優先してフルレンジを使う。
    // ここで soundfontName を差し替えると、MusyngKite / FluidR3_GM などを試せる。
    // destination をマスター GainNode にすることで、音量スライダーが全 player に効く。
    const player = await module.instrument(context, instrumentName as never, {
      soundfont: this.soundfontName,
      format: 'mp3',
      destination: this.getOutputNode(context)
    });

    this.playerCache.set(cacheKey, player);
    console.log('[SoundFontEngine] SoundFontを読み込みました:', instrumentName, this.soundfontName);
    return player;
  }

  private async loadModule(): Promise<SoundFontModule> {
    if (this.module) {
      // import 自体もキャッシュして、毎回モジュール解決しないようにする。
      return this.module;
    }

    const loaded = await import('soundfont-player');
    const loadedWithDefault = loaded as SoundFontModule & { default?: SoundFontModule };
    // CommonJS 形式のライブラリを Vite 経由で読むと default に入ることがある。
    // どちらでも扱えるように吸収しておく。
    const moduleLike = typeof loadedWithDefault.instrument === 'function'
      ? loadedWithDefault
      : loadedWithDefault.default;

    if (!moduleLike || typeof moduleLike.instrument !== 'function') {
      throw new Error('soundfont-player の読み込み結果が想定と異なります');
    }

    this.module = moduleLike;
    return moduleLike;
  }

  private durationToSeconds(
    duration: string,
    bpm: number,
    dots?: 1 | 2,
    tuplet?: { numNotes: number; notesOccupied: number }
  ): number {
    // 楽譜データは「4」「8」のような音価文字列なので、
    // まず拍数へ直し、そのあと BPM から秒へ変換する。
    // 付点（dots）の倍率も voiceMeasureUtils と同じ計算式で反映しないと、
    // 付点音符が短く鳴って以降のタイミングが前倒しにずれてしまう。
    // 連符（tuplet）の倍率も同様に反映する（例: 3連符は 2/3 倍）。
    const beats = getDurationBeats(duration as never, dots) * tupletBeatsMultiplier(tuplet);
    return beats * (60 / bpm);
  }

  private normalizeNoteFormat(rawNote: string): string {
    // ダブルシャープ・ダブルフラットは、この下の音名テーブル／サンプル名に無いため、
    // 同じ高さの通常表記（例: c##/4 → d/4）へ先に読み替える。
    // 半音の計算は譜面側と同じ noteMidiUtils に任せ、鳴る高さがずれないようにする。
    const note = respellDoubleAccidentalKey(rawNote);
    if (/^[A-G][#b]?\d+$/.test(note)) {
      return note;
    }

    const vexflowMatch = note.match(/^([a-g])([#b]?)[/\s](\d+)$/);
    if (vexflowMatch) {
      const letter = vexflowMatch[1].toUpperCase();
      const accidental = vexflowMatch[2] || '';
      const octave = vexflowMatch[3];
      return `${letter}${accidental}${octave}`;
    }

    console.warn('[SoundFontEngine] 認識できない音高形式のため、そのまま使います:', note);
    return note;
  }

  private buildPlaybackOptions(duration: number, velocity: number = 0.5) {
    const { brightness, attack, release, richness } = this.soundProfile;

    // SoundFont 側は元サンプルのキャラが強いので、
    // UI の 4 スライダーは「サンプルの上から少し味付けする」程度に留める。
    // ここは耳で触る用の係数なので、違和感があれば少しずつ動かしてよい。
    // - gain: 全体の勢い。brightness と richness の両方を少し反映する
    // - attack: 鳴り始めの速さ
    // - release: 音を離したあとの残り方
    // - duration: release を少し足して、「余韻が増えた」と感じやすくする
    return {
      // gain は音色キャラに加えて、強弱記号から来た velocity でも上下させる。
      // ただし極端な値は歪みや無音の原因になるため、最後に安全域へ丸める。
      gain: Math.max(0.05, Math.min(1, (0.45 + brightness * 0.15 + richness * 0.35) * velocity)),
      attack: 0.001 + attack * 0.04,
      release: 0.05 + release * 0.45,
      duration: duration + release * 0.15
    };
  }

  private normalizePlaybackVelocity(rawVelocity: number | undefined): number {
    if (typeof rawVelocity !== 'number' || !Number.isFinite(rawVelocity)) {
      return 0.5;
    }

    return Math.max(0, Math.min(1, rawVelocity));
  }
}
