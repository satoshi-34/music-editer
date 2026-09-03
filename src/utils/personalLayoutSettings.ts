// src/utils/personalLayoutSettings.ts
// 表示設定（localStorage の個人既定）の読み出し（Issue #477 round1/round5）。
//
// ScorePage の state 初期化と「属性を持たない作品を開いたときの復帰先」が
// 同じ値を返すことが約束（食い違うと作品切替で縮尺・余白が化ける）。
// ScorePage.tsx（コンポーネントファイル）から関数を export すると
// react-refresh の制約に触れるため、純関数としてここへ切り出した。
// キー名の正本もここ（ScorePage は import して使う）。

import {
  DEFAULT_PAGE_MARGIN_BOTTOM_MM,
  DEFAULT_PAGE_MARGIN_TOP_MM,
  DEFAULT_PAGE_SIDE_MARGIN_MM,
  NOTATION_SIZE_MULTIPLIER_MAX,
  NOTATION_SIZE_MULTIPLIER_MIN,
  PAGE_MARGIN_SIDE_MAX_MM,
  PAGE_MARGIN_SIDE_MIN_MM,
  PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM,
  PAGE_MARGIN_VERTICAL_MAX_MM,
  PAGE_MARGIN_VERTICAL_MIN_MM,
  resolveDefaultLayoutForScoreType,
} from './measureLayoutUtils';

export const NOTATION_SIZE_KEY = 'score-notation-size';
export const PAGE_MARGIN_SIDE_KEY = 'score-page-margin-side';
export const PAGE_MARGIN_VERTICAL_LEGACY_KEY = 'score-page-margin-vertical';
export const PAGE_MARGIN_TOP_KEY = 'score-page-margin-top';
export const PAGE_MARGIN_BOTTOM_KEY = 'score-page-margin-bottom';

/**
 * 表示設定（localStorage の個人既定）から音符サイズを読む（Issue #477 round1 P1）。
 * state 初期化と同じ読み方の関数化: 属性を持たない作品を開いたとき、ここへ戻す
 */
export function readPersonalNotationSizeSetting(): number {
  const raw = localStorage.getItem(NOTATION_SIZE_KEY);
  const n = raw == null ? NaN : parseFloat(raw);
  // フォールバックは state 初期化と同じ「単旋律の既定」に固定する。
  // データ側の譜種の既定へ倒すと、属性を持たない既存の四重奏・編成譜作品の
  // 見た目（これまで単旋律既定の縮尺で描かれていた）が変わってしまうため
  return Number.isFinite(n)
    ? Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(NOTATION_SIZE_MULTIPLIER_MAX, n))
    : resolveDefaultLayoutForScoreType('single').notationSizeMultiplier;
}

/** 表示設定からページ余白を読む（同上）。読めない・範囲外は既定値へ */
export function readPersonalPageMarginSettings(): { sideMm: number; topMm: number; bottomMm: number } {
  const read = (key: string, fallback: number, min: number, max: number) => {
    const raw = localStorage.getItem(key);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  // 上下は旧・単一キー（score-page-margin-vertical）を後方互換として読む
  // （state 初期化と同じ優先順位・同じ計算順。round2/round3/round4 P2:
  // 新キーだけ見ると旧設定利用者の上下余白が工場値へ化け、旧値を先にクランプすると
  // 下余白の「生値 − 2mm → クランプ」という state 初期化の順序と食い違う）
  const legacyVerticalRaw = (() => {
    const raw = localStorage.getItem(PAGE_MARGIN_VERTICAL_LEGACY_KEY);
    const n = raw == null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  })();
  const clampVertical = (n: number) =>
    Math.max(PAGE_MARGIN_VERTICAL_MIN_MM, Math.min(PAGE_MARGIN_VERTICAL_MAX_MM, n));
  return {
    sideMm: read(PAGE_MARGIN_SIDE_KEY, DEFAULT_PAGE_SIDE_MARGIN_MM, PAGE_MARGIN_SIDE_MIN_MM, PAGE_MARGIN_SIDE_MAX_MM),
    topMm: read(
      PAGE_MARGIN_TOP_KEY,
      legacyVerticalRaw != null ? clampVertical(legacyVerticalRaw) : DEFAULT_PAGE_MARGIN_TOP_MM,
      PAGE_MARGIN_VERTICAL_MIN_MM, PAGE_MARGIN_VERTICAL_MAX_MM,
    ),
    bottomMm: read(
      PAGE_MARGIN_BOTTOM_KEY,
      legacyVerticalRaw != null
        ? clampVertical(Math.max(0, legacyVerticalRaw - PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM))
        : DEFAULT_PAGE_MARGIN_BOTTOM_MM,
      PAGE_MARGIN_VERTICAL_MIN_MM, PAGE_MARGIN_VERTICAL_MAX_MM,
    ),
  };
}
