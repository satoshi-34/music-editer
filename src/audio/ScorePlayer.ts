// src/audio/ScorePlayer.ts
// 譜面全体の再生を担当するクラス

// Tone.jsの動的インポートのための型定義
type ToneModule = typeof import('tone');

import { AudioEngine } from './AudioEngine';
import { TempoManager, type TempoSettings } from './TempoManager';
import { SoundSource } from './SoundSource';
import { AudioErrorHandler, AudioErrorFactory } from './AudioError';
import { expandMeasuresForPlayback } from './repeatPlaybackUtils';
import type { MeasureData, NoteEvent, DurKey } from '../types/storage';
import { buildDynamicEventKey, resolveDynamicVelocities } from '../utils/dynamicMarkingUtils';

/**
 * 再生位置を表すインターフェース
 */
export interface PlaybackPosition {
  /** 小節インデックス（0から開始） */
  measureIndex: number;
  /** 小節内での拍位置（0から開始、4/4拍子なら0-3.99...） */
  beatPosition: number;
  /** 小節内での音符インデックス（0から開始） */
  noteIndex: number;
}

/**
 * 譜面再生のオプション
 */
export interface ScorePlaybackOptions {
  /** 再生開始位置 */
  startPosition?: PlaybackPosition;
  /** 再生終了位置 */
  endPosition?: PlaybackPosition;
  /** ループ再生するかどうか */
  loop?: boolean;
}

/**
 * 再生用にスケジュールされた音符データ
 */
interface ScheduledNote {
  /** Tone.js形式の音高配列（単音: ["C4"]、和音: ["C4","E4","G4"]） */
  note: string[];
  /** ベロシティ（0-1の範囲） */
  velocity: number;
  /** 再生時間（秒） */
  duration: number;
  /** 絶対時間（秒、譜面開始からの経過時間） */
  time: number;
  /** 小節インデックス */
  measureIndex: number;
  /** 小節内の音符インデックス */
  noteIndex: number;
  /** 元の音符イベント */
  originalEvent: NoteEvent;
}

/**
 * 再生状態を表す型
 */
export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';

/**
 * 再生状態の定数
 */
const PLAYBACK_STATE = {
  STOPPED: 'stopped',
  PLAYING: 'playing',
  PAUSED: 'paused',
  LOADING: 'loading'
};

export { PLAYBACK_STATE };

/**
 * 譜面全体の再生を担当するクラス
 * Tone.jsのTransportとPartを使用した時系列再生を行い、
 * 再生位置の追跡と管理を提供する
 */
export class ScorePlayer {
  private part: any | null = null; // Tone.Part型だが、動的インポートのためanyを使用
  private currentPosition: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
  private playbackState: PlaybackState = PLAYBACK_STATE.STOPPED as PlaybackState;
  private scheduledNotes: ScheduledNote[] = [];
  private measures: MeasureData[] = [];
  private Tone: ToneModule | null = null; // 動的にインポートされるTone.jsモジュール
  
  // コールバック関数
  private positionChangeCallbacks: Set<(position: PlaybackPosition) => void> = new Set();
  private playbackCompleteCallbacks: Set<() => void> = new Set();
  private stateChangeCallbacks: Set<(state: PlaybackState) => void> = new Set();

  // 再生オプション
  private currentOptions: ScorePlaybackOptions = {};

  constructor(
    private audioEngine: AudioEngine,
    private tempoManager: TempoManager,
    private soundSource?: SoundSource
  ) {
    console.log('[ScorePlayer] ScorePlayerが初期化されました（Tone.jsは動的インポート）');
    
    // SoundSourceが提供されていない場合は新しいインスタンスを作成
    if (!this.soundSource) {
      this.soundSource = new SoundSource(audioEngine);
    }

    // テンポ変更の監視
    this.tempoManager.onChange(this.handleTempoChange.bind(this));
  }

