# カスタム記号の多段譜対応 設計書

## 問題

カスタム記号（記号エディタでユーザーが自作した奏法記号。`NoteEvent.customSymbols[]` =
`{ symbolId, scale?, offsetX?, offsetY? }`、記号の形は `customSymbolDefs`（記号定義）に持つ）は、
単旋律譜を描く `src/components/StaffCanvas.tsx` にのみ実装されていた。
ピアノ大譜表・弦楽四重奏・編成譜を描く `src/components/PianoSystemCanvas.tsx` では
表示も付与も未対応で、README にも既知の制限として明記されていた。

データ形式（`NoteEvent.customSymbols` / `CustomSymbolDef`）は両キャンバス共通なので、
描画とインタラクションのロジックを PianoSystemCanvas 側へ移植すれば対応できる。

## 調査で分かったこと

### StaffCanvas 側の実装（移植元）

- **付与・除去**: カスタム記号ツール選択中に音符をクリックすると
  `applyCustomSymbolToEvent(event, symbolId)`（`src/utils/customSymbolUtils.ts`）でトグルする。
- **描画**: 音符ループの中で `customSymbolEntries` 配列に
  `{ anchorX, anchorY, symbols }` を積んでおき、全音符描画後にまとめて
  `renderCustomSymbol(def, anchorX+offsetX, anchorY+offsetY, svgRoot, scale)` を呼ぶ。
  - `anchorX` = 音符の描画X範囲の中央
  - `anchorY` = **その段の五線上端 `stave.getYForLine(0)` から 10px 上**の固定値。
    音符の符頭位置（音高）に依存させないことで、同じ段の記号は音高が違っても同じ高さに揃う。
- **サイズ調整（⤢）・位置調整（✥）**: 専用ツールモードで対象記号が付いた音符をクリックすると、
  クリック位置にインライン入力欄（オーバーレイ）を表示する。
  `symbolResizeEditState` / `symbolOffsetEditState` という state で
  「どの小節・どのイベント・どの記号IDを編集中か」と「オーバーレイの表示座標」を持つ。
  Enter で確定・Escape でキャンセル・空欄はデフォルト値（scale=1 / offset=0）、
  という他のインライン編集オーバーレイ（BPM・拍子・調号）と同じパターンに従っている。
  確定処理は `setCustomSymbolScale` / `setCustomSymbolOffset`（同じく customSymbolUtils.ts）。

### PianoSystemCanvas 側の構造

- 複数パート（右手/左手、弦楽四重奏4パート、編成譜Nパートなど）を1つのSVGにまとめて描画する。
  パートごとに独立した `stave`（VexFlow の Stave インスタンス）を持ち、
  音符描画・クリック処理はパートのループ（`parts.forEach` → 小節 → イベント）の中で行われる。
- 強弱記号・アーティキュレーション相当のクリック処理は
  `accidentalMode` / `dynamicMode` などの変数を作り、`if (xxxMode && !safeEvs[j]?.isRest) { ... return; }`
  という同じ形のブロックを積み重ねる形になっている（StaffCanvas と同じ設計思想）。
  なお PianoSystemCanvas には元々アーティキュレーション機能自体が未実装（今回のスコープ外）。
- インライン入力オーバーレイ（拍子・調号・BPM・テキスト要素）も StaffCanvas と同じ
  「state + オーバーレイ JSX + confirm 関数」のパターンを踏襲している。
  ただし PianoSystemCanvas は複数パートを持つため、state には `partIndex` を追加で持たせ、
  確定時に `setPartsScore` で該当パートの該当小節だけを更新する。
- `customSymbolDefs` を受け取るプロパティがそもそも存在せず、
  呼び出し元（PianoStaff / QuartetStaff / EnsembleStaff → ScorePage）でも配線されていなかった。
- PianoSystemCanvas 内部の `NoteEvent` 型は `types/storage.ts` の `NoteEvent` とは別に
  再定義されたローカル型（描画に使うフィールドだけを持つ簡易版）だったため、
  `customSymbols` フィールドが型定義に無く、そのままではアクセスできなかった。

## 設計方針

### 共通化した部分: `src/utils/customSymbolRenderUtils.ts`（新規）

StaffCanvas 側の見た目・挙動を変えないことを最優先し、共通化は
「描画情報の組み立て」と「実際の描画」の2点に絞った。

- `getCustomSymbolAnchorY(staveTopY)`: `staveTopY - 10` を返す。
  StaffCanvas の元の式と完全に同じにすることで、単旋律譜と多段譜で記号の高さがズレないようにする。
- `buildCustomSymbolEntry(event, anchorX, staveTopY)`: 音符1件から描画情報1件
  （`{ anchorX, anchorY, symbols }`、scale/offsetX/offsetY の既定値補完込み）を組み立てる。
  休符・プレースホルダー音符・customSymbols 無しの場合は `null` を返す。
