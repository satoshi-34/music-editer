// src/audio/SoundSource.ts
// 音色管理を行うクラス
// 複数楽器音色の管理、Tone.jsシンセサイザーの動的切り替え、音色の事前読み込み機能を提供

// Tone.jsの動的インポートのための型定義
type ToneModule = typeof import('tone');

// Tone.jsの型を名前空間として取り込む（型チェック専用）
import type * as Tone from 'tone';

import { AudioEngine } from './AudioEngine';
import { AudioErrorHandler, AudioErrorFactory } from './AudioError';

/**
 * 楽器の種類を定義する列挙型
 */
export enum InstrumentType {
  PIANO = 'piano',
  ORGAN = 'organ',
  GUITAR = 'guitar',
  PICCOLO = 'piccolo',
  FLUTE = 'flute',
  OBOE = 'oboe',
  ENGLISH_HORN = 'english-horn',
  CLARINET = 'clarinet',
  BASSOON = 'bassoon',
  SOPRANO_SAX = 'soprano-sax',
  ALTO_SAX = 'alto-sax',
  TENOR_SAX = 'tenor-sax',
  BARITONE_SAX = 'baritone-sax',
  TRUMPET = 'trumpet',
  TROMBONE = 'trombone',
  HORN = 'horn',
  EUPHONIUM = 'euphonium',
  TUBA = 'tuba',
  TIMPANI = 'timpani',
  VIOLIN = 'violin',
  VIOLA = 'viola',
  CELLO = 'cello',
  CONTRABASS = 'contrabass',
  PERCUSSION = 'percussion',
  STRINGS = 'strings',
  BRASS = 'brass',
  WOODWIND = 'woodwind'
}

/**
 * エフェクト設定の型定義
 */
export interface EffectConfig {
  type: 'reverb' | 'delay' | 'chorus' | 'distortion';
  wet: number; // 0-1の範囲
  params?: Record<string, any>;
}

/**
 * 楽器設定の型定義
 */
export interface InstrumentConfig {
  type: InstrumentType;
  volume: number; // 0-1の範囲
  effects?: EffectConfig[];
}

/**
 * シンセサイザー設定の内部型定義
 */
interface SynthConfig {
  oscillator: Partial<Tone.OmniOscillatorOptions>;
  envelope: Partial<Tone.EnvelopeOptions>;
  volume: number;
}

/**
 * 永続化された音色設定のインターフェース
 */
export interface PersistedSoundSettings {
  /** 現在の楽器タイプ */
  currentInstrument: InstrumentType;
  /** 全体ボリューム */
  globalVolume: number;
  /** 設定のバージョン */
  version: string;
  /** 最終更新タイムスタンプ */
  lastUpdated: number;
}

/**
 * 音色設定のインターフェース
 */
export interface SoundSettings {
  /** 現在の楽器タイプ */
  currentInstrument: InstrumentType;
  /** 全体ボリューム */
  globalVolume: number;
}

/**
 * 音色設定変更のコールバック関数型
 */
export type SoundChangeCallback = (settings: SoundSettings) => void;

/**
 * 音色管理を行うクラス
 * 複数楽器音色の管理、Tone.jsシンセサイザーの動的切り替え、音色の事前読み込み機能を提供
 * 要件5.1, 5.2, 5.5, 9.2に対応
 */
export class SoundSource {
  private currentInstrument: InstrumentType = InstrumentType.PIANO;
  private synthMap: Map<InstrumentType, any> = new Map(); // Tone.PolySynth型だが、動的インポートのためanyを使用
  private loadingPromises: Map<InstrumentType, Promise<void>> = new Map();
  private audioEngine: AudioEngine;
  private globalVolume: number = 0.7; // 全体ボリューム（0-1の範囲）
  private Tone: ToneModule | null = null; // 動的にインポートされるTone.jsモジュール
  
  /** 音色設定変更リスナーのセット */
  private listeners: Set<SoundChangeCallback> = new Set();
  
  /** ストレージキー */
  private static readonly STORAGE_KEY = 'music-app-sound-settings';
  
  /** 設定のバージョン */
  private static readonly SETTINGS_VERSION = '1.0.0';

