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

> **更新（Issue #283, 2026-08-16）**: この節の仕様は**単音の削除についてのみ**下の
> 「追記11」で変更した（グループを残して、その位置だけを**同じ音価の連符内休符**にする）。
> 上で見送った案は「1音だけ消して残りの休符2つはそのまま」＝**イベントを1つ減らす**案であり、
> 半端な音価が残るという問題があった。追記11 の方式は**イベント数も各音価も変えない**ので
> その問題は起こらない。グループ全体を通常の休符へ畳む挙動自体は、
> 「グループに音符が残らなくなったとき」の結果として今も残っている。

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

## 追記4: 休符を連符グループで置き換えられるようにする（Issue #224, 2026-08-12）

### 問題

満杯の小節で連符グループを削除すると、上記「削除セマンティクス」のとおり
同じ長さの通常休符に戻る（例: 8分3連 → 4分休符1個）。ところがその休符を
**連符ツールでクリックしても連符に戻せなかった**ため、「連符 → 休符」が
一方通行になり、入れ直す手段が Undo しか無かった（運用者の実機テスト・月光4小節目）。

原因は入力経路が2つしか無く、どちらも満杯の小節では機能しなかったことである。

1. `doInsert()` の連符分岐は「小節の空き拍へグループを追加する」経路なので、
   満杯の小節では `currentBeats + groupBeats > beatsPerMeasure` のガードで何もしない
2. 休符クリックの置換 `buildRestEditReplacement()` は音価ツールぶんの分岐しか持たず、
   連符ツールが選ばれていても**普通の8分音符として**休符を置換・分割していた
   （休符本体から外れた位置のクリックは 1 の `doInsert()` へ回るため、
   満杯の小節では「何をしても無反応」に見えていた）

### 修正設計

**「休符が持っている拍を、そのまま連符グループへ両替する」**という考え方にした。
小節全体の空き拍は増減しないので、満杯の小節でも成立する。

- `src/utils/tupletUtils.ts` に `planTupletReplacementForRest()` を新設
  - 対象は**連符ではない普通の休符**だけ。連符内の休符は従来どおり
    `buildTupletRestReplacement()`（同音価のときだけ音符へ置換する保守的な仕様）に任せる。
    ここで新しいグループを作ると連符が入れ子になって壊れるため、判定の順序も仕様のうち
  - 休符の拍数 ≧ グループの拍数 のときだけ計画を返す。足りなければ `null`（＝何もしない）
  - 余りは**拍数だけ**を返し、どの音価の休符へ割るかは呼び出し側に任せる
    （余りの休符の描画位置は音部記号ごとの標準位置が要り、その知識は
    `PianoSystemCanvas` 側の `buildRestEventsForBeats()` にあるため）
- `PianoSystemCanvas.buildRestEditReplacement()` に連符ツールの分岐を追加し、
  余りの休符を組み立てるために引数 `clef` を追加した
- 置き換え後の並びは **「連符グループ → 余りの休符」の順**で固定した。
  通常の分割はクリック位置で音符を前後どちらへ寄せるか決める（`noteAfterRest`）が、
  連符では採用していない: グループの途中に休符が割り込むと連符の内訳が読みにくく、
  ブラケットの範囲も直感に反するため
- ホバー中のカーソルは、連符ツールで休符本体に乗ったときだけ
  「置ける＝`copy` / 置けない＝`not-allowed`」に分けた。判定には**クリック時と同じ
  `buildRestEditReplacement()` をそのまま通している**（別の式で近似するとホバー表示だけ嘘になる）

### 仕様として残した点

- **置換は従来どおり「1回目のクリックで選択 → 2回目で置換」の2段階**。休符編集全体の
  操作体系なので、ここだけ1クリックにはしていない（この2段階そのものの見直しは Issue #233）
- 休符が短くて置けないときは何もしない。休符本体から外れたクリックは従来どおり
  `doInsert()` へ回るので、空きがある小節では末尾へグループが追加される（既存挙動）

### 影響範囲

- `src/utils/tupletUtils.ts` — `planTupletReplacementForRest()` と拍数比較用の `BEATS_EPS` を追加
- `src/components/PianoSystemCanvas.tsx` — `buildRestEditReplacement()` に連符分岐と `clef` 引数、
  ホバーカーソルの分岐（全譜種・全声部が通る唯一の経路。`StaffCanvas.tsx` は廃止済み）
- `src/utils/tupletUtils.test.ts` — `planTupletReplacementForRest` の単体テスト8件
- `src/components/PianoSystemCanvasRestToTuplet.test.tsx`（新規） — 実際に休符をクリックして
  データと描画（`g.vf-tuplet`）まで確かめる回帰テスト6件
## 追記5: 連符内の和音で1音だけ削除するとグループごと消える不具合の修正（Issue #223, 2026-08-12）

### 問題

三連符の中の音符に和音（例: `f#/3` + `g#/3`）を作ったあと、片方の符頭を選んで
Delete すると、**その1音だけでなく三連符グループ全体が4分休符に置き換わる**。

選択そのものは符頭単位で正しく成立していた（`selected.keyIndex` に押した符頭の
位置が入っている）。壊れていたのは削除側の判定順序だった。

### 原因: 判定の順序（「削除セマンティクス」との衝突）

`src/utils/noteDeletionUtils.ts` の `deleteEventFromMeasures` は3つの分岐を
上から順に評価するが、その順番が

1. 連符内イベント → グループごと休符化（`if (targetEv.tuplet)` で即 return）
2. 和音中の1音削除（`keyIndex` 指定時）
3. イベント自体の削除

になっていた。**連符の中の和音は 1 と 2 の両方に当てはまる**ため、必ず先に来る 1 に
飲み込まれ、`keyIndex`（どの符頭を選んだか）が読まれないまま return していた。

つまり「連符は部分削除しない」という上の『削除セマンティクス（設計判断）』の節の
仕様が、**本来その対象ではない「和音の構成音を1つ減らす」操作にまで効いていた**、
というのが本件の正体である。和音から1音減らしても連符グループの
イベント数・音価・`notesOccupied/numNotes` 比率はどれも変わらないので、
この操作に「グループごと休符化」を適用する理由は無い。

### 修正: 和音1音削除を連符判定より先に評価する

分岐の順序を **和音1音削除 → 連符グループ削除 → イベント削除** に入れ替えた
（判定式そのものは1文字も変えていない）。

- 和音1音削除の条件はもともと `keys.length > 1` を含むので、**連符内の単音**は
  この分岐に入らず、従来どおり分岐2（グループごと休符化）へ落ちる
