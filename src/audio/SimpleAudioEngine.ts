// src/audio/SimpleAudioEngine.ts
// Web Audio APIを直接使用したシンプルな音声エンジン
// ブラウザの自動再生ポリシーに完全対応

import { beatSpanToSeconds, tempoSegmentsFrom } from '../utils/tempoPlaybackUtils';
import { InstrumentType } from './SoundSource';
import type { PlaybackEngine, PlaybackPart } from './PlaybackEngine';
import {
  DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
  getMasterVolumeGain,
  type PlaybackSoundProfile
} from './playbackSettings';
import { applySwingToTiming } from '../utils/swingUtils';
import { respellDoubleAccidentalKey } from '../utils/noteMidiUtils';

interface SimpleInstrumentConfig {
  // 1つの音色を何本の波で作るかを表す。
  // 例: ギターなら「胴鳴り」「高い倍音」などを別の波として薄く重ねる。
  oscillators: Array<{
    // type は波形の種類。
    // おおまかな印象:
    // - sine: いちばん丸い
    // - triangle: 丸いが、少しだけ輪郭がある
    // - sawtooth: 明るい、シャリっとしやすい
    // - square: 硬い、存在感が強い
    type: OscillatorType;
    // detune は「ほんの少しだけ音程をずらす量」。
    // 複数の波を少しずらすと、1本の棒のような音ではなく、
    // 複数の弦や倍音が鳴っているような広がりを作りやすい。
    detune?: number;
    // gainRatio は、その層をどのくらい目立たせるか。
    // 調整の考え方:
    // - 上げる: その波形の個性が強く出る
    // - 下げる: 隠し味になる
    gainRatio?: number;
  }>;
  // attack は「鳴り始めるまでの速さ」。
  // 値を小さくすると、ピックで弾いたような鋭い立ち上がりになる。
  attack: number;
  // peakGain は「最初にどこまで大きくするか」。
  // 大きすぎると音割れしやすいので、印象と安全性のバランスを見る。
  peakGain: number;
  // decayTarget は「最初の強い音が落ち着いたあと、どこまで音量を残すか」。
  // 小さいほど歯切れがよく、大きいほど鳴りが残る。
  decayTarget: number;
  // releaseFloor は「最後に消える直前の小ささ」。
  // 0に近いほどスッと消え、少し残すと余韻が感じやすい。
  releaseFloor: number;
  // tailSeconds は、見た目の音価よりどれだけ長く余韻を残すか。
  // アコギの残響感を少し出したいときに使う。
  tailSeconds?: number;
}

/**
 * シンプルな音声エンジンクラス
 * Tone.jsを使わずにWeb Audio APIを直接使用してブラウザの自動再生ポリシーに対応
 */
export class SimpleAudioEngine implements PlaybackEngine {
  private context: AudioContext | null = null;
  private isInitialized: boolean = false;
  private oscillators: Map<string, { oscillators: OscillatorNode[]; gainNode: GainNode }> = new Map();
  private oscillatorCounter: number = 0;
  private currentInstrument: InstrumentType = InstrumentType.PIANO;
  private hasPrimedOutput: boolean = false;
  private soundProfile: PlaybackSoundProfile = DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile;
  // スウィング再生のON/OFF。記譜は変えず、再生タイミングだけに影響する。
  private swingEnabled: boolean = DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.swingEnabled;
  // すべての発音をこの GainNode 経由で destination へ流す。
  // ここの gain を変えるだけで全体音量（音量スライダー）が効く。
  private masterGainNode: GainNode | null = null;

  constructor() {
    console.log('[SimpleAudioEngine] SimpleAudioEngineが初期化されました（AudioContextはユーザーインタラクション時に作成）');
  }