  constructor(audioEngine: AudioEngine) {
    this.audioEngine = audioEngine;
    console.log('[SoundSource] SoundSourceが初期化されました（Tone.jsは動的インポート）');
    
    // 保存された設定を読み込む
    this.loadSettings();
  }

  /**
   * 楽器タイプに応じたシンセサイザー設定を取得する
   * @private
   */
  private _getSynthConfig(instrument: InstrumentType): SynthConfig {
    switch (instrument) {
      case InstrumentType.PIANO:
        return {
          oscillator: {
            type: 'triangle',
            partialCount: 3
          },
          envelope: {
            attack: 0.02,
            decay: 0.3,
            sustain: 0.4,
            release: 1.2
          },
          volume: -8 // dB
        };

      case InstrumentType.ORGAN:
        return {
          oscillator: {
            type: 'sawtooth',
            partialCount: 8
          },
          envelope: {
            attack: 0.1,
            decay: 0.1,
            sustain: 0.8,
            release: 0.5
          },
          volume: -10 // dB
        };

      case InstrumentType.GUITAR:
        return {
          oscillator: {
            type: 'sawtooth',
            partialCount: 4
          },
          envelope: {
            attack: 0.01,
            decay: 0.2,
            sustain: 0.3,
            release: 2.0
          },
          volume: -6 // dB
        };

      case InstrumentType.PICCOLO:
        return {
          oscillator: {
            type: 'triangle',
            partialCount: 5
          },
          envelope: {
            attack: 0.03,
            decay: 0.08,
            sustain: 0.45,
            release: 0.5
          },
          volume: -11 // dB
        };

      case InstrumentType.FLUTE:
        return {
          oscillator: {
            type: 'sine',
            partialCount: 3
          },
          envelope: {
            attack: 0.05,
            decay: 0.1,
            sustain: 0.5,
            release: 0.8
          },
          volume: -10 // dB
        };

      case InstrumentType.OBOE:
      case InstrumentType.ENGLISH_HORN:
      case InstrumentType.CLARINET:
      case InstrumentType.BASSOON:
        return {
          // 木管は同じ処理枝でまとめているが、クラリネットだけは少し柔らかい
          // sine 系の波形と長めの sustain/release にしている。
          // 本物のクラリネットを完全再現する音源ではなく、
          // 「フルートより丸く、オーボエより鼻にかからない」内蔵音源用の目安。
          // SoundFont 使用時は SoundFontEngine 側の 'clarinet' マッピングが使われる。
          oscillator: {
            type: instrument === InstrumentType.CLARINET ? 'sine' : 'triangle',
            partialCount: instrument === InstrumentType.BASSOON ? 4 : instrument === InstrumentType.CLARINET ? 4 : 3
          },
          envelope: {
            attack: instrument === InstrumentType.BASSOON ? 0.08 : instrument === InstrumentType.CLARINET ? 0.045 : 0.06,
            decay: instrument === InstrumentType.CLARINET ? 0.1 : 0.12,
            sustain: instrument === InstrumentType.ENGLISH_HORN ? 0.58 : instrument === InstrumentType.CLARINET ? 0.6 : 0.52,
            release: instrument === InstrumentType.BASSOON ? 0.9 : instrument === InstrumentType.CLARINET ? 0.85 : 0.75
          },
          volume: instrument === InstrumentType.BASSOON ? -9 : instrument === InstrumentType.CLARINET ? -9 : -10 // dB
        };

      case InstrumentType.SOPRANO_SAX:
      case InstrumentType.ALTO_SAX:
      case InstrumentType.TENOR_SAX:
      case InstrumentType.BARITONE_SAX:
        return {
          oscillator: {
            type: 'sawtooth',
            partialCount: instrument === InstrumentType.BARITONE_SAX ? 6 : 5
          },
          envelope: {
            attack: 0.04,
            decay: 0.12,
            sustain: instrument === InstrumentType.TENOR_SAX || instrument === InstrumentType.BARITONE_SAX ? 0.62 : 0.56,
            release: 0.85
          },
          volume: instrument === InstrumentType.BARITONE_SAX ? -8 : -9 // dB
        };

      case InstrumentType.TRUMPET:
      case InstrumentType.TROMBONE:
      case InstrumentType.HORN:
      case InstrumentType.EUPHONIUM:
      case InstrumentType.TUBA:
        return {
          oscillator: {
            type: instrument === InstrumentType.HORN || instrument === InstrumentType.EUPHONIUM ? 'triangle' : 'square',
            partialCount: instrument === InstrumentType.TUBA ? 6 : 4
          },
          envelope: {
            attack: instrument === InstrumentType.TUBA ? 0.12 : 0.08,
            decay: 0.1,
            sustain: instrument === InstrumentType.HORN ? 0.65 : 0.6,
            release: instrument === InstrumentType.TROMBONE || instrument === InstrumentType.TUBA ? 1.0 : 0.7
          },
          volume: instrument === InstrumentType.TRUMPET ? -7 : -8 // dB
        };

      case InstrumentType.TIMPANI:
      case InstrumentType.PERCUSSION:
        return {
          oscillator: {
            type: 'triangle',
            partialCount: instrument === InstrumentType.TIMPANI ? 4 : 2
          },
          envelope: {
            attack: 0.005,
            decay: instrument === InstrumentType.TIMPANI ? 0.35 : 0.15,
            sustain: instrument === InstrumentType.TIMPANI ? 0.15 : 0.05,
            release: instrument === InstrumentType.TIMPANI ? 1.2 : 0.35
          },
          volume: -7 // dB
        };

      case InstrumentType.VIOLIN:
        return {
          oscillator: {
            type: 'sawtooth',
            partialCount: 5
          },
          envelope: {
            attack: 0.08,
            decay: 0.15,
            sustain: 0.6,
            release: 1.1
          },
          volume: -10 // dB
        };

      case InstrumentType.VIOLA:
        return {
          oscillator: {
            type: 'triangle',
            partialCount: 4
          },
          envelope: {
            attack: 0.1,
            decay: 0.2,
            sustain: 0.58,
            release: 1.2
          },
          volume: -11 // dB
        };

      case InstrumentType.CELLO:
        return {
          oscillator: {
            type: 'triangle',
            partialCount: 6
          },
          envelope: {
            attack: 0.12,
            decay: 0.18,
            sustain: 0.62,
            release: 1.5
          },
          volume: -9 // dB
        };

      case InstrumentType.CONTRABASS:
        return {
          oscillator: {
            type: 'triangle',
            partialCount: 6
          },
          envelope: {
            attack: 0.14,
            decay: 0.2,
            sustain: 0.66,
            release: 1.7
          },
          volume: -8 // dB
        };

      case InstrumentType.STRINGS:
        return {
          oscillator: {
            type: 'sawtooth',
            partialCount: 6
          },
          envelope: {
            attack: 0.3,
            decay: 0.2,
            sustain: 0.7,
            release: 1.5
          },
          volume: -12 // dB
        };

      case InstrumentType.BRASS:
        return {
          oscillator: {
            type: 'square',
            partialCount: 4
          },
          envelope: {
            attack: 0.1,
            decay: 0.1,
            sustain: 0.6,
            release: 0.8
          },
          volume: -8 // dB
        };

      case InstrumentType.WOODWIND:
        return {
          oscillator: {
            type: 'sine',
            partialCount: 2
          },
          envelope: {
            attack: 0.05,
            decay: 0.1,
            sustain: 0.5,
            release: 1.0
          },
          volume: -10 // dB
        };

      default:
        // デフォルトはピアノ設定
        return this._getSynthConfig(InstrumentType.PIANO);
    }
  }