- 新しいイベントは `{ ...targetEv, keys, arcs }` の形で作るため `tuplet` は
  そのまま引き継がれる。グループの構成イベント数も音価も変わらない
- 和音の**最後の1音**を消す場合（`keys.length === 1`）も分岐2へ落ちる。音符そのものが
  消える以上、グループごと休符に置き換えるのが正しい
- 連符内の休符は `isRest` かつ `keys.length === 1` なので、これも従来どおり分岐2

判定順序そのものが仕様なので、`deleteEventFromMeasures` の JSDoc に
「順序も仕様のうち」と明記し、コード側にも理由をコメントで残した。

### 影響範囲

- `src/utils/noteDeletionUtils.ts` — `deleteEventFromMeasures` の分岐順序と JSDoc・コメント
- `src/utils/noteDeletionUtils.test.ts` — 連符内和音の1音削除／連符内単音・休符の
  グループ削除維持／連符外の和音1音削除、の単体テストを追加（受入条件4）

`deleteEventFromMeasures` の呼び出し元は `PianoSystemCanvas.tsx` の Delete/Backspace
ハンドラ1か所だけ（`StaffCanvas.tsx` は廃止済み）なので、単旋律譜・ピアノ譜・四重奏・
編成譜のすべてがこの1か所で直る。

### 声部2（voices[1]）は今回のスコープ外

声部2の削除を担当する `deleteVoiceEventFromMeasures` は **`keyIndex` を引数に持たず**、
呼び出し側（`PianoSystemCanvas.tsx` の `sel.voiceIndex` 分岐）も渡していない。
つまり声部2では和音の1音削除がそもそも実装されておらず、和音を選んで Delete すると
イベントごと（連符ならグループごと）消える。これは本 Issue の症状とは別の未実装事項
なので、順序の入れ替えでは直らないし、今回は触っていない。

> **解消済み（Issue #280, 2026-08-16）**: この未実装事項は下の「追記9」で解消した。
> 判定の分岐そのものを純関数 `planEventDeletion` へ共通化し、声部1・声部2の両方が
> 同じ1本を通るようにしてある（コピーが2本あったことが本件の再発原因だったため）。


## 追記6: 連符グループ削除で生まれる休符が異常位置に置かれる不具合の修正（Issue #226, 2026-08-12）

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
## 追記6: 休符→音符の置き換えを1クリックにする（Issue #233, 2026-08-13）

### 問題

連符グループの休符を音符に置き換えるとき、**1回目のクリックが休符の選択・2回目でようやく置換**
になっていた。三連符が主体の曲では全音符数の 2/3 がこの2クリック操作になり、入力テンポを
大きく削ぐ（運用者の実機テスト: 月光第1楽章は三連符が約700個 ＝ 余分なクリックが約1400回）。

原因は `PianoSystemCanvas.tsx` の休符クリック処理にあった `isSameRestSelected` ガード
（「いま選択されている休符と同じものをクリックした場合だけ置換する」）である。
これは Delete・↑/↓ の対象にするために休符を選択できるようにした副作用で、
**音符を置くつもりのクリックにまで選択ステップを課していた**。

### 修正設計

`isSameRestSelected` ガードを撤去し、`buildRestEditReplacement()` が置換結果を返せるなら
**その場で置換する**。置換ロジック（`buildRestEditReplacement` / `buildTupletRestReplacement` /
`planTupletReplacementForRest`）自体は一切変更していない。

キモは **ツール判定をクリック側に二重に書かないこと**。`buildRestEditReplacement()` は
もともと以下のときに `null` を返す:

- `getDurationTool(tool)` が `null`（音価を持たないツール ＝ 調整ツールなど）
- `durationTool.isRest` が `true`（休符ツール）

つまり「音符を置かないツールでは従来どおり選択」という受入条件は、**戻り値が `null` かどうか**
だけで自動的に満たされる。クリック側に `isRest` の判定を新設すると、置換の可否判定と
ツール判定が二重管理になり、片方だけ直したときにホバー表示とクリック結果がずれる。

置換できないクリック（＝ `null`）は **選択だけで終える**ようにした（下の「休符本体のクリックから
`doInsert()` を外した理由」を参照）:

| 選んでいるツール | 休符本体クリックの結果 |
|---|---|
| 音価ツール（音符側）で置換可能 | **1クリックで置換・分割**（本 Issue で変更） |
| 音価ツール（音符側）で置換不可 | 選択のみ（本 Issue で変更。以前は選択 → `doInsert()`） |
| 休符ツール・調整ツール | 選択のみ（本 Issue で変更。以前は選択 → `doInsert()`） |

休符**本体の外側**（`isOnRest` が false）のクリックは従来どおり `doInsert()` へ流れるので、
「休符の隣に音符・休符を置く」操作は何も変わらない。

### 休符本体のクリックから `doInsert()` を外した理由（ブラウザ実機で発見）

受入条件3の確認中に、**休符ツールで連符内の休符を選ぼうとしただけで連符グループが壊れる**
ことが分かった（`g.vf-tuplet` が 1 → 0、ブラケットと数字が消える）。空き拍のある小節では
`doInsert()` がグループの真ん中へ休符を割り込ませるためである。

これは1クリック化以前からある挙動だが、本 Issue で「休符を選びたいときは休符ツール」が
**唯一の選択手段**になったため、受入条件3（0キーリセット・位置調整の入口を残す）が
実質的に成立しなくなる。またホバーカーソルを `not-allowed` に広げた以上、
「置けないと表示しておきながらクリックすると何かが挿入される」のは表示と挙動の食い違いでもある。

そのため、休符**本体**のクリックは「置換できるなら置換／できないなら選択のみ」に統一した。

### ホバーガイドを音価ツール全体へ広げた

Issue #224 で入れた「置ける＝`copy` / 置けない＝`not-allowed`」のカーソル分けは、
**連符ツールのときだけ**の表示だった。1クリックで確定するようになったぶん
「押す前に結果が分かる」ことの重要性が上がるため、判定条件を
`(tool as {tuplet?}).tuplet` から `getDurationTool(tool)` の音符側全体へ広げた。
判定にクリック時と同じ `buildRestEditReplacement()` を通す点は #224 から変えていない
（別の式で近似するとホバー表示だけ嘘になる）。

これで、たとえば「2分音符ツールで連符内の8分休符」のように**音価が合わず置換できない**
組み合わせでも、押す前に `not-allowed` で分かる。

