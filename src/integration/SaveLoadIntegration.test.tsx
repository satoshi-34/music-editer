// src/integration/SaveLoadIntegration.test.tsx
// 統合テスト: 完全な保存・読込ワークフローの検証
// Feature: score-save-load, Task 11: 統合テストと最終検証

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { saveScoreData, loadScoreData, clearStoredData, STORAGE_KEYS } from '../utils/storage';
import type { SavedScoreData, ScoreMetadata, MeasureData, DurKey } from '../types/storage';

// localStorage のモック
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('統合テスト: 保存・読込ワークフロー', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('完全な保存・読込ワークフロー', () => {
    it('完全な譜面データを保存して読み込むことができる', async () => {
      // テストデータの準備
      const metadata: ScoreMetadata = {
        title: '春の歌',
        subtitle: '第1楽章',
        lyricist: '山田太郎',
        composer: '田中花子',
        arranger: '佐藤次郎'
      };

      const measures: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, key: 'c/4' },
            { dur: '4', isRest: false, key: 'd/4' },
            { dur: '4', isRest: false, key: 'e/4' },
            { dur: '4', isRest: false, key: 'f/4' }
          ]
        },
        {
          events: [
            { dur: '2', isRest: false, key: 'g/4' },
            { dur: '2', isRest: true, key: 'b/4' }
          ]
        },
        {
          events: [
            { dur: '8', isRest: false, key: 'a/4' },
            { dur: '8', isRest: false, key: 'b/4' },
            { dur: '8', isRest: false, key: 'c/5' },
            { dur: '8', isRest: false, key: 'd/5' }
          ]
        }
      ];

      const systems = 3;
      const measuresPerSystem = 4;

      // useScoreStorage フックを使用して保存
      const { result } = renderHook(() => useScoreStorage());

      // 保存操作
      let saveSuccess = false;
      await act(async () => {
        saveSuccess = await result.current.saveScore(metadata, measures, systems, measuresPerSystem);
      });

      expect(saveSuccess).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.hasStoredData()).toBe(true);

      // 読込操作
      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });

      expect(loadedData).not.toBeNull();
      expect(result.current.error).toBeNull();

      // データの検証
      if (loadedData) {
        // メタデータの検証
        expect(loadedData.metadata.title).toBe(metadata.title);
        expect(loadedData.metadata.subtitle).toBe(metadata.subtitle);
        expect(loadedData.metadata.lyricist).toBe(metadata.lyricist);
        expect(loadedData.metadata.composer).toBe(metadata.composer);
        expect(loadedData.metadata.arranger).toBe(metadata.arranger);

        // システム設定の検証
        expect(loadedData.systems).toBe(systems);
        expect(loadedData.measuresPerSystem).toBe(measuresPerSystem);

        // 小節データの検証
        expect(loadedData.measures).toHaveLength(measures.length);
        
        for (let i = 0; i < measures.length; i++) {
          expect(loadedData.measures[i].events).toHaveLength(measures[i].events.length);
          
          for (let j = 0; j < measures[i].events.length; j++) {
            expect(loadedData.measures[i].events[j]).toEqual(measures[i].events[j]);
          }
        }

        // バージョンとタイムスタンプの検証
        expect(loadedData.version).toBe('1.0.0');
        expect(loadedData.timestamp).toBeGreaterThan(0);
      }
    });

    it('複数回の保存・読込サイクルが正常に動作する', async () => {
      const { result } = renderHook(() => useScoreStorage());

      // 1回目の保存
      const metadata1: ScoreMetadata = {
        title: '曲1',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const measures1: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
      ];

      await act(async () => {
        await result.current.saveScore(metadata1, measures1, 1, 1);
      });

      let loaded1: SavedScoreData | null = null;
      await act(async () => {
        loaded1 = await result.current.loadScore();
      });

      expect(loaded1?.metadata.title).toBe('曲1');

      // 2回目の保存（上書き）
      const metadata2: ScoreMetadata = {
        title: '曲2',
        subtitle: '改訂版',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const measures2: MeasureData[] = [
        { events: [{ dur: '2', isRest: false, key: 'd/4' }] },
        { events: [{ dur: '2', isRest: true, key: 'e/4' }] }
      ];

      await act(async () => {
        await result.current.saveScore(metadata2, measures2, 2, 2);
      });

      let loaded2: SavedScoreData | null = null;
      await act(async () => {
        loaded2 = await result.current.loadScore();
      });

      // 最新のデータが読み込まれることを確認
      expect(loaded2?.metadata.title).toBe('曲2');
      expect(loaded2?.metadata.subtitle).toBe('改訂版');
      expect(loaded2?.measures).toHaveLength(2);
      expect(loaded2?.systems).toBe(2);
    });

    it('データをクリアした後は読込できない', async () => {
      const { result } = renderHook(() => useScoreStorage());

      // データを保存
      const metadata: ScoreMetadata = {
        title: 'テスト',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const measures: MeasureData[] = [
        { events: [] }
      ];

      await act(async () => {
        await result.current.saveScore(metadata, measures, 1, 1);
      });

      expect(result.current.hasStoredData()).toBe(true);

      // データをクリア
      await act(async () => {
        result.current.clearStoredData();
      });

      expect(result.current.hasStoredData()).toBe(false);

      // 読込を試みる
      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });

      expect(loadedData).toBeNull();
    });
  });

  describe('エラーシナリオの統合テスト', () => {
    it('localStorage容量超過エラーを適切に処理する', async () => {
      // 元のsetItemを保存
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      
      // setItemをモックして容量超過エラーをシミュレート
      let callCount = 0;
      localStorageMock.setItem = (key: string, value: string) => {
        callCount++;
        // 最初の呼び出し（可用性チェック）は成功させる
        if (key === '__storage_test__') {
          originalSetItem(key, value);
          return;
        }
        // 実際の保存時にエラーを投げる
        const error = new DOMException('QuotaExceededError', 'QuotaExceededError');
        throw error;
      };

      const { result } = renderHook(() => useScoreStorage());

      const metadata: ScoreMetadata = {
        title: '大きなデータ',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const measures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
      ];

      let saveSuccess = false;
      await act(async () => {
        saveSuccess = await result.current.saveScore(metadata, measures, 1, 1);
      });

      // 保存は失敗するはず
      expect(saveSuccess).toBe(false);
      // エラーメッセージが設定されているはず
      expect(result.current.error).not.toBeNull();
      expect(result.current.error).toContain('quota');

      // 元のsetItemを復元
      localStorageMock.setItem = originalSetItem;
    });

    it('破損したデータを読み込もうとした場合にエラーを処理する', async () => {
      // 破損したJSONデータをlocalStorageに直接設定
      localStorageMock.setItem(STORAGE_KEYS.PRIMARY, '{ invalid json }');

      const { result } = renderHook(() => useScoreStorage());

      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });

      // 読込は失敗し、nullが返されるはず
      expect(loadedData).toBeNull();
      // エラーメッセージが設定されているはず
      expect(result.current.error).not.toBeNull();
    });

    it('無効なデータ構造を読み込もうとした場合にエラーを処理する', async () => {
      // 無効な構造のデータをlocalStorageに設定
      const invalidData = {
        version: '1.0.0',
        timestamp: Date.now(),
        // metadataが欠けている
        measures: [],
        systems: 1,
        measuresPerSystem: 1
      };
      localStorageMock.setItem(STORAGE_KEYS.PRIMARY, JSON.stringify(invalidData));

      const { result } = renderHook(() => useScoreStorage());

      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });

      // 読込は失敗するはず
      expect(loadedData).toBeNull();
      expect(result.current.error).not.toBeNull();
    });

    it('localStorage無効時にエラーを処理する', async () => {
      // 元のsetItemを保存
      const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
      
      // setItemをモックしてSecurityErrorをシミュレート
      localStorageMock.setItem = () => {
        const error = new DOMException('SecurityError', 'SecurityError');
        throw error;
      };

      const { result } = renderHook(() => useScoreStorage());

      const metadata: ScoreMetadata = {
        title: 'テスト',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const measures: MeasureData[] = [
        { events: [] }
      ];

      let saveSuccess = false;
      await act(async () => {
        saveSuccess = await result.current.saveScore(metadata, measures, 1, 1);
      });

      // 保存は失敗するはず
      expect(saveSuccess).toBe(false);
      expect(result.current.error).not.toBeNull();

      // 元のsetItemを復元
      localStorageMock.setItem = originalSetItem;
    });
  });

  describe('パフォーマンスと使いやすさの確認', () => {
    it('大量の小節データを保存・読込できる', async () => {
      const { result } = renderHook(() => useScoreStorage());

      // 大量の小節データを生成（24小節）
      const measures: MeasureData[] = Array.from({ length: 24 }, (_, i) => ({
        events: [
          { dur: '4' as DurKey, isRest: false, key: 'c/4' },
          { dur: '4' as DurKey, isRest: false, key: 'd/4' },
          { dur: '4' as DurKey, isRest: false, key: 'e/4' },
          { dur: '4' as DurKey, isRest: false, key: 'f/4' }
        ]
      }));

      const metadata: ScoreMetadata = {
        title: '大規模な楽曲',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };

      const startSave = performance.now();
      let saveSuccess = false;
      await act(async () => {
        saveSuccess = await result.current.saveScore(metadata, measures, 6, 4);
      });
      const endSave = performance.now();

      expect(saveSuccess).toBe(true);
      // 保存は1秒以内に完了するはず
      expect(endSave - startSave).toBeLessThan(1000);

      const startLoad = performance.now();
      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });
      const endLoad = performance.now();

      expect(loadedData).not.toBeNull();
      expect(loadedData?.measures).toHaveLength(24);
      // 読込は1秒以内に完了するはず
      expect(endLoad - startLoad).toBeLessThan(1000);
    });

    it('空の小節データを保存・読込できる', async () => {
      const { result } = renderHook(() => useScoreStorage());

      const metadata: ScoreMetadata = {
        title: '空の楽譜',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };

      // 空の小節データ
      const measures: MeasureData[] = [
        { events: [] },
        { events: [] },
        { events: [] }
      ];

      await act(async () => {
        await result.current.saveScore(metadata, measures, 1, 3);
      });

      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });

      expect(loadedData).not.toBeNull();
      expect(loadedData?.measures).toHaveLength(3);
      expect(loadedData?.measures[0].events).toHaveLength(0);
    });

    it('特殊文字を含むメタデータを保存・読込できる', async () => {
      const { result } = renderHook(() => useScoreStorage());

      const metadata: ScoreMetadata = {
        title: '春の歌 🌸',
        subtitle: '第1楽章 - "希望"',
        lyricist: '山田 太郎 & 田中 花子',
        composer: 'Müller, Johann',
        arranger: 'Dvořák'
      };

      const measures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
      ];

      await act(async () => {
        await result.current.saveScore(metadata, measures, 1, 1);
      });

      let loadedData: SavedScoreData | null = null;
      await act(async () => {
        loadedData = await result.current.loadScore();
      });

      expect(loadedData).not.toBeNull();
      expect(loadedData?.metadata.title).toBe('春の歌 🌸');
      expect(loadedData?.metadata.subtitle).toBe('第1楽章 - "希望"');
      expect(loadedData?.metadata.lyricist).toBe('山田 太郎 & 田中 花子');
      expect(loadedData?.metadata.composer).toBe('Müller, Johann');
      expect(loadedData?.metadata.arranger).toBe('Dvořák');
    });

    it('ローディング状態が正しく管理される', async () => {
      const { result } = renderHook(() => useScoreStorage());

      const metadata: ScoreMetadata = {
        title: 'テスト',
        subtitle: '',
        lyricist: '',
        composer: '',
        arranger: ''
      };
      const measures: MeasureData[] = [
        { events: [] }
      ];

      // 初期状態
      expect(result.current.isSaving).toBe(false);
      expect(result.current.isLoading).toBe(false);

      // 保存中の状態は非同期なので直接確認できないが、
      // 保存完了後はfalseに戻るはず
      await act(async () => {
        await result.current.saveScore(metadata, measures, 1, 1);
      });

      expect(result.current.isSaving).toBe(false);

      // 読込完了後もfalseに戻るはず
      await act(async () => {
        await result.current.loadScore();
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('ストレージユーティリティ関数の統合テスト', () => {
    it('saveScoreDataとloadScoreDataが連携して動作する', () => {
      const testData: SavedScoreData = {
        version: '1.0.0',
        timestamp: Date.now(),
        metadata: {
          title: 'ユーティリティテスト',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        measures: [
          { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
        ],
        systems: 1,
        measuresPerSystem: 1
      };

      // 保存
      const saveResult = saveScoreData(testData);
      expect(saveResult.success).toBe(true);

      // 読込
      const loadResult = loadScoreData();
      expect(loadResult.success).toBe(true);
      expect(loadResult.data).not.toBeNull();
      expect(loadResult.data?.metadata.title).toBe('ユーティリティテスト');
    });

    it('clearStoredDataが全てのストレージキーをクリアする', () => {
      const testData: SavedScoreData = {
        version: '1.0.0',
        timestamp: Date.now(),
        metadata: {
          title: 'クリアテスト',
          subtitle: '',
          lyricist: '',
          composer: '',
          arranger: ''
        },
        measures: [],
        systems: 1,
        measuresPerSystem: 1
      };

      // データを保存
      saveScoreData(testData);
      
      // プライマリキーにデータが存在することを確認
      expect(localStorageMock.getItem(STORAGE_KEYS.PRIMARY)).not.toBeNull();

      // クリア
      const clearResult = clearStoredData();
      expect(clearResult.success).toBe(true);

      // 全てのキーがクリアされたことを確認
      expect(localStorageMock.getItem(STORAGE_KEYS.PRIMARY)).toBeNull();
      expect(localStorageMock.getItem(STORAGE_KEYS.BACKUP)).toBeNull();
      expect(localStorageMock.getItem(STORAGE_KEYS.METADATA)).toBeNull();
    });
  });
});
