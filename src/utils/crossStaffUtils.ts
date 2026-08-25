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
/**
 * 「実際に描かれる五線」を指すパート番号のブランド型（#376）。
 *
 * パートまたぎ（⇵ / renderStaff）の導入以降、「データ上の所属パート」と
 * 「実際に描かれる五線のパート」は一致しない。この取り違えは実バグを繰り返し
 * 生んでいる（#403 の弧クランプ・#409 のA2淡色で、所属基準の判定が段またぎ音符で
 * 逆転した。いずれも実機で発覚）。
 *
 * 描画位置に関わる判定（衝突・淡色・クランプ・帯）は必ずこの型の値を使うこと。
 * 所属パート（クリックの書き込み先・保存データの添字）は素の number のままにして、
 * 混ぜようとしたときに型エラーで気づけるようにする。
 */
export type RenderedPartIndex = number & { readonly __renderedPart: unique symbol };

/** 素の番号を「描画先パート」として刻印する（resolveRenderPartIndex の内部と、
 *  五線から直接引いた場合にだけ使う） */
export function asRenderedPartIndex(value: number): RenderedPartIndex {
  return value as RenderedPartIndex;
}

export function resolveRenderPartIndex(
  partIndex: number,
  renderStaff: RenderStaffDirection | undefined,
  partCount: number
): RenderedPartIndex {
  if (!isRenderStaffDirection(renderStaff)) return asRenderedPartIndex(partIndex);
  const target = renderStaff === 'below' ? partIndex + 1 : partIndex - 1;
  // 相手の五線が存在しないときは自分の五線へ戻す（単段編成・パート譜もここで吸収される）
  if (target < 0 || target >= partCount) return asRenderedPartIndex(partIndex);
  return asRenderedPartIndex(target);
}

/** イベント配列を「実際に描くパート番号」の配列へ変換する（描画側の入口） */
export function resolveRenderPartIndexes(
  events: Pick<NoteEvent, 'renderStaff'>[],
  partIndex: number,
  partCount: number
): RenderedPartIndex[] {
  return events.map(ev => resolveRenderPartIndex(partIndex, ev.renderStaff, partCount));
}

/**
 * 「この声部に段またぎの音符が1つでもあるか」。
 *
 * 段またぎを使っていない譜面では従来とまったく同じ処理経路を通したいので、
 * 描画側はこの判定が false のときは新しい分岐に一切入らない
 * （不変条件1「使っていない譜面は1pxも変わらない」を構造で守るため）。
 */
export function hasCrossStaffRender(renderPartIndexes: RenderedPartIndex[], partIndex: number): boolean {
  return renderPartIndexes.some(target => target !== partIndex);
}

/**
 * そのパートで使える段またぎの向き（Issue #310・UI 用）。
 *
 * ピアノ譜では右手（上の段）は下へ、左手（下の段）は上へ載せ替えるのが慣行なので、
 * 「下に五線があるなら below、無ければ above」と決めれば両方をこの1行で表せる。
 * 相手の五線がまったく無い編成（単段譜・パート譜表示）では null を返し、
 * 呼び出し側はボタンを無効化する／何もしないで終わる。
 */
export function availableRenderStaffDirection(
  partIndex: number,
  partCount: number
): RenderStaffDirection | null {
  if (partIndex < partCount - 1) return 'below';
  if (partIndex > 0) return 'above';
  return null;
}

/**
 * 音符1つの段またぎ表示を self ↔ direction で切り替えたイベント列を返す（Issue #310）。
 *
 * 切り替えの対象にならない場合（範囲外・休符・向きが使えない編成）は **null** を返す。
 * 呼び出し側はそのとき保存処理そのものを行わない（対象外のクリックで setScore を呼ぶと、
 * 中身の無い声部が生まれる・Undo に空の1手が積まれる。#112 の教訓）。
 *
 * 戻すときは `renderStaff` プロパティごと削除して、旧データとまったく同じ形に揃える
 * （#294 の hideNumber と同じ方針）。
 */
export function toggleRenderStaffAt<T extends Pick<NoteEvent, 'renderStaff' | 'isRest'>>(
  events: T[],
  index: number,
  direction: RenderStaffDirection | null
): T[] | null {
  if (direction === null) return null;
  const target = events[index];
  // 休符は段またぎの対象にしない（符頭が無く「どちらの五線の音か」が見た目で伝わらないため）
  if (!target || target.isRest) return null;
  const next = [...events];
  if (target.renderStaff === direction) {
    const cleared = { ...target };
    delete cleared.renderStaff;
    next[index] = cleared;
  } else {
    next[index] = { ...target, renderStaff: direction };
  }
  return next;
}

/**
 * 連桁（ビーム）を切る位置を決めるためのグループ分け。
 *
 * 渡されたインデックス列を順に見て、「実際に載る五線」が変わる位置で切り分ける。
 * 段1a では段またぎ連桁（1本のビームが五線間を斜めに渡る書き方）は扱わないため、
 * またぎ位置ではビームを分ける（設計メモ §4-2 / §8）。
 *
 * 引数がインデックス列なのは、**拍の区切りを先に決めたあとの断片**にも
 * 同じ判定を使うため（Issue #313）。小節全体を渡せば従来どおり全音符列の
 * グループ分けになる。
 *
 * 例: indexes=[0,1,2,3,4] / renderPartIndexes=[0,0,1,1,0] → [[0,1],[2,3],[4]]
 */
export function splitIndexesByRenderTarget(
  indexes: readonly number[],
  renderPartIndexes: readonly RenderedPartIndex[]
): number[][] {
  const groups: number[][] = [];
  indexes.forEach(index => {
    const current = groups[groups.length - 1];
    const previousIndex = current?.[current.length - 1];
    if (current !== undefined && previousIndex !== undefined
      && renderPartIndexes[previousIndex] === renderPartIndexes[index]) {
      current.push(index);
    } else {
      groups.push([index]);
    }
  });
  return groups;
}