  /**
   * 譜面データを読み込んで再生スケジュールを生成する
   * 
   * @param measures 譜面データの配列
   */
  loadScore(measures: MeasureData[]): void {
    try {
      console.log('[ScorePlayer] 譜面データを読み込み中...', measures.length, '小節');

      // 現在の再生を停止
      this.stop();

      // 元データ自体も保持しておく。
      // テンポ変更時の再スケジュールや seek の時間計算では、
      // 「展開前の譜面全体」が必要になるため。
      this.measures = [...measures];

      // 再生スケジュールを生成
      this.scheduledNotes = this.generatePlaybackSchedule(measures);

      console.log('[ScorePlayer] 再生スケジュール生成完了:', this.scheduledNotes.length, '音符');

    } catch (error) {
      const audioError = AudioErrorFactory.createLoadingError(
        '譜面データの読み込みに失敗しました',
        error instanceof Error ? error : new Error(String(error))
      );
      AudioErrorHandler.logError(audioError);
      throw error;
    }
  }

  /**
   * 譜面の再生を開始する
   * 
   * @param options 再生オプション
   */
  async play(options: ScorePlaybackOptions = {}): Promise<void> {
    // Tone.jsを動的にインポート（まだインポートされていない場合）
    if (!this.Tone) {
      console.log('[ScorePlayer] Tone.jsを動的にインポートします...');
      this.Tone = await import('tone');
      console.log('[ScorePlayer] Tone.jsのインポートが完了しました');
    }
    
    if (!this.audioEngine.isReady()) {
      throw new Error('AudioEngineが準備できていません');
    }

    if (this.scheduledNotes.length === 0) {
      console.warn('[ScorePlayer] 再生する音符がありません');
      return;
    }

    try {
      this.currentOptions = { ...options };
      
      // 再生状態を更新
      this.setPlaybackState(PLAYBACK_STATE.LOADING as PlaybackState);

      // 既存のPartを破棄
      if (this.part) {
        this.part.dispose();
        this.part = null;
      }

      // 開始位置を設定
      if (options.startPosition) {
        this.currentPosition = { ...options.startPosition };
      } else if (this.playbackState === PLAYBACK_STATE.STOPPED) {
        this.currentPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      }

      // 再生用のPartを作成
      await this.createPlaybackPart();

      // 再生開始
      this.setPlaybackState(PLAYBACK_STATE.PLAYING as PlaybackState);
      
      // Tone.jsのTransportを開始（まだ開始されていない場合）
      const transport = this.Tone.getTransport();
      if (transport.state !== 'started') {
        transport.start();
      }

      // Partを開始
      if (this.part) {
        (this.part as any).start();
      }

      console.log('[ScorePlayer] 再生を開始しました');

    } catch (error) {
      this.setPlaybackState(PLAYBACK_STATE.STOPPED as PlaybackState);
      const audioError = AudioErrorFactory.createPlaybackError(
        '譜面の再生開始に失敗しました',
        error instanceof Error ? error : new Error(String(error))
      );
      AudioErrorHandler.logError(audioError);
      throw error;
    }
  }

  /**
   * 再生を一時停止する
   */
  pause(): void {
    try {
      if (this.playbackState !== (PLAYBACK_STATE.PLAYING as PlaybackState)) {
        return;
      }

      // Partを一時停止
      if (this.part) {
        this.part.stop();
      }

      this.setPlaybackState(PLAYBACK_STATE.PAUSED as PlaybackState);
      console.log('[ScorePlayer] 再生を一時停止しました');

    } catch (error) {
      console.error('[ScorePlayer] 一時停止に失敗:', error);
    }
  }

  /**
   * 再生を停止する
   */
  stop(): void {
    try {
      // Partを停止・破棄
      if (this.part) {
        this.part.stop();
        this.part.dispose();
        this.part = null;
      }

      // 現在再生中の音符を停止
      if (this.soundSource) {
        const synth = this.soundSource.getSynth();
        if (synth) {
          synth.releaseAll();
        }
      }

      // 再生位置をリセット
      this.currentPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      this.notifyPositionChange();

      this.setPlaybackState(PLAYBACK_STATE.STOPPED as PlaybackState);
      console.log('[ScorePlayer] 再生を停止しました');

    } catch (error) {
      console.error('[ScorePlayer] 停止に失敗:', error);
    }
  }

