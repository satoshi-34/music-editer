# MusicXML `<defaults>` のレイアウト引き継ぎ

対象 Issue: #477
対象ファイル: `src/utils/musicXmlDefaults.ts`（新規） / `src/utils/musicXmlImport.ts` /
`src/utils/measureLayoutUtils.ts` / `src/utils/storage.ts` / `src/types/storage.ts` /
`src/components/ScorePage.tsx`
テスト: `src/utils/musicXmlDefaults.test.ts` / `src/utils/notationSizeFit.test.ts` /
`src/utils/storageLayoutAttributes.test.ts` / `src/components/ScorePageMusicXmlDefaults.test.tsx`

## 1. 問題

実曲（ラヴェル ソナチネ・Finale 書き出し）を読み込むと
「この小節は最小の1小節/段でも紙幅を超えます」警告が出ていた。40小節目（16分×16イベント）を
音符サイズ150%で組んでいたためで、130%以下なら収まることが実測されていた。

原因は「音符が多すぎること」ではなく、**ファイルが持っているレイアウト指定を全部捨てていた**こと。
Finale の書き出しを調べると `<defaults>` に、その作品をどう組むかがそのまま入っている
（実測例: `scaling` 6.9674mm/40tenths、`page-layout` は換算で A4、`new-system` 19箇所・
`new-page` 4箇所）。従来の `parseMusicXml` は `<defaults>` を一切読まず、常にアプリの既定
サイズ（単旋律・ピアノは150%）で組んでいた。

## 2. 修正設計

### 2-1. `<defaults>` を読む純関数（`musicXmlDefaults.ts`）

MusicXML の単位は **tenths**（1/10 五線間隔）で、`<scaling>` の
「`millimeters` mm ＝ `tenths` tenths」という比だけが mm への橋渡しになる。
**40 tenths ＝ 五線の高さ（第1線〜第5線）** という規約があるので、五線高(mm) が求まる。

アプリ側の五線高は `4 sp × 10 u/sp × SCORE_LAYOUT_RENDER_SCALE(0.44) ×「音符の大きさ」倍率`
を 96dpi で mm へ直した値で、**150% ≒ 6.985mm**。浄書標準の五線高 7mm（Finale 既定 6.9674mm）
とほぼ一致するため、`ファイルの五線高 ÷ 100%時の五線高` がそのまま倍率になる。
スライダーの刻み（5%）へ丸め、範囲（80〜200%）へクランプする。

`<page-layout>` の判型は mm へ換算してから、対応サイズ（A4/B4/A3・#495）のうち最も近いものへ
寄せる。縦横どちらかが 3mm を超えてずれていれば「丸めた」とみなし、#318 の方針で通知する。
余白は `type="both"` を優先し、アプリの左右余白はスライダー1本（左右同値）なので左右の平均を採る。

**壊れた値・極端な値は「読めなかった」ことにする**（五線高 1mm 未満/20mm 超、用紙 50mm 未満/
1000mm 超、`<scaling>` が無い場合の page-layout）。ファイル由来の値で画面を壊さないための安全弁で、
その場合は従来どおりアプリの既定値で組む。

### 2-2. 作品の属性として持つ（`SavedScoreData`）

引き継いだ値は**表示設定（localStorage）ではなく作品の属性**として保存する
（#495「用紙サイズは作品の属性」と同じ原則。別の環境で開き直しても同じ組み方で開く）。

| 追加した項目 | 内容 |
|---|---|
| `notationSizeMultiplier?` | 「音符の大きさ」倍率（0.8〜2.0） |
| `pageMargins?` | ページ余白 `{ sideMm, topMm, bottomMm }` |

- どちらも**省略可能**。省略時は従来どおり表示設定（スライダーの値）に従うので、旧データの
  挙動は変わらない
- **工場出荷既定値と同じときは項目自体を書き出さない**（`timeSignatureStyle` / `pageSize` と
  同じ方針）。既定のまま使っている作品の保存データは従来と差分ゼロになる
