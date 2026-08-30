// 「楽譜データがどこに保存されるのか」を初回に一度だけ知らせるための仕組み（Issue #497）。
//
// 背景: 実際の保存先はブラウザ（localStorage）と、書き出しでユーザーが選んだフォルダだけで、
// 譜面がサーバーへ送られることはない。ところがアプリはそれを一度も説明していなかったため、
// 「すぐ開けるということは、どこかに公開されているのでは」という不安が実機テストで出た。
// 運用者が口頭で説明すると解消した＝説明そのものには効果があるので、アプリ自身に説明させる。
//
// 方針: 「公開されていないことの証明」ではなく**事実の記述**に徹する。
// 表示は #318（#238/#306 由来）の通知系をそのまま流用し、既読だけをここで覚える。

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
 * すでに一度見たかどうか。
 * localStorage が使えない環境（プライベートブラウジング等）では例外を投げず「未読」を返す。
 * その場合は毎回出てしまうが、記述内容は常に正しく、アプリが起動しなくなるより無害である
 * （そもそも localStorage が使えない環境では自動保存自体が働かない）。
 */
export function hasSeenStorageLocationNotice(): boolean {
  try {
    return localStorage.getItem(STORAGE_LOCATION_NOTICE_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

/** 既読として記録する。保存に失敗しても致命的ではないので握りつぶす。 */
export function markStorageLocationNoticeSeen(): void {
  try {
    localStorage.setItem(STORAGE_LOCATION_NOTICE_SEEN_KEY, '1');
  } catch {
    // quota超過・プライベートブラウジング等。今回の表示が出ていれば目的は果たしている
  }
}

/**
 * このページ読み込み中に一度でも表示を始めたか（モジュール変数＝リロードで消える）。
 * React の StrictMode は effect を「実行→片付け→再実行」するため、「既読なら出さない」
 * だけの判定だと、1回目で既読が付き2回目が黙ってしまい、片付けで消去タイマーを失った
 * 通知だけが画面に残る（round1 P3）。「この読み込みで出し始めたなら、再実行でも
 * もう一度出し直す（＝タイマーも張り直す）」ためにここで区別する。
 */
let shownThisLoad = false;

/**
 * 通知を出してよいかを判定し、出すと決めたら既読も記録する（判定と記録を分けると
 * 呼び出し側の順序ミスで「既読だけ付いて表示されない」が起きるため、1関数にまとめる）。
 * @returns true なら呼び出し側は通知を dispatch する
 */
export function claimStorageLocationNotice(): boolean {
  if (!shownThisLoad && hasSeenStorageLocationNotice()) return false;
  shownThisLoad = true;
  markStorageLocationNoticeSeen();
  return true;
}

/** テスト専用: ページ読み込み内フラグを初期化する（テスト間の独立性のため） */
export function resetStorageLocationNoticeForTest(): void {
  shownThisLoad = false;
}
