# 途中音部記号変更（小節単位のクレフ変更）の実装

## 背景

すでに「途中テンポ変更」（`MeasureData.bpm`）・「途中拍子変更」（`MeasureData.timeSignature`）・
「途中調号変更」（`MeasureData.keySignature`、コミット `367479c`）は小節単位で実装済みで、
パレットの専用ツール→小節クリック→オーバーレイでの選択、というパターンが確立している。

一方、音部記号（クレフ）は `PartData.clef`（`'treble' | 'bass' | 'alto'`）でパート単位に固定されており、
「チェロがテナー記号の高音域を弾いたあと、ヘ音記号に戻る」「ピアノ左手が一時的にト音記号になる」
といった曲の途中でのクレフ切り替えを表現できなかった。

## 設計

### 1. データ型

- `ClefType`（`src/components/clefUtils.ts`）に `'tenor'` を追加した。
  テナー記号は C 記号を第4線に置くもので、チェロ・ファゴット・トロンボーンの高音域で必須。
  VexFlow は文字列 `'tenor'` をそのままクレフ種別として受け付ける。
- `MeasureData.clef?: ClefType`（`src/types/storage.ts`）を追加した。
  省略時は「直前の小節のクレフ」または「パートの既定クレフ（`PartData.clef`）」を継続する
  （bpm / timeSignature / keySignature と同じ継承セマンティクス）。
- `PartData.clef` の型を `'treble' | 'bass' | 'alto'` から `ClefType` に変更し、
  パート全体の既定クレフとしても tenor を選べるようにした。
- バリデーションは `src/utils/storage.ts` に `isValidClefType` を新設し、
  `validatePartData`（パートの既定クレフ）と `validateMeasureData`（小節単位のクレフ変更）の
  両方で使う。未知の値が入った保存データは無効として読み込みを拒否する。

### 2. 有効クレフの解決ヘルパー

`src/utils/clefMeasureUtils.ts` に `resolveMeasureClef(measures, index, partClef)` を新設した。
`resolveMeasureKeySignature` と完全に同じ構造（指定小節までを先頭から走査し、最後に見つかった
`clef` を返す。どの小節にも指定がなければ `partClef` を返す）。

段頭のクレフ表示、クリック入力時の音高変換、既定休符位置の決定、MusicXML 書き出しの
「クレフが変わった小節だけ `<clef>` を出力する」判定など、「この小節時点で有効なクレフは何か」を
求めるあらゆる場所で共通利用する。

**調号との違い**: 調号は編成譜で「最上段（`partsScore[0]`）の小節データにのみ保存し、全パート共通」
という設計だったが、クレフは楽器ごとに別々のタイミングで変わりうる（例: チェロだけテナー記号にする）
ため、`resolveMeasureClef` は各パート自身の `part.data`（`MeasureData[]`）に対して呼び出す。

### 3. clefUtils.ts への tenor 追加

`src/components/clefUtils.ts` の `lineToKey` / `keyToLine` ディスパッチャに tenor 分岐を追加した。
テナー記号は「第4線から数えて0番目（最上線）= E4」を基準に、alto 記号と同じ構造
（`idx = 2 - stepsDown, oct = 4`、基準音 'e'）で実装した。

導出根拠: テナー記号の五線（下から上）は D3, F3, A3, C4, E4 であり、下から4番目の線（＝この
エディタの「line 0 が最上線」規約では上から2番目）が中央ハ（C4）にあたる。

### 4. 入力UI（パレット）

`src/components/Palette.tsx` に「音部記号変更」ツール（`mode: 'measureClef'`）を、
既存の「調号変更」ボタンの隣に追加した。

- 小節をクリックすると、ト音記号/ヘ音記号/アルト記号/テナー記号/「（解除）」の
  ドロップダウンオーバーレイが開く（調号変更と全く同じ「オーバーレイ state → confirm 関数 → JSX」
  パターン）。
- 単旋律譜（`StaffCanvas.tsx`）・編成譜（`PianoSystemCanvas.tsx`）の両方に実装した。
- 編成譜では、クレフはクリックした段（パート）自身の小節データに保存する
  （`clefEditState` に `partIndex` を持たせ、`handleClefConfirm` で `setPartsScore` の
  該当パートだけを更新する）。これは調号（全パート共通）とは異なる設計判断で、
  楽器ごとに異なるタイミングでクレフを変える実用上の要求（チェロだけテナー記号、等）に対応する。

