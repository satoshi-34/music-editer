// src/audio/AudioEngine.ts
// 音声エンジンの中核となるクラス
// Web Audio APIとTone.jsの初期化・管理を担当

// Tone.jsの動的インポートのための型定義
type ToneModule = typeof import('tone');

// Tone.jsの初期状態をログ出力
console.log('[AudioEngine] AudioEngineモジュールが読み込まれました（Tone.jsは動的インポート）');

/**
 * AudioEngineの設定オプション
 */
export interface AudioEngineConfig {
  /** サンプルレート（Hz）。未指定の場合はブラウザのデフォルト値を使用 */
  sampleRate?: number;
  /** レイテンシヒント。音声の用途に応じて最適化 */
  latencyHint?: 'interactive' | 'balanced' | 'playback';
  /** 先読み時間（秒）。音声処理の安定性に影響 */
  lookAhead?: number;
}

/**
 * 音声エンジンの中核クラス
 * Web Audio APIとTone.jsの初期化・管理を担当し、
 * ブラウザの自動再生ポリシーに適切に対応する
 */
export class AudioEngine {
  private context: any | null = null; // Tone.Context型だが、動的インポートのためanyを使用
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private config: AudioEngineConfig;
  private Tone: ToneModule | null = null; // 動的にインポートされるTone.jsモジュール

