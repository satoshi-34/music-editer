# 設計書: 新規譜面作成

## 問題

保存・読込 UI には既存譜面を保存スロットへ保存する操作と、保存スロットから復元する操作はあったが、現在の編集内容を破棄して空の譜面から始める入口がなかった。ユーザーが新しい譜面を作りたい場合、手作業で各小節やメタ情報を消す必要があり、保存済みデータも残ったままになるため、読込操作で古い譜面に戻ってしまう。

## 修正設計

- `SaveLoadButtons` に任意の `onNewScore` props を追加し、渡されたときだけ「新規作成」ボタンを表示する。
- `ScorePage` に `handleNewScore` を追加し、確認ダイアログ後に `useScoreStorage.clearStoredData()` で `PRIMARY / BACKUP / METADATA` の保存スロットを消去する。
- 画面状態は空の単旋律譜へ戻す。対象はメタ情報、楽譜種別、編成、表示モード、調号、拍子、段あたり小節数、各パートの小節データ、選択範囲、コピー内容、Undo/Redo、再生位置、再生状態。
- ファイル保存ハンドルも破棄し、新規譜面のファイル保存が以前開いたファイルを意図せず上書きしないようにする。
- `StaffCanvas` / `PianoSystemCanvas` は、親から渡された空配列を「データなし」ではなく「空譜へリセットする明示指示」として扱う。これにより、内部 state に残った古い音符が新規作成後も表示され続ける問題を防ぐ。

## 影響範囲

- `src/components/SaveLoadButtons.tsx`: 新規作成ボタンの表示責務を追加。
- `src/components/ScorePage.tsx`: 保存スロット消去と画面状態初期化の責務を追加。
- `src/components/StaffCanvas.tsx`, `src/components/PianoSystemCanvas.tsx`: 空配列での親データ同期に対応。
- `src/components/SaveLoadButtons.test.tsx`: 新規作成ボタンの表示と既存ツールチップ文言を確認。
- 依存ライブラリの追加はなし。

## 追補: 確認ダイアログを `window.confirm` からアプリ内モーダルへ置き換え（Issue #221）

### 問題

`handleNewScore` は `window.confirm` の戻り値で分岐していた。埋め込みブラウザ（CDP 制御下のブラウザ・
一部の WebView・キオスク環境）では confirm のダイアログがそもそも表示されず、呼び出しは即座に
`false` を返す。その結果「新規作成」ボタンは**何のフィードバックも出さずに無反応**になっていた
（運用者の実機テストで発見。`window.confirm = () => true` を注入するとその後は正常に動作したため、
confirm 以外の経路は健全であることも確認済み）。

### 修正設計

- `src/components/ConfirmDialog.tsx` を新設。React で描く汎用の確認ダイアログで、
  `message` / `onConfirm` / `onCancel` を受け取り、ボタン文言（`confirmLabel` / `cancelLabel`）と
  `aria-label` は任意で差し替えられる。他の `window.confirm` 箇所からも使い回せる粒度にしてある
- 表示は `createPortal` で `document.body` 直下へ。ツールバーは `overflow` とページ拡縮の
  `transform` の中にあり、その内側で描くとダイアログが切られたり位置がずれたりするため
  （パート編集ウィンドウ・Issue #66 と同じ理由）
- キーボード: **Enter=OK / Esc=キャンセル**。開いた直後は OK ボタンへフォーカスを当てる。
  Enter は「ボタンにフォーカスがあるときはブラウザ標準の押下に任せ、それ以外の場所に
  フォーカスがあるときだけ肩代わりする」形にして、二重発火を避けている
- `ScorePage` に `confirmDialog` state（`{ message, onConfirm }` または `null`）を持たせ、
  `handleNewScore` は「確認内容を積むだけ」に変更。実際の処理は `performNewScore` へ切り出した。
  OK 押下時は**先にダイアログを閉じてから**本体を走らせる（本体は画面全体を作り直す重い処理のため、
  閉じるのを待つと「押したのに閉じない」ように見える）
- 文言は `window.confirm` 時代から変更なし（`NEW_SCORE_CONFIRM_MESSAGE` として定数化）
- 見た目は `App.css` の `.confirm-dialog-overlay` / `.confirm-dialog` 系。カスタム記号エディタ
  （SymbolEditor, z-index 2000）より前面（2100）に出す

### `window.confirm` の残件（今回は置き換えていない箇所）

`grep -rn "window.confirm" src/` で見つかった全箇所は次のとおり。**今回置き換えたのは新規作成のみ**で、
残りは別 Issue 化の対象（この節が棚卸しの正本）。

| 箇所 | 用途 | 状態 |
| --- | --- | --- |
| `src/components/ScorePage.tsx` `handleNewScore` | 新規作成の確認 | **Issue #221 でアプリ内ダイアログへ置き換え済み** |
| `src/components/WorkListPanel.tsx` `handleDelete` | 作品一覧からの作品削除の確認 | 未対応。埋め込みブラウザでは confirm が false を返し「削除できない」＝安全側に倒れるため緊急度は低いが、無反応であることに変わりはない |
| `src/components/WorkListPanel.test.tsx` | 上記のテストでの `window.confirm` モック | 上の置き換えに追随して更新する |

### 影響範囲

- `src/components/ConfirmDialog.tsx`: 新規追加。
- `src/components/ScorePage.tsx`: `confirmDialog` state の追加、`handleNewScore` の分割
  （確認を出すだけ／本体は `performNewScore`）、`handleCreateWorkFromList`（作品一覧の「新規作成」）が
  同じ経路を通るよう非同期を外した。
- `src/App.css`: 確認ダイアログのスタイルを追加。
- `src/components/ScorePageNewScoreConfirm.test.tsx`: 新規追加。**`window.confirm` が常に `false` を返す
  環境**（＝不具合が起きていた環境）を再現したうえで、ダイアログ表示・OK・キャンセル・Enter・Esc・
  初期フォーカスを確認する。
- `src/components/ScorePageSettingsProfile.test.tsx`: 「新規作成」を押したあとダイアログの OK まで
  押すようヘルパーを更新。
- 依存ライブラリの追加はなし。
