// src/audio/SimpleAudioEngine.ts
// Web Audio APIを直接使用したシンプルな音声エンジン
// ブラウザの自動再生ポリシーに完全対応

/**
 * シンプルな音声エンジンクラス
 * Tone.jsを使わずにWeb Audio APIを直接使用してブラウザの自動再生ポリシーに対応
 */
export class SimpleAudioEngine {
  private context: AudioContext | null = null;
  private isInitialized: boolean = false;
  private oscillators: Map<string, OscillatorNode> = new Map();

  constructor() {
    console.log('[SimpleAudioEngine] SimpleAudioEngineが初期化されました（AudioContextはユーザーインタラクション時に作成）');
  }

  /**
   * AudioContextを初期化する（ユーザーインタラクション時のみ）
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.context) {
      return;
    }

    try {
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
    if (!this.context) {
      throw new Error('AudioContextが初期化されていません');
    }

    try {
      console.log('[SimpleAudioEngine] 音符を再生:', frequency, 'Hz', duration, '秒');
      
      // オシレーターを作成
      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();
      
      // 音色設定（シンプルなサイン波）
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
      
      // ボリューム設定（エンベロープ付き）
      gainNode.gain.setValueAtTime(0, this.context.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, this.context.currentTime + 0.01); // アタック
      gainNode.gain.exponentialRampToValueAtTime(0.1, this.context.currentTime + duration * 0.3); // ディケイ
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + duration); // リリース
      
      // 接続
      oscillator.connect(gainNode);
      gainNode.connect(this.context.destination);
      
      // 再生
      oscillator.start(this.context.currentTime);
      oscillator.stop(this.context.currentTime + duration);
      
      console.log('[SimpleAudioEngine] 音符再生開始');
      
    } catch (error) {
      console.error('[SimpleAudioEngine] 音符再生に失敗:', error);
      throw error;
    }
  }

  /**
   * 音高名から周波数を計算する
   * Vexflow形式（c/4）とMIDI形式（C4）の両方に対応
   */
  noteToFrequency(note: string): number {
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
    
    const frequency = A4 * Math.pow(semitoneRatio, semitonesFromA4);
    console.log('[SimpleAudioEngine] 音高変換:', note, '->', normalizedNote, '->', frequency.toFixed(2), 'Hz');
    
    return frequency;
  }

  /**
   * Vexflow形式（c/4）をMIDI形式（C4）に正規化する
   * @param note 音高名（c/4, C4, f#/3, F#3 など）
   * @returns MIDI形式の音高名（C4, F#3 など）
   */
  private normalizeNoteFormat(note: string): string {
    // 既にMIDI形式（C4, F#3など）の場合はそのまま返す
    if (/^[A-G][#b]?\d+$/.test(note)) {
      return note;
    }
    
    // Vexflow形式（c/4, f#/3など）をMIDI形式に変換
    const vexflowMatch = note.match(/^([a-g])([#b]?)[\/\s](\d+)$/);
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
   * 音価から秒数を計算する
   */
  durationToSeconds(duration: string, bpm: number = 120): number {
    const durMap: Record<string, number> = {
      '1': 4,     // 全音符
      '2': 2,     // 2分音符
      '4': 1,     // 4分音符
      '8': 0.5,   // 8分音符
      '16': 0.25, // 16分音符
      '32': 0.125,// 32分音符
      '64': 0.0625// 64分音符
    };

    const beats = durMap[duration] || 1;
    const secondsPerBeat = 60 / bpm;
    const seconds = beats * secondsPerBeat;
    
    console.log('[SimpleAudioEngine] 音価変換:', duration, '->', seconds, '秒 (BPM:', bpm, ')');
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
   * AudioEngineが使用可能かチェックする
   */
  isReady(): boolean {
    return this.isInitialized && this.context !== null && this.context.state === 'running';
  }

  /**
   * 譜面データから音符を順次再生する
   */
  async playScore(scoreData: Array<{ events: Array<{ dur: string; isRest: boolean; keys: string[] }> }>, bpm: number = 120): Promise<void> {
    if (!this.context) {
      throw new Error('AudioContextが初期化されていません');
    }

    try {
      console.log('[SimpleAudioEngine] 譜面再生を開始:', scoreData.length, '小節');
      
      let currentTime = this.context.currentTime;
      
      // 各小節を順次処理
      for (let measureIndex = 0; measureIndex < scoreData.length; measureIndex++) {
        const measure = scoreData[measureIndex];
        if (!measure || !measure.events || measure.events.length === 0) {
          // 空の小節は全休符として扱う
          const wholeDuration = this.durationToSeconds('1', bpm);
          currentTime += wholeDuration;
          continue;
        }
        
        // 小節内の各音符を処理
        for (const event of measure.events) {
          const duration = this.durationToSeconds(event.dur, bpm);
          
          if (!event.isRest && event.keys && event.keys.length > 0) {
            // 音符の場合は最初の音高を再生（単音対応）
            const frequency = this.noteToFrequency(event.keys[0]);
            await this.playNoteAtTime(frequency, duration, currentTime);
          }
          // 休符の場合は時間だけ進める
          
          currentTime += duration;
        }
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
  private async playNoteAtTime(frequency: number, duration: number, startTime: number): Promise<void> {
    if (!this.context) {
      throw new Error('AudioContextが初期化されていません');
    }

    try {
      // オシレーターを作成
      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();
      
      // 音色設定（シンプルなサイン波）
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startTime);
      
      // ボリューム設定（エンベロープ付き）
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01); // アタック
      gainNode.gain.exponentialRampToValueAtTime(0.1, startTime + duration * 0.3); // ディケイ
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration); // リリース
      
      // 接続
      oscillator.connect(gainNode);
      gainNode.connect(this.context.destination);
      
      // 再生スケジュール
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
      
    } catch (error) {
      console.error('[SimpleAudioEngine] 時刻指定音符再生に失敗:', error);
      throw error;
    }
  }

  /**
   * 複数パート（右手・左手など）を同時再生する
   */
  async playParts(parts: Array<{ measures: Array<{ events: Array<{ dur: string; isRest: boolean; keys: string[] }> }> }>, bpm: number = 120): Promise<void> {
    if (!this.context) {
      throw new Error('AudioContextが初期化されていません');
    }
    // 全パートを並列でスケジュールする
    await Promise.all(parts.map(part => this.playScore(part.measures, bpm)));
  }

  /**
   * リソースを解放する
   */
  dispose(): void {
    try {
      console.log('[SimpleAudioEngine] リソースを解放します...');
      
      // すべてのオシレーターを停止
      for (const [, oscillator] of this.oscillators) {
        try {
          oscillator.stop();
          oscillator.disconnect();
        } catch (error) {
          // 既に停止している場合はエラーを無視
        }
      }
      this.oscillators.clear();
      
      // AudioContextを閉じる
      if (this.context) {
        this.context.close();
        this.context = null;
      }
      
      this.isInitialized = false;
      console.log('[SimpleAudioEngine] リソースの解放が完了しました');
      
    } catch (error) {
      console.error('[SimpleAudioEngine] リソース解放中にエラーが発生しました:', error);
    }
  }
}

// デフォルトのSimpleAudioEngineインスタンスをエクスポート
export const defaultSimpleAudioEngine = new SimpleAudioEngine();