// src/utils/yOffsetMigration.test.ts
// zoom → transform 移行時の Y補正リセット（issue #13 のフォローアップ）のテスト
import { describe, it, expect, beforeEach } from 'vitest';

import { readInitialYOffset, Y_OFFSET_KEY, Y_OFFSET_RESET_FLAG_KEY } from './yOffsetMigration';

describe('readInitialYOffset', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初回起動では zoom 時代の古い補正値を破棄して 0 を返す', () => {
    // zoom 時代に Safari のズレ対策で設定していた実績値
    localStorage.setItem(Y_OFFSET_KEY, '24');

    expect(readInitialYOffset()).toBe(0);
    // 古い値は消え、リセット済みフラグが立つ
    expect(localStorage.getItem(Y_OFFSET_KEY)).toBeNull();
    expect(localStorage.getItem(Y_OFFSET_RESET_FLAG_KEY)).toBe('1');
  });

  it('補正値が未設定でも初回起動でフラグを立てる', () => {
    expect(readInitialYOffset()).toBe(0);
    expect(localStorage.getItem(Y_OFFSET_RESET_FLAG_KEY)).toBe('1');
  });

  it('リセット済みなら、改めて設定された補正値をそのまま返す（二度と消さない）', () => {
    localStorage.setItem(Y_OFFSET_RESET_FLAG_KEY, '1');
    // transform ビルド上で利用者が改めて設定した値
    localStorage.setItem(Y_OFFSET_KEY, '5');

    expect(readInitialYOffset()).toBe(5);
    expect(localStorage.getItem(Y_OFFSET_KEY)).toBe('5');
  });

  it('リセット済みで補正値が不正な文字列なら 0 を返す', () => {
    localStorage.setItem(Y_OFFSET_RESET_FLAG_KEY, '1');
    localStorage.setItem(Y_OFFSET_KEY, 'abc');

    expect(readInitialYOffset()).toBe(0);
  });
});
