# フェーズ2: StaffCanvas 退役の実現可能性メモ

このメモは実装計画ではなく、「単旋律譜も `PianoSystemCanvas`（`partsConfig` 要素数1）に
寄せて `StaffCanvas.tsx` を退役させられるか」を検討するための下調べ。

## 根拠: 既に前例がある

`src/components/PartExtractionStaff.tsx` は、パート譜抽出画面の単一パート譜を
`StaffCanvas` ではなく `PianoSystemCanvas` に `partsConfig` 要素数1で渡すことで
実現している（`括弧なし・単一五線のパート譜`）。つまり
「`PianoSystemCanvas` を1パートで使う」こと自体は既に実運用がある。

これが成立するなら、通常の単旋律譜編集（現在 `StaffCanvas` が担当）も同じ形へ
寄せられる可能性がある。

## 移行障害リスト（StaffCanvas にあって PianoSystemCanvas に無いもの）

実際にコードを確認して洗い出した差分。

### ブロッカー級（解消済み）

1. **歌詞（lyrics）が PianoSystemCanvas に未実装 → 対応済み**
   `StaffCanvas.tsx` は `NoteEvent.lyrics` を読み、`lyricsEntries` として各音符の下に
   歌詞テキストを描画していたが、`PianoSystemCanvas.tsx` には `lyrics` への参照が
   一切無く、多段譜に切り替えると歌詞が表示されない状態だった。
   座標計算・描画ロジックを `drawLyricsEntry`（`src/utils/lyricsRenderUtils.ts`）へ
   共通化した上で `PianoSystemCanvas.tsx` にも歌詞データの収集・描画を実装した。
   ただし表示位置は単旋律譜・多段譜で異なる仕様になっている。単旋律譜
   （`StaffCanvas`）は従来どおり五線の下（`botY + 54`）に表示するのに対し、
   多段譜（`PianoSystemCanvas`）は仕様変更により歌詞を持つ音符が属する段の
   **五線の上**（`staveTopY - 26` の統一高さ、`placement: 'above'`）に表示される。
   ピアノ大譜表なら右手に付けた歌詞は右手譜表の上、左手に付けた歌詞は左手譜表の上に
   出る。いずれもデータ駆動の実装で、歌詞を持つイベントが属する段に描かれるため
   特定パート固定にはならない。テキスト編集オーバーレイを
   開くクリック判定・`symbolAdjust`（サイズ・位置調整）は既存の汎用実装
   （`textElementMode` / `listPresentAdjustableSymbolKinds`）がそのまま対応しており、
   追加の分岐は不要だった。詳細は `.claude/specs/staffcanvas-pianosystemcanvas-shared-logic/design.md`
   を参照。

2. **レイアウトAPIの違い（`systems`/`gap`/`initialScoreData` vs `partsConfig`）**
   `StaffCanvas` は `systems`（段数）・`gap`（段間隔）・`initialScoreData`/
   `onScoreDataChange`（フラットな `MeasureData[]`）という「1つの五線を複数段に
   折り返す」レイアウトAPIを持つ。`PianoSystemCanvas` は `partsConfig`/各パートの
   `data`/`onChange` を中心にしたAPIで、単一の「段数」概念を直接は持たない。
   `PartExtractionStaff` がこのギャップをどう吸収しているか（折り返し・段数計算を
   どちらが担っているか）を精査した上で、アダプター層が必要かどうかを判断する。

### 軽微（型の違い程度）

3. `timeSignature` の型が `TimeSignature`（StaffCanvas）と `[number, number]`
   （PianoSystemCanvas）で異なる。実体は同じ形なので変換のみで対応可能。
4. `onKeySignatureChange` のコールバック引数に `partIndex` が増える
   （PianoSystemCanvas）。オプショナルなので後方互換だが、呼び出し元での意味づけを
   検討する必要がある。
5. `onPreviewNoteEvent` のコールバック引数に `instrument` が増える
   （PianoSystemCanvas）。同上。

### 差分なし（確認済み）

- 装飾音・オーナメント（`applyOrnamentToEvent`、`GraceNoteGroup` 等）は両方に実装済みで
  挙動も一致している。
- テキスト要素（`textElementUtils`）・リハーサルマーク・テンポ入力は両方に実装済み。
- キー入力（Delete・↑↓）は今回のリファクタで `src/utils/noteDeletionUtils.ts` /
  `src/utils/pitchShiftUtils.ts` に共通化済み。

## 今回スコープ外にした統合ポイント（TODO(phase2) コメントを追加済み）

以下は「ロジックは似ているが setState の書き分けが構造的に異なる」または
「今回の抽出対象に含めなかった」箇所。フェーズ2で PianoSystemCanvas への統合を
本格検討する際にまとめて扱う想定で、該当箇所のコメントに `TODO(phase2)` を付けた。

- `openSymbolAdjustEditor`（カスタム記号・標準記号のサイズ/位置調整オーバーレイを開く処理）
- 各 Confirm ハンドラの setState 部分（`setScore` 単一パート vs `setPartsScore` の
  全パート共有/最上段のみ/該当パートのみの書き分け）

## 結論（現時点の暫定判断）

- 「ロジック共通化」フェーズ（本コミット群）は完了。**歌詞のPianoSystemCanvas対応も
  完了し、ブロッカー級の項目は解消済み**（上記1参照）。
- 残るブロッカーはレイアウトAPIの違い（`systems`/`gap`/`initialScoreData` vs
  `partsConfig`）のみ。影響範囲が大きく（既存の保存データ・呼び出し元の props
  すべてに関わる）、次に着手するならここが本丸になる。
- 本格的な `StaffCanvas` 退役はこのメモの範囲を超えるため、着手する場合は
  別途 `.claude/specs/` に独立した設計ドキュメントを起こすこと。
