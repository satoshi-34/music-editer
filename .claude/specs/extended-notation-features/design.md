# 拡張記譜機能の実装

## 実装した機能

### 1. 装飾音符（前打音・トリル）

- `NoteEvent.graceNotes?: { keys: string[]; slash: boolean }[]` - アッチャカトゥーラ（スラッシュ付き）を前打音として保存
- `NoteEvent.ornament?: 'trill'` - トリル記号
- VexFlow の `GraceNote`, `GraceNoteGroup`, `Ornament('tr')` を使用
- Palette に「前打音」「トリル」ボタンを追加（紫ボーダーでアクティブ表示）
- StaffCanvas / PianoSystemCanvas 両方で対応
- 前打音のデフォルト音高は主音符の1音上（`stepUp` 関数で計算）

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

## 影響範囲

- `src/types/storage.ts`: `NoteEvent` に `graceNotes`, `ornament`, `pedalMark`, `ottava` を追加
- `src/components/Palette.tsx`: Tool 型に 6 種のモードを追加、対応ボタン追加
- `src/components/StaffCanvas.tsx`: 各モードのクリック処理・描画エントリ収集・SVG 描画追加
- `src/components/PianoSystemCanvas.tsx`: 同上。ローカル `NoteEvent` 型に `pedalMark`, `ottava` を追記
- `src/components/ScorePage.tsx`: エクスポートハンドラ・レイアウト制御・キーボードショートカット追加

## 注意点

- PianoSystemCanvas にはローカル `NoteEvent` 型が定義されており、`types/storage.ts` の `NoteEvent` を直接参照しない。新フィールドを追加する際は両方に追記する必要がある（line 39）
- `buildCurrentScoreData` は `totalSystems` と `measuresPerSystem` の宣言より後に置く必要がある（TDZ 制約）