### 誤クリックの扱い

Undo（1操作＝1履歴）で足りると判断した（トリアージの指示どおり）。
置換は `setScore` 1回なので、履歴も1エントリしか積まれない
（`PianoSystemCanvasOneClickRestReplace.test.tsx` の受入4で `onChange` の回数として固定）。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx` — 休符クリックの `isSameRestSelected` ガード撤去、
  休符本体クリックの `doInsert()` フォールバックを撤去、
  ホバーカーソルの条件を音価ツール全体へ拡張（全譜種・全声部が通る唯一の経路。
  `StaffCanvas.tsx` は廃止済みなので単旋律譜もここを通る）
- `src/components/PianoSystemCanvasOneClickRestReplace.test.tsx`（新規） — 受入条件1〜4＋
  ホバーカーソルの回帰テスト6件（うち4件は修正前だと失敗することを逆検証済み）
- `src/components/PianoSystemCanvasRestToTuplet.test.tsx` — `clickRestTwice` を `clickRest` へ
- `src/components/PianoSystemCanvasVoice2Tuplet.test.tsx` — 連符内休符の置換を1クリックへ
- `src/components/PianoSystemCanvasVoice2Editing.test.tsx` — 「休符を選択して0キー」のテストは
  **休符ツール**を選ぶよう変更（音価ツールでは選択にならなくなったため）
- `docs/editing-selection-and-rests.md` / `docs/DEVELOPMENT.md` / `README.md` — 操作の説明を更新

### 上の「仕様として残した点」の更新

追記4（Issue #224）に書いた「**置換は従来どおり2段階**」は、本 Issue で 1 クリックへ変更した。

### レビューで見ていただきたい点

上記のとおり「休符本体クリックでは挿入しない」へ変えたぶん、**休符本体の真上をクリックして
音符・休符を追加する**操作はできなくなった（本体の外側をクリックすれば従来どおり追加できる）。
受入条件3を成立させるために必要と判断したが、意図と違えば戻せる独立した変更である。

---

## 追記7: 連符グループ削除で弧・松葉の終点が付け替わらない不具合の修正（Issue #245, 2026-08-14）

### 問題

連符グループを削除すると、**同じ小節の後ろにある音符へ張られていたスラー・松葉が、別の音符に張り替わる**。
グループ内の音符を終点にしていた弧は、終点の音符が消えたのに弧だけが残る（ダングリング）。

出所は Codex レビュー試験運用の指摘（2026-08-11）で、レビュアーがコード検証のうえ起票した。

再現は回帰 fixture（`docs/qa/regression/moonlight-bars1-9.score.json`）の3小節目がそのまま使える。
この小節は 8分3連符が4グループ並び、索引0のスラーが索引5を、索引6のスラーが索引11を指している。
先頭グループ（索引0〜2）を削除すると 4分休符1個に縮む＝**後続の索引が2つずれる**ため、
索引6→4へ移動したスラーの終点だけが 11 のまま取り残され、10件に縮んだ配列の範囲外を指す。

### 原因: 規則2だけが「削除後の後始末」を通っていなかった

`src/utils/noteDeletionUtils.ts` の `deleteEventFromMeasures` は3つの規則を順に評価する。

| 規則 | 内容 | 弧・松葉の後始末 |
| --- | --- | --- |
| 1 | 和音の1音だけ削除（#223 で連符判定より先へ） | あり（`fromKey` / `toKey` 一致で除去） |
| 2 | 連符グループを休符へ置き換え | **無かった**（splice して即 return） |
| 3 | イベント自体を削除 | あり（終点一致で除去・後続を1繰り上げ） |

規則3は「削除イベントを終点とする弧の除去」と「同小節で後続を指す `toEventIndex` の繰り上げ」を
全小節走査で行っていたが、規則2は `plan.replacement` で splice した直後に `return` しており、
この処理へ一度も到達しない。イベントが3件→1件に縮む規則2のほうが、実はずれ幅が大きい。

なお**声部2側（`deleteVoiceEventFromMeasures`）は正しかった**。声部2は #188（段2）の実装時に
「連符グループ削除でも区間ぶん繰り上げる」形（`shift = 削除件数 − 挿入件数`）で作られており、
声部1だけが古い実装のまま取り残されていた。

### 修正設計: 後始末を1本のヘルパーへ集約する

トリアージの指示どおり、規則1・規則3で重複実装せず共通ヘルパーに抽出した。
すでに声部2用として存在していた `remapVoiceEventRefsAfterRemoval` が求める処理そのものだったので、
これを `remapEventRefsAfterRemoval` へ改名してファイル前方へ移し、声部1・声部2の共通ヘルパーにした。

```
remapEventRefsAfterRemoval(events, measure, removeStart, removeEnd, shift)
  - 終点が [removeStart, removeEnd] の範囲内 → その弧・松葉ごと除去（ダングリング防止）
  - 終点が removeEnd より後ろ         → shift ぶん繰り上げ
  - 変化が無ければ引数の events をそのまま返す（参照比較で「変わっていない」を判定できる）
