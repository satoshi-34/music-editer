import type { MeasureData, NoteEvent, ScoreType } from '../types/storage';
import { devTuned } from './devTuning';
import { getPrimaryVoiceEvents } from './voiceMeasureUtils';
import { Accidental, Dot, Formatter, GraceNote, GraceNoteGroup, StaveNote, Voice } from 'vexflow';
import { createVexFlowTuplets, vexFlowDotCount } from './vexFlowTimingUtils';
import {
  createMeasureAccidentalState,
  getKeySignatureFifths,
  microtoneAccidentalCode,
  resolveDisplayAccidentalsForKeys,
  snapshotAccidentalState,
  shiftKeySignatureByFifths,
  type KeySignature,
  type MeasureAccidentalState,
} from './noteKeyUtils';
import { DEFAULT_PAGE_WIDTH_MM } from './pageSize';
import { resolveMeasureKeySignature } from './keySignatureMeasureUtils';
import { resolveClefAtMeasureEnd } from './clefMeasureUtils';
import type { ClefType } from '../components/clefUtils';

// VexFlow が符頭・符尾・ビームを並べるために必要な、音価ごとの最低横幅。
// とくに16分音符以上は、音価そのものは短くても符尾やビームが横に張り出すため、
// 四分音符より狭く見積もると描画後に音符同士が重なる。
const EVENT_BASE_WIDTH = 8;
const FLAG_EXTRA_WIDTH: Record<NoteEvent['dur'], number> = {
  '1': 0,
  '2': 0,
  '4': 0,
  '8': 0,
  '16': 4,
  '32': 6,
  '64': 8,
};
// 小節の左右に確保する余白（VexFlow の音符列の外側）。Issue #559 の圧縮率は
// 「音符の並びの理想間隔」だけに掛けるため、この余白と分けて足せるよう定数を公開する。
export const MEASURE_SIDE_PADDING = 18;
/** dev チューニング（#596）を通した実効値。本番は定数そのもの（devTuned 呼び出しごと消える） */
function measureSidePadding(): number {
  return import.meta.env.DEV
    ? devTuned('layout.measureSidePadding', MEASURE_SIDE_PADDING)
    : MEASURE_SIDE_PADDING;
}
const ACCIDENTAL_WIDTH = 6;
const GRACE_NOTE_WIDTH = 8;

export const MIN_MEASURE_CONTENT_WIDTH = 52;
export const LONG_HALF_MIN_WIDTH = 80;
export const LONG_WHOLE_MIN_WIDTH = 92;
// PianoSystemCanvas と ScorePage が同じ物理幅を使えるよう、段組みの基準をここへ集約する。
// viewport の CSS transform とは独立した、VexFlow の論理座標→物理SVG座標の倍率。
//
// VexFlow の StaveNote / Formatter はデフォルトで五線の高さ約40論理単位を前提にした
// 比較的大きな符頭・符尾サイズで最低幅を計算する。これをそのまま等倍（=1）で物理
// ページ幅（182mm ≒ 688px）へ当てはめると、五線の高さが約10.6mmという実際の印刷譜
// （一般的に六〜七分＝約6〜7mm）より大幅に大きいサイズになってしまい、1小節の最低幅が
// 実際に必要な幅の2倍前後まで膨れる。結果として「読込直後にほぼ全小節が1小節/段へ
// 膨張する」不具合の主因になっていた（.claude/specs/multi-part-beat-alignment/design.md 参照）。
// 0.4 は実測（print-test-score.json の代表的な1小節=約330論理px）から、
// 段あたり4小節という一般的な組版密度に収まる実寸相当のスケールとして選んだ値。
// 0.44 = 0.4 × 1.1。印刷テストで記号や音符が市販譜よりひと回り小さかったため、
// 1.1倍に拡大した（値を上げるほど音符が大きくなり、1段に入る小節数は減る）。
export const SCORE_LAYOUT_RENDER_SCALE = 0.44;
export const SYSTEM_PAGE_SIDE_PADDING = 4;
export const SYSTEM_TARGET_FILL = 0.99;
export const SYSTEM_FIRST_CLEF_PADDING = 50;
export const SYSTEM_MAX_LABEL_WIDTH = 74;
// .print-page は box-sizing:border-box で左右のpaddingを持つ（既定14mm）。Canvas 親の実幅は
// 「用紙の幅（A4なら210mm） − 左右余白×2」の本文幅であり、用紙全幅からの別計算をしない
// （CSSとの二重定義を避ける）。用紙の幅の正本は utils/pageSize.ts（Issue #495）。
// 左右余白はレイアウトタブの「ページ余白（左右）」スライダーでユーザーが変更できるため、
// 固定値ではなく sideMarginMm 引数を受け取る関数を正本にする。
// 既定の14mmを省略時の値として使うことで、スライダーを一度も触らないユーザーには
// 従来どおり全く同じ値（PRINT_SCORE_AREA_WIDTH_PX 相当）が返る。
export const DEFAULT_PAGE_SIDE_MARGIN_MM = 14;

// 「レイアウト/楽譜設定」タブのレイアウト系スライダーが取りうる範囲。ScorePage.tsx と
// settingsProfile.ts（初期値プリセット、issue #39）の両方から同じ値を参照する必要があるため、
// スライダー実装側（元は ScorePage.tsx にローカル定義していた）からこちらへ集約し、
// 値の食い違い（二重管理）が起きないようにしている。
export const NOTATION_SIZE_MULTIPLIER_MIN = 0.8;
export const NOTATION_SIZE_MULTIPLIER_MAX = 2.0;
export const PAGE_MARGIN_SIDE_MIN_MM = 8;
export const PAGE_MARGIN_SIDE_MAX_MM = 25;
export const PAGE_MARGIN_VERTICAL_MIN_MM = 8;
export const PAGE_MARGIN_VERTICAL_MAX_MM = 25;
// 「余白(上)」「余白(下)」を分離する前は1本のスライダーで、下余白は常に「上余白－2mm」
// だった。既定値はその名残（上14mm/下12mm）を保つ。
export const PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM = 2;
export const DEFAULT_PAGE_MARGIN_TOP_MM = DEFAULT_PAGE_SIDE_MARGIN_MM;
export const DEFAULT_PAGE_MARGIN_BOTTOM_MM = DEFAULT_PAGE_SIDE_MARGIN_MM - PAGE_MARGIN_VERTICAL_BOTTOM_OFFSET_MM;
// 「タイトル余白(上)」「タイトル余白(下)」（Issue #103）の可動範囲・既定値。
// ★調整するならここが正本★ — タイトルページ（1ページ目）だけに効く追加余白で、
// 上＝タイトル文字列の前の余白（.page-head の padding-top）、下＝タイトルブロック
// （タイトル・サブタイトル・作詞者欄等）と1段目の間の余白（.page-head の margin-bottom）。
// 2ページ目以降の見出し（page-title）には適用しない（App.css の .page-head--title 参照）。
// 既定値は変更前の固定CSS（padding-top:0・margin-bottom:6mm）と一致させ、
// スライダーを一度も触らなければ見た目が変わらないようにしている。
export const TITLE_MARGIN_TOP_MIN_MM = 0;
export const TITLE_MARGIN_TOP_MAX_MM = 30;
export const TITLE_MARGIN_BOTTOM_MIN_MM = 0;
export const TITLE_MARGIN_BOTTOM_MAX_MM = 30;
export const DEFAULT_TITLE_MARGIN_TOP_MM = 0;
export const DEFAULT_TITLE_MARGIN_BOTTOM_MM = 6;
// 「段の間隔」（段と段の間の縦間隔）スライダーの可動範囲。
// ★調整するならここが正本★ — この2定数を変えるだけで、
//   1) 楽譜設定タブのスライダーの min/max 属性（ScorePage.tsx）
//   2) 段ごとの「間隔 −/＋」オーバーライドのクランプ（ScorePage.tsx、同じ範囲を共有）
//   3) 初期値プリセットの読み込み時の妥当性チェック（settingsProfile.ts の範囲検査）
// のすべてが追従する。個別のファイルに数値を直書きしないこと（二重管理の禁止）。
// 上限は 30→50 に拡大済み（2026-07-27、運用者要望）。上限を大きくしすぎると1ページに
// 入る段数の上限（maxSystemsPerPage、README「段数/ページ上限との連動」参照）が減っていき、
// 極端な値では1ページ1段になる点に注意（計算式は自動追従するため壊れはしない）。
// 下限は −30→−60 に拡大済み（2026-08-09、Issue #199）。ピアノ譜の新しい既定値 −30 が
// 旧下限そのものだったため、そこからさらに詰めたい運用者が調整できなくなっていた。
// マイナス側を深くすると段どうしが物理的に重なることがあるが、これは
// 「ユーザーが自分で詰めた結果」として許容する（既定値は −30 なので初期表示は安全）。
export const SYSTEM_ROW_GAP_MIN_PX = -60;
export const SYSTEM_ROW_GAP_MAX_PX = 50;
// 「パート間隔」（段内の譜表間の縦間隔、Issue #90）のユーザー調整幅。自動計算値
// （staveSpacingForPartCount: 単旋律/ピアノ/四重奏=80、5パート以上=60、ネイティブ単位）
// への加算補正として使う。0は「自動計算のまま」を意味する（ピアノ以外の既定値）。
// ピアノだけは既定値が +38（PART_SPACING_OFFSET_PIANO_DEFAULT_PX、Issue #199）。
// ★調整するならここが正本★ — この3定数を変えるだけで、
//   1) レイアウトタブ「パート間隔」スライダーの min/max（ScorePage.tsx）
//   2) 初期値プリセット読み込み時の範囲検査（settingsProfile.ts）
//   3) 実描画・段高見積もりのクランプ（computeLayout → MIN_STAVE_SPACING_PX 下限）
// が追従する。上限は 30→50（2026-07-27、運用者要望）→ 50→80（2026-08-23、運用者裁定a）。
// 80 の根拠: 月光級の深い音型（三連符が五線間の空きを 65〜70px 占有）+ 強弱記号の
// 五線間クランプ（#382）で、pp の字面ぶんを確保するには空き 95〜100px = オフセット
// 55〜60px が必要で、上限 50 ではわずかに届かなかった。80 なら空き 108px となり、
// スラーの膨らみ（#390）にも余裕が出る。
// 下限 −20 は「補正後も MIN_STAVE_SPACING_PX(=30) を下回らない」クランプと併せて、
// ピアノの右手/左手が音符ごと衝突しない安全圏に収めるための値なので据え置き。
// 上限を広げるとパート間隔ぶん段が高くなり、段数/ページ上限・編成譜の自動縮小fit
// （ensembleAutoFitMultiplier）も自動で追従する（README「パート間隔」の節を参照）。
export const PART_SPACING_OFFSET_MIN_PX = -20;
export const PART_SPACING_OFFSET_MAX_PX = 80;
export const PART_SPACING_OFFSET_DEFAULT_PX = 0;

