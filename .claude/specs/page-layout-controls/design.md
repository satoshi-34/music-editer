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
一時的に直る＝キャッシュの撮り直し、が症状の裏取り。ユーザーの実機フィードバックと、
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

### #482 Codex round 3 対応（2026-08-29）

- **[P2] 空文字入力**: Number('') === 0 のため、入力を消して確定すると間隔0px・
  小節数1へ無通知で化けていた。確定は生文字列で受け、空文字・非数値を変換前に
  検査して「読み取れなかった」通知だけ出す（Enter / blur / アンマウントの全経路共通）
- **[P2] バッファ段の実配線テスト**: round2 のテストは maxMeasureCount を直接注入して
  いたため ScorePage 側の「最低でも現在値」を固定できていなかった。実マウントで
  ＋小節を追加→バッファ段（start=内容末尾）を選択→値を変えない blur 確定で
  縮まないことを固定（負のテストで ScorePage 側修正の検出力を確認済み）

### #482 Codex round 4 対応（2026-08-29）

- **[P2] 小数入力の無通知丸め**: 丸め通知の比較が Math.round 後同士だったため、
  1.5→2 等の小数入力が無通知で変わっていた。比較を「適用値 ≠ 入力値（丸め前）」へ
  広げ、文言も「min〜max の整数で指定できます」に変更。Enter / blur 両経路と
  「丸め結果が現在値と同じでも通知は出る」ケースをテストで固定

### #482 Codex round 5 対応（2026-08-29）

- **[P2] Enter での解除が再選択される**: フォーカスが端ボタンに残ったまま Enter を
  押すと、document の keydown で解除した直後にボタンの既定 click が発火して
  同じ段を再選択していた。keydown で preventDefault を呼び既定動作を止める。
  テストは fireEvent の戻り値（preventDefault 済みなら false）で既定動作の抑止を固定

## 追補: 最終ページの例外（下端寄せ）を廃止し、行グリッドを全ページ共通にした（Issue #506、2026-08-31）

本ドキュメント本文で「最終ページ専用の配置（`.print-final-page` / `.print-final-page-single`）は
行グリッドの対象外」としていた例外は廃止した。最終ページも他ページと同じ固定スロット式
（`--page-capacity` ベースの `flex: 0 0 calc(...)` ＋ `margin-top: var(--system-row-gap)`）で配置し、
段数が足りないぶんはページ下端の余白として残す（上詰め）。

理由と経緯は `.claude/specs/final-barline/design.md` の「追補3」を参照。要点は、最終ページだけ
行グリッドを外して `space-between` で引き伸ばしていたため、段数が端数になる最終ページで
段間隔だけが異常に広がり、最下段がページ番号（`.page-foot`）と重なっていたこと。

- 画面表示側の `.screen-final-page-single`（表示段が実質1段だけのページを上揃えにする。Issue #68）は
  今回変更していない。印刷側の例外とは判定基準も対象も異なるため（画面は空の段を含めて数える）。

## 追補: 段の境界ドラッグで段の間隔を変える（2026-09-01・Issue #523 = #450 の子2）

#482（追補「段ごとの調整UIを『段の選択+フローティングパネル』へ移設」）で「ドラッグは段階2で
スコープ外」としていた部分の実装。ユーザーフィードバック（#450）の「段等をドラッグ&ドロップで変更+
数値指定の両方」「つまみは使いづらい」に対する、直接操作側の入口にあたる。

### 掴みしろをどこに置くか（round1 の差し戻しで作り直した中心）

Issue の仕様1は「段の**下端**（次の段との境界帯）をドラッグするとその段の間隔が変わる」だったが、
この2つは両立しない。**段の間隔は「後続の段の `margin-top`」として入る値**なので、
「その段の間隔」を動かすと変わるのはその段の**上側**のすき間であり、掴んだ下端ではない。
round1 の実装はこの取り違えのまま出しており、1段目を掴むと「境界が動く」のではなく
「譜面全体が下へずれる」だけになっていた。

作り直しでは、レビューで示された原則「**掴んだ境界が動く**」に沿って次のように決めた。

| 案 | 動き | 判断 |
| --- | --- | --- |
| A: 下端の帯が**次の段**の上書きを動かす | 掴んだ境界は動く | パネル（選択中の段の値）と数値が一致しない。受入条件1「パネルの数値と一致」を満たせない |
| **B: 掴みしろを段の上端へ移す（採用）** | 掴んだ境界＝その段の `margin-top` がそのまま動く | 掴んだ線・パネルの数値・実際に動く場所の3つが一致する |

採用した案Bの結果として:

- **帯は選択中の段の上端**（`bottom: 100%`）に出る。下へドラッグすればその段が下がって上のすき間が広がり、
  上へドラッグすれば詰まる。パネルの「間隔」の数値はドラッグ中もリアルタイムで一致する。
- **ページの先頭の段には帯を出さない**。上に段が無い＝動かせる境界が存在せず、そこで値を入れると
  「境界が動く」ではなく「ページの中身全体が下へずれる」になるため（round1 の症状そのもの）。
  この段の間隔をどうしても入れたい場合は従来どおりパネルの数値指定で入れられる。
  判定は `findPageIndexForSystem` / `getPageSystemOffset`（ページ割りの正本）を使い、
  「そのページの先頭の段かどうか」で決める。
- 「ある段の**下**のすき間を広げたい」ときは、**下の段を選んでその上端を掴む**という操作になる。

### 修正設計（その他）

- **掴みしろは選択中の段にだけ出す**（`src/components/SystemGapDragHandle.tsx`）。高さ14px・
  `cursor: row-resize` の透明な帯を1本置く。常設しないので、譜面の上に編集用の当たり判定が
  居座らない（#482 と同じ方針）。
- **#482 の左右端（`.system-select-edge`）とは物理的に分けてある**（受入条件4）。左右端は五線の外側・
  カーソルは `pointer`、境界帯は段の上・カーソルは `row-resize` で、位置もカーソルも重ならない。
  パネルは段の下側に出るので、帯（上）とパネル（下）も上下に分かれる。
- **差し込み口はパネルと共用**した。`SystemSelectFrame` の `renderPanel`（選択中の段にだけ描く
  重ね物の穴）が返すツリーへ帯とパネルを並べて入れる。どちらも内側ラッパー
  （`.system-select-inner`＝五線の実描画範囲）を基準に絶対配置するため基準は1つで済み、
  4つの譜種コンポーネント（SingleStaff / PianoStaff / QuartetStaff / EnsembleStaff）へ
  新しい props を通す必要が無い。
