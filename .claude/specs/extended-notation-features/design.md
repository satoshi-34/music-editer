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

### 9. 標準記号への配置ごとのサイズ・位置調整の一般化（2026-07-16）

**背景**: カスタム記号（`customSymbols[].scale/offsetX/offsetY`）には既に「⤢（サイズ変更）」「✥（位置調整）」
ツールがあり、ツール選択→対象記号が付いた音符をクリック→インライン入力欄、という UX が確立していた。
「運指などの記号も後から大きさ・位置を調整したい」という要望を受け、このパターンを標準記号
（運指・強弱・アーティキュレーション・装飾記号・歌詞・コード記号・テンポ表記・発想標語）にも広げた。

**設計判断**:
- **データ型**: `NoteEvent.symbolAdjust?: Partial<Record<AdjustableSymbolKind, { scale?: number; offsetX?: number; offsetY?: number }>>`
  を新設（`src/types/storage.ts`）。`customSymbols[].scale/offsetX/offsetY` とは別フィールドにした理由は、
  customSymbols は「付け外し」自体を配列要素の有無で管理するのに対し、標準記号は付け外しを別の仕組み
  （`fingering` 文字列や `dynamics` 配列など）で持っているため、symbolAdjust は「すでに付いている記号の
  見た目だけを上書きする補助データ」として独立させたほうが責務が明確になるため。
  `AdjustableSymbolKind` = `'fingering' | 'ornament' | 'dynamics' | 'articulations' | 'lyrics' | 'chordSymbol' |
  'tempoMarking' | 'expressionMarking'` の8種類を型として定義。scale/offset の許容範囲は customSymbols と
  完全に同じ定数（`MIN_SYMBOL_SCALE`〜`MAX_SYMBOL_SCALE` = 0.25〜4、`MIN_SYMBOL_OFFSET`〜`MAX_SYMBOL_OFFSET` = -100〜100）
  を再利用し、`src/utils/storage.ts` の `validateNoteEvent` にキー名・値範囲の両方を検証するバリデーションを追加した。
- **対応した記号（実際にサイズ・位置を反映して描画するもの）**: `fingering` / `dynamics` / `lyrics` /
  `chordSymbol` / `tempoMarking` / `expressionMarking` の6種類。いずれも「SVGテキスト直描き」方式
  （VexFlow 標準機能を使わない、このアプリ独自の描画パターン）のため、font-size に `scale` を掛け、
  x/y 座標に `offsetX`/`offsetY` を加算するだけで自然に反映できた。
- **除外した記号（データ型には含めるが、UI上の調整対象としては未対応）**: `ornament`（装飾記号）のみ。
  VexFlow の `Ornament` モディファイアとして描画しており、グリフ単位でのスケーリングや正確なオフセット
  適用が本タスクの範囲で確実に作り込めなかったため、`src/utils/symbolAdjustUtils.ts` の
  `listPresentAdjustableSymbolKinds` で意図的に列挙対象から外している
  （＝⤢/✥ツールでクリックしても選択肢に出ない。無理に対応させず、確実に動くものだけ入れる方針）。
  将来対応する場合は、描画後に該当グリフ要素へ SVG `transform` を後付けする方式が候補になる。
  - **追記（articulation-implementation タスクで解消）**: 上記の初版では `articulations`（スタッカート・
    アクセント・テヌート・マルカート・フェルマータ）も同じ理由（VexFlow の `Articulation` オブジェクト）
    で除外していたが、その後 StaffCanvas.tsx / PianoSystemCanvas.tsx のアーティキュレーション描画は
    VexFlow モディファイアを使わない手組みの SVG（円・パス・線）へ置き換わったため、他の標準記号と同じ
    「座標へ offsetX/offsetY を加算・図形サイズへ scale を掛ける」方式で安全に反映できるようになった。
    詳細は `.claude/specs/articulation-implementation/design.md` を参照。
- **共通ロジック**: `src/utils/symbolAdjustUtils.ts`（新規）に `getSymbolAdjust`（読み出し。未設定時は
  scale=1/offset=0 を返す）・`setSymbolAdjustScale`/`setSymbolAdjustOffset`（書き込み。customSymbols と同様、
  対象の記号が実際に付いていない音符には書き込まない）・`listPresentAdjustableSymbolKinds`（この音符に
  付いている調整可能記号の列挙）・`ADJUSTABLE_SYMBOL_KIND_LABELS`（選択リストUI用の日本語ラベル）を実装。
  customSymbolUtils.ts の `setCustomSymbolScale`/`setCustomSymbolOffset` と全く同じ「対象が存在しない場合は
  何もせず元の event を返す」という安全側の設計を踏襲した。
- **UI（既存の⤢/✥ツールの汎用化）**: カスタム記号ごとの個別⤢/✥ボタン（パレットの各カスタム記号の隣）は
  そのまま残し、後方互換を確保した（既存の動作は一切変更していない）。新たに、パレットの演奏記号タブ末尾に
  汎用の「⤢」「✥」ボタンを1つずつ追加（`Tool` 型に `{ mode: 'symbolAdjustResize' }` / `{ mode: 'symbolAdjustOffset' }`
  を新設）。このツールで音符をクリックすると：
  - その音符の customSymbols と、上記6種のうち実際に付いているものを合わせて列挙する
  - 0件なら何もしない（誤操作防止）
  - 1件だけなら、従来のカスタム記号専用ツールと全く同じインライン入力欄を直接開く
  - 複数件あるなら、入力欄を開く前に小さな選択リスト（記号名のボタン列）を出し、選んだものだけを調整する
  実装上は、StaffCanvas/PianoSystemCanvas 双方の `symbolResizeEditState`/`symbolOffsetEditState` を
  「`symbolId: string`」から「`target: { type: 'custom'; symbolId; name } | { type: 'standard'; kind }`」に
  一般化し、確定処理（`handleSymbolResizeConfirm`/`handleSymbolOffsetConfirm`）は `target.type` で
  `setCustomSymbolScale`系（カスタム記号）と `setSymbolAdjustScale`系（標準記号）のどちらを呼ぶか分岐するだけに
  した。これにより既存のオーバーレイJSX（入力欄・Enter確定・Escapeキャンセル・空欄で既定値に戻す挙動）は
  一切変更せず再利用でき、リグレッションのリスクを最小化した。