### 5. 描画

- 段の描画ループで `effectiveClef` を追跡する変数を宣言し、各小節の `MeasureData.clef` があれば
  更新しながらループする（`effectiveKeySig` と同じパターン）。
- 段の先頭小節では「その段の先頭小節時点で有効なクレフ」を `stave.addClef(effectiveClef)` で
  通常サイズ表示する。
- 段の途中の小節でクレフが変わった場合は、その小節の頭に `stave.addClef(effectiveClef, 'small')`
  で小型クレフを表示する（VexFlow の `Stave.addClef(clef, size?, annotation?, position?)` の
  `size: 'small'` 引数を利用）。
- 音符の生成（`sanitizeRenderEvent` / `makeVFNote`）、既定休符位置（`defaultRestKeyForClef` /
  `applyDefaultRestDisplayLine`）は、すべて `effectiveClef`（この小節時点で有効なクレフ）を使うよう
  変更した。

### 6. 音高の解釈（この機能の本体）

クリック入力の Y→音高変換・臨時記号の既定付与・休符の default 位置などは、従来はパート固定の
`clef` プロパティを直接使う `lineToKey` / `keyToLine` クロージャに依存していた。これらを
「その小節時点で有効なクレフ」に基づくよう変更した。

**重要な実装上の注意（クロージャのタイミング問題）**: 描画ループでは `effectiveClef` を
`let` で保持し、各小節の描画時に更新するが、この変数はクリックハンドラなど「後から呼ばれる」
関数からも参照される。ループの外側で宣言された `let effectiveClef` を非同期に呼ばれる
イベントハンドラがそのまま参照すると、実行時点では「その回の描画の最後の小節」の値になって
しまい、クリックした小節とは異なるクレフを使ってしまう（実は調号側の既存実装にも同種の
制限が残っている）。

これを避けるため、クリックハンドラ内部では `effectiveClef`（ループの共有変数）ではなく、
そのハンドラのスコープ内で `const` として確定している絶対小節インデックス
（`absoluteMeasureIndex` / `absI` など）を使って、都度 `resolveMeasureClef(score, index, clef)`
を呼び直す方式にした（`StaffCanvas.tsx` の `clefHere` 変数、`PianoSystemCanvas.tsx` の
`clefHere` 変数）。これにより、描画ループの共有変数に依存する調号側よりも堅牢な実装になっている。

### 7. StaffCanvas / PianoSystemCanvas 双方の対応範囲

- **StaffCanvas**（単旋律譜。ト音記号想定だが `clef` prop で固定クレフを指定できる既存仕様）:
  データとして `MeasureData.clef` があれば描画・入力とも対応する。
- **PianoSystemCanvas**（ピアノ大譜表など複数パート）: 各パートの `part.data`
  （そのパート自身の `MeasureData[]`）を見て、パートごとに独立してクレフ変更を解決・描画する。

### 8. MusicXML 入出力

- 書き出し（`src/utils/musicXmlExport.ts`）: パートごとに「現在有効なクレフ」を追跡しながら
  小節を出力し、直前の小節と異なるときだけ `<attributes><clef>` を出力する
  （既存の `keyChanged` 判定と同じパターンを `clefChanged` として追加）。
  クレフ→MusicXML `sign`/`line` の対応は G/2（ト音記号）、F/4（ヘ音記号）、C/3（アルト記号）、
  C/4（テナー記号）。
- 読み込み（`src/utils/musicXmlImport.ts`）: C 記号のとき `line` が `4` ならテナー記号、
  それ以外はアルト記号として区別するようにした（`xmlClefToClefType` ヘルパー）。
  **ただし、小節単位の途中クレフ変更の読み込みは対象外とした**（後述の制限を参照）。
  パートごとの単一の既定クレフ（先頭の `<attributes><clef>`）のみ復元する。

## 影響範囲