- **ドラッグの起点は「その段の現在の上書き値」**（無ければ 0）にした（round1 P2 の指摘）。
  round1 は「いま効いている `margin-top`」（`getComputedStyle`＝全体設定＋上書きの合計）を
  起点にしていたため、ピアノ譜（全体の「段の間隔」が既定 -30px）で1px動かすだけで
  `-30 + 1 = -29px` が**その段の上書きとして保存**され、以後その段だけ全体設定の変更へ
  追従しなくなっていた。上書き値を起点にすれば、保存されるのは常に「全体設定への差分」のままになる。
  ただし現状の合成方法には既存の歪みがあり、全体設定が0以外の譜面では
  「上書きが 0 から 0 以外へ変わる最初の1回」だけ段が飛ぶ（次項）。
- **画面px→レイアウトpx の換算**は、要素自身の「実測の高さ ÷ レイアウト上の高さ」で求めた倍率で割る。
  譜面は `.print-page` の `transform: scale()` で拡大縮小されるため、これをしないとズーム時に
  指と段がずれる（変倍の実装＝CSS変数へ依存しない測り方にしてある）。実レイアウトを持たない
  jsdom では 0 が返るので等倍として扱う。
- **値は毎回「掴んだ時の値＋総移動量」**で決める。1回ごとの差分を足し込む方式だと、上下限
  （-60〜+50px）で丸められたぶんが失われ、戻すときに指と段がずれていく（#522 の記号ドラッグと同じ理由）。
- **3px の遊び**（`DRAG_START_THRESHOLD_PX`）を超えるまでは値を変えない。押した指の震えで
  間隔が変わるのを防ぐ（#522 の記号ドラッグと同じ流儀・同じ値）。
- **ドラッグ中の現在値**はカーソルの横に吹き出しで出す（受入条件3・#318「何が変わっているか見せる」）。
  帯は段と一緒に動くので、帯の左端からの相対位置（レイアウトpx）に直して置いている。

#### 実測で見つかった既存の歪み: 上書きは全体設定を「足す」のではなく「置き換える」

ブラウザ実測（ピアノ譜・全体の「段の間隔」を -30px にした状態）で分かったこと:

- 上書きが 0 の段を掴んで 24 画面px 下げると、上書きは `+31px`（＝動かしたぶん）になるが、
  段は **47 画面px**（＝ 61 レイアウトpx ＝ 30 + 31）下がる。指と段が 1:1 にならない。
- 同じ跳びは**ドラッグ固有ではなく、パネルの ＋ でも起きる**: `+0px → +4px` の1クリックで
  段が 26 画面px（＝34 レイアウトpx ＝ 30 + 4）動く。

原因は合成方法。段ごとの上書きは段のラッパーへ `style={{ marginTop: gapOverride }}`（インライン）
として入るが、全体設定は `.score-area .system-stack > * + * { margin-top: var(--system-row-gap) }`
という**同じプロパティ**のスタイル指定なので、インラインが勝って全体設定を**置き換えて**しまう。
上書きが 0 の段だけはスタイルを付けないため全体設定が効き、0 をまたぐ瞬間に全体設定ぶんが消える。

この design.md の #482 の節（「合成方法（全体設定 + 段ごとのオフセット）」）は
「CSS の `margin-top` は `gap` と加算的に効くため、全体設定＋段ごとの追加オフセットの合成は
自然に成立する」と書いており、**承認済みの設計は加算**である。加算が成立していたのは全体設定が
`.system-stack { gap: ... }` だった頃の話で、その後（同じ design.md の別の追補）全体設定の実現方法を
`gap` から `* + *` の `margin-top` へ移したときに、置き換えへ静かに変わったまま気づかれていない。

**本Issueでは直していない**（#523 の受入条件の外で、#482 のパネルの数値の意味と既存の保存データの
見え方が変わる変更になるため）。構造的な歪みとして #244 へ記録し、直すかどうかは別途判断する。
ドラッグの起点を「実効値」に戻すのは対処にならない（round1 P2 の実害が戻るだけ）。

### pointer イベント規約（#536）への追随

round1 は `mousedown` / `mousemove` / `mouseup` だけで受けていたため、タッチでは動かせず
（タッチの互換マウスイベントは指の移動中の連続 `mousemove` を配送しない）、
OS にポインタを取り上げられるとドラッグ状態と window のリスナーが残っていた。#536 で確立した
規約へそろえてある:

- 開始は `onPointerDown` で受け、`isPrimary` かつ `button === 0`（主ポインタの左ボタン/指）だけを掴む
- セッションに `pointerId` を控え、`pointermove` / `pointerup` / `pointercancel` は**同じ pointerId のときだけ**処理する
  （多点タッチで別の指が動いても値が飛ばない）
- `pointercancel` は掴む前の値へ戻して終了する（利用者の「ここで決めた」ではないため）
- 帯には `touch-action: none`（タッチのドラッグをブラウザのスクロールへ取られない）
- `pointermove` / `pointerup` は帯ではなく **window** で受ける。帯は14pxしかなく、掴んだ直後に
  カーソルは帯の外へ出るため、要素で受けると1pxも動かせない（弧のドラッグが #235 で同じ結論）

#### 既存実装の共用（新しい経路を作らない）

| 役割 | 共用している実装 |
| --- | --- |
| 上書きの upsert・上下限のクランプ | `updateSystemRowGapOverride`（`adjustSystemRowGapOverride` から切り出した共通の出口。パネルの － ＋・直接入力は「差分」、ドラッグは「絶対値」で同じ関数を通す） |
| 画面への反映 | 従来どおり `getSystemGapOverridesPx` → 各 Staff の `systemGapOverridesPx` → ラッパーの `margin-top` |
| 保存 | `systemRowGapOverrides`（保存・読込・印刷の経路は一切変えていない） |
| ページ割りの判定 | `findPageIndexForSystem` / `getPageSystemOffset`（`pageSystemLayoutUtils`。印刷の可視ページ判定と同じ関数） |
| Undo | `pushHistory` / `historyStack` / `futureStack`（`scoreHistoryStack`） |

「同じロジックの2枚目」を作らない方針（#223 の修正が別実装へ届かず #280 が起きた反省）に沿って、
上書きを書き換える箇所は `updateSystemRowGapOverride` の1か所だけにしてある。

### Undo が1操作になる仕組み（受入条件4）

パネルの － ＋ は「1クリック＝1履歴」でよいが、ドラッグは 1px 動くたびに値が変わるため、同じ経路
（`adjustSystemRowGapOverride`）をそのまま使うと履歴が何十件も積まれる。そこで履歴を積む役目だけを
呼び出し側へ出し、`SystemGapDragHandle` が **「値が実際に変わる最初の時点」** で `onDragStart`
（＝`beginSystemRowGapDrag`）を1回呼ぶ。移動中は履歴を積まない `setSystemRowGapOverrideValue` で
値だけを進める。

