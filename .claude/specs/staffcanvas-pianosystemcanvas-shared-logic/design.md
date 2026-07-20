# StaffCanvas / PianoSystemCanvas 共通ロジック抽出 設計メモ

## 問題

`StaffCanvas.tsx`（単旋律譜）と `PianoSystemCanvas.tsx`（多段譜。ピアノ・弦楽四重奏・
編成譜・パート譜抽出で共通利用）は、音符編集の操作仕様（Delete キーでの削除、
↑↓キーでの音高シフト、各種オーバーレイの確定処理など）がほぼ完全に一致しているにも
関わらず、それぞれ独立にコピー実装されていた。

このため、片方のコンポーネントだけ仕様変更・バグ修正をして、もう片方に反映し忘れる
という事故が起きやすい状態だった（実際、過去に PianoSystemCanvas のライン⇄キー変換が
テナー記号に未対応というズレが見つかっている）。

## 修正設計

### 方針

単一パートの `MeasureData[]`（または `NoteEvent` 単体）に対する「純粋な変換」として
書ける部分だけを `src/utils/` の関数へ抽出し、両コンポーネントから import して使う。

- setState の呼び出し方（`StaffCanvas` の `setScore` は単一パート、
  `PianoSystemCanvas` の `setPartsScore` は「全パート共有」「最上段のみ」
  「クリックした該当パートのみ」と項目ごとに書き分けている）は、パートの持ち方が
  構造的に異なるため、コンポーネント側に残す。
- `NoteEvent` 型は `StaffCanvas`（`src/types/storage.ts` のグローバル型）と
  `PianoSystemCanvas`（ファイル内ローカル定義）とで別々に定義されているため、
  型そのものは統合せず、各ユーティリティが実際に読み書きするフィールドだけを
  満たす最小構造型（またはジェネリクス）を制約として使う
  （`accidentalUtils.ts` の `AccidentalEditableEvent` が最初の前例）。

### 抽出した関数群

| ファイル | 関数 | 抽出元の処理 |
|---|---|---|
| `src/utils/noteDeletionUtils.ts` | `deleteEventFromMeasures` | Delete キーでの音符削除。連符（tuplet）内イベントはグループごと休符に置換、和音は keyIndex 指定でその1音だけ削除しつつ関連 arc を除去、単音削除時は arc/hairpin の終点インデックスを除去・繰り上げる |
| `src/utils/pitchShiftUtils.ts` | `computeShiftedKeys` / `applyPitchChangeToMeasures` | ↑↓キーでの音高シフト（休符=ライン移動のみ、Shift=オクターブ、Alt=半音、無修飾=1ライン）と、音高変更後の arc fromKey/toKey 追従。line⇄key はクレフ依存のため、呼び出し側が用意した `lineToKey`/`keyToLine` を引数で受け取る |
| `src/utils/measureMetaInputUtils.ts` | `parseTimeSignatureInput` 他6関数 | 各種オーバーレイ（拍子・BPM・リハーサルマーク・クレフ・調号・記号サイズ/位置）の確定ハンドラにあった、setState 前段の入力パース・検証ロジック |

（`noteMidiUtils.ts`・`accidentalUtils.ts`・`staveModifierLayoutUtils.ts` は本フェーズ以前の
既存共通化。合わせて「共通ロジックは `src/utils/` に集約する」という方針の一部）

## 影響範囲

- `src/components/StaffCanvas.tsx` / `src/components/PianoSystemCanvas.tsx` の
  keydown ハンドラ（Delete・ArrowUp/ArrowDown）と各種 Confirm ハンドラの内部実装のみ変更。
  props・描画結果・外部から見た挙動は変えていない。
- PianoSystemCanvas の声部2（下声、`voiceIndex`）向け Delete 分岐は Piano 固有の
  `voices` 構造を扱うため対象外（コンポーネント側に残置）。
- `openSymbolAdjustEditor` の setState 部分、および各 Confirm ハンドラの setState 部分
  （`setScore` vs `setPartsScore` の書き分け）は、本フェーズでは意図的に統合していない
  （フェーズ2で PianoSystemCanvas への一本化を検討する際にまとめて扱う想定。該当箇所には
  `// TODO(phase2)` コメントを追加済み）。
- 追加テスト: `noteDeletionUtils.test.ts`（9件）、`pitchShiftUtils.test.ts`（12件）、
  `measureMetaInputUtils.test.ts`（20件）。既存テストの挙動変更は無し（全件通過を確認）。

## フェーズ2との関係