```

声部1は「別の小節から張られた弧」も直す必要があるため、全小節へ適用する薄いラッパー
`remapAllMeasuresAfterRemoval` を足した。これで各規則の呼び出しは次の1行になる。

- 規則2（連符グループ）: `remapAllMeasuresAfterRemoval(next, measure, plan.groupStart, plan.groupEnd, removeCount - plan.replacement.length)`
- 規則3（通常削除）: `remapAllMeasuresAfterRemoval(next, measure, index, index, 1)`

繰り上げ量が「グループの件数」ではなく「**削除件数 − 置き換えで挿入した件数**」である点に注意する。
連符グループ削除は同じ拍数の休符を挿し込むので、8分3連符3個 → 4分休符1個なら 3−1=2 である。
（声部2側が先にこの形になっており、今回それに合わせた。）

**呼び出し順序**: 付け替えは splice の**前**に行う。`arcs` が持つ索引は削除前の並びを指しているため、
先に splice すると `removeStart`〜`removeEnd` の意味がずれる。規則3も従来の「splice → 走査」から
「走査 → splice」へ入れ替えたが、削除対象イベント自身は結局 splice で消えるため結果は同じである。

### あわせて修正: plan が null のときに複製を返していた

規則2は `planTupletGroupDeletion` が `null`（＝`tuplet.id` が空などでグループを辿れない）でも
複製した `next` を返しており、JSDoc の「変更が無い場合は引数の measures をそのまま返す」と矛盾していた。
呼び出し側が参照比較で「変わっていない」を判定できなくなるため、`null` のときは `measures` を返す。

### 声部間の索引の独立（変えていない点）

共通ヘルパーが走査するのは渡された1声部の `events` だけで、`remapAllMeasuresAfterRemoval` も
`m.events`（＝声部1）しか触らない。声部2以降の `toEventIndex` / `endEvent` は
「その声部の events 配列内の位置」を意味する（`.claude/specs/voice2-arc-support/design.md` §2 案A）ため、
声部1の増減で動かしてはいけない。この不変条件はテストで固定した。

### 影響範囲

- `src/utils/noteDeletionUtils.ts` — 共通ヘルパーの抽出・改名と前方移動、規則2への適用、
  規則3を共通ヘルパー経由へ、`plan === null` 時に `measures` を返す
- `src/utils/noteDeletionUtils.test.ts` — Issue #245 の受入条件ぶん7件を追加
  （うち fixture 由来3件。**7件とも修正前だと失敗することを逆検証済み**）
- 既存の削除仕様（規則1の和音1音削除・規則3の通常削除・声部2の削除）は**挙動不変**。
  既存テスト28件がそのまま緑であることで固定されている

---

## 追記8: 連符数字をグループ単位で非表示にできるようにする（Issue #269 段1, 2026-08-15）

### 問題

同じ連符が続く曲では、連符数字（3 等）は最初のグループ（または最初の1〜2小節）にだけ書き、
以降は省略するのが浄書の標準（Gould, *Behind Bars*）。月光第1楽章の市販譜も1個目だけに "3" が付く。
アプリは全グループに数字を出すため、三連符が主体の曲では紙面が数字だらけになる。

### データモデル

`NoteEvent['tuplet']` に `hideNumber?: boolean` を足した（`src/types/storage.ts`）。

- **省略時（undefined）は従来どおり表示**。既存の保存データ・サンプル譜面の見た目は1ドットも変わらない
- 表示へ戻すときは `false` を書かず**プロパティごと削除**する。保存データが旧データと同じ形に戻り、
  「`hideNumber: false` と undefined のどちらが正か」を後続の実装が考えなくて済む
- 値はグループ内の**全イベント**に付ける。描画が見るのは先頭イベントの情報だけだが、
  先頭を消しても設定が残り、MusicXML 書出でも「どれが先頭か」に依存せず判定できる
- `storage.ts` の検証にも「boolean か undefined」を追加した（壊れた値を読み込ませない）

### 「数字を隠す」は括弧も隠す（設計判断）

VexFlow 5 の `Tuplet` には**数字だけを消すオプションが無い**。`Tuplet.draw()` は
`textElement.renderText(...)` を必ず呼ぶため、`setBracketed(false)` を使っても数字は残る。
`textElement` を空にすると、括弧が中央で10px 途切れた「穴あき括弧」になる。

そこで **hideNumber のグループは `draw()` そのものを呼ばない**（`PianoSystemCanvas.tsx` の描画ループ）。
これは実装の都合だけでなく浄書慣行にも合う。連続する連符で数字を省略するときは、括弧も省くのが標準
（Issue 本文の「数字なし・ブラケットなしのビーム連符」＝月光の形）である。ビームでつながった連符は
そもそも括弧を描かない（`syncTupletBracketsWithBeams`）ため、月光のケースでは数字が消えるだけになる。

**Tuplet オブジェクト自体は隠すときも必ず作る。** 音符の tick に連符の倍率（3連符なら 2/3）を掛けるのは
`Tuplet` のコンストラクタ（`attach()` → `note.setTuplet()`）だからで、作るのをやめると
拍が合わなくなり、ビームも連符単位（3+3）ではなく拍単位（2+2+2）に割れる（Issue #217 と同じ壊れ方）。
「作るが描かない」を守ること。

`createVexFlowTuplets` の戻り値は `Tuplet[]` から `RenderedTuplet[]`（`{ tuplet, hideNumber }`）へ変えた。
WeakSet などの隠し状態ではなく戻り値の型で持たせたのは、描画側が「なぜ draw を飛ばすのか」を
型から追えるようにするため。`measureLayoutUtils.ts` は戻り値を使っていないので影響しない。

### UI（記号調整系と同じ流儀）

パレットに `{ mode: 'tupletNumberToggle' }` を足した。ボタン（取り消し線付きの「3」）を押してから
連符の音符をクリックすると、そのグループの `hideNumber` が反転する。臨時記号・強弱と同じ
「モードを選ぶ → 対象をクリック」の操作体系に揃えてある。

- **連符内休符をクリックしても効く**。グループの途中が休符のままの譜面でも押せる位置を広く取るため
- 連符でない音符・背景をクリックしたときは `setScore` を呼ばない。
  ここで `withVoiceEventsUpdated` を通すと、声部2モードのとき中身の無い `voices[1]` が生まれる（#112 の教訓）
- 声部2でもそのまま使える（`getVoiceEvents` / `withVoiceEventsUpdated` 経由のため）
- 取り消しは既存の Undo（`Cmd/Ctrl+Z`）に乗る（`setScore` を1回呼ぶだけなので特別扱い不要）

### MusicXML 書出

`<tuplet type="start" number="1" bracket="no" show-number="none"/>` を出す（`musicXmlExport.ts`）。
アプリ側が「数字を消したら括弧も消す」挙動なので、`show-number="none"` だけでなく `bracket="no"` も付けて
他ソフトでも同じ見た目になるようにした。停止タグ（`type="stop"`）には付けない（開始タグの属性で
グループ全体の表示が決まるため）。`hideNumber` が無いときの出力は1バイトも変わらない。

### 今回やらなかったこと

- **MusicXML 読込は未対応**（`show-number` を読んで `hideNumber` を復元しない）。
  読込側はもともと `<notations><tuplet>` を見ておらず `<time-modification>` の連続でグループを判定しているため、
  対応するとパーサの構造に手が入る。トリアージの範囲（書出）に絞った。**往復すると非表示指定は失われる**
- **段2（同一音価の連符が連続するときの自動省略）は別Issue**（Issue #269 本文の段2）。
  今回のトグルは完全に手動で、既存譜面が無断で変わることはない

### 影響範囲

- `src/types/storage.ts` — `tuplet.hideNumber?: boolean`
- `src/utils/tupletUtils.ts` — `toggleTupletNumberVisibility`（グループ全体を反転する純関数）
- `src/utils/vexFlowTimingUtils.ts` — 戻り値を `RenderedTuplet[]` へ、`syncTupletBracketsWithBeams` の引数型
- `src/components/PianoSystemCanvas.tsx` — `RenderedTuplet` 型の受け取り、hideNumber なら描画スキップ、
  `tupletNumberToggle` モードのクリック処理と背景クリックのガード
- `src/components/Palette.tsx` — ツール型とトグルボタン
- `src/utils/musicXmlExport.ts` — `show-number` / `bracket` 属性
- `src/utils/storage.ts` — 読込時の型検証
- テスト: `tupletUtils.test.ts`(5) / `vexFlowTimingUtils.test.ts`(2) / `musicXmlTuplet.test.ts`(2) /
  `PianoSystemCanvasTupletHideNumber.test.tsx`(5・新規)

---

## 追記9: 声部2で和音の1音だけを削除できない不具合の修正（Issue #280, 2026-08-16）

### 問題

ピアノ譜の**声部2**で和音の1つの符頭を選んで Delete すると、その1音ではなく
**イベントごと**（連符の中の和音なら**グループごと休符化**）消える。音高を変えて
同音でない和音にしても同じで、追記5（Issue #223）で直したはずの
「和音1音削除はグループ維持」が声部2ではまったく効いていなかった。

連符の中に限った話ではない。**連符でない普通の和音**でも声部2では1音削除ができず、
和音全体が消えていた。

| | 声部1 | 声部2（本Issue以前） |
| --- | --- | --- |
| 普通の和音の1音削除 | ✅ 当初から | ❌ 和音ごと消える |
| 連符内の和音の1音削除 | ✅ 追記5（#223） | ❌ グループごと休符化 |

### 原因: 同じ仕様のコピーが2本あった

削除の判定順序（**和音1音 → 連符グループ → イベント全体**）そのものが仕様なのに、
`noteDeletionUtils.ts` にはその判定が2本存在していた。

- `deleteEventFromMeasures`（声部1・`measure.events` を読み書き）
- `deleteVoiceEventFromMeasures`（声部2・`voices[n].events` を読み書き。#188 で導入）

後者は前者から連符グループ削除だけを写した実装で、**和音1音削除の分岐がそもそも無く**、
`keyIndex`（どの符頭を選んだか）を受け取る引数すら持っていなかった。
呼び出し側（`PianoSystemCanvas.tsx` の `sel.voiceIndex` 分岐）にも
「声部2の削除はイベント丸ごとが対象なので keyIndex は渡さない」というコメント付きで
割り切りが残っていた。追記5 の修正が声部1のコピーにしか届かなかったのは、この構造が原因である。

### 修正: 判定を1本にし、書き込みだけ容器ごとに分ける

トリアージ（2026-08-14）が示した「望ましい形」に従い、**コピーへ分岐を足すのではなく中核を共通化**した。

```
planEventDeletion(events, index, keyIndex, clef) → EventDeletionPlan | null
  | { kind: 'chordKey'; removedKey; nextEvent }
  | { kind: 'splice'; removeStart; removeEnd; replacement; shift }
