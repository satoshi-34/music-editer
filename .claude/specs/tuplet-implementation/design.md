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
- `src/components/PianoSystemCanvas.tsx` — 拍数計算・描画（tuplet 対応）に加え、
  入力UI（配置・休符置換・グループ削除）も対応（後述の追記セクション参照）
- `src/utils/tupletUtils.ts`（新規） — StaffCanvas/PianoSystemCanvas 共通の
  連符グループ組み立て・休符置換ガード・グループ削除ロジック
- `src/utils/tupletUtils.test.ts`（新規） — 上記ユーティリティの単体テスト
- `src/components/RestOverlapFixV2.ts` — 休符位置調整の時間計算に tuplet 反映
- `src/audio/ScorePlayer.ts` — 再生時間計算に tuplet 反映
- `src/audio/SoundFontEngine.ts` — 再生時間計算に tuplet 反映
- `src/utils/midiExport.ts` — MIDI tick 長に tuplet 反映
- `src/utils/musicXmlExport.ts` — `time-modification` / `tuplet` notation 出力
- `src/utils/musicXmlImport.ts` — `time-modification` 読み込み、グループID再構築
- テスト: `src/utils/voiceMeasureUtils.test.ts`、`src/utils/storage.test.ts`、
  `src/utils/musicXmlTuplet.test.ts`（新規）

## 既知の制約・今回やらなかったこと

- MusicXML インポート側は `<tuplet type="start/stop">` を見ておらず、
  `<time-modification>` の連続性のみでグループ境界を判定する
  （多くのエクスポータ出力では十分だが、非連続な同一比率の連符が
  隣接するような特殊なファイルでは誤ってグループ結合される可能性がある）

## 追記: 多段譜（ピアノ大譜表・弦楽四重奏・編成譜）への3連符入力対応

上記「既知の制約」に書いていた「`PianoSystemCanvas.tsx` は描画・拍数計算のみで
入力UIが未対応」という制限を解消した。

### 何が足りなかったか

`PianoSystemCanvas.tsx` はすでに `tupletBeatsMultiplier` を使った拍数計算と
`Tuplet` の描画（`Tuplet` インポート済み、`beams.forEach` の後に同じ実装）を
持っていたが、以下の3つが未実装だった。

1. 小節クリック時の `doInsert()` に「3連符トグルON時はグループを配置する」分岐がない
   （`tool.tuplet` を見ておらず、常に単一イベントとして挿入していた）
2. `buildRestEditReplacement()` に連符内休符のガード（音価が一致する場合のみ置換）がない
   （`StaffCanvas.tsx` にはあったが、`PianoSystemCanvas.tsx` にはこの分岐が漏れていた。
   放置すると連符内の8分休符を16分音符ツールでクリックしたときに「分割」処理が走り、
   連符の音価バランスが壊れる不具合になり得た）
3. Delete/Backspace ハンドラに「連符グループごと削除して通常の休符に戻す」分岐がない
   （単純に `events.splice(index, 1)` されるため、連符の残り2要素だけが
   `tuplet.id` を持ったまま残り、描画・再生が破綻する不具合になり得た）

### 採用した設計: ロジックの共通化

`StaffCanvas.tsx` と `PianoSystemCanvas.tsx` は同じ「1音＋連符内休符2」という
仕様のグループを扱うため、`customSymbolRenderUtils.ts`（カスタム記号）と同じ方針
「**ロジックだけを共通化し、クリックのヒット判定・state更新（`setScore` /
`setPartsScore`）は各キャンバス側に残す**」で `src/utils/tupletUtils.ts` を新設した。

- `generateTupletId()`: `tuplet-${Date.now()}-${カウンタ}-${乱数}` で id を発行。
  旧実装（`StaffCanvas.tsx` に直書きされていた `tuplet-${Date.now()}-${random}`）に
  モジュール内カウンタを追加し、同一ミリ秒・同一乱数のごく低い衝突確率をさらに下げた。
  単旋律譜・多段譜のどちらから呼んでも同じ関数を使うため、パート（右手/左手、
  各弦楽器パートなど）をまたいでも衝突しない
  （実機確認: ピアノ右手・左手にそれぞれ配置した結果、保存データの
  `tuplet.id` が異なることを確認済み — 詳細は本ファイル末尾のブラウザ確認結果を参照）
