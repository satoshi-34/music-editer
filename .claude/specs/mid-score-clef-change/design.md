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