積むきっかけを round1 の「遊び（3px）を超えた瞬間」から「値が実際に変わる時点」へ変えたのは、
上下限に張り付いた状態で指だけ動かしたときに、何も変わらないのに履歴が1件増えていたため（round1 P2）。
さらに、**掴んだ位置まで戻して離した場合**（`onDragEnd(changed=false)`）は、`beginSystemRowGapDrag` が
控えておいた「積む直前の履歴スタック」へ戻して、その1件を取り消す。履歴スタックは push のたびに
新しい配列へ差し替わる（`scoreHistoryStack` は非破壊）ので、直前の配列を持っておくだけで元へ戻せる。

### 範囲外（今回やっていないこと）

- **パート間隔（ピアノの両手間など）の境界ドラッグ**は含めていない（Issue #523 の仕様5が
  「無理なら子3へ分割し Issue に明記」としている選択肢）。理由は、パート間隔が
  「段ごとの上書き」ではなく**譜面全体の設定**（`partSpacingOffsetPx`・設定プロファイル）であり、
  当たり判定も五線の内側＝SVG（`PianoSystemCanvas`）に置く必要があって、データモデルも
  当たり判定の置き場所も本Issueの段間隔とは別物になるため。段ごとの上書きを新設するのか
  全体設定をドラッグで動かすのかという仕様判断も要る。（→ **Issue #572 で実装した**。仕様判断は「全体設定をドラッグで動かす」に決まった。
  当たり判定も SVG の中ではなく段の重ね物として置けた。下の追補を参照）
- キーボードからの境界操作は追加していない（数値指定・キーボード操作は #482 のパネル側が担当）。

### 影響範囲

- 追加: `src/components/SystemGapDragHandle.tsx`、`src/components/ScorePageSystemGapDrag.test.tsx`（13件）。
- `src/components/ScorePage.tsx`: `updateSystemRowGapOverride` の切り出し、`setSystemRowGapOverrideValue` の追加、
  ドラッグ1回ぶんの履歴を積む／取り消す `beginSystemRowGapDrag` / `endSystemRowGapDrag` の追加、
  `renderSystemPanel` が（ページ先頭の段を除いて）帯とパネルを並べて返すよう変更。
- `src/components/SystemSelectFrame.tsx`: `renderPanel` の説明を「パネルと境界帯」に更新（実装は変更なし）。
- `src/App.css`: `.system-gap-drag-handle` / `.system-gap-drag-value` を追加し、`@media print` で非表示に。
- `src/AppCssSystemSelectPrint.test.ts`: 印刷で帯が出ないことの検査を1件追加。
- `README.md`（操作の説明を1行追加）・`docs/REGRESSION.md`（セクションY。#544 が X を使ったため繰り下げ）。

### 検証結果

- vitest（変更に関係するファイル）: `ScorePageSystemGapDrag`（新規13件）・`ScorePageSystemSelectPanel`（19件）・
  `AppCssSystemSelectPrint`（3件）すべて緑。`npx tsc --noEmit` エラーなし。
  `npm run lint:ratchet -- --check` 基準値ちょうど（324件）。`npm run build` 成功。
- ブラウザ実測（worktree の一時エントリ・ピアノ大譜表・3段）:
  - **等倍（ズーム100%・全体の段の間隔 0px）**: 段2を選択 → 上端の帯を実マウスで 24 画面px 下へドラッグ →
    上書きが `+31px`（= 24 / 0.7705）になり、段2が 570.8 → 595.0（+24.2 画面px）へ移動。**指と 1:1**。
    段1は 410 のまま**1pxも動かない**（round1 P1 の取り違えが直っていること）。パネルの数値も `+31px` に追従。
  - **「元に戻す」1回**で `margin-top` が消え、段2が 570.8 へ戻る（誤差なし）。
  - **ズーム150%**（帯の実測高さ 16.18px ÷ レイアウト 14px = 倍率 1.156）: 40 画面px のドラッグで
    上書き `+35px`（= 40 / 1.156）、段2は 552.7 → 593.1（+40.4 画面px）。倍率の割り戻しが効いている。
    段1は 311.8 のまま動かない。
  - **ドラッグ中の吹き出し**（`+26px`）が段と段のすき間・カーソルの横に出て、離すと消える。掴んでも段の選択は解けない。
  - **タッチ**（`pointerType: 'touch'`）でも同じように動く。ドラッグ中に別の指（別 `pointerId`）を動かしても値は動かない。
    `pointercancel` で掴む前の値へ戻り、その後の `pointermove` でも動かない（リスナーが残っていない）。
  - **ページの先頭の段（段1）には帯が出ない**（`system-gap-drag-0` が存在しない）。帯のカーソルは `row-resize`。
  - 全体の「段の間隔」を -30px にした状態でドラッグしても、上書きへ入るのは `+31px`（動かしたぶんだけ）で
    `-30` は焼き込まれない（round1 P2 が直っていること）。ただし前掲の「既存の歪み」により、
    この1回目だけ段の移動量が指より 30px 多い。
  - コンソールエラーなし。

## 追補: レイアウトタブを「整えるモード」にする（2026-09-04・Issue #571）

### 問題

#482（段の選択+パネル）と #523（境界ドラッグ）で調整の口は用意できたが、**入口が見えない**。
掴みしろは「段を選んでいる間だけ」出て、その段を選ぶには五線の左右端という細い帯を
当てる必要があるため、運用者QA（2026-09-02 / 2026-09-03）で運用者自身が
「段の間隔やパート間隔をドラッグで調整できない」「段ごとの小節数を後から調整できない」と
2回続けて報告した。実装はどちらも存在していたので、機能ではなく発見可能性の欠陥である。

### 修正設計（当たり判定の3層）

新しいモード機構は作らず、**既存のツールバータブをそのままモードとして使う**
（運用者との合意）。`activeToolbarTab === 'layout'` かつ段の選択が有効な間を
「整えるモード」とし、`.score-area` へ `layout-adjust-mode` クラスを付ける。
このモード中の当たり判定は次の3層に分ける（運用者裁定 2026-09-02）:

| 層 | 何になるか | 実装 |
| --- | --- | --- |
| 段の上端の帯 | 上の段との**間隔** | `SystemGapDragHandle`（#523）を全段へ常設。`::before` の線を `opacity: 0.45` で薄く出す |
| 五線の面 | 段の**選択** | `.system-select-surface`（透明なボタン・`inset: 0`）を差し込む |
| 枠の右下の角 | 譜面全体の**音符の大きさ** | `NotationSizeDragHandle`（新規・◢） |

左右端の掴みしろ（`.system-select-edge`）も、このモード中だけ薄く色を付けて
「段は選べる」と分かるようにした。他のタブではクラスが付かないので、
**譜面を書いている間の見た目は1pxも変わらない**（受入「音符・休符タブへ戻るとバンドが消える」）。

#### 「選択中の段だけ」から「選択できる段すべて」へ