- **PianoSystemCanvas の制約（既知の制限。当時の記述で、現在は解消済み）**: 以下は本 Issue 実装当時の状態。
  声部の制約は #316・#398 で解消し（記号エントリが `voiceIndex` を持ち、他レイヤーの記号もクリックで調整できる）、
  テキスト系記号もピアノ譜で描画・調整の対象になっている。歴史的経緯として残す。
  既存の「カスタム記号のサイズ変更・位置調整・テキスト要素」ツールと
  同様、汎用⤢/✥ツールも声部1（`activeVoiceIndex === 0`）のみで動作する。理由は既存コメントの通り、確定処理が
  `partData[...].events[eventIndex]` を直接書き換える前提で、まだ声部（voiceIndex）を持っていないため。
  声部2の音符へ適用すると声部1側を誤って書き換えてしまう。将来 voiceIndex 対応する際にまとめて解消する。
- **PianoSystemCanvas は fingering/dynamics のみレンダリング対応**: PianoSystemCanvas のローカル `NoteEvent` 型
  （line 58 付近）には元々 `lyrics`/`chordSymbol`/`tempoMarking`/`expressionMarking` が存在せず、ピアノ譜では
  これらのテキスト系記号自体が描画されていない（既存の未実装ギャップ、8節と同じ制約）。そのため
  symbolAdjust の描画反映も、ピアノ譜側では既に描画されている `fingering`・`dynamics` の2種類のみ行った。
- **MusicXML には出力しない**: symbolAdjust はこのアプリ独自の表示調整であり、MusicXML の標準的な位置指定
  （`default-x`/`default-y` 等）とは意味論が異なるため、書き出し・読み込みの対象外とした（customSymbols の
  scale/offset と同じ扱い）。
- **テスト**: `src/utils/symbolAdjustUtils.test.ts`（新規）で `listPresentAdjustableSymbolKinds`（音符専用の記号
  ＝運指・強弱・アーティキュレーションは休符では除外／テキスト系とオッターバは休符でも対象・
  付与済み記号のみ列挙。休符の扱いは #398 で改訂。custom-symbol-editor 設計メモ追補8を参照）・`getSymbolAdjust`（既定値・設定済み値）・
  `setSymbolAdjustScale`/`setSymbolAdjustOffset`（未付与記号への無視・範囲外クランプ・他記号のsymbolAdjustを
  保持したまま更新）を検証。`src/utils/storage.test.ts` に symbolAdjust 込みの保存/読込ラウンドトリップ・
  不正キー拒否・範囲外の scale/offset 拒否のテストを追加。
- **ブラウザ確認**: dev サーバー上で単旋律譜の音符に運指 `3` を付与し、汎用⤢ツールで対象記号が1件のみ
  （運指のみ）のケースでインライン入力欄が直接開くこと、250%に変更するとフォントサイズが `10px × scale`
  として反映されること（DOM上の `font-size` 属性で確認）、✥ツールで縦オフセット -25px を設定すると
  `y` 属性に反映されること、保存後 localStorage に `symbolAdjust: { fingering: { scale, offsetX, offsetY } }`
  が正しく書き込まれることを確認。コンソールエラーなし。

### 10. オクターヴ記号（8va/8vb）への配置ごとのサイズ・位置調整の追加（2026-07-20）

**背景**: 高音域で音符が密集する箇所に 8va の破線ブラケットが重なって読みにくいという報告を受け、
9節の汎用⤢/✥ツールの対象に `ottava`（8va/8vb ブラケット）を追加した。9節の articulations 追加と
同じ拡張パターン（`AdjustableSymbolKind` にキーを追加し、描画側で `getSymbolAdjust(event, 'ottava')` を
読んで反映する）を踏襲している。

**設計判断**:
- **データ型**: `AdjustableSymbolKind` に `'ottava'` を追加（`src/types/storage.ts`）。
  `src/utils/storage.ts` の `ADJUSTABLE_SYMBOL_KINDS` にも同様に追加してバリデーションの許容キーに含めた。
- **調整対象は開始イベントのみ**: `NoteEvent.ottava` は `'8va' | '8vb' | '8vaEnd' | '8vbEnd'` の4値を取るが、
  `listPresentAdjustableSymbolKinds` では `'8va'`/`'8vb'`（開始マーク）の場合のみ `'ottava'` を列挙し、
  終了イベント（`'8vaEnd'`/`'8vbEnd'`）はそもそも調整対象に出さない。ブラケット全体（開始〜終了）の
  見た目は開始イベント側の `symbolAdjust` だけで一元管理する設計とした。
- **offsetX/offsetY の適用範囲**: ブラケットは「"8va"/"8vb" テキスト＋破線＋終端の縦線」の3要素で
  構成されており、いずれも `startX`/`endX`/`lineY` を起点に座標計算しているため、offsetX/offsetY は
  3要素すべてに一律加算する（テキストだけでなく破線・終端の縦線も一緒に動く）。ユーザーの主目的が
  「offsetY で上下に逃がして音符との重なりを回避すること」だったため、これが最も自然な挙動と判断した。
- **scale の適用範囲**: テキストの `font-size`（既定11px × scale）と、破線・終端の縦線の `stroke-width`
  （既定1px × scale）の両方に scale を掛けた。線の長さ（startX〜endX の区間）自体は scale の対象外
  （音符の間隔に合わせて決まる値であり、見た目のサイズ調整とは独立させるべきと判断）。
- **段またぎの扱い**: 8va/8vb の描画は `pendingOttava`（開始情報を一時保持するローカル変数）→
  終了イベントでペア確定→ `ottavaEntries` に1エントリとして push、という既存の実装のままで、
  **松葉（hairpin）やペダル記号のような段またぎ分割処理は元々実装されていない**（開始・終了が
  異なる段にまたがる場合、直線でつながず単純に `startX`〜`endX` の座標で1本の線を引くだけ）。
  今回の対応でもこの既存の制約はそのまま維持し、分割ロジックの新設は行っていない（スコープ外）。
  `pendingOttava` に `adjust: ResolvedSymbolAdjust` を追加で保持させ、終了イベント側で
  `{ ...pendingOttava, endX }` として `ottavaEntries` に含める形にした。
- **StaffCanvas と PianoSystemCanvas の両対応、および実装中に見つかった既存バグの修正**:
  StaffCanvas.tsx は ottava の収集ブロックが1箇所のみだったが、PianoSystemCanvas.tsx には
  ottava 収集ブロックが実装上2箇所存在した（片方は本来の描画パス、もう片方は別の描画分岐で
  同じ `pendingOttava`/`ottavaEntries` を操作するコード）。今回 `adjust` フィールドを追加する際に
  1箇所目のみ修正して2箇所目を見落とし、`adjust` が `undefined` のまま `ottavaEntries.push` される
  経路が残ってしまい、`adjust.offsetX` 読み取り時に `TypeError: Cannot read properties of undefined
  (reading 'offsetX')` が発生してピアノ大譜表の画面が白紙になる不具合を作り込んだ
  （ブラウザ確認で発覚し、2箇所目にも同じ `getSymbolAdjust(activeEvs[j], 'ottava')` を追加して解消）。
  同種の「同じロジックが複数箇所に重複している」設計は、今後 symbolAdjust 対象を追加する際に
  同じ見落としを繰り返すリスクがあるため、次に標準記号を追加する際は `grep` で該当フィールドの
  出現箇所をすべて洗い出してから着手するとよい。
