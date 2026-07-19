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

## 追補3: 画面表示でも末尾の空段・空ページを出さないようにする（＋小節を追加ボタン）

### 要望

- ユーザーいわく「今は音符のない行（空の段）が画面に2行ある。最後の音符がある小節がページの最後の
  小節であるべき。これは楽譜の作法」。印刷では追補1・2までで `print-hidden-system` /
  `print-hidden-page` により内容のない末尾の段・ページを除外できていたが、**画面表示**では
  従来どおり「内容＋常時2段ぶんの編集用空きバッファ」を丸ごと描画していたため、この作法を
  満たしていなかった。

### 修正方式: 画面描画対象を content ぶんに絞る「描画制限方式」

実データ（`rightHandData` 等）に空小節を直接 push する方式ではなく、**画面へ渡す `plannedRanges`
の範囲を絞る**方式を採用した（既存の幅計画・段分割ロジックをそのまま流用でき、実データ変更に
伴う Undo/保存への副作用を避けられるため）。

- `extraEditingSystems`（初期値0）という画面専用の state を追加。「＋ 小節を追加」ボタンを押すたびに
  1 ずつ増える。楽譜データそのものは変更しないため、履歴（Undo）には積まれない。
- `plannerMinimumWidths` の編集バッファ量を、常に「`extraEditingSystems + 2` 段ぶん」に変更
  （旧実装は常に固定 `2段ぶん`）。これにより「ユーザーが増やした段数＋常に1段ぶんの予備」を
  維持したまま `planSystemMeasureRanges` が十分な数の空きセグメントを計画できる。
- `visibleTotalSystems = printContentSystems + extraEditingSystems`（`plannedRanges.length` で
  クランプ）を算出し、`visiblePlannedRanges = plannedRanges.slice(0, visibleTotalSystems)` を
  画面のページ組み（`pages`）に使う。印刷用の `printContentSystems` / `printVisibleSystems` /
  `print-hidden-system` / `print-hidden-page` / `print-final-page(-single)` の算出ロジックは
  一切変更していない（従来どおり内容小節だけを基準に判定する）。
- 「＋ 小節を追加」ボタンは、画面に表示されている最後のページの譜面エリア内・最後の段の
  直後に置く（`i === visiblePages.length - 1` のページにだけ描画）。パート譜表示中
  （閲覧・印刷専用）は出さない。押すと `extraEditingSystems` が1増え、次の空きセグメントが
  画面に現れる。ボタンは薄いグレーの点線＋淡色文字の控えめな見た目にし、
  `@media print { .add-measures-ghost-button { display: none !important; } }` で印刷から除外する。
- 新規作成・localStorageからの読込・ファイルからの読込・サンプル読込では、直前の譜面用に
  増やした `extraEditingSystems` を 0 へリセットする（別の譜面を開いたときに前の譜面の
  空き段設定を引きずらないため）。

### 影響範囲

- `src/components/ScorePage.tsx`: `extraEditingSystems` state の追加、`plannerMinimumWidths` の
  編集バッファ量の変更、`visibleTotalSystems` / `visiblePlannedRanges` の追加と `pages` への適用、
  「＋ 小節を追加」ボタンの描画、`handleNewScore` / `handleLoad` / `handleImportFile` /
  `handleLoadSample` でのリセット処理。
- `src/App.css`: `.add-measures-ghost-button` のスタイルと、`@media print` 側での非表示ルール。
- 印刷側のロジック（`printContentSystems` / `finalMeasureIndex` / `print-final-page(-single)` /
  `StaveConnector` / `Barline.type.END` など）は無変更。終止線は引き続き最終内容小節に付く。

### 動作確認（追補3分）

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 68 Test Files / 896 Tests すべて成功（回帰なし）。
- ブラウザ確認（`complex-test-score.json`、repeatEnd 除去版）: 画面でも最終段（M47・M48、終止線付き）
  が譜面の最後になり、空の段・空のページが表示されないことを確認（最終ページの system 数が1つの
  みであることを DOM で確認）。「＋ 小節を追加」ボタンをクリックすると空の段が1段現れ、
  その中の音符をクリックして音符（M49）を配置できた。配置した音符は localStorage の保存データに
  も反映されることを確認（`measures[48].events` に音符データが入る）。Undo を押すと配置した音符
  だけが取り消され、追加した空の段自体は表示され続けることを確認（ボタン操作自体は履歴化されて
  いないことの裏付け）。
- ブラウザ確認（新規作成相当＝localStorage を空にしてリロード）: 従来どおり1段（4小節、全休符）が
  表示され、入力を続けられることを確認（`contentMeasureCount === 0` の最低1段ルールを維持）。
- ブラウザ確認（`print-test-score.json`、24小節）: 画面の段数がちょうど6段（24÷4）で終わり、
  後ろに空段が続かないことを確認。
- 印刷エミュレーション（`@media print` ルールを無条件適用）: 従来どおりの表示（青インク、
  最終段の下端寄せ）に回帰がないことを確認。「＋ 小節を追加」ボタンの `computedStyle.display`
  が `none` になっており、印刷に出ないことを確認。
- コンソールエラーなし。

## 追補4: 最終ページが1段だけのときは上揃えへ変更（2026-07-19）

追補2で「最終内容ページの可視段が1段だけのとき flex-end で下端へ寄せる」
としたが、実際の見た目を確認したユーザーから「1段だけのページは上揃えに
してほしい」との指摘を受けて方針を変更した。1段しかないページを下端へ
落とすと上が大きく空いて不自然であり、市販譜でも最終ページが1段だけの
場合は上に置いて下を余白のままにするのが通例のため。

