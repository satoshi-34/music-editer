# 途中調号変更（小節単位の調号変更）の実装

## 背景

すでに「途中テンポ変更」（`MeasureData.bpm`）と「途中拍子変更」
（`MeasureData.timeSignature`）は小節単位で実装済みで、
パレットの専用ツール→小節クリック→オーバーレイでの選択、というパターンが
確立している（`.claude/specs/time-signature-and-ending-implementation/design.md` 参照）。

一方、調号（`SavedScoreData.keySignature`）は楽譜全体で 1 つに固定されており、
「ト長調で始まり、途中からヘ長調に転調する」ような楽曲を表現できなかった。

## 設計

### 1. データ型

`MeasureData` に `keySignature?: KeySignature` を追加した（`src/types/storage.ts`）。

- 省略時は「直前の小節の調号」または「楽譜全体のグローバル調号」を継続する
  （bpm / timeSignature と同じ継承セマンティクス）。
- バリデーションは既存の `isValidKeySignature` を再利用し、
  `validateMeasureData`（`src/utils/storage.ts`）に条件を追加した。
  未知の値が入った保存データは無効として読み込みを拒否する。

### 2. 有効調号の解決ヘルパー

`src/utils/keySignatureMeasureUtils.ts` に
`resolveMeasureKeySignature(measures, index, globalKeySignature)` を新設した。

- 指定小節までを先頭から走査し、最後に見つかった `keySignature` を返す。
  どの小節にも指定がなければグローバル調号を返す。
- 段頭の調号表示、新規音符入力時の既定の♯/♭付与、MusicXML 書き出しの
  「調号が変わった小節だけ `<key>` を出力する」判定など、
  「この小節時点で有効な調号は何か」を求めるあらゆる場所で共通利用する。

### 3. 入力UI（パレット）

`src/components/Palette.tsx` に「調号変更」ツール（`mode: 'measureKeySig'`）を、
既存の「拍子変更」ボタンの隣に追加した。

- 小節をクリックすると、既存の `KEY_SIGNATURE_OPTIONS`（15種類の調号）を
  そのまま使ったドロップダウンオーバーレイが開く。
- 選択するとその小節から調号変更、「（解除）」を選ぶとその小節の指定を外す
  （直前の小節の調号を継続する状態に戻る）。
- 単旋律譜（`StaffCanvas.tsx`）・編成譜（`PianoSystemCanvas.tsx`）の両方に、
  拍子変更と全く同じ「オーバーレイ state → confirm 関数 → JSX」のパターンで実装した。

### 4. 描画（単旋律譜: StaffCanvas.tsx）

- 段ごとの描画ループの外側で `effectiveKeySig` を追跡する変数を宣言し、
  各小節の `MeasureData.keySignature` があれば更新しながらループする
  （`effectiveTimeSig` と同じパターン）。
- 段の先頭小節では「その段の先頭時点で有効な調号」を `stave.addKeySignature()` で表示する。
- 段の途中の小節で調号が変わった場合も、その小節の頭に調号記号を表示する。
- 臨時記号の既定状態（`createMeasureAccidentalState`）や、
  新規音符入力時の既定の♯/♭付与（`applyKeySignatureToNaturalKey`）は、
  すべてグローバル調号ではなく `effectiveKeySig`（この小節時点の有効調号）を使うよう変更した。

### 5. 描画（編成譜: PianoSystemCanvas.tsx）

編成譜では、調号は最上段（`partsScore[0]`、EnsembleStaff 経由では最初のパート）の
小節データにのみ保存する。これは `repeatStart` / `ending` などの
「見た目の基準は最上段の小節データに寄せる」既存パターンと同じ考え方で、
全パートへ複製する必要がない。

- 段の描画前に、最上段の小節データを走査して `effectiveKeySigPerMeasure`
  （段内の各小節で有効なグローバル調号の配列）を先に計算しておく。
  stave 生成ループと音符描画ループの 2 つのループが同じ段を 2 回走査するため、
  両方で同じ値を再利用できるようにするため。
- 各パートは `part.keySignature`（移調楽器の記譜音用に固定シフトされた調号、
  `EnsembleStaff.tsx` が算出）から fifths の差分（移調量）を求め、
  その差分を `effectiveKeySigPerMeasure` にも適用することで
  「途中調号変更後の記譜音」も正しく計算されるようにした。
  これにより既存の「調号の五度圏シフト」ロジック（`shiftKeySignatureByFifths`）が
  小節単位調号にもそのまま適用される。