```

- **判定（何をどう変えるか）は純関数1本**。イベント列を読むだけで、どの容器のものかを知らない
- **書き込みだけを各関数が担当する**。声部1は `cloneMeasures` した `m.events` を、
  声部2は `voices[voiceIndex].events` を、それぞれ計画どおりに書き換える
- 和音1音削除で必要な「消えた符頭を `toKey` で指す弧の掃除」も
  `purgeArcsToRemovedKey`（変化が無ければ引数の配列をそのまま返す）へ抽出し、両方から呼ぶ
- 副産物として、声部1の分岐2（連符グループ）と分岐3（イベント削除）が
  `splice` プラン1つに畳まれた（分岐3は `removeStart===removeEnd`・`replacement=[]`・`shift=1` の特別な場合）

`deleteVoiceEventFromMeasures` の引数に `keyIndex` を追加し（声部1側と同じく `clef` の手前）、
`PianoSystemCanvas.tsx` の声部2分岐から `sel.keyIndex` を渡すようにした。
削除通知（#238）の `describeDeletedNoteEvent` にも同じ `keyIndex` を渡しているので、
文言が「3連符グループを削除しました」から「和音の1音を削除しました」へ正しく変わる。

### 声部2側の挙動が1点だけ変わった（意図的）

修正前の `deleteVoiceEventFromMeasures` は、連符イベントに対して
`planTupletGroupDeletion` が `null`（グループ範囲を特定できない壊れたデータ）を返したとき、
**そのイベント1件だけを splice して**いた。共通化により、この場合は声部1と同じく
**引数の `measures` をそのまま返す**（＝何もしない）ようになった。
「変更が無ければ引数の参照をそのまま返す」という約束（追記7 / Issue #245）が
声部2にも揃ったことになる。テストで固定してある。

### 変えていない点

- **和音の最後の1音**（`keys.length === 1`）の Delete は従来どおりグループごと休符化する。
  音符そのものが消える以上、連符の音価バランスを保つには置き換えが正しい（追記5 と同じ理由）
- 声部ローカルな索引解釈（`.claude/specs/voice2-arc-support/design.md` §2 案A）。
  声部2の削除は同じ声部の `events` しか走査せず、声部1の `arcs` / `hairpins` には触れない
- 声部2を持たない小節はオブジェクトごと元の参照を返す（空の `voices[1]` を作らない・#112 の教訓）

### 影響範囲

- `src/utils/noteDeletionUtils.ts` — `planEventDeletion` / `purgeArcsToRemovedKey` の抽出、
  両削除関数を「計画 → 適用」の形へ、`deleteVoiceEventFromMeasures` に `keyIndex` 引数を追加
- `src/components/PianoSystemCanvas.tsx` — 声部2の Delete で `keyIndex` を削除処理と通知の両方へ渡す
- `src/utils/noteDeletionUtils.test.ts` — 既存の呼び出しへ `undefined` を補い、
  Issue #280 の回帰テスト9件を追加（連符内和音／連符でない和音／弧の掃除2種／最後の1音／
  声部1の不変／空 voices[1] を作らない／休符に keyIndex／グループ特定不可）
- `README.md` — 声部2で使える操作の一覧に和音の1音削除を追記
- `docs/REGRESSION.md` — I 節へ声部2の和音1音削除のチェックを追加

## 追記10: 連符グループidが非連続に並ぶデータの発生経路と防御（Issue #282, 2026-08-16）

### 問題

運用者の保存データ（月光1〜9小節・`docs/qa/regression/moonlight-bars1-9.score.json`）の
9小節目・右手声部2で、連符グループの id が**非連続に並んでいる**状態が見つかった。

```
索引: 0  1  2 | 3  4  5 | 6  7 | 8  9 10 | 11
id  : A  A  A | B  B  B | C  C | D  D  D | C     ← グループ C が D に分断されている
音高: g#3 b3 e4  g#3 b3 e4  g#3 b3  e4 g#3 b3  e4
```

このアプリは連符グループを「**同じ tuplet.id が連続する区間**」として扱う
（描画の `createVexFlowTuplets`、削除・コピーの `findTupletGroupRange` がどちらもこの数え方）。
分断されると次のように壊れる。

- **描画**: 断片の長さが `numNotes`（3）に足りないため、連符の囲み（「3」と括弧）が描かれない。
  月光 fixture では36グループ中35個しか描かれていなかった
- **グループ操作**: 削除・コピー・連符数字トグルが断片しか掴めない。
  コピーすれば「2音しかない3連符」が貼り付けられ、壊れたデータが増殖する

音高の並び自体（g#3 b3 e4 の4回繰り返し）は正しく、**グループの境目だけが1音ずれていた**。

### 発生経路（特定済み・テストで再現）

`PianoSystemCanvas.tsx` の `doInsert()` が、挿入位置 `at` を
「クリック位置がどの描画済み音符に近いか」だけで決めていたことが原因。
連符の2音目・3音目の手前が選ばれると、そこへ差し込んだぶんだけグループが前後に割れる。

月光9小節目で起きたことは次のとおり。

1. 3連符グループを3つ入力した状態（索引 0〜8）
2. 4つ目のグループを置こうとして、3つ目のグループの3音目（索引8）の**手前**をクリック
3. `at = 8` と判定され、新しいグループ3件がそこへ `splice` される
4. 3つ目のグループの3音目が索引11へ押し出され、`C C [D D D] C` という並びになった

`PianoSystemCanvasTupletInsertGuard.test.tsx` で、この経路を実際のクリックで再現している
（修正を外すとこの2件が落ちることを確認済み）。**通常の音符入力でも同じことが起きる**ため、
連符ツールのときだけでなく `at` を決めた直後に一括で対処した。

### 修正設計: 3層で守る

| 層 | 何をするか | 置き場所 |
| --- | --- | --- |
| 予防 | 挿入位置がグループの内側に来たら、手前か直後の近いほうへ寄せる | `snapInsertIndexOutOfTupletGroup`（`tupletGroupIntegrity.ts`）→ `doInsert` |
| 修復 | 読込時に、分断されたグループを区切り直す | `normalizeTupletGroupsInParts` → `storage.ts` / `fileStorage.ts` |
| 検知 | 保存前に分断が残っていたら開発ビルドで警告する | `collectTupletContinuityIssues` → `saveScoreDataToSlot` |

新設した `src/utils/tupletGroupIntegrity.ts` は**型以外に依存を持たない**。
描画系のモジュールを保存・読込経路へ持ち込まないためで、逆に `tupletUtils.findTupletGroupRange` は
このファイルの `findTupletRunRange` へ委譲させて、「グループ＝連続する同一 id」という
数え方が2系統に増えないようにした。

#### 修復（正規化）の中身

`normalizeTupletGroupContinuity(events)` は2段構え。

1. **区切り直し**: 同じ連符の種類（3連符なら 3:2）が連続している区間の中に分断された id が
   あれば、その区間を先頭から `numNotes` 個ずつに割り直して id を振り直す。
   月光9小節目のように「境目だけがずれている」データは、これで元の4グループへ戻る
2. **id の重複はがし**: それでも同じ id が離れた場所に残っていたら（連符でない音符を挟んで
   分断されている場合など）、2回目以降の断片へ別の id を振って切り離す
   （＝ Issue 本文の「断片ごとに別グループへ分離する」）

守っている約束:

- **音符の並び・音価・拍数は一切変えない。書き換えるのは `tuplet.id` だけ。**
  拍の圧縮率は `numNotes`/`notesOccupied` から決まるので、鳴り方は正規化の前後で同じ。
  変わるのは「どの音を1つの連符として括るか」＝見た目のグループ分けだけ
- **区切り直した結果が元のグループとぴったり同じ区間は、元の id を据え置く**（差分の最小化）
- **種類の違う連符（3連符と5連符）はまたいで区切り直さない**。混ぜると拍が合わなくなる
- **`numNotes` が壊れている（0・小数）データは区切り幅が決まらないので触らない**（段2だけ効く）
- **分断が無い events は引数の配列をそのまま返す**（正常なデータには一切触れない・再描画も起こさない）
- **新しい id は乱数・時刻ではなく元の id から機械的に作る**（`<元のid>--fix<連番>`）。
  保存データは `measure.events` と `voices[0].events` が同じ内容を二重に持っており、
  別々に正規化しても同じ結果にならないと声部1の中身が食い違ってしまうため

### 意図的に変えた期待値（月光回帰テスト）

`docs/qa/regression/moonlight-bars1-9.score.json` は**1バイトも変更していない**（SHA-256 の照合も無改修で緑）。
変わったのは「読み込んだあとの姿」だけ。

| テスト | 変更前 | 変更後 | 理由 |
| --- | --- | --- | --- |
| `MoonlightRegressionRender.test.tsx` 3段目の連符 | 11 | 12 | 傷3が読込時に区切り直され、描けなかった1グループの囲みが出るようになった |
| 同・3段合計の連符 | 35 | 36 | 同上（全36グループぶんの囲みが揃う） |
| `moonlightRegressionLoad.test.ts` 傷3のテスト | 「交錯したまま残る」 | 「生データには残り、読込後は正規化される」 | 傷3だけ扱いが変わったので、傷1・傷2（音高の傷。今も直さない）とテストを分けた |

`MoonlightRegressionRender.test.tsx` の `loadFixture()` には正規化を1行足した。
実際のアプリは localStorage からもファイルからも正規化を通したデータしか画面へ渡さないので、
描画テストも同じ姿を描くのが正しい（生の JSON をそのまま描いていると、
実機では起こり得ない状態を固定してしまう）。

連符**グループ数**（`moonlightRegressionLoad.test.ts` の全小節4グループ）は変わらない。
9小節目は「4グループの境目がずれていた」のであって、グループの数は元から4だったため。

### 影響範囲

- `src/utils/tupletGroupIntegrity.ts` — 新設（検出・修復・予防の3つ）
- `src/utils/tupletUtils.ts` — `findTupletGroupRange` を `findTupletRunRange` への委譲に変更（挙動は同じ）
- `src/utils/storage.ts` — 読込時の正規化、保存前の警告（開発ビルドのみ）
- `src/utils/fileStorage.ts` — `importScoreFromFile` の戻り値を正規化してから返す
- `src/components/PianoSystemCanvas.tsx` — `doInsert` の `at` を確定した直後に寄せる1行
- テスト: `tupletGroupIntegrity.test.ts`（新規23）/ `PianoSystemCanvasTupletInsertGuard.test.tsx`（新規2）/
  `storage.test.ts`（+2）/ `moonlightRegressionLoad.test.ts`（傷3のテストを分割）/
  `MoonlightRegressionRender.test.tsx`（期待値と読込方法）
- `docs/qa/regression/README.md` — 傷3の扱いを追記

### 今回やらなかったこと

- **MusicXML 読込（`musicXmlImport.ts`）への正規化の適用**。読込側は `<time-modification>` の
  連続からグループを組み立てるので、この経路では分断が起こらない。Issue の受入条件も
  「読込時の正規化」としか書かれていないため、必要になったら1行足せば通せる形にしてある
- **並べ替えによる修復**。「分断された音を元のグループの隣へ動かす」修復も考えられるが、
  音の鳴る順番を黙って変えることになるので採らなかった。今回の方式は id しか書き換えない

---

## 追記11: 連符内の単音削除を「グループ削除」から「連符内休符への置換」へ（Issue #283, 2026-08-16）

### 変更の理由（仕様変更）

運用者の指摘（2026-08-14）。連符内の単音を Delete すると、これまではグループ全体が
同じ長さの通常休符へ置き換わっていた（追記5 で「正しい」と整理した挙動）。しかし浄書では
「♪♪♪ → ♪休♪」のように**グループを残してその位置だけを連符内の休符にする**形が普通に出てくる
（月光のような曲では連符内休符は珍しくない）。3連符の2音目だけ消したいときに
グループごと消えるのは、実際の入力作業では明らかに使いにくい。

### 変更後の仕様

| 削除対象（連符の中） | 変更前 | 変更後 |
| --- | --- | --- |
| 単音（音符・`keys.length === 1`）で、グループに他の音符が残る | グループごと通常休符へ | **その位置だけ同じ音価の連符内休符へ**（グループ・ビーム・連符数字は残る） |
| 単音で、グループに音符が残らなくなる（最後の1音） | グループごと通常休符へ | 変更なし（グループごと通常休符へ畳む） |
| 和音の1音（`keyIndex` 指定・追記5 / #223） | その1音だけ除去 | 変更なし |
| 和音を丸ごと（`keyIndex` 無し） | グループごと通常休符へ | 変更なし |
| 連符内の休符 | グループごと通常休符へ | 変更なし |

連符内の休符に対する Delete を変えなかったのは、**グループごと消す操作を残すため**である。
1音ずつ休符化していけば最後の1音で畳まれるが、「もう休符になっている位置をもう一度 Delete
すれば、そのグループ全体が消える」という近道を残しておきたい（従来の操作感でもある）。
`#224` の置換規則（連符内の休符は同じ音価でだけ音符へ戻せる）とも矛盾しない。

