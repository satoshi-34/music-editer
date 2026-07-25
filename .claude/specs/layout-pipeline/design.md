# レイアウトパイプラインの共通化（LayoutTree）

> Issue #69 の対応。**このドキュメントは設計のみで、実装コードの変更は含まない。**
> 実装は本ドキュメント末尾「7. 段階的な移行計画」の各Issueに分割して行う。

## 1. 目的・背景

休符位置（#51/#56）・パート間隔（#29）・段の間隔スライダーの不連続（#37）・段数/ページ上限の見積もり誤り（#44/#38）・縦配分の不揃い（#68）・段割りのガタつき（#58/#67）と、レイアウトに起因する不具合がこれまで繰り返し発生してきた。

これらに共通する原因は、「どこに何を置くか」を決める計算が一箇所に集約されておらず、**描画コンポーネント（`PianoSystemCanvas.tsx`、4,950行）・CSS（`App.css` のflexbox）・utils（`measureLayoutUtils.ts`、834行）の3箇所に分散している**こと。特にCSSとJSの二重定義は繰り返し不具合の温床になっている（例: `page-layout-controls/design.md` の「正本の一本化」「段の間隔をマイナス方向にも〜」の2つの追補は、どちらもCSSとJSの計算式がズレたことへの対処だった）。

このIssueでは、これらの決定を単一のパイプライン（データ→純関数の連鎖→座標木→描画）へ再編する設計を書く。**実装はしない。**

## 2. 現状のアーキテクチャ（As-Is）

| 決定内容 | 現在の実装場所 |
|---|---|
| 小節の最低幅 | `measureLayoutUtils.ts`: `measureMinimumContentWidth` / `vexFlowCombinedMeasureMinimumContentWidth` |
| 段割り（1段に何小節入るか） | `measureLayoutUtils.ts`: `planEffectiveMeasuresPerSystem` / `planSystemMeasureRanges`（`systemMeasureOverrides` を考慮） |
| 小節幅の配分（段内） | `measureLayoutUtils.ts`: `allocateCombinedMeasureWidths`（`MEASURE_WIDTH_EVENNESS` ブレンド・圧縮） |
| ページ割り（何段目が何ページ目か） | `pageSystemLayoutUtils.ts`: `getPageSystemsCapacity` / `getPageSystemOffset` / `findPageIndexForSystem` |
| 段数/ページの上限 | `measureLayoutUtils.ts`: `measuredSystemHeightPx`（実測）+ `ScorePage.tsx` の `maxSystemsPerPage` 計算 |
| 段の縦配分（Y座標・段間隔） | **CSS**: `App.css` の `.score-area .system-stack` flexbox（equal-fill + `margin-top: var(--system-row-gap)`）。JS側には検証専用の並行実装 `systemRowSlotHeightPx` / `systemRowTopOffsetsPx`（`measureLayoutUtils.ts`）がある（CSSの数式をJSで再実装したもの。jsdomがflexboxを計算しないための代替） |
| パート（段内の譜表）の縦間隔 | `PianoSystemCanvas.tsx`: `computeLayout` / `staveSpacingForPartCount`（`measureLayoutUtils.ts` に移設済み、re-export） |
| ページ余白 | `measureLayoutUtils.ts`: `printScoreAreaWidthPx` / `worstCaseSystemContentBudget` ＋ **CSS**: `--page-margin-*` 変数 |
| 休符の既定位置 | `src/components/clefUtils.ts`: `defaultRestKeyForClef` / `restKeyForVoice` |
| 段ごとの小節数・間隔の個別上書き | `ScorePage.tsx` の state（`systemMeasureOverrides` / `systemRowGapOverrides`）→ 上記の計画関数へ引数として注入 |
| 実際のX/Y座標確定・クリック当たり判定・SVG描画 | `PianoSystemCanvas.tsx`（VexFlow呼び出し・click/mousemoveハンドラ・当たり判定がすべて同居） |

**問題点のまとめ**:

