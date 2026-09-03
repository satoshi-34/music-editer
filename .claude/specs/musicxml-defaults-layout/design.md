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

## 追記（round 1 対応・2026-08-31）

- **defaults 無しファイル（P1）**: 縮尺は変更せず、収まらないときは
  describeNotationSizeFitSuggestion で「N% にすると収まります」の提案のみ通知
- **保存の明示化（P1）**: notationSizeMultiplier / pageMargins は工場出荷値と同じでも
  省略せず常に明示保存（省略+読込側の既定が食い違うと再読込で縮尺が化けるため）
- **省略時は表示設定へ戻す（P1）**: applySavedLayoutAttributes は属性の無い項目を
  localStorage の個人既定へ戻す（属性つき→属性なし作品の切替で前作品の値が混入しない）。
  フォールバックは state 初期化と同じ「単旋律の既定」に固定（属性なしの既存
  四重奏・編成譜の見た目を変えないため。ScorePagePartLayout の回帰で実測）
- **自動保存の依存（P1）**: layoutAttrRevision カウンタ経由で notationSize/余白の
  変更だけでも自動保存が走る（TDZ 制約の迂回）
- **余白 0 tenths（P2）**: readNonNegativeNumber で読んで下限クランプ（余白指定全体を破棄しない）
- テスト: B4 判型の配線・Finale 実測値ゴールデンパス・defaults 無し提案・
  属性なし作品への切替（表示設定へ戻る）・0余白、を追加

## 追補（Issue #526・2026-09-01）: 変更の無い `<attributes>` の書き直しで段割りが1小節/段へ膨張する

対象ファイル: `src/utils/musicXmlImport.ts`
テスト: `src/utils/musicXmlRepeatedAttributesLayout.test.ts` /
`src/components/ScorePageMusicXmlRepeatedAttributes.test.tsx`
フィクスチャ: `docs/qa/regression/moonlight-bars1-9-grandstaff.musicxml`

### 問題

連符を含む MusicXML（月光第1楽章）を読み込むと、ほぼ全段が1小節/段になる。
拍合計が厳密に正しいファイル（`<divisions>48`・8分3連が `duration=16` の整数）でも再現する。

**原因は連符ではなかった。** 外部ソフトの書き出しは、**変更が無くても毎小節
`<attributes>` に `<key>`・`<time>` を書き直す**ことがある。`buildStaffMeasures` は
クレフだけ「前の小節の末尾時点と違うときだけ小節単位の変更として保存する」という
比較をしていたが、調号・拍子には同じ比較が無く、**書かれていればそのまま
「この小節で変わる」印**（`MeasureData.keySignature` / `MeasureData.timeSignature`）
として取り込んでいた。

その印は段割りの計画で幅の上乗せに使われる
（`measureLayoutUtils.ts` の `measurePlannerSafetyPadding`: 調号 +42・拍子 +30。
段頭の stave が記号を描くぶんの安全幅）。上乗せは**パートごと**に効くので、
ピアノ大譜表（2パート）では **1小節あたり +144** も水増しされる。

一方、描画側（`PianoSystemCanvas`）は `effectiveKeySigPerMeasure` を前の小節と比べて
**変化したときだけ**記号を出し、拍子は譜面の先頭にしか出さない。つまり
**「描かれないのに幅だけ確保する」**という計画と描画の食い違いだった。
見た目に記号が増えないので、症状は「段割りだけがおかしい」形で現れる。

実測（月光1〜9小節・大譜表・音符の大きさ150%・A4/余白14mm）:

| | 小節1〜9の最低幅（論理単位） | 段あたり小節数 |
| --- | --- | --- |
| 直接入力 | 257, 257, 234, 286, 243, 306, 186, 198, 232 | 3, 2, 3, … |
| 読込（修正前） | 317, 401, 378, 430, 387, 450, 330, 342, 387 | 2, 2, **1**, 2, 3 |
| 読込（修正後） | 257, 257, 234, 286, 243, 306, 186, 198, 243 | 3, 2, 3, … |

小節数が多く1小節が密な実曲では、この水増しが全段を1小節/段まで押し下げる。

### 修正設計

`buildStaffMeasures` に、クレフの `runningClef` と同じ考え方で
`runningKeyFifths` / `runningTimeSig`（前の小節の時点で有効な値）を持たせ、
**値が変わったときだけ** `MeasureData.keySignature` / `MeasureData.timeSignature` を書く。

- 比較の起点は楽譜全体の調号・拍子（先頭 `<attributes>` から読んだ値）。
  `parseMusicXmlWithDefaults` 側で既に求めている `globalKeyFifths` / `globalTimeSig` を
  引数で渡す（パートごとに先頭小節から推測し直すと、`<key>` を持たないパートで
  基準がずれる）
- 先頭小節は従来どおり「この小節で変わる」印を持たない（曲全体の調号として扱う）。
  拍子も同様に、先頭小節が曲の拍子と同じなら印を書かない（従来は無条件に書いており、
  1小節目だけ +30/パートの水増しが起きていた）
- 途中で**本当に**変わるファイルの挙動は変えない（回帰テストで固定）

