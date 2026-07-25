# 印刷プレビューモード

## 問題

これまで「実際に印刷される見た目」は `window.print()` のブラウザ印刷ダイアログでしか確認できなかった。`App.css` の `@media print` ルールは印刷時にしか適用されないため、画面編集中に見えているレイアウトと、印刷/PDF書出で実際に出てくる見た目には差があった（例: ツールバー・警告表示・パディング休符・「＋小節を追加」ボタンなど編集専用UIの有無、線の太さ・インク色の統一、最終ページの段寄せなど）。レイアウト調整（ページ余白・段の間隔・段ごとの小節数など）をしながら印刷結果を確認するには、都度「PDF書出 / 印刷」を押してプレビューダイアログを開く必要があり、往復コストが高かった。

## 修正設計

### プレビューの ON/OFF

- `ScorePage.tsx` に `isPrintPreview`（`useState<boolean>`）を追加。「その他」タブの「PDF書出 / 印刷」ボタンの隣に「印刷プレビュー」トグルボタンを置き、押すたびに反転する。
- `isPrintPreview` が true のとき、ルート要素 `.app-root` に `print-preview` クラスを付与する。保存データには含めない画面専用の一時状態（`partExtractionId` などと同じ扱い）で、リロードで消えてよい。

### CSS: 重複定義（共通クラス化はしなかった判断）

`@media print { SEL { rules } }` を丸ごと「印刷時にもプレビュー時にも効くクラスベースのルール」へ一本化する案も検討したが、既存の `@media print` ブロックは 150 行超あり、`!important` を伴う多数のセレクタ（`.print-page svg path[stroke]...` 等）が絡み合っている。これを共通クラスへ括り出す場合、印刷側のセレクタ構造そのものを書き換える必要があり、印刷結果（既に運用実績のある挙動）を壊すリスクが大きいと判断した。

そのため今回は **`App.css` に `.print-preview` ブロックを別途追加する「重複定義」方式** を採用した（`@media print` ブロックの直後、`.print-final-page-single` 定義の手前に配置）。`.print-preview` 側は `@media print` の主要ルール（インク色統一・線の太さ・警告/ゴースト/パディング休符の非表示・紙面らしい影）をコメントで対応関係を明記しつつ複製している。将来 CSS カスタムプロパティやネストで一本化する余地は残るが、優先度は低いと判断した。

### 印刷と異なり「隠さない」もの

要件により、プレビュー中でもレイアウト調整だけは操作可能にする必要がある。`@media print` は編集用UI全体（`.toolbar`・`.system-measure-override-controls` など）を非表示にするが、`.print-preview` 側はこれらを意図的に踏襲しなかった:

- `.toolbar` はそのまま表示・操作可能（トグル自体もここにあるため隠すと操作できなくなる）。「その他」タブのページ余白・段の間隔・音符の大きさスライダー、段ごとの「◀ N小節 ▶」「間隔 −/＋」ボタンは通常モードと同じ input を共有しており、プレビュー中の変更もそのまま同じ state（`pageMarginSideMm` 等）を書き換える。Undo/Redo も既存の `pushHistorySnapshot` 経路にそのまま乗る。
- `.system-measure-override-controls` は非表示にせず、`opacity: 0.55`（hover/focus 時 1）の半透明フローティング行として残し、紙面の見た目を大きく邪魔しない程度に弱める。

一方、`.layout-overflow-alert` / `.add-measures-ghost-button`（編集専用の視覚補助で、印刷にも出ない要素）は `@media print` と同様に `.print-preview` でも非表示にする。

`.vf-padding-rest`（拍が埋まっていない小節の残り拍を示す表示専用のパディング休符）は、**以前はここでも非表示にしていたが、Issue #59 でその挙動自体がバグと判明したため方針を変更した**。詳細は次節を参照。

### ページ枠・改ページの可視化

