// src/utils/yOffsetMigration.ts
// 手動Y補正（localStorage の 'yOffset'）の読み込みと、transform 移行に伴う一度だけのリセット。
//
// 背景（issue #13）:
// ページ縮小が CSS zoom だった頃、Safari の座標ズレを手動Y補正（実績値 +24）で
// しのいでいた利用者がいる。zoom → transform: scale への置き換えで座標は正しくなったが、
// 古い補正値が localStorage に残っていると、今度はその補正値ぶん逆方向へずれてしまう。
// （実機で確認済み: Intel Mac + 旧 Safari で +24 が残っており、削除したらピッタリ一致した）
//
// そこで「transform ビルドを初めて起動したとき」に一度だけ旧補正値をリセットする。
// リセット済みフラグを別キーで持つので、利用者が transform ビルド上で改めて設定した
// Y補正は二度と消さない。

export const Y_OFFSET_KEY = 'yOffset';
// このキーが立っていれば「transform ビルドでの初回リセットは実施済み」
export const Y_OFFSET_RESET_FLAG_KEY = 'yOffsetResetForTransformScale';

/**
 * 起動時に使う Y補正の初期値を返す。
 * transform ビルド初回起動なら、zoom 時代の古い補正値を破棄して 0 を返す。
 */
export function readInitialYOffset(): number {
  try {
    if (!localStorage.getItem(Y_OFFSET_RESET_FLAG_KEY)) {
      // 初回: 古い補正値が残っていても使わずに破棄する
      localStorage.removeItem(Y_OFFSET_KEY);
      localStorage.setItem(Y_OFFSET_RESET_FLAG_KEY, '1');
      return 0;
    }

    const v = parseFloat(localStorage.getItem(Y_OFFSET_KEY) ?? '0');
    return Number.isFinite(v) ? v : 0;
  } catch {
    // プライベートブラウジング等で localStorage が使えない場合は補正なしで動かす
    return 0;
  }
}
