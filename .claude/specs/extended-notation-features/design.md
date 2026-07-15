# 拡張記譜機能の実装

## 実装した機能

### 1. 装飾音符（前打音・トリル・モルデント・プラルトリラー・ターン）

- `NoteEvent.graceNotes?: { keys: string[]; slash: boolean }[]` - アッチャカトゥーラ（スラッシュ付き）を前打音として保存
- `NoteEvent.ornament?: OrnamentType`（`'trill' | 'mordent' | 'mordentInverted' | 'turn'`） - 装飾記号。1音符につき1種類のみ（排他・トグル式）
- VexFlow の `GraceNote`, `GraceNoteGroup`, `Ornament(...)` を使用
- Palette に「前打音」「トリル」「モルデント」「プラルトリラー」「ターン」ボタンを追加（紫ボーダーでアクティブ表示）
- StaffCanvas / PianoSystemCanvas 両方で対応
- 前打音のデフォルト音高は主音符の1音上（`stepUp` 関数で計算）

#### 1-1. モルデント・プラルトリラー・ターンの追加（2026-07-16）

**背景**: 既存のトリルに加え、モルデント（下隣接音と1往復）・プラルトリラー（上隣接音と1往復）・ターンを追加する要望。

**問題**: VexFlow（SMuFL準拠）の `Ornament` コンストラクタに渡すコード文字列は、
音楽用語の慣習と逆転しており非常に紛らわしい。`node_modules/vexflow/build/esm/src/tables.js`
の `ornamentCodes` テーブルを実際に確認したところ、以下の対応だった:

```
VexFlow コード文字列   → グリフ（SMuFL glyph）        → 見た目
'mordent'              → Glyphs.ornamentShortTrill    → 波線のみ（縦線なし）
'mordentInverted'      → Glyphs.ornamentMordent        → 波線＋縦線
'turn'                 → Glyphs.ornamentTurn           → S字型
```

（グリフのコードポイントは `glyphs.js` で確認: `ornamentMordent` = U+E56D,
`ornamentShortTrill` = U+E56C, `ornamentTurn` = U+E567。これは SMuFL 標準の
"Precomposed trills and mordents" ブロックのコードポイントと一致する。）

一方、音楽記譜の慣習では：
- **モルデント**（下隣接音と1往復）＝「波線＋縦線」のグリフ
- **プラルトリラー**（上隣接音と1往復）＝「波線のみ」のグリフ

なので、このアプリの `ornament` 値と VexFlow コード文字列の対応は次のようにねじれる：

```
アプリの ornament 値                  → VexFlow コード文字列
'mordent'         （下＝モルデント）    → 'mordentInverted'（波線＋縦線グリフ）
'mordentInverted' （上＝プラルトリラー）→ 'mordent'        （波線のみグリフ）
```

**修正設計**:
- `src/types/storage.ts` に `OrnamentType = 'trill' | 'mordent' | 'mordentInverted' | 'turn'` を追加し、
  `NoteEvent.ornament` の型を `OrnamentType` に拡張（旧データの `'trill'` のみの値もそのまま有効）
- 上記のねじれた対応関係を一箇所に集約するため `src/utils/ornamentUtils.ts` を新規作成:
  - `ornamentToVexCode(type)`: アプリの ornament 値 → VexFlow コード文字列（ねじれの吸収）
  - `ornamentLabel(type)`: パレットボタンの日本語ラベル
  - `applyOrnamentToEvent(ev, type)`: トグル付け外し（同じ種類の再指定で解除、別の種類の指定で置き換え）の共通ロジック
- StaffCanvas.tsx / PianoSystemCanvas.tsx の両方で `ornamentToVexCode` を使って `new Ornament(...)` を生成する共通コードに統一
  - **PianoSystemCanvas.tsx の既存バグ修正**: 調査の結果、PianoSystemCanvas の音符生成関数（旧 `makeVFNote`）には
    そもそも前打音（`graceNotes`）・トリル（`ornament`）を描画する処理が存在しなかった
    （クリック時に `ornament: 'trill'` をデータへ保存する処理はあったが、描画側で反映されていなかった）。
    今回のモルデント等追加と合わせて、`GraceNote`/`GraceNoteGroup`/`Ornament` の描画処理を追加し、
    ピアノ譜・編成譜でも装飾記号（トリルを含む）が正しく表示されるように修正した
- Palette.tsx の `Tool` 型: `{ mode: 'trill' }` を `{ mode: 'ornament'; ornamentType: OrnamentType }` に変更し、
  トリル/モルデント/プラルトリラー/ターンの4ボタンを同じモードのバリエーションとして扱う（ペダル・オッターバと同じ「mode + サブタイプ」パターン）
