// 編集操作のコンソールログ（開発時のみ・実機テストの切り分け用）。
//
// テスト会で「押しても反応しない」が起きたとき、原因が
//   (a) クリックがそもそも処理に届いていない（当たり判定・レイヤー違い）
//   (b) データには登録されたが描画されない（今日の 8va 開始のみ問題の型）
// のどちらかを、DevTools のコンソールだけで切り分けられるようにする。
//
// - [編集] … クリックの処理結果。届いていれば必ず1行出る（console.info）
// - [描画] … 描画パスごとの記号エントリ数（console.debug＝既定で畳まれるレベル。
//             再描画のたびに出るので、通常は騒がしくならない Verbose に置く）
//
// 本番ビルドでは何も出さない（import.meta.env.DEV ガード。
// UI案バッジと同じ型で、判定はビルド時に定数化されコードごと落ちる）。

export function logEditOp(action: string, detail: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.info(`[編集] ${action}`, detail);
}

export function logRenderPass(summary: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.debug('[描画]', summary);
}
