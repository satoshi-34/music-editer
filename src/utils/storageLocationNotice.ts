// 「楽譜データがどこに保存されるのか」を初回に一度だけ知らせるための仕組み（Issue #497）。
//
// 背景: 実際の保存先はブラウザ（localStorage）と、書き出しでユーザーが選んだフォルダだけで、
// 譜面がサーバーへ送られることはない。ところがアプリはそれを一度も説明していなかったため、
// 「すぐ開けるということは、どこかに公開されているのでは」という不安が実機テストで出た。
// 運用者が口頭で説明すると解消した＝説明そのものには効果があるので、アプリ自身に説明させる。
//
// 方針: 「公開されていないことの証明」ではなく**事実の記述**に徹する。
// 表示は #318（#238/#306 由来）の通知系をそのまま流用し、既読だけをここで覚える。

import { createOnceNotice } from './onceNotice';

/**
 * 既読フラグの localStorage キー。
 * 他の設定キー（music-score-app-ui-variant 等）と同じ接頭辞にそろえている。
 */
export const STORAGE_LOCATION_NOTICE_SEEN_KEY = 'music-score-app-storage-location-notice-seen';

/**
 * 初回に出す本文。通知は数秒で消えるため、ここでは「保存先」と「送信していない」の
 * 2点だけに絞り、詳細はヘルプ（README の「データの保存場所と安全性」）へ誘導する。
 *
 * 「自動で〜送信されることはありません」と**対象を限定**しているのは、PDF取り込み（β）
 * だけは例外だから（ユーザーが選んだ PDF を変換サーバーへ送る。omrApi.ts・round1 P1）。
 * 例外なしの断定（「サーバーには送信されません」）にすると、β機能を使った瞬間に
 * この通知が嘘になる。βの例外の明示はヘルプ側（helpContent.ts）が担う。
 */
export const STORAGE_LOCATION_NOTICE_MESSAGE =
  '作成した楽譜と編集内容はこの端末にのみ保存されます（ブラウザ内と、書き出しで選んだフォルダ）。'
  + '自動でサーバーへ送信されることはありません。詳しくはヘルプの「データの保存場所と安全性」をご覧ください';

/** 初回通知を長めに出す時間（ミリ秒）。編集の通知（4秒）では読み切れない長さの文のため */
export const STORAGE_LOCATION_NOTICE_DURATION_MS = 10000;

/**
 * ホームに**常設**で出す保存先の説明（Issue #570）。
 *
 * 初回通知（上の MESSAGE）は数秒で消えるため、後から来た不安には答えられない。
 * 「ログインが無い＝全世界に公開されているのでは」という誤解は核ユーザーが実際に抱いた
 * もの（発案者ユーザー・2026-08-31 のテスト会）で、消えない一言が要る。
 *
 * 文言を定数にしているのは、将来ログイン（#498）が入ったときに「ローカル/クラウド」の
 * 保存先表示へ発展させる差し替え点を1か所にまとめておくため（#570 仕様4）。
 *
 * 「自動で〜送信されることはありません」と**対象を限定**しているのは MESSAGE と同じ理由で、
 * PDF取り込み（β）だけはユーザーが選んだファイルを変換サーバーへ送るため。
 * 例外なしの断定にすると、β機能を使った瞬間にこの表示が嘘になる。
 */
export const HOME_STORAGE_LOCATION_NOTE =
  '作品はこの端末にだけ保存されます（自動でサーバーへ送信されることはありません）。';

/**
 * フッター用の短い言い方（Issue #570）。
 * 作品一覧のそばに出す上の一文と**同じ文をもう一度**置くと、同じ画面に同じ文が2つ並んで
 * かえって読み飛ばされる。フッターは「探さずに見つかる場所の控えめな一行」に徹し、
 * 詳しい説明（送信していないこと・持ち出し方）は作品一覧側の対に任せる。
 */
export const HOME_STORAGE_LOCATION_NOTE_SHORT = '作品の保存先はこの端末の中だけです。';

/**
 * 上の説明と対にして出す注意（Issue #570 仕様2）。
 * 「端末内だけ」は安心であると同時に「端末を変えると持ち出せない」という不便でもあるので、
 * 安心だけを伝えて持ち出し方を伝えないのは不親切になる。
 */
export const HOME_STORAGE_PORTABILITY_NOTE =
  '別の端末で使うときや控えを残したいときは、「書き出し」でファイルに保存してください。';

/**
 * 既読の判定・記録は他の「一度きりの通知」と共通の部品を使う（Issue #524 で切り出し）。
 * StrictMode 対策（下の claim のコメント参照）を含む同じ判定を2か所に書かないため。
 */
const notice = createOnceNotice(STORAGE_LOCATION_NOTICE_SEEN_KEY);

/**
 * すでに一度見たかどうか。
 * localStorage が使えない環境（プライベートブラウジング等）では例外を投げず「未読」を返す。
 */
export function hasSeenStorageLocationNotice(): boolean {
  return notice.hasSeen();
}

/** 既読として記録する。保存に失敗しても致命的ではないので握りつぶす。 */
export function markStorageLocationNoticeSeen(): void {
  notice.markSeen();
}

/**
 * 通知を出してよいかを判定し、出すと決めたら既読も記録する。
 * StrictMode の「実行→片付け→再実行」でも true を返し続けるので、
 * 再実行時に通知と消去タイマーが張り直される（round1 P3）。
 * @returns true なら呼び出し側は通知を dispatch する
 */
export function claimStorageLocationNotice(): boolean {
  return notice.claim();
}

/** テスト専用: ページ読み込み内フラグを初期化する（テスト間の独立性のため） */
export function resetStorageLocationNoticeForTest(): void {
  notice.resetForTest();
}
