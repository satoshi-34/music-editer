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
  // Tone.Context をそのまま書きたいが、動的 import との相性で型が複雑になるため
  // ここでは any にして、公開メソッド側で責務を絞って扱う。
  private context: any | null = null;
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

      if (!this.Tone) {
        this.Tone = await import('tone');
      }

      // Tone.js では「グローバルな現在の Context」を差し替えて使うことが多い。
      // そのため Context を new したあと、setContext で必ず全体へ反映する。
      const contextOptions: Record<string, any> = {
        latencyHint: this.config.latencyHint || 'interactive'
      };
      if (this.config.sampleRate !== undefined) {
        contextOptions.sampleRate = this.config.sampleRate;
      }
      if (this.config.lookAhead !== undefined) {
        // Tone.js 15 では lookAhead は Transport ではなく Context の設定値。
        // 生成時に渡しておくと、実装と型定義の両方が一致する。
        contextOptions.lookAhead = this.config.lookAhead;
      }

      this.context = new (this.Tone.Context as any)(contextOptions);
      this.Tone.setContext(this.context);

      this.isInitialized = true;
      console.log('[AudioEngine] 初期化が完了しました');

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
      if (!this.context) {
        throw new Error('AudioContextが利用できません。');
      }

      if (this.context.state !== 'running') {
        await this.context.resume();
      }

      // Transportも開始
      const transport = this.Tone?.getTransport();
      if (transport && transport.state === 'stopped') {
        transport.start();
      }

    } catch (error) {
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
    if (!this.context) {
      return;
    }

    try {
      await this.context.suspend();
    } catch (error) {
      throw new Error(`オーディオエンジンの一時停止に失敗しました: ${error}`);
    }
  }

  /**
   * AudioContextを再開する
   * 
   * @returns 再開完了のPromise
   */
  async resume(): Promise<void> {
    if (!this.context) {
      throw new Error('AudioEngineが初期化されていません。');
    }

    try {
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
    } catch (error) {
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
    return this.context;
  }

  /**
   * AudioEngineが使用可能な状態かチェックする
   * 
   * @returns 使用可能な場合はtrue
   */
  isReady(): boolean {
    return this.isInitialized && this.context !== null && this.context.state === 'running';
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
    if (!this.context) {
      return 'uninitialized';
    }
    return this.context.state;
  }

  /**
   * AudioContextが中断された場合の自動復旧を試行する
   * ページの可視性変更やブラウザの省電力モードからの復帰時に使用
   * 
   * @returns 復旧完了のPromise
   */
  async attemptRecovery(): Promise<void> {
    if (!this.context) {
      console.warn('[AudioEngine] 復旧試行: コンテキストが存在しません');
      return;
    }

    try {
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
        await this.context.resume();
      }
    } catch (error) {
      throw new Error('オーディオコンテキストの復旧に失敗しました。ページを再読み込みしてください。');
    }
  }
}

// デフォルトのAudioEngineインスタンスをエクスポート
export const defaultAudioEngine = new AudioEngine();
