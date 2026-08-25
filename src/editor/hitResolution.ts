// src/editor/hitResolution.ts
// クリック座標の解決（ヒット幾何・座標変換・選択判定）の純関数モジュール（#244 段3b）。
//
// PianoSystemCanvas に散在していた「クリック→(パート, 声部, 対象)」解決の純粋な部分を
// ここへ物理移設した。狙いは3つ:
//   1. 7,400行のコンポーネントから、閉包に依存しない層を分離する（責務分離 段3）
//   2. 判定式の実装を1か所にし、click / hover / 巡回 / 非アクティブ声部で食い違わせない
//   3. resolveNoteHitGeometry に**帰属ポリシー（HitAttributionPolicy）の入力**を明示し、
//      #316（編集レイヤー明示選択）が policy の実装追加だけで差し込める継ぎ目を作る
//
// このファイルの関数はすべて「入力→出力」の純関数（DOM読み取りはあるが書き込みしない）。
// React state・reducer・setter には一切触れない。
import type { Stave } from 'vexflow';

/**
 * クリックの帰属ポリシー（設計メモ§2-3）。
 *
 * **現段階では 'band'（帯域推測）のみ**。'explicitLayer'（#316）はこの union に
 * `{ attribution: 'explicitLayer'; activeLayer: HitAttribution }` を追加し、
 * resolveHitAttribution の分岐を実装して差し替える。
 */
export type HitAttributionPolicy = { attribution: 'band' };

/** クリックが「どのパート・どの声部への操作か」の解決結果 */
export type HitAttribution = { partIndex: number; voiceIndex: number };

/**
 * 帰属解決の唯一の入口（#244 段3c で新設。段3b の Codex レビューで
 * 「幾何計算に policy を渡すだけでは #316 の差し込み口にならない」と指摘された箇所）。
 *
 * クリックハンドラは、操作の対象（setSelected / イベント書き換えに使うパート・声部）を
 * 必ずこの関数の返り値から取る。'band' は従来どおり「クリックした帯のパート +
 * アクティブ声部」をそのまま返す（挙動ゼロ差）。
 *
 * #316（'explicitLayer'）実装時の注意: 帰属を差し替えるだけでは足りず、クリック候補の
 * イベント列（現状はアクティブ声部の activeEvs から hit rect を生成）も選択レイヤー由来へ
 * 切り替える必要がある（設計メモ§2-3・段3b 実装記録）。この関数はその際の分岐点になる。
 */
export function resolveHitAttribution(
  policy: HitAttributionPolicy,
  bandAttribution: HitAttribution,
): HitAttribution {
  switch (policy.attribution) {
    case 'band':
      return bandAttribution;
  }
}

/**
 * 音符クリックのモード分岐テーブルの結果型（設計メモ§2-3 の3値判別 union。#244 段3c）。
 *
 * - handled: この分岐がクリックを消費した（状態変更あり／「意図して何もしない」の両方。
 *   後者は 段3a の tie/hairpin と同じ扱いで、必ず理由コメントを添える）
 * - rejected: クリックを消費し、理由と次の一手をユーザーへ通知する（#318「行き止まりは喋る」）。
 *   notice は scoreEditorNotices の describe* が組み立てた文面で、呼び出し側が機械的に
 *   notifyScoreEdit へ渡す。無言の行き止まりはこの型では書けない
 * - passThrough: このモードはクリックを消費せず、既定の対象種別処理（音符=選択/和音追加/挿入、
 *   休符=貼り付け/置換/選択/挿入）へ続ける
 */
export type NoteClickOutcome =
  | { kind: 'handled' }
  | { kind: 'rejected'; notice: string }
  | { kind: 'passThrough' };

/** 幾何計算が音符イベントから読む最小の形（ストレージ型に依存しないための構造的部分型） */
export type HitEventLike = {
  isRest?: boolean;
  keys?: string[];
  renderStaff?: 'below' | 'above';
};

