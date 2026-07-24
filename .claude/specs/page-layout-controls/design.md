# ページレイアウト調整機能（余白・段の間隔）

## 問題

これまで印刷ページの左右余白（14mm固定）・上下余白（上14mm/下12mm固定）・段と段の間隔（0固定、行グリッドの等分のみ）はすべてハードコードされており、ユーザーが調整する手段がなかった。特に左右余白は `App.css` の `.print-page { padding: 14mm 14mm 12mm; }` と、`src/utils/measureLayoutUtils.ts` の `PRINT_SCORE_AREA_WIDTH_PX = 182 * (96/25.4)`（= 210mm − 14mm×2 の本文幅を前提にした固定値）という、CSSとJSの二重定義になっていた。

## 修正設計

### 正本の一本化（左右余白 → 本文幅の予算）

- `measureLayoutUtils.ts` に `DEFAULT_PAGE_SIDE_MARGIN_MM = 14` と、`printScoreAreaWidthPx(sideMarginMm = DEFAULT_PAGE_SIDE_MARGIN_MM)` を追加。本文幅は常に `(210 - sideMarginMm*2) * (96/25.4)` として計算する。
- `worstCaseSystemContentBudget(sideMarginMm = DEFAULT_PAGE_SIDE_MARGIN_MM)` も同じ余白引数を受け取るようにし、小節の自動改段（`planEffectiveMeasuresPerSystem` / `planSystemMeasureRanges`）へ渡す予算をこの値から算出する。
- 旧来の `PRINT_SCORE_AREA_WIDTH_PX` 定数は「既定余白14mm時の値」として後方互換のために残した（`printScoreAreaWidthPx()` の引数省略時と同じ値）。

### CSS への受け渡し（CSS変数）

- `ScorePage.tsx` がユーザー設定（`pageMarginSideMm` / `pageMarginVerticalMm` / `systemRowGapPx`、いずれも localStorage 保存）を state として持ち、`<section className="print-page">` に `--page-margin-side` / `--page-margin-top` / `--page-margin-bottom` を、`.score-area` に `--system-row-gap` をインラインスタイルとして注入する。
- `App.css` 側は `padding: var(--page-margin-top, 14mm) var(--page-margin-side, 14mm) var(--page-margin-bottom, 12mm);` と `.score-area .system-stack { gap: var(--system-row-gap, 0px); }` のように、値をそのまま消費するだけにし、CSSとJSでの二重定義を避けた。
- 上下余白は当初「上 padding の値」を1本のスライダーで直接動かし、下 padding は常に「上 − 2mm」を保つ仕様だった（従来の 14mm/12mm という2mm差を維持し、既定値のときに完全に元のレイアウトへ戻るようにするため）。**この仕様は後日「余白(上)」「余白(下)」の2本に分離した。詳細は本ファイル末尾の追補（2026-07-20）を参照。**

### 段数/ページ上限（maxSystemsPerPage）との連動

- `SCORE_AREA_BUDGET_PX = 938px` は「上14mm/下12mm（合計26mm）」時の実測値。上下余白スライダーで合計が変わった分だけ mm→px 換算（96/25.4）で budget を増減する。
- 段の間隔（`systemRowGapPx`）は、1段あたりの高さ見積もり（`baseHeight * notationSizeMultiplier`）に加算してから budget で割ることで、間隔を広げるほど自動的に段数上限が下がるようにした（安全側の近似: 本来は `(N-1)*gap` だが `N*gap` 相当で見積もっている）。

### 小節幅配分の実際の再描画（バグ修正込み）

余白変更で `.score-area` の実際の DOM 幅（`clientWidth`）はすぐ変わるが、`PianoSystemCanvas.tsx` / `StaffCanvas.tsx` の VexFlow 描画 `useEffect` は `ref.current.parentElement.clientWidth` を副作用の実行時に一度読むだけで、依存配列に幅を含んでいなかった。そのため従来は「ページは固定 210mm なのでマウント後に幅が変わることがない」という前提が成り立っていたが、余白スライダーの追加によりこの前提が崩れ、**余白を広げても小節が古い（狭い前の）幅のまま再描画されず、右余白へはみ出す**バグが発生した。

対策として両コンポーネントに `ResizeObserver` を追加し、`ref.current.parentElement` の幅変化を検知して `containerWidthTick` という state を更新、これを描画 `useEffect` の依存配列に加えることで、余白変更時にも正しく再描画・再配分されるようにした（テスト環境 jsdom に `ResizeObserver` が無い場合は何もしない安全なガード付き）。

## 追補: ResizeObserver 単独では再描画が漏れるケースの修正

レビューで、「段数/ページ5・音符100%・レイアウト既定」から「余白(左右)」を14→22mmへ変更すると、**1ページ目の先頭2段（PianoSystemCanvas インスタンス）だけ**旧幅のまま再描画されず右余白へはみ出す、というバグが再現性を持って見つかった。

調査の結果、ResizeObserver 自体は多くのケースで機能していたが、スコア読込直後の最初の余白変更など特定のタイミングでは、特定のインスタンスの ResizeObserver コールバックが発火しないケースがあることを実測で確認した（原因はブラウザ/Reactのコミットタイミングに依存するレースで、再現条件を完全には特定できなかった）。ResizeObserver だけに頼ると「発火しなければ永久に古い幅のまま」というフェイルセーフのない失敗モードになるため、決定的な対策として以下を追加した。

