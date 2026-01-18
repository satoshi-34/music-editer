// src/audio/AudioError.ts
// 音声関連のエラー処理とフォールバック戦略

/**
 * 音声エラーの種類
 */
export type AudioErrorType = 
  | 'initialization'  // 初期化エラー
  | 'playback'       // 再生エラー
  | 'loading'        // 読み込みエラー
  | 'permission';    // 権限エラー

/**
 * 音声エラー情報
 */
export interface AudioError {
  /** エラーの種類 */
  type: AudioErrorType;
  /** エラーメッセージ */
  message: string;
  /** 復旧可能かどうか */
  recoverable: boolean;
  /** 元のエラーオブジェクト（デバッグ用） */
  originalError?: Error;
}

/**
 * エラー復旧戦略
 */
export interface AudioErrorRecovery {
  /** 実行するアクション */
  action: 'retry' | 'fallback' | 'prompt' | 'log';
  /** フォールバック方法 */
  fallback: string;
  /** ユーザーに表示するメッセージ */
  message: string;
}

/**
 * 音声エラーハンドラークラス
 * エラーの分類と適切な復旧戦略を提供する
 */
export class AudioErrorHandler {
  /**
   * エラーを処理し、適切な復旧戦略を返す
   * 
   * @param error 処理対象のエラー
   * @returns 復旧戦略
   */
  static handle(error: AudioError): AudioErrorRecovery {
    console.error(`[AudioErrorHandler] ${error.type}エラーが発生:`, error.message);
    
    switch (error.type) {
      case 'initialization':
        return {
          action: 'retry',
          fallback: 'showUserPrompt',
          message: 'オーディオの初期化に失敗しました。ページを再読み込みしてください。'
        };
      
      case 'playback':
        return {
          action: 'fallback',
          fallback: 'useDefaultInstrument',
          message: '音色の読み込みに失敗しました。デフォルト音色を使用します。'
        };
      
      case 'loading':
        return {
          action: 'fallback',
          fallback: 'useCache',
          message: '音声データの読み込みに失敗しました。キャッシュされたデータを使用します。'
        };
      
      case 'permission':
        return {
          action: 'prompt',
          fallback: 'disableAudio',
          message: 'オーディオの再生にはユーザー操作が必要です。画面をクリックしてください。'
        };
      
      default:
        return {
          action: 'log',
          fallback: 'continue',
          message: '予期しないエラーが発生しました。'
        };
    }
  }

  /**
   * JavaScriptのErrorオブジェクトからAudioErrorを作成する
   * 
   * @param originalError 元のエラーオブジェクト
   * @param context エラーが発生したコンテキスト
   * @returns AudioErrorオブジェクト
   */
  static fromError(originalError: Error, context: string = ''): AudioError {
    let type: AudioErrorType = 'initialization';
    let recoverable = true;

    // エラーの種類を判定
    if (originalError.name === 'NotAllowedError') {
      type = 'permission';
      recoverable = true;
    } else if (originalError.name === 'NotSupportedError') {
      type = 'initialization';
      recoverable = false;
    } else if (originalError.message.toLowerCase().includes('network') || 
               originalError.message.toLowerCase().includes('fetch')) {
      type = 'loading';
      recoverable = true;
    } else if (originalError.message.toLowerCase().includes('playback') || 
               originalError.message.toLowerCase().includes('audio')) {
      type = 'playback';
      recoverable = true;
    }

    const message = context 
      ? `${context}: ${originalError.message}`
      : originalError.message;

    return {
      type,
      message,
      recoverable,
      originalError
    };
  }

  /**
   * エラーをユーザーフレンドリーなメッセージに変換する
   * 
   * @param error AudioErrorオブジェクト
   * @returns ユーザー向けメッセージ
   */
  static getUserMessage(error: AudioError): string {
    const recovery = this.handle(error);
    return recovery.message;
  }

  /**
   * エラーがクリティカル（アプリケーション継続不可）かどうかを判定する
   * 
   * @param error AudioErrorオブジェクト
   * @returns クリティカルエラーの場合はtrue
   */
  static isCritical(error: AudioError): boolean {
    return !error.recoverable || error.type === 'initialization';
  }

  /**
   * エラーログを構造化された形式で出力する
   * 
   * @param error AudioErrorオブジェクト
   * @param additionalInfo 追加情報
   */
  static logError(error: AudioError, additionalInfo?: Record<string, any>): void {
    const logData = {
      timestamp: new Date().toISOString(),
      type: error.type,
      message: error.message,
      recoverable: error.recoverable,
      critical: this.isCritical(error),
      ...additionalInfo
    };

    if (this.isCritical(error)) {
      console.error('[AudioErrorHandler] クリティカルエラー:', logData);
    } else {
      console.warn('[AudioErrorHandler] 復旧可能エラー:', logData);
    }

    // 本番環境では外部ログサービスに送信することも可能
    // if (process.env.NODE_ENV === 'production') {
    //   // 外部ログサービスに送信
    // }
  }
}

/**
 * よく使用されるエラーファクトリー関数
 */
export class AudioErrorFactory {
  /**
   * 初期化エラーを作成
   */
  static createInitializationError(message: string, originalError?: Error): AudioError {
    return {
      type: 'initialization',
      message,
      recoverable: false,
      originalError
    };
  }

  /**
   * 権限エラーを作成
   */
  static createPermissionError(message: string = 'オーディオの使用が許可されていません'): AudioError {
    return {
      type: 'permission',
      message,
      recoverable: true
    };
  }

  /**
   * 再生エラーを作成
   */
  static createPlaybackError(message: string, originalError?: Error): AudioError {
    return {
      type: 'playback',
      message,
      recoverable: true,
      originalError
    };
  }

  /**
   * 読み込みエラーを作成
   */
  static createLoadingError(message: string, originalError?: Error): AudioError {
    return {
      type: 'loading',
      message,
      recoverable: true,
      originalError
    };
  }
}