- **テスト**: `src/utils/symbolAdjustUtils.test.ts` に、8va/8vb 開始イベントで `'ottava'` が列挙されること、
  8va終/8vb終（終了イベント）では列挙されないことを検証するテストを追加。
- **ブラウザ確認**: 複雑テスト楽譜（ピアノ大譜表）で 8va/8vb ブラケットの開始音符を✥ツールでクリックし、
  「オクターヴ記号(8va/8vb)」の調整パネル（他の調整可能記号がないため選択リストは出ず直接入力欄が開く）で
  縦オフセット -15px を設定すると "8va"/"8vb" テキストと破線の y 座標が実測で上へ移動すること、
  ⤢ツールでサイズ 150% を設定するとテキストの `font-size` が 11→16.5、破線・終端の縦線の `stroke-width`
  が 1→1.5 に変わることを DOM 上の属性値で確認。元に戻す（Undo）で全て初期状態に復帰することも確認。
  コンソールエラーなし。

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
- `src/types/storage.ts`: `AdjustableSymbolKind` 型・`NoteEvent.symbolAdjust` を新設
- `src/utils/symbolAdjustUtils.ts`（新規）: 標準記号の配置ごとのサイズ・位置調整（読み出し・書き込み・列挙・ラベル）を集約
- `src/utils/symbolAdjustUtils.test.ts`（新規）: 上記のユニットテスト
- `src/utils/storage.ts`: `validateNoteEvent` に `symbolAdjust`（キー名・scale/offset 範囲）のバリデーションを追加
- `src/utils/storage.test.ts`: symbolAdjust の保存/読込ラウンドトリップ・不正データ拒否のテストを追加
- `src/components/Palette.tsx`: `Tool` 型に `symbolAdjustResize`/`symbolAdjustOffset` を追加、汎用⤢/✥ボタンを追加
- `src/components/StaffCanvas.tsx`: `symbolResizeEditState`/`symbolOffsetEditState` を `target`（カスタム記号/標準記号の判別）ベースに一般化。汎用ツールのクリック処理・選択リストオーバーレイ・記号ごとの描画（font-size×scale、座標+offset）を追加
- `src/components/PianoSystemCanvas.tsx`: 同上。ローカル `NoteEvent` 型に `symbolAdjust` を追記。fingering/dynamics の描画にのみ symbolAdjust を反映（lyrics/chordSymbol等は元々ピアノ譜で未描画のため対象外）

## 注意点

- PianoSystemCanvas にはローカル `NoteEvent` 型が定義されており、`types/storage.ts` の `NoteEvent` を直接参照しない。新フィールドを追加する際は両方に追記する必要がある（line 39）
- symbolAdjust の調整対象UIは ornament（装飾記号）・articulations（アーティキュレーション）を意図的に除外している（`listPresentAdjustableSymbolKinds` 参照）。VexFlowのグリフ/個別SVG実装への安全なスケーリング・オフセット適用が本タスクの範囲で作り込めなかったため。データ型・バリデーションはこの2種も許容する
- PianoSystemCanvas の汎用⤢/✥ツールは、既存のカスタム記号専用ツールと同じ制約で声部1のみ対応（声部2は未対応の既知の制限）
- `buildCurrentScoreData` は `totalSystems` と `measuresPerSystem` の宣言より後に置く必要がある（TDZ 制約）

---

# クレッシェンド／デクレッシェンドの松葉（ヘアピン）対応

（この節の見出しは #444 で「ディミヌエンド」から改称。閉じる松葉＞の呼び名はデクレッシェンドに統一）

## 問題

強弱の漸増・漸減は `cresc.` / `dim.` のテキスト表示のみで、実際の楽譜で標準的な松葉記号（`<` `>`）が置けなかった（README ロードマップ項目）。

## 修正設計

### データ型（`src/types/storage.ts`）

タイ/スラー（`TieArc` を開始音符の `arcs[]` に保持し、終了位置を絶対小節インデックス＋イベントインデックスで参照する方式）に合わせて、開始音符に保持する:

```ts
export interface HairpinMark {
  type: 'cresc' | 'dim';
  endMeasure: number;  // 終了音符の絶対小節インデックス（TieArc.toMeasureIndex と同じ流儀）
  endEvent: number;    // 終了音符のイベントインデックス
  offsetY?: number;    // 縦位置の微調整(px)。省略時0（現状UIからは未設定。将来の✥対応用の受け皿）
}
// NoteEvent.hairpins?: HairpinMark[];
```

- 旧データ互換: `hairpins` は省略可。`validateNoteEvent`（`src/utils/storage.ts`）で type/endMeasure/endEvent/offsetY を検証（offsetY は symbolAdjust と同じ ±100 範囲）
- テキストの `cresc.` / `dim.`（`dynamics`）はそのまま残し、両方使える

### 入力UI

- パレット「演奏記号」タブに「＜」「＞」ボタンを追加（`Tool` に `{ mode: 'hairpin'; hairpinType: 'cresc' | 'dim' }`）
- タイ入力と同じ操作系: ツール選択→開始音符から終了音符へ**ドラッグ**で設置（`tieStartRef` などタイのドラッグ基盤を共用。プレビューは弧ではなく点線の直線）
- 逆ドラッグは始点・終点を自動で入れ替え。休符では開始・終了できない

### 削除

- 描画済みの松葉をクリックすると青くハイライト（`selectedHairpin` state）→ Delete/Backspace で削除、Escape で選択解除（タイ/スラーの選択削除と同じ方式）
- 音符削除時は、その音符を終点とする松葉を除去し、同小節の後続音符を指す `endEvent` を繰り上げる（arcs の掃除処理と同じ場所で実施）

### 描画

