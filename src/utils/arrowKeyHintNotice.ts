// 音符を初めて選択したときに、キーボード操作の存在を一度だけ知らせる仕組み（Issue #524）。
//
// 背景: ↑↓（音高）・←→（隣の音符へ）・Delete（削除）は実装済みでヘルプにも書いてあるが、
// 運用者・テスターとも存在に気づいていなかった。「機能があるのに知られない」典型で、
// 画面に常時ヒントを出すと譜面が騒がしくなるため、**初回の1回だけ**通知で伝える。
//
// 形は Issue #497（起動時の保存先の説明）とそろえてある。既読の覚え方は
// utils/onceNotice.ts の共通部品を使い、表示は #318 の通知系（notifyScoreEdit）に任せる。

import { createOnceNotice } from './onceNotice';

/**
 * 既読フラグの localStorage キー。
 * 他の設定キー（music-score-app-ui-variant 等）と同じ接頭辞にそろえている。
 */
export const ARROW_KEY_HINT_NOTICE_SEEN_KEY = 'music-score-app-arrow-key-hint-notice-seen';

/**
 * 初回に出す本文。通知は数秒で消えるので、**その場ですぐ試せる3つ**だけを書き、
 * それ以外はヘルプへ誘導する（全ショートカットを並べると読み切れない）。
 */
export const ARROW_KEY_HINT_NOTICE_MESSAGE =
  '↑↓ で音の高さ、←→ で隣の音符へ、Delete で削除できます。'
  + 'ほかのキー操作はヘルプの「キーボードショートカット」をご覧ください';

/** 初回通知を長めに出す時間（ミリ秒）。#497 の保存先の説明と同じ長さにそろえている */
export const ARROW_KEY_HINT_NOTICE_DURATION_MS = 10000;

const notice = createOnceNotice(ARROW_KEY_HINT_NOTICE_SEEN_KEY);

/** すでに一度見たかどうか（localStorage が使えない環境では「未読」を返す） */
export function hasSeenArrowKeyHintNotice(): boolean {
  return notice.hasSeen();
}

/**
 * 通知を出してよいかを判定し、出すと決めたら既読も記録する。
 *
 * #497（起動時の説明）と違い **claimStrict** を使う。こちらのきっかけは「音符を選ぶ」という
 * ユーザー操作で、選び直すたびに effect が走り直すため、#497 の「この読み込み中は出し直す」
 * 逃がし（StrictMode 対策）をそのまま使うと**選択のたびに出てしまう**（実装中に踏んだ）。
 * この通知は消去タイマーを自前で持たない（表示は #318 の通知系に任せきり）ので、
 * StrictMode の再実行で出し直す必要も無い。
 *
 * @returns true なら呼び出し側は通知を dispatch する
 */
export function claimArrowKeyHintNotice(): boolean {
  return notice.claimStrict();
}

/** テスト専用: ページ読み込み内フラグを初期化する（テスト間の独立性のため） */
export function resetArrowKeyHintNoticeForTest(): void {
  notice.resetForTest();
}
