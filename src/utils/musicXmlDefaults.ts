/**
 * MusicXML の `<defaults>`（作品のレイアウト指定）を読むユーティリティ（Issue #477）。
 *
 * Finale や MuseScore の書き出しは `<defaults>` に「その作品をどう組むか」を入れている。
 *
 * - `<scaling>`: 五線の大きさ。`millimeters` mm ＝ `tenths` tenths という比で書かれ、
 *   MusicXML では **40 tenths が五線の高さ（第1線〜第5線）** と決まっている
 * - `<page-layout>`: 判型（page-width / page-height）と余白（page-margins）。
 *   単位は tenths なので、`<scaling>` が無いと mm へ換算できない
 *
 * 従来の読込はこれらを全部捨てて既定サイズで組んでいたため、実曲（ラヴェル ソナチネ等）を
 * 持ち込むと「ファイル指定の縮尺を無視して大きく組んだ」結果として紙幅超過警告が出ていた。
 *
 * ここでは「読むだけ」の純関数を提供し、実際に画面へ当てるのは呼び出し側
 * （musicXmlImport → ScorePage）が行う。
 */
import { PAGE_SIZES, type PageSizeId } from './pageSize';
import { UNITS_PER_STAFF_SPACE } from './engravingDefaults';
import {
  NOTATION_SIZE_MULTIPLIER_MAX,
  NOTATION_SIZE_MULTIPLIER_MIN,
  PAGE_MARGIN_SIDE_MAX_MM,
  PAGE_MARGIN_SIDE_MIN_MM,
  PAGE_MARGIN_VERTICAL_MAX_MM,
  PAGE_MARGIN_VERTICAL_MIN_MM,
  SCORE_LAYOUT_RENDER_SCALE,
} from './measureLayoutUtils';

/** MusicXML の決めごと: 40 tenths ＝ 五線の高さ（第1線〜第5線）。 */
export const TENTHS_PER_STAFF_HEIGHT = 40;

/** mm → CSS px の換算係数（このアプリの紙面は 96dpi 相当で描いている）。 */
const PX_PER_MM = 96 / 25.4;

/** 五線の高さ（第1線〜第5線）が SVG 論理単位でいくつぶんか。1 sp = 10 u なので 4 sp = 40 u。 */
const STAFF_HEIGHT_UNITS = UNITS_PER_STAFF_SPACE * 4;

/**
 * 「音符の大きさ」倍率 m のとき、紙面に印刷される五線の高さ（mm）。
 *
 * 描画は「SVG論理単位 × SCORE_LAYOUT_RENDER_SCALE × m」で CSS px になり、紙面の 1mm は
 * 96/25.4 px なので、その逆算で mm を求める。既定の 150% でおよそ 6.99mm となり、
 * 浄書で標準とされる五線高 7mm（Finale の既定 6.9674mm）とほぼ一致する。
 */
export function staffHeightMmForNotationSize(multiplier: number): number {
  return (STAFF_HEIGHT_UNITS * SCORE_LAYOUT_RENDER_SCALE * multiplier) / PX_PER_MM;
}

/**
 * 五線の高さ（mm）を「音符の大きさ」倍率へ逆算する。
 *
 * スライダーが 5% 刻み（80〜200%）なので、同じ刻みへ丸めてから範囲へクランプする
 * （ユーザーが後からスライダーを動かしたときに値が飛ばないようにするため）。
 */
export function notationSizeMultiplierForStaffHeightMm(staffHeightMm: number): number {
  const raw = staffHeightMm / staffHeightMmForNotationSize(1);
  const stepped = Math.round(raw * 20) / 20; // 0.05（＝5%）刻み
  return Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(NOTATION_SIZE_MULTIPLIER_MAX, stepped));
}

/**
 * 用紙の実寸（mm）から、このアプリが対応する判型のうち最も近いものを選ぶ。
 *
 * @returns `id` は最も近い判型、`rounded` は「実寸とずれたので丸めた」かどうか
 *   （縦横どちらかが 3mm を超えてずれていれば丸めたとみなし、呼び出し側が #318 の
 *   方針で通知する）。
 */
export function nearestPageSize(widthMm: number, heightMm: number): { id: PageSizeId; rounded: boolean } {
  let best = PAGE_SIZES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const size of PAGE_SIZES) {
    const distance = Math.abs(size.widthMm - widthMm) + Math.abs(size.heightMm - heightMm);
    if (distance < bestDistance) {
      best = size;
      bestDistance = distance;
    }
  }
  const rounded = Math.abs(best.widthMm - widthMm) > 3 || Math.abs(best.heightMm - heightMm) > 3;
  return { id: best.id, rounded };
}

