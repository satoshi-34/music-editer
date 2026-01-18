import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TempoManager, type TempoSettings, type TempoChangeCallback } from './TempoManager';

describe('TempoManager', () => {
  let tempoManager: TempoManager;

  beforeEach(() => {
    // localStorageをクリア
    localStorage.clear();
    // 新しいインスタンスを作成
    tempoManager = new TempoManager();
  });

  describe('初期化', () => {
    it('デフォルト値で初期化される', () => {
      expect(tempoManager.getBPM()).toBe(120);
      expect(tempoManager.getTimeSignature()).toEqual([4, 4]);
    });

    it('getSettings()でデフォルト設定を取得できる', () => {
      const settings = tempoManager.getSettings();
      expect(settings).toEqual({
        bpm: 120,
        timeSignature: [4, 4]
      });
    });
  });

  describe('BPM設定', () => {
    it('有効範囲内のBPMを設定できる', () => {
      tempoManager.setBPM(100);
      expect(tempoManager.getBPM()).toBe(100);
    });

    it('最小BPM（60）を設定できる', () => {
      tempoManager.setBPM(60);
      expect(tempoManager.getBPM()).toBe(60);
    });

    it('最大BPM（200）を設定できる', () => {
      tempoManager.setBPM(200);
      expect(tempoManager.getBPM()).toBe(200);
    });

    it('範囲外のBPM（59）でエラーが発生する', () => {
      expect(() => tempoManager.setBPM(59)).toThrow('BPMは60-200の範囲で設定してください。入力値: 59');
      expect(tempoManager.getBPM()).toBe(120); // デフォルト値が保持される
    });

    it('範囲外のBPM（201）でエラーが発生する', () => {
      expect(() => tempoManager.setBPM(201)).toThrow('BPMは60-200の範囲で設定してください。入力値: 201');
      expect(tempoManager.getBPM()).toBe(120); // デフォルト値が保持される
    });

    it('無効な値（NaN）でエラーが発生する', () => {
      expect(() => tempoManager.setBPM(NaN)).toThrow('BPMは60-200の範囲で設定してください。入力値: NaN');
    });

    it('無効な値（Infinity）でエラーが発生する', () => {
      expect(() => tempoManager.setBPM(Infinity)).toThrow('BPMは60-200の範囲で設定してください。入力値: Infinity');
    });
  });

  describe('拍子設定', () => {
    it('有効な拍子（4/4）を設定できる', () => {
      tempoManager.setTimeSignature(4, 4);
      expect(tempoManager.getTimeSignature()).toEqual([4, 4]);
    });

    it('有効な拍子（3/4）を設定できる', () => {
      tempoManager.setTimeSignature(3, 4);
      expect(tempoManager.getTimeSignature()).toEqual([3, 4]);
    });

    it('有効な拍子（6/8）を設定できる', () => {
      tempoManager.setTimeSignature(6, 8);
      expect(tempoManager.getTimeSignature()).toEqual([6, 8]);
    });

    it('有効な拍子（2/2）を設定できる', () => {
      tempoManager.setTimeSignature(2, 2);
      expect(tempoManager.getTimeSignature()).toEqual([2, 2]);
    });

    it('無効な分子（0）でエラーが発生する', () => {
      expect(() => tempoManager.setTimeSignature(0, 4)).toThrow('無効な拍子です。分子: 0, 分母: 4');
      expect(tempoManager.getTimeSignature()).toEqual([4, 4]); // デフォルト値が保持される
    });

    it('無効な分子（負数）でエラーが発生する', () => {
      expect(() => tempoManager.setTimeSignature(-1, 4)).toThrow('無効な拍子です。分子: -1, 分母: 4');
    });

    it('無効な分母（3）でエラーが発生する', () => {
      expect(() => tempoManager.setTimeSignature(4, 3)).toThrow('無効な拍子です。分子: 4, 分母: 3');
    });

    it('無効な分母（32）でエラーが発生する', () => {
      expect(() => tempoManager.setTimeSignature(4, 32)).toThrow('無効な拍子です。分子: 4, 分母: 32');
    });

    it('小数の分子でエラーが発生する', () => {
      expect(() => tempoManager.setTimeSignature(4.5, 4)).toThrow('無効な拍子です。分子: 4.5, 分母: 4');
    });
  });

  describe('設定変更通知', () => {
    it('BPM変更時にリスナーが呼び出される', () => {
      const mockCallback = vi.fn();
      tempoManager.onChange(mockCallback);

      tempoManager.setBPM(140);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith({
        bpm: 140,
        timeSignature: [4, 4]
      });
    });

    it('拍子変更時にリスナーが呼び出される', () => {
      const mockCallback = vi.fn();
      tempoManager.onChange(mockCallback);

      tempoManager.setTimeSignature(3, 4);

      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith({
        bpm: 120,
        timeSignature: [3, 4]
      });
    });

    it('同じ値を設定した場合はリスナーが呼び出されない', () => {
      const mockCallback = vi.fn();
      tempoManager.onChange(mockCallback);

      // 同じBPMを設定
      tempoManager.setBPM(120);
      expect(mockCallback).not.toHaveBeenCalled();

      // 同じ拍子を設定
      tempoManager.setTimeSignature(4, 4);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('複数のリスナーが登録できる', () => {
      const mockCallback1 = vi.fn();
      const mockCallback2 = vi.fn();
      
      tempoManager.onChange(mockCallback1);
      tempoManager.onChange(mockCallback2);

      tempoManager.setBPM(100);

      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(1);
    });

    it('リスナーを削除できる', () => {
      const mockCallback = vi.fn();
      tempoManager.onChange(mockCallback);
      tempoManager.removeListener(mockCallback);

      tempoManager.setBPM(100);

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('すべてのリスナーを削除できる', () => {
      const mockCallback1 = vi.fn();
      const mockCallback2 = vi.fn();
      
      tempoManager.onChange(mockCallback1);
      tempoManager.onChange(mockCallback2);
      tempoManager.removeAllListeners();

      tempoManager.setBPM(100);

      expect(mockCallback1).not.toHaveBeenCalled();
      expect(mockCallback2).not.toHaveBeenCalled();
    });

    it('リスナーでエラーが発生しても他のリスナーは実行される', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('テストエラー');
      });
      const normalCallback = vi.fn();
      
      // コンソールエラーをモック
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      tempoManager.onChange(errorCallback);
      tempoManager.onChange(normalCallback);

      tempoManager.setBPM(100);

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(normalCallback).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        'テンポ設定変更の通知中にエラーが発生しました:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('設定取得', () => {
    it('getSettings()は設定のコピーを返す', () => {
      const settings1 = tempoManager.getSettings();
      const settings2 = tempoManager.getSettings();

      expect(settings1).toEqual(settings2);
      expect(settings1).not.toBe(settings2); // 異なるオブジェクト
      expect(settings1.timeSignature).not.toBe(settings2.timeSignature); // 異なる配列
    });

    it('getTimeSignature()は拍子のコピーを返す', () => {
      const timeSignature1 = tempoManager.getTimeSignature();
      const timeSignature2 = tempoManager.getTimeSignature();

      expect(timeSignature1).toEqual(timeSignature2);
      expect(timeSignature1).not.toBe(timeSignature2); // 異なる配列
    });
  });

  describe('静的メソッド', () => {
    it('getBPMRange()でBPMの有効範囲を取得できる', () => {
      const [min, max] = TempoManager.getBPMRange();
      expect(min).toBe(60);
      expect(max).toBe(200);
    });
  });

  describe('設定の永続化', () => {
    it('BPM変更時に設定が保存される', () => {
      tempoManager.setBPM(140);
      
      // 新しいインスタンスを作成して設定が復元されることを確認
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getBPM()).toBe(140);
    });

    it('拍子変更時に設定が保存される', () => {
      tempoManager.setTimeSignature(3, 4);
      
      // 新しいインスタンスを作成して設定が復元されることを確認
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getTimeSignature()).toEqual([3, 4]);
    });

    it('複数の設定変更が正しく保存・復元される', () => {
      tempoManager.setBPM(180);
      tempoManager.setTimeSignature(6, 8);
      
      // 新しいインスタンスを作成して設定が復元されることを確認
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getBPM()).toBe(180);
      expect(newTempoManager.getTimeSignature()).toEqual([6, 8]);
    });

    it('保存された設定がない場合はデフォルト値を使用する', () => {
      // localStorageが空の状態で新しいインスタンスを作成
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getBPM()).toBe(120);
      expect(newTempoManager.getTimeSignature()).toEqual([4, 4]);
    });

    it('無効な保存データがある場合はデフォルト値を使用する', () => {
      // 無効なデータを保存
      localStorage.setItem('music-app-tempo-settings', '{"invalid": "data"}');
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getBPM()).toBe(120);
      expect(newTempoManager.getTimeSignature()).toEqual([4, 4]);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'テンポ設定のバージョンが異なります。デフォルト設定を使用します。'
      );
      
      consoleSpy.mockRestore();
    });

    it('破損したJSONデータがある場合はデフォルト値を使用する', () => {
      // 破損したJSONデータを保存
      localStorage.setItem('music-app-tempo-settings', '{invalid json}');
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getBPM()).toBe(120);
      expect(newTempoManager.getTimeSignature()).toEqual([4, 4]);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'テンポ設定の読み込みに失敗しました:',
        expect.any(SyntaxError)
      );
      
      consoleSpy.mockRestore();
    });

    it('clearSavedSettings()で保存された設定をクリアできる', () => {
      tempoManager.setBPM(150);
      tempoManager.clearSavedSettings();
      
      // 新しいインスタンスを作成してデフォルト値が使用されることを確認
      const newTempoManager = new TempoManager();
      expect(newTempoManager.getBPM()).toBe(120);
    });

    it('resetToDefaults()で設定をデフォルト値にリセットできる', () => {
      const mockCallback = vi.fn();
      tempoManager.onChange(mockCallback);
      
      tempoManager.setBPM(180);
      tempoManager.setTimeSignature(3, 4);
      mockCallback.mockClear(); // 前の呼び出しをクリア
      
      tempoManager.resetToDefaults();
      
      expect(tempoManager.getBPM()).toBe(120);
      expect(tempoManager.getTimeSignature()).toEqual([4, 4]);
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith({
        bpm: 120,
        timeSignature: [4, 4]
      });
    });

    it('resetToDefaults()で既にデフォルト値の場合はリスナーが呼び出されない', () => {
      const mockCallback = vi.fn();
      tempoManager.onChange(mockCallback);
      
      // 既にデフォルト値の状態でリセット
      tempoManager.resetToDefaults();
      
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('localStorage保存エラー時にコンソールエラーが出力される', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // localStorageのsetItemをモックしてエラーを発生させる
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => {
        throw new Error('Storage error');
      });
      
      tempoManager.setBPM(150);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'テンポ設定の保存に失敗しました:',
        expect.any(Error)
      );
      
      // 復元
      Storage.prototype.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });
  });
});