- MusicXML:
  - 書き出し: `ev.ornament === 'mordent'` → `<ornaments><mordent/></ornaments>`、
    `'mordentInverted'` → `<inverted-mordent/>`、`'turn'` → `<turn/>`
    （MusicXML 側の命名は音楽用語通りで VexFlow のようなねじれはない。`<mordent/>`=下、`<inverted-mordent/>`=上）
  - 読み込み: `<mordent>` / `<inverted-mordent>` / `<turn>` 要素の有無から `ornament` を復元
- 再生: 表示のみ（トリルと同じ扱い）。装飾音を実際に鳴らす処理は未実装
- 保存/読込・Undo: 既存の `ornament` フィールドと同じ経路（`setScore` のスナップショット履歴）に乗るため追加対応不要（動作確認済み）
- テスト: `src/utils/musicXmlOrnament.test.ts` を新規作成し、以下を検証
  - 4種類の装飾記号それぞれの MusicXML 書き出し
  - 書き出し→読み込みのラウンドトリップ
  - `ornamentToVexCode` のねじれた対応関係（`mordent`→`'mordentInverted'`、`mordentInverted`→`'mordent'`）
  - `applyOrnamentToEvent` のトグル・置き換えロジック
- ブラウザ確認: dev サーバー上で単旋律譜にモルデント/プラルトリラー/ターンを付与し、
  実際に描画された SVG の `<text>` 要素のコードポイントが `e56d`（モルデント時）/`e56c`（プラルトリラー時）/`e567`（ターン時）
  であることを JS で検証。ピアノ譜へ切り替えても同じ記号が表示されること、再クリックでの解除、
  保存→リロード→読込での復元、Undo による巻き戻しも確認した（コンソールエラーなし）

### 2. インポート/エクスポート（MusicXML・MIDI）

#### 新規ファイル
- `src/utils/musicXmlExport.ts`: SavedScoreData → MusicXML 3.1 (score-partwise)
  - `DIVISIONS = 16`（四分音符基準）
  - アーティキュレーション・強弱・リピート・テンポ変更対応
- `src/utils/musicXmlImport.ts`: MusicXML → SavedScoreData
  - `DOMParser` でブラウザネイティブ解析
  - score-partwise のみ対応
- `src/utils/midiExport.ts`: SavedScoreData → MIDI Type 1
  - PPQ = 480、テンポトラック + パートトラック
  - GM 音色マッピング（ピアノ=0、弦楽=40など）

#### ScorePage.tsx
- 「MusicXML書出」「MIDI書出」「MusicXML読込」ボタンを other タブに追加
- `buildCurrentScoreData()` で現在の画面状態から SavedScoreData を組み立ててエクスポート
- インポート時は `handleLoad` と同じ流れで各 state を更新
- 隠し `<input type="file">` で OS ファイルピッカーを起動

### 3. ペダル記号（Ped / ✱）

- `NoteEvent.pedalMark?: 'down' | 'up'`
- Palette に「ペダル↓」「ペダル↑」ボタン追加
- StaffCanvas / PianoSystemCanvas で SVG テキスト要素として描画
  - `'down'` → 五線下端 +25 SVG単位に斜体 "Ped"（LINE_SPACING≈13なので約2段分）
  - `'up'` → 五線下端 +25 SVG単位に "✱"

### 4. 8va/8vb記号（オッターバ）

- `NoteEvent.ottava?: '8va' | '8vb' | '8vaEnd' | '8vbEnd'`
- Palette に 4 ボタン追加（8va, 8vb, 8va終, 8vb終）
- 描画: SVG テキスト + 破線 + 終端縦線
  - `8va` は五線上端 -14px に表示（五線の上）
  - `8vb` は五線下端 +14px に表示（五線の下）
- 開始〜終端のペアをスキャンしてエントリ収集後一括描画

### 5. ブラケット表示（オーケストラスコアの楽器グループ括弧）

**既存実装として確認済み**。PianoSystemCanvas.tsx の line 1301〜1364 で実装済み:
- `InstrumentPartDefinition.bracketGroup` に基づきグループ括弧描画
- `keyboard` グループ → BRACE（波括弧）
- その他グループ → BRACKET（角括弧）
- `subBracketGroup` で細いサブ括弧も対応済み

### 6. レイアウト制御（段ごとの小節数）