  /**
   * 指定した位置にシークする
   * 
   * @param position シーク先の位置
   */
  seekTo(position: PlaybackPosition): void {
    try {
      // 位置の妥当性をチェック
      if (!this.isValidPosition(position)) {
        throw new Error('無効な再生位置です');
      }

      const wasPlaying = this.playbackState === (PLAYBACK_STATE.PLAYING as PlaybackState);

      // 一時的に停止
      if (wasPlaying) {
        this.pause();
      }

      // 位置を更新
      this.currentPosition = { ...position };
      this.notifyPositionChange();

      // 再生中だった場合は再開
      if (wasPlaying) {
        this.play({ ...this.currentOptions, startPosition: position });
      }

      console.log('[ScorePlayer] 位置をシーク:', position);

    } catch (error) {
      console.error('[ScorePlayer] シークに失敗:', error);
      throw error;
    }
  }

  /**
   * 現在の再生位置を取得する
   * 
   * @returns 現在の再生位置
   */
  getCurrentPosition(): PlaybackPosition {
    return { ...this.currentPosition };
  }

  /**
   * 現在の再生状態を取得する
   * 
   * @returns 現在の再生状態
   */
  getPlaybackState(): PlaybackState {
    return this.playbackState;
  }

  /**
   * 再生位置変更のコールバックを登録する
   * 
   * @param callback 位置変更時に呼び出されるコールバック
   */
  onPositionChange(callback: (position: PlaybackPosition) => void): void {
    this.positionChangeCallbacks.add(callback);
  }

  /**
   * 再生完了のコールバックを登録する
   * 
   * @param callback 再生完了時に呼び出されるコールバック
   */
  onPlaybackComplete(callback: () => void): void {
    this.playbackCompleteCallbacks.add(callback);
  }

  /**
   * 再生状態変更のコールバックを登録する
   * 
   * @param callback 状態変更時に呼び出されるコールバック
   */
  onStateChange(callback: (state: PlaybackState) => void): void {
    this.stateChangeCallbacks.add(callback);
  }

  /**
   * コールバックを削除する
   * 
   * @param callback 削除するコールバック
   */
  removePositionChangeCallback(callback: (position: PlaybackPosition) => void): void {
    this.positionChangeCallbacks.delete(callback);
  }

  removePlaybackCompleteCallback(callback: () => void): void {
    this.playbackCompleteCallbacks.delete(callback);
  }

  removeStateChangeCallback(callback: (state: PlaybackState) => void): void {
    this.stateChangeCallbacks.delete(callback);
  }

  /**
   * ScorePlayerを破棄し、リソースを解放する
   */
  dispose(): void {
    try {
      // 再生を停止
      this.stop();

      // コールバックをクリア
      this.positionChangeCallbacks.clear();
      this.playbackCompleteCallbacks.clear();
      this.stateChangeCallbacks.clear();

      // テンポ変更の監視を解除
      this.tempoManager.removeListener(this.handleTempoChange.bind(this));

      console.log('[ScorePlayer] リソースを解放しました');

    } catch (error) {
      console.error('[ScorePlayer] リソース解放中にエラー:', error);
    }
  }

