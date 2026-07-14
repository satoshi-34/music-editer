# 3連符（tuplet）対応 設計メモ

## 問題

既存の音符データ（`NoteEvent`）は `dur`（音価）と `dots`（付点）だけで
「4分音符=1拍」を基準にした拍数を計算していた。連符（3連符など、N個の音符を
本来より少ない拍数に詰め込む記譜）は表現できず、入力UI・描画・再生・
MusicXML/MIDI 入出力のどこにも対応がなかった。

## 採用した設計

### データモデル（`src/types/storage.ts`）

`NoteEvent` に任意フィールドを追加：

```ts
tuplet?: { id: string; numNotes: number; notesOccupied: number };
```

- `id`: 同じ連符グループに属するイベントが共有する識別子（連続イベント列として扱う）
- `numNotes` / `notesOccupied`: 汎用的な N:M 比率を持たせられるようにした
  （UIからは今回 3連符=3:2 のみ作成するが、MusicXML インポートで他の比率が来ても
  そのまま保持できる）
- 省略可能フィールドなので、旧セーブデータ（tuplet なし）はそのまま検証を通る

`src/utils/storage.ts` の `validateNoteEvent` に検証を追加：
`id` が非空文字列、`numNotes`/`notesOccupied` が正の整数であること。

### 拍数計算（`src/utils/voiceMeasureUtils.ts`）

`tupletBeatsMultiplier(tuplet)` を新設し、`notesOccupied / numNotes` を返す
（tuplet 無しなら 1）。`getEventDurationBeats` はこの倍率を
`getDurationBeats(dur, dots)` に掛け合わせる。

3連符（8分音符×3個、numNotes=3, notesOccupied=2）の場合：
- 1個あたり: 0.5拍 × 2/3 = 1/3拍
- 3個の合計: 1拍（＝通常の8分音符2個分と一致）

**この中心ヘルパーだけでは足りない**ため、`dur` から直接拍数を計算している
以下のファイルも個別に修正した（タスク仕様の指摘どおり）：

- `src/components/StaffCanvas.tsx`: `eventOccupiedBeats()` を新設し、
  空き容量チェック・自動休符補完・幅配分（`unitsForEvent`）で使用
- `src/components/PianoSystemCanvas.tsx`: 同様に `eventOccupiedBeats()` を追加
- `src/components/RestOverlapFixV2.ts`: 休符位置調整の時間積算に
  `tupletMultiplier()` を追加
- `src/audio/SoundFontEngine.ts`: `durationToSeconds()` に `tuplet` 引数を追加
- `src/audio/ScorePlayer.ts`: `durToSeconds()` に `tuplet` 引数を追加
- `src/utils/midiExport.ts`: ticks 計算に `tupletMultiplier` を追加
- `src/utils/musicXmlExport.ts`: `<duration>` 計算に反映

浮動小数点誤差対策として、既存の付点処理と同じ `1e-6`〜`0.0001` 程度の
epsilon 比較パターンをそのまま踏襲した（`StaffCanvas.tsx` に `EPS = 1e-6` を追加）。

### 入力UI（`src/components/Palette.tsx` / `src/components/StaffCanvas.tsx`）

- `Tool` の音価バリアントに `tuplet?: boolean` を追加（`dots` と同じ「トグル」方式）
- パレットに「3連符」ボタンを追加。ON状態で音価ツール（例: 8分音符）を選び
  五線をクリックすると、**1音＋休符2つ**からなる3連符グループを1回の操作で配置する
  - 3イベント全てに同じ `tuplet.id`（`tuplet-${timestamp}-${random}`）を付与
  - グループ全体が占める拍数（`baseBeats × dotsMultiplier × 2`、8分音符なら1拍）
    が小節に収まらない場合は、**何も置かない**（既存の空き容量ガードと同じ方針。
    「一部だけ置く」ことはしない）

### 休符→音符の置き換え

連符内の休符を音符ツールでクリックして音符に変える操作（既存の「休符クリックで
置換」フロー）は、**音価が完全に一致する場合のみ**許可し、`tuplet` フィールドを
そのまま引き継ぐ。音価が違う場合は何もしない（連符内で休符を分割するような
複雑な処理はしない、という保守的な仕様）。

### 削除セマンティクス（設計判断）

連符グループ内の1イベントを Delete/Backspace で削除する場合、**グループ全体を
削除して、同じ合計長さの「連符ではない」普通の休符に置き換える**、という
シンプルな仕様を採用した。

理由：
- 連符の一部だけを削除すると、残りのイベントの `notesOccupied/numNotes` 比率が
  崩れ、描画（VexFlow Tuplet）・再生（拍数計算）の両方が破綻する
- 「1音だけ消して残りの休符2つはそのまま」という仕様も検討したが、
  そうすると「2/3拍の休符が2つ」という半端な音価が残り、他の操作
  （選択・別の音符の挿入余地の計算）が複雑化するため見送った