- `src/utils/hairpinRenderUtils.ts`（新規）に描画を共通化し、StaffCanvas / PianoSystemCanvas の両方から使用
- 五線の下（強弱記号テキストと同じ高さ帯。五線下端 +22px）に、開始音符から終了音符まで開く/閉じる2本線を SVG で描画。最大開き幅 11px
- 小節をまたぐ場合に対応。**段をまたぐ場合**はタイ/スラーの段またぎ判定（五線Y差>30px または終点が始点より左）を流用し、上段（開始音符→段右端）と下段（段左端→終了音符）に分割、開き幅を横幅比率で連続させる
- 注意: `.score-area svg path` の CSS が stroke-width を上書きし、pointer-events も祖先から none を継承するため、当たり判定パスは `pointer-events="stroke"` 属性とインライン style の strokeWidth で明示的に上書きしている

### 再生

- 松葉の開始音符を、テキストの `cresc.` / `dim.` と同じ「次の絶対強弱（なければ ±0.2）まで段階的に変化」として扱う（`resolveDynamicVelocities` で `hairpins[0].type` をフォールバック参照）
- **判断**: 松葉の終了音符位置での補間打ち切りは実装しない簡易仕様とした。テキスト表記との挙動統一を優先し、工数を抑えるため

### MusicXML

- 書出（`src/utils/musicXmlExport.ts`）: 開始音符の直前に `<direction><direction-type><wedge type="crescendo|diminuendo"/></direction-type></direction>`、終了音符の直後に `<wedge type="stop"/>`。パート全体の開始/終了位置マップを `buildHairpinPositionMaps()` で事前計算
- **読込に対応（Issue #113, 2026-07-29 追記）**: `musicXmlImport.ts` の `attachHairpinsToVoice1Events()` が
  `<measure>` の直接の子要素（`<note>` と `<direction>`）を出現順に読み、`<wedge type="crescendo|diminuendo"/>`
  の直後に来る音符を開始音符、`<wedge type="stop"/>` の直前に処理した音符を終了音符とみなして
  `NoteEvent.hairpins`（`endMeasure`/`endEvent` 付き）を復元する。開始〜終了の待ち行列（FIFO）は
  パート全体で1つを使い回すため、小節をまたぐ松葉にも対応する（自分の書出フォーマットが
  ネストしない前提。外部ソフトの複雑な重なりまでは検証していない）

### 既知の制限

- 2声部（ピアノ譜の声部2）への松葉入力は未対応（タイ/スラーと同じく声部1のみ）
- offsetY を編集するUIは未提供（データ型・バリデーション・描画は対応済み）

## 影響範囲

- `src/types/storage.ts`: `HairpinMark` 新設、`NoteEvent.hairpins` 追加
- `src/utils/storage.ts`: `validateNoteEvent` に hairpins のバリデーション追加
- `src/utils/hairpinRenderUtils.ts`（新規）: 松葉の SVG 描画共通化（段またぎ分割対応）
- `src/utils/dynamicMarkingUtils.ts`: `resolveDynamicVelocities` が hairpins も参照
- `src/utils/musicXmlExport.ts`: `<wedge>` 書き出し、`buildHairpinPositionMaps()` 新設
- `src/components/Palette.tsx`: `Tool` に `hairpin` モード追加、＜/＞ボタン追加
- `src/components/StaffCanvas.tsx` / `src/components/PianoSystemCanvas.tsx`: ドラッグ入力・選択削除・一括描画・音符削除時の参照掃除
- `src/utils/hairpin.test.ts`（新規）: バリデーション・位置マップ・MusicXML書出・再生ベロシティのユニットテスト

## 演奏記号の直接クリック調整（第1弾: 強弱・アーティキュレーション・8va/8vb）

### 問題

- symbolAdjust（記号ごとのサイズ・位置調整）は、汎用⤢/✥ツールを選んでから「音符」をクリックする必要があり、記号自体をクリックしても何も起きなかった。記号が密集した箇所では、どの音符に対応する調整UIを開いているのか直感的でなく、操作コストも高かった。

### 修正設計

- StaffCanvas.tsx / PianoSystemCanvas.tsx それぞれの描画 useEffect 内に `appendSymbolHitRegion` 関数を追加。強弱記号・アーティキュレーション（フェルマータ/スタッカート/アクセント/テヌート/マルカート）・オクターヴ記号（8va/8vb）の各 SVG 要素を描いた直後に、その回で `svgRoot.appendChild` した要素を配列に集め、`getBBox()` で実測した範囲を ±3px 広げた透明 `rect` を重ねる。文字幅などを手計算せず、実際の描画結果から当たり判定を作る方式にした（フォント・スケールが変わっても自動的に追従する）。
- 新しい prop `symbolsClickable?: boolean` を StaffCanvas / PianoSystemCanvas に追加。`true` のときだけヒット領域の `pointer-events` を `auto` にし、hover ハイライト（薄い水色）とクリックリスナー（`openSymbolAdjustEditor('offset', ...)` を直接呼び出し、既存の✥ツールと同じ位置調整オーバーレイを開く）を有効にする。`false`（既定値）のときは `pointer-events: none` で完全に素通しし、従来の音符クリック処理（`hit.addEventListener('click', ...)`）を一切妨げない。ヒット領域のクリックリスナーは `stopPropagation()` で SVG 背景クリック（弧/松葉選択解除など）より先に処理されるため、記号と音符が重なる位置では記号側が優先される。
- `symbolsClickable` は `ScorePage.tsx` の `activeToolbarTab === 'symbols'`（ツールバー「演奏記号」タブ選択中）から、`EnsembleStaff` / `QuartetStaff` / `PianoStaff` / 単一譜表（`StaffCanvas` 直呼び出し）へ prop 中継する（`measureWidthEvenness` と同じ中継パターン）。`PartExtractionStaff`（閲覧・印刷専用のパート譜表示、`disabled` 固定）には配線していない。
- PianoSystemCanvas は複数パート（段）を1つの SVG にまとめて描くため、`openSymbolAdjustEditor` は `partIndex` を追加引数に取る。ヒット領域を作る各エントリ（`dynamicTextEntries` / `articulationEntries` / `ottavaEntries`）に `partIndex` / `measureAbsoluteIndex` / `eventIndex` / `event` を optional で持たせ、アクティブ声部の描画箇所だけこれらを渡す。非アクティブ声部の「見た目だけ」再描画（`isMultiVoiceMeasure` のとき声部2切替中でも声部1の記号を見せ続ける処理）には index 情報を渡さず、`appendSymbolHitRegion` 側で `undefined` ならヒット領域自体を作らない（誤ってクリックできてしまうのを防ぐ）。
  **※この最後の一文は #398（2026-08-24）で反転した**: 画面上どの記号がどの声部のものか見分けられないため、
  「押しても無反応」に見えてしまう。現在は非アクティブ声部にも index 情報と `voiceIndex` を渡してヒット領域を作り、
  クリック時はそのレイヤーへ自動切替してから小窓を開く。詳細は custom-symbol-editor 設計メモ追補7〜9。