  /**
   * リニアボリューム（0-1）をデシベル値に変換する
   * @private
   */
  private _linearToDb(linear: number): number {
    if (linear <= 0) return -Infinity;
    return 20 * Math.log10(linear);
  }

  /**
   * 指定した楽器の音色を読み込む
   * 要件5.1, 9.2に対応：利用可能な楽器音色のリスト表示と必要な音色のみの事前読み込み
   * 
   * @param type 読み込む楽器の種類
   * @returns 読み込み完了のPromise
   */
  async loadInstrument(type: InstrumentType): Promise<void> {
    // 既に読み込み済みの場合はスキップ
    if (this.synthMap.has(type)) {
      console.log(`[SoundSource] 楽器は既に読み込み済み: ${type}`);
      return;
    }

    // 既に読み込み中の場合は、その完了を待つ
    if (this.loadingPromises.has(type)) {
      console.log(`[SoundSource] 楽器の読み込み中: ${type}`);
      return this.loadingPromises.get(type)!;
    }

    // AudioEngineが初期化されていない場合は警告
    if (!this.audioEngine.isInitializedState()) {
      console.warn('[SoundSource] AudioEngineが初期化されていません。楽器の読み込みを続行します。');
    }

    // 読み込み処理を開始
    const loadingPromise = this._performInstrumentLoad(type);
    this.loadingPromises.set(type, loadingPromise);

    try {
      await loadingPromise;
    } finally {
      // 読み込み完了後、Promiseをクリア
      this.loadingPromises.delete(type);
    }
  }

