// src/utils/pedalBridgeUtils.ts
// ペダル記号（Ped / ✱）を「破線でつないだブリッジ」として描くためのユーティリティ。
//
// データモデル (NoteEvent.pedalMark) は 'down' | 'up' の単発マークのままにしている。
// 実際のピアノ譜では「Ped から ✱ まで破線でつなぐ」表示が標準的なので、
// 描画するタイミングで「時系列順に並んだ down/up のマーク列」をペアリングし、
// 対応する区間だけ破線で結ぶ。対応が取れないマーク（down だけ、up だけ）は
// 従来どおり単独表示のままにする（入力途中の状態や後方互換のため）。

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