`SystemSelectFrame` は差し込み口（`renderPanel`）を **選択中の段でのみ**呼んでいたが、
整えるモードでは選択していない段にも帯が要る。そこで呼ぶ条件を `selectable`（＝段として
選べる）へ広げ、**何を出すかの判断は ScorePage 側**（`renderSystemPanel`）へ寄せた。
こうすると「いまモードか」を4つの譜種コンポーネント（SingleStaff / PianoStaff /
QuartetStaff / EnsembleStaff）越しに props で通さずに済む。選択中かどうかは
ScorePage も `selectedSystem` を見ているので、判断が二重になることはない。

#### 帯を掴んだら段が選ばれる（受入2）

`SystemGapDragHandle` に `onGrab`（pointerdown の時点で1回）を足し、掴んだ段を選択する。
遊び（3px）の判定より前に呼ぶので、**掴んだだけでドラッグしなくても選択される**。
選択は `selectSystemForLayout`（トグルしない）で行う。左右端クリック（`handleSystemSelect`）と
同じトグルにすると、掴んだ拍子に選択が解けて調整が中断される。

#### 角のリサイズハンドル（◢）と「（全体）」の明示

角は「掴んだ枠だけが変わる」と読めてしまうのが最大の誤解なので:

- ドラッグ中の吹き出しは必ず `音符の大きさ（全体）: 150%` と**（全体）**を出す
- プレビューは全段が同時に変わる（1段だけ変わる見せ方をしない）
- 値の刻みは**スライダーと同じ 5%**。1%刻みにすると range 入力（step=5）がつまみを
  倍数へ丸めてしまい、つまみと数字が食い違って見える（ブラウザ実測で判明）

#### 共通化: `useValueDragSession`

段の境界帯と角ハンドルは「変える値」が違うだけで手順（遊び→履歴1件→確定／取り消し、
#536 の pointer 規約、ズーム補正、pointercancel とアンマウントの巻き戻し）が同一である。
2枚目を書くと片方の修正が届かない（#280 の実害）ため、`src/hooks/useValueDragSession.ts` へ
寄せ、各ハンドルには「どの向きの移動を、どんな値に読み替えるか」だけを残した。
既存の #523 のテスト16件がそのまま緑なので、境界帯の挙動は据え置きである。

### 音符の大きさを Undo の対象に加えた（副作用と、その後始末）

角ハンドルは「Undo はドラッグ全体で1件」（#539 の規約）を満たす必要があるが、
`notationSizeMultiplier` は Undo/Redo のスナップショット（`ScoreSnapshot`）に入っていなかった。
そこでこの値をスナップショットへ足し、`applySnapshot` で復元するようにした。

これには**スライダー側の対応が必須**である。スナップショットは常に「その時点の大きさ」を
持つため、スライダーだけが履歴を積まないままだと、スライダーで変えた値が**無関係な Undo で
古い値へ戻ってしまう**。よってスライダーも「つまみ操作1回＝履歴1件」で積む
（`onPointerDown` で区切り、値が実際に変わる最初の1回だけ `pushHistory`。キーボードの
矢印は `e.repeat` で押しっぱなしを1件にまとめる）。結果として、
**大きさの変更はスライダーからでもドラッグからでも「元に戻す」1回で戻る**。

値の出口は `applyNotationSizeMultiplier` 1本にまとめた（クランプと localStorage 保存を
1か所に置き、入口が増えても書き忘れが起きないようにするため）。

### 影響範囲

- `src/hooks/useValueDragSession.ts`（新規）: ドラッグの共通部分
- `src/components/NotationSizeDragHandle.tsx`（新規）: 角の◢
- `src/components/SystemGapDragHandle.tsx`: 共通フックへ移行 + `onGrab` 追加
- `src/components/SystemSelectFrame.tsx`: 差し込み口を「選択できる段すべて」で呼ぶ
- `src/components/ScorePage.tsx`: `isLayoutAdjustMode` / `selectSystemForLayout` /
  `renderSystemPanel` の作り替え / `.score-area` のクラス / スナップショットと
  スライダーの履歴 / `applyNotationSizeMultiplier`
- `src/App.css`: 整えるモードの表示規則・`.system-select-surface`・`.notation-size-drag-handle`。
  `@media print` で新しい2つを非表示に（REGRESSION Y の印刷規則の維持）
- テスト: `ScorePageLayoutAdjustMode.test.tsx`（新規8件）・`AppCssSystemSelectPrint.test.ts`（+2件）
- `README.md`（操作の説明）・`docs/REGRESSION.md`（セクションZ）

### 範囲外（今回やっていないこと）

- **パート間隔（大譜表の右手/左手の間）のドラッグ**は未実装のまま（Issue 注記どおり・#449 系で別途）。
  帯＝間隔の層は「段の上端」だけで、パート間のバンドはまだ無い
- パートごとの五線サイズ（角ハンドルの意味の見直しは、それが入る時点で再検討する）

### 検証結果

- vitest（変更に関係するファイル）: `ScorePageLayoutAdjustMode`（新規8件）・
  `ScorePageSystemGapDrag`（16件）・`ScorePageSystemSelectPanel`（19件）・
  `AppCssSystemSelectPrint`（5件）・レイアウト系9ファイル68件、すべて緑。
  `npm run build` 成功。`npm run lint:ratchet -- --check` 基準値ちょうど（324件）。
- ブラウザ実測（worktree の一時エントリ・単旋律・段あたり2小節で3段）:
  - 音符タブでは帯・面の当たり判定・`layout-adjust-mode` のいずれも無い。
    レイアウトタブを開くと、**選択なしのまま**2段目以降に帯（`::before` の実測 `opacity: 0.45`）が出て、
    左右端に `rgba(147, 197, 253, 0.12)` が乗る。1段目には帯が出ない（#523 の原則を維持）
  - **選択していない段の帯を実マウスでドラッグ** → その段が選択されてパネルが出て、
    同じ操作のまま間隔が `+31px` に変わった（受入「1操作でできる」）
  - **五線の面をクリック** → 段が選択され、`段N ◀ N小節 ▶` のパネルへ到達できる（受入4）
  - **角の◢を斜めにドラッグ** → 吹き出し `音符の大きさ（全体）: 90%`、スライダーの値も `90`、
    右の数字も `90%` で完全に一致（5%刻みにそろえた効果）
  - 音符タブへ戻すと帯・面・クラスがすべて消える
  - コンソールエラーなし（※ dev サーバーが編集前のモジュールを配信していた間だけ
    React の "Maximum update depth exceeded" が2回出た。`curl` で配信内容と worktree の
    食い違いを確認 → コンテナ再起動後は上記の一連の操作でも1件も出ない）

### round1 の差し戻しへの対応（2026-09-04・PR #614）

#### P1: 角のドラッグがスナップバックする（ドラッグの主を ScorePage へ移した）