  /**
   * 実際の楽器読み込み処理を実行する
   * @private
   */
  private async _performInstrumentLoad(type: InstrumentType): Promise<void> {
    try {
      console.log(`[SoundSource] 楽器を読み込み中: ${type}`);

      // Tone.jsを動的にインポート（まだインポートされていない場合）
      if (!this.Tone) {
        console.log('[SoundSource] Tone.jsを動的にインポートします...');
        this.Tone = await import('tone');
        console.log('[SoundSource] Tone.jsのインポートが完了しました');
      }

      const config = this._getSynthConfig(type);

      // PolySynthを作成（複数音符の同時再生に対応）
      const synth = new this.Tone.PolySynth(this.Tone.Synth, {
        oscillator: config.oscillator,
        envelope: config.envelope
      });

      // ボリュームを設定
      synth.volume.value = config.volume + this._linearToDb(this.globalVolume);

      // AudioContextが存在する場合のみ出力に接続
      try {
        synth.toDestination();
        console.log(`[SoundSource] 楽器 ${type} を出力に接続しました`);
      } catch (error) {
        console.warn(`[SoundSource] 楽器 ${type} の出力接続をスキップ:`, error);
        // AudioContextが作成されていない場合は後で接続する
      }

      // マップに保存
      this.synthMap.set(type, synth);

      console.log(`[SoundSource] 楽器の読み込み完了: ${type}`);

    } catch (error) {
      const audioError = AudioErrorFactory.createLoadingError(
        `楽器の読み込みに失敗しました: ${type}`,
        error instanceof Error ? error : new Error(String(error))
      );
      AudioErrorHandler.logError(audioError);
      throw error;
    }
  }