- ScorePage.tsx に `const [measuresPerSystem, setMeasuresPerSystem] = useState(4)` 追加
- other タブに「段あたり小節数」入力欄（1〜8）追加
- 全 StaffCanvas/EnsembleStaff/QuartetStaff/PianoStaff に `measuresPerSystem={measuresPerSystem}` を渡す
- `startMeasureIndex={i * systemsPerPage * measuresPerSystem}` に修正
- `handleSave` / `handleLoad` で保存/復元
- `buildCurrentScoreData` にも反映

### 7. キーボードショートカット（Finale 風）

ScorePage.tsx に `useEffect` で `document.keydown` ハンドラを追加:

| キー | 音価 |
|------|------|
| 1    | 64分音符 |
| 2    | 32分音符 |
| 3    | 16分音符 |
| 4    | 8分音符  |
| 5    | 4分音符（デフォルト） |
| 6    | 2分音符  |
| 7    | 全音符   |
| R    | 休符トグル（現在音価を維持） |

- input/textarea フォーカス中・Ctrl/Cmd 押下中は無効化
- `setTool` で Palette の選択状態を更新するため、視覚的なフィードバックも得られる

### 8. 運指番号（指使いの数字、2026-07-16）

**背景**: バッハのアルマンドのような譜例では音符の上に運指番号（1〜5）が付く。既存のテキスト系記号
（歌詞・コード記号・テンポ表記・発想標語。`textElementUtils.ts` の `TextElementKind` 経由でパレット→
音符クリック→インライン入力欄というパターンで実装済み）と、装飾記号（トグル式）の2つの実装パターンが
既にあったため、運指番号は「自由記述のテキストを音符に1つ付ける」という性質上、前者（テキスト系記号）
のパターンに素直に乗せた。

**設計判断（実装パターンの選択）**:
- **データ型**: `NoteEvent.fingering?: string`。1〜5の単一数字が主だが、和音用の複数指定
  （`'1,3,5'` のようにカンマ区切り）や指替え（`'5-1'`）も入力できるよう自由文字列にした。
  バリデーションは「1〜8文字の非空文字列」という緩いチェックのみ（`src/utils/storage.ts` の
  `validateNoteEvent` に追加）。他のテキスト系フィールド（`lyrics`/`chordSymbol`等）は現状バリデーション
  対象外だが、運指は要件で明示されたため追加した。
- **入力UI**: `textElementUtils.ts` の `TextElementKind` に `'fingering'` を追加するだけで、
  パレットの「演奏記号」タブへのボタン追加・インライン入力欄（Enter確定/Escapeキャンセル/空欄で削除）が
  StaffCanvas・PianoSystemCanvas 両方に自動的に乗る（既存の汎用実装のおかげで追加コード量が少ない）。
  Palette.tsx にはアイコン（丸で囲んだ「3」）を追加。
- **描画**: VexFlow の `Annotation`/`FretHandFinger` は使わず、既存のコード記号・歌詞と同じ
  「SVGテキスト直描き」パターンに統一した（このアプリの装飾記号・テキスト系記号は全てこの方式で、
  VexFlow 標準機能を使うと位置調整や淡色表示（2声部対応）との統一感が失われるため）。
  位置は音符の符頭 BoundingBox 上端（`bb.getY()`）から `-10px` の固定オフセット。
  スタッカート等アーティキュレーションと同様「符幹の向きを避ける」処理までは行わず、
  常に符頭上端基準にする設計にした（実装をシンプルに保つため。要件でも「実装が複雑なら固定高さで可」と
  許容されていた）。フォントは sans-serif・10px・非イタリックで、コード記号（Times New Roman・12px）や
  発想標語（イタリック）と視覚的に区別できるようにした。
- **PianoSystemCanvas**: ローカル `NoteEvent` 型（`types/storage.ts` を直接参照しない、line 58）に
  `fingering?: string` を追加。この型には元々 `lyrics`/`chordSymbol`/`tempoMarking`/`expressionMarking`
  が存在せず、ピアノ譜ではこれらのテキスト系記号は描画されていなかった（既存の未実装ギャップ）。
  運指番号は要件で明示的にピアノ譜対応が求められたため、アクティブ声部・非アクティブ声部の両方の
  描画ループに収集処理を追加し、他の記号（ペダル記号など）と同じ場所に描画コードを追加した。