- `.print-final-page-single .system-stack` を flex-end → **flex-start** に変更
  （@media print 内）。
- あわせて**画面表示にも同じルール**を追加（メディア指定なし）。通常ページの
  space-evenly だと1段だけのページでは段が縦中央へ浮いてしまうため、
  画面でも上揃えにして印刷と見た目を揃える。
- 可視段が2段以上の最終ページは従来どおり space-between（印刷時のみ、
  最後の段が下端へ付き終止線が右下角で締まる）。

検証: 画面・印刷エミュレーションの両方で justify-content: flex-start を確認、
1段（M47-48・終止線付き）がページ上部に配置され下が余白になること、
複数段ページ・他機能への回帰なし（vitest 896件成功）を確認。

## 追補5: タイトルのある1ページ目だけ段数を1段減らす（2026-07-19）

### 問題

市販譜では、タイトル・作曲者名などのヘッダーが載る1ページ目だけ、
ヘッダーぶんの余白を確保するために譜面の段数を他ページより1段減らして
組むのが作法。従来はどのページも `systemsPerPage` 段で固定だったため、
1ページ目だけタイトル分の余白を段の間隔で吸収するしかなく、市販譜と
比べて1ページ目の段間が窮屈に（あるいは他ページと不揃いに）見えていた。

### 修正設計

- ページごとの段数配分（「iページ目に何段入るか」「iページ目が何段目
  から始まるか」）を `src/utils/pageSystemLayoutUtils.ts` の純粋関数へ
  1か所に集約した。
  - `shouldReduceFirstPageSystems(options)`: タイトル・作曲者名の
    どちらかが空でなく、かつ `systemsPerPage > 1` のときだけ true。
    `systemsPerPage === 1` のときに減らすと0段（空ページ）になって
    しまうため、そのときだけ例外的に減らさない。
  - `getPageSystemsCapacity(pageIndex, options)`: pageIndex 番目の
    ページに入る段数。1ページ目だけ `systemsPerPage - 1`、それ以外は
    `systemsPerPage`。
  - `getPageSystemOffset(pageIndex, options)`: pageIndex 番目のページ
    より前に何段置かれているか（＝そのページの開始オフセット）。
    1ページ目だけ段数が異なりうるため、単純な `pageIndex * systemsPerPage`
    は使えず、必ず累積計算で求める。
  - `findPageIndexForSystem(targetSystemIndex, options)`: 「内容のある
    段の総数（0始まりの最後の段インデックス）」が何ページ目に収まるかを
    累積オフセットを1ページずつ進めながら探す（各ページの段数は必ず
    1以上のため有限回で終わる）。
- `ScorePage.tsx` 側は `pageSystemLayoutOptions`（`systemsPerPage` と
  `hasTitlePageHeader` をまとめたもの）を作り、上記関数の薄いラッパー
  （`getPageSystemsCapacity` / `getPageSystemOffset`）を `useCallback`
  で用意した。
  - `finalContentPageIndex` は `findPageIndexForSystem(printContentSystems - 1, ...)`
    で求めるよう変更（従来は `Math.floor((printContentSystems - 1) / systemsPerPage)`
    という固定段数前提の計算だった）。
  - `finalContentPageVisibleSystems` は `getPageSystemsCapacity` /
    `getPageSystemOffset` を使うよう変更。
  - `pages`（`PageSpec[]`）の組み立ても、固定幅の `Array.from({ length: ... })`
    + `slice(pageIndex * systemsPerPage, ...)` から、`getPageSystemsCapacity`
    で決まる可変長のオフセットを1ページずつ進めるループへ変更。
  - JSX 内の以下の箇所もすべて `i * systemsPerPage` 相当の掛け算を
    `getPageSystemOffset(i)` / `getPageSystemOffset(i + 1)` に置き換えた
    （`print-hidden-page` の判定、各 Staff コンポーネントの
    `printVisibleSystems` / `plannedMeasureWidths` の `slice` 範囲 /
    `startMeasureIndex` のフォールバック）。

### 影響範囲

- 画面表示・印刷の両方で、1ページ目の段数だけ `systemsPerPage - 1` に
  なる（タイトル・作曲者名が両方空のときは従来どおり全ページ同数）。
- `finalContentPageIndex` / `finalContentPageVisibleSystems` /
  `print-hidden-page` / `print-final-page` / `print-final-page-single`
  の判定はすべて累積オフセット経由になったため、1ページ目の段数が
  減っても最終ページの判定・上揃え/下揃えロジックは正しく動く。
- `systemsPerPage === 1` のときは1ページ目も1段のまま（0段にならない）
  ことをユニットテスト（`src/utils/pageSystemLayoutUtils.test.ts`）と
  ブラウザ確認の両方で担保した。

### 検証

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 69 Test Files / 910 Tests
  すべて成功（新規追加した `pageSystemLayoutUtils.test.ts` の14件を含む）。
- ブラウザ確認（localStorage の「複雑テスト楽譜」、段数/ページ=5）:
  DOM で `.print-page .system-stack` の子要素数を計測し、1ページ目=4段、
  2ページ目=5段、3ページ目（最終・`print-final-page`）=2段になることを
  確認。
- ブラウザ確認（段数/ページ=1）: 全ページ1段のままで、1ページ目が0段に
  ならないこと、最終ページに `print-final-page-single` が付くことを確認。
- ブラウザ確認（タイトル・作曲者名を両方空にする）: 1ページ目も他ページと
  同じ段数（5段）に戻ることを確認。
- コンソールエラーなし。