**問題**: 角の◢を引くと、値が掴む前へ跳ね戻り、積んだ Undo 履歴まで取り消されていた。

原因は「◢がドラッグの状態を自分で持っていた」こと。音符の大きさは譜面全体に効くので、
値が変わると段割り・ページ割りが計算し直される。◢は「ページ → 段（`SystemSelectFrame`）」と
辿った先に描いているため、掴んでいた段が別のページの子へ移ると、React から見ると**親が
変わる＝いったんアンマウント**になる。`useValueDragSession` にはアンマウントを
「ドラッグ中止」とみなす後始末（#523 round2 P2 で入れたもの）があるので、これが
引いている最中に走って値を戻し、履歴も巻き戻していた。

**修正**: ドラッグの主（`useValueDragSession` の呼び出し）を、動的なページツリーより上の
**`ScorePage` 直下に1つだけ**置いた。`ScorePage` はドラッグ中にアンマウントされないので、
◢が消えて描き直されても値・履歴・window のイベントはそのまま生き続ける。
各段の◢（`NotationSizeDragHandle`）は掴み口（`onPointerDown`）を借りるだけの
**状態を持たない見た目の部品**になった。値の決め方（%への読み替え・5%刻み・斜めの平均）は
両者から使うので `src/utils/notationSizeDrag.ts` へ出してある。

副作用として、ドラッグ中の吹き出しも◢の中では出せなくなった（◢と一緒に消えてしまい、
いちばん値が動いている最中に「いま何%か」が見えない）。`ScorePage` がページの繰り返しの外へ
1つだけ、`position: fixed` でポインタの横に出す形へ移した。そのため
`useValueDragSession` の `valueHint` に画面座標（`clientX` / `clientY`）を足している
（掴みしろの中へ絶対配置する段の境界帯は、従来どおり `offsetXPx` を使う）。

なお境界帯（#523）の側は掴みしろが消える経路が無いため、フックの後始末はそのまま残している
（Esc で段の選択が解けたときに「なかったこと」にする本来の役割は維持）。

**受入テスト**: `ScorePageLayoutAdjustMode.test.tsx`
「角を引いて段がページをまたいでも、値が跳ね戻らない（round1 P1）」。16小節で
1ページ目の後方の段を掴み、200% まで引いて**その段が次のページへ移ったこと**
（`.print-page` をまたいだこと＝◢が描き直されたこと）を確かめたうえで、値が留まること・
離しても確定値のままであること・「元に戻す」1回で掴む前へ戻ることを固定した。
修正前のコードに対して実際に落ちることを確認済み（負のテスト）。

#### P2: 段を選んだまま他タブへ戻ると◢が残る

表示条件が「選択中の段」だけだったため、レイアウトタブで段を選んでから音符・休符タブへ
戻ると◢だけが譜面に残り、「他のタブでは譜面を書いている間の見た目を変えない」という
約束を破っていた。条件を `isSelected && isLayoutAdjustMode` にした（選択そのものは
残してよい。従来どおり選択中の段にはパネルが出る）。
受入テストはタブ切替の配線（レイアウト → 音符・休符 → レイアウト）で固定した。

#### P3: `renderPanel` の中の `findIndex` が段数の2乗になる

`renderSystemPanel` は段の数だけ呼ばれるので、その中で `visiblePlannedRanges` を
`findIndex` で走査すると全体で段数の2乗に比例する。先頭小節 → 段の通し番号の `Map` を
`useMemo`（依存は `visiblePlannedRanges`）で作り、引き当てを定数時間にした。

#### 却下された指摘（記録のみ）

「印刷プレビューに調整UIが残る」は #539 で確定した規則（実印刷のみ非表示・プレビューは
段調整のため表示が仕様。REGRESSION Y 節）と整合しており、修正しない。

#### 影響範囲（追加分）

- `src/utils/notationSizeDrag.ts`（新規）: 角のドラッグの値の決め方と吹き出しの文言
- `src/hooks/useValueDragSession.ts`: `valueHint` に画面座標を追加。掴みしろが
  画面から外れたあとは `offsetXPx` を据え置く
- `src/components/NotationSizeDragHandle.tsx`: 状態を持たない見た目の部品へ
- `src/components/ScorePage.tsx`: 角のドラッグセッションを直下に1つ保持／
  吹き出しをページの外へ1つだけ描画／◢の表示条件に `isLayoutAdjustMode`／
  `systemIndexByStartMeasure` の索引
- `src/App.css`: `.notation-size-drag-value` を `position: fixed` へ（`@media print` でも非表示）
- テスト: `ScorePageLayoutAdjustMode.test.tsx` に2件追加（計10件）

### round 2 の差し戻しへの対応（2026-09-05・PR #614）

#### P2-1: 同時ドラッグで Undo の退避先が壊れる（共有ロックで2本目を拒否）

Undo の退避先（`ScorePage` の `layoutDragHistoryRef`）は1つしか無く、「ポインタは1本しか
掴めない」という前提でそれを帯と◢で共有していた。しかし Pointer Events では、種類の違う
ポインタ（タッチとマウスなど）が**同時に primary として成立する**。2本目が別の掴みしろを
掴むと後発の `beginLayoutValueDrag` が退避を上書きし、片方の確定で退避が消えたあとに
もう片方が中止されると、空振りの Undo や確定済み履歴の巻き戻りが起きる。

対策は共有ロック（レビューの推奨案・単純な先着優先）:

- `useValueDragSession` に `ValueDragLock`（`{ ownerToken: object | null }` の小さな箱）と
  `createValueDragLock()` を追加。フック1つにつき1個の目印を持ち、`pointerdown` の時点で
  箱が空のときだけ掴んで目印を入れる。埋まっていれば**掴ませない**（`grabbing` にもしない）
- 外すのは自分が持ち主のときだけ（`finish()` と、アンマウント時のクリーンアップ）。
  アンマウント側はセッションの有無に関わらず先に外す（掴んだ直後に消えた場合の外し忘れ防止。
  外し忘れると誰も掴んでいないのに永久に掴めなくなる）
- `ScorePage` が箱を1つだけ持ち（`layoutDragLockRef`）、◢のセッションとすべての帯
  （`SystemGapDragHandle` の `dragLock` props）へ同じ箱を配る

2本目を黙って無視する（通知しない）のは、これが操作の行き止まりではなく一瞬の競合で、
先に掴んでいる操作は継続中のため。引いている最中に吹き出しが割り込むほうが邪魔になる
（理由はコードのコメントにも残した・「行き止まりは喋る」原則の例外の記録）。

#### P2-2: 帯もレイアウトタブの間だけにする

◢（round1 P2）と同じ理由で、境界帯の描画条件にも `isLayoutAdjustMode` を入れた。
これで「音符・休符タブでは帯も面も無い」（REGRESSION Z）が、段を選んだままの場合にも成り立つ。