1. **段の縦配分だけCSSが正本になっている**。他の決定（幅・段割り・上限）はJSの純関数が正本で、テスト可能。縦配分だけはCSSのflexbox計算が実際の見た目を決め、JS側はそれを"真似た"検証専用コードを別途持つ二重管理になっている（#37・#68はどちらもこの二重管理の食い違いが遠因）。
2. **`PianoSystemCanvas.tsx` が「座標計算」「VexFlow描画」「クリック当たり判定」を1コンポーネント（4,950行）に同居させている**ため、レイアウトの決定とレンダリングの実行が分離されておらず、片方を直すときにもう片方への影響を都度確認する必要がある。
3. **上書き（override）の置き場・合成方法がその都度個別に設計されている**。`systemMeasureOverrides` はJS純関数の引数、`systemRowGapOverrides` はCSSの `margin-top` への直接加算、休符位置のカスタマイズ判定は「歴代の既定値集合に含まれるか」という別のヒューリスティック（#56）。パターンは似ているが型として共通化されていない。

## 3. レイアウトパイプラインの構成（To-Be）

以下の段階で構成する。**各段階は純関数**（入力から出力を計算するだけで、DOM・CSSに触れない）にする。

```
① 譜面データ + 設定 + ユーザー上書き
        ↓
② 小節最低幅の計算            measureMinimumContentWidth 系（既存、そのまま）
        ↓
③ 段割り（システムプランニング）  planSystemMeasureRanges 系（既存、そのまま。overridesカスケード適用）
        ↓
④ ページ割り・縦配分            ★新規: 段の縦配分をCSS→JSへ移す（本設計の主眼）
        ↓
⑤ LayoutTree の構築            ★新規: Page → System → Stave(Part) → Measure → Element の座標木
        ↓
⑥ 描画                        LayoutTreeをSVG/DOMへ写すだけ（決定をしない）
```

②③は既に `measureLayoutUtils.ts` に純関数として存在しており、現状の設計を踏襲する（振る舞いは変えない）。①④⑤⑥が今回の再編対象。

### ④ ページ割り・縦配分（CSSからJSへ）

現在CSSのflexboxが担っている「段のYオフセット・高さ」の計算を、`systemRowSlotHeightPx` / `systemRowTopOffsetsPx` が既に持っている数式（段スロット高 = ページ譜面領域 ÷ 段数、間隔は符号そのまま `margin-top` 相当で加減）を正本として、JS側の関数一本にする。CSS側はこの結果を `top` / `height` として受け取って配置するだけにする（`position: absolute` あるいは、当面は据え置きで「JSが計算したpx値をインラインstyleとして各段へ注入し、flexboxを使わない」方式に寄せる。具体的な移行手順は7章のIssue Dを参照）。

これにより、「JSで計算した値と実際にブラウザが描画する値が一致する」ことが構造的に保証される（現状のように、CSSの計算式を変更してJS側の並行実装を更新し忘れる、という食い違いが構造的に起きなくなる）。

### ⑤ LayoutTree

```ts
type LayoutTree = {
  pages: PageLayout[];
};
type PageLayout = {
  pageIndex: number;
  marginTopMm: number; marginBottomMm: number; marginSideMm: number;
  systems: SystemLayout[];
};
type SystemLayout = {
  systemIndex: number;        // 全体通し番号
  startMeasure: number;       // 絶対小節インデックス（overrideのキーと同じ単位）
  measureCount: number;
  y: number; height: number;  // ページ内のY座標・高さ（④の結果）
  staves: StaveLayout[];      // パート（大譜表なら2、四重奏なら4、編成譜ならN）
};
type StaveLayout = {
  partIndex: number;
  y: number;                  // システム内のY座標（staveSpacingForPartCount 由来）
  measures: MeasureLayout[];
};
type MeasureLayout = {
  measureIndex: number;       // 絶対小節インデックス
  x: number; width: number;   // allocateCombinedMeasureWidths 由来
};
```

`LayoutTree` は「その譜面データ・その設定・そのユーザー上書き」から一意に決まる純粋な計算結果であり、DOM要素やVexFlowオブジェクトを一切含まない。描画コンポーネントはこの木を辿ってVexFlowへ座標を渡すだけになる（クリック当たり判定の座標変換ロジックはこのIssueのスコープ外、7章Issue Fの範囲）。

## 4. 上書きカスケードの統一