`docs/phase2-staffcanvas-retirement-feasibility.md` に、StaffCanvas を退役させて
単旋律譜も `PianoSystemCanvas`（`partsConfig` 要素数1）に統一する構想の実現可能性メモを
別途まとめた。今回の共通化はその前段階として、まず「ロジックだけ」を一本化したもの。

## 追記: 歌詞（lyrics）描画の PianoSystemCanvas 対応

前掲のフェーズ2メモで「ブロッカー級」としていた、歌詞が `PianoSystemCanvas` に
未実装だった問題を解消した。

### 問題

歌詞データ（`NoteEvent.lyrics`）の入力・保存経路（Palette の textElement ツール →
`applyTextElementToEvent`）は `PianoSystemCanvas` にも既に実装されていたが、描画側だけが
未実装で、`lyrics` への参照が一切なかった。そのため多段譜（ピアノ大譜表・弦楽四重奏・
編成譜）に切り替えると、歌詞を入力しても画面に表示されない状態だった。

### 修正設計

- `StaffCanvas.tsx` にあった「歌詞1件を SVG に描く」処理（座標: 音符中心X、五線下端Y+54、
  スタイル: sans-serif 11px・`#374151`・通常体）を純粋関数 `drawLyricsEntry`
  （`src/utils/lyricsRenderUtils.ts`）へ切り出し、`StaffCanvas` はその関数を呼ぶだけに置き換えた。
- `PianoSystemCanvas.tsx` のローカル `NoteEvent` 型に `lyrics?: string` を追加し、
  描画ループ内で `ev.lyrics` を持つイベントを `lyricsEntries` に収集、段（パート）ごとの
  五線下端（`stave.getYForLine(4)`）を基準に `drawLyricsEntry` で描画するようにした
  （StaffCanvas の `expressionMarkingEntries`/`lyricsEntries` 収集パターンを踏襲）。
  多パート譜では歌詞データを持つイベントが属する段の下に描かれるデータ駆動の実装で、
  特定パート固定にはしていない。
- クリックでの歌詞編集（textElement ツールで音符クリック→オーバーレイ→確定）は、
  `textElementMode`（`TextElementKind` 全般を汎用的に扱うクリックハンドラ）がすでに
  `'lyrics'` を含む全種別に対応していたため、追加対応は不要だった。
- サイズ・位置調整（`symbolAdjust`）も `listPresentAdjustableSymbolKinds` が
  `event.lyrics` の有無を見て自動的に調整対象へ含めるため、追加対応は不要だった。

### 影響範囲

- `src/utils/lyricsRenderUtils.ts`（新規）: `drawLyricsEntry` とその型 `LyricsRenderEntry`。
  テストは `lyricsRenderUtils.test.ts`（2件）。
- `src/components/StaffCanvas.tsx`: 歌詞描画部分を `drawLyricsEntry` の呼び出しに置き換え
  （座標計算・見た目は変更なし）。
- `src/components/PianoSystemCanvas.tsx`: `NoteEvent` 型に `lyrics` を追加、
  `lyricsEntries` の収集（アクティブ声部・非アクティブ声部の両方）と描画呼び出しを追加。
- ブラウザ確認: ピアノ大譜表・単旋律譜のそれぞれで歌詞ツールから音符クリック→入力→確定
  すると、音符の下に歌詞が表示されることを確認。コンソールエラーなし。

## 追記: applyPitchChangeToMeasures が小節メタ情報を落とすバグの修正

### 問題

`applyPitchChangeToMeasures`（`src/utils/pitchShiftUtils.ts`）の非休符分岐が
`measures.map((m) => ({ events: ... }))` と `events` だけのオブジェクトを返しており、
ArrowUp/ArrowDown で音符の音高を変更すると、**全小節**から `repeatStart` / `repeatEnd` /
`ending` / `timeSignature` / `bpm` などのメタ情報が消えていた。
これは抽出元の StaffCanvas / PianoSystemCanvas に元からあった潜在バグで、
ブラウザで「開始リピートを設定 → 音符を選択 → ArrowUp」と操作すると
リピート記号が消えることを実際に再現・確認した。

### 修正設計

- 非休符分岐の戻り値を `{ ...m, events: ... }` に変更し、小節のメタ情報を保持する
  （休符分岐は元から `...m` 付きで問題なし）。

### 影響範囲

- `src/utils/pitchShiftUtils.ts`: 1行の修正（スプレッド追加）とコメント更新。
- `pitchShiftUtils.test.ts`: 回帰テスト2件を追加（音符/休符それぞれでメタ情報が残ること）。
  全テスト（71ファイル・930件）通過を確認。
- ブラウザ確認: 開始リピートを設定した楽譜で音符を ArrowUp した後も
  リピート記号が表示され続けることを確認。コンソールエラーなし。