### 実装: 判定を1本に保ったまま、`splice` プランの特別な場合として表す

追記9（#280）で削除の判定は `planEventDeletion` という純関数1本に集約済みだったため、
今回触ったのは**その分岐2の中だけ**である。声部1・声部2の書き込み側（容器の違いを吸収する部分）は
1行も変えていない。

```
planEventDeletion 分岐2（連符内）
  ├ canReplaceTupletNoteWithRest(events, index) が true
  │    → { kind: 'splice', removeStart: index, removeEnd: index,
  │        replacement: [buildTupletInnerRest(ev, clef)], shift: 0 }
  └ false → 従来どおり planTupletGroupDeletion（グループごと通常休符）
```

置換を **`splice` プランの特別な場合（同じ位置に1件だけ入れ替える＝ `shift: 0`）** として
表現したのが要点。おかげで次のものが**追加のコードなしで**そのまま効く。

- 弧（タイ/スラー）・松葉の後始末（`remapEventRefsAfterRemoval`）
  — 「削除された区間 = `[index, index]`」として通るので、**休符になった位置を終点に指していた
  弧・松葉は取り除かれ**、後続の索引は `shift: 0` なので動かない
- 声部2の書き込み経路（`deleteVoiceEventFromMeasures`）
- 「変更が無ければ引数の参照をそのまま返す」約束（追記7 / #245）