- `ScorePage.tsx` の `pageMarginSideMm`（余白(左右)の現在値）を、`PianoStaff` / `EnsembleStaff` / `QuartetStaff` / `PartExtractionStaff` / 直接呼び出しの `StaffCanvas` を経由して末端の `PianoSystemCanvas` / `StaffCanvas` まで、既存の `measureWidthEvenness` と全く同じパターンで props として中継する。
- 両コンポーネントの描画 `useEffect` の依存配列に `pageMarginSideMm` を追加する。値そのものは描画計算に使わないが、余白が変わるたびに React の通常の props 比較で確実にこの effect が再実行され、その時点の `ref.current.parentElement.clientWidth`（既に新しい padding が反映済み）を読み直すようになる。
- ResizeObserver（`containerWidthTick`）はそのまま残し、二重の対策とした（ウィンドウのブラウザズームなど、余白スライダー以外の要因で親要素の幅が変わるケースにも追従できるようにするため）。

この方式は React の再レンダー・エフェクト実行という確定的な経路に乗るため、タイミング依存のレースが原理的に発生しない。

## 追補: 段の間隔をマイナス方向にも調整できるようにする

「段の間隔を狭くできるようにしたい」という要望を受け、スライダーの範囲を 0〜30px から **−30〜30px** へ拡張した。

### 問題

CSS の `gap` プロパティは負値を受け付けない（無効な宣言として無視される）。加えて、既存の行グリッド（`.score-area .system-stack { flex: var(--page-capacity,1) 1 0%; } .system-stack > * { flex: 1 1 0%; }`）は「段を常に均等配分でページの残り高さぴったりまで埋める」設計のため、`gap` を機械的に負値化できたとしても、flex-grow が空いた分を埋め直してしまい、段同士の間隔は見た目上ほとんど縮まらない（実測: equal-fill のまま負のマージンだけ足すと、期待した−30pxの変化に対して実際の間隔変化は−7px程度にしかならなかった）。

### 修正設計

- `systemRowGapPx < 0` のときだけ、`ScorePage.tsx` が `.score-area` へ `score-area--tight-rows` 修飾クラスを付与する（`className={`score-area${systemRowGapPx < 0 ? ' score-area--tight-rows' : ''}`}`）。
- `App.css` に以下を追加し、tight-rows のときだけ行グリッドの挙動を「等分配置」から「内容の実サイズで上から詰める」方式へ切り替える。
  ```css
  .score-area--tight-rows .system-stack { gap: 0; }
  .score-area--tight-rows .system-stack > * { flex: 0 0 auto; }
  .score-area--tight-rows .system-stack > * + * { margin-top: var(--system-row-gap, 0px); }
  ```
  - `flex: 0 0 auto` により各段のボックス高さは中身（VexFlowが描く SVG）の実サイズに一致し、equal-fill による伸縮がなくなる。
  - 段と段の間には `margin-top`（CSS の margin は負値を許容する）で `--system-row-gap` をそのまま適用し、間隔を実際に狭める。
  - 段を伸縮させないぶん、詰めた高さの余りは `.system-stack` の下部にそのまま残る（＝「段はページ上部から詰めて並べ、余りはページ下部に残る」という要件どおり。市販譜で行間を詰めると下側が余るのと同じ考え方）。
  - 0px 以上のときは従来どおり `gap: max(0px, var(--system-row-gap, 0px))` と `flex: 1 1 0%`（equal-fill）のままなので、既存の挙動・見た目は一切変わらない。
  - 最終ページ専用の配置（`.print-final-page` / `.print-final-page-single` の `justify-content: space-between` / `flex-start`）は元々 `flex: 0 0 auto !important` で「実サイズ＋justify-content」方式だったため、tight-rows の margin-top 追加とも自然に両立し、既存の下端寄せ・上揃えの挙動はそのまま維持される。
- 段数/ページ上限の計算式（`maxSystemsPerPage = floor(effectiveBudgetPx / (baseHeight * notationSizeMultiplier + systemRowGapPx))`）はそのままで対応できる。`systemRowGapPx` が負になるほど分母が小さくなり、上限が自動的に増える方向へ働く。分母が0以下にならないことは、既存の `BASE_SYSTEM_HEIGHT_PX`（最小114px）に対してスライダー下限を−30pxに留めていることで保証している。
- `SYSTEM_ROW_GAP_MIN_PX` を `0` から `-30` に変更（`SYSTEM_ROW_GAP_MAX_PX` は30のまま）。

### 検証結果（追加分）

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 69ファイル918テスト全緑（既存テストの変更なし）。
- ブラウザ実測（「複雑テスト楽譜」、音符の大きさ100%、段数/ページ5）:
  - 段の間隔 0px → 隣接段の svg 間の距離 約−13.8px（既存の equal-fill のベースライン。VexFlow の余白により svg のバウンディングボックス同士がわずかに重なるのは元から）。
  - 段の間隔 −30px → `score-area--tight-rows` が付与され、`margin-top: -30px` が適用されることを確認。隣接段の svg 間の距離は約−21.2px（負方向にさらに約7.4px縮む）。スクリーンショットで五線・符幹が隣接段と視覚的に重ならないことを目視確認。
  - `.system-stack` 内で最後の段の下に約12.7pxの余白が残ること（＝上から詰めて、余りが下部に残る）を実測確認。
  - 段の間隔 −30px/0px/+30px で「段数/ページ」の入力欄 `max` 属性がそれぞれ 6 / 5 / 4 となり、マイナス方向で上限が増えることを確認。
  - 「レイアウトをリセット」で段の間隔が 0px に戻り、`score-area--tight-rows` クラスが外れて元の equal-fill 表示に戻ることを確認。
  - コンソールエラーなし。
  - 印刷（`@media print`）側は `.print-final-page` 等の既存ルールを変更しておらず、`--system-row-gap` とtight-rowsクラスの適用はscreen/print共通のインラインスタイル・通常クラスのため、印刷にもそのまま反映される（画面と同じCSS変数を使う既存の設計を踏襲）。

## 影響範囲