- `src/components/clefUtils.ts`: `ClefType` に `'tenor'` 追加、tenor 用 line⇄key 変換
- `src/types/storage.ts`: `MeasureData.clef` 追加、`PartData.clef` の型を `ClefType` に変更
- `src/utils/storage.ts`: `isValidClefType` 新設、`validatePartData` / `validateMeasureData` に反映
- `src/utils/clefMeasureUtils.ts`: 新規。`resolveMeasureClef`
- `src/components/Palette.tsx`: `measureClef` ツール追加
- `src/components/StaffCanvas.tsx`: `effectiveClef` 追跡、クレフ変更オーバーレイ、
  クリック入力の音高変換・既定休符位置の解決元変更
- `src/components/PianoSystemCanvas.tsx`: パートごとの `clefHere` 追跡、クレフ変更オーバーレイ
  （`partIndex` 対応）、音符生成・入力の解決元変更
- `src/utils/musicXmlExport.ts` / `src/utils/musicXmlImport.ts`: 小節単位の `<clef>` 出力、
  C記号のテナー/アルト判別

## テスト

- `src/components/clefUtils.test.ts`: tenor の line⇄key 変換、往復変換、休符位置
- `src/utils/clefMeasureUtils.test.ts`: 有効クレフの解決ロジック
- `src/utils/storage.test.ts`: 小節単位 `clef` の保存・読込・不正値バリデーション
- `src/utils/musicXmlClef.test.ts`: MusicXML 書き出し（変更小節だけ `<clef>` が出る）、
  アルト/テナーの sign・line 出力、パート既定クレフの export→import 往復

`docker compose run --rm app npx vitest run` は全 778 件成功、
`docker compose run --rm app npm run build`（`tsc -b && vite build`）も成功した。

## 現状の制限

1. **MusicXML 読み込みは小節単位の途中クレフ変更に対応しない**。パートごとの先頭の
   `<attributes><clef>` だけを既定クレフとして読み、2小節目以降の `<attributes><clef>`
   （途中クレフ変更）は無視する。書き出しは対応しているため、このアプリ内で保存・読込する分には
   問題ないが、他ソフトで作った「曲の途中でクレフが変わる」MusicXML を読み込んでも、
   その変更は反映されない。
2. **タイ／スラーの弧の描画**（`drawArcPath` / `drawTieArcP` とその前段の `tieRepKey` /
   `tieRepKeyP`、`notePositionMap` を使ったスラーの経由音高収集）は、単一の固定クレフ
   （コンポーネントの `clef` prop、または `part.clef`）のまま据え置いた。これらは弧の曲率・
   上下判定という「見た目の補助情報」としてのみ `keyToLine` を使っており、途中でクレフが
   変わるケースでもタイ・スラーの対象音符自体の音高（pitch）計算には影響しない。曲がる向きが
   まれに最適でなくなる可能性はあるが、実用上の支障は小さいと判断した（調号変更機能の
   「調号キャンセル表示は省略」と同種の割り切り）。
3. **キーボード操作（矢印キーでの音符の移動・削除時の既定休符）** は、従来通りコンポーネントの
   `clef` prop（固定値）を使う。これは調号変更機能が矢印キー操作時に `keySignatureRef.current`
   （グローバル調号）を使い、小節ごとの実効調号を解決していないのと同じ既存の設計方針を踏襲した
   もので、範囲外とした。

---

# 小節途中での音部記号変更（mid-measure clef change / Issue #424 段1）

## 背景

上記の実装は「小節単位」（`MeasureData.clef`）までで、小節の**途中**でクレフが変わる譜面
（例: 月光第1楽章37小節。右手が小節の途中でト音→ヘ音記号へ切り替わる）は表現できなかった。
⇵（段またぎ表示）で近い見た目は作れるが、1音ずつの指定なので長いパッセージに耐えない。

## データ設計

- `NoteEvent.clefChange?: ClefType`（`src/types/storage.ts`）を追加した。
  意味は「**このイベントの直前に小型クレフを置き、このイベントから有効**」。
  次の変更（イベント単位 or 次の小節の `MeasureData.clef`）まで持続し、実譜の慣習どおり
  **小節をまたいでも持続する**。
