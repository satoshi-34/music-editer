// src/utils/pedalBridgeUtils.ts
// ペダル記号（Ped / ✱）を「破線でつないだブリッジ」として描くためのユーティリティ。
//
// データモデル (NoteEvent.pedalMark) は 'down' | 'up' の単発マークのままにしている。
// 実際のピアノ譜では「Ped から ✱ まで破線でつなぐ」表示が標準的なので、
// 描画するタイミングで「時系列順に並んだ down/up のマーク列」をペアリングし、
// 対応する区間だけ破線で結ぶ。対応が取れないマーク（down だけ、up だけ）は
// 従来どおり単独表示のままにする（入力途中の状態や後方互換のため）。

import { type CollisionRect } from './symbolCollisionUtils';
import type { MeasureData } from '../types/storage';
import type { ClefType } from '../components/clefUtils';
import { keyToLine } from '../components/clefUtils';
import { resolveMeasureClef } from './clefMeasureUtils';
import { getMeasureVoices } from './voiceMeasureUtils';

/** ペアリング対象になる最小限の情報。実際の描画エントリはこれを拡張して使う */
export interface PedalMarkLike {
  mark: 'down' | 'up';
}

/**
 * ペアリング結果の1要素。
 * - 'bridge': down → up が揃った1つのペダル区間（破線で結ぶ）
 * - 'down'  : 対応する up が見つからなかった単独の Ped（従来どおり単独表示）
 * - 'up'    : 対応する down が見つからなかった単独の ✱（従来どおり単独表示）
 */
export type PedalPairResult<T extends PedalMarkLike> =
  | { kind: 'bridge'; down: T; up: T }
  | { kind: 'down'; down: T }
  | { kind: 'up'; up: T };

/**
 * 時系列順（小節→イベントの順）に並んだペダルマークの列を、down→up のペアにまとめる。
 *
 * ルール:
 * - down の次に来た up とペアにする（1区間 = 1つの down + 1つの up）。
 * - down が連続した場合、前の down は「対応する up が無いまま」次の down に上書きされるので
 *   単独の down として確定させ、新しい down を待ち受け直す。
 * - up の前に待ち受け中の down が無ければ、単独の up として扱う。
 * - 列の終端まで待ち受け中の down が残っていれば、単独の down として扱う。
 */
export function pairPedalMarks<T extends PedalMarkLike>(entries: T[]): PedalPairResult<T>[] {
  const results: PedalPairResult<T>[] = [];
  let pendingDown: T | null = null;

  for (const entry of entries) {
    if (entry.mark === 'down') {
      // down が連続した場合、前の down は対応する up が無いまま確定させる
      if (pendingDown) {
        results.push({ kind: 'down', down: pendingDown });
      }
      pendingDown = entry;
    } else {
      // up: 待ち受け中の down があればペアにする。無ければ単独の up
      if (pendingDown) {
        results.push({ kind: 'bridge', down: pendingDown, up: entry });
        pendingDown = null;
      } else {
        results.push({ kind: 'up', up: entry });
      }
    }
  }

  // 列の終端まで残った down は対応する up が無い単独マーク
  if (pendingDown) {
    results.push({ kind: 'down', down: pendingDown });
  }

  return results;
}

/**
 * 破線ブリッジの1セグメントを SVG <line> で描く。
 * 印刷用CSS（App.css の @media print）が `svg line` を黒で強制表示するため、
 * 追加のクラス指定なしでそのまま印刷にも反映される。
 */
export interface PedalBridgeLineParams {
  svgRoot: SVGElement;
  x1: number;
  x2: number;
  y: number;
  isSelected?: boolean;
}

export function drawPedalBridgeLine(params: PedalBridgeLineParams): void {
  const { svgRoot, x1, x2, y, isSelected } = params;
  // 幅が無い・負になる場合は描画しない（テキスト同士が重なるほど近い特殊ケース）
  if (x2 - x1 <= 1) return;
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y1', String(y));
  line.setAttribute('y2', String(y));
  line.setAttribute('stroke', isSelected ? '#3b82f6' : '#1e293b');
  line.setAttribute('stroke-width', isSelected ? '1.6' : '1.2');
  line.setAttribute('stroke-dasharray', '3,3');
  line.setAttribute('pointer-events', 'none');
  svgRoot.appendChild(line);
}

