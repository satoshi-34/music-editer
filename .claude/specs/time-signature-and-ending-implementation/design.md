# 拍子記号と1番括弧/2番括弧の実装

## 背景

`エリーゼのために` をベンチマークに近づける検討の中で、
先に入れた `2 voice` よりも

- `4/4` 固定を外して `3/8` を持てること
- `1番括弧 / 2番括弧` を表示と再生で扱えること

の方が、譜面構造の再現度に直結すると分かった。

そのため今回は「複数声部の拡張」よりも優先して、
拍子と終止括弧をスコア構造へ入れる。

## 方針

### 1. 拍子はテンポ設定ではなくスコアデータにも保存する

既存の `TempoManager` は `timeSignature` を持っているが、
それは UI 設定寄りで、譜面ファイルの一部ではなかった。

今回から `SavedScoreData.timeSignature` を追加し、

- 保存時に譜面ごとの拍子を持つ
- 読み込み時に拍子を UI へ戻す
- 無効値は `4/4` に正規化する

ようにする。

### 2. 拍数計算は「4分音符 = 1拍」の既存単位を維持する

既存の音価計算は `4分音符 = 1` を前提にしている。
そのため `3/8` は `1.5` 拍として扱い、

- 音符追加時の小節上限
- 再生時間計算
- 空小節の長さ

を同じ単位でそろえる。

### 3. 描画用の拍子文字列と VexFlow の Voice 時間設定を分離しない

`StaffCanvas` / `PianoSystemCanvas` では、

- 表示用には `3/8` の文字列
- Voice には `{ num_beats: 3, beat_value: 8 }`

を同じ `timeSignature` から作る。

これで「見た目は 3/8 なのに内部では 4/4」というズレを防ぐ。

### 4. 1番括弧 / 2番括弧は小節への軽い印として保存する

終止括弧の保存形式は、
開始・中間・終了を直接保存せず `MeasureData.ending?: 1 | 2` にする。

理由:

- 編集 UI を単純にできる
- 保存データが短い
- 描画時に前後の小節を見れば `BEGIN / MID / END / BEGIN_END` を導ける
- 再生時は「今が1周目か2周目か」で判定できる

### 5. 終止括弧の描画は最上段だけに出す

ピアノ大譜表や弦楽四重奏では、
終止括弧は最上段だけに出した方が読みやすい。

そのため:

- 単旋律譜はその段に表示
- ピアノ譜 / 弦楽四重奏は最上段だけに表示

とする。

### 6. 再生展開は repeat 記号と ending 番号を組み合わせる

`expandMeasuresForPlayback()` を拡張し、

- 開始/終了リピートは従来どおり 1 回だけ折り返す
- 1周目は `ending: 1` の小節だけ鳴らす
- 2周目は `ending: 2` の小節だけ鳴らす

という基本規則を入れる。

今回は D.C. / D.S. までは広げず、
無限ループしない安全性を優先する。

## 変更対象

