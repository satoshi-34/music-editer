// 「アプリの一生で一度だけ出す通知」の共通部品（Issue #524 で切り出し）。
//
// Issue #497（起動時の保存先の説明）が最初にこの形を作った。今回そこへ
// 「音符を初めて選択したときの矢印キーの案内」（Issue #524）が加わったため、
// **同じ判定ロジックの2枚目を書かない**ように共通化した。
// 2枚に分かれると、片方だけ直したときに「一方は StrictMode で黙る」といった
// 食い違いが生まれる（このリポジトリでは #223→#280 で実際に起きた形）。
//
// 表示そのものは #318（#238/#306 由来）の通知系（notifyScoreEdit）を使い、
// ここが覚えるのは「もう見たかどうか」だけ。

/** 一度きりの通知1つぶんの操作。呼び出し側は基本 claim() だけを使う。 */
export type OnceNotice = {
  /** すでに一度見たか（localStorage が使えない環境では常に false＝未読） */
  hasSeen: () => boolean;
  /** 既読として記録する */
  markSeen: () => void;
  /**
   * 出してよいかを判定し、出すと決めたら既読も記録する（**マウント時に出す通知**用）。
   * StrictMode の「実行→片付け→再実行」でも true を返し続ける。
   */
  claim: () => boolean;
  /**
   * 同じく判定＋記録だが、こちらは一度出したらこの読み込み中も二度と true を返さない
   * （**ユーザー操作をきっかけに出す通知**用）。
   */
  claimStrict: () => boolean;
  /** テスト専用: ページ読み込み内フラグを初期化する */
  resetForTest: () => void;
};

/**
 * localStorage のキー1つに紐づく「一度きりの通知」を作る。
 *
 * @param storageKey 既読フラグの localStorage キー
 *   （他の設定キーと同じ `music-score-app-` 接頭辞にそろえること）
 */
export function createOnceNotice(storageKey: string): OnceNotice {
  /**
   * このページ読み込み中に一度でも表示を始めたか（モジュール変数＝リロードで消える）。
   * React の StrictMode は effect を「実行→片付け→再実行」するため、「既読なら出さない」
   * だけの判定だと、1回目で既読が付き2回目が黙ってしまい、片付けで消去タイマーを失った
   * 通知だけが画面に残る（#497 round1 P3）。「この読み込みで出し始めたなら、再実行でも
   * もう一度出し直す（＝タイマーも張り直す）」ためにここで区別する。
   */
  let shownThisLoad = false;

  /**
   * claimStrict がこの読み込み中に一度 true を返したか。永続化（markSeen）が
   * quota 超過等で失敗しても、「同じ読み込み中は二度と出さない」契約を守るために
   * メモリ側でも覚える（round1 P2: 書き込み失敗環境で選択のたびに出てしまう）。
   */
  let strictClaimed = false;

  /**
   * localStorage が使えない環境（プライベートブラウジング等）では例外を投げず「未読」を返す。
   * その場合は毎回出てしまうが、アプリが起動しなくなるより無害である
   * （そもそも localStorage が使えない環境では自動保存自体が働かない）。
   */
  const hasSeen = (): boolean => {
    try {
      return localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  };

  /** 既読として記録する。保存に失敗しても致命的ではないので握りつぶす。 */
  const markSeen = (): void => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // quota超過・プライベートブラウジング等。今回の表示が出ていれば目的は果たしている
    }
  };

  return {
    hasSeen,
    markSeen,
    // 判定と記録を分けると呼び出し側の順序ミスで「既読だけ付いて表示されない」が
    // 起きるため、1関数にまとめてある。
    claim: () => {
      if (!shownThisLoad && hasSeen()) return false;
      shownThisLoad = true;
      markSeen();
      return true;
    },
    // ユーザー操作がきっかけの通知（音符を選ぶ等）は、操作のたびに effect が
    // 走り直すため claim の「この読み込み中は出し直す」逃がしを使うと毎回出てしまう。
    // そちらは消去タイマーを自前で持たない（表示は通知系に任せきり）ので、
    // StrictMode の再実行で出し直す必要も無い。だから既読だけで判定する。
    claimStrict: () => {
      if (strictClaimed || hasSeen()) return false;
      strictClaimed = true;
      markSeen();
      return true;
    },
    resetForTest: () => {
      shownThisLoad = false;
      strictClaimed = false;
    },
  };
}
