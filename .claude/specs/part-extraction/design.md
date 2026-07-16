# パート譜の抽出 設計書

## 背景・問題

README ロードマップ「パート譜の抽出」に対応する。編成譜（オーケストラ等）・弦楽四重奏で、
1パートだけを抜き出した譜面を表示・印刷し、合奏練習で奏者に配れるようにしたい。

## 方針: 表示モード方式（データ非破壊）

新しい譜面データを作らず、「パート譜表示モード」という一時的な表示切替を追加した。

- 元データ（`quartetParts` / `ensembleParts`）はそのまま総譜として保持し続ける
- `ScorePage` に `partExtractionId: string | null` という React state を追加し、選択中パートの
  ID を持つ。`null` は「総譜（通常）表示」
- 保存データ（`SavedScoreData` / `buildCurrentScoreData`）には一切含めない。リロード・保存/読込を
  すると必ず総譜表示（`null`）に戻る、完全に一時的なビュー

対象は **弦楽四重奏 (`quartet`) と編成譜 (`ensemble`)** のみ。単旋律譜・ピアノ大譜表はもともと
1〜2段しかなく「1パートだけ抜き出す」意味が薄いため対象外とした
（`getPartExtractionOptions()` がこれらの scoreType では空配列を返し、UI にも選択肢を出さない）。

## パート絞り込みロジック（純粋関数）

`src/utils/partExtractionUtils.ts` に切り出し、ユニットテスト
（`partExtractionUtils.test.ts`）でカバーしている。

- `getPartExtractionOptions(scoreType, instrumentationParts)`: 選択肢一覧
  (`{ id, label, index }[]`) を作る。`quartet` は固定4パート
  （`violin-1/violin-2/viola/cello` = Violin I/Violin II/Viola/Cello）、
  `ensemble` は `instrumentation.parts` の順序・ID・`name` をそのまま使う
- `resolvePartExtractionSelection(options, selectedId)`: 選択中 ID から選択肢を解決する。
  見つからない場合（楽譜種別切り替えでID自体が変わった、パート削除で消えた等）は `null`
  （＝総譜表示）を返す安全側の実装

`scoreType` 切り替え・編成テンプレート切り替え時は `partExtractionId` を明示的に `null` へ戻す
（`handleScoreTypeChange` / `handleInstrumentationPresetChange`）。パートの追加・削除・並び替え・
フィールド編集（`updateInstrumentationParts` 系）は ID を維持するため、明示リセットは不要
（並び替えても同じ ID を追い続けられ、削除されたときだけ `resolvePartExtractionSelection` が
自然に `null` を返す）。

## 描画方式: 案A（既存コンポーネントへ配列を絞って渡す）を可能な限り採用

実装前に「編成譜の描画パスをそのまま流用できるか」を精読して判断した。

### 編成譜 (`ensemble`): 案Aがそのまま使えた

`EnsembleStaff` は `instrumentationParts.map(...)` で `partsConfig` を生成しており、
**配列の長さに依存しない**実装だった。そのため

```tsx
<EnsembleStaff
  instrumentationParts={[instrumentation.parts[selectedIndex]]}
  partsData={[ensembleParts[selectedIndex] ?? []]}
  onPartChange={[() => {}]}
  disabled
  ...
/>
```

とするだけで、要素数1の単一五線・括弧なしの描画になる。移調楽器の記譜音表示・調号シフト・
テンポ/拍子/クレフの途中変更など、`EnsembleStaff` 内部のロジックをすべてそのまま継承できるため、
このケースは新規コンポーネントを作らずに対応した。

### 弦楽四重奏 (`quartet`): 案Aが使えず、案Bに近い専用コンポーネントを追加

`QuartetStaff` は `QUARTET_PART_CONFIGS`（Vn.I/Vn.II/Va./Vc. の固定4要素配列）を
`.map()` して常に4段ぶんの `partsConfig` を作る実装だったため、`partsData` だけを
要素数1に絞っても「4段のうち1段だけデータがあり、残り3段は空欄のまま描画される」状態になり
使えなかった（QuartetStaff 自体を可変長化する改修は影響範囲が広いため見送った）。

そのため、単一パート専用の `src/components/PartExtractionStaff.tsx` を新規追加した。
中身は `QuartetStaff`/`EnsembleStaff` と同様に `PianoSystemCanvas` を段数ぶんループで呼ぶだけの
薄いラッパーで、`partsConfig` を要素数1で渡す。`QuartetStaff.tsx` の `QUARTET_PART_CONFIGS`
（clef・ラベル・再生楽器の定義）を `export` して共有し、定義の重複を避けた。

## 編集可否: 閲覧・印刷専用（編集は無効）

パート譜表示中は **常に編集不可**にした（`disabled` を強制的に `true` にし、`onPartChange` /
`onChange` は no-op）。

理由: パート譜表示中の編集を許可するには、「絞り込んだ1パートの小節データへの変更を、
表示モードを抜けたあとも元の `quartetParts[index]` / `ensembleParts[index]` に正しく書き戻す」
経路が必要になる。今回は `partsData`/`onPartChange` を配列ごと絞り込んで渡しているため
`onPartChange={[() => {}]}` を差し替えるだけで本来は書き戻し自体は可能だが、Undo/Redo の
スナップショット、コピー＆ペースト、声部関連の状態など「総譜編集時に前提としている
全パート分のデータ形」との整合性検証が広範囲に及びリスクが高いため、今回は
閲覧・印刷専用として実装した。ヘッダーに「パート譜: ○○（閲覧・印刷専用）」と明示し、
UI 上も分かるようにしている。

## 印刷

既存の `@media print` によるブラウザ印刷レイアウトをそのまま利用する。`PartExtractionStaff` /
絞り込んだ `EnsembleStaff` はどちらも既存の `PianoSystemCanvas` を段数分ループで呼ぶだけの
薄いラッパーであり、`ScorePage` 側の `ScaledPageWrapper` / 共有ページ高さ計算（`sharedPageHeight`）
のロジックには一切手を入れていないため、1パート表示でも既存のページ割り・高さ統一処理が
そのまま機能する。

## 再生: 選択中パートだけ再生する

`handlePlay` 内の「scoreType ごとに再生対象パート配列を組み立てる」処理に、パート譜表示中は
選択中パート以外を `forEach` の途中で `return` して除外する分岐を追加した（実装コストが低く、
むしろ「そのパートだけ聴きたい」という利用シーンに合っているため、当初の設計方針
「重ければ総譜再生のままでも可」からは踏み込んで対応した）。総譜表示に戻せば従来通り
全パート再生に戻る。

## 保存

`buildCurrentScoreData()` は `partExtractionId` を一切参照しない。保存データには含まれず、
保存・読込・エクスポート（MusicXML/MIDI）はすべて総譜のまま行われる。

## 変更ファイル

- `src/utils/partExtractionUtils.ts`（新規）: パート絞り込みの純粋関数
- `src/utils/partExtractionUtils.test.ts`（新規）: 上記のユニットテスト
- `src/components/PartExtractionStaff.tsx`（新規）: 弦楽四重奏の単一パート描画用ラッパー
- `src/components/QuartetStaff.tsx`: `QUARTET_PART_CONFIGS` を `export`
- `src/components/ScorePage.tsx`: 表示モードの state・選択肢計算・ツールバーのセレクト・
  ヘッダーのパート名表示・描画分岐・再生時のパート絞り込みを追加

## 既知の制限

- 単旋律譜・ピアノ大譜表ではパート譜表示は選択できない（対象外）
- パート譜表示中は編集不可（閲覧・印刷専用）
- パート譜表示は保存されない（一時的なビュー）