- 版数（`CURRENT_VERSION`）は据え置き。省略可能な項目が増えただけで、旧版でも読める
- 読み込み時は値が入っているときだけスライダーの範囲へクランプする
  （`normalizeNotationSizeMultiplier` / `normalizePageMargins` が正本）
- **読込時に localStorage の表示設定は書き換えない**。作品を1つ開いただけでグローバル設定が
  変わってしまわないようにするため（トリアージの「グローバル設定は変えない」に対応）

### 2-3. それでも収まらないときのフォールバック（`fitNotationSizeMultiplier`）

ファイル指定の縮尺をそのまま使っても、**収まるとは限らない**。音符の間隔の詰め方はアプリ独自の
浄書だからで、互換性の期待値は「同じ設計図で組んだ本アプリの浄書」（トリアージ本文）である。

`planEffectiveMeasuresPerSystem` が返す `minimumWidths` は VexFlow の論理単位（倍率に依存しない値）
なので、「いちばん広い小節 × `SCORE_LAYOUT_RENDER_SCALE` × 倍率 ≦ 段の本文幅」という一次不等式を
解くだけで「収まる最大の倍率」が求まる。5%刻みで**切り下げ**（境界で溢れないように）、
スライダーの最小値で止める。

読込時はこの計算を必ず通す:

1. `<defaults>` があれば、その縮尺・判型・余白を当てる
2. その状態で1小節すら紙幅に入らない小節があれば、収まる倍率まで下げる
3. 下げた場合は「紙幅に収まらない小節があったため、音符の大きさを◯%に調整しました」と通知。
   下げずに引き継いだだけで表示が変わった場合は「ファイルの指定に合わせて…」と通知（#318）

これにより `<defaults>` の無いファイル（受入条件3のフォールバック経路）も、従来の
「読み込んだら警告が出て終わり」から「収まる大きさで開いて、そう伝える」へ変わる。

### 2-4. 読込時の state 更新の注意（実装で踏んだ穴）

ファイル指定を当てる `applySavedLayoutAttributes` の直後に、フォールバックの結果を
`setNotationSizeMultiplier` で上書きする。このとき**「今の state と違うときだけ set する」と
書いてはいけない**: 同じレンダー内で行った更新はまだ state に反映されていないため、
「ファイル指定 200% → フォールバック 150%」で、読込前の state が 150% だと
「同じだから何もしない」と判定され、実際には 200% のままになる（実装中に実際に踏んだ）。
必ず set し、通知の要否だけを比較で決める。

## 3. 影響範囲

**新規**: `src/utils/musicXmlDefaults.ts`

**変更**:
- `src/utils/musicXmlImport.ts`: `parseMusicXmlWithDefaults()` を追加（`parseMusicXml` は薄い
  ラッパーとして存置）。`<defaults>` 由来の値を `SavedScoreData` へ載せる
- `src/utils/measureLayoutUtils.ts`: `fitNotationSizeMultiplier` / `normalizeNotationSizeMultiplier`
  / `normalizePageMargins` / `SavedPageMargins` を追加
- `src/types/storage.ts` / `src/utils/storage.ts`: 作品の属性2項目（検証・正規化・書き出し）
- `src/utils/scoreEditorNotices.ts`: 引き継ぎ・自動縮小・判型丸めの通知文3本
- `src/components/ScorePage.tsx`: 読込時の適用（MusicXML・作品復元・自動保存の復元）、
  保存時の受け渡し、読込時のフォールバック計算と通知

**この段では扱わない**（トリアージの段階2として別Issue化可）:
- `<print new-system/new-page>` による段替え・改ページ位置の再現
- 自動保存の依存配列に「音符の大きさ」「ページ余白」を入れること（これらの state は
  ScorePage.tsx の後方で宣言されており、依存配列はレンダー中に評価されるため TDZ になる）。
  これらだけを変えたときは自動保存が起動しないが、値は次の自動保存でそのまま保存される。
  MusicXML 読込では譜面本体と同時に変わるため必ず保存される
