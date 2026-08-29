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

- `SCORE_AREA_BUDGET_PX` は「上14mm/下12mm（合計26mm）」時のタイトルページの `.score-area` の実測値。上下余白スライダーで合計が変わった分だけ mm→px 換算（96/25.4）で budget を増減する。
  - 当初は **938px**。Issue #216 で見出しを縦積み（タイトルの下の行に作者欄）へ変えて既定の見出しが 62px 高くなったため、**876px** へ追従した（実測と影響範囲は `.claude/specs/engraving-defaults/design.md` §6-2）。見出しの構造を変えるときは、この定数も一緒に見直すこと。
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

## 追補: 新規作成直後の初期表示を全譜種で「五線紙品質」にする（Issue #71、2026-07-25）

### 問題

新規作成直後（データが空）の画面が、弦楽四重奏・編成譜で大きく崩れていた。運用者の実機報告では「ユーザーは3秒で使うのをやめる」レベルの第一印象の問題として挙がっていた。

ブラウザ実測（本worktreeを一時ポート5199で起動し、工場出荷状態＝localStorage空で確認）で、次の2つが独立した原因であることを特定した。

**原因1: 推奨段数（段数/ページの初期値）の見積もりが、譜種ごとにばらばらの余白を含んでいた**

`recommendedSystemsPerPage` の基準高さは楽譜種別ごとの固定係数（単旋律114px / ピアノ180px / 四重奏340px / 編成譜は `estimateEnsembleSystemHeightPx` = 81×パート数+16）だった。これらを実測の段の高さ（`measuredSystemHeightPx`）と比べると、含んでいる「段間の余白」の量が種別ごとに全く違う:

| 譜種 | 実測の段の高さ | 旧固定係数 | 差＝含んでいた余白 |
| --- | --- | --- | --- |
| 単旋律（1段） | 44px | 114px | 70px |
| ピアノ（2段） | 79.2px | 180px | 100.8px |
| 弦楽四重奏（4段） | 149.6px | 340px | 190.4px |
| 室内オーケストラ（8段） | 228.8px | 664px | 435.2px |

パート数が多い譜種ほど余白を過大に見込むため、推奨段数が過剰に少なくなり、**弦楽四重奏は2段/ページ・室内オーケストラは1段/ページ**になっていた。1段しか入らないページでは空の段（Issue #41）も0個になるため、「1段だけ表示されて残りが空白」という報告そのものの状態になる。

**原因2: 譜表の位置だけが「音符の大きさ」に追従せず、段の中身が段の箱からはみ出していた**

`PianoSystemCanvas.tsx` は Stave を `new Stave(x/s, staveYs[pi]/s, w/s)` として置いていた（`s` は描画倍率）。x/w を `/s` するのは「ページ幅いっぱいに広げる」ためで正しいが、Y まで `/s` すると、`ctx.scale(s,s)` で戻したときに**パート間隔だけが常に `staveSpacing` ピクセルのまま**残る。五線そのものは `s` 倍で縮むため、間隔だけが相対的に広い、間延びした段になっていた。

ブラウザ実測（室内オーケストラ8パート）:

- 音符の大きさ100%: 五線の高さ18px に対しパート間隔60px（3.3倍）
- 音符の大きさ150%: 五線の高さ27.1px に対しパート間隔**60px のまま**（＝間隔が音符サイズに追従しない証拠）

さらに深刻なのは、SVGの箱の高さが `renderer.resize(W, sysH * s)` で決まる（＝間隔も `s` 倍される前提の値）のに、中身は上記のとおり `s` 倍されない座標に置かれる点。両者が食い違うため中身が箱をはみ出す。実測では viewBox 高さ520単位に対し中身の下端が1081単位（2.08倍）で、**次の段（空の段を含む）へ重なって描画**されていた。原因1で段数が1に潰れていたためこれまで表面化しにくかったが、段数を正すと即座に重なりとして現れる。

### 修正設計

**原因2（描画座標系の統一）** — `PianoSystemCanvas.tsx`

- `new Stave(x/s, staveYs[pi], w/s)` へ変更（Y だけ `/s` しない）。`ctx.scale(s,s)` により譜表間隔も五線も同じ `s` 倍になり、段の実際の高さが `sysH * s`（＝`measuredSystemHeightPx`）と一致する。**既存の高さ見積もり（`measuredSystemHeightPx` / `maxSystemsPerPage`）を変更したのではなく、それらが正しくなるように描画側を合わせた**点が重要。
- クリック判定のパート境界 `partGapY = staveSpacing / s` も、同じ座標系になるよう `staveSpacing` へ変更した。クリック→音高の判定はすべて `stave.getYForLine()` と `clientToGroup()`（viewBox↔クライアント座標の対応）から導かれているため、Stave の位置を動かせば判定も自動的に追従する（後述のブラウザ実測で確認済み）。

**原因1（推奨段数の基準の統一）** — `measureLayoutUtils.ts` / `ScorePage.tsx`

