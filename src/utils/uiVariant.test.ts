// src/utils/uiVariant.test.ts
// Issue #405（段1）: UI案の切替ロジックを固定するテスト。
//
// ここで守りたいのは主に2つ:
// - 本番ビルドでは何を書かれても `current`（現状のUI）に固定されること
// - テスト会中にURLからパラメータが落ちても、選んだ案のまま触り続けられること

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_VARIANT,
  UI_VARIANT_LABELS,
  UI_VARIANT_STORAGE_KEY,
  isUiVariant,
  loadStoredUiVariant,
  readUiVariantParam,
  resolveUiVariant,
  saveStoredUiVariant,
} from './uiVariant';

describe('readUiVariantParam: URLから ?ui= を読む', () => {
  it.each([
    ['?ui=a1', 'a1'],
    ['?ui=a2', 'a2'],
    ['?ui=current', 'current'],
    // 先頭の "?" が無い形でも読める
    ['ui=a1', 'a1'],
    // 他のパラメータと並んでいても読める
    ['?debug=1&ui=a2', 'a2'],
  ])('%s から %s を読み取る', (search, expected) => {
    expect(readUiVariantParam(search)).toBe(expected);
  });

  it('パラメータが無ければ null（「指定なし」と「不正値」を呼び出し側で区別するため）', () => {
    expect(readUiVariantParam('')).toBeNull();
    expect(readUiVariantParam('?debug=1')).toBeNull();
  });

  it('不正値でもそのまま返す（判定は resolveUiVariant 側の仕事）', () => {
    expect(readUiVariantParam('?ui=zzz')).toBe('zzz');
  });
});

describe('isUiVariant: 未知の値を弾く', () => {
  it.each(['current', 'a1', 'a2', 'a3'])('%s は有効', (value) => {
    expect(isUiVariant(value)).toBe(true);
  });

  it.each(['', 'A1', 'a4', 'ui', null, undefined, 1])('%s は無効', (value) => {
    expect(isUiVariant(value)).toBe(false);
  });
});

describe('resolveUiVariant: 適用する案を決める', () => {
  it('本番ビルド（isDev=false）では ?ui= も記憶も無視して current に固定される', () => {
    // テスト会用の切替が本番へ漏れないことが、この段の一番大事な受入条件
    expect(resolveUiVariant({ param: 'a1', stored: 'a2', isDev: false })).toEqual({
      variant: 'current',
      shouldPersist: false,
    });
    expect(resolveUiVariant({ param: 'a2', stored: null, isDev: false }).variant).toBe('current');
  });

  it.each(['current', 'a1', 'a2', 'a3'] as const)('開発時は ?ui=%s がそのまま採用され、記憶される', (variant) => {
    expect(resolveUiVariant({ param: variant, stored: null, isDev: true })).toEqual({
      variant,
      shouldPersist: true,
    });
  });

  it('URLの指定は記憶より優先される（送ったURLで必ずその案になる）', () => {
    expect(resolveUiVariant({ param: 'a2', stored: 'a1', isDev: true }).variant).toBe('a2');
  });

  it('?ui= が不正値なら current にし、記憶も current へそろえる（見えない食い違いを残さない）', () => {
    expect(resolveUiVariant({ param: 'zzz', stored: 'a1', isDev: true })).toEqual({
      variant: 'current',
      shouldPersist: true,
    });
  });

  it('?ui= が無ければ記憶している案を使う（リロードで維持される）', () => {
    expect(resolveUiVariant({ param: null, stored: 'a1', isDev: true })).toEqual({
      variant: 'a1',
      shouldPersist: false,
    });
  });

  it('?ui= が無く記憶も無い／壊れているときは current', () => {
    expect(resolveUiVariant({ param: null, stored: null, isDev: true }).variant).toBe('current');
    expect(resolveUiVariant({ param: null, stored: 'zzz', isDev: true }).variant).toBe('current');
  });
});

describe('localStorage の読み書き', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存した案を読み戻せる', () => {
    saveStoredUiVariant('a2');
    expect(localStorage.getItem(UI_VARIANT_STORAGE_KEY)).toBe('a2');
    expect(loadStoredUiVariant()).toBe('a2');
  });

  it('未保存なら null', () => {
    expect(loadStoredUiVariant()).toBeNull();
  });
});

describe('表示まわりの定数', () => {
  it('既定値は current（現状のUI＝対照群）', () => {
    expect(DEFAULT_UI_VARIANT).toBe('current');
  });

  it('4案すべてに隅の表示用のラベルがある', () => {
    expect(Object.keys(UI_VARIANT_LABELS).sort()).toEqual(['a1', 'a2', 'a3', 'current']);
  });
});