// 「音符の大きさ」「段の間隔」「パート間隔」の楽譜種別ごとの工場出荷既定値（Issue #49・#199）。
// 単旋律・ピアノは大きめの表示（150%）を既定にし、見やすさを優先する。
// 弦楽四重奏・編成譜は従来どおり100%・0px・0pxのまま変えない
// （大編成は ensembleAutoFitMultiplier による自動縮小フォールバックと合成されるため、
// 既定を上げると縮小との相互作用が読みにくくなる）。
//
// ピアノ大譜表の2値は運用者の実測選定値。変遷:
//   #49: 段の間隔 +30px（右手/左手の対と次の段の対を見分けやすくする）
//   #199（2026-08-09）: −30px / +38px（「大譜表の内側を広げ、段どうしは詰める」浄書慣行寄り）
//   #596/#599（2026-09-03）: −3px / +20px ← 現行。市販譜（月光ほか）との見比べで、
//     −30 は詰まりすぎ・+38 は内側が広すぎた（#586「パート間隔狭くて段間隔広く見える」）
export const NOTATION_SIZE_MULTIPLIER_DEFAULT = 1;
export const NOTATION_SIZE_MULTIPLIER_LARGE_DEFAULT = 1.5;
export const SYSTEM_ROW_GAP_DEFAULT_PX = 0;
export const SYSTEM_ROW_GAP_PIANO_DEFAULT_PX = -3;
export const PART_SPACING_OFFSET_PIANO_DEFAULT_PX = 20;

/**
 * 楽譜種別ごとの「音符の大きさ」「段の間隔」「パート間隔」の工場出荷既定値を返す純関数。
 * ユーザーが該当のスライダーを一度も操作していない（localStorageに未保存の）ときだけ
 * 呼び出し側でこの値を適用する想定（ユーザーが明示的に保存した値は上書きしない）。
 */
export function resolveDefaultLayoutForScoreType(scoreType: ScoreType): {
  notationSizeMultiplier: number;
  systemRowGapPx: number;
  partSpacingOffsetPx: number;
} {
  const notationSizeMultiplier =
    scoreType === 'single' || scoreType === 'piano'
      ? NOTATION_SIZE_MULTIPLIER_LARGE_DEFAULT
      : NOTATION_SIZE_MULTIPLIER_DEFAULT;
  const systemRowGapPx = scoreType === 'piano' ? SYSTEM_ROW_GAP_PIANO_DEFAULT_PX : SYSTEM_ROW_GAP_DEFAULT_PX;
  const partSpacingOffsetPx =
    scoreType === 'piano' ? PART_SPACING_OFFSET_PIANO_DEFAULT_PX : PART_SPACING_OFFSET_DEFAULT_PX;
  return { notationSizeMultiplier, systemRowGapPx, partSpacingOffsetPx };
}

/** 保存データ由来の「音符の大きさ」倍率を、スライダーの範囲へ正規化する（Issue #477）。 */
export function normalizeNotationSizeMultiplier(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(NOTATION_SIZE_MULTIPLIER_MAX, n));
}

/** 作品の属性として保存されたページ余白（mm）。左右はスライダーが1本なので左右同値で持つ。 */
export interface SavedPageMargins {
  sideMm: number;
  topMm: number;
  bottomMm: number;
}

/**
 * 保存データ由来のページ余白を、スライダーの範囲へ正規化する（Issue #477）。
 * 壊れた値（数値でない・範囲外）が来ても画面を壊さないよう、項目ごとに既定値・
 * クランプへ倒す。
 */
export function normalizePageMargins(value: unknown, fallback: SavedPageMargins): SavedPageMargins {
  const raw = (value ?? {}) as Partial<SavedPageMargins>;
  const pick = (n: unknown, min: number, max: number, fb: number): number => {
    const v = typeof n === 'number' ? n : NaN;
    if (!Number.isFinite(v)) return fb;
    return Math.max(min, Math.min(max, v));
  };
  return {
    sideMm: pick(raw.sideMm, PAGE_MARGIN_SIDE_MIN_MM, PAGE_MARGIN_SIDE_MAX_MM, fallback.sideMm),
    topMm: pick(raw.topMm, PAGE_MARGIN_VERTICAL_MIN_MM, PAGE_MARGIN_VERTICAL_MAX_MM, fallback.topMm),
    bottomMm: pick(raw.bottomMm, PAGE_MARGIN_VERTICAL_MIN_MM, PAGE_MARGIN_VERTICAL_MAX_MM, fallback.bottomMm),
  };
}

/**
 * 紙幅に収まる最大の「音符の大きさ」倍率を求める（Issue #477 のフォールバック）。
 *
 * planEffectiveMeasuresPerSystem が返す minimumWidths は VexFlow の論理単位（倍率に
 * 依存しない値）なので、「いちばん広い小節 × SCORE_LAYOUT_RENDER_SCALE × 倍率」が
 * 本文幅に収まる、という一次不等式を解くだけで求められる。
 *
 * @param minimumWidths 各小節の最小幅（論理単位）
 * @param availableWidthPx 段の本文幅（px。worstCaseSystemContentBudget の値）
 * @param desiredMultiplier ユーザー（またはファイル）が望んだ倍率。これを超えて拡大はしない
 * @returns 収まる最大の倍率（5%刻み・スライダーの範囲へクランプ）。desiredMultiplier で
 *   すでに収まっていればそのまま返す
 */
export function fitNotationSizeMultiplier(
  minimumWidths: readonly number[],
  availableWidthPx: number,
  desiredMultiplier: number,
): number {
  const widest = minimumWidths.reduce((max, width) => (width > max ? width : max), 0);
  if (!(widest > 0) || !(availableWidthPx > 0)) return desiredMultiplier;
  const maxMultiplier = availableWidthPx / (widest * SCORE_LAYOUT_RENDER_SCALE);
  if (maxMultiplier >= desiredMultiplier) return desiredMultiplier;
  // 5%刻みで切り下げる（スライダーの刻みに合わせ、境界で溢れないよう必ず下側へ丸める）
  const stepped = Math.floor(maxMultiplier * 20) / 20;
  return Math.max(NOTATION_SIZE_MULTIPLIER_MIN, Math.min(desiredMultiplier, stepped));
}

export function printScoreAreaWidthPx(
  sideMarginMm: number = DEFAULT_PAGE_SIDE_MARGIN_MM,
  // 用紙の幅(mm)。用紙サイズ（A4/B4/A3・Issue #495）で本文幅が変わるため引数で受け取る。
  // 省略時は従来どおり A4（210mm）＝既存の呼び出しの結果は1pxも変わらない。
  pageWidthMmValue: number = DEFAULT_PAGE_WIDTH_MM,
): number {
  return (pageWidthMmValue - sideMarginMm * 2) * (96 / 25.4);
}

// 後方互換用の定数（既定余白14mm時の値）。新規コードは printScoreAreaWidthPx() を使うこと。
export const PRINT_SCORE_AREA_WIDTH_PX = printScoreAreaWidthPx();