- `SYSTEM_BREATHING_ROOM_PX = 70` と `recommendedSystemHeightPx(partCount) = measuredSystemHeightPx(partCount) + SYSTEM_BREATHING_ROOM_PX` を追加。「段間の余白は、段に含まれる譜表の数ではなく音符の大きさで決まる」という浄書の原則にそろえ、全譜種で共通の1つの値にした（呼び出し側で `notationSizeMultiplier` を乗じる）。
- 値70pxは、単旋律の旧固定係数114px（＝実測44px＋余白70px）と一致する値を選んだ。これにより**単旋律5段・ピアノ3段という既存の初期表示（Issue #49 で決めた値）が変わらない**ことを保証している。
- `ScorePage.tsx` の `legacyRecommendedMaxSystemsPerPage` を `recommendedMaxSystemsPerPage` に置き換え、基準高さを `recommendedSystemHeightPx(partCountForSystemLayout)` にした。用途を失った `BASE_SYSTEM_HEIGHT_PX` は削除。`estimateEnsembleSystemHeightPx` は `computeEnsembleAutoFitMultiplier`（大編成の自動縮小判定、Issue #81 のスコープ）が引き続き使うため残している。
- ピアノの「4段まで」の上限（`Math.min(4, ...)`）は維持した。大譜表は1段が縦に長く、一律の余白だけでは音符を小さくしたときに詰まって見えるため。

### 結果（工場出荷状態でのブラウザ実測）

| 譜種 | 段数/ページ 修正前→後 | 段の中身が箱に収まるか | 譜表間隔 / 五線の高さ |
| --- | --- | --- | --- |
| 単旋律 | 5 → 5（変化なし） | ○ | －（1段） |
| ピアノ | 3 → 3（変化なし） | ○ | 52.8px / 27.1px |
| 弦楽四重奏 | 2 → **4** | ○ | 35.2px / 18px |
| 室内オーケストラ | 1 → **3** | ○ | 26.4px / 18px |

- 4譜種すべてで「実段1つ＋空の段」がページを均等に満たし、隣接する段の描画が重ならないことを、各段の実際の描画範囲（五線の上端・下端）の比較で確認した（重なりペア数0）。
- SVGの viewBox 高さ520単位に対し中身の下端が521単位（修正前は1081単位）となり、中身が箱にちょうど収まるようになった。
- ピアノの右手・左手の間隔は52.8pxで、Issue #71 の受入基準「最低30px・過大にしない」を満たす。
- コンソールエラーなし。既定ズームでページ幅が画面に収まることも確認。

### クリック精度の回帰確認（REGRESSION.md セクションA相当）

描画座標系を変えたため、クリック→音高の対応がずれないことを、未修正の main（一時ポート5198で並行起動）と本ブランチ（5199）で同一手順を実行して比較した。

