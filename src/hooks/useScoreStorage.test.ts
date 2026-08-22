// src/hooks/useScoreStorage.test.ts
// 旧・手動保存スロットの読み取り（移行用）フックのテスト。
// #109 第4段で保存系 API は撤去され、残る責務は loadScore / hasStoredData だけ。
// スロットへの書き込み（seed）は storage 層の saveScoreData を直接使う
// （保存の仕様そのものは utils/storage.test.ts が固定している）。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScoreStorage } from './useScoreStorage';
import { createSavedScoreData, saveScoreData, STORAGE_KEYS } from '../utils/storage';
import type { ScoreMetadata, PartData } from '../types/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const metadata: ScoreMetadata = { title: '移行テスト', subtitle: '', lyricist: '', composer: '', arranger: '' };
const parts: PartData[] = [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }];

describe('useScoreStorage（旧・手動保存スロットの移行用読み取り）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('初期状態: エラーなし・読み取り中でなく、移行用の2関数だけを公開する', () => {
    const { result } = renderHook(() => useScoreStorage());
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.loadScore).toBe('function');
    expect(typeof result.current.hasStoredData).toBe('function');
    // 廃止した保存系 API は公開しない（#109 第4段）
    expect('saveScore' in result.current).toBe(false);
    expect('isSaving' in result.current).toBe(false);
    expect('clearStoredData' in result.current).toBe(false);
    expect('loadAutosave' in result.current).toBe(false);
  });

  it('hasStoredData: 旧スロットにデータがあるときだけ true', () => {
    const { result } = renderHook(() => useScoreStorage());
    expect(result.current.hasStoredData()).toBe(false);
    expect(saveScoreData(createSavedScoreData(metadata, parts, 1, 4)).success).toBe(true);
    expect(result.current.hasStoredData()).toBe(true);
  });

  it('loadScore: 旧スロットのデータを読み戻せる（保存往復）', async () => {
    expect(saveScoreData(createSavedScoreData(metadata, parts, 2, 3)).success).toBe(true);
    const { result } = renderHook(() => useScoreStorage());
    let loaded: Awaited<ReturnType<typeof result.current.loadScore>> = null;
    await act(async () => {
      loaded = await result.current.loadScore();
    });
    expect(loaded?.metadata.title).toBe('移行テスト');
    expect(loaded?.systems).toBe(2);
    expect(loaded?.measuresPerSystem).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it('loadScore: データが無ければ null（エラーにはしない）', async () => {
    const { result } = renderHook(() => useScoreStorage());
    let loaded: unknown = 'sentinel';
    await act(async () => {
      loaded = await result.current.loadScore();
    });
    expect(loaded).toBeNull();
  });

  it('loadScore: 壊れたデータ（primary/backupとも不正）はエラーを表示して null', async () => {
    localStorageMock.setItem(STORAGE_KEYS.SCORE_DATA ?? 'music-score-app-data', '{broken');
    const { result } = renderHook(() => useScoreStorage());
    let loaded: unknown = 'sentinel';
    await act(async () => {
      loaded = await result.current.loadScore();
    });
    expect(loaded).toBeNull();
  });
});