/* ===== ヒット領域 ===== */
export const CELL_PAD = 6, HIT_MIN_W = 14;
// 音符セルのクリック可能幅は、描画ループ内で
//   前後の音符との中間点 + CELL_PAD
// から作る透明な .vf-note-hit rect です。青い選択枠は表示専用なので、
// クリックしづらい/隣に吸われる場合は CELL_PAD と HIT_MIN_W を調整してください。
// 符頭の左端から左右に加えるパディング（px）。この範囲内のクリックが和音追加ゾーン。
// 隣の音符を置きたいクリックが和音追加に吸われないよう、従来値 15px の 10% に抑える。
export const CHORD_HIT_PAD = 1.5;
// 2声部小節で、非アクティブ声部の音符を淡色表示するときの色。
// 印刷時は App.css 側の @media print で svg path/line を強制的に #000 に戻す（紙面では常に黒）。
export const INACTIVE_VOICE_COLOR = '#9ca3af';
// UI案A2（Issue #405 段3）で、アクティブなレイヤーの五線の背後に敷く帯の色。
// 「いまどの手を編集しているか」を譜面から目を離さずに分かるようにするための表示。
// 五線・音符より先に描くので、薄い水色（不透明度の低い青）にして線を邪魔しない。
// 2026-08-25 実機所感「現状との違いが分からない」を受けて 0.08 → 0.16 に強めた。
// まだ弱ければここだけ上げればよい
export const ACTIVE_LAYER_BAND_COLOR = 'rgba(37, 99, 235, 0.16)';
// 色帯を五線の上下へどれだけはみ出させるか（px・SVG内部座標）。
// 五線の高さ（線0〜線4）ちょうどだと帯の縁が最上線・最下線と重なって
// 「線が太くなった」ように見えるので、少しだけ外へ広げる。
export const ACTIVE_LAYER_BAND_PAD = 6;
// UI案A2で、非アクティブなレイヤーの記号（強弱・アーティキュレーション等）に掛ける不透明度。
// 音符は INACTIVE_VOICE_COLOR で色を差し替えるが、記号は種類ごとに色が違う
// （黒い文字・青い矢印など）ため、色を上書きせず薄くする方式にそろえている。
export const INACTIVE_LAYER_SYMBOL_OPACITY = 0.35;
// 和音追加のY判定は「五線 ± 3加線」の固定範囲
export const CHORD_LEDGER_TOP = -3; // 上方向の加線数（マイナス = 上）
export const CHORD_LEDGER_BOT = 7;  // 下方向（ライン5〜7 = 3本の加線）

export const KEY_SELECT_LINE_EPS = 0.001;

// 画面表示のズームを変えても常に「画面上で狙った px 分」の許容幅になるようにする。
export const KEY_SELECT_X_PAD_SCREEN_PX = 12;

// KEY_SELECT_X_PAD_SCREEN_PX（画面px基準）を、svg から実測した実効スケールのもとでの
// raw 座標（SVG内部座標）のパディング量に変換する。
// getRawPerScreenPx は「画面1pxが何raw単位に相当するか」を返すので、
// そのまま画面px基準の値に掛けるだけでよい（割り算ではない点に注意）。
export function keySelectXPad(svg: SVGSVGElement): number {
  return KEY_SELECT_X_PAD_SCREEN_PX * getRawPerScreenPx(svg);
}

export const EXTRA_TOP = 4, EXTRA_BOTTOM = 6;

// クリックYを五線の「線／間」（0.5ライン刻み）へ丸める。
// minLine / maxLine は丸め先の候補範囲。省略時は音符を新しく置ける範囲
// （五線 ± EXTRA_TOP / EXTRA_BOTTOM）で、これが従来からの挙動。
// 既存の符頭を選択できるかの判定だけは、その音符が実際にいる線まで候補を
// 広げて呼ぶ（Issue #218。詳しくは noteHitLineRange のコメント参照）。
export function snapLine(stave: Stave, y: number, minLine: number = -EXTRA_TOP, maxLine: number = 4+EXTRA_BOTTOM): number {
  const topY=stave.getYForLine(0);
  const sp=(stave.getSpacingBetweenLines?.() as number)||((stave.getYForLine(4)-topY)/4);
  let best=minLine, minD=Infinity;
  for(let l=minLine;l<=maxLine;l+=0.5){
    const d=Math.abs(y-(topY+l*sp));
    if(d<minD){minD=d;best=Math.round(l*2)/2;}
  }
  return best;
}