- `src/utils/measureLayoutUtils.ts`: `printScoreAreaWidthPx` / `worstCaseSystemContentBudget` の余白引数化。
- `src/components/ScorePage.tsx`: 余白・段間隔の state、`maxSystemsPerPage` の連動計算、CSS変数の注入、「その他」タブの新UI（余白左右・余白上下・段の間隔・レイアウトをリセット）。
- `src/App.css`: `.print-page` の padding、`.score-area .system-stack` の gap を CSS 変数化。
- `src/components/PianoSystemCanvas.tsx` / `src/components/StaffCanvas.tsx`: 親要素の幅変化を検知して再描画する `ResizeObserver` を追加（既存のリサイズ非対応バグの修正を兼ねる）。加えて `pageMarginSideMm` props を描画 `useEffect` の依存配列に追加し、ResizeObserver 単独では発火が漏れるケースの決定的な対策とした。
- `src/components/PianoStaff.tsx` / `EnsembleStaff.tsx` / `QuartetStaff.tsx` / `PartExtractionStaff.tsx`: `pageMarginSideMm` props を `measureWidthEvenness` と同じパターンで中継。
- `src/utils/measureLayoutUtils.test.ts`: 余白引数と本文幅・予算の連動を検証するテストを追加。
- `src/components/ScorePage.tsx`（追補）: `SYSTEM_ROW_GAP_MIN_PX` を−30へ拡張、`systemRowGapPx < 0` のとき `.score-area` へ `score-area--tight-rows` クラスを付与。
- `src/App.css`（追補）: `.score-area--tight-rows` 配下で行グリッドを equal-fill から「実サイズ＋負のマージン」方式へ切り替えるルールを追加。

## 検証結果

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 69ファイル918テスト全緑（新規3テスト追加）。
- ブラウザ実測（「複雑テスト楽譜」48小節・3ページ相当のデータ）:
  - 左右余白 8mm/14mm/25mm いずれでも全 svg が本文幅に収まり、右端はみ出しなし。
  - 上下余白25mm + 段の間隔30px でも `.score-area` の `scrollHeight === clientHeight`（縦あふれなし）、段同士の矩形重なりなし。
  - 「レイアウトをリセット」で全設定が既定値（14mm/14mm/0px）に戻ることを確認。
  - コンソールエラーなし。

## 追補: 「余白(上下)」を「余白(上)」「余白(下)」に分離（2026-07-20）

### 問題

「余白(上下)」は1本のスライダーで上 padding の値を直接動かし、下 padding は常に「上 − 2mm」を保つ仕様だった。これは既定値（上14mm/下12mm）を再現するための実装上の割り切りであり、ユーザーが上下を独立して調整したい場合（例: ページ番号フッターのスペースだけ広げたい、上だけタイトル用に広げたいなど）に対応できなかった。

### 修正設計

- `ScorePage.tsx` の state を `pageMarginVerticalMm`（1つ）から `pageMarginTopMm` / `pageMarginBottomMm`（2つ）に分離した。
- 定数: `PAGE_MARGIN_TOP_KEY = 'score-page-margin-top'` / `PAGE_MARGIN_BOTTOM_KEY = 'score-page-margin-bottom'`（新キー）、`PAGE_MARGIN_VERTICAL_LEGACY_KEY = 'score-page-margin-vertical'`（旧キー、読み取り専用で後方互換のために残す）。範囲は両方とも既存と同じ8〜25mm。既定値は `DEFAULT_PAGE_MARGIN_TOP_MM = 14` / `DEFAULT_PAGE_MARGIN_BOTTOM_MM = 12`（分離前の実効値をそのまま既定値にし、初回表示の見た目を変えない）。
- 後方互換: 新キー（`score-page-margin-top` / `score-page-margin-bottom`）が未保存の場合のみ、旧キー（`score-page-margin-vertical`）の値を読み、旧仕様と同じ計算（上=旧値、下=旧値−2mm）で新state初期値へ引き継ぐ。引き継いだ値も8〜25mmへクランプするため、旧値が10mm未満だった場合（下=旧値−2mmが8mm未満になる場合）は下側が8mmに底上げされる（範囲制約による境界での丸め、意図的な仕様）。
- `maxSystemsPerPage` の縦予算計算は、従来「上 + max(0, 上−2mm)」だった `verticalMarginTotalMm` を「`pageMarginTopMm + pageMarginBottomMm`」（上下の実際の合計）に置き換えた。既定合計は変わらず26mm（14+12）のため、既定値使用時の挙動は不変。
- 「レイアウトをリセット」は `pageMarginTopMm` / `pageMarginBottomMm` をそれぞれの既定値へ戻し、新キー2つへ書き込む（旧キーは削除しない。次回起動時は新キーが優先されるため実害はない）。
- UI: 「その他」タブの「レイアウト」欄に「余白(上)」「余白(下)」の2本のスライダーを配置（旧「余白(上下)」を置き換え）。挙動・保存タイミングは他のレイアウトスライダーと同一。

### 検証結果

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 69ファイル927テスト全緑（既存テストのみで、予算計算への直接のユニットテストは既になし。挙動はブラウザ実測で確認）。
- ブラウザ実測（「複雑テスト楽譜」データ、dev サーバー port 5175）:
  - 上=8mm/下=25mm、上=25mm/下=8mm のいずれでも `.print-page` の `padding-top`/`padding-bottom` が指定どおり非対称に変化し、譜面領域（`.score-area`）の高さも追随。縦あふれなし（`scoreBottom < pageBottom` を全ページで確認）。
  - 上下合計が変わると「段数/ページ」の上限（入力欄の `max`）が連動して変化することを確認。
  - 旧キー（`score-page-margin-vertical` = 9）のみを保存した状態でスライダーを初期表示すると、上=9mm・下=8mm（旧仕様の計算値7mmが8〜25mmの範囲でクランプされ8mmになる、意図した仕様）に引き継がれることを確認。
  - 「レイアウトをリセット」で上=14mm/下=12mm（既定値）に戻ることを確認。
  - コンソールエラーなし。
  - 検証中に動かした値は、検証後にユーザーのテスト環境設定値（左右14mm・上9mm・下8mm・段の間隔−20px・音符115%・ズーム150%）へ戻した。