新しく足した純関数は `tupletUtils.ts` の2本だけ。

- **`canReplaceTupletNoteWithRest(events, index)`** — 置換してよいかの判定。
  連符内・音符・単音・グループ範囲を辿れる・**自分以外に音符が残る**、をすべて満たすときだけ true
- **`buildTupletInnerRest(event, clef)`** — 置き換える連符内休符を作る。
  `dur` / `dots` / `tuplet` を引き継ぐので音価バランスは不変

### 置き換え休符の表示位置は「音価ごとの標準位置」にした

消した音の音高は**引き継がない**。連符ツールが作る連符内休符（`buildTupletGroupPlan` の
`restPart`）とまったく同じ形にそろえるためで、こうすると

- 五線から遠い音を消しても休符が変な高さに残らない（追記6 / #226 と同じ問題を作らない）
- できあがったグループが「連符ツールで置いた直後のグループ」と区別できない形になるので、
  #224 の「同じ音価なら音符へ戻せる」もそのまま効く

音符に付いていた弧の始点・松葉・アーティキュレーション・歌詞などは引き継がない
（音が無いのに記号だけ残るのを避けるため。連符内の休符には弧を貼れない #234 とも整合）。

### 通知（#238）の文言も同じ判定から導く

`describeDeletedNoteEvent` に第3引数 `tupletContext`（その声部の `events` と対象の位置）を足し、
**削除側と同じ `canReplaceTupletNoteWithRest`** を通して文言を決めるようにした。

- 単音の置換 → 「連符内の音符を休符にしました」
- グループごと畳む → 従来どおり「N連符グループを削除しました」

ここで同じ条件式をもう一度書かないことが重要。文言側と削除側に判定のコピーが2本あると、
片方だけ直したときに「文言と実際の結果が食い違う」形の事故になる（#280 で実際に起きた構図）。
`tupletContext` を省略した場合は従来どおりグループ削除の文言になるので、既存の呼び出しは壊れない。

