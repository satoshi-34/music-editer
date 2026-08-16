// 譜面の編集で「何が起きたか」をユーザーへ知らせるための、ごく小さな通知の仕組み（Issue #238）。
//
// 背景: 音符の選択（青枠）が残ったまま Delete / Backspace が譜面へ届くと、
// 選択中の音符（連符ならグループごと）が**無言で**消えていた。
// ユーザーは後から気づいて「勝手に譜面が変わった」と誤解してしまう。
// そこで削除の実行時に「何を消したか」を数秒だけ画面へ出す。
//
// なぜ props ではなく window の CustomEvent なのか:
// 削除を実行するのは PianoSystemCanvas（1段 = 1インスタンス）だが、通知を出すのは
// 画面全体を持つ ScorePage である。両者のあいだには SingleStaff / PianoStaff /
// QuartetStaff / EnsembleStaff / PartExtractionStaff の5つのラッパーが挟まっており、
// コールバックを props で通すと5ファイルを機械的に書き換えることになる。
// PianoSystemCanvas には既に「選択はいつも1つだけ」を保証する window イベント
// （SELECTION_CLAIMED_EVENT）の前例があるため、同じ作法にそろえた。

import type { NoteEvent } from '../types/storage';

/** 削除など「編集で何が起きたか」を画面へ出すための通知イベント名 */
export const SCORE_EDIT_NOTICE_EVENT = 'music-editer-score-edit-notice';

/** 譜面側（PianoSystemCanvas）の選択を解除させるための要求イベント名 */
export const SCORE_SELECTION_CLEAR_EVENT = 'music-editer-score-selection-clear';

export interface ScoreEditNoticeDetail {
  /** 画面に出す本文。「〜しました」までを含む完成した文にすること */
  message: string;
}

/**
 * 「元に戻せます」の案内。Mac は Cmd、Windows/Linux は Ctrl なので、
 * README と同じく両方を併記する（実行環境を判定して出し分けるほどの情報ではない）。
 */
export const UNDO_HINT = '（Cmd/Ctrl+Z で元に戻せます）';

/** 編集の通知を出す。リスナー（ScorePage）が居なければ何も起きない。 */
export function notifyScoreEdit(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ScoreEditNoticeDetail>(SCORE_EDIT_NOTICE_EVENT, { detail: { message } })
  );
}

/**
 * 譜面上の選択（音符・スラー/タイ・松葉）を解除するよう要求する。
 *
 * タブ切り替え・ツール変更・再生開始のような「モードが変わる」タイミングで呼ぶ。
 * 選択が残ったままだと、そのあとの Delete が譜面に届いてしまうため
 * （Issue #238 の実害。#231 の「モード遷移でオーバーレイを閉じる」と同じ発想）。
 */
export function requestScoreSelectionClear(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SCORE_SELECTION_CLEAR_EVENT));
}

/**
 * 削除される音符/休符から、通知に出す文言を組み立てる。
 *
 * 分岐は utils/noteDeletionUtils.ts の deleteEventFromMeasures と**同じ順序**にしてある。
 * 実際に消えるものと文言がずれると、かえって混乱させてしまうため。
 *
 * @param event 削除対象のイベント（削除前の状態を渡すこと）
 * @param keyIndex 和音のうちクリックで選ばれていた符頭の位置。未指定ならイベント全体が対象
 */
export function describeDeletedNoteEvent(event: NoteEvent, keyIndex?: number): string {
  // 1. 和音の1音だけを取り除くケース（連符の中の和音でもこちらが優先される）
  if (
    !event.isRest &&
    keyIndex !== undefined &&
    keyIndex >= 0 &&
    keyIndex < event.keys.length &&
    event.keys.length > 1
  ) {
    return `和音の1音を削除しました${UNDO_HINT}`;
  }
  // 2. 連符の中のイベントは、グループ全体が同じ長さの休符へ置き換わる
  if (event.tuplet) {
    return `${event.tuplet.numNotes}連符グループを削除しました${UNDO_HINT}`;
  }
  // 3. それ以外はイベントそのものが消える
  if (event.isRest) return `休符を削除しました${UNDO_HINT}`;
  if (event.keys.length > 1) return `和音を削除しました${UNDO_HINT}`;
  return `音符を削除しました${UNDO_HINT}`;
}

/**
 * 矢印キーの音高移動で、移動先に同じ音が既にあって1音にまとまったときの文言（Issue #281）。
 *
 * 同じ高さの符頭は完全に重なって1つに見えるため、重複を作らせない代わりに
 * 「音が1つ減った」ことは必ず知らせる。黙って音数が変わるのが #238 で問題になった形なので、
 * 削除と同じ通知の仕組みに乗せている。
 */
export function describeAbsorbedChordKey(): string {
  return `移動先に同じ高さの音があるため、和音の1音にまとめました${UNDO_HINT}`;
}

/** スラー/タイの削除に出す文言 */
export function describeDeletedArc(kind: 'tie' | 'slur'): string {
  return `${kind === 'tie' ? 'タイ' : 'スラー'}を削除しました${UNDO_HINT}`;
}

/** 松葉（クレッシェンド／デクレッシェンド）の削除に出す文言 */
export function describeDeletedHairpin(type: 'cresc' | 'dim'): string {
  return `${type === 'cresc' ? 'クレッシェンド' : 'デクレッシェンド'}（松葉）を削除しました${UNDO_HINT}`;
}

/** 選択した小節範囲をまとめて空にしたときの文言 */
export function describeClearedMeasures(start: number, end: number): string {
  const count = end - start + 1;
  // 小節番号は 0 始まりの内部インデックスなので、画面表記の 1 始まりへ直して伝える
  const range = count === 1 ? `${start + 1}小節目` : `${start + 1}〜${end + 1}小節目`;
  return `${range}の音符を削除しました${UNDO_HINT}`;
}