## 追補: 「段の間隔をマイナス方向にも調整できるようにする」を単一の連続方式へ統一（廃止と置き換え、2026-07-23）

**上の「追補: 段の間隔をマイナス方向にも調整できるようにする」（`.score-area--tight-rows` による二方式切り替え）は本追補により廃止する。** 以下がこの機能の現行の正本設計であり、旧追補の記述（`score-area--tight-rows` クラス・別方式への切り替え）はもはや実装に存在しない。

### 問題（Issue #37）

第一原則「まず自動で良い配置、微調整はユーザー」に反し、「段の間隔」スライダーは正値では「行グリッド等分＋gap」、負値では「実サイズ＋負マージン（`.score-area--tight-rows`）」という全く別のレイアウト方式に切り替わっていた。0をまたぐ瞬間に段配置が跳び、ユーザーは「ちょうどいい間隔」を連続的に作れなかった。

### 修正設計

- 正のときに使っていた「段スロット高＝ページの譜面領域 ÷ 段数（`--page-capacity`）」という考え方をそのまま正負共通の基準にする。`.score-area .system-stack > *` の flex-basis は常に `calc((100% - (page-capacity - 1) * system-row-gap) * page-slot-ratio)` とし、`max(0px, ...)` によるクランプを廃止して `system-row-gap` を符号そのまま使う。
  - この式は「段の高さ×段数＋間隔×(段数-1) ＝ 予算」を常に満たすよう作られているため（等分の取り分から `(N-1)*gap` ぶんを差し引く）、gapが負でも代数的には破綻しない。破綻していたのは、間隔そのものを実現する手段としてCSSの `gap` プロパティ（負値を受け付けない）を使っていた点だけだった。
- 間隔の実現方法を `gap` プロパティから `margin-top`（`.score-area .system-stack > * + * { margin-top: var(--system-row-gap, 0px); }`）に変更した。`margin` は負値を許容するため、スロット高の計算式とあわせて正負とも同じCSS・同じ方式で連続に動作する。`.score-area--tight-rows` クラスの付与（`ScorePage.tsx`）と、それに紐づく3つのCSSルール（`gap:0` / `flex:0 0 auto` / `margin-top`）はすべて削除した。
- `measureLayoutUtils.ts` に、上記CSS式のJS版として `systemRowSlotHeightPx(budgetPx, systemsPerPage, gapPx)` と `systemRowTopOffsetsPx(budgetPx, systemsPerPage, gapPx)` を追加した。jsdom はflexboxレイアウトを実際には計算しないため、DOM実測でのユニットテストが行えない代わりに、CSSの計算式と同じ式をJSで再実装し、gapの単調性・連続性を数式レベルで検証できるようにした（CSS側の式を変更する際は、この関数もあわせて更新すること。両者は関数のdocコメントで相互参照している）。
- 最終ページ（`.print-final-page` / `.print-final-page-single`）は元々 `flex: 0 0 auto !important` + `justify-content: space-between/flex-start` で「実サイズ＋詰め配置」を強制しており、`gap` と `margin-top` はどちらも flexbox の主軸方向に同じように追加スペースとして働くため、`gap` から `margin-top` への切り替えは最終ページの見た目に影響しない（正値のときの間隔の見え方は従来と変わらない）。

### 検証結果

- `docker exec -w <worktree> music-editer-dev npx vitest --run src`: 88ファイル1036テスト全緑（`measureLayoutUtils.test.ts` に段スロット高・段Y座標の単調性・連続性を検証するテストを4件追加。既存テストは変更なしで全緑）。
- `docker exec -w <worktree> music-editer-dev npm run lint`: 355件のエラー（プロジェクト既存分、今回変更したファイルに起因するものなし。lintのエラー総数はこの変更前のベースラインと完全に一致することを確認）。
- `docker exec -w <worktree> music-editer-dev npm run build`: `tsc -b && vite build` エラーなし。
- **ブラウザ実測は今回未実施**（夜間無人実行のため、共有 devcontainer 上で既に別セッションが使用中の dev サーバー・ポートに干渉しないことを優先した判断）。上記のユニットテストによる数式レベルの検証（段スロット高・Y座標がgapの値に対して線形かつ単調に変化し、0前後で式が切り替わらないこと、最終段の下端が常にページ予算に一致すること）と、CSSの代数的な整合性の確認により正しさを担保しているが、実際のブラウザでの見た目確認は次回人間によるレビュー時に行うことを推奨する。

### 影響範囲（追補）

- `src/App.css`: `.score-area .system-stack > *` の flex-basis から `max(0px, ...)` クランプを除去、`.score-area .system-stack > * + * { margin-top: ... }` を追加、`.score-area--tight-rows` 配下の3ルールを削除。
- `src/components/ScorePage.tsx`: `.score-area` への `score-area--tight-rows` クラス付与を削除（常に `"score-area"` 固定）。
- `src/utils/measureLayoutUtils.ts`: `systemRowSlotHeightPx` / `systemRowTopOffsetsPx` を追加。
- `src/utils/measureLayoutUtils.test.ts`: 上記2関数の単調性・連続性・予算充足を検証するテストを追加。

## 追補: 段ごとに個別の間隔（上の段との距離）を調整できるようにする（2026-07-21）

### 問題

「段の間隔」（`systemRowGapPx`）は全段に一律で効く全体設定で、特定の1段だけ間隔を広げたい／詰めたい（例: 楽節の切れ目を視覚的に示したい、特定の段だけ余裕を持たせたい）という要望に応えられなかった。既存の「段ごとの小節数の個別調整」（`systemMeasureOverrides`、`.claude/specs/system-measure-override/design.md`）が「段の並び順ではなく絶対小節番号をキーに保存データへ持つ」という設計・UI配置（各段直後の1行コントロール）の前例になっていたため、同じ流儀を踏襲した。

