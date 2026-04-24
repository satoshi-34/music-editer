// src/audio/NotePlayer.ts
// 個別音符の再生を担当するクラス

// Tone.jsの動的インポートのための型定義
type ToneModule = typeof import('tone');

import { AudioEngine } from './AudioEngine';
import { AudioErrorHandler, AudioErrorFactory } from './AudioError';
import { SoundSource, InstrumentType } from './SoundSource';

/**
 * 音符の音価を表すキー
 */
export type DurKey = '1' | '2' | '4' | '8' | '16' | '32' | '64';

/**
 * 音符イベントの型定義（既存のStaffCanvasと互換性を保つ）
 */
export interface NoteEvent {
  /** 音価 */
  dur: DurKey;
  /** 休符かどうか */
  isRest: boolean;
  /** 音高キー（例: "C4", "F#3"） */
  key: string;
}

/**
 * 音符再生のオプション
 */
export interface NotePlaybackOptions {
  /** ベロシティ（0-1の範囲、デフォルト0.5） */
  velocity?: number;
  /** 再生時間（秒またはTone.js時間記法、デフォルトは音価から計算） */
  duration?: string | number;
  /** 再生開始時刻（Tone.js時間記法、デフォルトは即座） */
  time?: string | number;
}

/**
 * 楽器の種類（SoundSourceから再エクスポート）
 */
export { InstrumentType } from './SoundSource';

/**
 * 個別音符の再生を担当するクラス
 * SoundSourceクラスと統合して音色管理を行い、
 * 音高変換や音価から再生時間への変換を行う
 */
export class NotePlayer {
  private currentNotes: Set<string> = new Set();
  private volume: number = 0.5; // 0-1の範囲
  private audioEngine: AudioEngine;
  private soundSource: SoundSource;
  private Tone: ToneModule | null = null; // 動的にインポートされるTone.jsモジュール

  constructor(audioEngine: AudioEngine, soundSource?: SoundSource) {
    this.audioEngine = audioEngine;
    this.soundSource = soundSource || new SoundSource(audioEngine);
    console.log('[NotePlayer] NotePlayerが初期化されました（Tone.jsは動的インポート）');
  }

  /**
   * 現在のシンセサイザーを取得する
   * @private
   */
  private _getCurrentSynth(): any | null {
    const synth = this.soundSource.getSynth();
    console.log('[NotePlayer] 現在のシンセサイザー:', synth ? 'あり' : 'なし');
    if (synth) {
      console.log('[NotePlayer] シンセサイザーの状態:', {
        volume: synth.volume.value,
        disposed: synth.disposed
      });
    }
    return synth;
  }

  /**
   * 音価から再生時間（秒）を計算する
   * @private
   */
  private _durToSeconds(dur: DurKey, bpm: number = 120): number {
    // 4分音符を基準とした比率
    const ratios: Record<DurKey, number> = {
      '1': 4.0,   // 全音符
      '2': 2.0,   // 2分音符
      '4': 1.0,   // 4分音符
      '8': 0.5,   // 8分音符
      '16': 0.25, // 16分音符
      '32': 0.125, // 32分音符
      '64': 0.0625 // 64分音符
    };

    const ratio = ratios[dur] || 1.0;
    const quarterNoteSeconds = 60 / bpm; // 4分音符の長さ（秒）
    return quarterNoteSeconds * ratio;
  }