- `drawCustomSymbolEntries(entries, customSymbolDefs, svgRoot)`: 収集済みの描画情報をまとめて
  `renderCustomSymbol`（既存の customSymbolUtils.ts）で描画する。

トグル付与・サイズ変更・位置調整のデータ操作（`applyCustomSymbolToEvent` /
`setCustomSymbolScale` / `setCustomSymbolOffset`）はそのまま customSymbolUtils.ts を両キャンバスで共用する
（元々キャンバスに依存しない純粋関数だったため、切り出し不要）。

### 共通化しなかった部分（意図的に各キャンバス側に残した）

- クリック判定・ツールモードの分岐・`setScore`/`setPartsScore` での更新: 各キャンバスの
  既存の音符クリック処理（`accidentalMode` 等と同じ並び）にそのまま追加する方が、
  他の記号系機能との一貫性を保ちやすく、StaffCanvas 側の回帰リスクも小さいため。
- インライン入力オーバーレイの JSX 自体: 単純な div+input の組み合わせで、
  StaffCanvas と PianoSystemCanvas で見た目をそろえるコピーの手間より
  共通コンポーネント化の設計コスト（overlay位置・入力欄参照・キャンセル処理の違いの吸収）が
  上回ると判断し、StaffCanvas の実装をそのまま同じパターンで複製した
  （文言・色・入力範囲は完全に同一）。

### PianoSystemCanvas 側の実装

1. **表示**: 音符描画ループ内で `buildCustomSymbolEntry(safeEvs[j], anchorX, stave.getYForLine(0))`
   を呼び、`customSymbolEntries` に積む。ループ後に `drawCustomSymbolEntries` で一括描画。
   これにより「その段（パート）の五線上端基準の統一高さ」が単旋律譜と同じ式で得られる。
2. **付与・除去**: `customSymbolMode` を追加し、`applyCustomSymbolToEvent` でトグル。
   `setPartsScore` で対象パート・小節・イベントだけ更新（他パートには影響しない）。
3. **サイズ調整・位置調整**: `symbolResizeEditState` / `symbolOffsetEditState`
   （`partIndex` を追加で持つ以外は StaffCanvas と同じ形）を新設し、
   確定時は `setPartsScore` で対象パートのみ更新する。
   StaffCanvas と同じ 25〜400% / ±100px の範囲・Enter確定・Escapeキャンセル・空欄デフォルトに対応。
4. **Undo**: 既存の `setPartsScore` 経由の更新はそのまま `ScorePage` の
   `partScore !== prevPartsScore` 差分検知 → `part.onChange` → 上流の `pushHistory` 機構に乗るため、
   追加の対応は不要（既存の強弱記号・テキスト要素と同じ経路）。

### 型の対応

- PianoSystemCanvas 内のローカル `NoteEvent` 型に
  `customSymbols?: { symbolId: string; scale?: number; offsetX?: number; offsetY?: number }[]`
  を追加した（storage.ts の定義と同じ形）。
- `customSymbolRenderUtils.ts` の `buildCustomSymbolEntry` は
  `NoteEvent & { __isPlaceholder?: boolean }` を受け取るようにした
  （StaffCanvas・PianoSystemCanvas はそれぞれ独自に `RenderNoteEvent = NoteEvent & { __isPlaceholder? }`
  を定義しており、共通ユーティリティ側でもこの拡張フィールドを扱える必要があったため）。

### プロパティの配線

`customSymbolDefs` は元々 StaffCanvas にしか渡っていなかったため、
`PianoSystemCanvas` にプロパティを追加し、ラッパーコンポーネント
`PianoStaff` / `QuartetStaff` / `EnsembleStaff` を経由して
`ScorePage` の `customSymbolDefs` state をそのまま渡すよう配線した。

## 影響範囲

- 新規: `src/utils/customSymbolRenderUtils.ts`, `src/utils/customSymbolRenderUtils.test.ts`
- 変更: `src/components/StaffCanvas.tsx`（描画部分を共通ユーティリティ呼び出しへ置き換え。
  見た目・挙動は変えていない）
- 変更: `src/components/PianoSystemCanvas.tsx`（表示・付与除去・サイズ/位置調整・プロパティ追加）
- 変更: `src/components/PianoStaff.tsx` / `QuartetStaff.tsx` / `EnsembleStaff.tsx`
  （`customSymbolDefs` プロパティの追加とバケツリレー）
- 変更: `src/components/ScorePage.tsx`（各ラッパーへの `customSymbolDefs` の受け渡し）

## 除外した機能

なし。⤢（サイズ調整）・✥（位置調整）を含め、README に記載していた制限（単旋律譜のみ対応）は
本対応で解消した。
