# 用紙サイズの変更機能（A4 / B4 / A3）

> Issue #495 の対応。用紙サイズを**作品の属性**として持ち、画面・印刷・PDF書き出しの
> すべてを選択サイズへ追従させる。横向き（landscape）とパート譜・総譜でサイズを変える話は範囲外。

## 1. 問題

オーケストラのスコアは A4 より大きい判型が普通で、学校現場では B4 も多い。しかし
A4（210×297mm）の寸法が以下の**5箇所に直書き**されており、用紙サイズを変えるには
5箇所を同時に直す必要があった（Issue 本文では4箇所とされていたが、実装時に
`ScorePage.tsx` の編成譜の自動縮小予算にも 297mm の直書きがあることが分かった）。

| 場所 | 直書きの内容 |
|---|---|
| `src/App.css` | `.page-wrapper` の `210mm`/`297mm`、`.print-page` の `width: 210mm; height: 297mm`、`@page { size: A4 }` |
| `src/utils/viewZoomUtils.ts` | `A4_PAGE_WIDTH_PX = 210 * 3.78` |
| `src/components/useAutoPageScale.ts` | `pageWidthPx = 210 * 3.78` |
| `src/utils/measureLayoutUtils.ts` | `printScoreAreaWidthPx` の `(210 - sideMarginMm * 2)` |
| `src/components/ScorePage.tsx` | `ENSEMBLE_AUTO_FIT_BUDGET_PX` の `297 * (96 / 25.4)` |

CSS と JS の二重定義はこのリポジトリで繰り返し不具合の温床になっている
（`layout-pipeline/design.md` 2章、`page-layout-controls/design.md` の追補を参照）。
用紙サイズを可変にするなら、まず**寸法の正本を1本化**する必要があった。

## 2. 修正設計

### 2-1. 寸法の正本を `src/utils/pageSize.ts` に集約

`PAGE_SIZES`（id / label / widthMm / heightMm / description）を唯一の定義とし、
上記5箇所はすべてここから引く。B4 は **JIS 規格の 257×364mm**（ISO B4 の 250×353mm
ではない）。日本の学校現場・吹奏楽譜で使われるのが JIS B4 のため。

**mm→px の換算係数はこのモジュールに置かない**（重要）。既存コードには
`96/25.4`（≒3.7795）と `3.78` の2種類の係数が使われており、どちらも「その場所での
従来の値」を保つ必要がある。係数を1本化すると A4 の見た目が動いてしまい、
受入条件5（既存の A4 作品の見た目が1pxも変わらない）を壊す。したがって
`pageSize.ts` は **mm の寸法だけ**を提供し、px への換算は従来どおり各呼び出し側で行う。

### 2-2. 画面: CSS カスタムプロパティ（`--paper-width` / `--paper-height`）

`ScorePage.tsx` が `.spread` へ `--paper-width` / `--paper-height` を注入し、`App.css` は
それを `width` / `height` へ渡すだけにする（ページ余白 `--page-margin-*` と同じ方式）。

- **注入先が `.spread` である理由**: 用紙寸法を読むのは `.page-wrapper`（縮小後の占有サイズ）と
  `.print-page`（紙面の実寸）の**2つ**で、両者は親子関係にある。CSS 変数は下方向にしか
  継承しないため、`.print-page` に注入すると親の `.page-wrapper` には届かない。
  共通の親である `.spread` へ注入して両方へ継承させる。
- **`--paper-*` という名前である理由**: `ScaledPageWrapper` が既に「実測したページ高さ(px)」を
  `--page-height` として使っているため、`--page-height` を用紙の高さに再利用すると衝突する。
- CSS 側のフォールバックは従来の A4 実寸（`var(--paper-width, 210mm)`）にしてあるので、
  変数が未注入の経路（印刷プレビュー以外の描画・テスト）でも従来と同じ見た目になる。

### 2-3. 印刷: `@page` は `<style>` の差し込みで上書き

**CSS の `@page` は `var()`（CSS カスタムプロパティ）を読めない**ため、画面側のように
変数1つを差し替える方式が使えない。また `@page` はセレクタでスコープできないので
`body.b4 @page { ... }` のような書き方もできない。

そこで **A4 以外を選んだときだけ**、`@media print { @page { size: <実寸>; margin: 0; } }` を
持つ `<style data-page-size="...">` を `document.head` へ差し込み、`App.css` の既定
（`@page { size: A4; margin: 0; }`）を後勝ちで上書きする。

- `margin: 0` を必ず付ける。落とすと既定の `@page` 余白が復活し、`.print-page` の padding を
  余白として使う設計（App.css のコメント参照）が崩れて紙面が左へずれる
- **A4 では何も差し込まない**。これが「既存の A4 作品の印刷結果が1pxも変わらない」ことの
  構造的な保証になる（差し込みの有無で分岐するので、A4 の経路には新しいコードが1行も増えない）
- `useEffect` のクリーンアップで必ず `style.remove()` する。差し込んだ `<style>` が積み上がると
  古い判型が後ろに残って勝ち続けるため（統合テストで枚数が常に1枚であることを固定した）

### 2-4. 保存形式: 作品の属性として `pageSize` を持つ

用紙サイズは**表示設定ではなく作品の属性**なので、`localStorage` の設定プロファイル
（ページ余白などが使っている経路）ではなく `SavedScoreData.pageSize` に載せる。
別の環境で開き直しても同じ判型で開くのが要件（Issue 本文 仕様3）。