- `buildTupletGroupPlan(duration, dots, noteKeys, restKey)`: 音符1＋連符内休符2の
  `NoteEvent[]` とグループ全体の拍数を組み立てる。空き容量チェック
  （`currentBeats + groupBeats > 小節拍数`）は呼び出し側で行う（`StaffCanvas`/
  `PianoSystemCanvas` で小節拍数の取得方法が微妙に異なる—`StaffCanvas` は
  小節ごとの `timeSignature` を見るが `PianoSystemCanvas` は現状グローバルな
  `beatsPerMeasure` のみを使っている—ため、この差異をユーティリティ側に
  持ち込まず、そのまま踏襲した）
- `buildTupletRestReplacement(restEvent, key, durationTool)`: 連符内休符の
  置換可否を判定する。戻り値は3値
  （`undefined`=連符ではないので通常ロジックへフォールバック、
  `null`=連符だが音価不一致で何もしない、配列=置換後のイベント）にして、
  「連符ではない」と「連符だが弾く」を呼び出し側で区別できるようにした
- `planTupletGroupDeletion(events, index, defaultRestKey)`: 削除対象イベントの
  `tuplet.id` から前後の同グループ範囲（`groupStart`/`groupEnd`）を探し、
  合計拍数から通常休符の配列を組み立てる。対象が連符でなければ `null`

`StaffCanvas.tsx` 側もこの3関数を使うようにリファクタリングし、重複コードを解消した
（挙動は完全に同一であることをユニットテスト・ブラウザ確認の両方で確認済み）。

### PianoSystemCanvas.tsx 側の変更点

- `doInsert()`: `(tool as any)?.tuplet` が真のとき `buildTupletGroupPlan` で
  グループを組み立て、`currentBeats + groupBeats > beatsPerMeasure` なら何もしない。
  収まる場合は `fillPriorMeasureRests` → `m.events.splice(...)` で3イベントをまとめて挿入し、
  先頭の音符イベントだけ `playNoteEvent` で確認音を鳴らす（`StaffCanvas.tsx` と同じ流れ）
- `buildRestEditReplacement()`: 冒頭で `buildTupletRestReplacement` を呼び、
  `undefined` でなければその結果をそのまま返す（連符ガードを追加）
- Delete/Backspace ハンドラ: `targetEv.tuplet` があれば `planTupletGroupDeletion` の
  結果で `events.splice` する分岐を、和音キー削除・通常削除より前に追加

### なぜ「クリック処理は各キャンバス側」に残したか

`PianoSystemCanvas.tsx` はパート配列 `partsScore` を扱うため `setScore` が
`setPartsScore` 経由のラッパー（`partIndex` を閉じ込めた関数）になっている一方、
`StaffCanvas.tsx` は単一の `setScore` を直接使う。この state 更新の形が違うため、
`doInsert`/Delete ハンドラ自体を共通化すると型やクロージャの取り回しが複雑になり、
かえってバグを埋め込みやすい。カスタム記号対応（`customSymbolRenderUtils.ts`）で
採った「純粋なデータ変換ロジックだけを共通化する」という前例をそのまま踏襲した。

### テスト・確認結果（描画順序については後述の「追記3」も参照）

- 単体テスト: `src/utils/tupletUtils.test.ts`（新規）。
  - `generateTupletId` の連続200回呼び出しでの一意性
  - `buildTupletGroupPlan` のグループ構成・拍数・tuplet id の一意性
    （パートをまたいでも別IDになることを模した2回呼び出しの比較）
  - `buildTupletRestReplacement` の3パターン（非連符/一致/不一致）
  - `planTupletGroupDeletion` のグループ境界検出（隣接する別グループを
    誤って巻き込まないこと）と休符再構成
