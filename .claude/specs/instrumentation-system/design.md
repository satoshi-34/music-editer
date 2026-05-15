# 編成譜・カスタム編成編集

## 背景

将来的にオーケストラスコアへ対応するには、単旋律、ピアノ、弦楽四重奏だけでは足りない。
ユーザーが「室内オーケストラ」「二管編成」「吹奏楽」などの代表編成から始めつつ、
実際の曲に合わせてパートを増減できる必要がある。

ただし、いきなり本格的なパート譜生成、移調譜、打楽器譜表まで作り込むと影響範囲が大きい。
今回は「編成をデータとして保存し、そのパート数ぶん譜表を表示できる」ことを第一段階にした。

## 方針

### 1. 既存の `ScoreType` を拡張する

既存の `single / piano / quartet` に加えて `ensemble` を追加した。

- `single`: 単旋律
- `piano`: ピアノ大譜表
- `quartet`: 弦楽四重奏
- `ensemble`: 編成テンプレートに従う可変パート譜

室内オーケストラや吹奏楽は `ensemble` として扱う。
これにより、プリセットを選んでも単旋律表示へ落ちる問題を避ける。

### 2. 編成定義を譜面データへ保存する

`SavedScoreData.instrumentation` を追加した。
旧データを壊さないため省略可能にしている。

編成は `ScoreInstrumentation` として保存する。

- `presetId`: どのテンプレート由来か
- `name`: 表示名
- `parts`: 楽器パート定義

各パートは `InstrumentPartDefinition` で持つ。

- `id`: 保存データと結びつけるための安定 ID
- `name`: フルネーム
- `abbreviation`: 譜面左側に出す略称
- `family`: 木管、金管、弦などの分類
- `clef`: 音部記号
- `staffCount`: 将来の複数譜表パート用
- `transposition`: 将来の移調楽器用
- `bracketGroup`: 将来の括弧表示用
- `playbackInstrument`: 再生音色の候補
- `order`: 表示順

### 3. プリセットは別ファイルにまとめる

`src/data/instrumentationPresets.ts` に代表編成を置いた。

- 単旋律
- ピアノ
- 弦楽四重奏
- 弦楽合奏
- 室内オーケストラ
- 二管編成オーケストラ
- 大編成オーケストラ
- 吹奏楽

音楽的な細部は今後レビューで調整できるよう、UI や保存形式から独立させている。

### 4. 可変パート譜は `EnsembleStaff` で描画する

`EnsembleStaff` は編成定義を受け取り、各パートを `PianoSystemCanvas` の `partsConfig` に変換する。
`PianoSystemCanvas` はすでに N 段譜を描けるため、新しい描画エンジンは作らない。

これで既存の入力、再生、調号、拍子の処理をなるべく再利用できる。
先頭システムでは `showInstrumentLabels` を使い、五線左側にパート略称を表示する。
略称用の余白を作ってから五線を配置しないと、`Fl.` などがページ端で切れるため、
`PianoSystemCanvas` 側でラベル幅を加味して描画開始位置をずらす。

### 5. カスタム編成編集では定義と小節データを同時に動かす

パート追加、削除、並び替えでは、次の 2 つを同じ順番で更新する。

- `instrumentation.parts`: パート名や音部記号などの定義
- `ensembleParts`: 実際の小節データ

この 2 つがずれると、見た目のパート名と保存される小節データが入れ替わる。
そのため、`ScorePage` 側で同時に同期する。

### 6. パート別音色を再生へ渡す

編成譜では、各パートが `playbackInstrument` を持つ。
`ScorePage` は譜面再生用の `PlaybackPart` を作るときに、この値を `instrument` として渡す。

内蔵音源では、パートごとに一時的に楽器設定を切り替えながら、同じ `AudioContext.currentTime` を開始時刻として予約する。
これにより、パートごとに音色を変えても発音タイミングはそろう。

SoundFont では、パートごとの `instrument` から対応する SoundFont プレイヤーを取得してから、同じ開始時刻へ予約する。
先にプレイヤーを読み込んでから開始時刻を決めることで、読み込み待ちのせいで発音時刻が過去になる問題を避ける。

### 7. 入力確認音もパート音色へそろえる

編成譜では、音符を置いた直後の確認音も `playbackInstrument` を使う。
`PianoSystemCanvas` はクリックされた `PartConfig` の `playbackInstrument` を `onPreviewNoteEvent` へ渡し、
`ScorePage` は確認音の再生中だけ音声エンジンの楽器を一時的に切り替える。

UI 上の「現在の音色」まで変更すると、ユーザーが再生パネルで選んだ設定が勝手に動いて見える。
そのため確認音の後は必ず元の `currentInstrument` へ戻す。

## 変更対象

- `src/types/storage.ts`
- `src/data/instrumentationPresets.ts`
- `src/components/EnsembleStaff.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `src/components/ScorePage.tsx`
- `src/hooks/useScoreStorage.ts`
- `src/audio/PlaybackEngine.ts`
- `src/audio/SimpleAudioEngine.ts`
- `src/audio/SoundFontEngine.ts`
- `src/utils/storage.ts`
- `src/utils/storage.test.ts`
- `src/App.css`
- `README.md`

## 影響範囲

- 保存形式に `instrumentation` が増える
- 旧データでは `instrumentation` がなくても読み込める
- `ensemble` の再生は、各パートの小節データを既存の `playParts` へ渡す
- `PlaybackPart.instrument` は省略可能なので、既存の単旋律・ピアノ・弦楽四重奏の再生呼び出しも維持できる
- 大編成では 1 ページあたりのシステム数を減らし、譜表が詰まりすぎないようにする
- 表示ページ数は `scoreType` と画面幅から毎回計算する。`visiblePages` を state として保持すると、編成譜の 2 段ページ仕様が単旋律へ切り替えた直後に残り、一ページ目が二行だけに見えることがあるため。

### 8. グループ括弧で楽器グループをまとめる

オーケストラ譜では、木管・金管・弦などの楽器グループを 1 本の括弧でくくり、
ひとまとまりに見せるのが慣習。`InstrumentPartDefinition.bracketGroup` をそのまま
描画側へ渡し、`PianoSystemCanvas` が「連続する同じ `bracketGroup` のパート」を
1 グループとみなして `StaveConnector` を 1 本描く。

- 鍵盤グループ (`keyboard`) は伝統に従って `BRACE`
- それ以外（`woodwinds` / `brass` / `strings` / `percussion` / `voices`）は `BRACKET`
- グループに属するパートが 1 段しかない場合は括弧を描かない（見た目がうるさくなるため）
- システム全体の左端は常に 1 本の縦線 (`SINGLE_LEFT`) で貫き、システム範囲を視覚的に保つ
- カスタム編成などでどのパートも `bracketGroup` を持たないときは、従来通り全体を 1 つの括弧でまとめる

これにより、大編成オーケストラでも木管・金管・弦が視覚的に区切れる。
グループ並びはユーザーがカスタム編成編集で組み替えると変わるため、
括弧は「順序に従って」毎回計算する（静的な定義ではない）。

## 今後の課題

- 移調楽器の記譜音と実音の切り替え
- 弦楽セクション内のサブグループ（Vln I/Vln II をブレースで括る等）
- 打楽器の専用記譜
- divisi、solo、a2、tutti などの表記
- パート譜表示と総譜表示の切り替え