- 元に戻すときはプロパティごと削除する（`renderStaff` と同じ約束。保存内容が増えない）。
- v1 では**主声部（`MeasureData.events`）のイベントに付いたものだけ**を有効とする。
  追加声部にも付けられるようにすると、同じ時刻に別々のクレフを主張できてしまうため。
- バリデーションは `validateNoteEvent`（`src/utils/storage.ts`）で小節単位の clef と同じ
  `isValidClefType` を使う。未知の値を含む保存データは無効として読み込みを拒否する。

## 解決関数（`src/utils/clefMeasureUtils.ts`）

- `resolveMeasureClef(measures, index, partClef)` を拡張し、**前の小節の末尾時点の実効クレフ**を
  引き継ぐようにした（`index` より前の小節については、その小節のイベントの `clefChange` も
  適用してから次へ進む）。対象小節自身の途中変更は「先頭時点」の値には含めない。
  途中変更を含まないデータでの戻り値は従来と完全に同じ（リグレッション防止）。
- `resolveEventClef(measures, measureIndex, eventIndex, partClef)` を新設した。
  「その音符の時点で有効なクレフ」を返す。`clefChange` は**そのイベント自身から**有効なので、
  `eventIndex` のイベントが持つ変更も含めて解決する。
- `resolveEventClefsInMeasure(events, clefAtMeasureStart)`: 1小節ぶんのイベント別実効クレフを
  1回の走査でまとめて返す（描画側が音符ごとに小節を走査し直さないため）。
- `collectMidMeasureClefChanges(events)` / `resolveClefAtBeat(...)`: 「何拍目からどのクレフか」の
  一覧と、拍位置での解決。**追加声部（声部2）はイベント数もリズムも主声部と違い、添字では
  対応が取れない**ため、同じ小節の中で声部ごとにクレフがねじれないよう拍位置でそろえる。
- `hasMidMeasureClefChange(events)`: 途中変更の有無の安い判定。

## 描画（`src/components/PianoSystemCanvas.tsx`）

- `buildPartVoicesForMeasure` で、小節先頭のクレフ（`clefHere`）に加えて
  **イベント別の実効クレフ**（`primaryEventClefs` / 追加声部は拍位置解決）を用意し、
  `sanitizeRenderEvent`・`makeVFNote`・休符位置（`standardRestDisplayKey` /
  `restKeyForVoice`）のすべてを音符ごとのクレフで解決するようにした。
- 小型クレフは VexFlow の `ClefNote`（音価を持たない tickable）を
  **その音符の直前**に差し込んで描く。`voice.addTickables` へ渡す配列にだけ混ぜ、
  `vfNotes` 配列には入れない。ビーム・連符・選択ハイライトはすべて
  「音符の並び＝保存データのイベントの並び」を添字で対応づけているため、
  ここに1件でも混ぜるとその対応が全部ずれる（この設計判断は変えないこと）。
- 小型クレフは主声部にだけ置く。追加声部にも置くと同じ位置に声部の数だけ重なる。
- 拍を埋める表示専用の休符（padding rest）は小節末尾に付くので、末尾時点のクレフで位置を決める。

## キーボード操作の既存バグ修正

キーボードハンドラの音高換算が `partsClefRef`（パートの既定クレフ）決め打ちで、
**小節単位のクレフ変更すら見ていなかった**。↑↓の相対移動は同じ誤ったクレフで往復変換するため
結果的に無事だったが、休符位置のリセット（0 キー → `standardRestDisplayKey`）はクレフ変更後の
小節でずれていた。`resolveEventClef` へ寄せて修正した。

## 影響範囲

- `src/types/storage.ts`: `NoteEvent.clefChange` 追加
- `src/utils/storage.ts`: `validateNoteEvent` に `clefChange` の検証を追加
- `src/utils/clefMeasureUtils.ts`: `resolveMeasureClef` 拡張、`resolveEventClef` ほか新設
- `src/components/PianoSystemCanvas.tsx`: イベント別クレフでの描画、小型クレフの挿入、
  キーボード操作のクレフ解決

## 入力UI（段1の後半）

既存の「音部記号変更」ツール（`mode: 'measureClef'`）を**拡張**した（2本目のツールは作らない）。

