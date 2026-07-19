# 終止線の自動表示 & 最終ページの最終段を下端へ寄せる

## 背景・問題

- 楽譜の最後の小節にも、途中の小節と同じ細い単線（`Barline.type.SINGLE`）しか描かれておらず、
  市販譜のような「曲の終わり」を示す終止線（細＋太の二重線）が出ない。
- 印刷時、末尾の空段・空ページは `print-hidden-system` / `print-hidden-page` で非表示にしているが、
  段自体は `.system-stack { justify-content: space-evenly }` で常にページ全体へ均等配置されるため、
  内容のある最後のページでは「最後の段の下に不自然な余白」が残り、終止線が紙面の右下角で
  締まって見えない。

## 修正設計

### 1. 終止線（final barline）

- ScorePage.tsx で「内容のある最後の小節」の絶対インデックスを
  `finalMeasureIndex = contentMeasureCount > 0 ? contentMeasureCount - 1 : undefined` として計算し、
  `contentMeasureCount`（`trimTrailingEmptyMeasures` 基準）の定義直後に置く。
  空の楽譜（内容小節が0）では `undefined` にして、どの Canvas にも終止線を出させない。
- `finalMeasureIndex` を prop として `PianoStaff` / `QuartetStaff` / `EnsembleStaff` /
  `PartExtractionStaff`（いずれも `PianoSystemCanvas` へ中継）と、単旋律の `StaffCanvas` へ
  そのまま橋渡しする（既存の `measureWidthEvenness` prop と同じ配線パターン）。
- `PianoSystemCanvas.tsx` / `StaffCanvas.tsx` の Stave 生成ループで、
  「その小節の絶対インデックス === finalMeasureIndex」かつ「その小節に `repeatEnd` が付いていない」
  場合だけ `stave.setEndBarType(Barline.type.END)` を使う（通常は `Barline.type.SINGLE`、
  `repeatEnd` があれば従来通り `Barline.type.REPEAT_END` を優先）。
  **終了リピートが優先される** のは、既存のリピート機能を壊さないため（要件どおり）。
- 多段譜（`PianoSystemCanvas`）では、各小節列ごとに第1段〜最終段を貫く `StaveConnector` を
  `StaveConnector.type.SINGLE_RIGHT` で描いている。終止線の列だけはこれを
  `StaveConnector.type.BOLD_DOUBLE_RIGHT` に切り替え、各段の個別終止線と揃った太い二重線を
  段をまたいで描く。VexFlow 5 では `StaveConnector.type` / `Barline.type` の双方に
  `END` / `BOLD_DOUBLE_RIGHT` が用意されており、追加実装や独自Pathは不要だった。
- 途中の段・途中のページには `finalMeasureIndex` に一致する小節が存在しないため、
  自動的に終止線は出ない（絶対インデックス比較のみで判定しているため、
  「最後の段だから」という位置ベースの誤判定は起きない）。

### 2. 最終ページの最終段をページ下端へ寄せる（印刷時のみ）

- `ScorePage.tsx` で `printContentSystems`（内容のある段の総数、最低1）から
  `finalContentPageIndex = Math.floor((printContentSystems - 1) / systemsPerPage)` を計算し、
  「内容のある最後のページ」の 0-indexed ページ番号を求める。
- 該当ページの `<section className="print-page ...">` にだけ `print-final-page` クラスを追加する
  （`print-hidden-page` と同様、`i === finalContentPageIndex` の比較のみで判定するため
  途中ページには絶対に付かない）。
- `App.css` の `@media print` 内に
  `.print-final-page .system-stack { justify-content: space-between; }` を追加。
  通常は `space-evenly`（App.css 側の `.score-area .system-stack` 既定値）で段を均等配置しているが、
  このページだけ最初の段を上端・最後の段を下端に固定し、`print-hidden-system` で消えた
  末尾の空段ぶんの余白を吸収する。段が1つしかない最終ページでは `space-between` でも
  単に上端に寄るだけで、崩れは発生しない。
- 画面表示（`print-final-page` を含め、`@media print` の外）には一切影響しない
  （編集用の空段は画面では従来通りそのまま見える）。

## 影響範囲

- `src/components/ScorePage.tsx`: `finalMeasureIndex` / `finalContentPageIndex` の算出、
  各 Staff ラッパー・`StaffCanvas`（単旋律の直書き分）への prop 中継、
  `print-page` の className への `print-final-page` 付与。
- `src/components/PianoSystemCanvas.tsx`: `finalMeasureIndex` prop 追加、
  Stave 生成ループでの `setEndBarType` 分岐、`StaveConnector` の種類分岐。
- `src/components/StaffCanvas.tsx`: `finalMeasureIndex` prop 追加、`setEndBarType` 分岐。
- `src/components/PianoStaff.tsx` / `QuartetStaff.tsx` / `EnsembleStaff.tsx` /
  `PartExtractionStaff.tsx`: `finalMeasureIndex` prop の中継のみ（描画ロジックの変更なし）。
- `src/App.css`: `@media print` 内に `.print-final-page .system-stack` ルールを追加。
- 保存データ・楽譜データ形式・既存のレイアウト計画（`plannedRanges` / `printContentSystems` /
  `measureWidthEvenness` / 段またぎスラー等）には変更なし。表示専用の追加機能。

## 動作確認

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 68 Test Files / 893 Tests すべて成功。
- ブラウザ確認（`complex-test-score.json` の末尾 `repeatEnd` を外したデータ）:
  最終小節（M48）の右端に終止線（細＋太）が表示され、それ以降の空小節には出ないことを確認。
- ブラウザ確認（`print-test-score.json`、末尾 `repeatEnd` あり）:
  終止線ではなく従来どおりの終了リピート記号が表示され、上書きされないことを確認。
- 印刷エミュレーション（`document.styleSheets` から `@media print` ルールを収集し
  `@media all` として再適用）で、内容のある最後のページの最後の段がページ下端側へ寄り、
  終止線を含む全要素が青系印刷インク色（`rgb(29, 78, 216)`）で描かれることを確認。
  途中ページは従来どおり段が均等配置されたまま変化しないことも確認。
- コンソールエラーなし。