- `docker compose run --rm app npx vitest run`: 51ファイル / 695テストすべて成功
- `docker compose run --rm app npm run build`: 成功（`tsc -b && vite build`）
- ブラウザ確認（`docker compose run --rm --service-ports app npm run dev -- --host`）:
  1. ピアノ大譜表・右手（ト音記号）に8分3連を配置 → 「3」ブラケット表示を確認
  2. 連符内の休符（2つ目）を8分音符ツールでクリック → tuplet情報を保ったまま音符に置換
  3. 左手（ヘ音記号）にも同様に配置 → 保存データの JSON を確認したところ
     `tuplet.id` が右手・左手で異なる文字列になっていることを確認
     （例: `tuplet-1784067778968-1-71o1z2` と `tuplet-1784067803482-2-utbtyz`）
  4. 左手の連符音符を選択して Delete → グループ全体が同じ長さの通常の4分休符1個に置換
  5. 元に戻す（Undo）→ 削除前の連符グループが復元
  6. 「保存」→ ページを再読み込み → 「読込」で復元 → 両手の連符表示が保たれることを確認
  7. 再生ボタンでリズム確認、コンソールエラーなし
  8. 単旋律譜（`StaffCanvas.tsx`）でも同じ手順で3連符入力・確認 → リファクタ後も
     リグレッションがないことを確認
  9. 全操作を通してブラウザコンソールにエラーなし

## 追記2: 5連符・6連符・7連符への拡張

「今回やらなかったこと」に書いていた「UIから作成できるのは3:2（3連符）のみ」という
制約を解消し、5連符（5:4）・6連符（6:4）・7連符（7:4）をパレットから配置できるように
拡張した。

### 何が最初から一般化されていたか

3連符実装時点で `NoteEvent.tuplet = { id, numNotes, notesOccupied }` は
すでに任意の N:M 比率を表現できる形になっており、以下は変更不要だった。

- `voiceMeasureUtils.tupletBeatsMultiplier()`（`notesOccupied/numNotes` を返すだけ）
- `StaffCanvas.tsx`/`PianoSystemCanvas.tsx` の `eventOccupiedBeats()`
- `RestOverlapFixV2.ts`・`ScorePlayer.ts`・`SoundFontEngine.ts`・`midiExport.ts`
- `musicXmlExport.ts`（`<time-modification>` は `ev.tuplet.numNotes`/`notesOccupied`
  をそのまま出力するだけ）・`musicXmlImport.ts`（`<time-modification>` から
  `numNotes`/`notesOccupied` を読み込むだけ）
- `storage.ts` の `validateNoteEvent`（`numNotes`/`notesOccupied` が正の整数か
  だけをチェックする一般的な検証）
- VexFlow の描画（`new Tuplet(notes, { numNotes, notesOccupied })` はコンストラクタに
  そのまま渡すだけ。VexFlow 側が比率に応じて自動的に「3」または「N:M」の表示を選ぶ）

### 実際に変更が必要だった箇所

1. **`src/utils/tupletUtils.ts`**:
   - `TupletKind`型と`TUPLET_KINDS`定数（3:2 / 5:4 / 6:4 / 7:4の一覧）を新設。
   - `buildTupletGroupPlan()` に第5引数 `tupletSpec: TupletKind` を追加
     （省略時は `DEFAULT_TUPLET_NUM_NOTES`/`DEFAULT_TUPLET_NOTES_OCCUPIED`＝3:2で
     従来通り動作する後方互換）。
   - 連符内休符の個数を固定の2個から `numNotes - 1` 個に一般化
     （`Array.from({ length: numNotes - 1 }, () => restPart())`）。
