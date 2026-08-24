// src/hooks/useUiVariant.ts
// Issue #405（段1）: 適用中のUI案を1か所で解決して配るフック。
//
// 画面のどこからでも同じ答えを返せるよう、判定はこのフックに集約する。
// 段2（A1 文脈バー）・段3（A2 譜面側表現）は、このフックの戻り値を見て
// 「自分の案のときだけ描く」形で足していく想定。

import { useEffect, useState } from 'react';
import {
  DEFAULT_UI_VARIANT,
  loadStoredUiVariant,
  readUiVariantParam,
  resolveUiVariant,
  saveStoredUiVariant,
  type UiVariant,
} from '../utils/uiVariant';

export interface UseUiVariantOptions {
  /**
   * 開発ビルドかどうか。既定は Vite の `import.meta.env.DEV`。
   * テストから「本番ビルドでは current に固定される」ことを確かめられるよう、
   * 引数で差し替えられるようにしてある。
   */
  isDev?: boolean;
  /** クエリ文字列。既定は現在のURL（テスト用に差し替え可能） */
  search?: string;
}

/**
 * 適用中のUI案を返す。URLは読み込み時にしか変わらない（`?ui=` を変えるとリロードが走る）ため、
 * 初回レンダー時に一度だけ解決し、以降は変化しない。
 */
export function useUiVariant(options: UseUiVariantOptions = {}): UiVariant {
  const isDev = options.isDev ?? import.meta.env.DEV;

  // useState の初期化関数（第一引数に関数を渡す形）にしているのは、
  // 再レンダーのたびに localStorage を読み直さないため
  const [resolved] = useState(() => {
    // SSR や jsdom 未提供の環境でも落ちないよう window の有無を確かめる
    const search = options.search ?? (typeof window === 'undefined' ? '' : window.location.search);
    if (!isDev) {
      return { variant: DEFAULT_UI_VARIANT, shouldPersist: false };
    }
    return resolveUiVariant({
      param: readUiVariantParam(search),
      stored: loadStoredUiVariant(),
      isDev,
    });
  });

  useEffect(() => {
    // URLで明示指定されたときだけ記憶を更新する（副作用なのでレンダー中には書かない）
    if (resolved.shouldPersist) {
      saveStoredUiVariant(resolved.variant);
    }
  }, [resolved]);

  return resolved.variant;
}