  constructor(config: AudioEngineConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate,
      latencyHint: config.latencyHint || 'interactive',
      lookAhead: config.lookAhead || 0.1,
      ...config
    };
  }

  /**
   * AudioEngineを初期化する
   * ブラウザの自動再生ポリシーに対応するため、ユーザーインタラクション後に呼び出す必要がある
   * 
   * @param config 初期化設定（オプション）
   * @returns 初期化完了のPromise
   */
  async initialize(config?: AudioEngineConfig): Promise<void> {
    // 既に初期化中または完了している場合は、その結果を返す
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.isInitialized) {
      return Promise.resolve();
    }

    // 設定をマージ
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // 初期化処理を開始
    this.initializationPromise = this._performInitialization();
    
    try {
      await this.initializationPromise;
    } catch (error) {
      // 初期化に失敗した場合、再試行できるようにPromiseをクリア
      this.initializationPromise = null;
      throw error;
    }
  }

  /**
   * 実際の初期化処理を実行する
   * @private
   */
  private async _performInitialization(): Promise<void> {
    try {
      console.log('[AudioEngine] 初期化を開始します...');

      // Tone.jsがデフォルトでAudioContextを作成しないように設定
      // ただし、これは既にTone.jsが読み込まれた後では効果がない可能性がある
      console.log('[AudioEngine] Tone.jsの自動AudioContext作成を無効化します');

      // Tone.jsのContextはユーザーインタラクション時に作成するため、
      // ここでは何もしない
      this.context = null;

      this.isInitialized = true;
      console.log('[AudioEngine] 初期化が完了しました（AudioContextはユーザーインタラクション時に作成）');

    } catch (error) {
      console.error('[AudioEngine] 初期化に失敗しました:', error);
      this.isInitialized = false;
      this.context = null;
      
      throw new Error(`オーディオエンジンの初期化に失敗しました: ${error}`);
    }
  }

  /**
   * AudioContextを開始する
   * ブラウザの自動再生ポリシーにより、ユーザーインタラクション後に呼び出す必要がある
   * 
   * @returns 開始完了のPromise
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('AudioEngineが初期化されていません。initialize()を先に呼び出してください。');
    }

    try {
      console.log('[AudioEngine] start()が呼び出されました');
      
      // Tone.jsを動的にインポート（ユーザーインタラクション時のみ）
      if (!this.Tone) {
        console.log('[AudioEngine] Tone.jsを動的にインポートします...');
        this.Tone = await import('tone');
        console.log('[AudioEngine] Tone.jsのインポートが完了しました');
      }
      
      console.log('[AudioEngine] 現在のTone.jsコンテキスト状態:', this.Tone.getContext().state);
      
      // Tone.jsを使用してAudioContextを開始
      // これにより、ユーザーインタラクション時にAudioContextが適切に作成・開始される
      if (this.Tone.getContext().state === 'suspended') {
        console.log('[AudioEngine] Tone.jsのAudioContextを開始します...');
        await this.Tone.start();
        console.log('[AudioEngine] Tone.jsのAudioContextが開始されました');
      } else if (this.Tone.getContext().state === 'closed') {
        console.log('[AudioEngine] AudioContextが閉じられています。Tone.jsで再作成します...');
        await this.Tone.start();
        console.log('[AudioEngine] 新しいAudioContextが作成・開始されました');
      } else if (this.Tone.getContext().state === 'running') {
        console.log('[AudioEngine] AudioContextは既に実行中です');
      } else {
        console.log('[AudioEngine] 不明なAudioContext状態、Tone.start()を実行します:', this.Tone.getContext().state);
        await this.Tone.start();
      }
      
      // コンテキストの参照を更新
      this.context = this.Tone.getContext();
      
      console.log('[AudioEngine] 最終的なAudioContextの状態:', this.context.state);
      
      // Tone.jsのTransportも開始
      const transport = this.Tone.getTransport();
      console.log('[AudioEngine] Transport状態:', transport.state);
      if (transport.state === 'stopped') {
        console.log('[AudioEngine] Tone.js Transportを開始します...');
        transport.start();
        console.log('[AudioEngine] Tone.js Transportが開始されました');
      }

      console.log('[AudioEngine] AudioContextの開始が完了しました');

    } catch (error) {
      console.error('[AudioEngine] 開始に失敗しました:', error);
      
      // ブラウザの自動再生ポリシーエラーの場合は、より具体的なメッセージを提供
      if (error instanceof Error && (
        error.message.includes('user gesture') || 
        error.message.includes('not allowed to start') ||
        error.message.includes('user activation')
      )) {
        throw new Error('音声を再生するには、ボタンをクリックしてください。ブラウザのセキュリティポリシーにより、ユーザーの操作が必要です。');
      }
      
      throw new Error(`オーディオエンジンの開始に失敗しました: ${error}`);
    }
  }

  /**
   * AudioContextを一時停止する
   * 
   * @returns 一時停止完了のPromise
   */
  async suspend(): Promise<void> {
    if (!this.context || !this.Tone) {
      return;
    }

    try {
      console.log('[AudioEngine] AudioContextを一時停止します...');
      // Tone.js v14では、Contextに直接suspendメソッドがない場合があるため、
      // rawContextを使用
      if (this.context.rawContext && typeof this.context.rawContext.suspend === 'function') {
        // AudioContext.suspend()は引数が必要な場合があるため、現在時刻を渡す
        await this.context.rawContext.suspend(this.context.rawContext.currentTime);
      } else {
        console.warn('[AudioEngine] suspend機能が利用できません');
      }
      console.log('[AudioEngine] AudioContextが一時停止されました');
    } catch (error) {
      console.error('[AudioEngine] 一時停止に失敗しました:', error);
      throw new Error(`オーディオエンジンの一時停止に失敗しました: ${error}`);
    }
  }

  /**
   * AudioContextを再開する
   * 
   * @returns 再開完了のPromise
   */
  async resume(): Promise<void> {
    if (!this.context || !this.Tone) {
      throw new Error('AudioEngineが初期化されていません。');
    }

    try {
      if (this.context.state === 'suspended') {
        console.log('[AudioEngine] AudioContextを再開します...');
        await this.context.resume();
        console.log('[AudioEngine] AudioContextが再開されました');
      }
    } catch (error) {
      console.error('[AudioEngine] 再開に失敗しました:', error);
      throw new Error(`オーディオエンジンの再開に失敗しました: ${error}`);
    }
  }

  /**
   * AudioEngineを破棄し、すべてのリソースを解放する
   */
  dispose(): void {
    try {
      console.log('[AudioEngine] リソースを解放します...');
      
      // Tone.jsのTransportを停止
      if (this.Tone) {
        if (this.Tone.getTransport().state !== 'stopped') {
          this.Tone.getTransport().stop();
          this.Tone.getTransport().cancel();
        }
      }

      // コンテキストを閉じる
      if (this.context) {
        this.context.dispose();
        this.context = null;
      }

      this.isInitialized = false;
      this.initializationPromise = null;
      this.Tone = null;
      
      console.log('[AudioEngine] リソースの解放が完了しました');
    } catch (error) {
      console.error('[AudioEngine] リソース解放中にエラーが発生しました:', error);
    }
  }

  /**
   * Tone.jsのコンテキストを取得する
   * 
   * @returns Tone.Contextインスタンス、または未初期化の場合はnull
   */
  getContext(): any | null {
    if (this.Tone) {
      return this.Tone.getContext();
    }
    return null;
  }

  /**
   * AudioEngineが使用可能な状態かチェックする
   * 
   * @returns 使用可能な場合はtrue
   */
  isReady(): boolean {
    if (!this.Tone) {
      return false;
    }
    
    const context = this.Tone.getContext();
    const ready = this.isInitialized && 
           context !== null && 
           context.state === 'running';
           
    console.log('[AudioEngine] isReady チェック:', {
      isInitialized: this.isInitialized,
      hasTone: !!this.Tone,
      hasContext: !!context,
      contextState: context?.state || 'null',
      ready
    });
    
    return ready;
  }

  /**
   * AudioEngineが初期化済みかチェックする
   * 
   * @returns 初期化済みの場合はtrue
   */
  isInitializedState(): boolean {
    return this.isInitialized;
  }

  /**
   * AudioContextの現在の状態を取得する
   * 
   * @returns AudioContextの状態文字列
   */
  getState(): AudioContextState | 'uninitialized' {
    if (!this.Tone) {
      return 'uninitialized';
    }
    
    const context = this.Tone.getContext();
    if (!context) {
      return 'uninitialized';
    }
    return context.state;
  }

  /**
   * AudioContextが中断された場合の自動復旧を試行する
   * ページの可視性変更やブラウザの省電力モードからの復帰時に使用
   * 
   * @returns 復旧完了のPromise
   */
  async attemptRecovery(): Promise<void> {
    if (!this.Tone) {
      console.warn('[AudioEngine] 復旧試行: Tone.jsが読み込まれていません');
      return;
    }
    
    const context = this.Tone.getContext();
    if (!context) {
      console.warn('[AudioEngine] 復旧試行: コンテキストが存在しません');
      return;
    }

    try {
      if (context.state === 'suspended') {
        console.log('[AudioEngine] 中断されたコンテキストの復旧を試行します...');
        await context.resume();
        console.log('[AudioEngine] コンテキストの復旧が完了しました');
      }
    } catch (error) {
      console.error('[AudioEngine] 復旧に失敗しました:', error);
      // 復旧に失敗した場合は、再初期化を促す
      throw new Error('オーディオコンテキストの復旧に失敗しました。ページを再読み込みしてください。');
    }
  }
}

// デフォルトのAudioEngineインスタンスをエクスポート
export const defaultAudioEngine = new AudioEngine();