  /**
   * 譜面データから再生スケジュールを生成する
   * @private
   */
  private generatePlaybackSchedule(measures: MeasureData[]): ScheduledNote[] {
    const schedule: ScheduledNote[] = [];
    const tempoSettings = this.tempoManager.getSettings();
    // リピート記号を含む譜面は、まず「実際に通る小節順」へ並べ替える。
    // これを先にやっておくと、下の処理は「前から順に音価を足していく」
    // という単純なロジックのままで済む。
    const expandedMeasures = expandMeasuresForPlayback(measures);
    const dynamicVelocities = resolveDynamicVelocities(expandedMeasures.map(item => item.measure));

    let currentTime = 0; // 累積時間（秒）
    // 小節単位のテンポ変更に対応するため「現在有効な BPM」を追跡する。
    // グローバルテンポを初期値とし、各小節の bpm フィールドで上書きする。
    let currentBpm = tempoSettings.bpm;

    for (let expandedMeasureIndex = 0; expandedMeasureIndex < expandedMeasures.length; expandedMeasureIndex++) {
      const expandedMeasure = expandedMeasures[expandedMeasureIndex];
      const measure = expandedMeasure.measure;
      // 小節に途中テンポが設定されていれば、その小節から BPM を切り替える
      if (measure.bpm != null) {
        currentBpm = measure.bpm;
      }
      let measureTime = 0; // 小節内での時間（秒）

      for (let noteIndex = 0; noteIndex < measure.events.length; noteIndex++) {
        const event = measure.events[noteIndex];

        // 音価から再生時間を計算（現在有効な BPM を使う）
        const duration = this.durToSeconds(event.dur, currentBpm, event.dots);
        
        // 休符でない場合のみスケジュールに追加（和音は配列で保持）
        if (!event.isRest && event.keys?.length) {
          const scheduledNote: ScheduledNote = {
            note: event.keys.map(k => this.convertKeyToToneFormat(k)),
            velocity: dynamicVelocities.get(buildDynamicEventKey(expandedMeasureIndex, noteIndex)) ?? 0.5,
            duration: duration,
            time: currentTime + measureTime,
            // 展開後に同じ小節が再登場しても、UI 側には元の小節番号を返す。
            // これでハイライトが「譜面上のどこを鳴らしているか」と一致する。
            measureIndex: expandedMeasure.sourceMeasureIndex,
            noteIndex: noteIndex,
            originalEvent: event
          };
          
          schedule.push(scheduledNote);
        }

        // 次の音符の開始時間を計算
        // 休符も「何も鳴らさない音価」として時間は進める必要があるため、
        // schedule に push しない場合でも measureTime は必ず足す。
        measureTime += duration;
      }

      // 次の小節の開始時間を更新
      // 小節ごとにまとめて currentTime へ反映しておくと、
      // 後続の小節は常に「譜面先頭から何秒後か」で扱える。
      currentTime += measureTime;
    }

    return schedule;
  }

  /**
   * 再生用のTone.Partを作成する
   * @private
   */
  private async createPlaybackPart(): Promise<void> {
    // Tone.jsが動的にインポートされていることを確認
    if (!this.Tone) {
      throw new Error('Tone.jsがインポートされていません');
    }
    
    if (!this.soundSource) {
      throw new Error('SoundSourceが利用できません');
    }

    const synth = this.soundSource.getSynth();
    if (!synth) {
      throw new Error('シンセサイザーが利用できません');
    }

    // 開始位置以降の音符のみを抽出
    const startTime = this.getTimeAtPosition(this.currentPosition);
    const filteredNotes = this.scheduledNotes.filter(note => note.time >= startTime);

    // 終了位置が指定されている場合はフィルタリング
    if (this.currentOptions.endPosition) {
      const endTime = this.getTimeAtPosition(this.currentOptions.endPosition);
      filteredNotes.splice(0, filteredNotes.length, ...filteredNotes.filter(note => note.time < endTime));
    }

    // Tone.Partのイベント配列を作成
    const events = filteredNotes.map(note => ({
      time: note.time - startTime, // 相対時間に変換
      note: note.note,
      duration: note.duration,
      velocity: note.velocity,
      measureIndex: note.measureIndex,
      noteIndex: note.noteIndex
    }));

    // Partを作成
    this.part = new (this.Tone.Part as any)((time: number, event: any) => {
      // 音符を再生
      synth.triggerAttackRelease(event.note, event.duration, time, event.velocity);
      
      // 再生位置を更新
      this.updateCurrentPosition(event.measureIndex, event.noteIndex);
      
    }, events);

    // 再生完了時のコールバック
    if (this.part) {
      this.part.callback = () => {
        // 最後の音符の再生が完了したら停止
        if (this.part && this.part.progress === 1) {
          this.handlePlaybackComplete();
        }
      };
    }

    // ループ設定
    if (this.currentOptions.loop && this.part) {
      this.part.loop = true;
    }
  }

  /**
   * 音価から秒数を計算する
   * @private
   */
  private durToSeconds(dur: DurKey, bpm: number, dots?: 1 | 2): number {
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
    // 付点1個で1.5倍、複付点(2個)で1.75倍に長さを伸ばす
    const dotRatio = dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1.0;
    const quarterNoteSeconds = 60 / bpm;
    return quarterNoteSeconds * ratio * dotRatio;
  }