// 編成譜（scoreType === 'ensemble'）の「1段あたりの実測高さ（px）」をパート数から
// 見積もる係数。以前は「10パート超は800px固定／以下は400px固定」という二値の
// ハードコードだったが、17パート編成（romantic-orchestra）で実測1384pxに対し
// 想定800pxと大きく乖離し、.print-page の overflow:hidden で下5パート（弦楽器）が
// まるごと消えるバグの原因になった（docs/qa/full-orchestra-test-findings.md
// フェーズB「発見事項1」参照）。
//
// 係数は「弦楽四重奏（4パート）の実測基準値 340px」と「romantic-orchestra
// （17パート）の実測値 1384px」の2点から求めた一次関数（1パートあたりの譜表高さ
// ENSEMBLE_PART_HEIGHT_PX ＋ 段全体の固定マージン ENSEMBLE_SYSTEM_OVERHEAD_PX）。
// 実測よりわずかに大きめに丸めており（4パートでちょうど340px、17パートで1393px
// ≒実測1384pxよりやや安全側）、maxSystemsPerPage 側の見積もりが「あふれない」
// 安全側になるようにしている。
export const ENSEMBLE_PART_HEIGHT_PX = 81;
export const ENSEMBLE_SYSTEM_OVERHEAD_PX = 16;

/**
 * 編成譜の「音符の大きさ100%」時・1段あたりの想定高さ（px）をパート数から計算する。
 * ScorePage.tsx の maxSystemsPerPage 計算・自動縮小判定の両方から参照する正本。
 *
 * この見積もり式は「段あたり81px」という一次関数で、旧パート間隔（80）を基準に
 * 校正されたもの。PianoSystemCanvas.tsx 側の実際のパート間隔（staveSpacingForPartCount）が
 * 変わっても自動では追従しないため、maxSystemsPerPage（何段まで許すかの上限）には
 * 使わない。用途は recommendedSystemsPerPage（初期表示の推奨段数）の見積もりに限定し、
 * 実際にページへ収まるかどうかの正確な判定は measuredSystemHeightPx()（実際の描画
 * レイアウト計算 computeLayout() を経由した実測値）で行う
 * （.claude/specs/page-layout-controls/design.md M-2 追補参照）。
 */
export function estimateEnsembleSystemHeightPx(partCount: number): number {
  const safeCount = Math.max(1, Math.floor(partCount));
  return ENSEMBLE_PART_HEIGHT_PX * safeCount + ENSEMBLE_SYSTEM_OVERHEAD_PX;
}

// ===== ここから段のレイアウト計算（元 PianoSystemCanvas.tsx から移設） =====
// 1システム（段）のY方向レイアウトは、以前は PianoSystemCanvas.tsx に閉じていたが、
// ScorePage.tsx 側の maxSystemsPerPage（段数/ページの上限）が「実測」を正とするには
// 同じ計算式を共有する必要があるため、ここ（レイアウト計算の正本を集約する
// measureLayoutUtils.ts）に移設した。PianoSystemCanvas.tsx はここから import し直し、
// 既存のテスト（PianoSystemCanvasPartSpacing.test.tsx）が壊れないよう同名で re-export する。
const FIRST_STAVE_Y = 20;
// 段と段の間隔（Y方向）。単旋律・ピアノ・弦楽四重奏（4パート以下）は見た目を変えないよう
// 従来値の80を維持する。編成譜（5パート以上）は市販オーケストラスコア並みの紙面効率にするため、
// 詰めた値を使う（Issue #29）。VexFlow の五線は line0〜line4 の4間隔＝40ネイティブ単位の高さなので、
// 60 にすると隣接パートとの間の余白が20単位（加線2本ぶん）残り、音符と衝突しない。
const STAVE_SPACING = 80; // 段と段の間隔（Y方向）。単旋律・ピアノ・弦楽四重奏用
const STAVE_SPACING_ENSEMBLE = 60; // 5パート以上の編成譜用（密な既定値）
const ENSEMBLE_DENSE_SPACING_MIN_PARTS = 5;
// パート間隔スライダー（Issue #90）で自動値をどこまで詰めても、ピアノ大譜表の
// 右手/左手のような隣接パートが窮屈にならないための下限（ネイティブ単位）。
export const MIN_STAVE_SPACING_PX = 30;
// テスト（PianoSystemCanvasPartSpacing.test.tsx）から直接検証できるよう export する。
export function staveSpacingForPartCount(n: number): number {
  return n >= ENSEMBLE_DENSE_SPACING_MIN_PARTS ? STAVE_SPACING_ENSEMBLE : STAVE_SPACING;
}
/**
 * partSpacingOffsetPx は「パート間隔」スライダー（レイアウトタブ、Issue #90）の値。
 * 自動計算した staveSpacingForPartCount への加算補正として、段内の全パート境界へ
 * 一律に適用する（layout-pipeline/design.md 不変条件I3「パート間隔が均一」を
 * 保つため、境界ごとの個別調整はしない）。MIN_STAVE_SPACING_PX を下回らないよう
 * クランプする。
 */
export function computeLayout(
  n: number,
  partSpacingOffsetPx: number = 0
): { staveYs: number[]; sysH: number; staveSpacing: number } {
  const staveSpacing = Math.max(MIN_STAVE_SPACING_PX, staveSpacingForPartCount(n) + partSpacingOffsetPx);
  const staveYs = Array.from({ length: n }, (_, i) => FIRST_STAVE_Y + i * staveSpacing);
  const sysH = FIRST_STAVE_Y + (n - 1) * staveSpacing + 60 + 20;
  return { staveYs, sysH, staveSpacing };
}

/**
 * 1段の実際の高さ（px）を、PianoSystemCanvas.tsx が実際に描画へ使う寸法計算
 * （computeLayout の sysH）から正確に換算する。「音符の大きさ100%」時の値を返す
 * （notationSizeMultiplier・ensembleAutoFitMultiplier は呼び出し側で乗じること）。
 *
 * sysH は VexFlow の論理座標（ctx.scale 適用前）での高さで、実際の描画は
 * PianoSystemCanvas.tsx が `renderer.resize(W, sysH * scale)` で SCORE_LAYOUT_RENDER_SCALE
 * 倍してから使う（PianoSystemCanvas.tsx の該当コメント参照）。maxSystemsPerPage 側でも
 * 同じ倍率を掛けることで、実際に画面・印刷に描かれるSVGの高さと一致した見積もりになる
 * （旧 estimateEnsembleSystemHeightPx はパート間隔の変更に追従しない固定係数だったため、
 * 段数/ページの上限が実際より厳しく頭打ちされる不具合の原因になっていた。Issue #38）。
 */
export function measuredSystemHeightPx(partCount: number, partSpacingOffsetPx: number = 0): number {
  const safeCount = Math.max(1, Math.floor(partCount));
  return computeLayout(safeCount, partSpacingOffsetPx).sysH * SCORE_LAYOUT_RENDER_SCALE;
}

/**
 * 段と段の間に「浄書として自然」な余白（px）としてあらかじめ見込む値。「音符の大きさ100%」時。
 *
 * measuredSystemHeightPx() は五線が実際に描かれる高さ（SVGの高さ）そのもので、段どうしの
 * 余白を含まない。これだけを予算で割ると「物理的に詰め込める最大段数」になり、市販譜のような
 * 行間が失われる。そこで初期表示の推奨段数（段数/ページの既定値）では、1段ぶんの高さに
 * この余白を足してから予算で割る。
 *
 * 値70pxは、単旋律の従来の見積もり定数114px（＝実測44px＋余白70px）に一致する。
 * かつて楽譜種別ごとに別々の固定値（単旋律114・ピアノ180・四重奏340・編成譜81×パート数+16）を
 * 使っていたが、これらは種別ごとに含む余白の量がばらばらで（四重奏は実測149.6pxに対し
 * 190pxもの余白、8パートの編成譜は実測228.8pxに対し435pxもの余白）、パート数が多い譜種ほど
 * 推奨段数が過剰に少なくなり、新規作成直後にページの下半分が空白になっていた（Issue #71）。
 * 「余白は段の中身の多さではなく音符の大きさで決まる」という浄書の原則にそろえ、
 * 全譜種で共通のこの1つの値に統一した（呼び出し側で notationSizeMultiplier を乗じる）。
 */
export const SYSTEM_BREATHING_ROOM_PX = 70;

/**
 * 初期表示の推奨段数を求めるときに使う「1段ぶんが占める高さ」（px、音符の大きさ100%時）。
 * 実際に描かれる高さ（measuredSystemHeightPx）＋段間の余白（SYSTEM_BREATHING_ROOM_PX）。
 */
export function recommendedSystemHeightPx(partCount: number, partSpacingOffsetPx: number = 0): number {
  return measuredSystemHeightPx(partCount, partSpacingOffsetPx) + SYSTEM_BREATHING_ROOM_PX;
}
// ===== ここまで段のレイアウト計算 =====