実装は `StaffCanvas.tsx` の Delete/Backspace ハンドラで、削除対象イベントに
`tuplet` があれば同じ `id` を持つ連続範囲を探して丸ごと `buildRestEventsForBeats`
で作った通常の休符に置き換える。

### 描画（VexFlow）

このリポジトリは `vexflow@5.0.0`。`Tuplet` のコンストラクタは
`new Tuplet(notes, { numNotes, notesOccupied })`（キャメルケース。v3系の
`num_notes`/`notes_occupied` ではない）。

コンストラクタ内で自動的に `attach()` が呼ばれ、各 `StaveNote` の
`tupletStack` にセットされる（`Tickable.setTuplet`）。これにより
**Voice のフォーマット計算（ticks の合計）は自動的に連符の比率を反映する**ため、
`Voice`/`Formatter` 側の変更は不要だった。

ただし描画自体（ブラケットと "3" の数字）は自動では行われず、
`tuplet.setContext(ctx).draw()` を明示的に呼ぶ必要がある
（`factory.js` の `Tuplet()` ヘルパーと同じパターン）。

`StaffCanvas.tsx` / `PianoSystemCanvas.tsx` それぞれで、`beams.forEach(...)`
（ビーム描画）の直後に、同じ `tuplet.id` を持つ連続する `safeEvents` を
`vfNotes` からスライスして `new Tuplet(...)` を生成・描画する処理を追加した。
ビームの描画順序を先にすることで、符幹の向きが確定した後の音符を
正しくグルーピングできる。

### MusicXML 入出力

**Export**（`src/utils/musicXmlExport.ts`）:
- `<time-modification><actual-notes>N</actual-notes><normal-notes>M</normal-notes></time-modification>`
  を出力
- 連符グループの先頭イベントに `<notations><tuplet type="start" number="1"/></notations>`、
  末尾イベントに `type="stop"` を出力
- `<duration>` は `DUR_TO_DIV[dur] * dotMultiplier * (notesOccupied/numNotes)` で計算

**Import**（`src/utils/musicXmlImport.ts`）:
- `<time-modification>` を検出したら `tuplet` フィールドを再構築
- 連続する `<time-modification>` 持ちの `<note>` を1グループとみなし、
  モジュールレベルのカウンタ（`xml-tuplet-${n}`）でグループIDを割り当てる
  （MusicXML の `<tuplet type="start/stop">` にも対応できるが、
  `time-modification` の連続性だけで十分にグループ境界を判定できるため、
  実装を簡潔にするためそちらは参照していない）

### MIDI 書き出し（`src/utils/midiExport.ts`）

ノートの tick 長を `DUR_TO_TICKS[dur] * dotMultiplier * (notesOccupied/numNotes)`
で計算するよう変更。

## 影響範囲（変更ファイル一覧）

- `src/types/storage.ts` — `NoteEvent.tuplet` 追加
- `src/utils/storage.ts` — `tuplet` のバリデーション追加
- `src/utils/voiceMeasureUtils.ts` — `tupletBeatsMultiplier` 追加、`getEventDurationBeats` に反映
- `src/components/Palette.tsx` — `Tool` に `tuplet?: boolean`、「3連符」ボタン追加
- `src/components/StaffCanvas.tsx` — 3連符配置・削除・置換・描画・幅配分・自動休符補完
- `src/components/PianoSystemCanvas.tsx` — 拍数計算・描画（tuplet 対応。入力UIは今回未対応）
- `src/components/RestOverlapFixV2.ts` — 休符位置調整の時間計算に tuplet 反映
- `src/audio/ScorePlayer.ts` — 再生時間計算に tuplet 反映
- `src/audio/SoundFontEngine.ts` — 再生時間計算に tuplet 反映
- `src/utils/midiExport.ts` — MIDI tick 長に tuplet 反映
- `src/utils/musicXmlExport.ts` — `time-modification` / `tuplet` notation 出力
- `src/utils/musicXmlImport.ts` — `time-modification` 読み込み、グループID再構築
- テスト: `src/utils/voiceMeasureUtils.test.ts`、`src/utils/storage.test.ts`、
  `src/utils/musicXmlTuplet.test.ts`（新規）

## 既知の制約・今回やらなかったこと

- パレットの「3連符」入力UIは `StaffCanvas.tsx`（単旋律譜）のみ対応。
  `PianoSystemCanvas.tsx`（ピアノ・弦楽四重奏などの複数段譜）は
  描画・拍数計算のみ対応し、クリックでの新規配置UIは未実装
  （既存の複数段エディタの挿入ロジックが `StaffCanvas.tsx` と独立して
  重複実装されているため、今回は単旋律譜での動作確認を優先した）
- UIから作成できるのは 3:2（3連符）のみ。5連符・7連符などは
  データモデル上は表現可能だが、パレットのボタンは用意していない
- MusicXML インポート側は `<tuplet type="start/stop">` を見ておらず、
  `<time-modification>` の連続性のみでグループ境界を判定する
  （多くのエクスポータ出力では十分だが、非連続な同一比率の連符が
  隣接するような特殊なファイルでは誤ってグループ結合される可能性がある）