既存の上書きはすべて同じ形の意思決定をしている: **「実際に使う値 = ユーザー上書き ?? 自動値」**。これを型として明示する。

```ts
type Resolved<T> = { auto: T; override?: T; resolved: T };
function resolve<T>(auto: T, override: T | undefined): Resolved<T> {
  return { auto, override, resolved: override ?? auto };
}
```

既存の上書きをこのスロットへ当てはめると:

| 対象 | 自動値（auto） | 上書き（override） | 現在のキー設計 |
|---|---|---|---|
| 段の小節数 | `planSystemMeasureRanges` の貪欲法 | `systemMeasureOverrides[].count` | 絶対小節番号 `startMeasure`（段番号ではない） |
| 段の間隔 | `systemRowGapPx`（全体設定） | `systemRowGapOverrides[].gapPx`（段ごとの追加分） | 絶対小節番号 `startMeasure` |
| 休符の位置 | `defaultRestKeyForClef`（音価・クレフごとの標準位置） | 手動で動かした休符のキー（ただし「歴代の既定値集合に含まれない」ことで間接的に判定） | 判定方式が上記2つと異なる（下記参照） |
| ページ余白・音符の大きさ・段の間隔（全体） | コード上の既定値 `resolveDefaultLayoutForScoreType` | localStorage 保存値 | localStorageキー（設定全体で1つ、要素単位ではない） |

**統一の方針**: 「段の小節数」「段の間隔」が確立した設計パターン（**絶対小節番号 `startMeasure` を安定キーにする**。理由は `system-measure-override/design.md` に説明があるとおり、小節の挿入・削除で段番号がずれても意味を保てるため）を、LayoutTreeの上書き全般の標準キー方式として明文化する。

休符の位置（#56）は「上書きされているかどうかを、値そのものが既知の自動値集合に含まれるかで判定する」という異質な方式になっている。これは休符には「どの段・どの小節か」という安定キーではなく「音符（休符）オブジェクト自体」に位置が保存されているため、他の2つと同じキー方式を素直に適用できない特殊ケースである。LayoutTree移行では休符位置を第5章の不変条件（標準位置ルール）の対象にしつつ、上書き判定の方式は現状の「既知集合に含まれるか」を維持する（無理に統一しない）。これは移行の中でも優先度が低い領域として7章 Issue E に切り出す。

## 5. 不変条件テストの網

`LayoutTree` に対して機械的に検査できるルールの一覧。各ルールに、それが再発防止する過去のIssueを対応付ける。

| # | 不変条件 | 検査内容 | 再発防止する過去Issue |
|---|---|---|---|
| I1 | 全要素がページ内に収まる | 全 `MeasureLayout`/`StaveLayout` の `y + height <= page.height`、`x + width <= page.contentWidth` | #44（段数/ページ上限の見積もり誤りによるページはみ出し） |
| I2 | 同一ページ内の段間隔が均一（上書きがない限り） | 上書きのない隣接 `SystemLayout` 間の `y` 差がすべて等しい | #68（最終ページが実段1つ＋空の段のとき他ページと違う縮小レイアウトになった） |
| I3 | パート間隔が均一 | 同一 `SystemLayout` 内の隣接 `StaveLayout` の `y` 差がすべて等しい | #29（編成譜のパート間隔が不均一） |
| I4 | 段の間隔調整が連続・単調 | `systemRowGapPx` を−30〜30まで変化させたとき `SystemLayout.y` が単調・連続に変化し、0前後で式が切り替わらない | #37（段の間隔スライダーが0をまたぐと別方式に切り替わり跳んでいた） |
| I5 | 休符の既定位置が音価ごとの標準位置（単声部） | 単声部小節の各休符の描画キーが、音価で分岐する `defaultRestDisplayKeyForDuration`（全休符=第4線/2分以下=五線中央、#54）の標準位置と一致 | #51（休符が標準位置からずれていた）／#56（旧世代の既定値で保存された休符が救済されない）／#79（生成経路間の高さ不一致） |
| I6 | 編集位置より前の段境界が入力前後で不変 | `lastEditedMeasureIndex` より前で完結する `SystemLayout` の `startMeasure`/`measureCount` が編集前後で同一 | #67（段割りの安定化が強すぎて詰まっていく挙動が止まった／その反動で安定化を外すと境界が動いた） |
| I7 | 印刷とプレビューの座標が一致 | 同じ `LayoutTree` から生成した印刷用DOMとプレビュー用DOMで、対応する要素の `x`/`y`/`width`/`height` が一致 | print-preview設計書の「既知の未対応事項」（CSS重複定義のため、`@media print` 側だけ修正すると `.print-preview` 側とずれる） |
| I8 | 段数/ページ上限が実際の描画寸法と一致 | `maxSystemsPerPage` の計算に使う1段の高さが、実際に描画コンポーネントが使う寸法計算（`computeLayout(partCount).sysH` 相当）と同一関数由来である | #44/#38（固定係数の見積もりが実測と乖離していた） |
| I9 | 段数/ページが「余白・五線サイズ・行間から導かれた結果」と一致する | `SystemLayout` の配置が8章のトップダウン計算（上から置けるだけ置く）の結果と一致し、段数が入力値としてレイアウトを歪めていない | #71/#81（初期表示の崩れ・大編成のはみ出し）。**フェーズH完了まで pending** |