- **小節の背景クリック** = 従来どおり小節単位（`MeasureData.clef`。小節の頭から）
- **音符クリック** = その音符から（`NoteEvent.clefChange`。小節の途中から）

分岐は `PianoSystemCanvas` の共通ディスパッチャ `handleMeasureScopedTool` の中に置き、
呼び出し側から「どこを押したか」（`{ kind: 'measure' } | { kind: 'note', eventIndex, voiceIndex }`）を
渡す形にした。#244 段3a で1か所へ集約した経路をそのまま使うためで、
音符側にもう1本ハンドラを生やすと「片方だけ直して食い違う」#280 型の事故を招く。

オーバーレイ（`clef`）のペイロードに `eventIndex?: number` を足し、
**その有無だけ**で確定処理（`handleClefConfirm`）の書き込み先を切り替える。
オーバーレイの見出しも「この音から音部記号を変更」に変わり、どちらの操作か一目で分かる。
「解除」は `clefChange` を**プロパティごと削除**する（`renderStaff` と同じ約束）。

行き止まりを黙らせない（#318）ため、次の2つは通知して何もしない
（`describeMidMeasureClefUnavailable`）:

- **声部2以降の音符**: v1 は主声部にだけ付けられる（同じ時刻に声部ごとの別クレフを
  主張できてしまうため）
- **音符の無い小節の全休符**: 画面に出ている全休符は表示専用のプレースホルダーで、
  保存データに対応するイベントが無い（小節の背景クリックへ誘導する）

## クリック入力の音高換算

空白クリックで音符を置くときの Y→音高換算は、`clefHere`（小節の頭のクレフ）ではなく
**挿入位置の時点のクレフ**で行う。同じ y でも「どの音か」が小節の前半と後半で変わるため。

- 途中変更が1つも無い小節では `clefHere` をそのまま使う（従来の入力は1音も変わらない）
- 主声部: 挿入位置 `at` の**手前まで**の変更が効いた状態＝`resolveEventClef(score, absI, at - 1, ...)`
- 追加声部: イベントの並びが主声部と対応しないので、挿入位置の**拍**で `resolveClefAtBeat`

そのため `doInsert` では、挿入位置 `at`（連符グループへの吸着まで済ませた最終値）を
**先に**確定させてから音高を求める順序にした。

## 小節幅の見込み（measureLayoutUtils）

小型クレフ（`ClefNote`）は音符の並びの中で幅を食うので、幅計画に見込みを足さないと
途中変更のある小節だけ音符が詰まって重なる。

- `measurePlannerSafetyPadding`: 途中変更1件につき +28px（小節単位の `measure.clef` と同じ値。
  小型は本来もう少し細いが、足りないより広い側で丸める）
- `planEffectiveMeasuresPerSystem` の `runningClefs`: 次の小節へ引き継ぐ値を
  `resolveClefAtMeasureEnd`（小節末尾時点の実効クレフ）にした。引き継がないと、
  途中でヘ音記号へ変えた次の小節の幅を古いクレフで測ってしまう

## MusicXML 書き出し

- 変更が付いたイベントの**直前**に `<attributes><clef>…</clef></attributes>` を出す
  （MusicXML は小節の途中にも `<attributes>` を置ける。小型クレフが音符の手前に描かれるのと同じ順序）
- 次の小節へ引き継ぐ `prevClef` を `resolveClefAtMeasureEnd` にした。先頭時点の値のままだと、
  途中で変えた次の小節の頭で同じクレフをもう一度出力してしまう（読む側ではクレフが二重に出る）

## ブラウザ確認で見つかった不具合（同じ回で修正）

小節の途中でクレフを変えたあと、**次の小節の頭にも小型クレフが出て二重になっていた**。
段の途中でのクレフ表示は「前の小節と変わったか」で判定しているが、比べる相手が
**前の小節の先頭時点**だったため、途中変更のぶんが「小節が変わったところで初めて変わった」と
見えてしまうのが原因。比べる相手を `resolveClefAtMeasureEnd`（前の小節の末尾時点）にして直した
（MusicXML 書き出しの `prevClef` とまったく同じ型の間違いで、そちらは先に直していた）。