`.print-page` は元々 A4 実寸（`210mm × 297mm`）で画面にも常時描画されており（`page-wrapper > .print-page { transform: scale(var(--scale,1)) }` で縮小表示）、ページ単位の改ページ位置は `pages` / `getPageSystemOffset`（`pageSystemLayoutUtils.ts`）が既に計算してレンダーしている。そのため新たにページ枠を再実装する必要はなく、`.print-preview .print-page` に `box-shadow` を足して「紙」らしさを強調し、`.print-preview .paper-rail` の背景をグレーにしてページ同士の境界（＝改ページ位置）が一目で分かるようにした。`.print-preview .spread` の `gap` も広げ、ページ区切りをより明確にしている。

### 全モード対応

`.print-preview` のルールはクラスセレクタのみで楽譜種別に依存しないため、単旋律・ピアノ・四重奏・編成譜のいずれでも同じ CSS がそのまま効く（`.print-page` / `.score-area` の DOM 構造は全モード共通のため）。ブラウザ確認では単旋律・ピアノの2種別で動作確認済み（四重奏・編成譜は CSS 適用ロジックが DOM 構造非依存のため未実機確認）。

### パディング休符（.vf-padding-rest）は隠さず黒で出す（Issue #59）

パディング休符（`PianoSystemCanvas` が拍の足りない小節・声部の残りへ表示専用で補う休符。詳細は README「拍が足りない小節・声部への表示用休符補完」節）には、当初 `@media print` / `.print-preview` の両方に `.vf-padding-rest { display: none !important; }` を置いていた。「未完成の小節をそのまま印刷物に残すと紙面が汚くなる」という想定だったが、実際には**小節の後半がただの空白として印刷される**という利用者側の不具合報告につながった。市販譜では埋まっていない拍にも休符を明示するのが作法であり、画面編集中に見えているグレーの休符がそのまま黒く出力される方が正しい挙動である。

そのため両ブロックから `display: none` の指定を削除した。色については新しいルールを追加する必要はなく、既存の「`svg path`/`line`/`g` 等の色を印刷インク色（既定 `#000`）へ強制する」ルール群（`@media print` 側は `!important` 付き、`.print-preview` 側は非 `!important`）がそのまま効く。理由: `PianoSystemCanvas` がパディング休符に設定する薄いグレー（`INACTIVE_VOICE_COLOR` = `#9ca3af`）は VexFlow の `SVGContext` が `fill`/`stroke` を**プレゼンテーション属性**として要素へ直接書き込む実装であり、`style` 属性ではない。CSS のカスケードではプレゼンテーション属性は最も優先度が低いため、`!important` の有無にかかわらずクラスセレクタによる `fill`/`stroke` 指定が上書きできる。よって `display:none` さえ外せば、既存の色統一ルールが自動的にパディング休符も黒くしてくれる（新規の色ルールを足す必要がない）。

画面（`.print-preview` が付いていない通常編集時）は従来通りグレーのまま変わらない。回帰確認は `src/AppCssPaddingRestPrint.test.ts`（CSS に `display:none` が残っていないことの静的チェック）と、ブラウザでの実地確認（`.print-preview` トグルON/OFFで `.vf-padding-rest` の `getComputedStyle(...).fill` が `rgb(156,163,175)` ⇄ `rgb(0,0,0)` に切り替わることを確認）で行った。

### 既知の未対応事項

- 編集UI（音符クリックでの選択・追加編集）自体はプレビュー中も無効化していない。要件では「無効化してよい」という許容表現だったため、実装コストとのバランスから今回は見送った。プレビュー中に誤って音符を編集できてしまう点は、次の改善候補として残る。
- CSS は共通クラス化ではなく重複定義のため、将来 `@media print` 側だけを修正して `.print-preview` 側の更新を忘れるとプレビューと実際の印刷がずれる可能性がある。修正時は両方のブロックを必ず一緒に見直すこと（本ファイルにその旨を明記）。

## 追補: 末尾の空段・空ページを隠すルールがプレビューに複製されていなかった不具合の修正（Issue #80）

### 問題