I1〜I8はいずれも `LayoutTree` という共通の中間表現に対して書けるため、既存のように「CSSの挙動をブラウザ実測で確認する」「flexboxの計算式をJSへ手作業で移植して検証する」という手間のかかる検証方法から、**LayoutTreeを組み立てる純関数に対する通常のユニットテスト**へ置き換えられる。

## 6. 既存仕様との整合

- **`docs/REGRESSION.md`**: 手動QAチェックリストであり、LayoutTreeの不変条件（I1〜I8）と直接競合しない。むしろI1〜I8が自動テスト化されることで、REGRESSION.mdの「B. 小節幅の自動割付」節（現状は手動確認のみ）の一部を自動化できる可能性がある（本Issueのスコープ外、将来検討）。
- **`.claude/specs/page-layout-controls/design.md`**: 段の間隔・ページ余白の現行設計（2026-07-23の「単一の連続方式」追補が最新）。本設計の④「縦配分をJSへ移す」は、この追補が確立した数式（`systemRowSlotHeightPx` / `systemRowTopOffsetsPx`）をそのままLayoutTreeの正本として採用する。**矛盾はない。CSSでの実現方法を「JSが計算しCSSは受け取るだけ」に変えるだけで、数式自体・見た目は変えない。**
- **`.claude/specs/system-measure-override/design.md`**: 「絶対小節番号をキーにする」設計判断を、本設計の4章でLayoutTree全体の上書きキー標準として一般化した。矛盾はなく、既存パターンの正式な格上げ。
- **`.claude/specs/empty-stave-filler/design.md`**: 空の段は「保存データに触れない表示専用の演出」という設計。LayoutTreeでも同様に、空の段は「実段と同じ `SystemLayout` 構造だが `isPlaceholder: true` を持つノード」として表現できる（実装はスコープ外）。既存設計と矛盾しない。
- **`.claude/specs/print-preview/design.md`**: 「既知の未対応事項」として明記されている**CSS重複定義（`@media print` と `.print-preview` の二重管理）** は、本設計が解決しようとしている問題（レイアウト決定の分散）の典型例そのものである。7章のIssue Gで、両者を「同じLayoutTreeから生成する」形に統合することを移行計画に含める。ここは新設計を正とし、既存のCSS重複方式は段階的に置き換える対象と位置付ける。
- **Issue #67/#68（進行中のPR #75/#76）の修正内容の織り込み**:
  - #67（PR #75）: `planSystemMeasureRanges` に `previousRanges`/`lastEditedMeasureIndex` を追加し、「編集位置を含む段から後ろだけ貪欲法で再計画」する設計。これは本設計③（段割り）の一部として現状追認する。LayoutTreeの不変条件I6はこの設計が正しく機能していることを検査するルールとして定義した。
  - #68（PR #76）: `screenFinalPageVisibleSystems`（実段のみ数える）と実際の子要素数（空の段を含む）の不一致が原因だった。LayoutTreeでは「ページの子要素」を最初から `SystemLayout`（プレースホルダー含む）の配列として一元管理するため、「実段だけを数える集計」と「実際に描画される要素数」が別々に計算されてズレる、という同種の不具合はLayoutTree移行後は構造的に起きにくくなる（I2がこれを検査する）。