`measurePlannerSafetyPadding` 側（描かれない記号のぶんを足さない）は触っていない。
そちらは「小節データに印がある＝記号が描かれる」という前提で書かれた正しい実装で、
壊れていたのは印の付け方だったため。ただし**手入力・旧保存データに同じ印が残っている
場合は同じ水増しが起きる**ので、計画側でも「前の小節と比べて変化したときだけ足す」よう
揃えるかは別Issueで検討する余地がある（本Issueのスコープ外）。

### 影響範囲

- MusicXML / MXL の読み込み全経路（`parseMusicXml` / `parseMusicXmlWithDefaults`）
- 読み込んだ譜面の `MeasureData.keySignature` / `timeSignature`。
  これらの読み手（`musicXmlExport.ts`・`playbackPositionUtils.ts`・
  `measureLayoutUtils.ts`）はいずれも「無ければ曲全体の値」へフォールバックするため、
  冗長な印が消えても書き出し・再生・描画の結果は変わらない
- 描画（`PianoSystemCanvas`）は元から変化時だけ記号を出していたので見た目は不変

### ブラウザ実測でわかったこと（本Issueの残りの原因）

worktree を共有 dev サーバー経由で開き、上のフィクスチャを実際に読み込んで確かめた。

- 読み込みは成功し、大譜表・4つの♯・4/4・3連符の括りが正しく出る。コンソールエラー無し
- **段割りは1小節/段のまま**だった。原因は上の水増しではなく、**実ブラウザでの小節の
  最低幅そのものが大きい**こと。jsdom（テスト環境）は canvas の `measureText` が使えず
  VexFlow の文字幅が 0 で返るため、`vexFlowCombinedMeasureMinimumContentWidth` の値が
  実ブラウザの半分以下に出る:

  | | jsdom | 実ブラウザ |
  | --- | --- | --- |
  | 月光1〜9小節の最低幅（論理単位） | 257, 257, 234, 286, … | 557, 557, 559, 638, … |
  | 段あたり小節数（150%・A4/余白14mm） | 3, 2, 3, … | 1, 1, 1, … |

- **同じ譜面を直接入力した場合も、実ブラウザでは1小節/段になる**（`moonlight-bars1-9.score.json`
  の最低幅は 557, 557, 559, 638, … と読込結果に一致）。fixture が3小節×3段に見えるのは
  `systemMeasureOverrides`（運用者の手動上書き）が入っているためで、自動の段割りではない
- Issue の見立て「連符イベントの最小幅を過大に見積もっている」は、実ブラウザの実測では
  **成り立たなかった**。1音あたりの幅は音価にほぼ比例していて、連符だけの上乗せは無い:

  | 小節の中身（4拍） | 最低幅（論理単位） | 1音あたり |
  | --- | --- | --- |
  | 4分×4 | 112 | 28 |
  | 8分×8 | 338 | 42 |
  | 8分3連×4組（12音） | 540 | 45 |
  | 16分×16 | 760 | 47.5 |

  残っているのは「音符1つあたりの必要幅（実ブラウザで論理45＝150%で約30px）が、
  浄書の実物（月光は145mmの段に2小節＝1音あたり約22px）より3〜4割広い」という
  **段割り全体の見積もりの問題**で、読み込み固有ではない。`preCalculateMinTotalWidth`
  （VexFlow が「理想的な間隔」として返す値）をそのまま**最低**幅として使っていることが
  効いていると見られる。深追いは `layout-pipeline` の範囲なので本Issueでは触っていない。

  **追記（Issue #559・2026-09-03）**: この見立ては正しく、#559 で理想幅に圧縮率を掛けてから
  最低幅にする修正を入れた。月光は実ブラウザで2小節/段になっている。設計は
  `.claude/specs/layout-pipeline/design.md` §12、実測と前後の画像は
  `docs/qa/system-break-min-width/README.md` にある。

### 未確認の点

再現に使ったのは、リポジトリ内の PD フィクスチャ（`moonlight-bars1-9.score.json`）から
組み直した外部書き出し風の MusicXML であり、Issue で名指しされた運用者の実ファイル
（`~/Developer/月光_検聴版.musicxml`）そのものではない（作業環境に存在しなかった）。
実ファイルが同じ書き方（毎小節 `<attributes>`）かどうかは未確認で、別の要因が
重なっている可能性は残る。


### 追補2（#526 round1 P1・2026-09-02）: 実効拍子の継続

当初の追補では「書き出しは未指定小節を曲全体の拍子へフォールバックするため結果は
変わらない」と書いたが、**誤りだった**。読み込みが「変わった小節だけ記録する」正規化を
するようになった結果、`4/4 → 3/4 →（未指定）` を書き出すと3小節目にグローバルの
`<time>4/4</time>` が生えて、途中拍子変更が1小節で終わる往復退行が起きる。

修正: 書き出しの拍子解決を `measure.timeSignature ?? prevTimeSig ?? globalTimeSig`
（**直前の実効拍子を引き継ぐ**）へ変更した。調号の effectiveKeyFifths と同じ考え方。
`import → export → re-import` で `[null, 3/4, null, 4/4]` が保たれることを
musicXmlRepeatedAttributesLayout.test.ts の往復テストで固定している。
