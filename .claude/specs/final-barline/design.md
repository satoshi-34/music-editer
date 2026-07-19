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

## 追補: 最終内容小節が段の右端まで届かない不具合の修正

### 症状

- レビュー実測で判明: `complex-test-score`（末尾 `repeatEnd` 除去版、内容48小節）を読み込むと、
  最終内容段（終止線が付く段）が「M47・M48（終止線付き）・空小節・空小節」の4小節構成になり、
  終止線の右側に編集用の空きバッファ小節2つが続いて段の右端まで伸びてしまっていた。
  終止線自体はM48の右に正しく描かれるが、「最終小節が段の右端（＝印刷でページ右下角）で終わる」
  という要件を満たしていなかった。

### 原因

- `planSystemMeasureRanges`（`measureLayoutUtils.ts`）は「内容48小節＋編集バッファの空小節」を
  区別せず、単純に希望小節数（既定4）ずつ貪欲に段を切っていた。そのため、内容の終わり（48小節目）が
  ちょうど段の境界と一致しない場合、最終内容小節と直後の編集バッファ小節が同じ段に混在していた。

### 修正

- `planSystemMeasureRanges` に第4引数 `breakAt?: number` を追加。指定した絶対小節インデックスを
  段の強制的な打ち切り位置として扱い、`start < breakAt < start + maxCount` のときだけ
  `maxCount` を `breakAt - start` に縮める（`breakAt` がちょうど段境界と一致する、または
  範囲外のときは従来と同じ挙動のまま変化しない）。
- `ScorePage.tsx` の `plannedRanges` 算出で、`breakAt` に `contentMeasureCount`（内容が1小節以上ある
  場合のみ。0のときは `undefined` で従来どおり）を渡す。これにより「内容のある最後の小節を含む段」は
  そこで必ず打ち切られ、編集バッファの空小節は次の段以降に回る。段内の小節幅配分（`allocateCombinedMeasureWidths`）
  は既存ロジックのまま段の右端までジャスティファイするため、追加の実装なしで最終小節が段の右端に届く。
- 画面での「末尾に空段があって入力を続けられる」UXはそのまま維持（空段自体はページの後段・次ページに残る。
  最終内容段にだけ混ざらなくなる）。

### テスト追加

- `src/utils/measureLayoutUtils.test.ts` に3ケース追加:
  1. `breakAt` が段境界と一致する場合は結果不変（56小節、breakAt=48 で 44-47 の段はそのまま4小節）
  2. `breakAt` が段の途中に来る場合はそこで打ち切られる（55小節、breakAt=47 で 44-46 の3小節に短縮）
  3. `breakAt` が既存の段境界（24小節・4小節/段）と完全一致する場合は `breakAt` なしの結果と完全一致

### 動作確認（追補分）

- `docker compose run --rm app npx tsc --noEmit`: エラーなし
- `docker compose run --rm app npx vitest run`: 68 Test Files / 896 Tests すべて成功
  （既存893 + 追加3。SaveLoadButtons.test.tsx の既知flakyは今回発生せず）
- ブラウザ確認: `complex-test-score.json`（末尾 `repeatEnd` 除去）で最終内容段が
  「M47・M48（終止線付き）」の2小節のみとなり、終止線が段の右端に接することを確認。
  それ以降の空小節は次の段（print-hidden-system で印刷時のみ非表示）へ回っている。
- ブラウザ確認: `print-test-score.json`（24小節＝4の倍数、breakAtが段境界と一致するケース）で
  最終内容段が従来どおり4小節のまま変化しないことを確認（回帰なし）。
- 印刷エミュレーション（`@media print` ルールを無条件適用）で、最終内容ページの最終段（M47・M48のみ）
  がページ下端側に寄り、青インク（`rgb(29,78,216)`）の終止線が右下角に来ることをスクリーンショットで確認。
- コンソールエラーなし。

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

## 追補2: 最終内容ページの可視段が1段だけのとき下端に付かない不具合の修正

### 症状

- 追補1の修正（`breakAt` による段分割）の結果、`complex-test-score`（`repeatEnd` 除去版）では
  最終内容ページ（`print-final-page`）の可視段が **1段だけ**（M47・M48）になった。
  `justify-content: space-between` は flex の子が1つだけだと上端に寄る仕様のため、
  実測で最終段の下端からページ下端まで約795pxの空きが残り、
  「終止線がページ右下角に来る」という要件を満たしていなかった。
  最終ページに2段以上残る `print-test-score` では space-between が正しく機能しており、
  この不具合は「最終ページの可視段がちょうど1段になる」エッジケース限定だった。

### 修正

- `ScorePage.tsx` に `finalContentPageVisibleSystems`
  （`printContentSystems - finalContentPageIndex * systemsPerPage` を 0〜`systemsPerPage` へクランプした値）
  を追加し、最終内容ページの可視段数を算出する。
- その値が `1` のときだけ、`print-final-page` に加えて `print-final-page-single` クラスを付与する。
- `App.css` の `@media print` に `.print-final-page-single .system-stack { justify-content: flex-end; }`
  を追加。可視段が1段だけのページはこちらが効いて段を丸ごと下端へ寄せる。
  2段以上のページは従来どおり `.print-final-page .system-stack { justify-content: space-between; }`
  のままとし、`space-between` と `flex-end`／`margin-top:auto` を同時に使わない
  （space-between との併用は複数段時に段間の間隔が崩れるため避ける）。
- 画面表示には影響しない（`print-final-page-single` は `@media print` の外では何もしない）。

### 動作確認（追補2分）

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 68 Test Files / 896 Tests すべて成功（回帰なし）。
- 印刷エミュレーション（`@media print` ルールを無条件適用）で実測:
  - `complex-test-score.json`（repeatEnd 除去、最終ページ可視段1段）:
    `print-final-page-single` が付与され、最終段の下端とページ下端の隙間は **約45.4px**
    （修正前は約795px）。他ページの先頭余白と同程度の自然な下マージンに収まった。
  - `print-test-score.json`（最終ページ可視段2段、従来の space-between のまま）:
    `print-final-page-single` は付与されず、最終段の下端とページ下端の隙間は **約45.4px**
    （1段ケースと同じ値で一致、上端の隙間は約143.6px）。回帰なし。
- 画面表示（`@media print` 適用前）は変化なし。
- コンソールエラーなし。