### 対象範囲・既知の制限

- 第1弾として強弱記号・アーティキュレーション・8va/8vb の3種類のみ対応。運指・歌詞・コード記号・テンポ表記・発想標語・カスタム記号は今回未対応（引き続き汎用⤢/✥ツール経由でのみ調整可能）。装飾記号（トリル等）は元々 symbolAdjust の調整対象外のため対象外。
- クリックで開くのは位置調整オーバーレイ（✥ 相当）のみ。サイズ調整（⤢）は今回は直接クリックの対象にせず、従来どおり⤢ツール経由。
- 印刷: ヒット領域は透明な rect のため見た目には影響しないが、`class="symbol-hit-region"` を付与しており、将来印刷で問題が出た場合は `@media print { .symbol-hit-region { display: none; } }` を追加できるようにしてある。

## 影響範囲（演奏記号の直接クリック調整）

- `src/components/StaffCanvas.tsx`: `symbolsClickable` prop 追加、`appendSymbolHitRegion` 関数新設、dynamicTextEntries/articulationEntries/ottavaEntries に index 情報を追加
- `src/components/PianoSystemCanvas.tsx`: 同上（`partIndex` も含む）
- `src/components/EnsembleStaff.tsx` / `QuartetStaff.tsx` / `PianoStaff.tsx`: `symbolsClickable` prop 中継

## 演奏記号の直接クリック調整（第2弾: 残りの記号種への展開）

### 問題

- 第1弾（強弱・アーティキュレーション・8va/8vb）で導入した `appendSymbolHitRegion` パターンを、運指・歌詞・コード記号・テンポ表記・発想標語・カスタム記号にも展開する必要があった。

### 修正設計

- `appendSymbolHitRegion` の引数を `kind: AdjustableSymbolKind` 固定から、TypeScript のオーバーロードで「標準記号（`kind`）」と「カスタム記号（`symbolId: string` + `isCustomSymbolId: true`）」の両方を受け付けるように変更。関数内部で `AdjustTarget`（`{type:'standard', kind}` または `{type:'custom', symbolId, name}`）を組み立ててから `openSymbolAdjustEditor` を呼ぶ。StaffCanvas / PianoSystemCanvas 両方で同じ形に揃えた。
- 運指（`fingeringEntries`）・コード記号（`chordSymbolEntries`）・テンポ表記（`tempoMarkingEntries`）・発想標語（`expressionMarkingEntries`）・歌詞（`lyricsEntries`、StaffCanvas のみ）は、既存の dynamics/articulations と同じパターンで `measureAbsoluteIndex` / `eventIndex` / `event`（PianoSystemCanvas はさらに `partIndex`）をエントリに追加し、描画直後に `appendSymbolHitRegion([el], ...)` を呼ぶ。
- カスタム記号は、共通描画ユーティリティ `src/utils/customSymbolRenderUtils.ts` の `drawCustomSymbolEntries()` に第4引数 `onSymbolDrawn?: (entry, symbolId, g: SVGGElement) => void` を追加。`renderCustomSymbol()` は複数の SVG プリミティブを直接 `svgRoot` へ追加するだけで参照を返さないため、記号1個ぶんを一時的な `<g>` でラップしてから `svgRoot` へ付け替え、その `<g>` を `onSymbolDrawn` へ渡す。呼び出し側（StaffCanvas / PianoSystemCanvas）は `[g]` を `appendSymbolHitRegion(..., symbolId, true)` に渡してヒット領域を作る。`CustomSymbolRenderEntry` に `measureAbsoluteIndex` / `eventIndex` / `event` / `partIndex?`（PianoSystemCanvas 用、省略可）を追加し、`buildCustomSymbolEntry()` の呼び出し側で渡す。
- PianoSystemCanvas の非アクティブ声部「見た目だけ」描画パス（`buildCustomSymbolEntry(ev, cx, staveTopY)` を index 省略で呼ぶ箇所）は `partIndex` が `undefined` のままになるため、`drawCustomSymbolEntries` のコールバック内で `entry.partIndex === undefined` ならヒット領域を作らずに return する（第1弾と同じ方針）。同様に fingering/tempoMarking も非アクティブ声部描画では index 情報を渡さない。

### 対象範囲・既知の制限

- PianoSystemCanvas は元々コード記号・発想標語・歌詞（`chordSymbol`/`expressionMarking`/`lyrics`）を描画していない（`ev.lyrics` 等を読む箇所がそもそも存在しない）ため、これらは PianoSystemCanvas では対象外のまま（StaffCanvas のみ対応）。運指・テンポ表記・カスタム記号は両方対応。
- クリックで開くのは位置調整オーバーレイ（✥ 相当）のみで、第1弾と同じ制限が引き続き適用される。

## 調整オーバーレイの no-op コミット修正（Undo 履歴の汚染防止）

### 問題

- `symbolOffsetEditState` / `symbolResizeEditState`（StaffCanvas・PianoSystemCanvas の各2箇所、計4箇所）の確定処理（`handleSymbolOffsetConfirm` / `handleSymbolResizeConfirm`）は、値を変えずに blur だけでオーバーレイを閉じた場合でも常に `setScore` / `setPartsScore` を呼んでいた。その結果、明示的な `offset 0` / `scale 100%` が `NoteEvent.symbolAdjust` / `customSymbols[].offsetX/offsetY/scale` に書き込まれ、実質何も変えていないのに Undo 履歴が1件積まれてしまっていた。

### 修正設計

- 4つの確定関数それぞれで、パース・クランプ後の値をオーバーレイを開いた時点の現在値（`currentValue` / `currentX`・`currentY`）と比較し、完全に一致する場合は `setScore`/`setPartsScore` を呼ばずに `setXxxEditState(null)` だけ行って早期 return する。
  - `handleSymbolResizeConfirm`: `String(Math.round(scale * 100)) === currentValue` なら no-op
  - `handleSymbolOffsetConfirm`: `String(offsetX) === currentX.trim() && String(offsetY) === currentY.trim()` なら no-op
- カスタム記号側は別実装ではなく、既に `AdjustTarget`（`{type:'custom', symbolId}` / `{type:'standard', kind}`）で統一されているため、上記4関数の修正だけで標準記号・カスタム記号の両方に効く。
- ブラウザ確認: 演奏記号タブで記号をクリックしてオーバーレイを開き、値を変えずに blur で閉じても「元に戻す」ボタンが disabled のまま変化しないことを確認。値を変えて確定した場合は従来どおり反映され「元に戻す」が enabled になり、Undo で正しく元に戻ることも確認済み。

