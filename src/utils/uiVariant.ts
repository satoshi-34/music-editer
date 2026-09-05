// src/utils/uiVariant.ts
// Issue #405（段1）: テスト会でUI案を「その場で」切り替えるための土台。
//
// なぜURLパラメータなのか:
// ユーザーテスト会は一度きりの機会なので、案を変えるたびに再ビルドしていては間に合わない。
// `?ui=a1` のようなURLを送るだけで切り替わり、リロードしても維持される形にしておく。
//
// なぜ開発時だけなのか:
// 本番（Vercel Production）で誰かが `?ui=a1` を付けても未完成のUIが出ないようにするため。
// 判定用の `isDev` はこのファイルでは受け取るだけにして（import.meta.env を直接読まない）、
// 「本番では current に固定される」ことをテストから確かめられるようにしている。

/** UI案の識別子。`current` は対照群（現状のまま・実装なし）。 */
export type UiVariant = 'current' | 'a1' | 'a2' | 'a3';

/** 未指定・不正値・本番ビルドで使う既定値（＝現状のUI） */
export const DEFAULT_UI_VARIANT: UiVariant = 'current';

/** URLパラメータ名。`?ui=a1` のように使う。 */
export const UI_VARIANT_QUERY_PARAM = 'ui';

/** 記憶用のlocalStorageキー。他の設定キーと同じ `music-score-app-` 接頭辞にそろえる。 */
export const UI_VARIANT_STORAGE_KEY = 'music-score-app-ui-variant';

/** 画面の隅に出す表示名（観察記録のとき「どの案を触っていたか」を言葉で残せるように） */
export const UI_VARIANT_LABELS: Record<UiVariant, string> = {
  current: '現状',
  a1: 'A1 文脈バー',
  a2: 'A2 譜面側',
  a3: 'A3 両方',
};

/** 受け取った値が UiVariant のどれかかどうか（未知の文字列を弾く） */
export function isUiVariant(value: unknown): value is UiVariant {
  return value === 'current' || value === 'a1' || value === 'a2' || value === 'a3';
}

/**
 * URLのクエリ文字列（`?ui=a1` や `ui=a1&foo=1`）から `ui` の値を取り出す。
 * パラメータが無ければ null、あれば（不正値でも）その文字列をそのまま返す。
 * 「無い」と「不正な値が書かれている」を呼び出し側で区別できるようにするため、
 * ここでは UiVariant への絞り込みまではしない。
 */
export function readUiVariantParam(search: string): string | null {
  // URLSearchParams は先頭の "?" があっても無くても解釈できる
  return new URLSearchParams(search).get(UI_VARIANT_QUERY_PARAM);
}

/** resolveUiVariant の結果。`shouldPersist` が true のときだけ localStorage を書き換える。 */
export interface ResolvedUiVariant {
  variant: UiVariant;
  /** この解決結果を記憶し直すべきか（URLで明示指定されたときだけ true） */
  shouldPersist: boolean;
}

/**
 * 「URLパラメータ」「記憶している値」「開発時かどうか」から、実際に適用する案を決める。
 *
 * 決め方（優先順）:
 * 1. 本番ビルド（isDev=false）なら、何が書かれていても `current` に固定する
 * 2. URLに `?ui=` があり有効値 → それを採用して記憶する
 * 3. URLに `?ui=` があるが不正値 → `current` を採用して記憶する
 *    （記憶も上書きするのは、打ち間違いのときに「画面はcurrentなのに記憶はa1」という
 *      見えない食い違いを残さないため。次にパラメータ無しで開いても同じ表示になる）
 * 4. URLに `?ui=` が無い → 記憶している値（有効なら）を使う。無ければ `current`
 *    （テスト会中にURLからパラメータが落ちても、選んだ案のまま触り続けられるように）
 */
export function resolveUiVariant(input: {
  param: string | null;
  stored: string | null;
  isDev: boolean;
}): ResolvedUiVariant {
  if (!input.isDev) {
    return { variant: DEFAULT_UI_VARIANT, shouldPersist: false };
  }
  if (input.param !== null) {
    const variant = isUiVariant(input.param) ? input.param : DEFAULT_UI_VARIANT;
    return { variant, shouldPersist: true };
  }
  if (isUiVariant(input.stored)) {
    return { variant: input.stored, shouldPersist: false };
  }
  return { variant: DEFAULT_UI_VARIANT, shouldPersist: false };
}

/**
 * 記憶している案を読む。localStorage が使えない環境（プライベートブラウジング等）でも
 * 例外を投げず null を返す（切替の仕組みのせいでアプリが起動しない、を防ぐ）。
 */
export function loadStoredUiVariant(): string | null {
  try {
    return localStorage.getItem(UI_VARIANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 案を記憶する。保存に失敗しても致命的ではないので握りつぶす。 */
export function saveStoredUiVariant(variant: UiVariant): void {
  try {
    localStorage.setItem(UI_VARIANT_STORAGE_KEY, variant);
  } catch {
    // quota超過・プライベートブラウジング等。切替は今回の表示だけ効いていればよい
  }
}