  /**
   * VexflowキーをTone.js形式に変換する
   * @private
   */
  private convertKeyToToneFormat(key: string): string {
    // VexflowのキーはすでにTone.js互換形式
    if (key.includes('/')) {
      return key.replace('/', '');
    }
    return key;
  }

  /**
   * 指定した位置での時間を取得する
   * @private
   */
  private getTimeAtPosition(position: PlaybackPosition): number {
    let time = 0;
    const tempoSettings = this.tempoManager.getSettings();

    // 指定した小節まで時間を累積
    for (let i = 0; i < position.measureIndex && i < this.measures.length; i++) {
      const measure = this.measures[i];
      for (const event of measure.events) {
        time += this.durToSeconds(event.dur, tempoSettings.bpm, event.dots);
      }
    }

    // 小節内での位置を追加
    if (position.measureIndex < this.measures.length) {
      const measure = this.measures[position.measureIndex];
      for (let i = 0; i < position.noteIndex && i < measure.events.length; i++) {
        const event = measure.events[i];
        time += this.durToSeconds(event.dur, tempoSettings.bpm, event.dots);
      }
    }

    return time;
  }

  /**
   * 再生位置が有効かチェックする
   * @private
   */
  private isValidPosition(position: PlaybackPosition): boolean {
    if (position.measureIndex < 0 || position.measureIndex >= this.measures.length) {
      return false;
    }

    const measure = this.measures[position.measureIndex];
    if (position.noteIndex < 0 || position.noteIndex >= measure.events.length) {
      return false;
    }

    return position.beatPosition >= 0;
  }

  /**
   * 現在の再生位置を更新する
   * @private
   */
  private updateCurrentPosition(measureIndex: number, noteIndex: number): void {
    // 拍位置を計算（簡略化）
    const beatPosition = noteIndex; // 実際の実装では音価を考慮した正確な計算が必要

    this.currentPosition = {
      measureIndex,
      beatPosition,
      noteIndex
    };

    this.notifyPositionChange();
  }

  /**
   * 再生状態を設定し、コールバックを通知する
   * @private
   */
  private setPlaybackState(state: PlaybackState): void {
    if (this.playbackState !== state) {
      this.playbackState = state;
      this.notifyStateChange();
    }
  }

  /**
   * 位置変更をコールバックに通知する
   * @private
   */
  private notifyPositionChange(): void {
    const position = this.getCurrentPosition();
    this.positionChangeCallbacks.forEach(callback => {
      try {
        callback(position);
      } catch (error) {
        console.error('[ScorePlayer] 位置変更コールバックでエラー:', error);
      }
    });
  }

  /**
   * 状態変更をコールバックに通知する
   * @private
   */
  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach(callback => {
      try {
        callback(this.playbackState);
      } catch (error) {
        console.error('[ScorePlayer] 状態変更コールバックでエラー:', error);
      }
    });
  }

  /**
   * 再生完了を処理する
   * @private
   */
  private handlePlaybackComplete(): void {
    this.setPlaybackState(PLAYBACK_STATE.STOPPED as PlaybackState);
    
    // 再生位置をリセット
    this.currentPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
    this.notifyPositionChange();

    // 完了コールバックを通知
    this.playbackCompleteCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('[ScorePlayer] 再生完了コールバックでエラー:', error);
      }
    });

    console.log('[ScorePlayer] 再生が完了しました');
  }

  /**
   * テンポ変更を処理する
   * @private
   */
  private handleTempoChange(settings: TempoSettings): void {
    console.log('[ScorePlayer] テンポが変更されました:', settings.bpm, 'BPM');

    // 再生中の場合は新しいテンポを即座に適用
    if (this.playbackState === (PLAYBACK_STATE.PLAYING as PlaybackState)) {
      // 現在の位置を保存
      const currentPos = this.getCurrentPosition();
      
      // 再生を停止して再開
      this.stop();
      this.loadScore(this.measures); // スケジュールを再生成
      this.play({ ...this.currentOptions, startPosition: currentPos });
    } else {
      // 停止中の場合はスケジュールのみ再生成
      if (this.measures.length > 0) {
        this.scheduledNotes = this.generatePlaybackSchedule(this.measures);
      }
    }
  }
}
