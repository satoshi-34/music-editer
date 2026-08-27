# 設計書: 臨時記号（シャープ・フラット・ナチュラル）実装

## 概要

五線譜上の音高は既存の `keys: string[]`（例: `f#/4`, `bb/3`）で表現できていたが、表示上の臨時記号は「キー文字列に `#` / `b` が入っていれば毎回付ける」だけだった。  
この方式では以下の問題があった。

- 同じ小節内で同じシャープやフラットが続いても、毎回記号が出てしまう
- 先に `F#` が出たあと `F` に戻しても、ナチュラル記号が出ない
- 保存時に `keys` が任意文字列でも通ってしまい、描画系へ不正データが流れ込む余地がある

今回の実装では、**小節単位の臨時記号状態管理** と **音高キーの形式バリデーション** を追加し、単旋律譜・ピアノ譜・弦楽四重奏譜のすべてで同じ規則で動くようにする。

## 変更方針

### 1. データモデルは増やさない

`NoteEvent` に新しい `accidental` フィールドは追加しない。  
理由は以下の通り。

- 現在の音高情報は `keys` だけで十分に表現できる
- `natural` は「音が変わる」情報ではなく「前の臨時記号を打ち消す表示」のため、保存するより描画時に判定した方が一貫性を保ちやすい
- 保存形式を増やすと、既存データ移行と UI 編集点が増えて影響範囲が大きくなる

### 2. 小節ごとの臨時記号状態を描画時に持つ

新規ユーティリティ `src/utils/noteKeyUtils.ts` を追加し、各小節の描画前に `Map<string, '' | '#' | 'b'>` を生成する。

- キー: `音名 + オクターブ`（例: `f/4`）
- 値: 現在その小節内で有効な臨時記号

判定規則は以下。

1. まだ出ていない音なら、`#` / `b` は表示、ナチュラルは省略
2. 同じ状態が続くなら臨時記号は省略
3. `#` / `b` のあとに同じ音名・同オクターブの自然音へ戻る場合は `n` を表示
4. 小節が変わったら状態をリセットする

### 3. 単旋律譜と多段譜で同じロジックを使う

`StaffCanvas.tsx` と `PianoSystemCanvas.tsx` はどちらも `makeVFNote()` で `StaveNote` を作っているため、そこへ小節用の臨時記号状態を注入する。

- 単旋律譜: 小節ごとに `createMeasureAccidentalState()` を作成
- ピアノ / 弦楽四重奏: 各パートの各小節ごとに同じ状態を作成

これにより、譜面種別によって記号表示ルールがずれることを防ぐ。

VexFlow 5 では `StaveNote.addModifier()` の引数順が `addModifier(modifier, index)` なので、臨時記号追加もこの順で統一する。

### 4. パレットから臨時記号を選べるようにする

`src/components/Palette.tsx` の `Tool` 型へ `mode: 'accidental'` を追加し、`sharp / flat / natural` の 3 ボタンを表示する。

- `♯` ボタン: 選択後、音符クリックで同じ音名のシャープ形へ変更
- `♭` ボタン: 選択後、音符クリックで同じ音名のフラット形へ変更
- `♮` ボタン: 選択後、音符クリックで自然音へ戻す

今回は既存の和音移動ルールと合わせ、**和音全体へ同じ臨時記号を一括適用**する。
また、初心者でも置きやすいように、適用判定は「符頭の狭い当たり判定」ではなく**その音符セル内のクリック**で受け付ける。
確認音は現在選択中の楽器音色で鳴らし、必要に応じて UI から ON/OFF を切り替えられるようにする。

また、臨時記号クリックでも音確認の体験を崩さないため、`PianoSystemCanvas` にも `StaffCanvas` と同じ `NotePlayer` ベースの再生経路を持たせる。これにより単旋律譜・ピアノ譜・四重奏譜でクリック再生の有無が分かれない。

### 5. 保存前に音高キーの形式を検証する

`src/utils/storage.ts` の `validateNoteEvent()` を強化し、`keys` の各要素が `parseNoteKey()` で読める文字列だけ通す。

受け入れる形式:

- `c/4`, `f#/5`, `bb/3`（VexFlow 形式）
- `C4`, `F#5`, `Bb3`（Tone.js 形式）

これにより、保存データへ不正な文字列が入って描画や再生を壊すリスクを減らす。

### 6. 描画直前にも音高キーを安全化する

保存検証は基本の防波堤だが、テストデータ・古いデータ・手書きの import データなどは
`StaffCanvas` へ直接渡されることがある。

そのため単旋律譜の `StaffCanvas` と、ピアノ譜・編成譜を描く `PianoSystemCanvas` の
描画直前に `sanitizeRenderEvent()` を通し、次のように安全側へ寄せる。