- 単旋律・五線のB4の線をクリック → 符頭の中心が目標のY座標から**0.3px以内**（main も同じく0.3px以内で、精度は同等）。
- ピアノ大譜表・**左手（下段）**のB相当の線をクリック → 符頭が左手の段に置かれ（右手に吸われない）、目標Yから0.3px以内。`partGapY` を変更したパート境界の判定が正しく働いていることの確認。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`: Stave のY座標を `staveYs[pi]/s` → `staveYs[pi]` に変更。クリック判定の `partGapY` を `staveSpacing / s` → `staveSpacing` に変更。
- `src/utils/measureLayoutUtils.ts`: `SYSTEM_BREATHING_ROOM_PX` と `recommendedSystemHeightPx()` を追加。
- `src/components/ScorePage.tsx`: `legacyRecommendedMaxSystemsPerPage` を `recommendedMaxSystemsPerPage`（実測＋共通余白ベース）へ置き換え、`BASE_SYSTEM_HEIGHT_PX` と `estimateEnsembleSystemHeightPx` の import を削除。
- `src/components/ScoreInitialViewQuality.test.tsx`: 新規。譜種横断の初期表示の不変条件（段の中身が箱に収まる／譜表間隔が極端に広くない／推奨段数の基準が全譜種共通／4譜種とも空の段でページが満たされあふれ警告が出ない）を固定。
- `src/components/ScorePageEmptyStaveFiller.test.tsx`: 空の段の個数を直書き（7個・3個。Issue #49 以前の既定8段/ページ時代の値で、main でも失敗していた）から「実際の段数/ページ設定 − 1」を期待値とする形に修正し、既定値が変わっても腐らないようにした。

## 追補: 「タイトル余白(上)」「タイトル余白(下)」を追加（Issue #103、2026-07-28）

### 問題

タイトルページ（1ページ目）の「タイトル文字列の前の余白」と「タイトルブロックと1段目の間の余白」は、`App.css` の `.page-head { min-height: 18mm; margin-bottom: 6mm; }` に固定値として埋め込まれており、ユーザーが調整する手段が無かった。特に `min-height: 18mm` は「タイトル・サブタイトルの実際の高さに関わらず、1ページ目のヘッダー領域を一定の高さに保つ」ための仕組みで、タイトルが短いときは残りの空白が `.page-head` の下側（＝タイトルの下）に生まれる一方、タイトルの上には常に0の余白しか無いため、上下のバランスをユーザー側で揃えられなかった（Issue本文の「タイトル上下の余白の幅が合わない」はこれを指している）。

### 修正設計

トリアージコメントの指示（#100 のレイアウトタブ新設マージ後に着手、既存の余白スライダー群と同じ作法で実装）に従い、既存の「余白(上)」「余白(下)」（`.claude/specs/page-layout-controls/design.md` 本文および前の追補を参照）と全く同じパターンで実装した。

- **正本の定数**（`src/utils/measureLayoutUtils.ts`）: `TITLE_MARGIN_TOP_MIN_MM` / `TITLE_MARGIN_TOP_MAX_MM` / `TITLE_MARGIN_BOTTOM_MIN_MM` / `TITLE_MARGIN_BOTTOM_MAX_MM`（各0〜30mm）、`DEFAULT_TITLE_MARGIN_TOP_MM`（0）/ `DEFAULT_TITLE_MARGIN_BOTTOM_MM`（6）。既定値は変更前の固定CSS（`padding-top: 0` 相当・`margin-bottom: 6mm`）と一致させ、スライダーを一度も触らなければ見た目が変わらないようにした。
- **state・永続化**（`ScorePage.tsx`）: `titleMarginTopMm` / `titleMarginBottomMm` を `useState` で持ち、localStorage キー `score-title-margin-top` / `score-title-margin-bottom` へ保存する。既存の「余白(上)/(下)」と異なり、この機能自体が新規追加のため引き継ぐべき旧キーは無い。
- **タイトルページだけに適用**: `ScorePage.tsx` の `visiblePages.map((p, i) => ...)` ループ内、`<header className="page-head">` に対して `i === 0` のときだけ `page-head--title` 修飾クラスを付与し、`--title-margin-top` / `--title-margin-bottom` の2つのCSSカスタムプロパティをインラインスタイルとして注入する（`i !== 0` の見出し専用ページでは何も注入しない）。既存の「タイトルか、`page-title` か」を切り替える `i === 0` の三項演算子と同じ判定を再利用しており、新しいpropや別のページ判定機構は導入していない。
- **CSS**（`App.css`）: `.page-head--title { padding-top: var(--title-margin-top, 0mm); margin-bottom: var(--title-margin-bottom, 6mm); }` を追加した。`.page-head--title` は `.page-head` とクラスを重ねて付与するため、2ページ目以降が使う基底の `.page-head { min-height: 18mm; margin-bottom: 6mm; }` は変更していない。フォールバック値（0mm/6mm）も固定CSSと同じにしてあるため、CSS変数が未注入の場合（＝理論上あり得ないが、2ページ目以降にこのクラスが付いた場合も含め）安全に既定値へ倒れる。
- **「レイアウトをリセット」・初期値プリセットへの統合**: `handleResetPageLayout` に2行追加（他のページ余白と同じ `setXxx` + `localStorage.setItem` のペア）。`settingsProfile.ts` の `ScoreSettingsProfile` インターフェース・`getFactoryDefaultSettingsProfile()`・`parseSettingsProfile()` の範囲検証にも、`pageMarginTopMm`/`pageMarginBottomMm` と全く同じパターンで `titleMarginTopMm`/`titleMarginBottomMm` を追加した（ページ余白と同じく楽譜種別に依らない固定既定値のため、`resolveDefaultLayoutForScoreType` には追加していない）。`ScorePage.tsx` 側の `applySettingsProfileToState` / `handleSaveSettingsProfile`（および依存配列）にも配線した。
- **UI**: レイアウトタブの「レイアウト」欄、既存の「余白(下)」の直後（「段の間隔」の前）に「タイトル余白(上)」「タイトル余白(下)」の2スライダーを追加した。ラベル・スライダー・数値表示のJSX構造は既存の余白スライダーと完全に同一のパターン。

### 検証結果

- `docker exec -w <worktree> music-editer-dev npx tsc -b --noEmit`: エラーなし。
- `docker exec -w <worktree> music-editer-dev npx vitest --run src`: `settingsProfile.test.ts`（新規3アサーション追加分含め21件）・`measureLayoutUtils.test.ts`（45件）は全緑。フルスイート実行では11ファイル・約32件が失敗したが、変更前の `origin/main`（別途 detached worktree で同一コマンドを実行）でも同じ11ファイル・ほぼ同数（31〜33件、実行毎に多少変動）が同じ内容で失敗することを確認済みで、共有Dockerコンテナのリソース競合によるタイムアウト（デフォルト `testTimeout=5000ms`）が原因の環境依存の既存問題であり、本変更とは無関係と判断した。
- `docker exec -w <worktree> music-editer-dev npm run lint:ratchet`: エラー326件・警告5件（基準値326件と完全一致、新規エラーなし）。
- `docker exec -w <worktree> music-editer-dev npm run build`: `tsc -b && vite build` エラーなし。
- **ブラウザ実測は今回未実施**。共有devcontainerの唯一のホスト公開ポート（5173）が、`/app`（本体checkout）で常時起動している別のdevサーバーに占有されており、`--strictPort` での起動を試みたところ正しくbindに失敗して終了した（余分なプロセスは残っていないことを確認済み）。このポートを奪う・共有サーバーへ干渉することは夜間無人実行の制約上避けるべきと判断し、過去の追補（M-2、Issue #71〜）と同じ判断でブラウザ確認を見送った。タイトル余白の実際の見た目（既定値での変化なし・スライダー操作時の上下独立動作・2ページ目以降への非影響・印刷プレビューでの反映）は次回人間によるレビュー時に確認することを推奨する。

## 追補: ピアノ譜の既定値を運用者の実測値へ変更し、段の間隔の下限を拡張（Issue #199、2026-08-09）

### 問題

Issue #195（浄書の既定値の棚卸し）を受けて、運用者がプライベートウィンドウ（＝localStorage空、素の工場出荷既定値）でピアノ譜の初期表示を確認し、ツールバーで詰めながら「こちらの方が自然」と判定した値がある。

- Issue #49 が入れたピアノの既定値は「段の間隔 **+30px**・パート間隔 0px」で、大譜表の右手/左手ペアと次の段のペアの見分けを**段どうしを離す**ことで付けていた
- 運用者の判定は逆で、**大譜表の内側（右手と左手の間）に空気を入れ、段どうしはむしろ詰める**方が自然だった。これは浄書慣行（1つの大譜表の中は広く、段の間は詰める）とも整合する
- さらに、選定された段の間隔 **-30px はスライダーの下限そのもの**であり、本当の最適値がさらに下にある可能性を確かめられない状態だった

### 修正設計

正本の定数（`src/utils/measureLayoutUtils.ts`）だけを変え、既存の解決経路（`resolveDefaultLayoutForScoreType`）に乗せる方針で、新しい仕組みは足していない。

1. **`SYSTEM_ROW_GAP_PIANO_DEFAULT_PX`: 30 → -30**、**`PART_SPACING_OFFSET_PIANO_DEFAULT_PX`（新設）= 38**。
2. **`resolveDefaultLayoutForScoreType(scoreType)` の戻り値に `partSpacingOffsetPx` を追加**した。パート間隔はこれまで「楽譜種別に依らない固定既定値（`PART_SPACING_OFFSET_DEFAULT_PX` = 0）」だったが、ピアノだけ別値を持つことになったため、既に同じ事情を持つ「音符の大きさ」「段の間隔」と同じ関数へ寄せた（種別ごとの既定値を解決する場所を1つに保つ）。ピアノ以外は従来どおり `PART_SPACING_OFFSET_DEFAULT_PX`（0）を返すため、単旋律・弦楽四重奏・編成譜の初期表示は変わらない。
3. **`SYSTEM_ROW_GAP_MIN_PX`: -30 → -60**（上限50・step1は変更なし）。この定数は正本として、スライダーの `min` 属性・段ごとの「間隔 −/＋」オーバーライドのクランプ・初期値プリセット読込時の範囲検査の3箇所が自動追従する（本ドキュメント本文の「★調整するならここが正本★」の設計をそのまま利用）。マイナス側を深くすると段どうしが物理的に重なりうるが、**ユーザー操作の結果として許容する**（既定値は -30px なので初期表示は安全）というのが Issue #199 での運用者判断。
4. **適用経路**（`ScorePage.tsx`）: `partSpacingOffsetPx` の `useState` 初期化・`handleScoreTypeChange`・`handleInstrumentationPresetChange`・`handleResetPageLayout` の4箇所を、既に `systemRowGapPx` がやっているのと同じ形（**localStorage キーが未保存のときだけ**種別の既定値を適用／リセット時は現在の `scoreType` から解決）へそろえた。`settingsProfile.ts` の `getFactoryDefaultSettingsProfile()` も `defaultLayout.partSpacingOffsetPx` 経由に変えた（工場出荷プロファイルの `scoreType` は 'single' なので値は 0 のまま＝挙動変化なし）。

**既存データへの影響が無い理由**: 既定値は「localStorage にそのキーが無いとき」にしか使われない。保存済み作品・ユーザーが一度でも動かしたスライダーの値は従来どおり localStorage / 保存データ側が優先される（受入条件2）。範囲を広げた側の変更（下限 -60）も、既存の保存値（-30〜50）はすべて新しい範囲に含まれるため、読み直し時のクランプで値が動くことはない。

### 検証結果

- `npx vitest --run src`（worktree内）: 変更した4ファイル（`measureLayoutUtils.test.ts` / `settingsProfile.test.ts` / `ScorePageDefaultLayout.test.tsx` / `ScorePagePartSpacing.test.tsx` / `ScorePageSystemsPerPage.test.tsx`）は全緑。フルスイートで残る失敗はすべて `Test timed out`（共有Dockerのリソース競合による既知の環境依存）と、時間計測系1件（`toBeLessThan(1000)` に対し1066ms）。
- `npm run lint:ratchet`: エラー326件（基準値ちょうど）。`npm run build`: 成功。
- **ブラウザ実測（今回は実施した）**: worktree だけを載せた使い捨てコンテナで dev サーバーを立て、`localhost:5174`（本体checkoutの5173とは別オリジン＝別 localStorage）を localStorage 全消去してから確認した。
  - ピアノへ切り替えた初期表示で、レイアウトタブの表示が **段の間隔 -30px・パート間隔 38px**。同時に、Issue 本文が「運用者の画面で見えていた」と書いていた他の値（音符の大きさ150%・小節幅の均等さ50%・余白14/14/12mm・タイトル余白0/6mm・段あたり小節数4・**段数/ページ4**）が**すべて現行既定値と一致**した。つまり実際の変更は表の2項目だけで足りた
  - 段の間隔スライダーの `min` が `-60` になり、-60 まで下げられること・localStorage へ `-60` が保存されること・リロード後もクランプされず `-60` のまま復元されることを確認
  - 単旋律・弦楽四重奏・編成譜は 0px / 0px のまま（音符の大きさも150%/100%/100%のまま）で変化なし
  - ユーザーが明示的に 10px / 5px を設定してからピアノへ切り替えても上書きされないこと、「レイアウトをリセット」でピアノの -30px / 38px へ戻ることを確認
  - コンソールエラーなし

### 影響範囲

- **推奨段数が変わる**: ピアノの新規ユーザー状態での「段数/ページ」初期値が **3段 → 4段**になった。段の間隔が60px詰まったぶんが、パート間隔+38pxによる1段の高さ増（`computeLayout` の `staveSpacing` 80→118、実測換算で約19px）を上回るため。実測ベースの上限（`maxSystemsPerPage`）内に収まっており、あふれ警告は出ない（`ScorePageSystemsPerPage.test.tsx` のアサーションを 3→4 に更新）。上の「追補: 音符の大きさの工場出荷既定値変更に伴う推奨段数の変化（Issue #49）」が記録した「ピアノ4段→3段」は、本追補で 4段へ戻ったことになる。
- **計算式は一切変えていない**: `recommendedSystemsPerPage` / `maxSystemsPerPage` / `systemRowSlotHeightPx` / `computeLayout` はいずれも未変更で、入力値（既定値）だけが変わっている。
- **単旋律・弦楽四重奏・編成譜は不変**（受入条件3）。Issue #195 の A/B 確認が未了の編成譜と、運用者が「現状で良い」と確定した単旋律には手を付けていない。

## 追補: 「段あたり小節数」「段数/ページ」を楽譜種別ごとに保持する（Issue #211、2026-08-09）

### 問題

「段組」の2項目（レイアウトタブ ＞ 譜面の密度 ＞ 段組）が、楽譜種別（単旋律 / ピアノ / 弦楽四重奏 / 編成譜）をまたいで共有されていた。

- **段数/ページ**: localStorage の単一キー `score-systems-per-page` に1つだけ保存していた
- **段あたり小節数**: localStorage には無く、`ScorePage.tsx` の state（＋譜面データ）だけで持っていた。種別を切り替えても state はそのまま残るため、結果として同じく「またいで共有」される挙動だった

そのため、単旋律で 8小節/段 にした設定が編成譜にも効いてしまい実用に合わない（編成譜は 4小節・1〜2段が普通）。

### 修正設計

**`resolveDefaultLayoutForScoreType()` の系には寄せていない**（トリアージの指示どおり）。あちらは「ユーザーがまだ触っていないときの既定値」を種別ごとに決める仕組みで、今回は「ユーザーが実際に使った値そのものを種別ごとに覚える」話であり、層が違うため。

1. **保存層を新設**（`src/utils/systemLayoutPrefs.ts`）。新しい localStorage キー `score-system-layout-by-score-type` に、**1キー＝種別→値のマップ**として持つ。

   ```json
   { "piano": { "measuresPerSystem": 2, "systemsPerPage": 4 }, "ensemble": { "measuresPerSystem": 4 } }
   ```

   種別ごとに4本のキーへ分ける案もあったが、(1) 読み書きが1回で済み「片方だけ書けた」状態が起きない (2) 旧キーをそのまま別に残せる の2点からマップ方式にした。値の検証（範囲外・型違いを項目単位で落とす）は `settingsProfile.ts` と同じ方針。

2. **移行**: 新キーがまだ無いときだけ、旧単一キー `score-systems-per-page` の値を**全種別の初期値としてコピー**して新キーへ書き戻す（`migrateLegacySystemsPerPage`）。移行は一度きりで、以降は新キーが正。**旧キーは消さず、変更のたび書き続ける**（`saveLegacySystemsPerPage`）ため、古いバージョンのアプリで同じ localStorage を開いても従来どおり動く。

3. **「段数/ページ」は state を廃止して導出値にした**。

   ```ts
   const systemsPerPageSetting = getSystemsPerPageFor(systemLayoutPrefs, scoreType);
   ```

   楽譜種別が変わる経路は多い（種別ボタン・編成テンプレート・読込・自動保存の復元・サンプル譜・初期値プリセット）。state にして各経路へ「切り替え処理」を足すと必ず1つ忘れるため、`scoreType` から導出する形にして**どの経路からでも自動的に追従する**ようにした。

4. **「段あたり小節数」は state のまま**。譜面データ（`SavedScoreData.measuresPerSystem`）が正であり、保存済み譜面を読み込んだときはその譜面の値が優先されるべきなので、導出にはできない。代わりに次の2点を配線した。
   - 入力欄で変えたとき: `withMeasuresPerSystem(prefs, scoreType, v)` で現在の種別の値として記録する
   - 楽譜種別が**実際に変わった**とき（`handleScoreTypeChange` / `handleInstrumentationPresetChange`）: `getMeasuresPerSystemFor(prefs, newType)` で切り替え先の値へ戻す。同じ種別のボタンを押し直したときや、編成譜どうしのテンプレート入れ替えでは触らない（読み込んだ譜面が持つ値を保存値で上書きしてしまわないため）

5. **未設定の種別の既定値は `DEFAULT_MEASURES_PER_SYSTEM`（4）**。直前の種別の値は引き継がない（引き継ぐと「単旋律の8が編成譜に効く」という本Issueの症状がそのまま残るため）。この定数は `settingsProfile.ts` の工場出荷既定値からも参照しており、4 の記述は1箇所だけにしてある。

6. **初期値プリセット**（`applySettingsProfileToState`）は、プロファイルが持つ楽譜種別のぶんだけ段組を更新する。プロファイルは「ある1つの種別についての standard 設定」なので、他の種別に覚えさせてある値を巻き込まない。

### 「レイアウトをリセット」との関係（受入条件4）

`handleResetPageLayout` は**変更していない**。このボタンが戻すのはページ余白・タイトル余白・段の間隔（全体・段ごと）・パート間隔であり、段組の2項目はもともと対象外のため、種別ごとの保存値（現在の種別のぶんも他の種別のぶんも）には一切触れない。受入条件4「現在の種別の値だけを既定へ戻す」は、**他の種別の段組設定を巻き添えにしない**という意味で満たしている（`ScorePagePerScoreTypeSystemLayout.test.tsx` で固定）。段の間隔・パート間隔は従来どおり種別をまたぐ単一キーのままで、本Issueのスコープ外（トリアージ「スコープはこの2項目のみ」）。

### 影響範囲

- `src/utils/systemLayoutPrefs.ts`（新規）: 保存層。純関数（parse / migrate / get / with）と localStorage の薄いラッパー
- `src/utils/settingsProfile.ts`: 工場出荷既定値の `measuresPerSystem: 4` を `DEFAULT_MEASURES_PER_SYSTEM` 参照へ。値は同じ
- `src/components/ScorePage.tsx`: `systemLayoutPrefs` state の新設、`systemsPerPageSetting` の state → 導出値への変更、種別切り替え2経路・段組の入力欄2つ・初期値プリセット適用の配線
- **保存済み譜面のデータ形式は変えていない**。`SavedScoreData.measuresPerSystem` は従来どおりで、読込・自動保存・MusicXML には影響しない
- **旧単一キーだけを持つ既存ユーザーの見た目は変わらない**（移行で全種別へコピーするため、切り替えても同じ段数から始まる）

### 未対応（意図的に見送った点）

- **保存済み譜面を「読込」しても、その譜面の段あたり小節数は種別ごとの保存値へ記録されない**。読込は `scoreType` と `measuresPerSystem` を同時に譜面データから設定するため画面表示は正しいが、その後いったん別種別へ行って戻ると、記録済みの（＝最後に入力欄で指定した）値のほうが表示される。入力欄で1度でも触れば一致するので実害は小さいと判断した
- 「段あたり小節数」には旧 localStorage キーが存在しないため、移行でコピーできる旧値が無い。現在開いている譜面の値は譜面データ側から復元されるので、**現在の種別については見た目が変わらない**（他の種別は既定値 4 から始まる）

## 追補（2026-08-23・ピアノの推奨段数を固定既定4へ）

本文の「ピアノの『4段まで』の上限（`Math.min(4, recommendedMaxSystemsPerPage)`）は維持」
「計算式は未変更」は、この追補で置き換える。

**問題**: ピアノの初期値は目安段数（`recommendedMaxSystemsPerPage`）でもクランプして
いたため、「段の間隔」を一度でも保存したことがある環境（Issue #199 のピアノ既定 −30px が
適用されず旧値のまま）では目安が3に落ち、初期表示が3段になっていた。工場出荷状態の
4段（#199 以降）と食い違い、運用者の実機で発生した。

**修正設計**: ピアノの4段は目安ではなく運用者の決めた既定値（3段より行間が自然・
2026-08-23 指定）として扱い、`recommendedSystemsPerPage` は
`Math.min(scoreType === 'piano' ? 4 : recommendedMaxSystemsPerPage, maxSystemsPerPage)` に
変更。あふれ防止は実測上限（`maxSystemsPerPage`）のクランプだけが担う。

**影響範囲**: ピアノで段数/ページを手動保存していないユーザーの初期値のみ（3→4に
なり得る）。手動保存値の優先（`systemsPerPageSetting ?? recommendedSystemsPerPage`）と、
上限超過時の「クランプせず警告」の経路は不変。

**検証**: `ScorePagePianoDefaultSystems.test.tsx`（工場出荷=4・段の間隔保存済み環境でも4・
手動保存の優先・物理上限が4未満の環境では上限値へクランプされ警告なし）。

## 画面ズームの滲み修正（#462・2026-08-28）

`.page-wrapper > .print-page` の `will-change: transform` を削除した。これがあると
ブラウザはレイヤーを読み込み時点の倍率でラスタライズしてキャッシュし、以後のズーム
（--scale 変更）は**画像の引き伸ばし**になって SVG の譜面が滲んでいた（再読み込みで
一時的に直る＝キャッシュの撮り直し、が症状の裏取り。弟の実機フィードバックと、
ペインでの will-change 無効化→改善の実測で確認）。削除により倍率変更のたびに最終倍率で
再ラスタライズされ、常にベクター品質で描かれる。transform: scale 方式自体（座標系 #13）は
変更していないため、クリック座標変換への影響は無い。

## 追補: 段ごとの調整UIを「段の選択+フローティングパネル」へ移設（2026-08-29・Issue #482）

### 問題

段ごとの小節数・間隔の調整UIは、ページ内の各段の直後に置いた**常設のコントロール行**（`段N ◀ N小節 ▶  間隔 － ±Npx ＋`）だった。これは実装としては素直だが、「譜面（紙面）の上に編集用の行がずっと居座っているのは不自然」というフィードバックが出た（#450 の運用者裁定 2026-08-29）。裁定では、操作の入口を**譜面上の直接操作**へ寄せ、段下の行は廃止する方針が確定した。本追補はその実装段階1（クリックでの選択+パネル化。ドラッグは段階2でスコープ外）。

### 修正設計

- **当たり判定は五線の左右端だけ**に置く。音部記号の手前／終止線の外からページ余白側へはみ出す位置（`left: -32px` / `right: -32px`・幅34px）に透明なボタンを重ねる。音符が来ない場所なので、譜面への入力クリックと物理的に衝突しない。`.print-page` は `overflow: hidden` だが、はみ出す先は紙の内側の余白なので隠れない。
- **段のラッパーを共通コンポーネント化**した（`src/components/SystemSelectFrame.tsx`）。これまで SingleStaff / PianoStaff / QuartetStaff / EnsembleStaff が各自で持っていた「`print-hidden-system` の付与 + 段ごとの間隔 `marginTop`」のラッパー div をここへ集約し、当たり判定・選択枠・パネルの差し込み口も同じ場所に置く（同じ見た目のラッパーを4か所へ複製しないため。#280 の「同じロジックの2枚目」問題への対処）。
- **パネル**（`src/components/SystemLayoutPanel.tsx`）は選択中の段にだけ描く。中身は旧コントロール行と同じ2項目で、値の増減は**既存の `adjustSystemMeasureOverride` / `adjustSystemRowGapOverride` をそのまま呼ぶ**。直接入力も「差分」に直してから同じハンドラへ通すので、上限・下限の判定と Undo の積み方はボタン操作と完全に同一（＝保存・Undo は移設前と変わらない）。
- **数値の直接入力**は、拍子・調号などの「途中変更オーバーレイ」と同じ型にそろえた（autoFocus・開いた時点で全選択・Enter で確定・Esc で取消・フォーカスを外しても確定）。Enter/Esc のあとに走る blur で二重に適用されないよう、確定済みフラグ（`settledRef`）で blur 側を無視する（増減が「差分」適用のため、二重に走ると倍動く）。
- **選択状態は ScorePage の画面 state**（`selectedSystem = { start, side }`）。譜面データではないので保存・Undo の対象にしない。解除は「Esc / Enter」「譜面の他の場所を押す（document の mousedown）」で、パネルと当たり判定には `data-system-select-keep="true"` を付けて解除対象から外す。段割りが変わって選択中の段が消えたときも自動で解除する。
- **パネルの位置は段の下端の外側**（クリックされた端の側）。当初は段の上に出していたが、ブラウザ実測で**1段目のパネルが画面上端の固定ツールバーに潜り込んで読めない**ことが分かったため下側へ変更した。
- 画面専用。`@media print` で当たり判定・パネル・選択枠を消す（旧コントロール行と同じ扱い）。印刷プレビュー中は操作できるよう隠さず、触っていない間だけ半透明にする（これも旧行の扱いを引き継ぎ）。

### 影響範囲

- 追加: `src/components/SystemSelectFrame.tsx`（段の共通ラッパー）、`src/components/SystemLayoutPanel.tsx`（パネル）。
- `src/components/ScorePage.tsx`: 段下コントロール行のJSXを削除。選択 state・解除の配線・`renderSystemPanel` を追加し、4つの Staff コンポーネントへ中継。
- `src/components/SingleStaff.tsx` / `PianoStaff.tsx` / `QuartetStaff.tsx` / `EnsembleStaff.tsx`: 段のラッパー div を `SystemSelectFrame` へ差し替え、選択まわりの props を中継。
- `src/App.css`: `.system-measure-override-*` 系を削除し、`.system-select-frame` / `.system-select-edge` / `.system-layout-panel` 系を追加（`@media print` と `.print-preview` の対応するルールも差し替え）。
- テスト追加: `src/components/ScorePageSystemSelectPanel.test.tsx`（実マウントで選択→パネル→値変更→反映→Undo→解除）、`src/AppCssSystemSelectPrint.test.ts`（印刷で出ないこと・旧クラスが残っていないこと）。

### 検証結果

- `npx tsc --noEmit`: エラーなし。`npm run lint:ratchet -- --check`: 基準値ちょうど（324件）。`npm run build`: 成功。
- vitest（変更に関係するファイル）: 新規5テスト＋既存の Staff 系・ScorePage レイアウト系 84テスト すべて緑。
- ブラウザ実測（dev サーバー・単旋律譜）:
  - 段の左端／右端クリックで薄い枠が付き、クリックした側の下にパネルが出る。
  - 「間隔 ＋」2回で `+8px`、段のラッパーの `margin-top: 8px` が実際に反映される。
  - 数値クリック→直接入力→Enter で確定し、パネルが閉じる。
  - 譜面の他の場所をクリックすると選択が解け、譜面上に何も残らない。
  - 段下のコントロール行は1つも描画されない（`.system-measure-override-controls` は0件）。
  - コンソールエラーなし。
  - 注意: 共有 dev サーバーは worktree 配下のファイルを監視しておらず、CSSの再取得が効かない。パネル位置の変更（上→下）は、同じ内容のルールをページへ注入して実測した。

### #482 Codex round 1 対応（2026-08-29）

- **[P1] 直接入力と選択解除のレース**: 譜面クリック時、document の mousedown（パネルを
  閉じる）が入力欄の blur より先に走り、「フォーカスを外して確定」が失われていた。
  入力欄は onChange で最新値を ref に控え、未確定のままアンマウントされたら
  クリーンアップでその値を確定する（DOM ref はクリーンアップ時点で外れていることが
  あるため使わない）。負のテストで検出力を確認済み
- **[P1] 当たり判定の高さ**: 外枠（.system-select-frame）はページの段スロット
  （固定高）に引き伸ばされるため、当たり判定が段間の余白まで反応していた。
  内側ラッパー（.system-select-inner・中身＝五線 SVG の自然高）を位置基準にし、
  当たり判定・選択枠・パネルを五線の実描画範囲に沿わせた
- **[P2] 範囲外入力の無言終了**: 直接入力の範囲外は端の値へ丸めて適用し、
  丸めた理由（有効範囲）を通知する。数値として読めない入力も理由を通知する
  （describeSystemLayoutValueClamped / Invalid・#318）
- **[P2] 配線テストの譜種網羅**: piano / quartet / ensemble の右端クリック→パネル
  出現を実マウントで追加（4譜種の SystemSelectFrame 配線の固定）。あわせて
  小節数の直接入力・クリック外し確定・丸め通知のテストも追加

### #482 Codex round 2 対応（2026-08-29）

- **[P1] 通常 blur の二重確定**: onBlur が確定した直後のアンマウントで、round1 で
  入れたクリーンアップ確定が同じ値をもう一度適用していた（差分が倍・Undo二重）。
  onBlur でも確定済みの印（settledRef）を先に立てる。パネル単体テストで
  「blur で確定は一度だけ（呼び出し回数=1）」を固定
- **[P2] 印刷の選択枠**: outline の実体が内側ラッパーへ移った（round1）のに、
  @media print のリセットが外側セレクタのままだった。内側もリセットし、
  CSSテストの期待も内側セレクタを本命として強化
- **[P2] 編集バッファ段の直接入力**: 内容末尾より後ろの段では上限（内容小節の残数）が
  現在の小節数を下回り、値を変えない確定でも1小節へ縮んでいた。上限を
  「最低でも現在値」にし、現在値のままの確定が no-op であることをテストで固定