**この変更で #523 の受入の前提が1つ変わる**: 帯は「選択中の段に出る」ものから
「整えるモード中に出る」ものになった（パネルからの数値指定はどのタブでも従来どおり）。
そのため `ScorePageSystemGapDrag.test.tsx` は段を選ぶ前にレイアウトタブを開くようにし、
「ドラッグ中に Esc で選択が解けても履歴が壊れない」テストは、Esc では帯が消えなくなった
（#571 で選択していない段にも帯が出るため）ので、帯が消える操作＝タブ切替へ手順を移した。
見ている中身（アンマウント＝pointercancel 扱い・退避の残留が次のドラッグを壊さないこと）は同じ。

#### P3: 間隔の上書きとページ先頭判定も索引化

round1 で段の通し番号だけを `Map` 化したが、`renderSystemPanel` にはまだ段数に比例する
走査が2つ残っていた。どちらも段の数だけ呼ばれるので、全体では段数の2乗になる。

- 間隔の上書き（配列が保存形式の正本）: 先頭小節 → `gapPx` の `Map` を `useMemo` で作る。
  各 Staff へ配る `getSystemGapOverridesPx`（ページごとに全段ぶん呼ばれる）も同じ索引を
  引くようにした（round3 P3。`find` を残すとそこだけ段数×上書き数に戻る）
- ページの先頭の段かどうか: `findPageIndexForSystem` は先頭ページからループするため、
  各ページの先頭にあたる段の通し番号の `Set` を一度だけ数え上げる。
  ページの段数は `Math.max(1, ...)` で下限を付ける（0 だと無限ループになるため）

#### 影響範囲（round 2 の追加分）

- `src/hooks/useValueDragSession.ts`: `ValueDragLock` / `createValueDragLock()` と
  `lock` オプション（掴む前の排他・持ち主だけが外す）
- `src/components/SystemGapDragHandle.tsx`: `dragLock` props をフックへ渡すだけ
- `src/components/ScorePage.tsx`: 共有ロックを1つ保持して帯と◢へ配る／帯の表示条件に
  `isLayoutAdjustMode`／`systemRowGapByStartMeasure`・`pageStartSystemIndexes` の索引
- テスト: `ScorePageLayoutAdjustMode.test.tsx` に2件追加（計12件）。round 3 で帯→◢・◢→帯の
  両方向のロック配線テストを2件追加（計14件。帯同士だけでは◢側の `lock` を外しても通るため）／
  `ScorePageSystemGapDrag.test.tsx` は帯を触る前にレイアウトタブを開くよう更新（16件のまま）
- `docs/REGRESSION.md`: Y 節（帯はモード中だけ・手順の移動）と Z 節（帯の消失・同時ドラッグ）へ追記

## 追補: 段の中のパート境界ドラッグでパート間隔を変える（2026-09-05・Issue #572）

#523（段の境界ドラッグ）で「範囲外」としていたパート間隔（ピアノ大譜表の右手/左手の間、
四重奏の4段の間、編成譜のパート間）の直接操作。運用者QA（2026-09-02）の
「段の間隔やパート間隔ドラッグで調整できないよ」＝**同じ操作でできると期待した**への対応。

### 何を動かすのか（仕様判断）

#523 の時点で保留していた「段ごとの上書きを新設するのか、全体設定をドラッグで動かすのか」は、
Issue #572 の仕様3が **全体設定（`partSpacingOffsetPx`・レイアウトタブの「パート間隔」スライダー）
を動かす**と決めている。段ごとの個別化は #449 で別途。

これは layout-pipeline/design.md の不変条件 **I3（同一段内のパート間隔が均一）** とも整合する。
`computeLayout(n, partSpacingOffsetPx)` は境界ごとの個別値を持たず、段内の全境界へ同じ補正を
一律に足す設計なので、**どの境界を掴んでも段内の全境界が同じだけ動く**。これは仕様どおりで、
「掴んだ境界だけが動く」という意味ではない（受入の「境界ごとに動くのは掴んだ場所だけ」は、
段の間隔の帯とパート間隔の帯を**取り違えない**＝掴んだ帯が担当する値だけが動く、という意味で満たす）。

### 帯の置き場所（実測せずに決める）

パート境界は五線と五線の間なので、#523 の帯（段の上端・`bottom: 100%`）とは位置が違う。
置き場所は **DOM の実測ではなく、描画が使うのと同じ純関数から求める**:

- `computeLayout(partCountForSystemLayout, partSpacingOffsetPx).staveYs[i + 1]` … 境界 i（0始まり）の論理 y
- `× effectiveRenderScale`（`SCORE_LAYOUT_RENDER_SCALE × 音符の大きさ実効倍率`）… レイアウトpx
- 五線の SVG の上端は段の内側ラッパー（`.system-select-inner`＝#523 が帯・パネルの基準にしている
  要素）の上端と一致するので、この値がそのまま帯の `top` になる

実測（`getBoundingClientRect`）に頼らないので、描画の完了を待つ必要がなく、jsdom でも位置を検証できる。
`PianoSystemCanvas` へ新しい props を通す必要も無い（#523 と同じく `SystemSelectFrame` の
`renderPanel` の穴へ差し込むだけ）。当初 #523 の追補で「当たり判定は SVG の中に置く必要がある」と
書いていたが、段の重ね物として置けることが分かったので、その見立ては撤回する。

### いつ出すか（仕様4・#571 の整えるモードに合わせる）

帯を出す条件は **`isLayoutAdjustMode`（レイアウトタブを開いている間）**。#614（#571）で
段の上端の帯・角の◢が「選択中の段だけ」から「整えるモード中は全段」へ移ったので、
パート境界の帯もそれにそろえた（仕様4）。段を選んでいなくても掴め、掴んだ段はそのまま
選択される（`onGrab` → `selectSystemForLayout`）。**音符・休符タブでは1本も出ない**ので、
「他のタブでは譜面を書いている間の見た目を変えない」という #571 の約束（REGRESSION Z）も守られる。

### 境界ごとの移動量（掴んだ境界が指に付く）

パート間隔は「隣接する境界すべてへ足す補正」なので、**上から k 番目の境界は、値を1px 増やすと
k 個ぶんの間隔が積み上がって k px（論理）下がる**。値の増分をそのまま指の移動量に対応させると、
下のパートの境界ほど指より速く動いてしまう。そこで共通部品へ
`layoutPxPerValue = (i + 1) × effectiveRenderScale`（1目盛りあたり境界が動くレイアウトpx）を渡し、
`値の増分 = 画面の移動量 ÷ ズーム倍率 ÷ layoutPxPerValue` で換算している。

### 共通部品化（同じロジックの2枚目を作らない）