- `getKeySignatureFifths()`（`src/utils/noteKeyUtils.ts` に追加）で
  調号→fifths を取得できるようにし、上記の差分計算に使った。

### 6. 段の途中で描画を開始するケース

`StaffCanvas` は改ページ等で「楽譜全体の途中の小節から描画を始める」ケースがあるため、
`effectiveKeySig` の初期値は `resolveMeasureKeySignature(score, startMeasureIndex - 1, ...)` で
「その StaffCanvas が描画を始める直前の小節までの有効調号」を先に解決してから使う
（`effectiveTimeSig` は現状この対応をしていないため、実質的に途中拍子変更より
堅牢な初期化になっている）。

### 7. VexFlow の調号キャンセル表示について

VexFlow の `KeySignature` クラスには `cancelKeySpec` を渡す静的コンストラクタ
（`Vex.Flow.KeySignature.getUnaltered` ではなく `addKeySignature` 呼び出し時に
cancel 用の第2引数を渡す形）があるが、`Stave.addKeySignature(keySpec)` の
シンプルな API では旧調号のナチュラルキャンセルは自動生成されない。
`node_modules/vexflow` を確認したところ、`Stave` 経由でキャンセル付き表示をするには
`StaveModifier` を手動で組み立てる必要があり、既存の拍子変更・テンポ変更と
同程度の実装コストに収めるため、**今回はキャンセル（ナチュラル）表示なしの
シンプルな調号記号表示のみとした**。実用上、調号が変わったことは記号自体で
判別できるため大きな支障はないと判断した。

### 8. MusicXML 入出力

- 書き出し（`src/utils/musicXmlExport.ts`）: パートごとに「現在有効な fifths」を
  追跡しながら小節を出力し、直前の小節と異なるときだけ `<attributes><key>` を出力する
  （既存の拍子変更の `timeSigChanged` 判定と同じパターンを `keyChanged` として追加）。
- 読み込み（`src/utils/musicXmlImport.ts`）: 2小節目以降で `<key><fifths>` を持つ小節は
  `MeasureData.keySignature` として復元する（1小節目はグローバル調号として別に扱う）。
  実装時、`measureEl.querySelector('attributes key fifths')` という3階層の
  子孫セレクタが XML ドキュメントでは要素を見つけられない現象があったため、
  `measureEl.querySelector('key fifths')` に変更して解決した
  （jsdom の XML パーサでの descendant combinator の挙動差と見られる）。

## 影響範囲

- `src/types/storage.ts`: `MeasureData.keySignature` 追加
- `src/utils/storage.ts`: `validateMeasureData` に `keySignature` の検証を追加
- `src/utils/keySignatureMeasureUtils.ts`: 新規。`resolveMeasureKeySignature`
- `src/utils/noteKeyUtils.ts`: `getKeySignatureFifths` を追加
- `src/components/Palette.tsx`: `measureKeySig` ツール追加
- `src/components/StaffCanvas.tsx`: `effectiveKeySig` 追跡、オーバーレイ、
  臨時記号・入力補助の解決元変更
- `src/components/PianoSystemCanvas.tsx`: `effectiveKeySigPerMeasure` 追跡、
  オーバーレイ、パート移調シフトの適用
- `src/utils/musicXmlExport.ts` / `src/utils/musicXmlImport.ts`: 小節単位の
  `<key>` 出力・読み込み

## テスト

- `src/utils/keySignatureMeasureUtils.test.ts`: 有効調号の解決ロジック
- `src/utils/storage.test.ts`: 小節単位 `keySignature` の保存・読込・
  不正値バリデーション
- `src/utils/musicXmlKeySignature.test.ts`: MusicXML 書き出し（変更小節だけ
  `<key>` が出る）と往復（export → import で復元される）

`npm test`（Docker経由）は既存の `BackwardCompatibility.test.tsx` の
2件の失敗（パレットのボタン数期待値が古いままの既知の main 由来の問題）を除き、
すべて成功した。

## 現状の制限

- VexFlow 側の制約により、調号変更時の「旧調号のナチュラルキャンセル表示」は
  実装していない（項目7参照）。単純な調号記号の切り替え表示のみ。
- 編成譜での調号は最上段の小節データに保存する仕様のため、
  パートごとに異なるタイミングで調号を変える、といった使い方はサポートしない
  （実際の合奏譜でも通常は全パート同時に転調するため、実用上は問題ないと判断）。
