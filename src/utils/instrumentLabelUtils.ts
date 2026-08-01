// 五線の左に置く「パート名ラベル」の幅とフォントサイズを決める計算をまとめたファイル。
//
// 浄書（楽譜の組版）の慣習では、総譜の1段目はフル名（Flute / Tenor Saxophone in Bb …）、
// 2段目以降は略称（Fl. / T.Sax. …）を書く（Issue #60）。フル名は略称よりずっと長いため、
// 「略称ぶんの固定余白（74）」のままだと五線にかぶったり紙の左端で切れたりする。
//
// ここでは次の2段階で「はみ出さない」ことを保証する。
//   1. ラベル用の余白（=五線の描画開始位置を右へずらす幅）を、実際のラベル文字列に
//      合わせて広げる（上限あり）
//   2. 上限まで広げても入りきらない長い名前は、フォントサイズを縮めて収める
//
// 余白を無制限に広げないのは、この余白ぶんだけ小節が使える幅が減り、1段に入る小節数
// （＝段割り・ページ数）まで動いてしまうため。上限を決めておけばレイアウトへの影響を
// 見積もれる範囲に抑えられる。
import { SYSTEM_MAX_LABEL_WIDTH } from './measureLayoutUtils';

/** ラベルの右端と五線の左端のあいだに空ける隙間（描画側の x 計算と同じ値を使う）。 */
export const INSTRUMENT_LABEL_STAVE_GAP = 10;

/** 紙（SVG）の左端とラベルの左端のあいだに最低限残す余白。 */
export const INSTRUMENT_LABEL_PAGE_MARGIN = 4;

/**
 * ラベル用余白の上限。SYSTEM_MAX_LABEL_WIDTH（=略称ぶんの既定値）からここまでは
 * 自動で広げてよい、という範囲。広げすぎると小節の幅が痩せるため上限を設ける。
 */
export const INSTRUMENT_LABEL_MAX_AREA_WIDTH = 110;

/** フォント縮小の下限。これ以上小さくすると印刷時に読めなくなるため。 */
export const INSTRUMENT_LABEL_MIN_FONT_SIZE = 7;

/**
 * 段数（パート数）から基準フォントサイズを返す。段が多い総譜ほど1段の高さが低く、
 * 大きい文字だと隣の段のラベルとぶつかるため小さめにする（従来の描画と同じ判定）。
 */
export function instrumentLabelBaseFontSize(partCount: number): number {
  return partCount > 10 ? 9 : 11;
}

// 文字ごとの「フォントサイズに対する幅の比率（em）」のおおよその値。
// SVG に描く前の段階で幅を知りたいが、canvas の measureText は jsdom（テスト環境）で
// 使えず、SVG の getComputedTextLength も描画後にしか測れない。そこで sans-serif の
// 実測に近い比率で見積もる。多少大きめに出るぶんには「余白が少し広い」だけで済むので、
// 安全側（やや大きめ）の値を採用している。
const NARROW_CHARS = new Set([' ', '.', ',', "'", '"', '`', '|', 'i', 'l', 'j', 'I', 't', 'f', 'r', '(', ')', '-']);
const WIDE_LOWERCASE = new Set(['m', 'w']);

function charWidthRatio(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  // 全角（CJK・全角記号など）はほぼ1文字ぶんの幅を取る
  if (code >= 0x1100) return 1;
  if (NARROW_CHARS.has(char)) return 0.32;
  if (WIDE_LOWERCASE.has(char)) return 0.85;
  if (char >= '0' && char <= '9') return 0.56;
  if (char >= 'A' && char <= 'Z') return 0.68;
  return 0.55;
}

/** ラベル文字列の描画幅（SVG論理単位）をフォント実測なしで見積もる。 */
export function estimateInstrumentLabelWidth(label: string, fontSize: number): number {
  let ratioSum = 0;
  // for...of は絵文字などのサロゲートペアも1文字として回せる
  for (const char of label) {
    ratioSum += charWidthRatio(char);
  }
  return ratioSum * fontSize;
}

export type InstrumentLabelLayout = {
  /** 五線の左に確保する余白の幅（SVG論理単位）。描画側の labelW。 */
  areaWidth: number;
  /** 実際にラベルを描くときのフォントサイズ。 */
  fontSize: number;
};

/**
 * 実際に描くラベル一覧から、必要な余白幅と（必要なら縮めた）フォントサイズを決める。
 *
 * - 略称のように短いラベルだけなら従来と同じ SYSTEM_MAX_LABEL_WIDTH のまま
 *   （既存の段割り・ページ数を変えないため、下限は従来値に固定する）
 * - フル名で足りないときは上限まで自動で広げる
 * - 上限でも足りない極端に長い名前はフォントを縮めて収める
 */
export function resolveInstrumentLabelLayout(
  labels: readonly string[],
  baseFontSize: number
): InstrumentLabelLayout {
  const widest = labels.reduce(
    (max, label) => Math.max(max, estimateInstrumentLabelWidth(label, baseFontSize)),
    0
  );
  const needed = widest + INSTRUMENT_LABEL_STAVE_GAP + INSTRUMENT_LABEL_PAGE_MARGIN;
  const areaWidth = Math.min(
    INSTRUMENT_LABEL_MAX_AREA_WIDTH,
    Math.max(SYSTEM_MAX_LABEL_WIDTH, needed)
  );
  // 余白のうち、実際に文字を置ける幅（隙間と紙端の余白を除いたぶん）
  const usableWidth = areaWidth - INSTRUMENT_LABEL_STAVE_GAP - INSTRUMENT_LABEL_PAGE_MARGIN;
  const fontSize = widest > usableWidth
    ? Math.max(INSTRUMENT_LABEL_MIN_FONT_SIZE, baseFontSize * (usableWidth / widest))
    : baseFontSize;
  return { areaWidth, fontSize };
}

/**
 * 段割りを計画する側（ScorePage → worstCaseSystemContentBudget）が使う「この譜面で
 * 最大どれだけラベル余白を取りうるか」。1段目はフル名・2段目以降は略称というように
 * 段によって文字列が変わるため、両方を渡して最大値で計画する。
 * 計画と描画で違う値を使うと、段の本文幅が食い違って小節が右端からはみ出す。
 */
export function instrumentLabelAreaWidthForScore(
  labels: readonly string[],
  partCount: number
): number {
  if (labels.length === 0) return SYSTEM_MAX_LABEL_WIDTH;
  return resolveInstrumentLabelLayout(labels, instrumentLabelBaseFontSize(partCount)).areaWidth;
}