#523 の `SystemGapDragHandle.tsx` を **`LayoutGapDragBand.tsx` へ改名して一般化**し、
段の上端の帯とパート境界の帯の両方がこの1つを使う。ドラッグの作法（3px の遊び・
「掴んだ時の値＋総移動量」・ズーム補正・pointer 規約 #536・pointercancel とアンマウントの
巻き戻し・値の吹き出し）は1か所にあるので、片方だけ直して他方へ届かない事故（#280）が起きない。

一般化のために増やした props はこの3つだけ:

| props | 意味 |
| --- | --- |
| `layoutPxPerValue` | 値1目盛りあたり、掴んだ境界が動くレイアウトpx（段の間隔は 1、パート境界は上記の式） |
| `variantClassName` / `style` | 置き場所（段の上端は CSS の `bottom: 100%`、パート境界はインラインの `top`） |
| `testId` / `valueTestId` / `label` | 帯の識別と読み上げ名（呼び出し側が決める） |

CSS も基底クラス `.system-gap-drag-handle` を共用し、パート境界だけ
`.system-gap-drag-handle--part { bottom: auto; margin-top: -7px; }` で位置を差し替える
（`-7px` は帯の中の線の中心を境界へ合わせる補正）。`@media print` の非表示は基底クラスに
効いているので、**印刷に出さない**（#523 の受入・REGRESSION Y 節の規則）はそのまま満たす。

### Undo は共通の1操作＝1件へ相乗りする（#523・#571 と同じ部品）

Issue #572 の仕様2は「#539（=#523）に完全準拠」で、Undo も対象に含む。初版ではこれを
「パート間隔は表示設定なので履歴の外」と読み替えて `onDragStart` / `onDragEnd` に
何もしない関数を渡していたが、レビュー（round1 P1-1）で**受入条件は変わっていない**と
差し戻されたため、**音符の大きさ（#571）とまったく同じ形**へそろえた。

- `partSpacingOffsetPx` を Undo/Redo のスナップショット（`ScoreSnapshot`）へ入れ、
  `applySnapshot` で `applyPartSpacingOffsetPx` 経由で戻す（`localStorage` も一緒に書き戻すので、
  次回の起動時に戻す前の値が復活しない）。古い履歴（この値が入る前のスナップショット）は
  `undefined` になり得るので、そのときは今の値を保つ（勝手に既定へ戻さない）
- 帯の `onDragStart` / `onDragEnd` には、段の間隔の帯・角の◢と**同じ** `beginLayoutValueDrag` /
  `endLayoutValueDrag` を渡す。「値が実際に変わる最初の1回だけ積む」「掴む前の値に戻して
  離したら積んだ履歴を取り消す」はこの部品側にあるので、ドラッグ全体で1件・無変化なら0件が
  そのまま満たされる（新しい履歴の仕組みを増やしていない）
- スナップショットに入れた以上、**レイアウトタブのスライダー側でも履歴を積む必要がある**
  （積まないと、スライダーで変えた値が無関係な Undo で古い値へ戻る）。音符の大きさの
  スライダーと同じく、`onPointerDown` / 非 repeat の `onKeyDown` で「まだ積んでいない」へ戻し、
  値が実際に変わる最初の1回だけ `pushHistory()` する＝**つまみ操作1回＝履歴1件**
- 退避先（`layoutDragHistoryRef`）とロック（`layoutDragLockRef`）も共有するので、
  段の間隔の帯・◢・パート境界の帯のうち**同時に掴めるのは1つだけ**（#571 round2 P2-1）

### 値の書き換え口を1つにした

`applyPartSpacingOffsetPx(value)`（クランプ + `setPartSpacingOffsetPx` + `localStorage` 保存）を
新設し、**レイアウトタブのスライダーとドラッグの両方がここを通る**。以前はスライダーの
`onChange` の中にクランプと保存が直書きされていた。

### 範囲外（今回やっていないこと）

- **段ごとのパート間隔の個別化**（#449）。今回動くのは全体設定なので、どの段で掴んでも譜面全体の
  パート間隔が変わる
- **五線の中の当たり判定との調整**は今回も踏み込んでいない。帯は整えるモードの間だけ五線の間へ
  重なるので、その間は帯の下の音符をクリックできない。ただしこのモードでは五線の面そのものが
  段の選択に割り当てられており（#571）、そもそも音符入力は音符・休符タブで行うため実害が無い

### 影響範囲

- 改名・一般化: `src/components/SystemGapDragHandle.tsx` → `src/components/LayoutGapDragBand.tsx`
- `src/components/ScorePage.tsx`: `applyPartSpacingOffsetPx` の新設（スライダーもここへ寄せた）、
  `partGapBands`（境界の位置と1目盛りあたりの移動量）の算出、`renderSystemPanel` での帯の描画、
  `ScoreSnapshot` への `partSpacingOffsetPx` の追加（+ `applySnapshot` での復元・スライダーの履歴）
- `src/App.css`: `.system-gap-drag-handle--part`（置き場所の差し替え）
- 追加テスト: `src/components/ScorePagePartGapDrag.test.tsx`（14件。Undo の3件と編成譜の1件は round1 の
  差し戻し P1-1・P2-1・P2-2 に対応）、`AppCssSystemSelectPrint.test.ts` に1件
- 保存データ・印刷・段割りの経路は変更なし（動かすのは既存の全体設定の値だけ）

## 追補: レイアウトタブのスライダーを数値入力へ置き換える（2026-09-06・Issue #578）

### 問題

発案者ユーザー（作曲専攻）のテスト会フィードバック:「レイアウト調整のスライダーはわかりづらい。
ドラッグで調整と数値で調整があればいい」。スライダーは3つの点で中途半端になっていた。

1. いくつに設定したのか読み取りにくい（現在値は横の小さな文字でしか分からない）
2. 狙った値に止めにくい（つまみの1pxが値の何段階かは値域によって違う）
3. #571 / #572 で入れた譜面上のドラッグ調整（◢のつまみ・段の境界の帯）と役割が被る

「直感的に合わせる」はドラッグが担うようになったので、レイアウトタブ側は
**正確に指定する場所**へ寄せる。

### 修正設計

レイアウトタブのスライダー9個（余白 左右/上/下・音符の大きさ・小節幅の均等さ・段の間隔・
パート間隔・タイトル余白 上/下）を数値入力（`<input type="number">`＝ロールは `spinbutton`）へ
置き換えた。値域・ステップ・保存先・Undo の積み方は変えていない。

**入力の作法は `src/components/LayoutNumberInput.tsx` の1か所にまとめた。**
9か所へ同じ作法を書き写すと、片方だけ直したときに食い違う（#223 → #280 と同じ壊れ方）。