/**
 * Ped/✱ の字面の見積もり（SVG text・baseline 基準）。Ped は 13px italic、✱ は 14px。
 * 上に約 10px（アセント）・下に約 3px（ディセント）。破線は baseline - 4 に引く。
 */
export const PEDAL_TEXT_ASCENT_PX = 10;
export const PEDAL_TEXT_DESCENT_PX = 3;
/** 最下音の描画下端と Ped/✱ の字面の上端との間にあける余白（px） */
export const PEDAL_CLEARANCE_MARGIN_PX = 4;
/** 加線が符頭の左右へ張り出す量の見込み（px・片側）。VexFlow の既定（符頭幅 + 約4px×2）に合わせる */
export const PEDAL_LEDGER_OVERHANG_PX = 4;
/** 従来の固定位置: 五線下端からペダル記号の baseline までの距離（px） */
export const PEDAL_BASELINE_OFFSET_PX = 25;
/** 段の下端（computeLayout の sysH）が五線下端の下に確保している余白（px） */
export const SYSTEM_BOTTOM_PADDING_PX = 40;
/** 五線の行間（VexFlow 既定・論理座標 px） */
const STAVE_LINE_SPACING_PX = 10;
/** 符頭の半分の高さ（論理座標 px）。行間の半分 */
const NOTEHEAD_HALF_HEIGHT_PX = 5;

/**
 * ペダル記号の baseline Y を「従来の固定位置」と「区間内の最下音の下端＋余白」の
 * 大きい方へクランプする（Issue #604）。
 *
 * - baseY: 従来の固定位置（五線下端 + 25）。低音が無ければ**この値をそのまま返す**
 *   （低音の無い譜面で 1px も動かさない、が受入条件）
 * - spanX1..spanX2: Ped〜✱ の横の範囲（字面の半幅込み）。ペア（破線でつなぐ区間）は
 *   区間全体を1つの箱として見るので、Ped と ✱ と破線が**同じ高さ**にそろう
 * - obstacles: 同じパートの音符（符頭＋符幹）の描画範囲。強弱記号の回避（#340/#382）と
 *   同じ noteObstacles を渡す。横に重ならない障害物は無視する
 *
 * 強弱記号のような「step ずつ押し出す」探索ではなく一発のクランプにしているのは、
 * ペダルは五線の**最下段**にしか付かず（下に別の五線が来る #382 の境界が無い）、
 * 「最下音の下」が唯一の答えだから。
 */
export function resolvePedalBaselineY(params: {
  baseY: number;
  spanX1: number;
  spanX2: number;
  obstacles: CollisionRect[];
}): number {
  const { baseY, spanX1, spanX2, obstacles } = params;
  const x = Math.min(spanX1, spanX2);
  const w = Math.abs(spanX2 - spanX1);
  // 字面の箱（従来位置）。障害物とこの箱の横が重なり、かつ障害物の下端が字面の上端より
  // 下（＋余白）にあるときだけ、その下端まで下げる
  const textTop = baseY - PEDAL_TEXT_ASCENT_PX;
  const probe: CollisionRect = { x, y: textTop, w, h: PEDAL_TEXT_ASCENT_PX + PEDAL_TEXT_DESCENT_PX };
  let requiredTop = textTop;
  for (const obstacle of obstacles) {
    // 横: 加線は符頭より左右に張り出して描かれる（VexFlow は加線を別の path で描き、
    // 符頭の BoundingBox には含まれない）ので、横だけ加線ぶんの余裕を見る。
    // 縦: 字面の箱に**実際に食い込む**障害物だけを見る（余白なし）。下向きの符幹が
    // 字面の上端をかすめる程度（通常音域）では動かさない＝低音の無い譜面で 1px も
    // 変わらない、を守るため。食い込んだら下端＋余白まで下げる
    const overlapsX = obstacle.x - PEDAL_LEDGER_OVERHANG_PX < probe.x + probe.w
      && obstacle.x + obstacle.w + PEDAL_LEDGER_OVERHANG_PX > probe.x;
    const intrudesY = obstacle.y < probe.y + probe.h && obstacle.y + obstacle.h > probe.y;
    if (!overlapsX || !intrudesY) continue;
    requiredTop = Math.max(requiredTop, obstacle.y + obstacle.h + PEDAL_CLEARANCE_MARGIN_PX);
  }
  return requiredTop === textTop ? baseY : requiredTop + PEDAL_TEXT_ASCENT_PX;
}