### 修正設計

- **データモデル**: `SavedScoreData.systemRowGapOverrides?: { startMeasure: number; gapPx: number }[]`（`src/types/storage.ts`）。`systemMeasureOverrides` と同じキー設計（絶対小節インデックス `startMeasure`）で、「この段（`startMeasure` から始まる段）は全体設定に `gapPx` を追加する」を表す。`gapPx` が0の要素は配列に含めない（`adjustSystemRowGapOverride` が upsert 時に0なら除去する）。
- **バリデーション**: `storage.ts` の `validateSystemRowGapOverrides` が `systemMeasureOverrides` 用の `validateSystemMeasureOverrides` と対になる形で、`startMeasure` の重複・負数、`gapPx` が有限数でない場合を拒否する（`count>=1` のような下限は無い＝負値もそのまま許容、既に個別クランプ済みの値を保存する前提のため保存時点では範囲チェックしない）。
- **UI**: 「段N ◀ N小節 ▶」の同じ行に「間隔 － Npx ＋」を追加（`ScorePage.tsx`、`.system-measure-override-row` 内）。－／＋1回につき `SYSTEM_ROW_GAP_OVERRIDE_STEP_PX = 4px`。表示範囲・クランプ下限上限は全体設定の「段の間隔」と同じ `SYSTEM_ROW_GAP_MIN_PX`（−30）〜`SYSTEM_ROW_GAP_MAX_PX`（30）を、段ごとのオフセット単体に適用する（合成後の実効値ではなく、追加オフセット自体をこの範囲に収める設計）。
- **合成方法（全体設定 + 段ごとのオフセット）**: 全体の「段の間隔」は従来どおり CSS カスタムプロパティ `--system-row-gap` として `.score-area` へ注入され、`.score-area .system-stack` の `gap`（または tight-rows 時の `margin-top`）に一律反映される。段ごとのオフセットはこれとは別経路で、各 Staff コンポーネント（`SingleStaff` / `PianoStaff` / `QuartetStaff` / `EnsembleStaff`）が `.system-stack` の直下に描く「1段ぶんのラッパー `<div>`」（`systemRanges` を `Array.from` でループして生成している要素）へ、`style={{ marginTop: gapOverridePx }}` として個別に追加する。CSS の `margin-top` は `gap` や既存の `margin-top`（tight-rows時）と加算的に効くため、「全体設定＋段ごとの追加オフセット」の合成は自然に成立する。値が0の段はスタイル自体を付けず、従来の見た目を変えない。
- **`ScorePage.tsx` 側の配線**: `getSystemGapOverridesPx(ranges: SystemMeasureRange[]): number[]` というヘルパーを追加し、ページごとに `p.systemRanges` を渡して「その段一覧ぶんのオフセット配列」を作り、各 Staff コンポーネントの新 prop `systemGapOverridesPx` へそのまま渡す（`plannedMeasureWidths` を `systemRanges` ごとにスライスして渡している既存パターンと同じ考え方）。
- **Undo/Redo**: `ScoreSnapshot` に `systemRowGapOverrides` を追加し、`systemMeasureOverrides` と全く同じ扱いで Undo/Redo・保存/読込・ファイル書出入・サンプル読込・新規作成・MusicXML読込のすべてのリセット/復元経路に配線した（`setSystemRowGapOverrides([])` を「前の譜面を引き継がない」箇所に、`data.systemRowGapOverrides ?? []` を「保存データから復元する」箇所に、既存の `systemMeasureOverrides` の隣に追加しただけで、個別の新しい分岐は増やしていない）。
- **「レイアウトをリセット」との関係**: 全体の「段の間隔」（`systemRowGapPx`）を含む4つの画面専用 localStorage 設定に加え、段ごとのオフセット（`systemRowGapOverrides`）もこのボタンでまとめて空配列へ戻す。段ごとのオフセットは楽譜データ側の状態（Undo対象）のため、他3設定と違い `pushHistory()` を呼んでからクリアし、リセット自体も Undo できるようにした。
- **対応範囲**: 単旋律（`SingleStaff`）・ピアノ（`PianoStaff`）・弦楽四重奏（`QuartetStaff`）・編成譜（`EnsembleStaff`）の主表示すべてに配線した。パート譜抽出用の表示（`PartExtractionStaff`、閲覧・印刷専用）には対象コントロール・prop を追加していない（編集不可のビューであり、要件の対象外と判断）。

### 検証結果

- `docker compose run --rm app npm test`: 441ファイル5653テスト全緑（`storage.test.ts` に `systemRowGapOverrides` の保存/読込往復・後方互換・バリデーション（重複・負数・非数値）のテストを5件追加）。
- `docker compose run --rm app npm run build`: `tsc -b && vite build` エラーなし。
- ブラウザ実測（dev サーバー port 5178、単旋律譜4段・ピアノ譜3段）:
  - 段2の「＋」を複数回押すと段2だけ marginTop が加算され、段1との間隔が広がる（段3以降は連動して押し下げられる。スタック型レイアウトの自然な帰結）ことを実測確認。
  - 「－」を下限に達するまで押すと −30px でボタンが disabled になり、それ以上詰まらないことを確認。
  - 保存（`saveScoreData`）直後の `localStorage['music-score-app-data']` に `systemRowGapOverrides: [{ startMeasure, gapPx }]` の形で書き込まれることを確認。
  - 「レイアウトをリセット」で段ごとのオフセットがすべて0（配列が空）に戻ることを確認。
  - ピアノ譜（大譜表）でも同じ操作で段2が個別に押し下がることを確認。
  - コンソールエラーなし。
  - CLAUDE.md の既知バグ（起動時自動読込が無く、リロードで自動保存データが空スコアに上書きされる）を踏まえ、検証中はページリロードを行わず、保存後の状態確認は `localStorage` の直接読み取りと「読込」ボタン（`handleLoad`）経由の再適用で行った。