/**
 * 「1段の実際の高さが常にページ内に収まる」ことを保証するための自動縮小倍率を求める。
 *
 * 大編成（例: romantic-orchestra 17パート）では、音符の大きさ100%のままだと1段の
 * 高さがページの印字可能領域を超えてしまい、.print-page の overflow:hidden で
 * はみ出した下側のパートが画面・印刷の両方から消えてしまう（下5パートの弦楽器が
 * 消失するバグ）。出版譜でも大編成は小さめの浄書で組むのが通例なため、
 * 「1段がページに収まらない編成では自動的に縮小する」フォールバックを設ける。
 *
 * desiredMultiplier（ユーザーが「音符の大きさ」スライダーで選んだ希望倍率、既定1）を
 * 計算に含めるのが Issue #81 の要点: 以前は desiredMultiplier を考慮せず
 * `budget / systemHeightAt100Percent` だけで倍率を決めていたため、100%のときに
 * ちょうど収まるよう縮小した倍率が、希望倍率を165%等に上げても同じ縮小率のまま
 * 掛け算されるだけで、結果的に「100%×自動倍率」より大きなサイズになり
 * 紙からはみ出していた（希望サイズを上げるほど自動縮小の効果が薄れ、収まらなくなる
 * バグ）。desiredMultiplier で割ってから収まる倍率を出すことで、
 * `desiredMultiplier × 戻り値` の最終結果が常に「希望サイズ」と「収まる最大サイズ」の
 * 小さい方（= min(希望値, budget/自然高)）になるよう補正している。
 *
 * - 収まる場合（標準的な編成、または希望サイズが十分小さい場合）は 1.0 未満に
 *   ならない＝縮小しない（small/piano/quartet 等の従来サイズに影響しない）。
 * - 収まらない場合だけ、ちょうど収まる倍率まで自動的に縮める（ユーザー設定の
 *   notationSizeMultiplier をこれ以上は超えさせない上限として使う）。
 *
 * 大編成専用ではなく全譜種共通のロジックとして使う想定（呼び出し側で
 * `scoreType === 'ensemble'` 分岐を残さない）。単旋律・ピアノ・弦楽四重奏は
 * 1段の自然高がページ予算に対して十分小さいため、この関数を通しても常に 1.0 が
 * 返り、従来の見た目は変わらない。
 */
export function computeEnsembleAutoFitMultiplier(
  partCount: number,
  pageBudgetPx: number,
  desiredMultiplier: number = 1
): number {
  const systemHeightAt100Percent = estimateEnsembleSystemHeightPx(partCount);
  if (systemHeightAt100Percent <= 0 || pageBudgetPx <= 0 || desiredMultiplier <= 0) return 1;
  return Math.min(1, pageBudgetPx / (systemHeightAt100Percent * desiredMultiplier));
}

// 自動縮小がどれだけ働いても、記号が判読できないほど小さく（"豆粒"に）はしない
// ための絶対下限（Issue #81）。0.8（NOTATION_SIZE_MULTIPLIER_MIN、スライダーの最小値）
// より意図的に小さい値にしてある。理由: 大編成では「スライダーの最小値」より
// さらに縮めないとページに収まらないケースが普通にあり（例: 17パートは
// 自動縮小だけで約74%まで縮む＝スライダーの最小80%より小さい）、下限をスライダー
// 最小値と同じにすると「今まで収まっていた編成」まで収まらなくなってしまう。
export const MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER = 0.5;

/**
 * ユーザー希望倍率と自動縮小倍率（computeEnsembleAutoFitMultiplier の戻り値）を
 * 合成した、実際に描画へ使う「音符の大きさ」の実効倍率。
 * MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER を下回らないようクランプする
 * （下限でも収まらない場合は isNotationSizeStillOverflowing で警告する）。
 */
export function resolveEffectiveNotationSizeMultiplier(
  desiredMultiplier: number,
  autoFitMultiplier: number
): number {
  return Math.max(MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER, desiredMultiplier * autoFitMultiplier);
}

// fit計算で「ちょうど収まる」よう求めた倍率は budget / natural の割り算由来のため、
// 掛け戻すと浮動小数点の丸め誤差で budget をごくわずかに超える／下回ることがある
// （例: 17パートは実際には収まる境界ちょうどの編成なのに、丸め誤差で
// 「収まらない」と誤判定され警告が誤表示されていた）。実用上無視できる誤差は
// 「収まらない」と判定しないよう、比較にわずかな許容値を設ける。
const NOTATION_SIZE_OVERFLOW_EPSILON_PX = 1e-6;

/**
 * 実効倍率（下限クランプ後）でもなお1段の高さがページ予算を超えるかどうか。
 * 超える場合は「黙って豆粒にする」のではなく、呼び出し側で警告を表示する想定。
 */
export function isNotationSizeStillOverflowing(
  naturalHeightAt100PercentPx: number,
  effectiveNotationSizeMultiplier: number,
  pageBudgetPx: number
): boolean {
  if (naturalHeightAt100PercentPx <= 0 || pageBudgetPx <= 0) return false;
  return naturalHeightAt100PercentPx * effectiveNotationSizeMultiplier > pageBudgetPx + NOTATION_SIZE_OVERFLOW_EPSILON_PX;
}

/**
 * 段スロットの高さ(px)。App.css の `.score-area .system-stack > *` の
 * flex-basis 計算式（`calc((100% - (page-capacity - 1) * system-row-gap) * page-slot-ratio)`）
 * と同じ式（CSS 側を変更するときはこの関数も揃えること）。
 *
 * gapPx は「段の間隔」スライダーの値（-30〜30px）で、正負を問わず同じ式をそのまま使う。
 * gapPx が大きいほどスロットは線形に縮み、0 前後で式が切り替わることはない。
 */
export function systemRowSlotHeightPx(
  budgetPx: number,
  systemsPerPage: number,
  gapPx: number
): number {
  const n = Math.max(1, systemsPerPage);
  return (budgetPx - (n - 1) * gapPx) / n;
}

/**
 * 各段の上端Y座標(px)（.system-stack の上端を0とする）。
 * 段は固定スロット高で並び、2段目以降は margin-top として gapPx を1つずつ積む
 * （CSS の `.score-area .system-stack > * + * { margin-top: var(--system-row-gap) }` と対応）。
 * margin は負値を許容するため、gapPx が負でも別方式に切り替わらず連続に詰まる。
 */
export function systemRowTopOffsetsPx(
  budgetPx: number,
  systemsPerPage: number,
  gapPx: number
): number[] {
  const n = Math.max(1, systemsPerPage);
  const slotHeight = systemRowSlotHeightPx(budgetPx, n, gapPx);
  return Array.from({ length: n }, (_, i) => i * (slotHeight + gapPx));
}

/**
 * 楽器名がある最悪ケースでも、Canvas の alloc と一致する小節本文の物理幅。
 *
 * labelAreaWidth は「この譜面でパート名に取られる最大の左余白」。総譜1段目のフル名
 * （Issue #60）が長いと既定値（SYSTEM_MAX_LABEL_WIDTH）より広い余白が必要になるため、
 * 呼び出し側が実測値（instrumentLabelAreaWidthForScore）を渡せるようにしている。
 * ここと Canvas 側の labelW が食い違うと、計画より本文幅が狭くなって小節が右へはみ出す。
 */
export function worstCaseSystemContentBudget(
  sideMarginMm: number = DEFAULT_PAGE_SIDE_MARGIN_MM,
  labelAreaWidth: number = SYSTEM_MAX_LABEL_WIDTH,
  // 用紙の幅(mm)。用紙サイズ（Issue #495）で本文幅が変わるため引数で受け取る。
  // 省略時は従来どおり A4（210mm）。
  pageWidthMmValue: number = DEFAULT_PAGE_WIDTH_MM,
): number {
  const innerWidth = printScoreAreaWidthPx(sideMarginMm, pageWidthMmValue) - SYSTEM_PAGE_SIDE_PADDING * 2 - labelAreaWidth;
  return Math.max(1, innerWidth * SYSTEM_TARGET_FILL - SYSTEM_FIRST_CLEF_PADDING);
}