// この音符イベントの符頭が「五線の何ライン目から何ライン目までにいるか」を返す。
// 和音なら一番上の音と一番下の音の線。keys が空・不正なときは null。
//
// 従来、当たり判定と選択判定はどちらも「五線 ± 3加線」（CHORD_LEDGER_TOP / BOT）の
// 固定範囲だけを見ていたため、そこより外にいる音符（ヘ音記号の g/4＝line -3 や、
// ト音記号の下の極低音など）は符頭の中心を正確にクリックしても選択できず、
// Delete も矢印キーでの音高修正もできなかった（Issue #218。符頭の半分が判定範囲の
// 外にはみ出すため）。この値を使って、そういう音符のときだけ範囲を広げる。
export function noteKeyLineExtent(
  keys: string[],
  keyToLineFn: (k: string) => number
): { minLine: number; maxLine: number } | null {
  let minLine = Infinity;
  let maxLine = -Infinity;
  for (const key of keys) {
    const line = keyToLineFn(key);
    if (!Number.isFinite(line)) continue;
    if (line < minLine) minLine = line;
    if (line > maxLine) maxLine = line;
  }
  return Number.isFinite(minLine) ? { minLine, maxLine } : null;
}

/* ===== SVG座標変換（Safari対応） ===== */
export function getAccumulatedCSSZoom(el: Element): number {
  const wrapper = el.closest('.page-wrapper');
  if (wrapper) {
    const v = parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--scale').trim());
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}

// findNearestKey の index 版。localY から maxLines（ライン単位）以内にある
// 最寄りの構成音の index を返す。範囲内に無ければ -1。
//
// 用途: 固定範囲（五線±3加線）の外にいる音符の選択判定。あの帯は挿入も和音追加も
// しない（隣のパートと重なりうるため）ので、従来の「線ちょうど（±0.25ライン
// ＝100%ズームで約2.5px）だけ選択」だと実質クリック不能だった（実機テストで
// 「スラーの下の低音が選択できない」として発覚）。何も起きない帯に限って
// 吸い寄せを効かせるので、音符の追加位置がずれる副作用はない。
export const OUTER_KEY_SELECT_MAX_LINES = 1.0;

// 五線の中（＝和音追加が起きる帯）で、既存の構成音へ吸い寄せる許容幅（ライン単位）。
//
// 用途: 2度でぶつかる和音（例 [e/4, f#/4]）の上の音は符幹の右へずらして描かれ、
// 実機テスト（Issue #271・月光2小節目）で「狙っても選択できない」と報告された。
// 従来、五線内で個別選択が成立するのはクリックYを 0.5 ライン刻みへ丸めた結果が
// その音の線と一致したときだけ＝実質「線ちょうど ±0.25 ライン」（100%ズームで
// 約2.4px）で、そこを外すと和音追加（調号適用で G→G# など）になり、
// 何が起きたのか分かりにくかった。
//
// 運用者裁定（案A・選択優先）: 和音追加は「離れた所に置いて矢印キーで近づける」
// 回避手段があるが、選択できない場合の回避手段が無い。そこで符頭のX範囲内に限り
// 選択を優先する。値をライン単位で持つのは、五線が拡大縮小しても「見た目に対する
// 許容幅」が一定に保たれるため（raw 単位の定数にすると編成譜や画面ズームで
// 画面px換算の幅がズレる。keySelectXPad と同じ考え方）。
//
// 0.5 未満にしてあるのは、隣の線／間（＝0.5 ライン離れた位置）を狙ったクリックが
// 吸い寄せられて和音追加できなくならないようにするため。
export const INNER_KEY_SELECT_MAX_LINES = 0.3;
export function findNearestKeyIndexWithinLines(
  keys: string[], localY: number, stave: Stave,
  keyToLineFn: (k: string) => number, maxLines: number
): number {
  const topY = stave.getYForLine(0);
  const sp = (stave.getSpacingBetweenLines?.() as number) || ((stave.getYForLine(4) - topY) / 4);
  let bestIdx = -1;
  let bestDist = Infinity;
  keys.forEach((key, idx) => {
    const dist = Math.abs(localY - stave.getYForLine(keyToLineFn(key)));
    if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
  });
  return bestDist <= maxLines * sp ? bestIdx : -1;
}

export function findKeyIndexAtLine(
  keys: string[],
  snappedLine: number,
  keyToLineFn: (k: string) => number
): number {
  // 個別音選択の判定。クリックYを snapLine() で五線の「線/間」に丸め、
  // そのライン番号と keys[] の音高ラインが一致するかを見ます。
  // ここを甘くすると隣の音を誤選択しやすくなるので、基本は小さい値にしています。
  return keys.findIndex((key) => Math.abs(keyToLineFn(key) - snappedLine) < KEY_SELECT_LINE_EPS);
}

export function getSvgVisualMetrics(svg: SVGSVGElement): {
  vbW: number; vbH: number; visualW: number; visualH: number; originLeft: number; originTop: number;
} {
  const svgRect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox?.baseVal;
  // width/height の baseVal は「SVG がまだレイアウトされていない」状況では読めないことがある
  // （テスト環境の jsdom、および描画中に自分で呼ぶ場合）。読めないときは 0 を返し、
  // 下の visualW/H が 0 になる → 呼び出し側（getRawPerScreenPx / clientToGroup）の
  // ガードで安全な既定値へ落ちるようにする（例外で描画ごと止めない）。
  const logW = svg.width?.baseVal?.value ?? 0;
  const logH = svg.height?.baseVal?.value ?? 0;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : logW;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : logH;

  const cssZoom = getAccumulatedCSSZoom(svg);
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  let originLeft = svgRect.left;
  let originTop  = svgRect.top;
  if (!bcrReflectsZoom) {
    const zoomContainer = svg.closest('.page-wrapper');
    if (zoomContainer) {
      const cr = zoomContainer.getBoundingClientRect();
      originLeft = cr.left + (svgRect.left - cr.left) * cssZoom;
      originTop  = cr.top  + (svgRect.top  - cr.top)  * cssZoom;
    }
  }

  return { vbW, vbH, visualW, visualH, originLeft, originTop };
}

// 画面px 1px あたりの raw 単位（SVG内部座標）の大きさ。
// keySelectXPad など「画面px基準のパディングを raw 単位に変換したい」箇所で使う。
// VexFlow の requestedScale（s）だけでなく、.page-wrapper の CSSズームも含めた
// 実測ベースの値なので、ズーム倍率に関わらず常に「画面上で狙った px 分」の判定になる。
export function getRawPerScreenPx(svg: SVGSVGElement): number {
  const { vbW, visualW } = getSvgVisualMetrics(svg);
  if (!visualW || !isFinite(vbW / visualW)) return 1;
  return vbW / visualW;
}

// 描画の途中（レイアウト確定前）や、SVG の寸法プロパティを持たない環境（jsdom）でも
// 描画そのものを止めないための入口。読めなければ「1px = 1raw」として扱う。
// クリック時に呼ぶぶんには getRawPerScreenPx を直接使ってよい（要素は必ず配置済みのため）。
export function getRawPerScreenPxSafe(svg: SVGSVGElement): number {
  try {
    return getRawPerScreenPx(svg);
  } catch {
    return 1;
  }
}

export function clientToGroup(svg: SVGSVGElement, _group: SVGGElement, cx: number, cy: number): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const { vbW, vbH, visualW, visualH, originLeft, originTop } = getSvgVisualMetrics(svg);

  const x = (cx - originLeft) * (vbW / visualW);
  const y = (cy - originTop)  * (vbH / visualH);
  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}