- `src/types/storage.ts`
- `src/utils/timeSignatureUtils.ts`
- `src/utils/endingBracketUtils.ts`
- `src/utils/storage.ts`
- `src/hooks/useScoreStorage.ts`
- `src/components/ScorePage.tsx`
- `src/components/Palette.tsx`
- `src/components/StaffCanvas.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `src/components/PianoStaff.tsx`
- `src/components/QuartetStaff.tsx`
- `src/utils/repeatMarkerUtils.ts`
- `src/audio/repeatPlaybackUtils.ts`
- `src/data/demoScores.ts`

## セキュリティ / 安定性

- `timeSignature` は保存時と読込時の両方で検証し、未知値を `4/4` に戻す
- `ending` は `1 | 2` 以外を保存データとして受け入れない
- 再生展開は従来の安全上限を維持し、壊れた記号配置で無限ループしないようにする

## 現状の制限

- `エリーゼのために` は `3/8` の冒頭主題デモとして組み直し、
  16分音符主体のリズム感も含めて原曲らしさを優先したが、
  まだ説明用の短い抜粋であり、原典版全体の構成や細かな装飾までは含めていない
- ただしサンプルには、リピート記号・1番括弧 / 2番括弧・強弱記号を実データとして入れ、
  ユーザーが機能をすぐ体験できる状態にはしている
- 1番括弧 / 2番括弧の再生分岐は、まず単純な反復進行を安全に扱う実装を優先している

## 途中拍子変更の追加実装（2026-06-30）

### 問題

グローバル拍子は楽譜全体で 1 つに固定されており、途中から 4/4 → 3/8 のような拍子変更を
表現できなかった。

### 設計

- `MeasureData.timeSignature?: TimeSignature` フィールドを追加し、小節単位の拍子上書きを保存
- パレットに「拍子変更」ツール（`mode: 'measureTimeSig'`、紫ボーダー）を追加
- 小節クリックでドロップダウンオーバーレイを表示（4/4、3/4、2/4、2/2、6/8、3/8、5/4、7/8、12/8、解除）
- `StaffCanvas` / `PianoSystemCanvas` 両方で `effectiveTimeSig` 変数を段ループ外に宣言し、
  小節ごとに `MeasureData.timeSignature` があれば更新しながらループ
- VexFlow Voice の `num_beats / beat_value` は `effectiveTimeSig` を使う
- VexFlow Voice は SOFT モードにして拍子変更小節での拍数バリデーションエラーを回避
- 拍子変更がある小節では `stave.addTimeSignature()` で記号を表示（1 段目先頭には表示しない）
- `fillPriorMeasureRests` は `measure.timeSignature ?? effectiveTimeSig` で正確な拍数を計算
- 音符挿入の拍数チェックも `currentMeasure.timeSignature ?? effectiveTimeSig` を参照
- 再生の拍数計算（`ScorePage.calculateScoreDuration`）でも `currentTimeSig` として追跡

### 影響範囲

- `src/types/storage.ts`: `MeasureData.timeSignature` 追加
- `src/components/Palette.tsx`: `measureTimeSig` ツール追加
- `src/components/StaffCanvas.tsx`: `effectiveTimeSig` 追跡、Voice 生成、VexFlow 拍子表示、オーバーレイ
- `src/components/PianoSystemCanvas.tsx`: 同上（ピアノ・編成譜）
- `src/components/ScorePage.tsx`: `calculateScoreDuration` で `currentTimeSig` 追跡

## バグ修正：拍子変更が反応しない・記号が表示されない（2026-06-30）

### 問題①：小節クリックでドロップダウンが開かない

**原因**：各音符・休符の上に重なっている透明な `hit` 要素（クリック当たり判定）が
`ev.stopPropagation()` を呼んでいたため、クリックイベントが下の `insertRect`（小節背景）
まで届かなかった。空の小節（音符なし）では `hit` がないので動いていたが、
何らかのイベントが入っている小節では一切反応しなかった。

**修正**：`hit` 要素の click ハンドラ内に `measureTimeSig` / `measureTempo` の処理を
直接追加し、`insertRect` に伝播しなくても動くようにした。
（`StaffCanvas.tsx` の `hit.addEventListener('click', ...)` と
`PianoSystemCanvas.tsx` の同箇所）

### 問題②：拍子変更を選択しても楽譜に記号が表示されない

**原因**：VexFlow の `stave.addTimeSignature()` を `stave.draw()` の**後**に呼んでいた。
VexFlow はモディファイア（拍子記号・調号など）を `draw()` 前に登録しないと描画しない仕様のため、
`addTimeSignature()` が完全に無視されていた。

**修正**：`effectiveTimeSig` の更新と `stave.addTimeSignature()` の呼び出しを
`stave.setContext(ctx) → stave.format() → stave.draw()` の**前**へ移動した。
あわせて、第1段・第1小節（グローバル拍子を表示する場所）でも
小節固有の拍子がある場合はそちらを優先して表示するよう変更した。

## 追記: 拍子の記号表記（C / アッラ・ブレーヴェ）— Issue #422

### 問題

月光ソナタ第1楽章の拍子は 2/2 だが、市販譜ではアッラ・ブレーヴェ記号
（縦線入りの C ＝ cut time）で書かれる。これまでは数字の「2/2」でしか描けなかった。

カスタム記号（自由に置ける絵）で C を重ねる回避策は採らない。
拍子データは 2/2 のまま絵だけ 4/4 に見える、といった**データと見た目のずれ**を
作り込むことになり、再生・小節の拍数チェック・MusicXML 書き出しと食い違うため。

### 修正設計

**「拍子データ」と「その見た目」を別々に持つ**方針にした。

- データ: `SavedScoreData.timeSignature`（`[2, 2]`）は従来どおり不変
- 表示: `SavedScoreData.timeSignatureStyle?: 'numeric' | 'symbol'` を追加
  （省略＝`numeric`。旧データはすべて従来どおりの数字表記になる）

描画の整形は `timeSignatureUtils.formatTimeSignature(timeSignature, style)` に集約した。
`style` が `'symbol'` のとき 4/4 は `'C'`、2/2 は `'C|'` を返す。この 2 つは VexFlow の
`Stave#addTimeSignature` がそのまま解釈する標準の指定で、SMuFL の
`timeSigCommon`（U+E08A）/ `timeSigCutCommon`（U+E08B）のグリフが描かれる。