  /**
   * AudioContextを初期化する（ユーザーインタラクション時のみ）
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized && this.context) {
        const currentState = this.context.state as AudioContextState | 'interrupted';

        if (currentState === 'closed') {
          console.warn('[SimpleAudioEngine] 既存のAudioContextが closed のため再作成します');
          this.context = null;
          this.isInitialized = false;
        } else {
          // Safari などでは既存の AudioContext が suspended に戻ることがある。
          // その場合は再利用前に resume して、再生要求が無音で終わらないようにする。
          if (currentState === 'suspended' || currentState === 'interrupted') {
            console.log('[SimpleAudioEngine] 既存のAudioContextを再開します...', currentState);
            await this.context.resume();
            console.log('[SimpleAudioEngine] AudioContext再開完了:', this.context.state);
            this.hasPrimedOutput = false;
          }

          if (this.context.state === 'running') {
            return;
          }

          console.warn('[SimpleAudioEngine] AudioContextが running にならないため再作成します:', this.context.state);
          try {
            await this.context.close();
          } catch {
            // close 失敗時も新しい context 作成は続行する
          }
          this.context = null;
          this.isInitialized = false;
        }
      }

      console.log('[SimpleAudioEngine] AudioContextを作成します...');
      
      // ユーザーインタラクション時にAudioContextを作成
      this.context = new AudioContext();
      
      console.log('[SimpleAudioEngine] AudioContext作成完了:', this.context.state);
      
      // AudioContextが suspended 状態の場合は resume
      if (this.context.state === 'suspended') {
        console.log('[SimpleAudioEngine] AudioContextを開始します...');
        await this.context.resume();
        console.log('[SimpleAudioEngine] AudioContext開始完了:', this.context.state);
      }

      await this.primeOutput();
      
      this.isInitialized = true;
      console.log('[SimpleAudioEngine] 初期化が完了しました');
      
    } catch (error) {
      console.error('[SimpleAudioEngine] 初期化に失敗しました:', error);
      throw new Error(`音声エンジンの初期化に失敗しました: ${error}`);
    }
  }

  /**
   * 音符を再生する
   */
  async playNote(frequency: number, duration: number = 0.5): Promise<void> {
    await this.ensureContextReady();
    const context = this.context;
    if (!context) {
      throw new Error('AudioContextが初期化されていません');
    }

    try {
      console.log('[SimpleAudioEngine] 音符を再生:', frequency, 'Hz', duration, '秒');

      if (this.shouldUseSafariSafeVoice()) {
        this.playSafariSafeVoice(context, frequency, duration, context.currentTime);
        console.log('[SimpleAudioEngine] Safari向け簡易発音を使用しました');
        console.log('[SimpleAudioEngine] 音符再生開始');
        return;
      }
      
      // GainNode は「音量の包み紙」の役割。
      // 音そのものは OscillatorNode が作り、gain で立ち上がりと余韻を整える。
      const gainNode = context.createGain();
      const instrumentConfig = this.getInstrumentConfig();
      const oscillators = this.createOscillators(
        context,
        frequency,
        context.currentTime,
        instrumentConfig
      );
      const oscillatorId = this.registerOscillators(oscillators, gainNode, instrumentConfig, context.currentTime);
      
      // エンベロープ（音量の時間変化）を 3 段階で作る。
      // 1. すぐ立ち上げる
      // 2. 少しだけ減衰させる
      // 3. 余韻を残しながら消す
      const adjustedAttack = this.getAdjustedAttack(instrumentConfig.attack);
      const adjustedPeakGain = this.getAdjustedPeakGain(instrumentConfig.peakGain);
      const adjustedDecayTarget = this.getAdjustedDecayTarget(instrumentConfig.decayTarget);
      const adjustedReleaseFloor = this.getAdjustedReleaseFloor(instrumentConfig.releaseFloor);
      const adjustedTailSeconds = this.getAdjustedTailSeconds(instrumentConfig.tailSeconds ?? 0);
      gainNode.gain.setValueAtTime(0, context.currentTime);
      gainNode.gain.linearRampToValueAtTime(adjustedPeakGain, context.currentTime + adjustedAttack);
      gainNode.gain.exponentialRampToValueAtTime(
        adjustedDecayTarget,
        context.currentTime + Math.max(adjustedAttack + 0.01, duration * 0.3)
      );
      gainNode.gain.exponentialRampToValueAtTime(
        adjustedReleaseFloor,
        context.currentTime + duration + adjustedTailSeconds
      );
      
      // 先頭のオシレーターだけ ended を監視すれば、
      // まとまりとしての「この音の終了」を検知できる。
      oscillators.forEach((oscillator, index) => {
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime + duration + adjustedTailSeconds);
        if (index === 0) {
          oscillator.addEventListener('ended', () => {
            this.cleanupOscillator(oscillatorId, gainNode);
          }, { once: true });
        }
      });
      
      console.log('[SimpleAudioEngine] 音符再生開始');
      
    } catch (error) {
      console.error('[SimpleAudioEngine] 音符再生に失敗:', error);
      throw error;
    }
  }

  /**
   * 画面側からは「C4 を 0.5 秒鳴らす」のように音名で呼びたい場面が多い。
   * SimpleAudioEngine は周波数ベースなので、ここで橋渡しする。
   */
  async playNoteByName(note: string, duration: number = 0.5): Promise<void> {
    await this.playNote(this.noteToFrequency(note), duration);
  }

  /**
   * 音高名から周波数を計算する
   * Vexflow形式（c/4）とMIDI形式（C4）の両方に対応
   *
   * @param centsOffset 微分音（四分音）などのセント単位の補正。+50/-50で四分音上げ下げになる。
   */
  noteToFrequency(note: string, centsOffset: number = 0): number {
    // Vexflow形式（c/4）をMIDI形式（C4）に変換
    const normalizedNote = this.normalizeNoteFormat(note);
    
    // 音高名から周波数への変換テーブル（C4 = 261.63Hz）
    const noteMap: Record<string, number> = {
      'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
      'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };

    // 音高名を解析（例: "C4", "F#3"）
    const match = normalizedNote.match(/^([A-G][#b]?)(\d+)$/);
    if (!match) {
      console.warn('[SimpleAudioEngine] 無効な音高名:', note, '->', normalizedNote);
      return 440; // デフォルトはA4
    }

    const noteName = match[1];
    const octave = parseInt(match[2]);
    
    const noteNumber = noteMap[noteName];
    if (noteNumber === undefined) {
      console.warn('[SimpleAudioEngine] 無効な音高名:', noteName);
      return 440;
    }

    // A4 (440Hz) を基準とした周波数計算
    const A4 = 440;
    const semitoneRatio = Math.pow(2, 1/12);
    const semitonesFromA4 = (octave - 4) * 12 + (noteNumber - 9);
    
    let frequency = A4 * Math.pow(semitoneRatio, semitonesFromA4);
    // 微分音（四分音）の補正。centsOffset が 0 のときは何も変わらない。
    if (centsOffset !== 0) {
      frequency *= Math.pow(2, centsOffset / 1200);
    }
    console.log('[SimpleAudioEngine] 音高変換:', note, '->', normalizedNote, '->', frequency.toFixed(2), 'Hz');

    return frequency;
  }

  /**
   * Vexflow形式（c/4）をMIDI形式（C4）に正規化する
   * @param note 音高名（c/4, C4, f#/3, F#3 など）
   * @returns MIDI形式の音高名（C4, F#3 など）
   */
  private normalizeNoteFormat(rawNote: string): string {
    // ダブルシャープ・ダブルフラットは、この下の音名テーブル／サンプル名に無いため、
    // 同じ高さの通常表記（例: c##/4 → d/4）へ先に読み替える。
    // 半音の計算は譜面側と同じ noteMidiUtils に任せ、鳴る高さがずれないようにする。
    const note = respellDoubleAccidentalKey(rawNote);
    // 既にMIDI形式（C4, F#3など）の場合はそのまま返す
    if (/^[A-G][#b]?\d+$/.test(note)) {
      return note;
    }
    
    // Vexflow形式（c/4, f#/3など）をMIDI形式に変換
    const vexflowMatch = note.match(/^([a-g])([#b]?)[/\s](\d+)$/);
    if (vexflowMatch) {
      const letter = vexflowMatch[1].toUpperCase(); // 大文字に変換
      const accidental = vexflowMatch[2] || '';     // 臨時記号
      const octave = vexflowMatch[3];               // オクターブ
      return `${letter}${accidental}${octave}`;
    }
    
    // 認識できない形式の場合は警告してそのまま返す
    console.warn('[SimpleAudioEngine] 認識できない音高形式:', note);
    return note;
  }

  /**
   * 音価から秒数を計算する。
   * 付点（dots）・連符（tuplet）の倍率も SoundFontEngine と同じ式で反映する。
   * 以前は dur だけを見ていたため、付点・連符のイベントは並びの時間が
   * ずれていた（トリル再生対応 PR #479 の Codex 指摘で発覚した既存の穴）。
   */
  durationToSeconds(
    duration: string,
    bpm: number = 120,
    dots?: 1 | 2,
    tuplet?: { numNotes: number; notesOccupied: number },
  ): number {
    const durMap: Record<string, number> = {
      '1': 4,     // 全音符
      '2': 2,     // 2分音符
      '4': 1,     // 4分音符
      '8': 0.5,   // 8分音符
      '16': 0.25, // 16分音符
      '32': 0.125,// 32分音符
      '64': 0.0625// 64分音符
    };

    const dotMultiplier = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1;
    const tupletMultiplier = tuplet && tuplet.numNotes ? tuplet.notesOccupied / tuplet.numNotes : 1;
    const beats = (durMap[duration] || 1) * dotMultiplier * tupletMultiplier;
    const secondsPerBeat = 60 / bpm;
    const seconds = beats * secondsPerBeat;

    return seconds;
  }

  /**
   * AudioContextの状態を取得する
   */
  getState(): AudioContextState | 'uninitialized' {
    if (!this.context) {
      return 'uninitialized';
    }
    return this.context.state;
  }

  /**
   * 診断専用: 内部の AudioContext を返す。
   * Safari silent failure（issue #14）のヘルスチェックが使う。再生制御には使わない。
   */
  getAudioContext(): AudioContext | null {
    return this.context;
  }

  /**
   * AudioContext を一時停止する
   */
  async suspend(): Promise<void> {
    if (!this.context) {
      return;
    }

    if (this.context.state === 'running') {
      await this.context.suspend();
      console.log('[SimpleAudioEngine] AudioContextを一時停止しました');
    }
  }

  /**
   * AudioContext を再開する
   */
  async resume(): Promise<void> {
    await this.ensureContextReady();
    console.log('[SimpleAudioEngine] AudioContextを再開しました');
  }

  /**
   * AudioEngineが使用可能かチェックする
   */
  isReady(): boolean {
    return this.isInitialized && this.context !== null && this.context.state === 'running';
  }

  /**
   * 譜面データから音符を順次再生する
   */
  async playScore(
    scoreData: Array<{
      events: Array<{
        dur: string;
        isRest: boolean;
        keys: string[];
        startBeat?: number;
        velocity?: number;
        durationScale?: number;
        dots?: 1 | 2;
        tuplet?: { numNotes: number; notesOccupied: number };
        microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[];
        tieExtendBeatsByKey?: Record<string, number>;
        tieSuppressedKeys?: string[];
      }>;
      measureBeats?: number;
      isCompoundMeter?: boolean;
      /** この小節のテンポ（BPM）。省略時は引数 bpm（全体テンポ）を使う（Issue #458） */
      bpm?: number;
    }>,
    bpm: number = 120,
    startTime?: number
  ): Promise<void> {
    await this.ensureContextReady();
    const context = this.context;
    if (!context) {
      throw new Error('AudioContextが初期化されていません');
    }

    try {
      console.log('[SimpleAudioEngine] 譜面再生を開始:', scoreData.length, '小節');
      
      let currentTime = startTime ?? context.currentTime;
      
      // 各小節を順次処理
      for (let measureIndex = 0; measureIndex < scoreData.length; measureIndex++) {
        const measure = scoreData[measureIndex];
        // currentTime は「次のイベントをどこから積むか」を表す一方、
        // startBeat 付きイベントでは小節頭を基準にしたい。
        // そのため小節開始時刻を別変数で退避しておく。
        const measureStartTime = currentTime;
        const measureBeats = typeof measure?.measureBeats === 'number' ? measure.measureBeats : 4;
        // 途中テンポ変更・速度標語で「この小節だけ速さが違う」ことがある（Issue #458）。
        // 画面側が解決済みの BPM を小節へ載せてくるので、以降の秒換算はすべてこの値で行う。
        // 指定が無い小節は従来どおり引数の全体テンポで鳴らす（後方互換）
        const measureBpm = typeof measure?.bpm === 'number' && Number.isFinite(measure.bpm) && measure.bpm > 0
          ? measure.bpm
          : bpm;
        const measureSeconds = measureBeats * (60 / measureBpm);
        if (!measure || !measure.events || measure.events.length === 0) {
          // 空小節でも拍子どおりの長さだけ進める。
          // 3/8 の譜面を 4/4 扱いすると、ここで他パートとずれてしまう。
          currentTime += measureSeconds;
          continue;
        }
        
        let maxMeasureEndTime = currentTime;
        const secondsPerBeat = 60 / measureBpm;
        // スウィングは複合拍子（6/8 等）では対象外にする（swingUtils 参照）。
        const swingActiveForMeasure = this.swingEnabled && !measure.isCompoundMeter;

        // 小節内の各音符を処理
        for (const event of measure.events) {
          const duration = this.durationToSeconds(event.dur, measureBpm, event.dots, event.tuplet);
          // startBeat を持たない単声部イベントは、直前までの累積時間から拍位置を逆算する。
          const nominalStartBeat = typeof event.startBeat === 'number'
            ? event.startBeat
            : (currentTime - measureStartTime) / secondsPerBeat;
          const nominalDurationBeats = duration / secondsPerBeat;

          // スウィング変換は「鳴らす瞬間の開始位置・長さ」だけに効かせる。
          // 小節内の並び（currentTime や maxMeasureEndTime）は変換前の duration のまま進め、
          // スウィングON/OFFで小節の長さ自体がズレないようにする。
          const swingTiming = swingActiveForMeasure
            ? applySwingToTiming(
                { startBeat: nominalStartBeat, durationBeats: nominalDurationBeats },
                event.dur as never,
                event.dots,
                event.tuplet
              )
            : { startBeat: nominalStartBeat, durationBeats: nominalDurationBeats };

          // アーティキュレーションで「鳴らす長さ」だけ伸縮させる。
          // タイミング（次の音までの間隔）は duration のまま据え置く。
          const soundDuration = (swingTiming.durationBeats * secondsPerBeat) * (event.durationScale ?? 1);
          const eventStartTime = measureStartTime + (swingTiming.startBeat * secondsPerBeat);

          // 内蔵エンジンは先頭音（keys[0]）だけを鳴らす単音再生なので、
          // タイの判定も先頭音について行う。
          const primaryKey = event.keys?.[0];
          const tieSuppressed = primaryKey != null && (event.tieSuppressedKeys?.includes(primaryKey) ?? false);
          if (!event.isRest && event.keys && event.keys.length > 0 && !tieSuppressed) {
            // 音符の場合は最初の音高を再生（単音対応）。
            // 微分音（四分音）は先頭音（keyIndex 0）にだけ対応する既知の制限がある。
            // 和音2音目以降の微分音は、クリック確認音・ピアノ譜描画では反映されるが、
            // 内蔵エンジンでの譜面全体再生では鳴らない（README参照）。
            const microtoneForFirstKey = event.microtones?.find(m => m.keyIndex === 0);
            const centsOffset = microtoneForFirstKey
              ? (microtoneForFirstKey.type === 'quarterSharp' ? 50 : -50)
              : 0;
            const frequency = this.noteToFrequency(event.keys[0], centsOffset);
            // タイの開始音は、連鎖の終端（記譜どおりの位置）まで鳴らす。
            // スウィングで開始が動いた場合も「終端は動かない」ので、単純に
            // 変換後の長さへ extend を足すのではなく、終端から逆算する
            // （表拍8分+裏拍8分のタイが 7/6 拍に伸びる誤差の防止・Codex round1 P1）。
            // 次の音の位置（currentTime）は下で duration のまま進めるのでテンポは崩れない。
            const tieExtendBeats = event.tieExtendBeatsByKey?.[primaryKey] ?? 0;
            // タイが次小節へまたぐとき、その先の小節はテンポが違うかもしれない（#458 round1 P2）。
            // 「開始小節のBPM×総拍数」ではなく、小節ごとのテンポ区間で秒数を積算する
            const tiedSoundDuration = tieExtendBeats > 0
              ? beatSpanToSeconds(
                  swingTiming.startBeat,
                  nominalStartBeat + nominalDurationBeats + tieExtendBeats,
                  tempoSegmentsFrom(scoreData, measureIndex, measureBpm),
                ) * (event.durationScale ?? 1)
              : soundDuration;
            await this.playNoteAtTime(
              frequency,
              tiedSoundDuration,
              eventStartTime,
              this.normalizePlaybackVelocity((event as { velocity?: number }).velocity)
            );
          }

          if (typeof event.startBeat === 'number') {
            // 複数声部イベントは startBeat で時刻が決まるので、
            // currentTime 自体は進めず「この小節で一番遅く終わる時刻」だけ更新する。
            // 終端は**記譜どおりの位置**（nominal）で数える。スウィング後の開始位置で数えると
            // 4拍目裏の8分などで小節線が 1/6 拍ずれ、次小節やタイ計画の物差しと食い違う
            // （単声部経路が変換前の duration で進めるのと同じ理由・Codex round2 P1）
            const nominalEndTime = measureStartTime + (nominalStartBeat + nominalDurationBeats) * secondsPerBeat;
            maxMeasureEndTime = Math.max(maxMeasureEndTime, nominalEndTime);
          } else {
            currentTime += duration;
            maxMeasureEndTime = Math.max(maxMeasureEndTime, currentTime);
          }
        }

        // 小節内のイベント合計が拍子より短い場合でも、
        // 次小節の頭は拍子どおりの位置まで送って左右手をそろえる。
        currentTime = Math.max(maxMeasureEndTime, measureStartTime + measureSeconds);
      }
      
      console.log('[SimpleAudioEngine] 譜面再生スケジュール完了');
      
    } catch (error) {
      console.error('[SimpleAudioEngine] 譜面再生に失敗:', error);
      throw error;
    }
  }

  /**
   * 指定した時刻に音符を再生する（内部用）
   */
  private async playNoteAtTime(
    frequency: number,
    duration: number,
    startTime: number,
    velocity: number = 0.5
  ): Promise<void> {
    await this.ensureContextReady();
    const context = this.context;
    if (!context) {
      throw new Error('AudioContextが初期化されていません');
    }

    try {
      if (this.shouldUseSafariSafeVoice()) {
        this.playSafariSafeVoice(context, frequency, duration, startTime);
        return;
      }

      // playNote と同じ考え方で、未来の時刻に向けた音量変化を予約する。
      const gainNode = context.createGain();
      const instrumentConfig = this.getInstrumentConfig();
      const oscillators = this.createOscillators(
        context,
        frequency,
        startTime,
        instrumentConfig
      );
      const oscillatorId = this.registerOscillators(oscillators, gainNode, instrumentConfig, startTime);
      
      // 未来の startTime を基準に、同じエンベロープを予約する。
      const adjustedAttack = this.getAdjustedAttack(instrumentConfig.attack);
      // velocity は「その音符だけ、どのくらい強く鳴らすか」。
      // 音色プリセットの形は保ちつつ、包絡線（音量カーブ）全体へ倍率として掛ける。
      const adjustedPeakGain = this.getAdjustedPeakGain(instrumentConfig.peakGain) * velocity;
      const adjustedDecayTarget = this.getAdjustedDecayTarget(instrumentConfig.decayTarget) * velocity;
      const adjustedReleaseFloor = Math.max(
        0.0001,
        this.getAdjustedReleaseFloor(instrumentConfig.releaseFloor) * velocity
      );
      const adjustedTailSeconds = this.getAdjustedTailSeconds(instrumentConfig.tailSeconds ?? 0);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(adjustedPeakGain, startTime + adjustedAttack);
      gainNode.gain.exponentialRampToValueAtTime(
        adjustedDecayTarget,
        startTime + Math.max(adjustedAttack + 0.01, duration * 0.3)
      );
      gainNode.gain.exponentialRampToValueAtTime(
        adjustedReleaseFloor,
        startTime + duration + adjustedTailSeconds
      );
      
      // 再生時刻も停止時刻も「今すぐ」ではなく未来の秒数で予約する。
      oscillators.forEach((oscillator, index) => {
        oscillator.start(startTime);
        oscillator.stop(startTime + duration + adjustedTailSeconds);
        if (index === 0) {
          oscillator.addEventListener('ended', () => {
            this.cleanupOscillator(oscillatorId, gainNode);
          }, { once: true });
        }
      });
      
    } catch (error) {
      console.error('[SimpleAudioEngine] 時刻指定音符再生に失敗:', error);
      throw error;
    }
  }

  /**
   * 複数パート（右手・左手など）を同時再生する
   */
  async playParts(parts: PlaybackPart[], bpm: number = 120): Promise<void> {
    await this.ensureContextReady();
    const context = this.context;
    if (!context) {
      throw new Error('AudioContextが初期化されていません');
    }

    const originalInstrument = this.currentInstrument;
    const sharedStartTime = context.currentTime;

    try {
      for (const part of parts) {
        // 内蔵音源は「今の楽器設定」を見て波形を作る。
        // パートごとに設定を切り替えてから同じ開始時刻へ予約すると、
        // Flute / Violin などの音色を分けつつ、発音タイミングはそろえられる。
        this.currentInstrument = part.instrument ?? originalInstrument;
        await this.playScore(part.measures, bpm, sharedStartTime);
      }
    } finally {
      // 再生後の UI プレビューなどが別パートの音色に引きずられないよう、
      // 一時的に切り替えた楽器を必ず元へ戻す。
      this.currentInstrument = originalInstrument;
    }
  }

  /**
   * 画面側や保存データ側から渡る velocity は optional なので、
   * ここで必ず安全な 0..1 に丸めてから発音へ使う。
   */
  private normalizePlaybackVelocity(rawVelocity: number | undefined): number {
    if (typeof rawVelocity !== 'number' || !Number.isFinite(rawVelocity)) {
      return 0.5;
    }

    return Math.max(0, Math.min(1, rawVelocity));
  }

  /**
   * 現在の音色を設定する
   */
  setInstrument(instrument: InstrumentType): void {
    this.currentInstrument = instrument;
    console.log('[SimpleAudioEngine] 音色を切り替えました:', instrument);
  }

  /**
   * 現在の音色設定を返す
   */
  getCurrentInstrument(): InstrumentType {
    return this.currentInstrument;
  }

  /**
   * ユーザーが UI で調整した「音のキャラ」を反映する。
   * 生の ADSR 値を見せるより、まずは耳で分かりやすい 4 項目に絞る。
   */
  setSoundProfile(profile: PlaybackSoundProfile): void {
    this.soundProfile = profile;
    // 音量スライダーは再生中でも即座に効かせたいので、マスター GainNode に直接反映する
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = getMasterVolumeGain(profile);
    }
    console.log('[SimpleAudioEngine] 音色プロファイルを更新しました:', profile);
  }

  setSwingEnabled(enabled: boolean): void {
    this.swingEnabled = enabled;
    console.log('[SimpleAudioEngine] スウィング再生を切り替えました:', enabled);
  }

  /**
   * 発音ノードの接続先（マスター GainNode）を返す。
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

  /**
   * 楽器ごとの簡易音色設定を返す
   */
  private getInstrumentConfig(): SimpleInstrumentConfig {
    // 音色調整の中心はこのメソッド。
    // 迷ったら、まずここを見ると「どの値が何に効くか」を追いやすい。
    //
    // 調整の順番のおすすめ:
    // 1. oscillators を触る
    //    音のキャラクター（丸い / 明るい / シャリっと / 広がる）を決める
    // 2. attack を触る
    //    鳴り始めの速さを決める
    // 3. peakGain と decayTarget を触る
    //    最初の強さと、その後どれだけ残すかを決める
    // 4. releaseFloor と tailSeconds を触る
    //    消え方と余韻を決める
    //
    // アコギを調整するときの目安:
    // - もっとシャリっと: sawtooth 層の gainRatio を少し上げる
    // - もっと木っぽく: sine / triangle 層の gainRatio を少し上げる
    // - もっとジャーン: tailSeconds を少し伸ばす
    // - もっと歯切れよく: decayTarget を少し下げる
    // - もっとピック感: attack を少し小さくする
    //
    // すぐ試せるおすすめプリセット:
    // 1. もっとアコギらしく柔らかくしたい
    //    - sine.gainRatio: 0.35 -> 0.45
    //    - sawtooth.gainRatio: 0.26 -> 0.18
    //    - tailSeconds: 0.22 -> 0.28
    // 2. もっとシャリっと前に出したい
    //    - sawtooth.gainRatio: 0.26 -> 0.32
    //    - triangle(detune: 12).gainRatio: 0.18 -> 0.22
    //    - attack: 0.002 -> 0.0015
    // 3. もっとジャーンと余韻を長くしたい
    //    - tailSeconds: 0.22 -> 0.35
    //    - releaseFloor: 0.0035 -> 0.005
    // 4. もっと歯切れよく短くしたい
    //    - decayTarget: 0.02 -> 0.014
    //    - tailSeconds: 0.22 -> 0.12
    // 5. エレキ寄りに少し近づけたい
    //    - 主成分 triangle -> sawtooth
    //    - peakGain: 0.24 -> 0.28
    //    - sine.gainRatio: 0.35 -> 0.2
    //
    // 今はギターだけでなく、全楽器がこの簡易プリセット方式で鳴る。
    // つまり「もっと明るくしたい」「もっと丸くしたい」と思ったら、
    // 基本的にはこの switch の各楽器ブロックを触ればよい。
    //
    // 特に弦楽器3兄弟の考え方:
    // - バイオリン: 高音が前に出る。少し明るく、立ち上がりもやや早め
    // - ヴィオラ: 中音域が中心。派手すぎず、少し落ち着いた質感
    // - チェロ: 低音の厚みを優先。丸さと余韻を少し多めにする
    //
    // type の違い
    // - sine: 柔らかい
    // - triangle: やや柔らかい
    // - sawtooth: やや硬い
    // - square: 硬い

    switch (this.currentInstrument) {
      case InstrumentType.ORGAN:
        return {
          // オルガンは倍音が豊かで、押している間は比較的まっすぐ伸びる音を目指す。
          // square を主成分にして、持続感を出しやすいよう decay 後も少し残す。
          oscillators: [
            { type: 'square', gainRatio: 1 },
            { type: 'triangle', detune: 4, gainRatio: 0.22 }
          ],
          attack: 0.01,
          peakGain: 0.22,
          decayTarget: 0.18,
          releaseFloor: 0.02,
          tailSeconds: 0.04
        };
      case InstrumentType.GUITAR:
        // アコギ寄りにしつつ、弦をはじいた瞬間のシャリッとした高域と
        // 胴鳴りの余韻が少し残るようにする。
        return {
          oscillators: [
            // 主成分。丸すぎず硬すぎない中域の芯を作る。
            { type: 'sawtooth', gainRatio: 0.1 },
            // 低めの成分を少し足して、胴鳴り感を出す。
            // ここを上げると、より木の箱が鳴っている感じに寄りやすい。
            { type: 'sine', detune: 1, gainRatio: 0.1 },
            // シャリッとした高域を薄く足す。
            // ここを上げると、ピックの当たりや弦のきらつきが増える。
            { type: 'sawtooth', detune: 6, gainRatio: 1 },
            // さらに高い層を少量だけ混ぜて、コードの広がりを作る。
            // 上げすぎると耳に痛くなりやすいので、少しずつ触るのが安全。
            { type: 'triangle', detune: 1, gainRatio: 0.18 }
          ],
          // attack を小さくすると、弦をはじいた瞬間が前に出る。
          // ただし極端に小さいとクリックノイズっぽく感じやすい。
          attack: 0.004,
          // peakGain は最初の一撃の強さ。
          // 上げると元気になるが、他の楽器より大きく聞こえやすい。
          peakGain: 0.8,
          // decayTarget は「最初の一撃のあと、どこまで音を残すか」。
          // 小さくすると歯切れがよくなり、大きくすると鳴りが残る。
          decayTarget: 0.2,
          // releaseFloor は消える直前の小ささ。
          // 少しだけ残すと、完全に無音へ落ちる前の自然な余韻を作りやすい。
          releaseFloor: 0.0035,
          // tailSeconds は、見た目の音価に対して余韻をどれだけ足すか。
          // 「ジャーン」を長くしたいときは、まずここを少しずつ上げる。
          tailSeconds: 0.3
        };
      case InstrumentType.PICCOLO:
        return {
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sine', detune: 7, gainRatio: 0.16 }
          ],
          attack: 0.015,
          peakGain: 0.18,
          decayTarget: 0.1,
          releaseFloor: 0.012,
          tailSeconds: 0.05
        };
      case InstrumentType.FLUTE:
        return {
          oscillators: [
            { type: 'sine', gainRatio: 1 },
            { type: 'triangle', detune: 2, gainRatio: 0.18 }
          ],
          attack: 0.03,
          peakGain: 0.18,
          decayTarget: 0.11,
          releaseFloor: 0.014,
          tailSeconds: 0.08
        };
      case InstrumentType.OBOE:
      case InstrumentType.ENGLISH_HORN:
      case InstrumentType.BASSOON:
        return {
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sawtooth', detune: this.currentInstrument === InstrumentType.BASSOON ? -4 : 3, gainRatio: 0.16 },
            { type: 'sine', detune: this.currentInstrument === InstrumentType.ENGLISH_HORN ? -8 : -5, gainRatio: 0.12 }
          ],
          attack: this.currentInstrument === InstrumentType.BASSOON ? 0.045 : 0.035,
          peakGain: 0.19,
          decayTarget: this.currentInstrument === InstrumentType.ENGLISH_HORN ? 0.13 : 0.11,
          releaseFloor: 0.015,
          tailSeconds: this.currentInstrument === InstrumentType.BASSOON ? 0.1 : 0.08
        };
      case InstrumentType.SOPRANO_SAX:
      case InstrumentType.ALTO_SAX:
      case InstrumentType.TENOR_SAX:
      case InstrumentType.BARITONE_SAX:
        return {
          oscillators: [
            { type: 'sawtooth', gainRatio: 1 },
            { type: 'triangle', detune: this.currentInstrument === InstrumentType.BARITONE_SAX ? -6 : -2, gainRatio: 0.2 },
            { type: 'sine', detune: this.currentInstrument === InstrumentType.TENOR_SAX || this.currentInstrument === InstrumentType.BARITONE_SAX ? -10 : -5, gainRatio: 0.15 }
          ],
          attack: 0.025,
          peakGain: 0.21,
          decayTarget: 0.14,
          releaseFloor: 0.018,
          tailSeconds: 0.1
        };
      case InstrumentType.TRUMPET:
      case InstrumentType.TROMBONE:
      case InstrumentType.HORN:
      case InstrumentType.EUPHONIUM:
      case InstrumentType.TUBA:
        return {
          oscillators: [
            { type: this.currentInstrument === InstrumentType.HORN || this.currentInstrument === InstrumentType.EUPHONIUM ? 'triangle' : 'square', gainRatio: 1 },
            { type: 'sawtooth', detune: this.currentInstrument === InstrumentType.TUBA ? -7 : 4, gainRatio: 0.18 },
            { type: 'sine', detune: this.currentInstrument === InstrumentType.TUBA ? -12 : -5, gainRatio: 0.14 }
          ],
          attack: this.currentInstrument === InstrumentType.TUBA ? 0.05 : 0.025,
          peakGain: this.currentInstrument === InstrumentType.TRUMPET ? 0.24 : 0.22,
          decayTarget: this.currentInstrument === InstrumentType.HORN ? 0.15 : 0.13,
          releaseFloor: 0.02,
          tailSeconds: this.currentInstrument === InstrumentType.TROMBONE || this.currentInstrument === InstrumentType.TUBA ? 0.14 : 0.09
        };
      case InstrumentType.TIMPANI:
      case InstrumentType.PERCUSSION:
        return {
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sine', detune: -12, gainRatio: this.currentInstrument === InstrumentType.TIMPANI ? 0.24 : 0.12 }
          ],
          attack: 0.003,
          peakGain: 0.25,
          decayTarget: this.currentInstrument === InstrumentType.TIMPANI ? 0.08 : 0.04,
          releaseFloor: 0.002,
          tailSeconds: this.currentInstrument === InstrumentType.TIMPANI ? 0.18 : 0.05
        };
      case InstrumentType.VIOLIN:
        return {
          // バイオリンは高音域が前に出るので、明るめの sawtooth を芯にする。
          // 少しだけ triangle を混ぜて、耳に痛くなりすぎないよう丸める。
          oscillators: [
            { type: 'sawtooth', gainRatio: 1 },
            { type: 'triangle', detune: 5, gainRatio: 0.24 },
            { type: 'sine', detune: 12, gainRatio: 0.1 }
          ],
          // 弓で鳴らすので、ギターよりは少し遅い立ち上がりにする。
          attack: 0.03,
          peakGain: 0.22,
          // 伸ばしたときに音が急に消えないよう、やや高めに残す。
          decayTarget: 0.14,
          releaseFloor: 0.018,
          tailSeconds: 0.12
        };
      case InstrumentType.VIOLA:
        return {
          // ヴィオラはバイオリンより落ち着いた中音域を意識する。
          // triangle を主成分にして、少しだけ sawtooth を足して輪郭を出す。
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sawtooth', detune: -3, gainRatio: 0.18 },
            { type: 'sine', detune: -10, gainRatio: 0.16 }
          ],
          attack: 0.04,
          peakGain: 0.2,
          decayTarget: 0.13,
          releaseFloor: 0.018,
          tailSeconds: 0.14
        };
      case InstrumentType.CELLO:
        return {
          // チェロは低音の厚みが大事なので、丸い波を中心にする。
          // 低めの sine を混ぜて胴鳴り感を足し、triangle で少しだけ輪郭を残す。
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sine', detune: -12, gainRatio: 0.34 },
            { type: 'triangle', detune: 4, gainRatio: 0.18 }
          ],
          attack: 0.05,
          peakGain: 0.22,
          decayTarget: 0.15,
          releaseFloor: 0.02,
          tailSeconds: 0.18
        };
      case InstrumentType.CONTRABASS:
        return {
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sine', detune: -12, gainRatio: 0.42 },
            { type: 'triangle', detune: 3, gainRatio: 0.12 }
          ],
          attack: 0.06,
          peakGain: 0.2,
          decayTarget: 0.14,
          releaseFloor: 0.02,
          tailSeconds: 0.2
        };
      case InstrumentType.STRINGS:
        return {
          // 「ストリングス」は単体楽器ではなく、弦セクション全体の厚みを想定する。
          // 個別のバイオリンより広がりを出したいので、少し detune した層を重ねる。
          oscillators: [
            { type: 'sawtooth', gainRatio: 1 },
            { type: 'triangle', detune: -4, gainRatio: 0.22 },
            { type: 'sawtooth', detune: 6, gainRatio: 0.14 }
          ],
          attack: 0.08,
          peakGain: 0.2,
          decayTarget: 0.14,
          releaseFloor: 0.022,
          tailSeconds: 0.18
        };
      case InstrumentType.BRASS:
        return {
          // ブラスはアタックの強さと押し出し感が大切。
          // square を芯にしつつ sawtooth を少し足して、金属的な明るさを出す。
          oscillators: [
            { type: 'square', gainRatio: 1 },
            { type: 'sawtooth', detune: 3, gainRatio: 0.22 }
          ],
          attack: 0.02,
          peakGain: 0.26,
          decayTarget: 0.16,
          releaseFloor: 0.02,
          tailSeconds: 0.06
        };
      case InstrumentType.WOODWIND:
        return {
          // 木管は角が立ちすぎないほうがそれっぽく聞こえやすい。
          // triangle と sine を中心にして、息のやわらかさを意識する。
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sine', detune: 2, gainRatio: 0.24 }
          ],
          attack: 0.03,
          peakGain: 0.18,
          decayTarget: 0.12,
          releaseFloor: 0.015,
          tailSeconds: 0.08
        };
      case InstrumentType.PIANO:
      default:
        return {
          // ピアノは「最初の打鍵がはっきり、そのあと自然に減衰」が大切。
          // triangle を芯にして、少しだけ高い成分を足してハンマー感を出す。
          oscillators: [
            { type: 'triangle', gainRatio: 1 },
            { type: 'sine', detune: 12, gainRatio: 0.16 }
          ],
          attack: 0.001,
          peakGain: 0.28,
          decayTarget: 0.09,
          releaseFloor: 0.01,
          tailSeconds: 0.05
        };
    }
  }

  /**
   * 再生直前に AudioContext が実際に使える状態かを保証する
   */
  private async ensureContextReady(): Promise<void> {
    if (!this.context || !this.isInitialized) {
      await this.initialize();
    }

    if (!this.context) {
      throw new Error('AudioContextが初期化されていません');
    }

    const currentState = this.context.state as AudioContextState | 'interrupted';
    if (currentState === 'suspended' || currentState === 'interrupted') {
      console.log('[SimpleAudioEngine] 再生直前にAudioContextを再開します...', currentState);
      await this.context.resume();
      console.log('[SimpleAudioEngine] 再生直前のAudioContext状態:', this.context.state);
      this.hasPrimedOutput = false;
    }

    if (this.context.state !== 'running') {
      throw new Error(`AudioContextが再生可能な状態ではありません: ${this.context.state}`);
    }

    await this.primeOutput();
  }

  /**
   * 現在鳴っている音と予約済みの音をすべて停止する
   */
  stopAll(): void {
    if (!this.context) {
      return;
    }

    const stopTime = this.context.currentTime;

    for (const [oscillatorId, { oscillators }] of this.oscillators.entries()) {
      oscillators.forEach(oscillator => {
        try {
          oscillator.stop(stopTime);
        } catch {
          // すでに停止済み、または停止予約済みのオシレーターは無視する
        }
      });

      this.cleanupOscillator(oscillatorId);
    }

    console.log('[SimpleAudioEngine] すべての再生を停止しました');
  }

  /**
   * オシレーターを追跡対象として登録する
   * 停止ボタンで予約済みの発音も止められるようにする
   */
  private createOscillators(
    context: AudioContext,
    frequency: number,
    startTime: number,
    instrumentConfig: SimpleInstrumentConfig
  ): OscillatorNode[] {
    // ここでは「波の設計図」から実際のオシレーターを作るだけに絞る。
    // 接続や音量調整は別メソッドに分けて、役割を読みやすくしている。
    return instrumentConfig.oscillators.map(spec => {
      const oscillator = context.createOscillator();
      oscillator.type = spec.type;
      oscillator.frequency.setValueAtTime(frequency, startTime);
      if (spec.detune) {
        oscillator.detune.setValueAtTime(spec.detune, startTime);
      }
      return oscillator;
    });
  }

  private registerOscillators(
    oscillators: OscillatorNode[],
    gainNode: GainNode,
    instrumentConfig: SimpleInstrumentConfig,
    startTime: number
  ): string {
    const oscillatorId = `osc-${this.oscillatorCounter++}`;

    // 各層をそのまま足すと音量が大きくなりすぎるため、
    // gainRatio を見ながら薄く混ぜて、最後に 1 つの GainNode に集約する。
    const layerCount = Math.max(1, instrumentConfig.oscillators.length);
    oscillators.forEach((oscillator, index) => {
      const layerGain = this.context!.createGain();
      const gainRatio = this.getAdjustedLayerGainRatio(instrumentConfig.oscillators[index]);
      layerGain.gain.setValueAtTime(gainRatio / layerCount, startTime);
      oscillator.connect(layerGain);
      layerGain.connect(gainNode);
    });
    gainNode.connect(this.getOutputNode(this.context!));
    this.oscillators.set(oscillatorId, { oscillators, gainNode });

    return oscillatorId;
  }

  /**
   * 追跡中のオシレーターを安全に解放する
   */
  private cleanupOscillator(oscillatorId: string, gainNode?: GainNode): void {
    const voice = this.oscillators.get(oscillatorId);
    if (!voice) {
      return;
    }

    const { oscillators, gainNode: storedGainNode } = voice;
    const targetGainNode = gainNode ?? storedGainNode;

    // stop 済みでも disconnect は必要。
    // 接続を残すとメモリや音声ノードが積み上がりやすいため、必ず切る。
    oscillators.forEach(oscillator => {
      try {
        oscillator.disconnect();
      } catch {
        // すでに切断済みでも停止処理は継続する
      }
    });

    try {
      targetGainNode.disconnect();
    } catch {
      // GainNode 側も二重切断を許容する
    }

    this.oscillators.delete(oscillatorId);
  }

  /**
   * Safari は複数の GainNode や多層オシレーター構成で
   * ときどき「start までは通るのに無音」になることがある。
   * その場合だけ、1 本のオシレーターに絞った簡易発音経路へ切り替える。
   */
  private shouldUseSafariSafeVoice(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }

    const userAgent = navigator.userAgent;
    return /Safari/.test(userAgent) && !/Chrome|Chromium|Edg/.test(userAgent);
  }

  /**
   * Safari 向けの簡易発音経路。
   * まずは「とにかく確実に鳴る」ことを優先して、最初の主成分 1 本だけで鳴らす。
   */
  private playSafariSafeVoice(
    context: AudioContext,
    frequency: number,
    duration: number,
    startTime: number
  ): void {
    const instrumentConfig = this.getInstrumentConfig();
    const primaryOscillatorSpec = instrumentConfig.oscillators[0] ?? { type: 'triangle' as OscillatorType };
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = primaryOscillatorSpec.type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (primaryOscillatorSpec.detune) {
      oscillator.detune.setValueAtTime(primaryOscillatorSpec.detune, startTime);
    }

    const adjustedAttack = this.getAdjustedAttack(instrumentConfig.attack);
    const adjustedPeakGain = this.getAdjustedPeakGain(instrumentConfig.peakGain);
    const adjustedDecayTarget = this.getAdjustedDecayTarget(instrumentConfig.decayTarget);
    const adjustedTailSeconds = this.getAdjustedTailSeconds(instrumentConfig.tailSeconds ?? 0);

    // Safari では複雑なノード構成より、単純な直結のほうが安定しやすい。
    // その代わり音色差は少し薄くなるが、まず「鳴る」ことを優先する。
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.linearRampToValueAtTime(
      Math.max(0.12, Math.min(adjustedPeakGain, 0.25)),
      startTime + Math.max(0.005, adjustedAttack)
    );
    gainNode.gain.linearRampToValueAtTime(
      Math.max(0.02, adjustedDecayTarget),
      startTime + Math.max(0.08, duration * 0.35)
    );
    gainNode.gain.linearRampToValueAtTime(
      0.0001,
      startTime + duration + adjustedTailSeconds
    );

    oscillator.connect(gainNode);
    gainNode.connect(this.getOutputNode(context));
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + adjustedTailSeconds);
    oscillator.addEventListener('ended', () => {
      try {
        oscillator.disconnect();
      } catch {
        // 二重切断でも処理は続ける
      }
      try {
        gainNode.disconnect();
      } catch {
        // 二重切断でも処理は続ける
      }
    }, { once: true });
  }

  private getAdjustedAttack(baseAttack: number): number {
    // attack スライダーは「値が大きいほど立ち上がりがはっきりする」向きにしている。
    const factor = 1.25 - this.soundProfile.attack * 0.9;
    return Math.max(0.001, baseAttack * factor);
  }

  private getAdjustedPeakGain(basePeakGain: number): number {
    const richnessBoost = 0.9 + this.soundProfile.richness * 0.35;
    return Math.min(0.9, Math.max(0.08, basePeakGain * richnessBoost));
  }

  private getAdjustedDecayTarget(baseDecayTarget: number): number {
    const releaseFactor = 0.7 + this.soundProfile.release * 0.8;
    return Math.max(0.008, baseDecayTarget * releaseFactor);
  }

  private getAdjustedReleaseFloor(baseReleaseFloor: number): number {
    const releaseFactor = 0.8 + this.soundProfile.release * 0.9;
    return Math.max(0.0001, baseReleaseFloor * releaseFactor);
  }

  private getAdjustedTailSeconds(baseTailSeconds: number): number {
    return Math.max(0, baseTailSeconds * (0.6 + this.soundProfile.release * 1.2));
  }

  private getAdjustedLayerGainRatio(
    oscillatorSpec: { type: OscillatorType; gainRatio?: number } | undefined
  ): number {
    if (!oscillatorSpec) {
      return 1;
    }

    const baseGainRatio = oscillatorSpec.gainRatio ?? 1;
    const brightness = this.soundProfile.brightness;
    const richness = this.soundProfile.richness;

    let colorFactor = 1;
    if (oscillatorSpec.type === 'sawtooth' || oscillatorSpec.type === 'square') {
      colorFactor = 0.75 + brightness * 0.7;
    } else if (oscillatorSpec.type === 'sine') {
      colorFactor = 1.2 - brightness * 0.45;
    } else if (oscillatorSpec.type === 'triangle') {
      colorFactor = 0.95 + brightness * 0.15;
    }

    const richnessFactor = baseGainRatio === 1 ? 1 : 0.7 + richness * 0.9;
    return Math.max(0.03, baseGainRatio * colorFactor * richnessFactor);
  }

  /**
   * Safari では AudioContext が running でも、出力経路が眠ったままで
   * 実音が出ないことがある。そのため、ごく短いほぼ無音の音を 1 回だけ流して
   * 出力経路をウォームアップする。
   */
  private async primeOutput(): Promise<void> {
    if (!this.context || this.context.state !== 'running' || this.hasPrimedOutput) {
      return;
    }

    const unlockOscillator = this.context.createOscillator();
    const unlockGain = this.context.createGain();

    unlockOscillator.type = 'sine';
    unlockOscillator.frequency.setValueAtTime(440, this.context.currentTime);
    // 完全な 0 は最適化で捨てられることがあるので、ほぼ無音の値を使う。
    unlockGain.gain.setValueAtTime(0.00001, this.context.currentTime);

    unlockOscillator.connect(unlockGain);
    unlockGain.connect(this.context.destination);

    const stopTime = this.context.currentTime + 0.02;
    unlockOscillator.start(this.context.currentTime);
    unlockOscillator.stop(stopTime);

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        this.hasPrimedOutput = true;
        console.log('[SimpleAudioEngine] 出力経路をウォームアップしました');
        resolve();
      };

      // 一部ブラウザでは ended が来ないことがある。
      // その場合でも初期化が止まり続けないよう、短い保険タイマーで先へ進める。
      const fallbackTimer = setTimeout(() => {
        try {
          unlockOscillator.disconnect();
        } catch {
          // 切断済みでも処理は続ける
        }
        try {
          unlockGain.disconnect();
        } catch {
          // 切断済みでも処理は続ける
        }
        console.warn('[SimpleAudioEngine] ウォームアップ完了イベントが来なかったため、タイムアウトで続行します');
        finish();
      }, 120);

      unlockOscillator.addEventListener('ended', () => {
        clearTimeout(fallbackTimer);
        try {
          unlockOscillator.disconnect();
        } catch {
          // 二重切断でも処理は続ける
        }
        try {
          unlockGain.disconnect();
        } catch {
          // 二重切断でも処理は続ける
        }
        finish();
      }, { once: true });
    });
  }

  /**
   * リソースを解放する
   */
  dispose(): void {
    try {
      console.log('[SimpleAudioEngine] リソースを解放します...');
      
      this.stopAll();
      
      // AudioContextを閉じる
      if (this.context) {
        this.context.close();
        this.context = null;
      }
      // 閉じた context に属する GainNode は再利用できないため捨てる
      this.masterGainNode = null;
      
      this.isInitialized = false;
      this.hasPrimedOutput = false;
      console.log('[SimpleAudioEngine] リソースの解放が完了しました');
      
    } catch (error) {
      console.error('[SimpleAudioEngine] リソース解放中にエラーが発生しました:', error);
    }
  }
}

// デフォルトのSimpleAudioEngineインスタンスをエクスポート
export const defaultSimpleAudioEngine = new SimpleAudioEngine();