  /**
   * VexflowキーをTone.js形式に変換する
   * @private
   */
  private _convertKeyToToneFormat(key: string): string {
    // Vexflow形式（c/4, f#/3など）をTone.js形式（C4, F#3など）に変換
    if (key.includes('/')) {
      // "c/4" → "C4", "f#/3" → "F#3"
      const parts = key.split('/');
      const noteName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      return noteName + parts[1];
    }
    // すでにTone.js形式（C4など）の場合は先頭を大文字に統一
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /**
   * 音符を再生する
   * 
   * @param key 音高キー（例: "C4", "F#3"）
   * @param options 再生オプション
   * @returns 再生完了のPromise
   */
  async playNote(key: string, options: NotePlaybackOptions = {}): Promise<void> {
    console.log('[NotePlayer] playNote開始:', key, options);
    
    // Tone.jsを動的にインポート（まだインポートされていない場合）
    if (!this.Tone) {
      console.log('[NotePlayer] Tone.jsを動的にインポートします...');
      this.Tone = await import('tone');
      console.log('[NotePlayer] Tone.jsのインポートが完了しました');
    }
    
    const synth = this._getCurrentSynth();
    if (!synth) {
      console.warn('[NotePlayer] シンセサイザーが利用できません');
      return;
    }

    if (!this.audioEngine.isReady()) {
      console.warn('[NotePlayer] AudioEngineが準備できていません');
      console.log('[NotePlayer] AudioEngine状態:', this.audioEngine.getState());
      return;
    }

    try {
      const toneKey = this._convertKeyToToneFormat(key);
      const velocity = Math.max(0, Math.min(1, options.velocity || 0.5));
      
      console.log('[NotePlayer] 変換後のキー:', toneKey, 'ベロシティ:', velocity);
      
      // 再生時間を決定
      let duration: string | number;
      if (options.duration !== undefined) {
        duration = options.duration;
      } else {
        // デフォルトは4分音符の長さ
        duration = this._durToSeconds('4');
      }

      // 再生開始時刻を決定
      const time = options.time || '+0';

      console.log('[NotePlayer] 再生パラメータ - 時間:', duration, '開始時刻:', time);

      // 前の音符を停止（連続再生の排他制御）
      this.stopAllNotes();

      // 音符を再生
      console.log('[NotePlayer] シンセサイザーで再生開始...');
      synth.triggerAttackRelease(toneKey, duration, time, velocity);
      console.log('[NotePlayer] 再生コマンド送信完了');
      
      // 現在再生中の音符として記録
      this.currentNotes.add(toneKey);

      console.log(`[NotePlayer] 音符を再生: ${toneKey}, 長さ: ${duration}, ベロシティ: ${velocity}`);

      // 再生完了後にセットから削除
      if (typeof duration === 'number') {
        setTimeout(() => {
          this.currentNotes.delete(toneKey);
        }, duration * 1000);
      }

    } catch (error) {
      const audioError = AudioErrorFactory.createPlaybackError(
        `音符の再生に失敗しました: ${key}`,
        error instanceof Error ? error : new Error(String(error))
      );
      AudioErrorHandler.logError(audioError);
      throw error;
    }
  }

  /**
   * NoteEventから音符を再生する
   * 
   * @param noteEvent 音符イベント
   * @param options 再生オプション
   * @returns 再生完了のPromise
   */
  async playNoteEvent(noteEvent: NoteEvent, options: NotePlaybackOptions = {}): Promise<void> {
    // 休符の場合は何もしない
    if (noteEvent.isRest) {
      console.log(`[NotePlayer] 休符をスキップ: ${noteEvent.dur}`);
      return;
    }

    // 音価から再生時間を計算（オプションで上書きされていない場合）
    if (options.duration === undefined) {
      options.duration = this._durToSeconds(noteEvent.dur);
    }

    return this.playNote(noteEvent.key, options);
  }

  /**
   * 指定した音符の再生を停止する
   * 
   * @param key 停止する音高キー
   */
  stopNote(key: string): void {
    const synth = this._getCurrentSynth();
    if (!synth) {
      return;
    }

    try {
      const toneKey = this._convertKeyToToneFormat(key);
      synth.triggerRelease(toneKey);
      this.currentNotes.delete(toneKey);
      
      console.log(`[NotePlayer] 音符を停止: ${toneKey}`);
    } catch (error) {
      console.warn(`[NotePlayer] 音符の停止に失敗: ${key}`, error);
    }
  }

  /**
   * 現在再生中のすべての音符を停止する
   */
  stopAllNotes(): void {
    const synth = this._getCurrentSynth();
    if (!synth) {
      return;
    }

    try {
      synth.releaseAll();
      this.currentNotes.clear();
      
      console.log('[NotePlayer] すべての音符を停止');
    } catch (error) {
      console.warn('[NotePlayer] 音符の停止に失敗', error);
    }
  }

  /**
   * 音色（楽器）を設定する
   * 要件5.3に対応：音色変更時にNote_Playerが新しい音色で個別音符を再生
   * 
   * @param instrument 楽器の種類
   */
  async setSoundSource(instrument: InstrumentType): Promise<void> {
    try {
      // 現在再生中の音符を停止
      this.stopAllNotes();
      
      // SoundSourceで楽器を設定
      this.soundSource.setCurrentInstrument(instrument);
      
      // 楽器が読み込まれていない場合は読み込み
      if (!this.soundSource.isInstrumentLoaded(instrument)) {
        await this.soundSource.loadInstrument(instrument);
      }
      
      console.log(`[NotePlayer] 音色を変更: ${instrument}`);
    } catch (error) {
      const audioError = AudioErrorFactory.createLoadingError(
        `音色の変更に失敗しました: ${instrument}`,
        error instanceof Error ? error : new Error(String(error))
      );
      AudioErrorHandler.logError(audioError);
      throw error;
    }
  }

  /**
   * ボリュームを設定する
   * 
   * @param volume ボリューム（0-1の範囲）
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // SoundSourceの全体ボリュームを設定
    this.soundSource.setGlobalVolume(this.volume);
    
    console.log(`[NotePlayer] ボリュームを設定: ${this.volume}`);
  }

  /**
   * 現在の音色を取得する
   * 
   * @returns 現在の楽器の種類
   */
  getCurrentInstrument(): InstrumentType {
    return this.soundSource.getCurrentInstrument();
  }

  /**
   * 現在のボリュームを取得する
   * 
   * @returns 現在のボリューム（0-1の範囲）
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * 現在再生中の音符のリストを取得する
   * 
   * @returns 再生中の音符キーのセット
   */
  getCurrentNotes(): Set<string> {
    return new Set(this.currentNotes);
  }

  /**
   * SoundSourceインスタンスを取得する
   * 
   * @returns SoundSourceインスタンス
   */
  getSoundSource(): SoundSource {
    return this.soundSource;
  }

  /**
   * NotePlayerを破棄し、リソースを解放する
   */
  dispose(): void {
    try {
      this.stopAllNotes();
      this.currentNotes.clear();
      
      // SoundSourceは外部から注入される可能性があるため、
      // 自分で作成した場合のみ破棄する
      // 実際の実装では、所有権を明確にする必要がある
      
      console.log('[NotePlayer] リソースを解放しました');
    } catch (error) {
      console.error('[NotePlayer] リソース解放中にエラーが発生:', error);
    }
  }
}