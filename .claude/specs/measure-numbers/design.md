# 小節番号（通し番号）表示の実装

## 背景（Issue #30）

小節番号が譜面上に表示されず、合奏練習で「◯小節目から」という指示ができない、という
Issue #30 の課題に対応した。浄書慣習では「各システム（段）の先頭小節の上、最上段の
五線左上に、絶対通し番号を小さく表示する。ただし第1小節（曲頭）には表示しない」
という表示ルールになっているため、これに合わせて実装した。

## 設計

### 1. なぜ「段の先頭かどうか」の判定だけで足りるか

`PianoSystemCanvas.tsx` は「1回の呼び出しで1段（システム）だけ描く」設計になっており、
`SingleStaff` / `PianoStaff` / `PartExtractionStaff`（＝単旋律・ピアノ大譜表・弦楽四重奏・
編成譜のすべて）が、段ごとに `startMeasureIndex`（その段の先頭小節の絶対インデックス、
0始まり）を渡して1段ずつループ呼び出しする、共通のパターンに揃っている
（詳細は `.claude/specs/staffcanvas-pianosystemcanvas-shared-logic/design.md`）。

このため、`PianoSystemCanvas` 内部のループ変数 `i`（その段の中での小節オフセット、
0始まり）が `0` のとき＝その段の先頭小節であり、絶対小節番号は
`startMeasureIndex + 1`（1始まり表記）になる。曲頭かどうかは `startMeasureIndex === 0`
で判定できる。全譜種が同じ `PianoSystemCanvas` を経由するため、譜種ごとに個別実装する
必要がなく、`PianoSystemCanvas.tsx` 側の変更だけで単旋律・ピアノ・弦楽四重奏・編成譜の
すべてに対応できる。

### 2. 描画（最上段の左上、略称パート名と同程度のスタイル）

既存の「リハーサルマーク」「途中テンポ変更（♩=XXX）」と同じく、段の先頭小節・最上段
（`pi === 0`）の情報だけを `measureNumberEntries` 配列に一旦集め（`x: x / s`,
`topY: stave.getYForLine(0)`）、全パート・全小節の描画が終わったあとにまとめて
`<text>` として直接 SVG へ描画する（同じ「段ごとに1回だけ表示する情報を集めて後で
一括描画する」既存パターンを踏襲）。

- 表示位置: 段の先頭小節（`i === 0`）の左端 x 座標、五線上端よりわずかに上
  （`topY - 6`）。既存の clef 用パディング（`CLEF_PAD_FIRST`）が既に段の先頭小節にだけ
  乗るため、この x 座標は自然にクレフの左（＝五線の左上）に収まる。
- スタイル: フォントサイズ11px・黒 (`#111827`)・`system-ui` 系フォント。
  略称パート名（`showInstrumentLabels` の描画）と同じ見た目にする、という Issue の
  要求に合わせた。
- 表示条件: `pi === 0 && i === 0 && startMeasureIndex !== 0`。
  `startMeasureIndex === 0`（曲頭のシステム）だけは番号を出さない。

### 3. 保存データ・MusicXML

保存データやMusicXML書き出しには一切関与しない、完全な表示専用機能。
既存の `startMeasureIndex` prop から導出するだけなので、`MeasureData` へのフィールド
追加は不要。段あたり小節数（自動段割り）を変えると、呼び出し側が渡す
`startMeasureIndex` 自体が変わるため、番号表示は追加のロジックなしに自動で追随する。

## 影響範囲

- `src/components/PianoSystemCanvas.tsx` のみ変更（描画ロジックの追加のみ、
  Props の追加なし）。
- `SingleStaff.tsx` / `PianoStaff.tsx` / `PartExtractionStaff.tsx` /
  `ScorePage.tsx` は無変更（既存の `startMeasureIndex` の渡し方をそのまま利用）。
- 印刷（`@media print`）にも同じ SVG 描画がそのまま出力されるため、追加対応不要。

## テスト

`src/components/PianoSystemCanvasMeasureNumber.test.tsx`:

- 曲頭のシステム（`startMeasureIndex=0`）では番号を表示しない
- 2システム目（`startMeasureIndex=4`）の先頭に絶対番号「5」を表示する
- 段あたり小節数を変えても（`measuresPerSystem=3`, `startMeasureIndex=3` →「4」）
  番号が正しく追随する
- 複数パート（大譜表）でも番号は最上段に1回だけ表示される
