// src/utils/homeVisibility.ts
// 「いまホーム画面が前面に出ているか」の共有フラグ（Issue #500 round1 P1）。
//
// 譜面画面はホームの下でマウントされたままなので、window / document に付けた
// キーボードショートカット（削除・貼り付け・Undo 等）はホーム表示中も生きている。
// そのまま押されると**見えない譜面を編集して自動保存までされる**ため、
// 各ショートカットの入口でこのフラグを見て無視する。
//
// React の state ではなくモジュール変数にしているのは、購読者が
// ScorePage / PianoSystemCanvas / SymbolEditor と離れた場所の window リスナーで、
// props で配ると中継だらけになるため。書くのは App（ホームの表示切替）だけ。

let homeShown = false;

/** App だけが呼ぶ。ホームの表示状態を共有フラグへ反映する */
export function setHomeShown(shown: boolean): void {
  homeShown = shown;
}

/** ホームが前面に出ているか（＝譜面画面のショートカットを無視すべきか） */
export function isHomeShown(): boolean {
  return homeShown;
}

/**
 * キーボードショートカットのリスナーを「ホーム表示中は無視する」形に包む。
 * add/removeEventListener で同じ参照を使えるよう、包んだ関数を1度だけ作って使うこと。
 */
export function ignoreWhenHomeShown(handler: (e: KeyboardEvent) => void): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (isHomeShown()) return;
    handler(e);
  };
}