### 影響範囲

- `src/types/storage.ts`: `SavedScoreData.systemRowGapOverrides` フィールドと `SystemRowGapOverride` 型を追加。
- `src/utils/storage.ts`: `validateSystemRowGapOverrides` を追加し `validateSavedScoreData` に組み込み、`createSavedScoreData` に `systemRowGapOverrides` 引数を追加。
- `src/hooks/useScoreStorage.ts`: `saveScore` に `systemRowGapOverrides` 引数を追加。
- `src/components/ScorePage.tsx`: `systemRowGapOverrides` state・`SYSTEM_ROW_GAP_OVERRIDE_STEP_PX` 定数・`adjustSystemRowGapOverride` / `getSystemGapOverridesPx` ハンドラ・`ScoreSnapshot` への統合・保存/読込/ファイル入出力/Undo/リセットの全経路への配線・「間隔 － Npx ＋」UI。
- `src/components/SingleStaff.tsx` / `PianoStaff.tsx` / `QuartetStaff.tsx` / `EnsembleStaff.tsx`: `systemGapOverridesPx` prop を追加し、段ラッパー `<div>` へ `marginTop` として適用。
- `src/App.css`: `.system-row-gap-override-label` を追加（既存の `.system-measure-override-label` と対になる小さなラベルスタイル）。
- `src/utils/storage.test.ts`: `systemRowGapOverrides` の保存互換・バリデーションのテストを追加。

## 追補: 段数/ページの上限を実測ベースの自動決定にし、手動上書きの上限クランプを警告方式へ変える（M-2、2026-07-23）

### 問題（Issue #38）

`maxSystemsPerPage`（段数/ページの上限）は楽譜種別ごとの固定係数（`BASE_SYSTEM_HEIGHT_PX` / `estimateEnsembleSystemHeightPx`）で見積もっていたが、これらは「三重の安全側」（厳しめ予算938px ÷ 大きめの段高さ推定）で頭打ちされており、実際は入るのに段数を増やせなかった。特に編成譜の `estimateEnsembleSystemHeightPx`（段あたり81px、旧パート間隔80で校正）は、Issue #29（PR相当）でパート間隔が5パート以上のとき60へ詰まった現在では実際より高さを大きく見積もり、乖離が大きい。また、ユーザーが上限を超える段数を指定する手段もなかった。

### 修正設計

- **段の高さの正本を実測（`computeLayout` 経由）に一本化**: `PianoSystemCanvas.tsx` が実際の描画に使う寸法計算 `computeLayout(partCount)`（`sysH`・`staveSpacingForPartCount` 等）を `measureLayoutUtils.ts` へ移設した（`PianoSystemCanvas.tsx` はそこから import し、既存テスト（`PianoSystemCanvasPartSpacing.test.tsx`）が壊れないよう同名で re-export）。`ScorePage.tsx` の段数上限計算がこれと同じ計算式を共有できるようにするための移設で、パート間隔が将来また変わっても両者が自動的に追従する。
- **新関数 `measuredSystemHeightPx(partCount)`**（`measureLayoutUtils.ts`）: `computeLayout(partCount).sysH * SCORE_LAYOUT_RENDER_SCALE`。PianoSystemCanvas.tsx が実際に `renderer.resize(W, sysH * scale)` で使う値と同じ換算式（「音符の大きさ100%」時）。
- **`ScorePage.tsx` の `maxSystemsPerPage`**（段数/ページの実際の上限）は `measuredSystemHeightPx(partCountForSystemLayout)` を正として計算し直した（`partCountForSystemLayout` は single=1・piano=2・quartet=4・ensemble=`instrumentation.parts.length`、`computeLayout` へ渡す実際の段数と一致させている）。旧来の固定係数（`BASE_SYSTEM_HEIGHT_PX` / `estimateEnsembleSystemHeightPx`）は削除せず、**用途を「初回見積もり（推奨段数）」に限定**する（`legacyRecommendedMaxSystemsPerPage` にリネーム）。理由: 固定係数をそのまま初期表示の推奨段数に使い続けることで、単旋律・ピアノの初期表示（従来8段・4段）を変えないため（後述の「推奨値と上限の分離」）。`computeEnsembleAutoFitMultiplier`（1段がページに収まらない大編成の自動縮小判定）も `estimateEnsembleSystemHeightPx` を使い続けている（本Issueのスコープ外、別の目的のため据え置き）。
- **推奨値（初期表示）と上限（クランプ判定）を分離**: `recommendedSystemsPerPage = Math.min(scoreType==='piano' ? Math.min(4, legacyRecommendedMaxSystemsPerPage) : legacyRecommendedMaxSystemsPerPage, maxSystemsPerPage)`。実測ベースの `maxSystemsPerPage` は旧係数よりほぼ常に大きい（安全側だった旧係数が縮むため）ため、通常はこの `Math.min` は効かず、初期表示は従来と数値まで完全に同じになる（単旋律8段・ピアノ4段。ScorePageSystemsPerPage.test.tsx で確認）。
- **手動上書きのクランプ撤廃・あふれ警告**: `systemsPerPage = Math.max(1, systemsPerPageSetting ?? recommendedSystemsPerPage)`（上限へのクランプを削除。1未満だけ防ぐ）。「段数/ページ」入力欄の `max` 属性・`onChange` 内の `Math.min(maxSystemsPerPage, …)` も削除し、指定どおりの値をそのまま `localStorage` へ保存・描画に使う。`isSystemsPerPageOverflowing = systemsPerPage > maxSystemsPerPage` を新設し、true のとき入力欄の隣に `role="alert"` の「⚠ あふれます」を表示する（クランプせず受け付け、あふれる場合は警告を出したうえで指定どおり描画、という要件どおり）。