### 既存テストのうち、fixture を書き換えたもの

グループが縮むのは「グループに音符が残らなくなったとき」だけになったため、
**索引の繰り上げ（#245）を検証していたテストの fixture** を「音符1つ＋連符内休符2つ」へ変え、
その最後の音符を消す形にそろえた（アサーションは変えていない）。
月光 fixture のテストは、1音ずつ消していって**最後の1音で畳まれる**ところまでを検証する形に書き直し、
「休符化したとき、その位置を終点に指していた弧が消える」ケースを新たに足した。

`PianoSystemCanvasDeleteNotice.test.tsx` の「3連符グループを削除しました」は、
**実際にグループごと消える fixture**（音符1つ＋休符2つ）へ移し、単音の置換は新しい文言で固定した。

### 影響範囲

- `src/utils/tupletUtils.ts` — `canReplaceTupletNoteWithRest` / `buildTupletInnerRest`（新規2本）
- `src/utils/noteDeletionUtils.ts` — `planEventDeletion` の分岐2、ヘッダと JSDoc の仕様記述
- `src/utils/scoreEditorNotices.ts` — `describeDeletedNoteEvent` に `tupletContext` を追加
- `src/components/PianoSystemCanvas.tsx` — 声部1・声部2の Delete で通知へイベント列を渡す
- テスト: `tupletUtils.test.ts`（+11）/ `noteDeletionUtils.test.ts`（#283 の9件を追加・
  #245 と月光 fixture の fixture を調整）/ `scoreEditorNotices.test.ts`（+4）/
  `PianoSystemCanvasDeleteNotice.test.tsx`（1件を新仕様へ・グループ削除の1件を追加）
- `docs/REGRESSION.md` — I 節（削除のフィードバック）へ連符内の単音削除を追加
- `README.md` — 連符の使い方に「単音を消すと連符内の休符になる」を1行追記

### 残っている論点

- **連符内の休符に対する Delete**（＝グループごと消す近道）を残したのは今回の判断。
  「休符をもう一度消すとグループが消える」を意外に感じる可能性はあるので、
  実機で使ってみて違和感があれば「休符の Delete は何もしない」へ倒す余地がある
- **和音を `keyIndex` 無しで消す**経路は従来どおりグループごと畳む。Issue の対象が
  「単音（`keys.length === 1`）」だったため広げていない。和音も休符へ置き換える方が
  一貫するという見方もあるが、挙動を変える範囲を Issue の指定どおりに留めた

---

## 追記12: 連符数字の小節一括トグル（Issue #324, 2026-08-20）

### 問題

追記8（#269/#294）で入れた連符数字のトグルは**グループ単位**で、対象の音符を1つずつクリックする。
月光第1楽章のように三連符が曲全体に続く譜面（30グループ超）では、
「2小節目以降は数字を省く」という浄書の慣行どおりに直すだけで30回以上のクリックが要る。
実際に清書へ使った運用者から「クリックが多すぎる」という実需が上がった（#285）。

### 修正設計

**小節の背景（`.vf-hit`）クリック**に、その小節・アクティブ声部の全連符グループの一括トグルを割り当てた。
背景クリックはこれまで `tupletNumberToggle` モードでは**何もせず return** していた場所で、
「背景クリックで音符を置かない」という既存の約束（追記8）はそのまま守られる。

トグルの向きは **「1つでも表示中があれば全部隠す／全部隠れていれば全部出す」**。
混在状態から押したときに一部だけ反転すると、押すたびにばらけて収拾がつかなくなるため、
「押せば小節全体の見た目がそろう」動きに寄せた。

### グループの数え方は増やさない

小節内のグループ列挙は `tupletGroupIntegrity.ts` へ `collectTupletRunRanges`（新規）として置き、
既存の `findNonContiguousTupletGroupIds` もこの関数を使う形へ寄せた。
「グループ＝同じ `tuplet.id` が連続する区間」という数え方は #282 以来この1か所に集約する方針で、
小節一括の処理が独自に run を数え直すと、片方だけ直る事故（#223 → #280 と同じ型）の温床になる。

`hideNumber` の書き換え規則（隠すときは `true`・戻すときは**プロパティごと削除**）も
`withTupletHideNumber` として切り出し、グループ単位（`toggleTupletNumberVisibility`）と
小節一括（`toggleAllTupletNumbersInMeasure`）で共有している。保存データの形が2系統に割れないようにするため。

### 通知（#318「行き止まりは喋る」）

一度に何グループも変わる操作なので、`notifyScoreEdit` で
「この小節の連符数字を4グループ隠しました（Cmd/Ctrl+Z で元に戻せます）」を出す。
連符が段の外まで続く譜面では、変わった範囲が視界に収まらないことがあるため。

**連符が1つも無い小節**を押したときは、譜面を書き換えずに
「この小節には連符がないため、連符数字の一括切り替えはできません」とだけ出す。
何も起きないままだと「壊れている」のか「対象が無い」のか利用者に区別できない。
なお、ここで `withVoiceEventsUpdated` を通さないのは追記8と同じ理由で、
声部2モードのときに中身の無い `voices[1]` が生まれるのを避けるため（#112 の教訓）。

### 影響範囲

- `src/utils/tupletGroupIntegrity.ts` — `collectTupletRunRanges`（新規）、`findNonContiguousTupletGroupIds` を同関数へ寄せた
- `src/utils/tupletUtils.ts` — `toggleAllTupletNumbersInMeasure`（新規）・`withTupletHideNumber`（内部共有）
- `src/utils/scoreEditorNotices.ts` — `describeTupletNumbersToggledInMeasure` / `describeNoTupletInMeasure`
- `src/components/PianoSystemCanvas.tsx` — 背景クリックの `tupletNumberToggle` 分岐を一括トグルへ
- テスト: `tupletUtils.test.ts`（+6）/ `PianoSystemCanvasTupletHideNumber.test.tsx`（+6）
- `README.md` — 連符数字の使い方に小節一括の1文を追記

### やらなかったこと

- **複数小節の一括**（範囲選択して曲全体へ）は入れていない。Issue の受入条件が小節単位で、
  小節選択ツールとの操作の競合（Shift+クリックが小節選択に取られる）を設計し直す必要があるため
- **自動省略**（同一音価の連符が続いたら2つ目以降を自動で隠す）は #269 本文の段2のまま未着手。
  今回の操作も完全に手動で、既存譜面が無断で変わることはない