/**
 * ペダル記号が最下音を避けて下がるぶん、段の下端をどれだけ広げる必要があるか（px・論理座標）
 * を**譜面データから**見積もる（Issue #604）。
 *
 * 描画後の実測（resolvePedalBaselineY）で Ped を下げても、段の高さ（computeLayout の sysH）が
 * 固定のままでは SVG の外へはみ出し、印刷/PDF で欠けたり次段と重なったりする。段の高さは
 * 描画の前に決まるので、ここでは「最下パートの最低音の深さ」から必要量を先に求めて
 * 段の下余白へ足す（描画側のクランプと同じ式）。
 *
 * - ペダル記号が譜面のどこにも無ければ 0（ペダルの無い譜面の段の高さは 1px も変えない）
 * - 全段で同じ値にする（ページの段数計算が「段の高さは一定」を前提にしているため。
 *   区間ごとに変えると段の高さが段ごとに違ってしまう）
 * - 対象は最下パートの音符（全声部）と、その1つ上のパートから最下段へ描かれる段またぎ音符
 *   （renderStaff: 'below'）。符幹は低音では上向きなので見ない
 */
export function estimatePedalBottomExtensionPx(
  parts: ReadonlyArray<{ measures: readonly MeasureData[]; clef: ClefType }>,
): number {
  if (parts.length === 0) return 0;
  const hasPedal = parts.some((part) => part.measures.some((measure) =>
    getMeasureVoices(measure).some((voice) => voice.events.some((ev) => ev.pedalMark))));
  if (!hasPedal) return 0;

  const bottomIndex = parts.length - 1;
  const bottom = parts[bottomIndex];
  const above = parts[bottomIndex - 1];
  let deepestBottomPx = -Infinity; // 五線下端を 0 とした、最も深い符頭の下端
  const consider = (key: string, clef: ClefType) => {
    const line = keyToLine(clef, key);
    if (!Number.isFinite(line)) return;
    const headBottom = (line - 4) * STAVE_LINE_SPACING_PX + NOTEHEAD_HALF_HEIGHT_PX;
    if (headBottom > deepestBottomPx) deepestBottomPx = headBottom;
  };
  bottom.measures.forEach((measure, i) => {
    const clef = resolveMeasureClef(bottom.measures, i, bottom.clef);
    getMeasureVoices(measure).forEach((voice) => voice.events.forEach((ev) => {
      if (ev.isRest || ev.renderStaff === 'above') return;
      ev.keys.forEach((key) => consider(key, clef));
    }));
  });
  if (above) {
    above.measures.forEach((measure, i) => {
      const clef = resolveMeasureClef(bottom.measures, i, bottom.clef);
      getMeasureVoices(measure).forEach((voice) => voice.events.forEach((ev) => {
        if (ev.isRest || ev.renderStaff !== 'below') return;
        ev.keys.forEach((key) => consider(key, clef));
      }));
    });
  }
  if (!Number.isFinite(deepestBottomPx)) return 0;
  // 描画側のクランプ（resolvePedalBaselineY）と同じ式で必要な baseline を求め、
  // 段の下余白（SYSTEM_BOTTOM_PADDING_PX）に収まらないぶんだけ広げる
  const textTop = PEDAL_BASELINE_OFFSET_PX - PEDAL_TEXT_ASCENT_PX;
  if (deepestBottomPx <= textTop) return 0;
  const baseline = deepestBottomPx + PEDAL_CLEARANCE_MARGIN_PX + PEDAL_TEXT_ASCENT_PX;
  return Math.max(0, Math.ceil(baseline + PEDAL_TEXT_DESCENT_PX - SYSTEM_BOTTOM_PADDING_PX));
}