## 7. 段階的な移行計画

**原則**: 各Issueは単独でマージ可能・全テスト（`npx vitest --run src` / lint / build）緑を維持する。既存の振る舞いは変えない（フェーズ2の一部を除く。変える場合は明示）。「1晩1Issue」の粒度に分割する。

### フェーズ1: 抽出（振る舞い変更なし）

- **Issue A**: `measureLayoutUtils.ts`（834行）を `src/utils/layout/` ディレクトリへ分割移設する。`measureWidth.ts`（②）・`systemPlanning.ts`（③）・`pageAllocation.ts`（④の現行CSS計算の並行実装 `systemRowSlotHeightPx` 等）・`partSpacing.ts`（`computeLayout`/`staveSpacingForPartCount`）に分ける。既存の import 元（`ScorePage.tsx`・`PianoSystemCanvas.tsx` 等）は re-export 経由で壊さない。テストファイルも対応して分割。**振る舞い変更なし、純粋な移動。**

### フェーズ2: LayoutTreeの土台（既存コードと並行、未使用）

- **Issue B**: `src/utils/layout/layoutTree.ts` に、3章の型定義（`LayoutTree`/`PageLayout`/`SystemLayout`/`StaveLayout`/`MeasureLayout`）と `buildLayoutTree()` 純関数を追加する。**既存の描画経路からは呼び出さない**（既存コードと機能的に独立させ、リスクをゼロにする）。②③の既存関数をそのまま呼び出して埋める。④（縦配分）はフェーズ1で分離した並行実装を使う。
- **Issue C**: `buildLayoutTree()` に対する不変条件テスト（I1〜I3、I8。当面 `LayoutTree` 単体で検査できるもの）を追加する。既存の `systemRowSlotHeightPx` テストなどと統合・整理する。

### フェーズ3: 縦配分の正本をJSへ切替（唯一の振る舞い変更を伴うフェーズ、要ブラウザ確認）

- **Issue D**: `ScorePage.tsx` の段の縦配分を、CSSのflexbox（equal-fill + margin-top）から `buildLayoutTree()` の計算結果（各 `SystemLayout.y`/`height`）をインラインstyleとして各段へ注入する方式へ切り替える。CSS側は `position` と受け取った値を適用するだけにする。**見た目は変えない**（数式は既存のまま移すだけ）が、実際にCSSプロパティの適用方法を変えるため、ブラウザでの実測確認を必須とする（単旋律・ピアノ・四重奏・編成譜、最終ページの1段のみ状態、段の間隔プラス/マイナス、それぞれで既存のスクリーンショットと比較）。I2・I4のテストをここで既存コードに対して初めて実行し、通ることを確認する。

### フェーズ4: 上書きカスケードの明文化・休符位置の統合

- **Issue E**: 4章の `Resolved<T>` 型を導入し、`systemMeasureOverrides` / `systemRowGapOverrides` の解決ロジックをこの型で表現し直す（挙動は変えない、型の明示化のみ）。休符位置（#51/#56の「既知集合」判定）はI5のテストとして現状の実装に対して追加するに留め、型の統一は行わない（4章で述べた理由により見送り）。

### フェーズ5: 描画コンポーネントのLayoutTree参照化

- **Issue F**: `PianoSystemCanvas.tsx` のVexFlow描画部分が、内部で座標を計算する代わりに `LayoutTree` の該当ノードから `x`/`y`/`width` を受け取るようにする。**クリック当たり判定（`clientToGroup`・`keySelectXPad`等）の座標変換は変更しない**（このIssueのスコープ外。当たり判定はVexFlowのSVG実座標を直接見ているため、LayoutTreeの論理座標とは別レイヤーとして残してよい）。最もリスクが高いフェーズのため、既存の回帰テスト（`PianoSystemCanvasEmptyBeatClick.test.tsx` 等）が全緑であることに加えて、ブラウザでの全譜面種別の実地確認を必須とする。

### フェーズ6: 印刷・プレビューの一本化