2. **`src/components/Palette.tsx`**:
   - `Tool` 型の `tuplet?: boolean` を `tuplet?: TupletKind`（`{numNotes, notesOccupied}`）
     へ変更。真偽値ではなく「どの連符か」を保持するようにした。
   - 「3連符」単独ボタンを、`TUPLET_KINDS` を map した4つのボタン
     （3連符/5連符/6連符/7連符）に置き換えた。押すたびに対応する `TupletKind` を
     `tool.tuplet` にセットし、同じ数字を再度押すと解除する（他の数字を押すと
     自動的に切り替わる）。
3. **`StaffCanvas.tsx`/`PianoSystemCanvas.tsx`**: `buildTupletGroupPlan()` の呼び出しに
   `(tool as any).tuplet` をそのまま第5引数として渡すよう1行追加しただけ
   （`(tool as any)?.tuplet` の truthy 判定はオブジェクトでもそのまま機能するため、
   分岐ロジック自体は変更不要）。

### 2連符（2:3）を対象外とした理由

2連符は「付点音価2つ分の時間に2つの音符を詰める」記譜で、8分の6拍子などの
複合拍子でのみ自然に使われる（単純拍子では「2連符なのに音価が伸びる」という
直感に反する挙動になる）。今回のタスクでは3/5/6/7連符の追加が主目的であり、
複合拍子特有の付点音価との組み合わせUIまで設計すると工数が膨らむため、
今回のスコープからは除外した。データモデル（`numNotes`/`notesOccupied`は任意の値を
受け付ける）は2連符も表現できるので、将来的にパレットへボタンを追加するだけで
対応できる。

### テスト

- `src/utils/tupletUtils.test.ts` に5/6/7連符のグループ構成・拍数のテストを追加
  （tupletSpec省略時に3連符のまま後方互換であることの確認も含む）。
- `src/utils/musicXmlTuplet.test.ts` に5連符（16分音符×5、5:4）の
  export→import ラウンドトリップテストを追加。
- `docker compose run --rm app npx vitest run`: 60ファイル / 822テストすべて成功。
- `docker compose run --rm app npm run build`: 成功。

### ブラウザ確認結果

- 単旋律譜（`StaffCanvas.tsx`）:
  - 8分音符＋5連符トグルで五線をクリック → 「5」のブラケットと、1拍（4分音符ぶん）に
    8分音符5個（音符1＋休符4）が収まって表示されることを確認。
  - 16分音符＋6連符トグルで五線をクリック → 「6:4」のブラケットと、1拍に
    16分音符6個（音符1＋休符5）が収まって表示されることを確認
    （VexFlowは3連符のときだけ単純な「3」表示になり、5/6/7連符は`N:4`という
    比率表示になる。これはVexFlow標準の挙動でありバグではない）。
  - Undo（元に戻すボタン）で直前の操作を取り消せることを確認。
  - 「保存」→ページ再読み込み→「読込」で、配置した6連符（ブラケット・音符・休符構成）が
    そのまま復元されることを確認。
  - 操作を通してブラウザコンソールにエラーが出ないことを確認。
- ピアノ大譜表（`PianoSystemCanvas.tsx`）: パレットに3/5/6/7連符ボタンが表示され、
  声部1がアクティブな状態でのみ有効になる（既存の3連符と同じ制限）ことをコードと
  単体テストで確認。実機での連符配置クリックは、ブラウザ自動操作ツール側の
  クリック座標とVexFlowの描画座標のマッピングがうまく取れず、ピクセル単位での
  目視確認は完了できなかった（単旋律譜側では同じ`buildTupletGroupPlan`呼び出しが
  正しく動作することを確認済みのため、ロジック面のリスクは低いと判断）。
  → **「声部1がアクティブなときだけ有効」という入力側の制限は Issue #168（2026-08-04）で解消。**
  声部2でも同じパレット操作で連符を置ける（あわせて、声部2の Delete が連符グループを
  まとめて通常休符へ戻すようになった）。ただし**描画側に未解決の問題が残っている**:
  追加声部の末尾休符が `GhostNote`（符幹なし）で描かれる既存仕様と連符が衝突し、
  置いた直後の「音符1＋末尾休符2」ではブラケットが描かれない。詳細と再現条件は
  `.claude/specs/piano-two-voice-implementation/design.md` の
  「声部2の連符入力への対応（Issue #168, 2026-08-04）」節を参照。

