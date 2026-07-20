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
- 上下余白は「上 padding の値」をスライダーで直接動かし、下 padding は常に「上 − 2mm」を保つ（従来の 14mm/12mm という2mm差を維持し、既定値のときに完全に元のレイアウトへ戻るようにするため）。

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