- 上記「既知の未対応事項」で警告していたとおりの不具合が実際に発生していた。`.claude/specs/final-barline/design.md`（終止線の自動表示）で導入された `print-hidden-system` / `print-hidden-page`（内容のない末尾の段・ページを印刷から除外する）と、最終ページの段配置（`print-final-page` / `print-final-page-single`）のクラスは、`@media print` 側にしか `display:none` / `justify-content` のルールが無く、`.print-preview` 側に複製されていなかった。
- そのため、`extraEditingMeasures`（「＋小節を追加」で画面にだけ表示する編集用の余り小節）が実際の印刷では正しく除外されているにもかかわらず、印刷プレビューをONにすると隠されずそのまま表示され、余り小節の量によっては丸ごと1ページぶん余計に出力されて見えるという不具合として報告された（Issue #80「印刷・印刷プレビューで、最終音符より後の全休符だけの小節が出力される」）。

### 修正

- `App.css` の `.print-preview` ブロックに、`@media print` 側と対応する以下のルールを追加した（本設計書が定めた「重複定義」方針どおり）。
  - `.print-preview .print-hidden-system { display: none !important; }`
  - `.print-preview .print-hidden-page { display: none !important; }`
  - `.print-preview .print-final-page(-single) .system-stack` の `flex` / `justify-content`（下端寄せ・上揃え）
- あわせて `src/utils/scoreDataEquality.ts` に `isPrintTrimmableMeasure` / `trimTrailingPrintableMeasures` を追加し、`ScorePage.tsx` の印刷可視範囲（`printVisibleContentSystems` とその派生値）の算出を、末尾に連続する「全休符だけの小節」（自動補完・誤操作などで実データに残った編集用の余り小節）も除外するよう拡張した。画面表示の内容境界（`contentMeasureCount` / `contentRanges` / `finalMeasureIndex`）は変更しておらず、印刷・印刷プレビューの可視範囲だけに影響する（詳細は `.claude/specs/final-barline/design.md` および README「印刷対応・PDFエクスポート」節を参照）。

### 影響範囲

- `src/App.css`: `.print-preview` ブロックへ `print-hidden-system` / `print-hidden-page` / `print-final-page(-single)` の複製ルールを追加。
- `src/utils/scoreDataEquality.ts` / `scoreDataEquality.test.ts`: `isPrintTrimmableMeasure` / `trimTrailingPrintableMeasures` の追加とテスト。
- `src/components/ScorePage.tsx`: `printContentMeasureCount` / `printVisibleContentSystems` を追加し、`print-hidden-page` の判定・`finalContentPageIndex` / `finalContentPageVisibleSystems` の算出・各 Staff への `printVisibleSystems` prop をこれらの値ベースに変更（`contentRanges` の基準である既存の `printContentSystems` はそのまま維持し、画面表示への影響を避けた）。
- `src/AppCssPrintPreviewHiddenSystems.test.ts`（新規）: `.print-preview` 側の複製ルールが存在することの静的チェック。

### 検証

- `docker exec -w <worktree> music-editer-dev npx vitest --run src`: 99 Test Files / 1169 Tests 中、失敗は `ScorePageEmptyStaveFiller.test.tsx` と `ScorePageSettingsProfile.test.tsx` の計2ファイル5件で、いずれも本修正を `git stash` で外した状態（origin/main 相当）でも同一内容で失敗する既知の環境依存タイムアウト・実測値flaky（共有Dockerコンテナの負荷でjsdomのcanvas計測がぶれる）であることを確認済み。新規追加テスト（`scoreDataEquality.test.ts` の追加分・`AppCssPrintPreviewHiddenSystems.test.ts`）はすべて成功。
- `npm run lint`: 353エラー・6警告（着手前と完全に同数、新規エラーなし）。
- `npm run build`: `tsc -b && vite build` エラーなし。
- ブラウザでの実地確認は未実施（共有Dockerコンテナの5173番ポートが既に別プロセスに使われており、本worktree用のポート公開手段が無かったため。PR #84/#85 と同じ既知の制約）。朝のレビューで、「＋小節を追加」で余り小節を数個表示 → 印刷プレビューON → 実際の印刷/PDF書出と同じページ数になることを実機確認していただきたい。