## 追記3: 連符のビームが拍単位に割れる不具合の修正（Issue #217, 2026-08-11）

### 問題

4/4・ピアノ譜で8分音符の三連符を2組続けて入力すると、ビーム（連桁＝8分音符などを
つなぐ横棒）が **2+2+2 の3組**で描かれた。正しくは連符ごとの **3+3 の2組**である。
単旋律で三連符を1組だけ置いた場合も 2+1 に割れ、余った3個目は単独になるため
束から外れて見えた（VexFlow は音符1個だけのグループをビームにしない）。

保存データ自体は正しく、6イベントすべてが `dur:'8'`・
`tuplet:{numNotes:3, notesOccupied:2}` を持ち、グループIDも2つに正しく分かれていた。
**描画だけの不具合**である。

### 原因

`PianoSystemCanvas.tsx` の声部ごとの描画で、ビーム生成が連符生成より**先**にあった。

```ts
const beams = Beam.generateBeams(vfNotes, { beamRests: false, ... });  // ← 先だった
const tuplets = createVexFlowTuplets(sourceEvents, vfNotes);           // ← 後だった
```

VexFlow の `Beam.generateBeams` は、音符の tick（拍の内部単位）を先頭から
足し上げて「1拍ぶん貯まったら束を閉じる」という方法で拍の区切りを決める
（`beam.js` の `createGroups`。既定の区切りは `Fraction(2, 8)` ＝ 4分音符1個ぶん）。
一方、連符の 2/3 倍率を各音符の tick へ掛けるのは `new Tuplet(...)` の
コンストラクタ（内部で `note.setTuplet()` → `applyTickMultiplier()` が走る）である。

したがって順序が逆だと、ビーム生成の時点では8分三連が**素の8分音符**として
数えられ、2個で1拍に達したと判断されて束が閉じてしまう。
倍率が掛かった後なら3個で 1/4（＝1拍）にちょうど達するため、連符単位で閉じる。

なお `generateBeams` には「ビームを持てない音価（4分音符以下）の連符では
区切り幅を2倍にする」という分岐（`unbeamable && note.getTuplet()`）もあり、
これも `getTuplet()` が既にセットされていること、すなわち連符生成が先であることを
前提にしている。

### 修正（最小修正・Issue の第1手段を採用）

`createVexFlowTuplets` の呼び出しを `Beam.generateBeams` より前へ移した。
Issue で第2手段として挙げられていた `generateBeams` の `groups` オプションによる
境界の明示は**採用していない**（順序を直せば VexFlow 側の tick 計算が
そのまま正しく働き、5/6/7連符や拍をまたぐケースまで自動で正しくなるため。
`groups` を使うと連符の種類ごとに区切り幅を計算して渡す必要があり、
かえって壊れやすい）。

**合同 Formatter との順序は保たれている。** 元コードのコメントが警告していた
「Tuplet を合同 Formatter より後に作ると整列が崩れる」という制約は、
Formatter（`Pass 2` の `new Formatter().joinVoices(...).formatToStave(...)`）が
声部ごとの描画エントリを作り終えた**後**に一括で走るため、今回の入れ替えでも
`Tuplet 生成 → Formatter` の前後関係は変わらない。むしろ連符生成がより早くなる
方向なので、この制約に抵触する余地はない。

### あわせて必要だった対応: 連符の括弧

VexFlow の `Tuplet` は「括弧を描くか」をコンストラクタの時点で
**「ビームの付いていない音符が1つでもあるか」**（`notes.some(n => !n.hasBeam())`）
で確定させる。連符をビームより先に作るようにすると、その時点ではまだどの音符にも
ビームが無いため、**すべての連符が括弧付き**になってしまう
（連桁でつながった連符は数字だけを書き、括弧は描かないのが浄書の慣行）。

