// src/utils/appVersion.ts
// アプリのバージョン表示（Issue #500 受入条件7）。
// 値は vite.config.ts の define で package.json の version から埋め込む
// （画面側に版番号を手書きすると更新を忘れ、リリースノートと突き合わせられなくなる）。

/**
 * 表示用のアプリバージョン（例: `3.6.0`）。
 * `__APP_VERSION__` は vite が置き換えるビルド時定数なので、
 * 置き換えが効かない環境（define を通さない実行）でも落ちないように
 * typeof で存在を確かめてからフォールバックする。
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : '0.0.0';

/** フッターなどに出す表記（例: `v3.6.0`）。「v」の付け方を1か所にそろえる */
export function formatAppVersion(version: string = APP_VERSION): string {
  return `v${version}`;
}