function accidentalCount(event: NoteEvent): number {
  // レイアウト計算は VexFlow の描画前に走る。編集中の途中データや旧形式の保存データでは
  // keys がまだ配列になっていないことがあるため、ここで空配列として扱って描画全体を止めない。
  const keys = Array.isArray(event.keys) ? event.keys : [];
  return keys.filter((key) => /^[a-g][#b]/i.test(key)).length;
}

function eventMinimumWidth(event: NoteEvent): number {
  const graceNotes = Array.isArray(event.graceNotes) ? event.graceNotes.length : 0;
  return EVENT_BASE_WIDTH
    + (FLAG_EXTRA_WIDTH[event.dur] ?? 0)
    + accidentalCount(event) * ACCIDENTAL_WIDTH
    + graceNotes * GRACE_NOTE_WIDTH;
}

/**
 * 小節の実描画に必要な最低横幅を見積もる。
 *
 * この値は均等配置の重み付けではなく「この幅より狭ければ改段する」判定専用。
 * 16分音符を1個あたり12px（符頭8px + ビーム等4px）確保することで、
 * VexFlow が実際に必要とする幅より小さく見積もって重なるのを防ぐ。
 */
export function measureMinimumContentWidth(measure?: MeasureData): number {
  const primaryEvents = getPrimaryVoiceEvents(measure);
  if (!primaryEvents.length) {
    return MIN_MEASURE_CONTENT_WIDTH;
  }

  const contentWidth = primaryEvents.reduce(
    (width, event) => width + eventMinimumWidth(event),
    measureSidePadding(),
  );
  const hasWhole = primaryEvents.some((event) => event.dur === '1');
  const hasHalf = primaryEvents.some((event) => event.dur === '2');

  if (hasWhole) {
    return Math.max(contentWidth, LONG_WHOLE_MIN_WIDTH);
  }
  if (hasHalf) {
    return Math.max(contentWidth, LONG_HALF_MIN_WIDTH);
  }
  return Math.max(contentWidth, MIN_MEASURE_CONTENT_WIDTH);
}

// 音価 → 拍数（4/4基準）。開始拍（オンセット）の計算に使う
const DURATION_BEATS: Record<NoteEvent['dur'], number> = {
  '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625,
};

/** イベントが占有する拍数（付点・連符込み） */
function eventOccupiedBeatsForLayout(event: NoteEvent): number {
  let beats = DURATION_BEATS[event.dur] ?? 1;
  if (event.dots === 1) beats *= 1.5;
  else if (event.dots === 2) beats *= 1.75;
  if (event.tuplet) beats *= event.tuplet.notesOccupied / event.tuplet.numNotes;
  return beats;
}

/**
 * 同じ小節位置にある複数パート（＋各パートの追加声部）をまとめて描画する場合の
 * 最低横幅を見積もる。
 *
 * 複数パートを1回の VexFlow Formatter で合同フォーマットすると、
 * 「同じ開始拍の音符は同じ列を共有し、異なる開始拍はそれぞれ独立した列になる」
 * ため、必要な横幅は各パート単体の最大値ではなく「開始拍の和集合」で決まる。
 * 例: 右手が3連符×2＋4分×2、左手が8分×8の小節は、単体ではどちらも8列だが、
 * 合同では開始拍がほとんど重ならず13列必要になる。
 * ここではその実挙動に合わせ、開始拍ごとに（その拍で始まるイベントの最大幅を
 * その列の幅として）合計する。
 */
export function combinedMeasureMinimumContentWidth(measures: (MeasureData | undefined)[]): number {
  // key: 開始拍を1/960拍単位へ丸めた整数（浮動小数の誤差で同じ拍が別列に割れるのを防ぐ）
  const columnWidths = new Map<number, number>();
  let hasWhole = false;
  let hasHalf = false;
  let hasAnyEvent = false;

  for (const measure of measures) {
    if (!measure) continue;
    // 主声部（正規 read）＋追加声部（voices[1] 以降）。voices[0] は主声部そのものなので除外
    const voiceEventLists: NoteEvent[][] = [getPrimaryVoiceEvents(measure)];
    if (Array.isArray(measure.voices)) {
      measure.voices.slice(1).forEach((voice) => {
        if (Array.isArray(voice?.events)) voiceEventLists.push(voice.events);
      });
    }
    for (const events of voiceEventLists) {
      let onsetBeats = 0;
      for (const event of events) {
        hasAnyEvent = true;
        if (event.dur === '1') hasWhole = true;
        if (event.dur === '2') hasHalf = true;
        const columnKey = Math.round(onsetBeats * 960);
        const width = eventMinimumWidth(event);
        columnWidths.set(columnKey, Math.max(columnWidths.get(columnKey) ?? 0, width));
        onsetBeats += eventOccupiedBeatsForLayout(event);
      }
    }
  }

  if (!hasAnyEvent) {
    return MIN_MEASURE_CONTENT_WIDTH;
  }
  let contentWidth = measureSidePadding();
  for (const width of columnWidths.values()) contentWidth += width;

  if (hasWhole) {
    return Math.max(contentWidth, LONG_WHOLE_MIN_WIDTH);
  }
  if (hasHalf) {
    return Math.max(contentWidth, LONG_HALF_MIN_WIDTH);
  }
  return Math.max(contentWidth, MIN_MEASURE_CONTENT_WIDTH);
}

const VEXFLOW_DURATION: Record<NoteEvent['dur'], string> = {
  '1': 'w', '2': 'h', '4': 'q', '8': '8', '16': '16', '32': '32', '64': '64',
};
// VexFlow の preCalculateMinTotalWidth は、SVG の実測前には臨時記号列の左張り出しを
// 小さく返す版がある。そのため実際に表示すると確定した記号だけ 1 列ぶんを安全確保する。
// 判定自体は下の本描画と共通の状態機械なので、調号内の # / b を二重計上しない。
const DISPLAYED_ACCIDENTAL_SAFE_WIDTH = 22;
const GRACE_GROUP_SAFE_WIDTH = 14;
export type MeasureLayoutPartContext = {
  /** 全小節を渡し、段頭でも本描画と同じ courtesy accidental を再現する。 */
  measures: MeasureData[];
  /** 調号変更の正本。多段譜では最上段パートが共有調号を保持する。 */
  keySignatureMeasures?: MeasureData[];
  clef: ClefType;
  /** 移調楽器など、パート固有の調号。省略時はスコア全体の調号を使う。 */
  keySignature?: KeySignature;
};

export type VexFlowMeasurementOptions = {
  measureIndex?: number;
  keySignature?: KeySignature;
  parts?: MeasureLayoutPartContext[];
  /** Planner が線形passで準備した状態。指定時は先頭からの再走査をしない。 */
  runtimeParts?: Array<{ clef: ClefType; accidentalState: MeasureAccidentalState; prevMeasureState?: MeasureAccidentalState }>;
};

function addRenderedModifiersForMeasurement(
  note: StaveNote,
  event: NoteEvent,
  accidentalState: MeasureAccidentalState,
  prevMeasureState?: MeasureAccidentalState,
): number {
  let safetyWidth = 0;
  // 文字列中の # / b を機械的に数えるのではなく、本描画と同じ状態機械で
  // 「この位置で実際に表示される」♯・♭・♮・courtesy accidental だけを付与する。
  resolveDisplayAccidentalsForKeys(event.keys, accidentalState, prevMeasureState).forEach((result, index) => {
    if (!result) return;
    const accidental = new Accidental(result.type);
    if (result.cautionary) (accidental as any).setAsCautionary?.();
    (note as any).addModifier?.(accidental, index);
    safetyWidth += DISPLAYED_ACCIDENTAL_SAFE_WIDTH;
  });
  event.microtones?.forEach(({ keyIndex, type }) => {
    if (keyIndex < 0 || keyIndex >= event.keys.length) return;
    (note as any).addModifier?.(new Accidental(microtoneAccidentalCode(type)), keyIndex);
    safetyWidth += DISPLAYED_ACCIDENTAL_SAFE_WIDTH;
  });
  if (event.graceNotes?.length) {
    const graceNotes = event.graceNotes.map((grace) => (
      new GraceNote({ keys: grace.keys, duration: '8', slash: grace.slash })
    ));
    (note as any).addModifier?.(new GraceNoteGroup(graceNotes), 0);
    safetyWidth += graceNotes.length * GRACE_GROUP_SAFE_WIDTH;
  }
  return safetyWidth;
}

function createMeasurementVoice(
  events: NoteEvent[],
  timeSignature: [number, number],
  clef: ClefType,
  accidentalState: MeasureAccidentalState,
  prevMeasureState?: MeasureAccidentalState,
): { voice: Voice; modifierSafetyWidth: number } | null {
  if (events.length === 0) return null;

  let modifierSafetyWidth = 0;
  const notes = events.map((event) => {
    const duration = VEXFLOW_DURATION[event.dur] ?? 'q';
    const isRest = event.isRest || !Array.isArray(event.keys) || event.keys.length === 0;
    const note = new StaveNote({
      clef,
      keys: isRest ? ['b/4'] : event.keys,
      duration: isRest ? `${duration}r` : duration,
      dots: vexFlowDotCount(event.dots),
    });
    // `dots` は tick 用、Dot は ModifierContext が必要幅へ付点の張り出しを反映するため。
    for (let dot = 0; dot < vexFlowDotCount(event.dots); dot += 1) {
      Dot.buildAndAttach([note], { all: true });
    }
    if (!isRest) modifierSafetyWidth += addRenderedModifiersForMeasurement(note, event, accidentalState, prevMeasureState);
    return note;
  });

  // Tuplet のコンストラクタが各音符へ tick 倍率を適用する。ここでも本描画と同じ順序を守る。
  createVexFlowTuplets(events, notes);
  const voice = new Voice({ time: { num_beats: timeSignature[0], beat_value: timeSignature[1] } } as any);
  voice.setMode((Voice as any).Mode.SOFT ?? 1);
  voice.addTickables(notes);
  return { voice, modifierSafetyWidth };
}

function measurementPartState(
  part: MeasureLayoutPartContext | undefined,
  measureIndex: number,
  fallbackKeySignature: KeySignature,
): { clef: ClefType; accidentalState: MeasureAccidentalState; prevMeasureState?: MeasureAccidentalState } {
  const measures = part?.measures ?? [];
  let previous: MeasureAccidentalState | undefined;
  // 本描画と同じく主声部だけを次小節の courtesy 判定へ引き継ぐ。
  for (let index = 0; index <= measureIndex; index += 1) {
    const globalKey = resolveMeasureKeySignature(part?.keySignatureMeasures ?? measures, index, fallbackKeySignature);
    // 移調パートは初期調号との差分（fifths）を途中調号変更にも同じように適用する。
    // ここは PianoSystemCanvas の stave 描画と同じ計算で、調号由来の natural まで一致させる。
    const shift = part?.keySignature
      ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(fallbackKeySignature)
      : 0;
    const effectiveKey = shift === 0 ? globalKey : shiftKeySignatureByFifths(globalKey, shift);
    if (index === measureIndex) {
      // 現小節は createMeasurementVoice がイベントごとに状態を更新するため、
      // ここでは調号で初期化した新しい state と前小節の snapshot だけを渡す。
      return { clef: part?.clef ?? 'treble', accidentalState: createMeasureAccidentalState(effectiveKey), prevMeasureState: previous };
    }
    const state = createMeasureAccidentalState(effectiveKey);
    const events = getPrimaryVoiceEvents(measures[index]);
    events.forEach((event) => {
      if (!event.isRest && Array.isArray(event.keys)) {
        resolveDisplayAccidentalsForKeys(event.keys, state, index === measureIndex ? previous : undefined);
      }
    });
    previous = snapshotAccidentalState(state);
  }
  return { clef: part?.clef ?? 'treble', accidentalState: createMeasureAccidentalState(fallbackKeySignature) };
}

// VexFlow の「理想的な音符間隔」を、浄書実務の最低幅へ換算する圧縮率（Issue #559）。
//
// preCalculateMinTotalWidth が返すのは Formatter が「ゆったり組むならこれくらい欲しい」と
// する理想幅であって、「これ以上詰めると読めなくなる」下限ではない。これをそのまま
// 「最低幅」として段割りの判定に使っていたため、月光（8分3連×4組・大譜表）のような密な
// 譜面が実ブラウザで1小節/段まで膨張していた。
//
// 値の決め方（Issue の仕様どおり「月光基準＝2小節/段が成立する値」を実ブラウザで測って選んだ）:
//   段の本文予算 833（論理単位・A4／余白14mm／音符の大きさ150%）に対し、月光1〜9小節の
//   最低幅は圧縮率ごとに次のようになった（実測は docs/qa/system-break-min-width/README.md）。
//     0.75 → 1,1,1,1,1,1,2,1 小節/段（ほぼ改善しない）
//     0.72 → 2,1,1,1,1,2,1
//     0.70 → 2,1,1,1,2,2
//     0.64 → 2,2,2,2,1 ← 全段が2小節（末尾の1は9小節の余り）。受入条件1を満たす最大の値
//   Issue 本文の「例: 0.7〜0.75」より強い圧縮になったのは、実際の段の予算が例の想定より
//   狭いため（パート名を描かないピアノ譜でも、段割りの計画は既定の楽器名の余白 74 を
//   見込んだままにしてある。ScorePage の instrumentLabelAreaWidth 参照。ここを 0 にすると
//   既存譜面の段割りが全部変わるので #559 では触っていない）。
//   なお 1音あたりの幅は 45 → 28.8 論理単位（150%表示で約19px）になる。浄書の実物
//   （月光: 145mm の段に2小節＝1音あたり約22px）よりやや詰まるが、これは月光の5〜6小節目の
//   ように「旋律と3連符の開始拍がずれて列が増える」小節まで2小節/段に収めるための値である。
//   最終値は運用者の目視で確定する前提なので、緩めたいときはこの1か所だけを上げればよい。
//
// 変遷: 0.64（#589・2026-09-03）→ **0.3**（運用者指示・2026-09-04）。運用者が dev の調整パネル
//   （#596）で月光検聴版（音符 150%・段の間隔 -60px・パート間隔 19px）を見ながら 0.4 → 0.3 と
//   詰めて「これでいい」と判断した値。符頭の重なりは下の実寸見積もり（combinedMeasureMinimumContentWidth）
//   が別に下限を張るので、この値を下げても符頭同士は重ならない（VexFlow の理想間隔を
//   どこまで無視するかだけが変わる）。見た目が詰まりすぎると感じたらここを上げる。
//
// 圧縮しても符頭が重ならないのは、段割りの計画（planEffectiveMeasuresPerSystem）が
// 「開始拍ごとの符頭・臨時記号の実寸を積んだ見積もり」（combinedMeasureMinimumContentWidth）
// との Math.max を取り、そちらを過密の下限ガードとして残しているため。
// 実ブラウザでも、修正前後で符頭の重なりが増えていないことを確認済み
// （docs/qa/system-break-min-width/README.md の「重なりの実測」）。
export const VEXFLOW_IDEAL_WIDTH_COMPRESSION = 0.3;

/**
 * VexFlow の理想幅（音符の並びのぶん）を、段割り判定に使う最低幅へ換算する。
 * 圧縮率を1か所に閉じ込めるための小さな関数で、テストからも同じ換算を参照する。
 */
export function engravingMinimumWidthFromIdeal(idealWidth: number): number {
  // dev 環境のみ #596 のチューニングページで上書きできる（本番は定数そのまま。
  // import.meta.env.DEV を呼び出し位置に置き、本番バンドルから devTuning ごと消す）
  return idealWidth * (import.meta.env.DEV
    ? devTuned('layout.compression', VEXFLOW_IDEAL_WIDTH_COMPRESSION)
    : VEXFLOW_IDEAL_WIDTH_COMPRESSION);
}

/**
 * 合同 Formatter が必要とする幅を VexFlow へ問い合わせ、段割り判定用の最低幅を返す。
 *
 * 既存の開始拍ベース推定は、編集中の不完全データでも安全に動くため残す。一方で、
 * ここで得られる値は付点、連符、和音、臨時記号の ModifierContext を含む実測値なので、
 * 取得できる場合は必ずこちらを優先して小節幅を決める。
 *
 * ただし VexFlow が返すのは「理想的な間隔」なので、そのままでは最低幅として広すぎる。
 * VEXFLOW_IDEAL_WIDTH_COMPRESSION で浄書実務の密度へ圧縮した値を返す（Issue #559）。
 */
export function vexFlowCombinedMeasureMinimumContentWidth(
  measures: (MeasureData | undefined)[],
  timeSignature: [number, number],
  options: VexFlowMeasurementOptions = {},
): number | undefined {
  try {
    const voices: Voice[] = [];
    let modifierSafetyWidth = 0;
    const measureIndex = options.measureIndex ?? 0;
    const fallbackKeySignature = options.keySignature ?? 'C';
    measures.forEach((measure, partIndex) => {
      if (!measure) return;
      const partState = options.runtimeParts?.[partIndex]
        ?? measurementPartState(options.parts?.[partIndex], measureIndex, fallbackKeySignature);
      const eventLists: NoteEvent[][] = [getPrimaryVoiceEvents(measure)];
      if (Array.isArray(measure.voices)) {
        measure.voices.slice(1).forEach((voice) => {
          if (Array.isArray(voice?.events)) eventLists.push(voice.events);
        });
      }
      eventLists.forEach((events, voiceIndex) => {
        const voice = createMeasurementVoice(
          events,
          timeSignature,
          partState.clef,
          partState.accidentalState,
          voiceIndex === 0 ? partState.prevMeasureState : undefined,
        );
        if (voice) {
          voices.push(voice.voice);
          modifierSafetyWidth += voice.modifierSafetyWidth;
        }
      });
    });
    if (voices.length === 0) return undefined;

    // 合同描画と同じく先に joinVoices して TickContext を共有する。
    // これを省くと、各 Voice が単独の列として計測され、右手・左手の拍が揃う実際の
    // Formatter より必要幅を小さく出すケースがある。
    const formatter = new Formatter().joinVoices(voices);
    const idealWidth = formatter.preCalculateMinTotalWidth(voices);
    return Number.isFinite(idealWidth)
      // preCalculateMinTotalWidth が返すのは「理想的な間隔」であって「これ以上詰めたら
      // 読めなくなる最低幅」ではない。そのまま最低幅として使うと段割りが広がりすぎるため、
      // 浄書実務の密度へ圧縮してから最低幅にする（Issue #559。下の定数のコメント参照）。
      // 圧縮するのは音符の並びのぶんだけで、小節の左右余白と記号の安全幅はそのまま足す。
      ? Math.ceil(engravingMinimumWidthFromIdeal(idealWidth) + measureSidePadding() + modifierSafetyWidth)
      : undefined;
  } catch {
    // 壊れた旧データや、声部間で合計拍数が一致しない編集中の状態では Formatter が例外を出す。
    // その間も編集を続けられるよう、呼び出し元は従来の安全な推定値へフォールバックする。
    return undefined;
  }
}

// 小節幅の「均し具合」。密な小節（音符が多く最低幅が大きい小節）の幅を、
// 段内の等分幅（equalShare = 段の使用可能幅 / 小節数）へどれだけ寄せるかを 0..1 で指定する。
//   0   = 各小節を最低必要幅どおりに配分（幅の差が最大。密な小節が段を独占しがち）
//   1   = 全小節を完全に等幅へ（差ゼロ。ただし密な小節は音符が横に詰まる）
//   0.5 = 中間（各小節の幅を、最低幅ベースの配分と等分幅のちょうど中間へ寄せる）
// ここを大きくすると小節幅は均等に近づくが、64分16連など極端に密な小節は
// 符頭が近づく（黒い塊に見えやすくなる）トレードオフがある。
// ※この値は「レイアウト」タブの「小節幅の均等さ」スライダーで画面から調節できる。
//   この定数はスライダー未設定時（初回起動など）の既定値として使われる。
export const MEASURE_WIDTH_EVENNESS = 0.5;

/**
 * 合同フォーマットした小節へ横幅を配る。
 *
 * 改段数は ScorePage がスコア全体で先に決める。この関数は「確定済みの段」にだけ
 * 余白を配るため、ここで勝手に縮小して衝突を隠すことはしない。
 */
export function allocateCombinedMeasureWidths(
  minimumWidths: number[],
  availableWidth: number,
  renderScale = SCORE_LAYOUT_RENDER_SCALE,
  // 通常は上の定数をそのまま使う。引数で上書きできるのはテストや将来の
  // 「段ごとに均し具合を変えたい」拡張に備えた口で、既定値は定数と同じ。
  evenness = MEASURE_WIDTH_EVENNESS,
): { contentWidths: number[]; doesFit: boolean } {
  const usableWidth = Math.max(1, availableWidth);
  // minWidth は VexFlow の論理幅。ctx.scale(s, s) で描く実Canvasでは minWidth*s が
  // 必要な物理幅になる。Stave には contentWidth/s を渡して論理幅を戻す。
  const physicalMinimumWidths = minimumWidths.map((width) => width * renderScale);
  const sumMin = physicalMinimumWidths.reduce((sum, width) => sum + width, 0);
  const measureCount = minimumWidths.length;
  // 通常の自動改段（planEffectiveMeasuresPerSystem / planSystemMeasureRanges の貪欲法）は
  // 必ず sumMin <= usableWidth になるよう段の小節数を選ぶため、ここに来る時点で
  // sumMin > usableWidth なのは「段ごとの小節数のユーザー上書き」で最低幅の合計が
  // 使用可能幅を超えたケースにほぼ限られる。フォントや五線の縦サイズ（renderScale）は
  // 変えず、小節へ配る幅だけを比例的に縮小して段の右端を他の段と揃える。
  // VexFlow の Formatter は与えられた幅へ詰め込む挙動なので、音符間隔が詰まるだけで
  // 描画自体は破綻しない（詰め込みすぎれば符頭同士が重なりうるが、それはユーザーが
  // 小節数を増やしすぎた場合の許容範囲として扱う）。
  const compressionRatio = sumMin > usableWidth && sumMin > 0 ? usableWidth / sumMin : 1;
  const workingWidths = compressionRatio === 1
    ? physicalMinimumWidths
    : physicalMinimumWidths.map((width) => width * compressionRatio);
  const workingSum = compressionRatio === 1 ? sumMin : usableWidth;
  const extra = Math.max(0, usableWidth - workingSum);
  // 余剰幅（extra）は各小節へまず「均等」に配る（baseWidths = 最低幅 + extra/n）。
  // 以前は最低幅に比例して配っていた（width + extra * width/sumMin）が、密な小節
  // （32分トレモロ・64分16連など、最低幅が大きい小節）ほど余剰も多く受け取り、
  // 幅の差が増幅されて「1小節が段幅の大半を占め、他の小節が窮屈」になっていた。
  const extraPerMeasure = measureCount > 0 ? extra / measureCount : 0;
  const baseWidths = workingWidths.map((width) => width + extraPerMeasure);
  // 比例圧縮でも usableWidth ちょうどに収まる（sumMin===0 の空段も自明に収まる）ため、
  // ここへ来た時点で常に fit している。data-layout-overflow は「圧縮してでも収めたら false」
  // という自然な扱いにする。
  const doesFit = true;
  // baseWidths の均等配分でも、密な小節は「最低幅そのもの」が大きいため差が残る。
  // その残差を MEASURE_WIDTH_EVENNESS で等分幅（equalShare）へ線形にブレンドして縮める。
  //   contentWidth = base + EVENNESS * (equalShare - base)
  // Σ baseWidths = Σ equalShare = usableWidth なので、ブレンド後も総和は usableWidth に
  // 保たれる（総和保存）。EVENNESS を上げると密な小節は最低幅を下回りうる（=符頭が
  // 詰まる）が、これは「詰めてでも均等に」という意図した挙動。
  const equalShare = measureCount > 0 ? usableWidth / measureCount : 0;
  return {
    contentWidths: baseWidths.map((width) => width + evenness * (equalShare - width)),
    doesFit,
  };
}

export type EffectiveMeasuresPerSystemPlan = {
  effectiveMeasuresPerSystem: number;
  /** 1小節でも最低倍率に収まらない場合だけ true。呼び出し側で警告できる。 */
  hasUnavoidableOverflow: boolean;
  /** ScorePage からCanvasへ渡す、小節ごとの安全幅込み論理幅。 */
  minimumWidths: number[];
};

export type SystemMeasureRange = {
  start: number;
  count: number;
  minimumWidths: number[];
  totalWidth: number;
  overflow: boolean;
};

/**
 * 小節幅は一度だけ計測し、現在位置から希望値以下で入る最大個数を貪欲に選ぶ。
 * range は絶対小節番号を保持するため、ページ境界でも小節の重複・欠落を起こさない。
 */
/** 「小節 startMeasure から始まる段は count 小節」というユーザー上書き。measureLayoutUtils 内での利用のみを想定した最小の型（storage.ts の SystemMeasureOverride と同じ形）。 */
export type SystemMeasureOverrideInput = { startMeasure: number; count: number };

export function planSystemMeasureRanges(
  minimumWidths: number[],
  requestedMeasuresPerSystem: number,
  availableWidth: number,
  /**
   * 指定した絶対小節インデックスで段を強制的に打ち切る（省略時は従来どおり）。
   * 「内容のある最後の小節（終止線が付く小節）」と「編集用の空きバッファ小節」が
   * 同じ段に混ざると、終止線が段の右端まで届かず余白が残ってしまうため、
   * ScorePage から contentMeasureCount を渡して段の境界をそこへ強制する用途を想定している。
   * breakAt がちょうど段の切れ目と一致する場合（例: 24小節ぴったりで4小節/段）は
   * 従来と同じ結果になり、既存のページ割りに影響しない。
   */
  breakAt?: number,
  /**
   * 段ごとの小節数のユーザー上書き（「段割りを個別調整」機能）。
   * start が上書きの startMeasure と一致する段はその count 小節を使い、最低幅の合計が
   * availableWidth を超えていても許容する（音符が詰まる／はみ出す可能性はユーザー判断に
   * 委ねる。totalWidth > availableWidth の場合は overflow=true を返すのでスコア側で
   * data-layout-overflow を付けられる）。上書きが無い start では従来どおりの貪欲法を使う。
   * 複数の上書きが同じ start を指す場合は配列の最後を優先する。
   */
  overrides?: SystemMeasureOverrideInput[],
  /**
   * 直前に計算された段割り（安定化のヒント。Issue #67）。
   *
   * lastEditedMeasureIndex より前で完結する段（start + count <= lastEditedMeasureIndex）
   * だけ、幅が変わっていても前回の count をそのまま再利用する。編集位置を含む段より後ろは
   * 前回の count を一切参照せず、常に通常の貪欲法で計画し直す。
   *
   * こうする理由: 「収まる限り常に再利用」という単純な安定化（旧 Issue #58 対応）は、
   * いま入力している段の小節数まで固定してしまい、「段が埋まるにつれて小節が詰まっていき、
   * 溢れたら次の段へ送られる」という組版の基本挙動を止めてしまう不具合を招いた（Issue #67）。
   * 編集位置より前の段だけを安定化対象にすることで、入力中の段は常に貪欲法の恩恵を受けつつ、
   * 触れていない前の段の境界は動かないようにする。
   */
  previousRanges?: SystemMeasureOverrideInput[],
  /** 最後に編集した小節の絶対インデックス（省略時は安定化を行わず常に貪欲法のみ）。 */
  lastEditedMeasureIndex?: number,
): SystemMeasureRange[] {
  const requested = Math.max(1, Math.floor(requestedMeasuresPerSystem));
  const overrideByStart = new Map<number, number>();
  overrides?.forEach(({ startMeasure, count }) => {
    if (Number.isInteger(startMeasure) && startMeasure >= 0 && Number.isInteger(count) && count >= 1) {
      overrideByStart.set(startMeasure, count);
    }
  });
  const previousCountByStart = new Map<number, number>();
  previousRanges?.forEach(({ startMeasure, count }) => {
    if (Number.isInteger(startMeasure) && startMeasure >= 0 && Number.isInteger(count) && count >= 1) {
      previousCountByStart.set(startMeasure, count);
    }
  });
  const stabilizeBeforeMeasure = Number.isInteger(lastEditedMeasureIndex) && (lastEditedMeasureIndex as number) >= 0
    ? (lastEditedMeasureIndex as number)
    : undefined;
  const ranges: SystemMeasureRange[] = [];
  for (let start = 0; start < minimumWidths.length;) {
    const overrideCount = overrideByStart.get(start);
    if (overrideCount != null) {
      // ユーザー上書き: 残り小節数までにクランプするだけで、幅超過チェックはしない
      // （はみ出しはユーザーの意図した挙動として許容する）。
      const count = Math.min(overrideCount, minimumWidths.length - start);
      const widths = minimumWidths.slice(start, start + count);
      const totalWidth = widths.reduce((sum, width) => sum + width, 0);
      ranges.push({ start, count, minimumWidths: widths, totalWidth, overflow: totalWidth > availableWidth });
      start += count;
      continue;
    }
    const previousCount = previousCountByStart.get(start);
    if (
      previousCount != null
      && stabilizeBeforeMeasure != null
      && start + previousCount <= stabilizeBeforeMeasure
      // breakAt をまたぐ場合は前回の count をそのまま使えない（内容小節数が変わった＝
      // 新しい段が必要になったケースなので、下の貪欲法へフォールバックさせる）。
      && !(breakAt != null && breakAt > start && breakAt < start + previousCount)
    ) {
      const count = Math.min(previousCount, minimumWidths.length - start);
      if (count === previousCount) {
        const widths = minimumWidths.slice(start, start + count);
        const totalWidth = widths.reduce((sum, width) => sum + width, 0);
        // 編集位置より前なので通常は幅が変わっておらず必ず収まるはずだが、
        // ページ余白や音符サイズ全体の設定変更で availableWidth 側が変わることもあるため、
        // 念のため収まることを確認してから再利用する（収まらなければ下の貪欲法へ委ねる）。
        if (totalWidth <= availableWidth) {
          ranges.push({ start, count, minimumWidths: widths, totalWidth, overflow: false });
          start += count;
          continue;
        }
      }
    }
    let maxCount = Math.min(requested, minimumWidths.length - start);
    if (breakAt != null && breakAt > start && breakAt < start + maxCount) {
      maxCount = breakAt - start;
    }
    let count = maxCount;
    while (count > 1 && minimumWidths.slice(start, start + count).reduce((sum, width) => sum + width, 0) > availableWidth) {
      count -= 1;
    }
    const widths = minimumWidths.slice(start, start + count);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    ranges.push({ start, count, minimumWidths: widths, totalWidth, overflow: totalWidth > availableWidth });
    start += count;
  }
  return ranges;
}

/** 保存される編集枠と実データの末尾、両方を失わない段数へ換算する。 */
export function effectiveSystemCount(
  totalSystemsBefore: number,
  requestedMeasuresPerSystem: number,
  effectiveMeasuresPerSystem: number,
  contentMeasureCount: number,
): number {
  const effective = Math.max(1, effectiveMeasuresPerSystem);
  const editingCapacity = Math.max(1, totalSystemsBefore) * Math.max(1, requestedMeasuresPerSystem);
  return Math.max(
    Math.ceil(editingCapacity / effective),
    Math.ceil(Math.max(0, contentMeasureCount) / effective),
  );
}

export type MeasurePlannerSafetyOptions = {
  /**
   * true のときだけ「和音の全キーが臨時記号になる最悪ケース」を確保する。
   * これは Ensemble の記譜音表示専用の対策で、この計画段階では移調前データを渡すため、
   * 実際に描画される時点で初めて臨時記号が増える可能性があるための安全マージン。
   * ピアノ・四重奏など移調をしないパートでは vexFlowCombinedMeasureMinimumContentWidth が
   * 実際に表示される臨時記号だけを既に正確に加算しているため、ここで重ねて足すと
   * 小節の最低幅を過大評価し、1段に入る小節数が不当に減ってしまう。
   */
  includeTranspositionAccidentalWorstCase?: boolean;
};

/**
 * その小節に含まれる「小節途中のクレフ変更」の件数（Issue #424）。
 * 主声部にだけ付けられる約束なので、主声部のイベントだけを数える。
 */
function countMidMeasureClefChanges(measure: MeasureData): number {
  return getPrimaryVoiceEvents(measure).filter((event) => !!event.clefChange).length;
}

export function measurePlannerSafetyPadding(
  measures: (MeasureData | undefined)[],
  options: MeasurePlannerSafetyOptions = {},
): number {
  let padding = 0;
  measures.forEach((measure) => {
    if (!measure) return;
    if (options.includeTranspositionAccidentalWorstCase) {
      const voices = [getPrimaryVoiceEvents(measure), ...(measure.voices?.slice(1).map((voice) => voice.events ?? []) ?? [])];
      voices.forEach((events) => events.forEach((event) => {
        if (!event.isRest) padding += (event.keys?.length ?? 0) * 10;
      }));
    }
    // microtones・grace notes は vexFlowCombinedMeasureMinimumContentWidth 側の
    // modifierSafetyWidth で既に実測込みで加算済みのため、ここでは重複計上しない。
    // 段内の途中調号・途中clef・途中拍子は Canvas のstave開始modifierも幅を使う。
    if (measure.keySignature) padding += 42;
    if (measure.clef) padding += 28;
    if (measure.timeSignature) padding += 30;
    // 小節途中のクレフ変更（Issue #424）は、音符の並びの中に小型クレフ（ClefNote）が
    // 1つ増えるぶんだけ幅を食う。ここで見込まないと、途中変更のある小節だけ
    // 音符が詰まって重なる。小型は本来もう少し細いが、足りないより広い側で丸める。
    padding += countMidMeasureClefChanges(measure) * 28;
  });
  return padding;
}

/**
 * 固定 startMeasureIndex のラッパー群を壊さないため、段ごとではなくスコア全体で
 * 同じ小節数を選ぶ。指定値から 4→3→2→1 と下げ、各連続グループが印刷最小倍率で
 * 入る最大値を返す。これにより次ページの開始小節も常に `systemIndex * count` で決まる。
 */
export function planEffectiveMeasuresPerSystem(
  parts: MeasureLayoutPartContext[],
  timeSignature: [number, number],
  keySignature: KeySignature,
  requestedMeasuresPerSystem: number,
  availableWidth: number,
  renderScale = SCORE_LAYOUT_RENDER_SCALE,
  safetyOptions: MeasurePlannerSafetyOptions = {},
): EffectiveMeasuresPerSystemPlan {
  const requested = Math.max(1, Math.floor(requestedMeasuresPerSystem));
  const measureCount = Math.max(0, ...parts.map((part) => part.measures.length));
  // 状態は先頭から1回だけ前進させる。vexFlowCombined... の通常経路が持つ
  // measureIndexまでの再走査を避け、長い譜面でも VexFlow 計測回数を小節数に抑える。
  let runningGlobalKey = keySignature;
  const runningClefs = parts.map((part) => part.clef);
  const previousStates: Array<MeasureAccidentalState | undefined> = parts.map(() => undefined);
  // VexFlow を呼ぶのは各小節につき1回だけ。候補 4→3→2→1 はこの配列の prefix sum を
  // 参照するだけにし、長い譜面を候補ごとに再フォーマットしない。
  const physicalWidths = Array.from({ length: measureCount }, (_, index) => {
    const measures = parts.map((part) => part.measures[index]);
    const keyMeasure = parts[0]?.keySignatureMeasures?.[index] ?? parts[0]?.measures[index];
    if (keyMeasure?.keySignature) runningGlobalKey = keyMeasure.keySignature;
    const runtimeParts = parts.map((part, partIndex) => {
      const current = part.measures[index];
      if (current?.clef) runningClefs[partIndex] = current.clef;
      // 小節途中の変更（Issue #424）は「その小節の末尾時点」の値として次の小節へ引き継ぐ。
      // 引き継がないと、途中でヘ音記号へ変えた次の小節の幅を古いクレフで測ってしまう。
      const clefAtMeasureStart = runningClefs[partIndex];
      runningClefs[partIndex] = resolveClefAtMeasureEnd(getPrimaryVoiceEvents(current), clefAtMeasureStart);
      const shift = part.keySignature
        ? getKeySignatureFifths(part.keySignature) - getKeySignatureFifths(keySignature)
        : 0;
      const effectiveKey = shift === 0 ? runningGlobalKey : shiftKeySignatureByFifths(runningGlobalKey, shift);
      return {
        // この小節を測るのは「先頭時点」のクレフ（途中変更は上で次の小節へ渡す）
        clef: clefAtMeasureStart,
        accidentalState: createMeasureAccidentalState(effectiveKey),
        prevMeasureState: previousStates[partIndex],
      };
    });
    const estimated = combinedMeasureMinimumContentWidth(measures);
    const measured = vexFlowCombinedMeasureMinimumContentWidth(measures, timeSignature, {
      measureIndex: index,
      keySignature,
      parts,
      runtimeParts,
    });
    // 本描画と同じく主声部だけを次小節のcourtesy用snapshotへ引き継ぐ。
    runtimeParts.forEach((runtime, partIndex) => {
      const events = getPrimaryVoiceEvents(parts[partIndex].measures[index]);
      events.forEach((event) => {
        if (!event.isRest && Array.isArray(event.keys)) {
          resolveDisplayAccidentalsForKeys(event.keys, runtime.accidentalState);
        }
      });
      previousStates[partIndex] = snapshotAccidentalState(runtime.accidentalState);
    });
    return (Math.max(estimated, measured ?? 0) + measurePlannerSafetyPadding(measures, safetyOptions)) * renderScale;
  });
  const prefixSums = [0];
  physicalWidths.forEach((width) => prefixSums.push(prefixSums[prefixSums.length - 1] + width));

  for (let candidate = requested; candidate >= 1; candidate -= 1) {
    let fits = true;
    for (let start = 0; start < measureCount; start += candidate) {
      const end = Math.min(start + candidate, measureCount);
      const required = prefixSums[end] - prefixSums[start];
      if (required > availableWidth) {
        fits = false;
        break;
      }
    }
    if (fits) return {
      effectiveMeasuresPerSystem: candidate,
      hasUnavoidableOverflow: false,
      minimumWidths: physicalWidths.map((width) => width / renderScale),
    };
  }
  return {
    effectiveMeasuresPerSystem: 1,
    hasUnavoidableOverflow: measureCount > 0,
    minimumWidths: physicalWidths.map((width) => width / renderScale),
  };
}