/** VexFlow StaveNote から幾何計算が読む最小の形 */
type HitNoteLike = {
  getBoundingBox?: () => {
    getX?: () => number; getY?: () => number; getW?: () => number; getH?: () => number;
  } | undefined;
};

/** resolveNoteHitGeometry に渡す、パート×小節スコープの文脈（閉包の明示化） */
export interface NoteHitGeometryContext {
  svg: SVGSVGElement;
  /** このパート自身の五線 */
  stave: Stave;
  /** このパートの帯域（隣のパートとの中間線。#219 のクリップ境界） */
  band: { top: number; bot: number };
  measLeft: number;
  measRight: number;
  partIndex: number;
  /**
   * クリック帰属ポリシー（現行 'band' のみ）。この関数自体は幾何計算であり policy で
   * 分岐しないが、文脈として受け取り続けることで「帰属の前提が band である」ことを
   * 呼び出し側の型に残す。#316 の本物の差し込み口は帰属解決の入口（段3c で新設）。
   */
  policy: HitAttributionPolicy;
  /** 段またぎ（renderStaff）を解決した「実際に載る五線」（#310） */
  resolveRenderStave: (ev: HitEventLike | undefined) => Stave;
  /** その五線のクレフでの keyToLine（#310） */
  resolveK2lFor: (ev: HitEventLike | undefined) => (key: string) => number;
  /** 実際に載るパート番号（#310） */
  resolveRenderPartIndexFor: (ev: HitEventLike | undefined) => number;
  /** 任意パートの帯域（またぎ先の帯のクリップに使う） */
  computeStaveBand: (partIndex: number) => { top: number; bot: number };
}

