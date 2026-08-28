// 音符を選択している状態で ←/→ を押したとき、「隣のイベント（音符・休符）」を探すための
// 純粋な計算だけをまとめたファイル（Issue #442）。
//
// なぜ画面（PianoSystemCanvas）から切り離すのか:
// 隣を探す規則（同じ声部だけを見る・小節をまたぐ・空の小節は飛ばす・端では止まる）は
// 譜面データだけで決まる。描画やイベント処理と混ぜずに置いておけば、
// 段（システム）をまたぐ移動のような込み入った場面もテストで直接確かめられる。

import type { MeasureData } from '../types/storage';
import { getVoiceEvents } from './voiceMeasureUtils';

/** 譜面上の1イベント（音符・休符）の位置。measure は絶対小節インデックス */
export type NotePosition = {
  measure: number;
  index: number;
};

/** 移動方向。1 = 次（→）、-1 = 前（←） */
export type NoteNavigationDirection = 1 | -1;

/**
 * 選択中のイベントから見て、同じ声部の「1つ前 / 1つ次」のイベント位置を返す。
 *
 * 小節の端まで来たら隣の小節へ移る。音符が1つも入っていない小節は飛ばして探し続ける
 * （空の小節で移動が止まると、書きかけの譜面では先へ進めなくなってしまうため）。
 * 曲頭・最後のイベントでさらに進もうとした場合は `null` を返す。呼び出し側は
 * 選択を動かさずに理由を通知する（#318「行き止まりは喋る」）。
 *
 * @param measures 対象パートの全小節（選択中の段だけでなく曲全体を渡すこと）
 * @param voiceIndex 選択中の声部（0 = 声部1/上声、1 = 声部2/下声）
 * @param current いま選択しているイベントの位置
 * @param direction 1 = →（次へ）、-1 = ←（前へ）
 */
export function findAdjacentNotePosition(
  measures: MeasureData[],
  voiceIndex: number,
  current: NotePosition,
  direction: NoteNavigationDirection,
): NotePosition | null {
  const currentMeasure = measures[current.measure];
  if (currentMeasure) {
    // まず同じ小節の中で隣を探す。ここで見つかれば小節をまたぐ必要はない
    const events = getVoiceEvents(currentMeasure, voiceIndex);
    const nextIndex = current.index + direction;
    if (nextIndex >= 0 && nextIndex < events.length) {
      return { measure: current.measure, index: nextIndex };
    }
  }

  // 小節の端だったので、隣の小節から「最初/最後のイベント」を探す。
  // 空の小節（まだ書いていない小節）は飛ばして、イベントのある小節まで進む。
  //
  // 探し始める位置は配列の中へ丸めておく。選択が譜面の外の小節を指したまま残っている
  // （Undo などで小節数が縮んだ直後）と、丸めずに始めた for 文は1周もせずに終わり、
  // 手前に音符があるのに「もう前が無い」と誤って答えてしまう
  const searchStart = direction > 0
    ? Math.max(current.measure + 1, 0)
    : Math.min(current.measure - 1, measures.length - 1);
  for (let m = searchStart; m >= 0 && m < measures.length; m += direction) {
    const events = getVoiceEvents(measures[m], voiceIndex);
    if (events.length === 0) continue;
    return { measure: m, index: direction > 0 ? 0 : events.length - 1 };
  }

  // 曲頭より前・最後のイベントより後ろには行けない
  return null;
}