| 作法 | 中身 | なぜ |
| --- | --- | --- |
| 下書き＋確定で反映 | 打っている途中の文字は state（下書き）に持つだけで譜面には当てない。反映するのは Enter・フォーカスを外したときの確定と、スピナー（▲▼）・矢印キーによる1ステップだけ | 途中の文字を反映すると「-60」の途中の「-6」や「25」の途中の「2」がいったん譜面に当たり、そのつど全ページの再配置と localStorage への保存が走る（round1 P2）。スピナーと矢印キーは「打っている途中」が無い操作なので即反映のまま |
| 確定時に丸めて通知 | Enter・フォーカスを外したときに、範囲外・小数は最寄りの整数へ丸めて通知する。数値として読めなければ元の値へ戻して通知する | 黙って戻すと「打ったのに効かない」行き止まりになる（#318） |
| 外側からの同期 | `value` prop が変わったら、**入力中でなければ**下書きも追従させる | ドラッグ調整・リセット・作品の読み込みで変わった値が欄に出る（仕様3の双方向同期）。入力中に追従させると打っている途中の文字が書き換わる |

単位（mm / px / %）は欄の右の `<span>` に出す。欄の中に単位まで打たせると数値として
読めなくなるため、入力欄と単位表示は分ける。

### 通知の文言は段レイアウトパネルと共用した

同じ「レイアウトの直接入力を丸めた」通知が `SystemLayoutPanel`（#482）に既にあったので、
`describeSystemLayoutValueInvalid` / `describeSystemLayoutValueClamped` の項目名を
`'小節数' | '間隔'` の union から自由文字列へ広げ、単位の引数（既定は空文字）を足して共用した。
段レイアウトパネル側の文言は1文字も変わっていない。

### Undo の区切りは「つまみを掴んだとき」から「欄にフォーカスが入ったとき」へ

「音符の大きさ」だけは Undo/Redo のスナップショットに入っている（#571）ため、
値を変える前に履歴を積む必要がある。スライダーのときは `onPointerDown`（＝1回のドラッグ）が
区切りだったが、数値入力ではフォーカスが入った時点を区切りにした
（`onEditSessionStart`）。**1回の編集＝欄に入ってから外れるまで＝Undo 1件**になる。

### 影響範囲

- `src/components/LayoutNumberInput.tsx`（新規）: 数値入力欄の共通部品
- `src/components/ScorePage.tsx`: レイアウトタブのスライダー9個を `LayoutNumberInput` へ置換
  （現在値を横に出していた `<span>` は、単位表示が部品側に入ったため削除）
- `src/utils/scoreEditorNotices.ts`: 上記2つの文言ビルダーの項目名を自由文字列へ、単位引数を追加
- テスト:
  - `ScorePageLayoutNumberInputs.test.tsx`（新規）: 受入条件の配線テスト
    （スライダーが残っていない／9項目の値域・ステップ・単位／直接入力＋Enter／範囲外のクランプ通知／
    読めない入力／外側からの同期）
  - ロール期待の更新: `ScorePageLayoutControlNames`（11個すべて spinbutton）・
    `ScorePageLayoutTabGroups`・`ScorePagePartSpacing`・`ScorePageDefaultLayout`
  - `ScorePageLayoutAdjustMode.test.tsx`: 音符の大きさの Undo 区切りを pointerdown から focus/blur へ
  - `PrintPreview.test.tsx`: プレビュー中に無効化されていないことの確認を spinbutton も見るよう更新
- 変えていないもの: 値域・ステップ・保存先（localStorage キー）・リセット系4種・初期値プリセット（#143）・
  「画面表示のズーム」（レイアウトタブの外の常設行にあるためスライダーのまま）

### round1 レビューでの修正: 打っている途中の値を譜面に当てない（P2）

最初の実装は「数値として読めて範囲内の整数なら打っている途中でも即反映」にしていたが、
**下限が 0 以下の欄では途中の値がそのまま範囲内になる**ため実害が出ていた。

| 打った値 | 途中で譜面に当たっていた値 |
| --- | --- |
| 段の間隔に `-60` | `-6`（`-` は読めないので飛ばされ、`-6` で1回反映） |
| タイトル余白(上)に `25` | `2` |

反映のたびに全ページの再配置と localStorage への保存が走るので、値そのものが最終的に
正しくなっても、途中の1回ぶんの再配置は無駄であり、画面もちらつく。

**直し方**: キーボード入力は下書きに溜めるだけにし、反映は Enter・フォーカス外しの確定に寄せた。
ただし**スピナー（▲▼）と矢印キーだけは即反映のまま**にしている。この2つは「打っている途中」が
無く、1回押す＝1つの値を選んだという操作だからである。

見分け方は2つ:

- **スピナー**: 欄の上でポインタが押されたまま届く `change` はスピナー操作とみなす
  （キーボード入力ではボタンを押しっぱなしにはならない）。押した状態は `onPointerDown` で立て、
  `window` の `pointerup`（欄の外で離されても拾えるように）と `blur` で下ろす
- **矢印キー**: `ArrowUp` / `ArrowDown` を `preventDefault()` して**自分で1ステップ刻む**。
  ブラウザ既定のステップに任せると、届く `change` が「打っている途中の文字」と見分けられない

#### この修正での影響範囲

- `src/components/LayoutNumberInput.tsx`: 上記の反映タイミングの変更（`onChange` は下書き更新のみ、
  `onKeyDown` で矢印キーのステップ、`onPointerDown` / `onBlur` でスピナー判定）
- `src/components/LayoutNumberInput.test.tsx`（新規）: 部品単体のテスト9件。
  中間値が `onCommit` を呼ばないこと（`-60` を1文字ずつ／`25` を1文字ずつ）、Enter・blur での確定、
  範囲外・小数の丸めと通知、`-` だけ・空文字の差し戻し、矢印キーの即反映と値域どまり、
  スピナー押下中の即反映、外側からの同期
- `ScorePageLayoutNumberInputs.test.tsx`: 「`-6` の時点では `score-system-row-gap` が保存されておらず、
  blur で初めて `-60` が保存される」「矢印キーは即保存される」を追加
- 打つだけで反映されることを前提にしていた既存テスト（`ScorePagePartSpacing`・`ScorePageDefaultLayout`・
  `ScorePageLayoutTabGroups`・`ScorePageLayoutControlNames`・`ScorePageMusicXmlDefaults`）は、
  `fireEvent.change` のあとに `fireEvent.blur` を足して「欄から離れた」ところまで再現するよう更新

#### あわせて直した P3

- 単位の `<span>` に id を振り、入力欄から `aria-describedby` で結んだ（読み上げで「段の間隔、px」と
  単位まで伝わる）
- `step=5` の欄でステップの倍数でない値（103 など）に Firefox が赤枠を出す件は**見送った**。
  ステップへ丸めると「打った 103 が 105 になる」ため通知の要否・丸め方向の仕様判断が要る。
  値そのものは 1 刻みで有効なので、`step="any"` にするか丸めるかは別途決めたい