## 影響範囲（第2弾・no-op 修正）

- `src/components/StaffCanvas.tsx`: `appendSymbolHitRegion` のオーバーロード化、fingering/chordSymbol/tempoMarking/expressionMarking/lyrics エントリへの index 追加とヒット領域呼び出し、カスタム記号のヒット領域呼び出し、`handleSymbolResizeConfirm`/`handleSymbolOffsetConfirm` の no-op 早期return
- `src/components/PianoSystemCanvas.tsx`: 同上（fingering/tempoMarking のみ。chordSymbol/expressionMarking/lyrics は元々未描画のため対象外）
- `src/utils/customSymbolRenderUtils.ts`: `CustomSymbolRenderEntry` に `measureAbsoluteIndex`/`eventIndex`/`event`/`partIndex?` 追加、`buildCustomSymbolEntry()` に index 引数追加（既定値付きで後方互換）、`drawCustomSymbolEntries()` に `onSymbolDrawn` コールバック追加
- `src/utils/customSymbolRenderUtils.test.ts`: 新フィールド追加に伴うテスト期待値の更新
- `src/components/ScorePage.tsx`: 各描画コンポーネントへ `symbolsClickable={activeToolbarTab === 'symbols'}` を渡す

## 発想標語（espressivo / Si deve suonare...）の描画と、編集欄の初期値混線の修正（Issue #237）

### 問題

運用者の実機テスト（2026-08-11・月光第1楽章の入力）で見つかった2件。

1. **保存されるだけで描画されない**: 発想標語ツール（espr.）で入力・確定すると `NoteEvent.expressionMarking` には保存されるのに、譜面のどこにも出ない。原因は「PianoSystemCanvas に描画処理がそもそも無い」こと。上の第2弾の節に *「PianoSystemCanvas は元々コード記号・発想標語・歌詞を描画していない（StaffCanvas のみ対応）」* と書いてあるとおりで、その後 StaffCanvas が廃止されて描画が PianoSystemCanvas へ集約された際、歌詞（`lyricsEntries`）は移植されたが**発想標語とコード記号は移植されないまま残っていた**。
2. **編集欄の初期値にテンポ表記が混ざる**: 同じ音符にテンポ表記がある状態で発想標語の編集欄を開くと、初期値にテンポ表記の文字列が入っている。

2 の原因は Issue のトリアージが推定した「読み出し先の混線」ではなかった。読み出しは `(activeEvs[j] as any)[textElementMode]` で種別ごとに正しく引けている（テストで確認済み）。真因は**入力欄が非制御コンポーネント（`<input defaultValue>`）で、`key` を持っていなかったこと**:

- `defaultValue` は入力欄が**最初に表示されたときにしか**反映されない。`textEditState` の中身だけを差し替えても、同じ位置の `<input>` が使い回されるため、前に開いていたときの文字が DOM に残り続ける
- 通常は「別のツールのボタンを押す → 入力欄から**フォーカスが外れて** `onBlur` → `setTextEditState(null)` → 入力欄が消える」ので再生成される。ところが **macOS の Safari はボタンをクリックしてもフォーカスが移らない**ため入力欄が開いたままになり、その状態で発想標語ツールに切り替えて同じ音符をクリックすると、種別だけが変わって入力欄は生き残る（同じ理由の Safari 差異は Issue #231 でも踏んでいる）

### 修正設計

#### 1. 描画（`src/components/PianoSystemCanvas.tsx`）

- `expressionMarkingEntries` を新設し、テンポ表記（`tempoMarkingEntries`）と同じ2箇所——アクティブ声部の描画ループと、非アクティブ声部の「見た目だけ」描画ループ——で収集する。非アクティブ声部側は index 情報を渡さない（＝クリック判定を作らない）ところまで既存の慣習どおり
- 体裁は**イタリック体**・書体は `SCORE_TEXT_FONT_FAMILY`。文字サイズは新設した `ENGRAVING_TEXT_UNITS.expressionMarking`
- 描画後に `appendSymbolHitRegion([el], ..., 'expressionMarking')` を呼ぶので、演奏記号タブからサイズ（⤢）・位置（✥）の調整ができる（`listPresentAdjustableSymbolKinds` は以前から `expressionMarking` を列挙しており、調整データ側の対応は済んでいた）

#### 2. 文字サイズ（`src/utils/engravingDefaults.ts`）

- `ENGRAVING_TEXT_SP.expressionMarking = 1.3`（= 13 u）を追加。浄書慣例では「速度標語 ＞ 発想標語」の階層があるので、テンポ表記（`expressiveText` = 1.5 sp）の **約 87%** にあたる値を選んだ。Bravura の `engravingDefaults` には文字サイズの推奨値が無いため、月光冒頭の実譜例と見比べて決めた値である（候補A由来ではないので `ab-preview.js` の `PRESETS.a` との一致チェックの対象外。運指 1.8 sp と同じ扱い）

#### 3. テンポ表記と共存するときの縦の積み順

- 浄書慣例どおり、上から **テンポ表記 → 発想標語 → 五線** の順に積む
- 実装は「**五線に近い側を定位置にして、上へ伸ばす**」方式にした。発想標語は常に従来のテンポ表記と同じ `五線上端 - 24 u` に置き、**同じ音符にテンポ表記もある場合だけ**テンポ表記を `TEXT_STACK_LINE_GAP_UNITS`（18 u）ぶん持ち上げる
  - 逆（テンポ表記を固定して発想標語を下げる）にしなかったのは、下げると発想標語が五線上端から 11 u しか離れず、加線や高い音符とぶつかるため
  - 判定は「同じ `NoteEvent` に両方あるか」だけで行う（`tempoMarkingEntries` の `stackedWithExpression`）。別々の音符に付いている場合は互いに影響しない。横方向に離れていれば重ならないので、これで足りる

#### 4. 長い標語のはみ出し方針（第1段の決定）

