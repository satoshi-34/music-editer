/**
 * テンポ設定と管理を行うクラス
 * BPM設定、拍子設定、設定変更の通知機能を提供
 */

/**
 * テンポ設定のインターフェース
 */
export interface TempoSettings {
  /** BPM（Beats Per Minute）値 */
  bpm: number;
  /** 拍子 [分子, 分母] */
  timeSignature: [number, number];
}

/**
 * 永続化されたテンポ設定のインターフェース
 */
export interface PersistedTempoSettings extends TempoSettings {
  /** 設定のバージョン */
  version: string;
  /** 最終更新タイムスタンプ */
  lastUpdated: number;
}

/**
 * テンポ設定変更のコールバック関数型
 */
export type TempoChangeCallback = (settings: TempoSettings) => void;

/**
 * テンポ管理クラス
 * BPM設定と検証、拍子設定、設定変更の通知機能を提供
 */
export class TempoManager {
  /** 現在のテンポ設定 */
  private settings: TempoSettings = { 
    bpm: 120, 
    timeSignature: [4, 4] 
  };

  /** 設定変更リスナーのセット */
  private listeners: Set<TempoChangeCallback> = new Set();

  /** BPMの有効範囲 */
  private static readonly MIN_BPM = 60;
  private static readonly MAX_BPM = 200;

  /** ストレージキー */
  private static readonly STORAGE_KEY = 'music-app-tempo-settings';
  
  /** 設定のバージョン */
  private static readonly SETTINGS_VERSION = '1.0.0';

  /**
   * コンストラクタ
   * 保存された設定があれば自動的に復元する
   */
  constructor() {
    this.loadSettings();
  }

  /**
   * BPMを設定する
   * @param bpm 設定するBPM値（60-200の範囲）
   * @throws Error BPMが有効範囲外の場合
   */
  setBPM(bpm: number): void {
    // BPMの範囲検証
    if (!this.isValidBPM(bpm)) {
      throw new Error(`BPMは${TempoManager.MIN_BPM}-${TempoManager.MAX_BPM}の範囲で設定してください。入力値: ${bpm}`);
    }

    // 値が変更された場合のみ更新と通知
    if (this.settings.bpm !== bpm) {
      this.settings.bpm = bpm;
      this.saveSettings();
      this.notifyListeners();
    }
  }

  /**
   * 現在のBPMを取得する
   * @returns 現在のBPM値
   */
  getBPM(): number {
    return this.settings.bpm;
  }

  /**
   * 拍子を設定する
   * @param numerator 拍子の分子（1以上）
   * @param denominator 拍子の分母（1, 2, 4, 8, 16のいずれか）
   * @throws Error 拍子が無効な場合
   */
  setTimeSignature(numerator: number, denominator: number): void {
    // 拍子の検証
    if (!this.isValidTimeSignature(numerator, denominator)) {
      throw new Error(`無効な拍子です。分子: ${numerator}, 分母: ${denominator}`);
    }

    const newTimeSignature: [number, number] = [numerator, denominator];
    
    // 値が変更された場合のみ更新と通知
    if (this.settings.timeSignature[0] !== numerator || 
        this.settings.timeSignature[1] !== denominator) {
      this.settings.timeSignature = newTimeSignature;
      this.saveSettings();
      this.notifyListeners();
    }
  }

  /**
   * 現在の拍子を取得する
   * @returns 現在の拍子 [分子, 分母]
   */
  getTimeSignature(): [number, number] {
    return [...this.settings.timeSignature];
  }

  /**
   * 現在のテンポ設定を取得する
   * @returns 現在のテンポ設定のコピー
   */
  getSettings(): TempoSettings {
    return {
      bpm: this.settings.bpm,
      timeSignature: [...this.settings.timeSignature]
    };
  }

  /**
   * テンポ設定変更のリスナーを追加する
   * @param callback 設定変更時に呼び出されるコールバック関数
   */
  onChange(callback: TempoChangeCallback): void {
    this.listeners.add(callback);
  }

  /**
   * テンポ設定変更のリスナーを削除する
   * @param callback 削除するコールバック関数
   */
  removeListener(callback: TempoChangeCallback): void {
    this.listeners.delete(callback);
  }

  /**
   * すべてのリスナーを削除する
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * BPMが有効範囲内かどうかを検証する
   * @param bpm 検証するBPM値
   * @returns 有効な場合はtrue
   * @private
   */
  private isValidBPM(bpm: number): boolean {
    return Number.isFinite(bpm) && 
           bpm >= TempoManager.MIN_BPM && 
           bpm <= TempoManager.MAX_BPM;
  }