### 検証結果

- `docker exec -w <worktree> music-editer-dev npx tsc -b --noEmit`: エラーなし。
- `docker exec -w <worktree> music-editer-dev npx vitest --run src`: 90ファイル1044テスト全緑。新規追加:
  - `src/utils/measuredSystemHeight.test.ts`: `measuredSystemHeightPx` が `computeLayout(n).sysH * SCORE_LAYOUT_RENDER_SCALE` と一致すること、パート数に対して単調非減少であること、二管編成（12パート）で旧推定式（`estimateEnsembleSystemHeightPx`）より段の高さを小さく見積もること、`SCORE_AREA_BUDGET_PX`（938px）相当の予算で段数上限が旧推定式より増えることを確認。
  - `src/components/ScorePageSystemsPerPage.test.tsx`: `ScorePage` を実際にレンダリングし、単旋律の初期表示が従来どおり8段・ピアノが従来どおり4段のまま変わらないこと、あふれ警告（`role="alert"`）が上限超過時のみ表示されること、999段のような極端な手動指定でもクランプされず指定どおりの値が保持されることを確認。
- `docker exec -w <worktree> music-editer-dev npm run lint`: 変更したファイル（`measureLayoutUtils.ts` / `PianoSystemCanvas.tsx` / `ScorePage.tsx` および新規テスト2件）に絞って実行し、エラーは全てこの変更前から存在する既存分（`any` 型・`jsx-a11y/no-autofocus` 未定義ルール等）であることを行番号レベルで確認した（`PianoSystemCanvas.tsx` の `react-refresh/only-export-components` は `computeLayout`/`staveSpacingForPartCount` の定義位置が移設に伴い変わっただけで、件数は移設前後で2件のまま変化なし）。プロジェクト全体では2000件超の既存lintエラーがあり（本変更と無関係、リポジトリの既存技術的負債）、`npm run lint`（プロジェクト全体）自体は従来から通らない状態のため、本変更が新たなエラーを増やしていないことの確認をもって代替した。
- `docker exec -w <worktree> music-editer-dev npm run build`: `tsc -b && vite build` エラーなし。
- **ブラウザ実測は今回未実施**（夜間無人実行のため、共有devcontainer上で既に別セッション（他ブランチ）が使用中のdevサーバー・ポート5173に干渉しないことを優先した判断。前回のM-1追補と同じ理由・同じ判断）。代わりに、実装前の調査として **main ブランチの実際のdevサーバー（port 5173）をブラウザで開き、単旋律の空譜面が実際に `svg[height]=44px`（`computeLayout(1).sysH=100 × SCORE_LAYOUT_RENDER_SCALE=0.44` と一致）で描画されていることをDOM実測で確認**し、`measuredSystemHeightPx` の換算式が実際の描画寸法と一致することの根拠にした。また、SVGの `getBBox()` はVexFlowが音楽記号を `<text>` グリフとして描く際のフォントメトリクス起因で実際のインク幅より大幅に大きい値を返す（実測で確認: 空の単旋律1段でインク幅181px、うち`<text>`要素だけで161px相当のBBox）ため、DOM実測（`getBBox`）を段の高さの正本にするのは信頼できないと判断し、Issue本文が代替として明示的に許可している「`computeLayout` の `sysH`×スケールの正確な換算」を採用した。実際の見た目確認（単旋律・ピアノ・弦楽四重奏・大編成それぞれでの段の重なりの有無、あふれ警告の表示）は次回人間によるレビュー時に行うことを推奨する。

### 影響範囲（追補）

- `src/utils/measureLayoutUtils.ts`: `computeLayout` / `staveSpacingForPartCount`（`PianoSystemCanvas.tsx` から移設）、新関数 `measuredSystemHeightPx` を追加。`estimateEnsembleSystemHeightPx` の doc コメントを更新（用途を初回見積もりに限定する旨を明記）。
- `src/components/PianoSystemCanvas.tsx`: `computeLayout` / `staveSpacingForPartCount` のローカル定義を削除し、`measureLayoutUtils.ts` から import・re-export する形に変更（既存テストとの互換のため）。
- `src/components/ScorePage.tsx`: `maxSystemsPerPage` を実測ベースの計算へ変更し、旧計算は `legacyRecommendedMaxSystemsPerPage`（推奨値専用）にリネーム。`recommendedSystemsPerPage` を両者の `Math.min` に変更。`systemsPerPage` の上限クランプを撤廃し `isSystemsPerPageOverflowing` を追加。「段数/ページ」入力欄からクランプを外し、あふれ警告表示を追加。
- `src/utils/measuredSystemHeight.test.ts`: 新規。`measuredSystemHeightPx` の単体テスト。
- `src/components/ScorePageSystemsPerPage.test.tsx`: 新規。`ScorePage` レンダリングでの初期表示・あふれ警告の統合テスト。

## 追補: 音符の大きさの工場出荷既定値変更に伴う推奨段数の変化（Issue #49、2026-07-24）

上記の「単旋律8段・ピアノ4段という初期表示自体は変わらない」は、当時の音符の大きさの工場出荷既定値（全楽譜種別100%）を前提にした記述だった。Issue #49 で単旋律・ピアノの既定値が150%に変わったことに伴い、`recommendedSystemsPerPage` の計算に使う `notationSizeMultiplier` の初期値も変わるため、**新規ユーザー状態での初期表示（推奨段数）は単旋律8段→5段、ピアノ4段→3段に変わった**（ピアノはさらに段の間隔の既定値も0px→30pxになったため、その分も上限計算に効いている）。これは意図した変更であり、`recommendedSystemsPerPage` / `maxSystemsPerPage` の計算式そのもの（本ドキュメント本文の設計）は変更していない。実測ベースの上限（`maxSystemsPerPage`）の範囲内に収まっているため、あふれ警告は出ない。詳細（既定値の解決関数・検証結果）は `.claude/specs/settings-profile/design.md` の同日付の追補を参照。`src/components/ScorePageSystemsPerPage.test.tsx` のアサーションもこの新しい値に更新した。