/**
 * 音符1つぶんのヒット幾何と選択判定を作る（旧 PianoSystemCanvas の buildNoteHitGeometry）。
 *
 * 中身のロジック・コメントは移設時点の実装をそのまま保存している（挙動ゼロ差）。
 * 閉包で握っていた文脈（五線・帯・小節左右端・パート番号・またぎ解決）はすべて
 * ctx として明示化した。policy は現行 'band' のみで、判定式は従来と同一。
 */
export function resolveNoteHitGeometry(
  ctx: NoteHitGeometryContext,
  evs: (HitEventLike | undefined)[],
  vfNotes: unknown[],
  j: number,
  anchors: number[],
  mids: number[],
) {
  const { svg, stave, band, measLeft, measRight, partIndex } = ctx;
  const n = vfNotes[j] as HitNoteLike | undefined;
  // 段またぎ記譜（Issue #310）: 座標の基準は「自分のパートの五線」ではなく
  // 「この音符が実際に載っている五線」から取る。またぎでない音符では
  // noteStave===stave / noteK2l===k2l / noteBand===自パートの帯 になるので、
  // 従来の譜面の当たり判定は 1px も変わらない（不変条件1を分岐の構造で守る）。
  const evForStave = evs[j];
  const noteStave = ctx.resolveRenderStave(evForStave);
  const noteK2l = ctx.resolveK2lFor(evForStave);
  const noteBand = noteStave === stave
    ? { top: band.top, bot: band.bot }
    : ctx.computeStaveBand(ctx.resolveRenderPartIndexFor(evForStave));
  const rl = j === 0 ? measLeft : mids[j - 1], rr = j === vfNotes.length - 1 ? measRight : mids[j];
  // この音符イベントへクリックを届けるための透明 rect 範囲。
  // 左右は隣の音符との中間点で分割し、CELL_PAD だけ広げています。
  // 選択の青枠はここから独立した「表示」なので、クリック範囲調整はここを見る。
  let xl = Math.max(measLeft + 1, rl - CELL_PAD), xr = Math.min(measRight - 1, rr + CELL_PAD);
  if (xr - xl < HIT_MIN_W) { const h = (HIT_MIN_W - (xr - xl)) / 2; xl = Math.max(measLeft + 1, xl - h); xr = Math.min(measRight - 1, xr + h); }
  // またぎ音符（Issue #315）では下でX範囲を符頭幅へ狭めるので let にしてある。
  let wHit = Math.max(HIT_MIN_W, xr - xl);
  // 和音判定Y範囲：五線 ± 3加線の固定範囲（音符の位置に依存しない）。
  // Issue #219: 多段譜では、この固定範囲だけを隣のパートとの中間線（band。小節の背景
  // .vf-hit と同じ境界）でクリップする。詳細な経緯は Issue #219 / #218 を参照。
  const fixedTopY = noteStave.getYForLine(CHORD_LEDGER_TOP);
  const fixedBotY = noteStave.getYForLine(CHORD_LEDGER_BOT);
  const clippedTopY = Math.max(fixedTopY, noteBand.top);
  const clippedBotY = Math.min(fixedBotY, noteBand.bot);
  // 選択・ヒット領域のY範囲（Issue #218）。
  // 休符は五線内に描かれるので従来どおり固定範囲のまま扱い、
  // 音符だけ符頭の位置に応じて範囲を広げる（広げ幅は符頭1個分の半分＝0.5ライン）。
  const keyLines = evs[j]?.isRest ? null : noteKeyLineExtent(evs[j]?.keys ?? [], noteK2l);
  const noteHeadTopY = keyLines ? noteStave.getYForLine(keyLines.minLine - 0.5) : clippedTopY;
  const noteHeadBotY = keyLines ? noteStave.getYForLine(keyLines.maxLine + 0.5) : clippedBotY;
  // 符頭の実際の描画X範囲。getAbsoluteX()はtickの左端でnotehead自体より左になるため
  // getBoundingBox() で実際に描画された領域を取得する
  const bb = n?.getBoundingBox?.();
  const noteVisualLeft = bb?.getX?.() ?? anchors[j];
  const noteVisualRight = bb ? ((bb.getX?.() ?? anchors[j]) + (bb.getW?.() ?? 12)) : anchors[j] + 12;
  // ── 段またぎ音符の当たり判定は「符頭サイズ」まで縮める（Issue #315）──
  // 経緯と設計判断は Issue #315 / 設計メモ cross-staff-notation を参照。
  // またぎでない音符（renderStaff 無し）は下の条件が false なので 1px も変わらない。
  const isCrossStaffHit = ctx.resolveRenderPartIndexFor(evForStave) !== partIndex && !!keyLines;
  const chordTopY = isCrossStaffHit ? noteHeadTopY : clippedTopY;
  const chordBotY = isCrossStaffHit ? noteHeadBotY : clippedBotY;
  if (isCrossStaffHit) {
    const crossXPad = keySelectXPad(svg);
    const crossLeft = Math.max(xl, noteVisualLeft - crossXPad);
    const crossRight = Math.min(xl + wHit, noteVisualRight + crossXPad);
    // 万一 getBoundingBox が使えず符頭幅が取れない環境でも、幅が 0 以下になったら
    // 従来のセル幅のままにしておく（クリックがどこにも当たらない状態を作らない）
    if (crossRight > crossLeft) { xl = crossLeft; wHit = crossRight - crossLeft; }
  }
  // yHit は2枚に分かれたヒット rect を合わせた外接範囲の上端。
  // rect の座標には使わなくなったが、選択枠（eventBoxY のフォールバック）が引き続き使う。
  const yHit = Math.min(chordTopY, noteHeadTopY);
  // 既存の符頭を選択できるかの判定（findKeyIndexAtLine）で使う丸め。
  // click と mousemove（ホバーのカーソル形状）で必ず同じ式を使うため1つの関数にまとめる
  // （判定がずれるとホバー表示が信用できなくなる）。範囲の考え方は Issue #218 参照。
  const snapLineForKeySelect = (y: number) => snapLine(
    noteStave, y,
    Math.min(-EXTRA_TOP, keyLines ? keyLines.minLine : -EXTRA_TOP),
    Math.max(4 + EXTRA_BOTTOM, keyLines ? keyLines.maxLine : 4 + EXTRA_BOTTOM)
  );
  /**
   * SVG内部座標（raw 単位）で「この音符のどの符頭を選ぶクリックか」を返す（-1 なら選択にならない）。
   * 選択になるかどうかを判定する式は**この関数だけ**にする。
   * click・mousemove・再クリック巡回（#264）・非アクティブ声部（#258）が同じ関数を呼ぶことで、
   * 「ホバーでは選択に見えるのに押すと和音追加になる」食い違いが構造的に起きないようにしている。
   */
  const resolveSelectableKeyIndexAt = (lx: number, ly: number): number => {
    const ev = evs[j];
    if (!ev || ev.isRest) return -1;
    const pad = keySelectXPad(svg);
    if (lx < noteVisualLeft - pad || lx > noteVisualRight + pad) return -1;
    const atLine = findKeyIndexAtLine(ev.keys ?? [], snapLineForKeySelect(ly), noteK2l);
    if (atLine >= 0) return atLine;
    if (ly < chordTopY || ly > chordBotY) {
      // 固定範囲（五線±3加線）の外は挿入も和音追加も起きない帯なので、
      // 広め（±1ライン）に吸い寄せても副作用が無い（Issue #255）。
      return findNearestKeyIndexWithinLines(ev.keys ?? [], ly, noteStave, noteK2l, OUTER_KEY_SELECT_MAX_LINES);
    }
    // 五線の中（和音追加ゾーン）でも、符頭のX範囲に入っているクリックは
    // 和音追加より個別選択を優先する（Issue #271・案A）。X範囲は和音追加ゾーンと同じ式。
    if (lx >= noteVisualLeft - CHORD_HIT_PAD && lx <= noteVisualRight + CHORD_HIT_PAD) {
      return findNearestKeyIndexWithinLines(ev.keys ?? [], ly, noteStave, noteK2l, INNER_KEY_SELECT_MAX_LINES);
    }
    return -1;
  };
  return {
    xl, wHit, chordTopY, chordBotY, keyLines, noteHeadTopY, noteHeadBotY,
    bb, noteVisualLeft, noteVisualRight, yHit,
    // 段またぎ（#310）で「実際に載っている五線」を呼び出し側にも渡す。
    // rect の data-line0-y や、非アクティブ声部の符頭 rect の高さ計算が
    // この幾何と同じ五線を使うようにするため（別々に解決すると食い違う）。
    noteStave, noteK2l,
    snapLineForKeySelect, resolveSelectableKeyIndexAt,
  };
}