- `keys` が配列でない休符は、その譜表の既定休符位置へ戻す
- 読めない休符位置キーは、VexFlow へ渡さず既定休符位置へ戻す
- 読めない音符キーだけを除外し、残りの和音構成音で描画する
- 音符キーがすべて不正な場合は、描画クラッシュを避けるため休符へフォールバックする
- 複数声部の `voices[]` も同じ安全化を通し、追加声部だけが壊れている場合でも譜面全体を止めない

保存データを勝手に書き換える処理ではなく、あくまで表示時の安全化として扱う。

ピアノ譜・四重奏譜・編成譜のラッパー（`PianoStaff` / `QuartetStaff` / `EnsembleStaff`）は
描画を `PianoSystemCanvas` に委譲するため、上記の安全化を共有する。  
ただし `EnsembleStaff` の記譜音表示モードでは、描画委譲の前に
`transposeMeasuresForDisplay()` が小節データを移調コピーする。  
この前処理が `measure.events` や `event.keys` を無防備に `map` していたため、
壊れたデータが安全化に到達する前にクラッシュする経路が残っていた。  
そこで前処理側でも `Array.isArray()` ガードを入れ、壊れた小節・音符は
シフトせず素通りさせて、最終的な休符フォールバックは
描画直前の `sanitizeRenderEvent()` に一本化する。

## 影響範囲

| ファイル | 役割 |
|---|---|
| `src/utils/noteKeyUtils.ts` | 音高キー解析、臨時記号表示判定、キー文字列バリデーション |
| `src/components/StaffCanvas.tsx` | 単旋律譜の小節単位臨時記号表示 |
| `src/components/PianoSystemCanvas.tsx` | ピアノ譜・四重奏譜・編成譜の小節単位臨時記号表示と描画直前キー安全化 |
| `src/components/EnsembleStaff.tsx` | 記譜音表示モードの移調前処理でも壊れた小節・音符を素通りさせるガード |
| `src/components/MultiStaffBrokenDataRender.test.tsx` | 多段譜ラッパー（Piano/Quartet/Ensemble）の壊れたデータ描画耐性の回帰テスト |
| `src/utils/storage.ts` | 保存時の `keys` 形式バリデーション強化 |
| `src/utils/noteKeyUtils.test.ts` | 臨時記号ロジックの単体テスト |
| `src/utils/storage.test.ts` | 不正な音高キー拒否の回帰テスト |

## UI/操作ルール

- パレットで `♯ / ♭ / ♮` を選択し、対象の音符セルをクリックして適用する
- 半音移動は既存の `Alt + ↑/↓` をそのまま使う
- `Alt + ↑/↓` でも `#` / `b` を含むキー文字列へ変化させる
- 小節内で元の音へ戻した場合、描画時にナチュラルが自動表示される

## セキュリティと堅牢性

- 保存時に音高キー形式を検証し、未知の文字列をローカル保存しない
- 描画時もキー解析に失敗した場合は臨時記号を付与せず、安全側で継続する
- 外部入力（保存データ読み込み）から `VexFlow.Accidental` へ未検証文字列を渡さない
- VexFlow の `StaveNote` 作成前にも `keys` を安全化し、壊れた休符位置や音名で描画全体を止めない

## 今後の拡張余地

- ~~パレットに `# / b / n` の明示ボタンを追加する~~ → 実装済み
- ~~調号（key signature）導入時に、デフォルト状態を「自然音」ではなく「調号由来の状態」へ差し替える~~ → 実装済み
- ~~注意用のカッコ付き臨時記号（courtesy accidental）を追加する~~ → 実装済み（後述）

### courtesy accidental（カッコ付き臨時記号）の実装

`resolveDisplayAccidental` に省略可能な `prevMeasureState` 引数を追加した。

- `DisplayAccidentalResult = { type: DisplayAccidental; cautionary: boolean }` を新設し、
  戻り値の型を `DisplayAccidental | null` から `DisplayAccidentalResult | null` へ変更
- 前の小節の最終状態（`snapshotAccidentalState` で取得）を渡すと、
  小節線を越えて自然音（調号の音）に戻る場合に `{ type, cautionary: true }` を返す
- `makeVFNote` では `cautionary === true` のとき VexFlow の `Accidental.setAsCautionary()` を呼び、
  臨時記号をカッコ付きで描画する
- `StaffCanvas` は単旋律譜の全小節にわたって `prevMeasureAccidentalState` を引き継ぐ
- `PianoSystemCanvas` はパートごとに `prevMeasureStatePerPart[]` で管理し、
  主旋律（voice 0）にのみ courtesy を適用する（追加声部はノイズになりやすいため除外）
- システム（SVG）境界をまたいだ courtesy は現状未対応（次の拡張余地）

## 追記: ダブルシャープ（𝄪）・ダブルフラット（𝄫）（Issue #423, 2026-08-27）

### 問題

