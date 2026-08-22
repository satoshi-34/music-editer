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

## 編集可否（初版）: 閲覧・印刷専用（編集は無効）

> **注**: この節は初版の設計判断の記録。Issue #111（下記「パート譜表示中の直接編集」）で、
> 音符の入力・削除にかぎり編集を許す方向へ変更した。

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

## パート譜表示中の直接編集（Issue #111・第1段階）

### 問題

パート譜表示中は音符を編集できず、総譜へ戻らないと直せなかった。パート譜を確認しながらの
修正ができず、「見ながら直す」という自然な作業ができない。

### 決着した設計判断

初版で「実装前に決める必要がある」としていた3点は、調査の結果それぞれ次のように決まった。

| 論点 | 決定 |
| --- | --- |
| 編集結果の書き戻し先 | 総譜と同じデータを共有する（パート譜は総譜の派生ビューで、別データを持たない） |
| 移調楽器の扱い | **記譜音→実音の逆変換は既に実装済み**だったため、それを共通関数へ切り出して両方から呼ぶ。新規実装はしない |
| 大譜表パート（`staffCount: 2`） | 第1段階では対象外（従来どおり閲覧専用）。上下どちらの段を編集しているかを上位へ伝える経路が別途必要で、Issue #107 と同じ「片方の段の保存が漏れる」事故を踏みやすい |

### 修正設計

**1. 保存前の変換を共通関数へ切り出した**

`EnsembleStaff.tsx` の中でその場で組み立てられていた `wrappedChange` を、
`src/utils/displayTransposeUtils.ts` の `createDisplayTransposeBridge()` として切り出した。

```ts
const { displayMeasures, handleDisplayChange } =
  createDisplayTransposeBridge(rawMeasures, upstreamChange, semitones);
```

表示（実音 → 記譜音・`+semitones`）と保存（記譜音 → 実音・`-semitones`）は必ず対で必要なので、
**2方向をひとつの関数で同時に作る**形にしている。片方だけ書き換えて対を崩す事故を、
関数の形そのもので防ぐのが狙い。`semitones === 0` のときは配列も関数も作り直さず、
渡されたものをそのまま返す（React の再描画を無駄に増やさないため）。

呼び出し元は次の3か所で、同じロジックはどこにも重複していない。

- `EnsembleStaff`: 各パートの1段目
- `EnsembleStaff`: 大譜表パートの2段目
- `PartExtractionStaff`: パート譜（弦楽四重奏。移調楽器を含まないため実際の半音差は常に 0 だが、経路は共通化してある）

**2. `PartExtractionStaff` の `onChange` を繋いだ**

`NOOP_ON_CHANGE` 固定をやめ、`onChange` / `disabled` / `transpositionSemitones` を props で受け取る。
`onChange` を渡さなければ従来どおり閲覧・印刷専用として振る舞う（後方互換）。

**3. 編集を許すパートの線引きは純粋関数に切り出した**

`partExtractionUtils.ts` の `isPartExtractionEditable(scoreType, part)` が判定する
（弦楽四重奏=可、編成譜は `staffCount !== 2` のときだけ可、パート定義が引けないときは安全側の不可）。
`ScorePage` はこの結果を `disabled` と `onChange` の両方へ渡し、ヘッダーの
「（閲覧・印刷専用）」表示も同じ判定に従わせている（UI と実際の可否が食い違わないようにするため）。

再生中・印刷プレビュー中の禁止は従来どおり `isScoreEditingLocked` が担う
（`disabled={!編集可 || isScoreEditingLocked}`）。書き戻し先の
`handleEnsemblePartChange` / `handleQuartetPartChange` 自身も冒頭で
`isScoreEditingLocked` を見ているため、二重に守られている。

### 影響範囲

- `src/utils/displayTransposeUtils.ts`: `createDisplayTransposeBridge()` を追加
- `src/utils/partExtractionUtils.ts`: `isPartExtractionEditable()` を追加
- `src/components/EnsembleStaff.tsx`: 内製の `wrappedChange` を共通関数へ置き換え（挙動は同一）
- `src/components/PartExtractionStaff.tsx`: `onChange` / `disabled` / `transpositionSemitones` を追加
- `src/components/ScorePage.tsx`: パート譜描画へ実際の変更ハンドラを渡す・ヘッダー表示の条件化
- テスト: `displayTransposeUtils.test.ts`（往復）・`partExtractionUtils.test.ts`（線引き）・
  `PartScoreEditing.test.tsx`（クリックして入力するところまでの結合テスト）

### なぜ往復テストを必須にしたか

移調の変換は**壊れても画面上は正しく見え、再生か印刷まで気づけない**。
そのため「B♭管のパート譜に記譜音で音符を置いたら、保存される実音は長2度下になる」ことを
テストで機械的に固定している。異名同音（`bb/3` と `a#/3`）で綴りが変わりうるので、
比較は文字列ではなく `keyToMidi()` の値で行う。

### 第2段階以降

- 記号・アーティキュレーションの編集 — **第2段階で実装済み**（Issue #173・2026-08-22。下記「第2段階の実装記録」参照）
- パート譜固有のレイアウト（改行位置など） — 未実装（第3段階・Issue #174）
- 大譜表パート（`staffCount: 2`）の編集 — 未実装

## 既知の制限

- 単旋律譜・ピアノ大譜表ではパート譜表示は選択できない（対象外）
- パート譜表示中に編集できるのは音符の入力・削除と記号・アーティキュレーション
  （第1・第2段階）。パート譜固有のレイアウトは第3段階（Issue #174）
- 大譜表パート（`staffCount: 2`）のパート譜は閲覧・印刷専用のまま
- パート譜表示は保存されない（一時的なビュー）

## 第2段階の実装記録（Issue #173・2026-08-22）

仕様は Issue #173 のコメント（2026-08-22 の調査結果と仕様案）を正本とする。

### 調査で分かったこと

- 第1段階の「記号は対象外」は実装上のブロックではなく**スコープ宣言（未検証）**だった。
  パート譜も総譜と同じ PianoSystemCanvas の音符クリック分岐・ドラッグ経路を通るため、
  記号系ツールは構造的には最初から流れていた
- 記譜音モードの音高変換は createDisplayTransposeBridge が keys / arcs / graceNotes /
  voices まで双方向対応済み（#244 段5-1）で、音高に紐づく記号編集も往復が成立する
- 調査の副産物として、**アーティキュレーションツールの適用ケースが StaffCanvas 廃止時に
  移植漏れしていた回帰**（総譜含む全譜種）を発見 → PR #370 で先に復旧

### 実装（本段の変更）

- **配線漏れの解消**: PartExtractionStaff（四重奏のパート譜）へ `symbolsClickable` と
  `isPrintPreview` を追加し ScorePage から総譜と同じ条件で渡す
  （編成譜のパート譜＝EnsembleStaff 経由は元から渡っていた）
- **受入条件のテスト固定**（PartExtractionStaffSymbols.test.tsx 4件）:
  記譜音（+2）でのスタッカート付与＝実音不変（keyToMidi 比較）/ 臨時記号♯＝実音+1 /
  強弱の書き戻し / symbolsClickable の pointer-events 切替。
  jsdom は getBBox が無く記号ヒット rect が生成されないため、固定値モックで代用
- README のパート譜の記述・既知の制限を更新

### 対象外のまま（変更なし）

- パート譜固有のレイアウト調整（第3段階・#174）
- 大譜表パート（staffCount:2）の編集
