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

## 影響範囲

- `src/utils/measureLayoutUtils.ts`: `printScoreAreaWidthPx` / `worstCaseSystemContentBudget` の余白引数化。
- `src/components/ScorePage.tsx`: 余白・段間隔の state、`maxSystemsPerPage` の連動計算、CSS変数の注入、「その他」タブの新UI（余白左右・余白上下・段の間隔・レイアウトをリセット）。
- `src/App.css`: `.print-page` の padding、`.score-area .system-stack` の gap を CSS 変数化。
- `src/components/PianoSystemCanvas.tsx` / `src/components/StaffCanvas.tsx`: 親要素の幅変化を検知して再描画する `ResizeObserver` を追加（既存のリサイズ非対応バグの修正を兼ねる）。
- `src/utils/measureLayoutUtils.test.ts`: 余白引数と本文幅・予算の連動を検証するテストを追加。

## 検証結果

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 69ファイル918テスト全緑（新規3テスト追加）。
- ブラウザ実測（「複雑テスト楽譜」48小節・3ページ相当のデータ）:
  - 左右余白 8mm/14mm/25mm いずれでも全 svg が本文幅に収まり、右端はみ出しなし。
  - 上下余白25mm + 段の間隔30px でも `.score-area` の `scrollHeight === clientHeight`（縦あふれなし）、段同士の矩形重なりなし。
  - 「レイアウトをリセット」で全設定が既定値（14mm/14mm/0px）に戻ることを確認。
  - コンソールエラーなし。