- **MusicXML**:
  - 書き出し: `<notations><technical><fingering>N</fingering></technical></notations>`。
    和音で `fingering` がカンマ区切り（例 `'1,3,5'`）の場合、`ev.fingering.split(',')` で分割し、
    和音の各音（`<chord/>` で連なる `<note>` 要素）に順番に対応する運指を1つずつ割り当てて、
    複数の `<fingering>` 要素として書き出す（音1つにつき `<technical>` は1つ）。
  - 読み込み: 和音の最初の音は通常の `<technical><fingering>` 読み込みロジックで拾い、
    2音目以降（`<chord/>` 要素）は個別に運指を読み取って `chordBuffer.fingering` にカンマ区切りで
    追記していく（和音内の音の出現順とカンマの順序が対応する設計）。
  - 既存の `articulationsXml` 関数を `fingerValue` 引数を取れるよう拡張し、同じ `<notations>` 要素に
    `<technical>` を追加する形にまとめた（アーティキュレーション・装飾記号・運指を1つの `<notations>` に
    出力する既存の構造を踏襲）。
- **保存/読込・Undo**: 既存テキスト系と同じ経路（`applyTextElementToEvent` 経由で `setScore` の
  スナップショット履歴に乗る）ため追加対応不要。
- **テスト**: `src/utils/fingering.test.ts`（新規）で以下を検証
  - `applyTextElementToEvent` による付与・空文字での削除
  - 日本語ラベル・プレースホルダー
  - storage.ts バリデーション（8文字以内、空文字は不正、未指定は許可）
  - MusicXML 書き出し（`<technical><fingering>`）・単音ラウンドトリップ・和音（カンマ区切り→複数
    `<fingering>` 要素→カンマ区切りで復元）のラウンドトリップ・運指なし音符には `<technical>` が
    出力されないこと
- **ブラウザ確認**: dev サーバー上で単旋律譜の音符に運指 `3` を付与して符頭上に表示されることを確認、
  空欄確定で削除されることを確認、ピアノ譜（大譜表）に切り替えても既存の運指が表示され続けることを確認、
  保存→リロード→「保存された譜面を読み込み」で運指が復元されることを確認、Undo で運指付与前の状態に
  戻ることを確認。コンソールエラーなし。

## 影響範囲

- `src/types/storage.ts`: `NoteEvent` に `graceNotes`, `ornament`, `pedalMark`, `ottava` を追加。`OrnamentType` 型を新設
- `src/utils/ornamentUtils.ts`（新規）: 装飾記号の VexFlow コード変換・日本語ラベル・トグルロジックを集約
- `src/components/Palette.tsx`: Tool 型に 6 種のモードを追加、対応ボタン追加（うち装飾記号は `mode: 'ornament'` + `ornamentType` のサブタイプ形式）
- `src/components/StaffCanvas.tsx`: 各モードのクリック処理・描画エントリ収集・SVG 描画追加
- `src/components/PianoSystemCanvas.tsx`: 同上。ローカル `NoteEvent` 型に `pedalMark`, `ottava` を追記。
  装飾記号追加に伴い、従来描画されていなかった `graceNotes`/`ornament` の描画処理も追加（既存バグ修正）
- `src/components/ScorePage.tsx`: エクスポートハンドラ・レイアウト制御・キーボードショートカット追加
- `src/utils/musicXmlExport.ts` / `src/utils/musicXmlImport.ts`: モルデント・プラルトリラー・ターンの書き出し/読み込み対応。運指番号（`<technical><fingering>`）の書き出し/読み込み対応も追加
- `src/utils/musicXmlOrnament.test.ts`（新規）: 装飾記号の MusicXML ラウンドトリップ・`ornamentUtils` のユニットテスト
- `src/types/storage.ts`: `NoteEvent.fingering?: string` を追加
- `src/utils/textElementUtils.ts`: `TextElementKind` に `'fingering'` を追加（ラベル「運指」）
- `src/utils/storage.ts`: `validateNoteEvent` に `fingering`（1〜8文字の文字列）のバリデーションを追加
- `src/components/PianoSystemCanvas.tsx`: ローカル `NoteEvent` 型に `fingering?: string` を追加。ピアノ譜に元々なかったテキスト系記号の描画のうち、運指番号のみ新規に描画対応した
- `src/utils/fingering.test.ts`（新規）: 運指番号のバリデーション・MusicXML ラウンドトリップ（単音・和音）のユニットテスト

## 注意点

- PianoSystemCanvas にはローカル `NoteEvent` 型が定義されており、`types/storage.ts` の `NoteEvent` を直接参照しない。新フィールドを追加する際は両方に追記する必要がある（line 39）
- `buildCurrentScoreData` は `totalSystems` と `measuresPerSystem` の宣言より後に置く必要がある（TDZ 制約）
