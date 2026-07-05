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