  /**
   * 拍子が有効かどうかを検証する
   * @param numerator 拍子の分子
   * @param denominator 拍子の分母
   * @returns 有効な場合はtrue
   * @private
   */
  private isValidTimeSignature(numerator: number, denominator: number): boolean {
    // 分子は1以上の整数
    if (!Number.isInteger(numerator) || numerator < 1) {
      return false;
    }

    // 分母は2の累乗（1, 2, 4, 8, 16）
    const validDenominators = [1, 2, 4, 8, 16];
    return validDenominators.includes(denominator);
  }

  /**
   * 登録されたリスナーに設定変更を通知する
   * @private
   */
  private notifyListeners(): void {
    const currentSettings = this.getSettings();
    this.listeners.forEach(callback => {
      try {
        callback(currentSettings);
      } catch (error) {
        console.error('テンポ設定変更の通知中にエラーが発生しました:', error);
      }
    });
  }

  /**
   * BPMの有効範囲を取得する
   * @returns [最小BPM, 最大BPM]
   */
  static getBPMRange(): [number, number] {
    return [TempoManager.MIN_BPM, TempoManager.MAX_BPM];
  }

  /**
   * 設定をlocalStorageに保存する
   * @private
   */
  private saveSettings(): void {
    try {
      const persistedSettings: PersistedTempoSettings = {
        ...this.settings,
        version: TempoManager.SETTINGS_VERSION,
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(
        TempoManager.STORAGE_KEY, 
        JSON.stringify(persistedSettings)
      );
    } catch (error) {
      console.error('テンポ設定の保存に失敗しました:', error);
    }
  }

  /**
   * localStorageから設定を読み込む
   * @private
   */
  private loadSettings(): void {
    try {
      const stored = localStorage.getItem(TempoManager.STORAGE_KEY);
      if (!stored) {
        return; // デフォルト設定を使用
      }

      const persistedSettings: PersistedTempoSettings = JSON.parse(stored);
      
      // バージョンチェック
      if (persistedSettings.version !== TempoManager.SETTINGS_VERSION) {
        console.warn('テンポ設定のバージョンが異なります。デフォルト設定を使用します。');
        return;
      }

      // 設定の検証と復元
      if (this.isValidPersistedSettings(persistedSettings)) {
        this.settings = {
          bpm: persistedSettings.bpm,
          timeSignature: [...persistedSettings.timeSignature]
        };
      } else {
        console.warn('保存されたテンポ設定が無効です。デフォルト設定を使用します。');
      }
    } catch (error) {
      console.error('テンポ設定の読み込みに失敗しました:', error);
      // エラーが発生した場合はデフォルト設定を使用
    }
  }

  /**
   * 永続化された設定が有効かどうかを検証する
   * @param settings 検証する設定
   * @returns 有効な場合はtrue
   * @private
   */
  private isValidPersistedSettings(settings: any): settings is PersistedTempoSettings {
    return (
      settings &&
      typeof settings === 'object' &&
      typeof settings.version === 'string' &&
      typeof settings.lastUpdated === 'number' &&
      this.isValidBPM(settings.bpm) &&
      Array.isArray(settings.timeSignature) &&
      settings.timeSignature.length === 2 &&
      this.isValidTimeSignature(settings.timeSignature[0], settings.timeSignature[1])
    );
  }

  /**
   * 保存された設定をクリアする
   */
  clearSavedSettings(): void {
    try {
      localStorage.removeItem(TempoManager.STORAGE_KEY);
    } catch (error) {
      console.error('テンポ設定のクリアに失敗しました:', error);
    }
  }

  /**
   * 設定をデフォルト値にリセットする
   */
  resetToDefaults(): void {
    const defaultSettings: TempoSettings = {
      bpm: 120,
      timeSignature: [4, 4]
    };

    // 値が変更された場合のみ更新
    const bpmChanged = this.settings.bpm !== defaultSettings.bpm;
    const timeSignatureChanged = 
      this.settings.timeSignature[0] !== defaultSettings.timeSignature[0] ||
      this.settings.timeSignature[1] !== defaultSettings.timeSignature[1];

    if (bpmChanged || timeSignatureChanged) {
      this.settings = {
        bpm: defaultSettings.bpm,
        timeSignature: [...defaultSettings.timeSignature]
      };
      this.saveSettings();
      this.notifyListeners();
    }
  }
}