## 追補: 最終ページが「実段1つ＋空の段」のとき、他ページと違う小さいレイアウトへ潰れていた不具合を修正（Issue #68、2026-07-25）

### 問題

複数ページの譜面で、最終ページの実段（内容のある段・編集バッファ段）が1段だけになると、実段は正しくても**その直後に続く空の段（`.empty-stave-filler`、Issue #41）まで含めてページ全体が不自然に小さく、上詰めで表示され、ページ下半分が大きく空く**症状が起きていた。他のページ（先頭ページなど）は本ドキュメント本文の固定スロット式（`--page-capacity` ベースの `flex: 0 0 calc(...)`）でページ全体へ均等に配置されるため、同じ譜面の中でページごとに段の詰まり方がまったく異なって見えた。

原因は `App.css` の `.screen-final-page-single`（本ドキュメント上部の「画面表示でも、最終ページに『実際に表示される段』が1段だけのときは上揃えにする」を参照）にあった。このクラスは `ScorePage.tsx` の `screenFinalPageVisibleSystems`（`effectiveTotalSystems` ベース＝実段・編集バッファ段のみを数え、**空の段は数えない**）が1のときに付与され、`.system-stack` を固定スロット式から「実サイズ＋ `justify-content: flex-start`」の縮小レイアウトへ切り替える。このクラスが追加された当時（Issue #38以前）はまだ空の段（Issue #41）が存在せず、「実段1つ＝そのページの子要素は1つだけ」という前提が常に成り立っていた。しかしIssue #41で空の段が同じ `.system-stack` へ実段の直後の兄弟要素として追加されるようになった後も、判定条件（`screenFinalPageVisibleSystems === 1`）は空の段を数えないまま据え置かれていたため、「実段1つ＋空の段が複数」という状態でもこのクラスが付与され続けていた。結果、実段だけでなく空の段まで縮小レイアウトに巻き込まれ、五線紙のようにページを均等に埋めるはずの空の段（Issue #41の意図）が小さく上詰めになってしまっていた。

### 修正設計

- `ScorePage.tsx` に `screenFinalPageTotalSystems`（`screenFinalPageVisibleSystems` + そのページが最終可視ページ（`lastVisiblePageIndex`）と一致する場合の `lastPageEmptyFillerRanges.length`）を追加し、`.screen-final-page-single` クラスの付与条件を `screenFinalPageVisibleSystems === 1` から `screenFinalPageTotalSystems === 1` に変更した。空の段が1つでも存在すれば、その最終ページの実質的な表示段数は2以上になるため、このクラスは付与されず、他ページと同じ固定スロット式（本ドキュメント本文）が使われる。
- パート譜抽出中（`isPartExtractionActive`）や編集不可時（`isEditingDisabled`）は `lastPageEmptyFillerRanges` が常に空配列（`ScorePage.tsx` 側で明示的にガード済み）のため、`screenFinalPageTotalSystems` は従来どおり `screenFinalPageVisibleSystems` と一致する。これらのビューには空の段の演出が無いため、「実段1つだけ」なら引き続き `.screen-final-page-single`（実サイズ・上揃え）が適用され、以前からの見た目（段がページ中央へ間延びして浮かない）を維持する。
- `.print-final-page-single`（印刷・印刷プレビュー専用）は変更していない。印刷では空の段自体を表示しないため（`@media print` / `.print-preview` で非表示）、「内容のある段が1段だけの最終ページは上揃え」という判定・挙動は従来のままで正しい。

### 検証結果

- ブラウザ実測（本worktreeを一時ポートで直接マウントしたdevサーバー、`test-data/print-test-score.json` を「段数/ページ」5に設定して3ページ化し、最終ページを実段1つ＋空の段4つの状態にして確認）: 修正前は最終ページの `.print-page` に `screen-final-page-single` が付与され、5段すべて（実段1つ＋空の段4つ）が自然サイズ（約119px/段）で上詰めになり、ページ高さ932pxのうち約595pxしか埋まらなかった。修正後はこのクラスが付与されなくなり、5段すべてが他ページと同じ `flex-basis`（`--page-capacity` ベース、約163〜174px/段）で計算され、ページのほぼ全高（約870px）が均等に埋まることを、`getComputedStyle` による `flex-basis` の一致（全ページとも `20%`・`flex-grow: 5`）で確認した。
- `docker exec -w <worktree> music-editer-dev npx vitest --run src`: 98ファイル1146テスト中、失敗4件はすべて `ScorePageEmptyStaveFiller.test.tsx` の既存テストで、**未修正の main でも同じ4件・同じ内容で失敗することを確認済み**（jsdomに `HTMLCanvasElement.getContext` が無いことに起因する空の段の個数見積もりのずれで、本修正・Issue #68とは無関係の既存の環境依存の問題）。新規追加した回帰テスト（`実段1つ＋空の段が複数あるページには、1段専用の特別レイアウト（screen-final-page-single）を適用しない`）は成功。
- `docker exec -w <worktree> music-editer-dev npm run lint`: 353エラー・6警告で、未修正のmainと完全に同数（新規エラーなし）。
- `docker exec -w <worktree> music-editer-dev npm run build`: `tsc -b && vite build` エラーなし。

### 影響範囲

- `src/components/ScorePage.tsx`: `screenFinalPageTotalSystems` を追加し、`.screen-final-page-single` の付与条件をこれに変更。
- `src/components/ScorePageEmptyStaveFiller.test.tsx`: 回帰テストを追加（実段1つ＋空の段が複数あるとき `.screen-final-page-single` が付与されないこと）。
- `App.css` 側のCSSルール自体（`.screen-final-page-single` の中身）は変更していない。