そこで `src/utils/vexFlowTimingUtils.ts` に `syncTupletBracketsWithBeams()` を新設し、
ビームを作り終えた直後に同じ判定をやり直して `setBracketed()` で上書きする。
ビームの無い連符（4分音符の三連符や、休符を含むグループ）は従来どおり括弧付きのまま。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx` — 連符生成をビーム生成の前へ移動し、
  直後に `syncTupletBracketsWithBeams()` を呼ぶ（全譜種・全声部が通る唯一の描画経路）
- `src/utils/vexFlowTimingUtils.ts` — `syncTupletBracketsWithBeams()` を追加、
  `createVexFlowTuplets` のコメントに「ビーム生成より先に呼ぶ」制約を明記
- `src/utils/vexFlowTimingUtils.test.ts` — 描画側と同じ順序でビームを組み、
  束ごとの音符数（3+3 / 3 / 5 / 2+2+2）と括弧の有無を固定
- `src/components/PianoSystemCanvasTupletBeamGrouping.test.tsx`（新規） —
  実際に描画された SVG の `<g class="vf-beam">` に入る符幹（`g.vf-stem`）の数で
  束の中身を数える回帰テスト。声部2の三連符・5連符・連符なしの拍単位ビームも含む

`StaffCanvas.tsx` は既に廃止されており、`Beam.generateBeams` の呼び出しは
リポジトリ全体で `PianoSystemCanvas.tsx` の1か所だけなので、単旋律譜・ピアノ譜・
四重奏・編成譜のすべてがこの1か所の修正で直る。

## 追記4: 連符グループ削除で生まれる休符が異常位置に置かれる不具合の修正（Issue #226, 2026-08-12）

### 問題

連符グループを削除すると同じ実長の通常休符に置き換わるが、その休符の表示位置が
`c#/2`（ト音記号の五線のはるか下＝ヘ音記号の五線の上あたり）になるケースを
運用者の実機テスト（月光 第4小節）で確認した。ユーザーには
「右手の休符が消えて、左手に謎の休符が出た」ように見える。

さらに悪いことに、この休符は当たり判定・選択判定の固定Y窓（五線 ± 3加線、
`CHORD_LEDGER_TOP` / `CHORD_LEDGER_BOT`）の外にいるため **クリックで選択できず、
`0` キーの標準位置リセットも届かない**。アプリ内で修復する手段が無い状態になる
（Issue #218 で選択窓が広がれば救出はできるが、そもそも異常位置に生まれないように
するのが本Issueの主旨）。

### 原因

`src/utils/tupletUtils.ts` の `planTupletGroupDeletion`:

```ts
const restKeyForGroup = groupEvents[0]?.keys[0] || defaultRestKey;
```

置き換え休符の表示位置に **消したグループの先頭の音の音高をそのまま使っていた**。
音が五線の近くにあれば「休符が元の音の高さに残る」ので自然だが、極端な音高
（Issue #219 の誤帰属で入り込んだ音など）だと、その異常な高さがそのまま休符に
引き継がれてしまう。

### 修正設計

**「引き継いでよい範囲」を決めて、範囲外なら音価ごとの標準位置へフォールバックする。**

- 判定は新設の純関数 `canInheritRestDisplayKey(clef, key)`（`tupletUtils.ts`）
  - 範囲は **五線 ± 2加線**（line で `-2`〜`6`。line は五線最上線が 0、加線1本ぶんが 1）
  - なぜ ±2 か: 選択・当たり判定の固定Y窓が **五線 ± 3加線** なので、その内側に
    収めておけば、生まれた休符は必ずクリックで選択でき `0` キーでも救出できる。
    「直せない休符を作らない」ことを範囲の根拠にしている
  - `keyToLine` は解釈できないキーに対して `2`（五線中央）を返すため、
    先に `isValidNoteKeyString` で妥当性を確かめる。これを省くと
    「壊れたキー＝範囲内」と誤判定してそのまま保存してしまう