記号が存在するのは 4/4 と 2/2 だけなので、判定は `canUseTimeSignatureSymbol()` に
1 本化し、**UI のトグルの有効・無効と、実際に記号で描くかの判定で同じ関数を共有する**
（2 箇所に同じ条件を書くと、片方だけ直したときに「トグルは押せるのに絵が変わらない」
というずれ方をするため）。6/8 などでは記号表示を指定しても数字のまま描く。

UI は「楽譜設定」タブの拍子セレクトの隣のチェックボックス（記号で表示（C / 𝄵））。
4/4・2/2 以外を選んでいる間は無効化するが、**設定値そのもの（`symbol`）は保持する**。
拍子を 6/8 へ変えて 2/2 へ戻したときに、記号表示の設定が消えていない方が自然なため。
描画へ渡す値だけを `effectiveTimeSignatureStyle` で切り替えている。
無効時は `title` に理由と代替手順（「4/4 か 2/2 を選んでください」）を出す
（AGENTS.md の「行き止まりは喋る」原則）。

MusicXML は `<time symbol="common">` / `<time symbol="cut">` で相互運用する。
`<beats>` / `<beat-type>` の数字は記号表示でも変えない（＝他ソフトでも拍子は 2/2 のまま）。
読み込み側も `symbol` 属性を見て `timeSignatureStyle` を復元する。

### 影響範囲

- `src/types/storage.ts`: `TimeSignatureStyle` 型と `SavedScoreData.timeSignatureStyle` を追加
- `src/utils/timeSignatureUtils.ts`: `formatTimeSignature` に `style` 引数（既定 `numeric`）、
  `normalizeTimeSignatureStyle` / `canUseTimeSignatureSymbol` / `DEFAULT_TIME_SIGNATURE_STYLE` を追加
- `src/utils/storage.ts`: 保存データの検証・正規化・`createSavedScoreData` の引数
- `src/components/ScorePage.tsx`: 状態・トグル UI・保存/復元・新規作成とサンプル読込でのリセット
- `src/components/PianoSystemCanvas.tsx`: `timeSignatureStyle` prop を受けて描画文字列を作る
- `src/components/{Single,Piano,Quartet,Ensemble,PartExtraction}Staff.tsx`: prop の受け渡しのみ
- `src/utils/musicXmlExport.ts` / `musicXmlImport.ts`: `<time symbol="...">` の書き出し・読み込み
- `src/App.css`: ツールバー内チェックボックスの見た目（無効時は薄く）

### 現状の制限（実装時に確認したこと）

上の「拍子変更がある小節では `stave.addTimeSignature()` で記号を表示」という記述は
現在のコードには当てはまらない。`addTimeSignature()` の呼び出しは
`PianoSystemCanvas.tsx` の**1 箇所だけ**（段頭かつ `startMeasureIndex === 0`、
つまり譜面のいちばん先頭）で、小節単位の拍子変更（`MeasureData.timeSignature`）は
拍数計算・小節幅・再生には効くが、五線上に拍子記号としては描かれない。

そのため今回の記号表記も適用先は「譜面の先頭の拍子記号」1 箇所である。
途中の拍子変更を五線に描く機能を入れるときは、同じ `formatTimeSignature(ts, style)` を
通せば記号表記もそのまま効く（整形を 2 系統にしないこと）。
