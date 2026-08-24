// src/hooks/useUiVariant.test.ts
// Issue #405（段1）: 画面側へ案を配るフックの振る舞いを固定する。

import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUiVariant } from './useUiVariant';
import { UI_VARIANT_STORAGE_KEY } from '../utils/uiVariant';

describe('useUiVariant', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('?ui=a1 を渡すとその案になり、localStorage に記憶される', () => {
    const { result } = renderHook(() => useUiVariant({ isDev: true, search: '?ui=a1' }));
    expect(result.current).toBe('a1');
    expect(localStorage.getItem(UI_VARIANT_STORAGE_KEY)).toBe('a1');
  });

  it('記憶したあとはパラメータ無しで開いても維持される（リロード相当）', () => {
    renderHook(() => useUiVariant({ isDev: true, search: '?ui=a2' }));
    // 2回目のマウント＝リロード後の起動に相当する
    const { result } = renderHook(() => useUiVariant({ isDev: true, search: '' }));
    expect(result.current).toBe('a2');
  });

  it('?ui=current で対照群へ戻せる（記憶も current になる）', () => {
    renderHook(() => useUiVariant({ isDev: true, search: '?ui=a1' }));
    const { result } = renderHook(() => useUiVariant({ isDev: true, search: '?ui=current' }));
    expect(result.current).toBe('current');
    expect(localStorage.getItem(UI_VARIANT_STORAGE_KEY)).toBe('current');
  });

  it('本番ビルド（isDev=false）では ?ui= も記憶も効かず current のまま', () => {
    localStorage.setItem(UI_VARIANT_STORAGE_KEY, 'a1');
    const { result } = renderHook(() => useUiVariant({ isDev: false, search: '?ui=a2' }));
    expect(result.current).toBe('current');
  });

  it('本番ビルドでは記憶を書き換えない（ユーザーの端末に余計な痕跡を残さない）', () => {
    renderHook(() => useUiVariant({ isDev: false, search: '?ui=a2' }));
    expect(localStorage.getItem(UI_VARIANT_STORAGE_KEY)).toBeNull();
  });

  it('不正値は current になる', () => {
    const { result } = renderHook(() => useUiVariant({ isDev: true, search: '?ui=zzz' }));
    expect(result.current).toBe('current');
  });
});
