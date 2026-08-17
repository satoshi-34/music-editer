// 段またぎ記譜（cross-staff）の共通ロジック（Issue #309・段1a）。
//
// ピアノ譜では「右手の声部の音を、加線だらけになるのを避けるため下の五線（ヘ音記号）に
// 描く」慣習がある。このアプリでは音符ごとの `renderStaff` プロパティで
// 「どの五線に描くか」だけを切り替える（どの声部の音か＝所属は変えない）。
//
// ここには「イベント → 実際に描く五線（パート）の番号」を求める純粋な関数だけを置く。
// 描画側（PianoSystemCanvas）も、後続の段1b で座標の取り所を1本化するときも、
// 同じ答えをここから得られるようにするため（同じ判定を2か所に書かない）。
import type { NoteEvent } from '../types/storage';

/** 段またぎの向き。'below' = 1つ下のパートの五線、'above' = 1つ上のパートの五線 */
export type RenderStaffDirection = 'below' | 'above';

/** 保存データから読んだ値が段またぎの向きとして妥当かどうか（storage の読込検証と共用） */
export function isRenderStaffDirection(value: unknown): value is RenderStaffDirection {
  return value === 'below' || value === 'above';
}

/**
 * 「この音符を実際に描くパート番号」を返す。
 *
 * 段またぎが指定されていない場合はもちろん、次のときも自分のパート（partIndex）へ
 * フォールバックする。**保存データは書き換えず、描画だけを self に落とす**のが方針
 * （例外を投げない・データを壊さない。設計メモ §3 / §4-4）:
 *   - 端のパートで行き先が無い向き（最上段の 'above'、最下段の 'below'）
 *   - パートが1つしかない編成（単段の譜面・パート譜表示）
 *   - 未知の文字列が入っていた場合（旧データや手書きJSON対策）
 */
export function resolveRenderPartIndex(
  partIndex: number,
  renderStaff: RenderStaffDirection | undefined,
  partCount: number
): number {
  if (!isRenderStaffDirection(renderStaff)) return partIndex;
  const target = renderStaff === 'below' ? partIndex + 1 : partIndex - 1;
  // 相手の五線が存在しないときは自分の五線へ戻す（単段編成・パート譜もここで吸収される）
  if (target < 0 || target >= partCount) return partIndex;
  return target;
}

/** イベント配列を「実際に描くパート番号」の配列へ変換する（描画側の入口） */
export function resolveRenderPartIndexes(
  events: Pick<NoteEvent, 'renderStaff'>[],
  partIndex: number,
  partCount: number
): number[] {
  return events.map(ev => resolveRenderPartIndex(partIndex, ev.renderStaff, partCount));
}

/**
 * 「この声部に段またぎの音符が1つでもあるか」。
 *
 * 段またぎを使っていない譜面では従来とまったく同じ処理経路を通したいので、
 * 描画側はこの判定が false のときは新しい分岐に一切入らない
 * （不変条件1「使っていない譜面は1pxも変わらない」を構造で守るため）。
 */
export function hasCrossStaffRender(renderPartIndexes: number[], partIndex: number): boolean {
  return renderPartIndexes.some(target => target !== partIndex);
}

/**
 * 連桁（ビーム）を切る位置を決めるためのグループ分け。
 *
 * 隣り合う音符の「実際に載る五線」が変わる位置でグループを切り、
 * 連続する同じ五線の音符のインデックス列（元配列での位置）を返す。
 * 段1a では段またぎ連桁（1本のビームが五線間を斜めに渡る書き方）は扱わないため、
 * またぎ位置ではビームを分ける（設計メモ §4-2 / §8）。
 *
 * 例: [0,0,1,1,0] → [[0,1],[2,3],[4]]
 */
export function groupIndexesByRenderTarget(renderPartIndexes: number[]): number[][] {
  const groups: number[][] = [];
  renderPartIndexes.forEach((target, index) => {
    const current = groups[groups.length - 1];
    if (current !== undefined && renderPartIndexes[current[current.length - 1]] === target) {
      current.push(index);
    } else {
      groups.push([index]);
    }
  });
  return groups;
}