- **Issue G**: `App.css` の `@media print` と `.print-preview` の重複ブロックを、LayoutTreeが提供する座標を両者が同じ形で参照する構成へ統合する（CSSカスタムプロパティの生成元を1箇所にする、または重複ブロックのうち差分がない大部分を共通クラスへ括り出す）。print-preview設計書が明記する「既知の未対応事項」の解消がゴール。印刷結果は運用実績のあるものを壊さないよう、既存の印刷確認（PDF書出のビジュアル比較）を必須とする。

### フェーズ7: モデル転換（第一原理の実現。8章参照）

- **Issue H**: フェーズ3（Issue D）完了後、④の計算式を現行の「スロット等分（段数/ページを入力とする）」から、8章のトップダウン方式（上から置けるだけ置く・段数は結果）へ差し替える。fit自動縮尺（Issue #81 が先行実装する場合はそれを取り込み統合）もここで全譜種共通ルールに一本化する。不変条件I9をこのフェーズで pending から有効化する。`buildLayoutTree()` のインターフェースはフェーズ2（Issue B）の時点から「段数を入力に取らず、結果として返せる」形にしておくこと（Hで数式だけ差し替えられるようにするため）。

### 各Issueの依存関係

```
A（抽出） → B（LayoutTree土台） → C（不変条件テスト）
                                  → D（縦配分をJSへ）→ F（描画のLayoutTree参照化）
                                  → E（上書きカスケード）
D → G（印刷/プレビュー一本化）
D → H（モデル転換・第一原理）
```

A・B・C・Eはリスクが低く（既存コードと機能的に独立、または型の明示化のみ）、任意の順で先行できる。D・F・G・Hは実際の描画・見た目に触れるため、この順で慎重に進める。

## 8. 最終目標モデル（第一原理。運用者と合意済み — Issue #69 コメント欄参照）

本設計のフェーズA〜Gは「現状の数式のまま計算をJSへ一本化する」段階であり、**最終形ではない**。一本化の完了後（フェーズH）、縦方向レイアウトを以下の第一原理へ転換する。フェーズA〜Gの実装は、この最終形を妨げない形（特に `buildLayoutTree()` が段数を入力に取らない設計）で行うこと。

1. 紙は A4（210mm×297mm）
2. 余白（上下左右の設定値）を引いて譜面領域を確定する
3. 五線の大きさ（希望値）と行間（設定値）から「1段の高さ」が決まる
4. 上から順に、入るだけ段を置く。入り切らなければ次ページへ
5. **段数/ページは入力ではなく結果**。ユーザーが明示上書きした場合のみ制約として扱う（上書きカスケードの一項目）
6. **五線サイズは希望値＋fit自動縮尺**: `実際のサイズ = min(希望値, 譜面領域の高さ ÷ 1段の自然高 × 希望値)`。最小サイズの下限を設け、下限でも入らない場合は警告を表示する（黙って読めないサイズにしない）。大編成の「74%固定」ハックはこの共通ルールへ置換・廃止する（先行実装 Issue #81 と統合）
7. ページ種別（タイトル有無・最終ページ）によるCSSクラス分岐は行わず、同じ配置計算に「使える高さ」の差としてだけ現れるようにする
8. 端ケース: 設定値は「譜面領域が正の高さを保つ」範囲へ入力側でクランプする。大譜表パート（staffCount:2）は2段1ユニットとして自然高を数える
9. 将来候補（スコープ外）: 空パートの段省略 — そのページで発音の無いパートを自然高計算から除外して紙面を稼ぐ（プロのフルスコアの慣習）

これにより「余白を広げると段が減る」「行間を詰めると段が増える」という直感どおりの因果が実現し、#71（初期表示の崩れ）・#81（大編成のはみ出し）が構造的に解消される。

## 9. 未解決点・引き継ぎ事項

- 本ドキュメントはコードを一切変更していないため、上記の型定義・数式が実装時に細部で調整される可能性がある（特にフェーズ3のインラインstyle注入方式は、`ResizeObserver` や `pageMarginSideMm` 依存の再描画トリガー（`page-layout-controls/design.md` 参照）との相互作用を実装時に再確認すること）。
- 5章の不変条件I7（印刷とプレビューの座標一致）は、フェーズ6（Issue G）が完了するまでは検査対象を用意できない（現状はCSS重複のため、LayoutTree以前の問題として先に統合が必要）。フェーズ2時点ではI7のテストは「pending」として書いておき、Issue G完了時に有効化する運用を推奨する。
- 本ドキュメントの受入条件にある「過去のレイアウト系Issue最低8件」は #29 #37 #44 #51 #56 #58 #67 #68 の8件を対応表（5章）でカバーした。