嬰ト短調など♯の多い調ではダブルシャープが頻出するが、臨時記号は ♯/♭/♮ と四分音のみで、
`keys` の解析（`NOTE_KEY_PATTERN`）が1文字の `#`/`b` しか受け付けなかった。
そのため `c##/4` のような綴りは保存バリデーションで弾かれ、描画・再生・移調でも扱えなかった。

### 修正設計

**四分音（microtones）と違い、独立フィールドは追加しない。** 四分音は「半音とは独立した ±50 セント補正」
という性質のため `NoteEvent.microtones` に分けたが、ダブルシャープ・ダブルフラットは
**音高そのもの（半音±2）** なので、既存の ♯/♭ と同じく `keys` 文字列に埋め込むのが自然で、
移調・MIDI 変換・MusicXML の alter がそのまま通る。

- `KeyAccidental` を `'' | '#' | 'b' | '##' | 'bb'` へ、`DisplayAccidental` に `'##' | 'bb'` を追加
- `AccidentalToolKind` に `'doubleSharp' | 'doubleFlat'` を追加（パレットのボタンもこの一覧から生成される）
- `NOTE_KEY_PATTERN` を `/^([a-gA-G])(##|bb|[#b])?(?:\/)?([0-9]+)$/` に変更。
  **2文字の候補を先に並べる**のが要点で、逆順だと `c##/4` の2つ目の `#` が余って解析に失敗する。
  なお `bb/3` は従来どおり「シのフラット」であり、「シのダブルフラット」は `bbb/3` になる
- 半音差の計算は `keyAccidentalSemitoneOffset()` に一本化し、
  `transposeKeyBySemitones`（noteKeyUtils）・`transposeKey`（transposeUtils）・`keyToMidi`（noteMidiUtils）
  の3か所が同じ関数を呼ぶようにした（同じ表を3枚持つと、記号が増えたとき片方だけ直し忘れる）
- 表示判定（`resolveDisplayAccidental`）は既存の状態機械をそのまま使う。
  `accidentalStateKey` は「音名+オクターブ」なので、`f##/4` → `f/4` の変化ではナチュラルが自動で出る。
  小節線をまたぐ courtesy accidental も既存規則のまま動く
- 描画は `new Accidental('##' | 'bb')`。VexFlow 5 の accidentals マップに標準で入っており、
  追加のグリフ指定は不要（`measureLayoutUtils` の計測経路・`PianoSystemCanvas` の本描画で共用）
- 調号（`shiftKeySignatureByAccidental`）には 𝄪/𝄫 が存在しないため、行頭クリックでは調号を変えない。
  あわせて「調号が変わらないときは `onKeySignatureChange` を呼ばない」ガードを入れ、
  何も変わらない操作が取り消し履歴に積まれないようにした
- 再生は音名テーブル／SoundFont のサンプル名が1文字の #/b しか持たないため、
  `respellDoubleAccidentalKey()`（noteMidiUtils）で鳴らす直前に同じ高さの通常表記へ読み替える
  （例: `c##/4` → `d/4`）。半音計算は `keyToMidi`/`midiToKey` に任せるので、譜面側とずれない
- MusicXML は書出（`alter` ±2）・読込（`alter` ±2 → `##`/`bb`）とも既に対応済みだったため変更なし。
  往復テスト（`musicXmlDoubleAccidental.test.ts`）で綴りが保存されることを固定した

### 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/utils/noteKeyUtils.ts` | 型・解析パターン・`setKeyAccidental`・`keyAccidentalSemitoneOffset` 追加・調号シフトの除外 |
| `src/utils/noteMidiUtils.ts` | `keyToMidi` の2文字対応、`respellDoubleAccidentalKey` 追加 |
| `src/utils/transposeUtils.ts` | 半音差を共有関数へ差し替え |
| `src/utils/accidentalUtils.ts` | `applyAccidentalToEvent` の引数を `AccidentalToolKind` へ拡張（四分音との排他は据え置き） |
| `src/components/clefUtils.ts` | 音高キー→五線位置の解析を2文字対応（これが無いと 𝄪 付きの音が既定位置に落ちる） |
| `src/components/PianoSystemCanvas.tsx` | 前打音キーの解析を2文字対応、調号無変化時の通知抑止 |
| `src/components/Palette.tsx` / `src/utils/editorContextLabels.ts` | ボタン追加とラベル（ボタン表記は `×` / `♭♭`。𝄪/𝄫 はフォントが無い環境で豆腐になるため、四分音ボタンと同じ方針） |
| `src/audio/SimpleAudioEngine.ts` / `src/audio/SoundFontEngine.ts` | 鳴らす直前の読み替え |

### 除外項目

- 3/4音（3 quarter tones）は従来どおりスコープ外
- `measureLayoutUtils` の幅見積り（`/^[a-g][#b]/` の本数カウント）は 𝄪 も1個として数える。
  ダブル記号は実グリフが少し広いが、既存の安全マージンの範囲内として今回は変更していない