- **折り返さない。はみ出しは許容するが、左だけは五線の左端で止める。** 月光の "Si deve suonare tutto questo pezzo delicatissimamente e senza sordino"（約60字）は小節幅を大きく超えるが、第1段では自動折り返しを実装しない
  - 折り返さない理由: 折り返すと段の上に必要な高さが変わり、レイアウトパイプライン（`.claude/specs/layout-pipeline/design.md` の「上から順に配置」）の縦配分に影響が及ぶ
  - **左クランプを入れた理由（ブラウザ確認で判明）**: 中央揃えのまま素直に描くと、1小節目の音符に付けた長い標語は左半分が**紙面の外に出て切れてしまい**、読めなくなる（右へのはみ出しは紙面が広いぶん問題になりにくい）。「はみ出し容認」は「文字が消えてよい」という意味ではないので、左端だけ止める
  - 実装: `<text>` を DOM へ追加したあとに `getComputedTextLength()` で実測し、左端（アンカー − 幅/2）が五線の左端より左なら、左端にそろう位置まで右へずらす。**手動で位置調整（✥）した場合（`offsetX ≠ 0`）は利用者の指定を優先してクランプしない**
  - jsdom は `getComputedTextLength` を持たない（あっても 0 を返す）ため、テスト環境ではクランプが働かない。**この挙動の回帰テストは書けない**ので、ブラウザ実測（PR に記録）で担保する
  - 逃げ道: 位置調整ツール（✥）で `symbolAdjust.expressionMarking.offsetX/offsetY` を与えれば手動で逃がせる（上記1でヒット領域を作ってあるので、実装済みの機能でそのまま操作できる）
  - 将来案（未実装）: 小節幅を超える場合だけアンカーを左揃えへ切り替える／改行文字での明示的な複数行対応／右端のクランプ

#### 5. 編集欄の作り直し（`src/components/PianoSystemCanvas.tsx`）

- テキスト編集オーバーレイの `<input>` に `key={kind-partIndex-measureAbsoluteIndex-voiceIndex-eventIndex}` を付け、**編集対象が変わったら別の入力欄として作り直す**ようにした。`defaultValue` の非制御入力を維持したまま最小の変更で直せる
- 対象を切り替えた時点で、確定していなかった文字は破棄される。これは「入力欄を開いたまま別のツールを押すと Esc と同じ扱いになる」という既存の取り決め（`docs/REGRESSION.md` C 節・Issue #231）と同じ挙動である

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`: ローカル `NoteEvent` 型に `expressionMarking?: string` を追加、`expressionMarkingEntries` の収集（2箇所）と描画、テンポ表記の y 計算に `stackedWithExpression` を追加、テキスト編集入力欄の `key`
- `src/utils/engravingDefaults.ts`: `ENGRAVING_TEXT_SP.expressionMarking` / `ENGRAVING_TEXT_UNITS.expressionMarking` / `TEXT_STACK_LINE_GAP_UNITS` を追加
- `src/components/PianoSystemCanvasExpressionMarking.test.tsx`: 新規（描画・積み順・3パターン・編集欄の初期値）

### 残っている課題（このIssueの範囲外）

- ~~**コード記号（`chordSymbol`）も同じ理由で描画されないまま**である~~ → **Issue #279 で解消**（下の節）
- テキスト編集以外のオーバーレイ（テンポ BPM・拍子・調号・音部記号・リハーサルマーク・記号サイズ/位置）の入力欄にも同じ `key` の無い非制御入力があり、Safari で対象を切り替えると前の値が残る可能性がある。今回は Issue の範囲に絞って修正していない

## コード記号（C / Am7 …）の描画（Issue #279）

### 問題

演奏記号タブの「コード記号」ツールで音符に C・Am7 等を付けても、`NoteEvent.chordSymbol` には保存されるのに譜面のどこにも出ない。原因は発想標語（#237）とまったく同じ**StaffCanvas 廃止時の移植漏れ**で、上の節の「残っている課題」に予告してあった最後の1件である。

### 修正設計

#### 1. 描画（`src/components/PianoSystemCanvas.tsx`）

- `chordSymbolEntries` を新設し、テンポ表記・発想標語と同じ2箇所——アクティブ声部の描画ループと、非アクティブ声部の「見た目だけ」描画ループ——で収集する。非アクティブ声部側は index 情報を渡さない（＝クリック判定を作らない）ところも既存の慣習どおり
- 描画後に `appendSymbolHitRegion([el], ..., 'chordSymbol')` を呼ぶので、演奏記号タブからサイズ（⤢）・位置（✥）を調整できる（`listPresentAdjustableSymbolKinds` は以前から `chordSymbol` を列挙しており、調整データ側の対応は済んでいた）

#### 2. 体裁: 正体（ローマン体）にした

- コードネームは「和音の名前」であって発想を述べる標語ではないので、浄書慣例どおり**イタリックにしない**。テンポ表記・発想標語がどちらもイタリックなので、正体であること自体が3種類を見分ける手がかりになる
- Issue 本文は「太字またはローマン体」を許容していたが、**太字は採らなかった**。リハーサルマーク（枠付き太字）と途中テンポ変更（♩=XXX・琥珀色の太字）が既に太字を使っており、同じ紙面で3つ目の太字が増えると強調の意味が薄れるため
- 書体は他の譜面内テキストと同じ `SCORE_TEXT_FONT_FAMILY`（StaffCanvas 時代は `"Times New Roman", serif` 直書きだったが、#202 で全体を統一済み）

#### 3. 文字サイズ（`src/utils/engravingDefaults.ts`）

- `ENGRAVING_TEXT_SP.chordSymbol = 1.5`（= 15 u）を追加。既存の階層は「テンポ表記 1.5 sp ＞ 発想標語 1.3 sp」なので、コード記号は**テンポ表記と同じ 1.5 sp** に置いた
  - 根拠: StaffCanvas 時代もコード記号とテンポ表記はどちらも 12px で同じ大きさだった（発想標語だけが別扱い）。その比率をそのまま引き継いだ形になる
  - コード記号は「その拍で何の和音か」を読み取るための実用的な表示なので、発想標語のような従属的な注記より小さくしてはいけない、という浄書上の理由もある
  - 大きさが同じでも、イタリック（テンポ表記）と正体（コード記号）で見分けが付く

#### 4. テンポ表記・発想標語と共存するときの縦の積み順

- 浄書慣例どおり、上から **テンポ表記 → 発想標語 → コード記号 → 五線** の順に積む。コード記号がいちばん五線寄りなのは、コード記号だけが「特定の拍に紐づく」表示で、音符の近くにあるほど読みやすいため
- 実装は #237 の方式（**五線に近い1行を定位置にして、上へ伸ばす**）をそのまま3行へ広げた。定位置は従来どおり `五線上端 - 24 u`:
  - コード記号: 常に `-24 u`
  - 発想標語: `-24 u`、同じ音符にコード記号があれば `TEXT_STACK_LINE_GAP_UNITS`（18 u）ぶん上
  - テンポ表記: `-24 u` から、発想標語・コード記号がある数だけ 18 u ずつ上（最大 -60 u）
  - 判定は「同じ `NoteEvent` に付いているか」だけで行う（`stackedWithExpression` / `stackedWithChord`）。別々の音符に付いていれば横に離れるので重ならない
- **コード記号が無い譜面の見た目は1 px も変わらない**（発想標語・テンポ表記の y 計算に加えた項は、どちらも `stackedWithChord === false` のとき 0 になる）。既存データの回帰は `PianoSystemCanvasChordSymbol.test.tsx` の「受入4」で固定した

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`: ローカル `NoteEvent` 型に `chordSymbol?: string` を追加、`chordSymbolEntries` の収集（2箇所）と描画、テンポ表記・発想標語の y 計算に `stackedWithChord` を追加
- `src/utils/engravingDefaults.ts`: `ENGRAVING_TEXT_SP.chordSymbol` / `ENGRAVING_TEXT_UNITS.chordSymbol` を追加、`TEXT_STACK_LINE_GAP_UNITS` のコメントを3行の積み上げに合わせて更新
- `src/components/PianoSystemCanvasChordSymbol.test.tsx`: 新規（描画・積み順・既存データの不変・記号調整・クリック判定・声部2）
- `README.md`: 「コード記号は表示されない」という制限記述を削除し、テキスト系記号の説明を3種類の積み順に更新