実際の楽譜でも、途中で変えたクレフを次の小節の頭で書き直すことはしない。
回帰テストは `PianoSystemCanvasMidMeasureClef.test.tsx` の「受入6」で、
小型クレフ（VexFlow は通常 30pt・小型 20pt で描く）の数を数えて固定している
（修正前は 2、修正後は 1。小節単位の変更が従来どおり1つ出ることも同時に見ている）。

## この段で入れていないもの（段2）

- **MusicXML 読み込み**: 小節途中の `<attributes><clef>`（#419 合流後）
- **⇵（段またぎ）との共存**: ⇵中の音への `clefChange` 付与を断る通知（#318 の型）
- **パート譜表示の追随確認**

## テスト

- `src/components/PianoSystemCanvasMidMeasureClef.test.tsx`: 音符クリックでの付与・解除、
  小節背景クリックが従来どおりであること（回帰）、声部2での拒否通知、
  クリック入力の音高が「その位置の時点のクレフ」で決まること
- `src/utils/musicXmlClef.test.ts`: 小節途中の `<attributes>` が対象音符より前に出ること、
  次の小節の頭で重複しないこと
- `src/utils/measureLayoutUtils.test.ts`: 途中変更の件数ぶんだけ余裕幅が増え、
  変更が無い小節では1pxも増えないこと

## ブラウザでの確認（2026-08-27）

worktree だけを載せた使い捨てコンテナ（:5174）でピアノ大譜表を描き、実際の操作で確認した。

- 「音部記号変更」ツール → 3つ目の音符をクリック → 「この音から音部記号を変更」のドロップダウン →
  ヘ音記号 で、その音の直前に小型クレフが入り、以降の音がヘ音記号で描かれた
- 小型クレフの前後に重なりは無い（符頭の実描画X: 変更前 89/200/312/423 → 変更後 89/190/348/449、
  小型クレフは 291。フォーマッタが自動で場所を空けている）
- 途中変更を入れても**ページの縮小率は変わらなかった**（`--scale` は 0.7705 のまま）
- 元に戻す（Cmd+Z）で小型クレフが消え、やり直すと戻る
- 印刷プレビューでも同じ見え方になる

## Codex round 1 対応（2026-08-28・レビュアー側で実施）

- **main とのリベース**: measureLayoutUtils.test.ts 末尾で #430（ダブル臨時記号の幅）と
  本PRの途中クレフ幅テストが競合。両 describe を残して解消（テスト50件緑を確認）
- **声部2のクレフ解決の不一致（P2×2）**:
  - キーボード操作（↑↓・0キー等）の音高換算が主声部インデックスで resolveEventClef を
    呼んでいたため、声部2の選択では描画と別のクレフを解決していた。
    `resolveVoiceEventClef(measures, mi, voiceIndex, eventIndex, partClef)` を新設し、
    声部2は描画と同じ「先行イベントの拍数→resolveClefAtBeat」で解決する
    （voiceIndex=0 は従来の resolveEventClef と同値）
  - 表示用パディング休符が「声部の最後のイベント開始時点」のクレフで固定されていたため、
    声部2が途中変更より前に終わる小節では残りの拍の休符が旧クレフ基準だった。
    buildTrailingRestEventsForBeats が休符を先頭から順に問い合わせる性質を使い、
    開始拍カーソルを進めながら各休符自身の拍でクレフを解決する
- **ScorePage 実マウント統合テスト**: ScorePageMidMeasureClef.test.tsx を新設
  （演奏記号タブ→ツール→音符クリック→ヘ音選択→保存データの clefChange・
  小型クレフ（20pt text）の DOM 表示まで実経路で固定）
- **#318（updater 内の無言 return）**: handleClefConfirm のイベント経路は、updater の
  外で対象の存在を事前判定し、消えていれば describeMidMeasureClefUnavailable('noEvent')
  を通知して閉じる。updater 内に残る範囲外ガードは並行更新との競合に対する純粋な防御で、
  updater 内からは通知できない（StrictMode の2回呼びで二重通知になる）ため黙って prev を
  返す旨をコメントに明記
- **保存バリデーションの回帰テスト**: storage.test.ts に「clefChange の保存・読込保持
  （未指定の音符にプロパティが生えない）」「未知の値（'ophicleide'）は保存拒否」を追加