- フォールバック先は `defaultRestDisplayKeyForDuration(clef, duration)`。
  全休符だけ標準位置が違う（第4線ぶら下げ）ため、休符1個ごとに音価を見て決める。
  そのため `buildRestEventsForBeatsShared` は固定キーではなく
  **キーを返す関数**（`(duration) => string`）を受け取る形に変えた
- clef はそのパートのものを使う。同じ `c/2` でもヘ音記号なら下方2加線（範囲内）、
  ト音記号なら遥か下（範囲外）で、判定は音部記号なしには決まらないため

### 呼び出し規約の変更（clef の受け渡し）

`planTupletGroupDeletion` / `deleteEventFromMeasures` / `deleteVoiceEventFromMeasures`
の最後の引数を **`defaultRestKey: string` から `clef: ClefType` へ変更**した。

- 呼び出し元（`PianoSystemCanvas.tsx` の2か所）は元々 `defaultRestKeyForClef(clef)` を
  渡していたので、渡す情報が「clef から作った1つのキー」から「clef そのもの」に戻っただけ
- 省略可能な追加引数にはしなかった。範囲判定に clef が要る以上、渡し忘れた呼び出しは
  黙って旧挙動（クランプなし）に戻ってしまい、同じ不具合が再発するため
- 副次的な改善として、グループ先頭に `keys` が無い場合のフォールバックも
  音価ごとの標準位置になった（従来は音価によらず五線中央）

### 通常音符（連符以外）の削除に同じ継承があるかの確認結果

Issue の指示により、休符が他イベントの音高を引き継ぐ経路を全て洗い出した。

| 経路 | 継承の有無 | 対応 |
| --- | --- | --- |
| `planTupletGroupDeletion`（連符グループ削除） | **あり**（消した音の音高） | 本修正でクランプ |
| `deleteEventFromMeasures` の通常削除（手順3） | なし（イベントを `splice` するだけで休符を作らない） | 対応不要 |
| `deleteEventFromMeasures` の和音1音削除（手順2） | なし（`keys` から1つ除くだけ） | 対応不要 |
| `buildRestEventsForBeats`（`PianoSystemCanvas.tsx`・小節の自動補完） | なし（`defaultRestDisplayKeyForDuration`） | 対応不要 |
| `buildRestEditReplacement` の休符分割（`PianoSystemCanvas.tsx:360` 付近） | **休符の**キーを引き継ぐ（音符のキーではない） | 対応不要。引き継ぎ元は休符自身なので、異常位置の休符が存在しなければ異常位置は生まれない。本修正で「異常位置の休符を作らない」側を塞いだ |
| `sanitizeRenderEvent`（描画直前の丸め） | 文字列として妥当かだけを見る（`c#/2` は妥当なので通る） | 対応不要。ここは描画の防波堤であり、位置の妥当性はデータを作る側で担保する方針 |

### 影響範囲

- `src/utils/tupletUtils.ts` — `canInheritRestDisplayKey` を新設、
  `planTupletGroupDeletion` の第3引数を clef 化、`buildRestEventsForBeatsShared` を
  キー解決関数受け取りに変更
- `src/utils/noteDeletionUtils.ts` — `deleteEventFromMeasures` /
  `deleteVoiceEventFromMeasures` の最終引数を clef 化（内部で `planTupletGroupDeletion` へ渡すだけ）
- `src/components/PianoSystemCanvas.tsx` — Delete/Backspace の2か所（声部1・声部2）が
  `defaultRestKeyForClef(clef)` ではなく `clef` を渡す
- `src/utils/tupletUtils.test.ts` — 範囲内継承・範囲外フォールバック・壊れたキー・
  `keys` 無し・全休符のフォールバック位置・音部記号ごとの範囲差を固定
- `src/utils/noteDeletionUtils.test.ts` — 新しい引数（clef）に追従

単旋律譜・ピアノ譜・四重奏・編成譜のすべての削除がこの2関数を通るため、
譜種ごとの分岐は増やしていない。