/** `<defaults>` から読み取れた「その作品のレイアウト」。読めなかった項目は undefined。 */
export interface MusicXmlDefaultsLayout {
  /** `<scaling>` から求めた「音符の大きさ」倍率（0.8〜2.0 へクランプ済み） */
  notationSizeMultiplier?: number;
  /** `<scaling>` が示す五線の高さ（mm）。通知文やテストで実寸を見せるために持つ */
  staffHeightMm?: number;
  /** `<page-layout>` の判型を、このアプリの対応サイズへ寄せたもの */
  pageSize?: PageSizeId;
  /** 判型が実寸と一致せず、最も近い対応サイズへ丸められた場合に true */
  pageSizeRounded?: boolean;
  /** `<page-margins>` の余白（mm、スライダーの範囲へクランプ済み） */
  pageMargins?: { sideMm: number; topMm: number; bottomMm: number };
}

/** 要素の子テキストを数値として読む（無い・数値でない・非正なら undefined）。 */
function readPositiveNumber(parent: Element | null, selector: string): number | undefined {
  const text = parent?.querySelector(selector)?.textContent;
  if (text == null) return undefined;
  const value = parseFloat(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * `<defaults>` を読んで、その作品の初期レイアウト値を返す。
 *
 * 壊れた値・極端な値（五線高 1mm 未満や 20mm 超、用紙 50mm 未満や 1000mm 超）は
 * 「読めなかった」扱いにして無視する。ファイル由来の値で画面を壊さないための安全弁で、
 * その場合は従来どおりアプリの既定値で組む。
 *
 * @param doc MusicXML の Document（または score-partwise 要素）
 * @returns 読み取れた項目だけを持つオブジェクト。何も読めなければ undefined
 */
export function readMusicXmlDefaults(doc: Document | Element): MusicXmlDefaultsLayout | undefined {
  const defaultsEl = doc.querySelector('defaults');
  if (!defaultsEl) return undefined;

  const result: MusicXmlDefaultsLayout = {};

  // <scaling>: millimeters mm ＝ tenths tenths。40 tenths が五線の高さ
  const scalingEl = defaultsEl.querySelector('scaling');
  const millimeters = readPositiveNumber(scalingEl, 'millimeters');
  const tenths = readPositiveNumber(scalingEl, 'tenths');
  const mmPerTenth = millimeters != null && tenths != null ? millimeters / tenths : undefined;
  if (mmPerTenth != null) {
    const staffHeightMm = mmPerTenth * TENTHS_PER_STAFF_HEIGHT;
    if (staffHeightMm >= 1 && staffHeightMm <= 20) {
      result.staffHeightMm = staffHeightMm;
      result.notationSizeMultiplier = notationSizeMultiplierForStaffHeightMm(staffHeightMm);
    }
  }

  // <page-layout>: 単位は tenths なので、<scaling> が読めたときだけ mm へ換算できる
  const pageLayoutEl = defaultsEl.querySelector('page-layout');
  if (pageLayoutEl && mmPerTenth != null) {
    const pageWidthTenths = readPositiveNumber(pageLayoutEl, 'page-width');
    const pageHeightTenths = readPositiveNumber(pageLayoutEl, 'page-height');
    if (pageWidthTenths != null && pageHeightTenths != null) {
      const widthMm = pageWidthTenths * mmPerTenth;
      const heightMm = pageHeightTenths * mmPerTenth;
      if (widthMm >= 50 && widthMm <= 1000 && heightMm >= 50 && heightMm <= 1000) {
        const { id, rounded } = nearestPageSize(widthMm, heightMm);
        result.pageSize = id;
        result.pageSizeRounded = rounded;
      }
    }

    // 余白は type="both"（見開き共通）を優先し、無ければ最初の <page-margins> を使う。
    // このアプリの左右余白は1つのスライダー（左右同値）なので、左右の平均を採る。
    const marginsEl =
      Array.from(pageLayoutEl.querySelectorAll('page-margins')).find(
        (el) => el.getAttribute('type') === 'both',
      ) ?? pageLayoutEl.querySelector('page-margins');
    const leftTenths = readPositiveNumber(marginsEl, 'left-margin');
    const rightTenths = readPositiveNumber(marginsEl, 'right-margin');
    const topTenths = readPositiveNumber(marginsEl, 'top-margin');
    const bottomTenths = readPositiveNumber(marginsEl, 'bottom-margin');
    if (leftTenths != null && rightTenths != null && topTenths != null && bottomTenths != null) {
      result.pageMargins = {
        sideMm: clamp(
          Math.round(((leftTenths + rightTenths) / 2) * mmPerTenth),
          PAGE_MARGIN_SIDE_MIN_MM,
          PAGE_MARGIN_SIDE_MAX_MM,
        ),
        topMm: clamp(
          Math.round(topTenths * mmPerTenth),
          PAGE_MARGIN_VERTICAL_MIN_MM,
          PAGE_MARGIN_VERTICAL_MAX_MM,
        ),
        bottomMm: clamp(
          Math.round(bottomTenths * mmPerTenth),
          PAGE_MARGIN_VERTICAL_MIN_MM,
          PAGE_MARGIN_VERTICAL_MAX_MM,
        ),
      };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