### 残っている課題（このIssueの範囲外）

- **MusicXML の `<harmony>` 書出・読込は未対応**。コード記号はアプリ内の保存・読込でのみ往復する（タイ・スラーと同じ状況）
- 長い標語と同じく、コード記号も小節幅を超える場合の折り返しはしない（コード記号は数文字なので実害はほぼ無い）
- 同じ音符にコード記号・発想標語・テンポ表記の3つを付けると、テンポ表記は `五線上端 - 60 u` まで上がる。小節の左端に置く途中テンポ変更（♩=XXX・`-36 u`）やリハーサルマーク（`-56 u` 以上）と、**小節の先頭音符に限って**横位置が近づく可能性がある（実機では横にずれるので実害は確認されていない）

---

# 松葉＞の説明文言を「デクレッシェンド」に統一（Issue #444）

## 問題

パレット「演奏記号」タブの松葉＞ボタンのツールチップ／`aria-label` が
「ディミヌエンドの松葉＞（開始音符から終了音符へドラッグ）」になっていた。
楽譜用語としては、閉じる松葉（`>`）は**デクレッシェンド**と呼ぶのが一般的で、
`dim.` は文字表記の別記号である。実際、削除時の通知文言
（`scoreEditorNotices.ts` の `describeDeletedHairpin`）は先に「デクレッシェンド」に
なっていたため、**同じ記号を操作しているのに UI 内で呼び名が食い違っていた**。

## 修正設計

- 松葉＞ボタンの `title` / `aria-label` を「デクレッシェンドの松葉＞（開始音符から終了音符へドラッグ）」へ変更（`Palette.tsx`）
- **文字表記の `dim.` ボタン（`dynamicLabel('dim')` → 「ディミヌエンド」）は変更しない**。
  こちらは松葉ではなく別の記号なので、統一の対象は「松葉系の呼び名」だけに限る。
  取り違えて後から書き換えられないよう、その旨をボタン付近のコメントに残した
- MusicXML の `<wedge type="diminuendo"/>` は規格上の語なのでそのまま（データ側の
  `hairpinType: 'dim'` も互換のため変更しない）。**呼び名を変えるのは UI とドキュメントの表示文言だけ**という切り分け

## 影響範囲

- `src/components/Palette.tsx`: 松葉＞ボタンの `title` / `aria-label`、および松葉に関するコメント2箇所の用語
- `src/components/PaletteHairpinLabel.test.tsx`（新規）: 松葉＞＝デクレッシェンド／松葉＜＝クレッシェンド／文字表記 `dim.` ＝ディミヌエンドのまま、を `getByRole` の名前で固定する
- `README.md` / `docs/DEVELOPMENT.md`: 松葉の説明にある「ディミヌエンド」を「デクレッシェンド」へ（MusicXML の型名は据え置き）
- 挙動の変更は無し。データ構造・保存フォーマット・再生・書出しはいずれも不変

### 既存テストへの波及（名前の一意性）

`ScorePageDoubleAccidentalWiring.test.tsx` は文字表記の `descresc.` ボタンを
`getByRole('button', { name: /デクレッシェンド/ })` で探していた。松葉＞の名前も
「デクレッシェンドの松葉＞…」になったことで**2件マッチして落ちる**（Testing Library は
複数一致をエラーにする）。ローカルの関連テストでは気付けず GitHub Actions の全スイートで
検出された。文字表記ボタンだけを指すよう `/^デクレッシェンド（dim\./` へ絞り込んで解消した
（`PaletteDoubleAccidentalDescresc.test.tsx` の `aria-label` 前方一致も同じ理由で
「デクレッシェンド（」まで含めた）。**UI 文言を増やすときは、既存テストの
`getByRole` 名前検索が一意でなくなっていないかを確認する**。

## トリルの再生対応（2026-08-29・弟フィードバック）

装飾記号はこれまで見た目だけで、再生では主音符が1回鳴るだけだった。トリルを
**主音と上隣接音（その小節で有効な調号の音階上の音）の交互連打**として鳴らす。

- 実装は純関数 `src/utils/ornamentPlaybackUtils.ts` の `expandTrillForPlayback`。
  ScorePage が playParts へ渡すイベント列を組むところ（velocity/durationScale 付与の直後）で
  flatMap するだけなので、内蔵音源と SoundFont の**両エンジンへ同時に効き、エンジン側は無変更**
- サブ音符は 32分（短い主音符は 64分）で、dots は個数へ換算・tuplet は倍率として引き継ぐ
  （サブ音符の合計拍 = 元の音価。厳密に割り切れる分割だけを使い、拍を一切壊さない）。
  tuplet id は再生専用の別 id（描画側の「同一 id 連続」数えと衝突させない）
- 交互は主音から始め、**最後は必ず主音**で終える（上隣接音で切れると解決感がないため）
- 途中調号変更は強弱と同じく「切る前の全列」で有効調号を追跡（途中再生でも正しい）
- 展開しない形（挙動不変）: 休符・和音・微分音つき・32分/64分の主音符（4分割未満）・
  トリル以外の装飾（モルデント/プラルトリラー/ターンは「残り時間ぶん主音を伸ばす」表現に
  任意長の音価が必要で dur 文字列で表せないため対象外。対応するなら別Issueで
  PlaybackMeasureEvent へ「拍数直接指定」を足すところから）
- テスト: ornamentPlaybackUtils.test.ts（10件）+ ScorePageTrillPlayback.test.tsx
  （エンジンをモックして playParts へ届く展開列を実マウントで固定）