## 10. Issue #81 実装記録（8章6の先行実装）

8章「最終目標モデル（第一原理）」の6番目の項目（fit自動縮尺）を、フェーズA〜H本体に先立って先行実装した（`src/utils/measureLayoutUtils.ts` / `src/components/ScorePage.tsx`）。

**問題**: `computeEnsembleAutoFitMultiplier(partCount, pageBudgetPx)` が「音符の大きさ」希望倍率（`notationSizeMultiplier`）を計算に含めておらず、常に「希望倍率100%のときにちょうど収まる倍率」を返していた。呼び出し側で `notationSizeMultiplier * ensembleAutoFitMultiplier` として掛け合わせるため、希望倍率を100%から165%等へ上げても自動縮小側は追従せず、`希望倍率 × (100%のときの収まる倍率)` が紙の高さを超えてしまっていた（romantic-orchestra=17パートで100%時は約74%まで自動縮小され収まっていたが、165%にすると約122%相当になりはみ出す）。加えて、この自動縮小は `scoreType === 'ensemble'` のときだけ動く分岐になっていた。

**修正設計**:
1. `computeEnsembleAutoFitMultiplier` に第3引数 `desiredMultiplier`（既定1、後方互換）を追加し、`pageBudgetPx / (systemHeightAt100Percent * desiredMultiplier)` で計算するようにした。これにより `desiredMultiplier × 戻り値` が常に `min(希望値, budget/自然高)`（8章6の式）になる。
2. `MIN_EFFECTIVE_NOTATION_SIZE_MULTIPLIER`（0.5）と、それを下限にクランプする `resolveEffectiveNotationSizeMultiplier()`、下限でも収まらない場合を検出する `isNotationSizeStillOverflowing()` を新設。下限は「スライダーの最小値（0.8）」より意図的に低くしてある。理由: 17パートは自動縮小だけで約74%まで縮む必要があり、スライダー最小値と同じ下限にすると今まで収まっていた編成が収まらなくなってしまうため。
3. `ScorePage.tsx` 側で `scoreType === 'ensemble'` 分岐を撤廃し、全譜種で同じ fit 計算を通すようにした（`partCountForSystemLayout` を共通の入力にする）。単旋律・ピアノ・弦楽四重奏は1段の自然高がページ予算に対して十分小さいため、この関数を通しても常に倍率1.0が返り、既存の見た目は変わらない（回帰テストで確認）。
4. 「音符の大きさ」スライダー脇の注記を「(大編成のため実際はXX%で表示)」→「(紙面に収めるため実際はXX%で表示)」に変更し、下限でも収まらない場合は別途「⚠ 最小サイズでも1段が紙に収まりません」の警告を表示するようにした。

**影響範囲**: `computeEnsembleAutoFitMultiplier` の第3引数は省略可能（既定1）で、既存の呼び出し・テストは変更なしで動く。`ScorePage.tsx` では `ensembleAutoFitMultiplier * notationSizeMultiplier` という直接乗算をしていた箇所（`effectiveRenderScale` / `legacyRecommendedMaxSystemsPerPage` / `maxSystemsPerPage`）を、新設の `effectiveNotationSizeMultiplier`（下限クランプ込み）経由に統一した。

**フェーズHとの関係**: 8章6の式そのものは本Issueで実装済みだが、8章1〜5（段数/ページを結果として求めるトップダウン配置）はまだ未着手（フェーズHの範囲）。フェーズH実装時は、本Issueで追加した `computeEnsembleAutoFitMultiplier` / `resolveEffectiveNotationSizeMultiplier` の呼び出し元が `ScorePage.tsx` の `partCountForSystemLayout` ベースの見積もりから `LayoutTree` ベースの実測へ置き換わる想定（関数のシグネチャ自体は変更不要）。