- `CURRENT_VERSION` を `3.6.0` → **`3.7.0`** へ繰り上げ。`migrateData` は `3.6.0` も
  受理するよう追加した（省略可能な項目が1つ増えただけで破壊的変更は無い）
- `pageSize` は**省略可能**。旧データ（3.6.0 以前）は項目自体を持たないので、
  `normalizePageSizeId` が未指定・未知の値をすべて `'a4'` へ倒す
- **既定（A4）のときは項目自体を書き出さない**。`timeSignatureStyle` と同じ方針で、
  旧データとの差分を増やさないため（A4 の作品を保存し直しても JSON が変わらない）
- 検証（`validateSavedScoreData`）は「文字列でないものを弾く」までにとどめ、未知の判型は
  読み込み時に A4 へ正規化する（他の省略可能項目と同じ方針。壊れた JSON で画面を止めない）

### 2-5. レイアウト・自動縮尺の追従

| 対象 | 追従のさせ方 |
|---|---|
| 本文幅（段に小節を並べる幅） | `printScoreAreaWidthPx(sideMarginMm, pageWidthMm)` |
| 段の本文予算 | `worstCaseSystemContentBudget(sideMarginMm, labelAreaWidth, pageWidthMm)` |
| 画面幅に合わせた自動縮尺 | `useAutoPageScale(..., pageWidthMm)` |
| 初期ズーム（幅フィット） | `computeFitZoom(avail, pageWidthPxForSize(pageSize))` |
| 編成譜の自動縮小予算 | `ensembleAutoFitBudgetPx(pageHeightMm)`（定数 → 関数化） |

いずれも**引数の既定値を A4 にした**ので、用紙サイズを渡さない既存の呼び出しは
従来と完全に同じ値を返す。

### 2-6. UI と通知

レイアウトタブの「用紙と余白」グループの先頭に、ツールバーの位置（#483）と同じ
チップ型の並びで A4 / B4 / A3 を置く。

変更時は `describePageSizeChanged`（`scoreEditorNotices.ts`）で
「用紙サイズを B4 に変更しました（段の組み直しとページ数の変化が起きます）」を通知する
（#318「行き止まりは喋る」の方針）。用紙を選び直すという小さな操作が、段割り・ページ数を
組み直す大きな変化を起こすため、黙って組み替えると「勝手にレイアウトが崩れた」と受け取られる。
判定・通知は `setState` の updater の**外**で行う（updater 内だと StrictMode で二重に出る）。

## 3. 影響範囲

**新規**: `src/utils/pageSize.ts`

**変更**:
- `src/App.css`: 用紙寸法を `--paper-*` 経由に。`@page` のコメントに上書き方式を明記
- `src/types/storage.ts`: `SavedScoreData.pageSize?: PageSizeId`
- `src/utils/storage.ts`: 版上げ・検証・正規化・`createSavedScoreData` の引数追加
- `src/utils/viewZoomUtils.ts`: `pageWidthPxForSize()` を追加（`A4_PAGE_WIDTH_PX` は既定値として存置）
- `src/utils/measureLayoutUtils.ts`: `printScoreAreaWidthPx` / `worstCaseSystemContentBudget` に用紙幅の引数
- `src/components/useAutoPageScale.ts`: 用紙幅の引数
- `src/components/ScorePage.tsx`: state・保存/復元・CSS変数注入・`@page` 差し込み・UI・通知・自動縮小予算
- `src/utils/scoreEditorNotices.ts`: `describePageSizeChanged`

**テスト**:
- `src/utils/pageSize.test.ts`: 寸法（A4 は従来の直書き値と一致）・正規化・`@page` 値
- `src/utils/pageSizeLayout.test.ts`: レイアウト計算の追従・既定引数が従来値と一致・保存形式の往復
- `src/components/ScorePagePageSizeWiring.test.tsx`: ScorePage を実マウントした配線テスト
  （チップのクリック → CSS変数・`@page` の `<style>`・通知・自動保存・再読込・旧データ）

## 4. 受入条件との対応

| 受入条件 | 対応 |
|---|---|
| 1. A4/B4/A3 を選べ、画面・印刷・PDF が追従 | 2-2（画面）/ 2-3（印刷・PDF書き出しはブラウザの印刷経路なので同じ `@page` が効く）/ 2-6（UI） |
| 2. 保存→再読込で保持、旧データは A4 | 2-4。配線テスト「自動保存され開き直しても同じ判型」「旧データは A4 として開く」 |
| 3. 寸法が単一モジュールに集約され直書きが消えた | 2-1。5箇所すべてを `pageSize.ts` 由来に置換 |
| 4. サイズ変更時に通知（#318） | 2-6 |
| 5. 既存の A4 作品の見た目が1pxも変わらない | 引数既定値の A4 固定・CSS フォールバックの A4 実寸・A4 では `<style>` を差し込まない。`pageSize.test.ts` と `pageSizeLayout.test.ts` が従来の直書き値と一致することを固定 |

## 5. 未確認・残課題

- **実ブラウザでの印刷確認は未実施**（夜間ルーチンのため実機の印刷ダイアログを開けない）。
  `@page` の差し込みが実際のプリンタ出力・PDF書き出しで効くことはレビュー時に確認が必要
- 横向き（landscape）、パート譜と総譜で判型を変える案は本 Issue の範囲外（別 Issue）
- 用紙を大きくしたときの「段あたりの小節数の既定値」は現状の自動計画に任せている。
  B4/A3 で1段が長くなりすぎる場合は、判型ごとの既定値を検討する余地がある