  /**
   * 現在の再生音色として楽器を設定する
   * 要件5.2に対応：音色を現在の再生音色として設定
   * 
   * @param type 設定する楽器の種類
   */
  setCurrentInstrument(type: InstrumentType): void {
    if (this.currentInstrument === type) {
      console.log(`[SoundSource] 既に同じ楽器が設定済み: ${type}`);
      return;
    }

    // 楽器が読み込まれていない場合は自動読み込み
    if (!this.synthMap.has(type)) {
      console.log(`[SoundSource] 楽器が未読み込みのため自動読み込み: ${type}`);
      this.loadInstrument(type).catch(error => {
        console.error(`[SoundSource] 楽器の自動読み込みに失敗: ${type}`, error);
      });
    }

    this.currentInstrument = type;
    console.log(`[SoundSource] 現在の楽器を変更: ${type}`);
    
    // 設定を保存し、リスナーに通知
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * 現在設定されている楽器の種類を取得する
   * 
   * @returns 現在の楽器の種類
   */
  getCurrentInstrument(): InstrumentType {
    return this.currentInstrument;
  }

  /**
   * 読み込み済みのすべてのシンセサイザーを出力に再接続する
   * AudioContextが作成された後に呼び出す
   */
  async reconnectAllSynths(): Promise<void> {
    console.log('[SoundSource] すべてのシンセサイザーを出力に再接続中...');
    
    // 現在の楽器が遅延作成されている場合は、今作成する
    if (!this.synthMap.has(this.currentInstrument)) {
      console.log(`[SoundSource] 現在の楽器 ${this.currentInstrument} を作成します`);
      try {
        await this._performInstrumentLoad(this.currentInstrument);
      } catch (error) {
        console.error(`[SoundSource] 楽器 ${this.currentInstrument} の作成に失敗:`, error);
      }
    }
    
    // 既存のシンセサイザーを再接続
    for (const [type, synth] of this.synthMap) {
      try {
        synth.toDestination();
        console.log(`[SoundSource] 楽器 ${type} を出力に再接続しました`);
      } catch (error) {
        console.error(`[SoundSource] 楽器 ${type} の再接続に失敗:`, error);
      }
    }
  }

  /**
   * 指定された楽器のシンセサイザーを取得
   * 
   * @param type 取得する楽器の種類（未指定の場合は現在の楽器）
   * @returns シンセサイザーインスタンス、または未読み込みの場合はnull
   */
  getSynth(type?: InstrumentType): any | null {
    const targetType = type || this.currentInstrument;
    const synth = this.synthMap.get(targetType) || null;
    
    console.log('[SoundSource] getSynth呼び出し:', {
      requestedType: type,
      targetType,
      currentInstrument: this.currentInstrument,
      synthExists: !!synth,
      loadedInstruments: Array.from(this.synthMap.keys())
    });
    
    return synth;
  }

  /**
   * 利用可能な楽器音色のリストを取得する
   * 要件5.1に対応：利用可能な楽器音色のリストを表示
   * 
   * @returns 利用可能な楽器の種類の配列
   */
  getAvailableInstruments(): InstrumentType[] {
    return Object.values(InstrumentType);
  }

  /**
   * 複数の楽器を事前に読み込む
   * 要件9.2に対応：必要な音色のみを事前読み込み
   * 
   * @param types 読み込む楽器の種類の配列
   * @returns すべての読み込み完了のPromise
   */
  async preloadInstruments(types: InstrumentType[]): Promise<void> {
    console.log(`[SoundSource] 楽器の事前読み込みを開始: ${types.join(', ')}`);

    try {
      // 並行して読み込みを実行
      const loadPromises = types.map(type => this.loadInstrument(type));
      await Promise.all(loadPromises);

      console.log(`[SoundSource] 楽器の事前読み込み完了: ${types.join(', ')}`);
    } catch (error) {
      const audioError = AudioErrorFactory.createLoadingError(
        '楽器の事前読み込みに失敗しました',
        error instanceof Error ? error : new Error(String(error))
      );
      AudioErrorHandler.logError(audioError);
      throw error;
    }
  }

  /**
   * 読み込み済みの楽器のリストを取得する
   * 
   * @returns 読み込み済みの楽器の種類の配列
   */
  getLoadedInstruments(): InstrumentType[] {
    return Array.from(this.synthMap.keys());
  }

  /**
   * 指定した楽器が読み込み済みかチェックする
   * 
   * @param type チェックする楽器の種類
   * @returns 読み込み済みの場合はtrue
   */
  isInstrumentLoaded(type: InstrumentType): boolean {
    return this.synthMap.has(type);
  }

  /**
   * 指定した楽器が読み込み中かチェックする
   * 
   * @param type チェックする楽器の種類
   * @returns 読み込み中の場合はtrue
   */
  isInstrumentLoading(type: InstrumentType): boolean {
    return this.loadingPromises.has(type);
  }

  /**
   * 全体ボリュームを設定する
   * 
   * @param volume ボリューム（0-1の範囲）
   */
  setGlobalVolume(volume: number): void {
    // スライダー入力以外から呼ばれても、NaN や Infinity を内部状態へ入れない。
    // 一度 NaN が入ると比較や保存データまで壊れやすいので、ここで必ず安全な数値へ丸める。
    const safeVolume = Number.isFinite(volume) ? volume : 0;
    const newVolume = Math.max(0, Math.min(1, safeVolume));
    
    if (this.globalVolume === newVolume) {
      return; // 値が変更されていない場合は何もしない
    }
    
    this.globalVolume = newVolume;

    // 読み込み済みのすべてのシンセサイザーのボリュームを更新
    for (const [type, synth] of this.synthMap) {
      const config = this._getSynthConfig(type);
      synth.volume.value = config.volume + this._linearToDb(this.globalVolume);
    }

    console.log(`[SoundSource] 全体ボリュームを設定: ${this.globalVolume}`);
    
    // 設定を保存し、リスナーに通知
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * 現在の全体ボリュームを取得する
   * 
   * @returns 現在の全体ボリューム（0-1の範囲）
   */
  getGlobalVolume(): number {
    return this.globalVolume;
  }

  /**
   * 指定した楽器を解放する
   * 
   * @param type 解放する楽器の種類
   */
  unloadInstrument(type: InstrumentType): void {
    const synth = this.synthMap.get(type);
    if (synth) {
      try {
        synth.dispose();
        this.synthMap.delete(type);
        console.log(`[SoundSource] 楽器を解放: ${type}`);
      } catch (error) {
        console.error(`[SoundSource] 楽器の解放中にエラー: ${type}`, error);
      }
    }

    // 読み込み中の場合はPromiseを取り出してから削除し、完了後にsynthを破棄
    if (this.loadingPromises.has(type)) {
      const pendingPromise = this.loadingPromises.get(type)!;
      this.loadingPromises.delete(type);
      pendingPromise.then(() => {
        // 読み込み完了後に作成されたsynthを破棄
        const synth = this.synthMap.get(type);
        if (synth) {
          try { synth.dispose(); } catch {}
          this.synthMap.delete(type);
          console.log(`[SoundSource] 遅延作成された楽器 ${type} を解放しました`);
        }
      }).catch(() => {
        // 読み込みエラーの場合はsynthが作成されないため何もしない
      });
    }
  }

  /**
   * SoundSourceを破棄し、すべてのリソースを解放する
   * 要件9.3に対応：不要な音声リソースを適切に解放
   */
  dispose(): void {
    try {
      console.log('[SoundSource] すべてのリソースを解放します...');

      // すべてのシンセサイザーを解放
      for (const [type, synth] of this.synthMap) {
        try {
          synth.dispose();
          console.log(`[SoundSource] 楽器を解放: ${type}`);
        } catch (error) {
          console.error(`[SoundSource] 楽器の解放中にエラー: ${type}`, error);
        }
      }

      // マップをクリア
      this.synthMap.clear();
      this.loadingPromises.clear();
      
      // リスナーをクリア
      this.listeners.clear();

      console.log('[SoundSource] すべてのリソースの解放が完了しました');
    } catch (error) {
      console.error('[SoundSource] リソース解放中にエラーが発生:', error);
    }
  }

  /**
   * 現在の音色設定を取得する
   * 要件5.5に対応：音色設定の取得
   * 
   * @returns 現在の音色設定のコピー
   */
  getSettings(): SoundSettings {
    return {
      currentInstrument: this.currentInstrument,
      globalVolume: this.globalVolume
    };
  }

  /**
   * 音色設定変更のリスナーを追加する
   * 要件5.5に対応：設定変更の通知
   * 
   * @param callback 設定変更時に呼び出されるコールバック関数
   */
  onChange(callback: SoundChangeCallback): void {
    this.listeners.add(callback);
  }

  /**
   * 音色設定変更のリスナーを削除する
   * 
   * @param callback 削除するコールバック関数
   */
  removeListener(callback: SoundChangeCallback): void {
    this.listeners.delete(callback);
  }

  /**
   * すべてのリスナーを削除する
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * 設定をデフォルト値にリセットする
   * 要件5.5に対応：設定のリセット
   */
  resetToDefaults(): void {
    const defaultSettings: SoundSettings = {
      currentInstrument: InstrumentType.PIANO,
      globalVolume: 0.7
    };

    // 値が変更された場合のみ更新
    const instrumentChanged = this.currentInstrument !== defaultSettings.currentInstrument;
    const volumeChanged = this.globalVolume !== defaultSettings.globalVolume;

    if (instrumentChanged || volumeChanged) {
      this.currentInstrument = defaultSettings.currentInstrument;
      this.globalVolume = defaultSettings.globalVolume;
      
      // ボリュームの更新を適用
      this._updateAllSynthVolumes();
      
      this.saveSettings();
      this.notifyListeners();
      
      console.log('[SoundSource] 設定をデフォルト値にリセットしました');
    }
  }

  /**
   * 保存された設定をクリアする
   * 要件5.5に対応：保存された設定のクリア
   */
  clearSavedSettings(): void {
    try {
      localStorage.removeItem(SoundSource.STORAGE_KEY);
      console.log('[SoundSource] 保存された設定をクリアしました');
    } catch (error) {
      console.error('[SoundSource] 音色設定のクリアに失敗しました:', error);
    }
  }

  /**
   * 設定をlocalStorageに保存する
   * 要件5.5に対応：音色設定の保存
   * 
   * @private
   */
  private saveSettings(): void {
    try {
      const persistedSettings: PersistedSoundSettings = {
        currentInstrument: this.currentInstrument,
        globalVolume: this.globalVolume,
        version: SoundSource.SETTINGS_VERSION,
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(
        SoundSource.STORAGE_KEY, 
        JSON.stringify(persistedSettings)
      );
      
      console.log('[SoundSource] 音色設定を保存しました:', persistedSettings);
    } catch (error) {
      console.error('[SoundSource] 音色設定の保存に失敗しました:', error);
    }
  }

  /**
   * localStorageから設定を読み込む
   * 要件5.5に対応：音色設定の復元
   * 
   * @private
   */
  private loadSettings(): void {
    try {
      const stored = localStorage.getItem(SoundSource.STORAGE_KEY);
      if (!stored) {
        console.log('[SoundSource] 保存された設定がありません。デフォルト設定を使用します。');
        return; // デフォルト設定を使用
      }

      const persistedSettings: PersistedSoundSettings = JSON.parse(stored);
      
      // バージョンチェック
      if (persistedSettings.version !== SoundSource.SETTINGS_VERSION) {
        console.warn('[SoundSource] 音色設定のバージョンが異なります。デフォルト設定を使用します。');
        return;
      }

      // 設定の検証と復元
      if (this.isValidPersistedSettings(persistedSettings)) {
        this.currentInstrument = persistedSettings.currentInstrument;
        this.globalVolume = persistedSettings.globalVolume;
        
        console.log('[SoundSource] 保存された音色設定を復元しました:', persistedSettings);
      } else {
        console.warn('[SoundSource] 保存された音色設定が無効です。デフォルト設定を使用します。');
      }
    } catch (error) {
      console.error('[SoundSource] 音色設定の読み込みに失敗しました:', error);
      // エラーが発生した場合はデフォルト設定を使用
    }
  }

  /**
   * 永続化された設定が有効かどうかを検証する
   * 
   * @param settings 検証する設定
   * @returns 有効な場合はtrue
   * @private
   */
  private isValidPersistedSettings(settings: any): settings is PersistedSoundSettings {
    return (
      settings &&
      typeof settings === 'object' &&
      typeof settings.version === 'string' &&
      typeof settings.lastUpdated === 'number' &&
      Object.values(InstrumentType).includes(settings.currentInstrument) &&
      typeof settings.globalVolume === 'number' &&
      settings.globalVolume >= 0 &&
      settings.globalVolume <= 1
    );
  }

  /**
   * 登録されたリスナーに設定変更を通知する
   * 
   * @private
   */
  private notifyListeners(): void {
    const currentSettings = this.getSettings();
    this.listeners.forEach(callback => {
      try {
        callback(currentSettings);
      } catch (error) {
        console.error('[SoundSource] 音色設定変更の通知中にエラーが発生しました:', error);
      }
    });
  }

  /**
   * すべてのシンセサイザーのボリュームを更新する
   * 
   * @private
   */
  private _updateAllSynthVolumes(): void {
    for (const [type, synth] of this.synthMap) {
      const config = this._getSynthConfig(type);
      synth.volume.value = config.volume + this._linearToDb(this.globalVolume);
    }
  }
}
