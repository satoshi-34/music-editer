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
