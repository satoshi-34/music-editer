# 設計書: タイトルまわりの書体選択（Issue #342）

弟インタビュー回答5（#89）:「タイトルの文字は自分で変えている。Finale はフォントが少なく不便。
Word くらいのフォントが欲しい」。

対象は **タイトル・サブタイトル・作詞/作曲/編曲者**（＝紙面の見出し部分）のみ。
音符・記号の書体（Bravura 系）と、譜面の中の文字（強弱記号・速度記号など SVG 側のテキスト）は
この設定では変わらない。

## 問題点（実装前の状況）

- 見出しの書体は `App.css` の `.score-title` / `.score-subtitle` / `.score-credit` が
  `var(--score-text-font)`（`"Century Schoolbook", Georgia, "Times New Roman", serif`）に固定していた
- 保存データ（`ScoreMetadata`）に書体を持つ場所が無く、譜面ごとに変える手段が無かった

## 設計

### 1. 選択肢の正本を1か所に（`src/utils/titleFonts.ts`）

`TITLE_FONT_OPTIONS` という1本の配列に `{ id, label, stack, description }` を並べる。
**1行足せば選択肢が増える**形にして、UI・保存・検証の3か所が同じ表を見るようにする。

第1弾で提供するのは5種類（欧文セリフ＝既定 / 欧文サンセリフ / 明朝 / ゴシック / 丸ゴシック）。
「Word くらいの種類」を最初から目指さない理由（Issue のレビュー反映）:

- 端末に入っていないフォントの代替（Windows / Mac / iPad で入っている書体が違う）
- 印刷・PDF 書出への埋め込みとライセンス
- Web フォント（Google Fonts）の読み込みが印刷に間に合わない場合、**紙面だけ別の書体で刷られる**

そのため第1弾は「どの端末にも必ずあるスタック」だけに限定し、Web フォントは採用しない。
各 `stack` は「Mac の標準 → Windows の標準 → Noto → 総称ファミリ（serif / sans-serif）」の順で、
最後が総称ファミリなので豆腐（□）にはならない。

### 2. 保存するのは ID だけ（`ScoreMetadata.titleFontId?`）

font-family の文字列そのものではなく **ID** を保存する。理由は2つ:

1. スタックの中身を後から直したいとき、保存済みの譜面を書き換えずに全体へ反映できる
2. 読み込んだファイルの文字列がそのまま CSS の `font-family` へ流れる経路を作らない
   （`isTitleFontId` のホワイトリスト照合で弾ける。`docs/security` の方針と同じ考え方）

旧データ互換のため **省略可**。`normalizeTitleFontId()` が未指定・未知の ID を既定（`serif`）へ落とす。
`validateScoreMetadata`（`src/utils/storage.ts`）も「未指定 or ホワイトリスト内」だけを通す。

### 3. 画面への適用は CSS 変数1本（`--score-title-font`）

`ScorePage` がページ（`.print-page`）のインライン style に `--score-title-font` を注入し、
`App.css` の3クラスが `var(--score-title-font, var(--score-text-font))` で受ける。

- 既定（`serif`）が解決する文字列は `SCORE_TEXT_FONT_FAMILY` そのもの＝従来の `--score-text-font` と
  同一の並びなので、**設定を触らない譜面の見た目は1pxも変わらない**
  （両者が同じ並びであることは既存の `engravingDefaults.test.ts` が固定している）
- 印刷・PDF 書出は `window.print()` で同じ DOM をそのまま刷るため、**別途の対応は不要**で
  画面と同じ書体になる（印刷用の別レンダリング経路は無い）

### 4. 状態の置き場所

`ScorePage` の `titleFontId` state。`title` などと同じ扱いで、

- `buildScoreData` / `buildCurrentScoreData` の `metadata` に含める（保存・自動保存・作品一覧・書出）
- 読込系（手動読込・自動保存の復元・作品切替・ファイル読込・MusicXML 読込・サンプル読込）は
  すべて `normalizeTitleFontId()` を通して復元する
- 「新規作成」（`resetScoreStateToEmpty`）は既定へ戻す
- 自動保存の依存配列にも入れる（漏れると「書体だけ変えて閉じたら戻る」事故になる。
  この不変条件は `ScorePageAutosaveDeps.test.tsx` が検査している）

### 5. UI

「楽譜設定」タブの `toolbar-select-row` に `<select aria-label="タイトルの書体">` を追加する。
このタブは「曲の骨格を決める項目」に絞る方針（Issue #144）だが、書体は**譜面ごとに保存される**
値なので、localStorage に持つ表示設定（レイアウトタブ）ではなくこちらに置く。

## 受入テスト（設計時に定めた合格基準）

| # | 内容 | 置き場所 |
| --- | --- | --- |
| 1 | 未指定・未知の ID・数値などが既定 `serif` へ落ちる | `titleFonts.test.ts` |
| 2 | 既定 ID が解決するスタックが `SCORE_TEXT_FONT_FAMILY` と同一（＝見た目が変わらない） | `titleFonts.test.ts` |
| 3 | 全選択肢のスタックが総称ファミリ（serif / sans-serif）で終わる（フォールバック保証） | `titleFonts.test.ts` |
| 4 | 保存往復: `titleFontId` 付きで保存→読込しても値が保たれる | `storage.test.ts` |
| 5 | 旧データ互換: `titleFontId` の無い metadata が検証を通り、未指定のまま読める | `storage.test.ts` |
| 6 | 不正値の拒否: 提供していない ID を持つファイルは読み込みで弾かれる | `storage.test.ts` |
| 7 | 画面: 書体を選ぶと `.print-page` の `--score-title-font` が変わる | `ScorePageTitleFont.test.tsx` |
| 8 | 画面: 既定のままなら注入値が従来の並びと同一（1pxも変わらない） | `ScorePageTitleFont.test.tsx` |
| 9 | 画面: 選んだ書体が保存データ（自動保存）へ入り、復元後も選択が残る | `ScorePageTitleFont.test.tsx` |

## 影響範囲

- `src/utils/titleFonts.ts`（新規・選択肢の正本）
- `src/types/storage.ts`（`ScoreMetadata.titleFontId?`）
- `src/utils/storage.ts`（`validateScoreMetadata` のホワイトリスト照合）
- `src/App.css`（見出し3クラスの `font-family`）
- `src/components/ScorePage.tsx`（state・保存/復元・CSS 変数の注入・選択 UI）

音符・記号の描画、SVG 側のテキスト（強弱・速度記号・歌詞）には触っていない。
