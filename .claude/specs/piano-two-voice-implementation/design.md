# 設計書: ピアノ譜 2 Voice 基盤

## 概要

`エリーゼのために` のようなピアノ譜を、単純な音符列だけでなく
**同じ小節内の上声 / 下声** を分けて表示できるようにする。  
今回はまず、既存の編集ロジックを大きく壊さないことを優先し、
`measure.events` を primary voice の正本として残しながら
`MeasureData.voices` を追加する。

## 問題点

- 既存の `MeasureData` は `events` 1 本だけで、同じ小節内の別声部を持てない
- `PianoSystemCanvas` は VexFlow の `Voice` を 1 本しか作っておらず、
  右手の旋律と補助声部を別符幹で描けない
- 再生ボタン経路も `events` の直列読みだけなので、
  声部ごとの同時発音位置を表現できない

## 修正設計

### 1. `MeasureData.voices` を追加

```ts
interface VoiceData {
  id: string;
  stemDirection?: 'up' | 'down';
  events: NoteEvent[];
}

interface MeasureData {
  events: NoteEvent[];
  voices?: VoiceData[];
}
```

- `events` は既存互換と編集系の正本として残す
- `voices[0]` は保存時に `events` と同期する
- `voices[1]` 以降で下声や補助声部を追加する

### 2. 共通ユーティリティで multi-voice を吸収

`voiceMeasureUtils.ts` に以下を置く。

- `getMeasureVoices()`
- `flattenMeasureForPlayback()`
- `getMeasureDurationBeats()`
- `syncPrimaryVoiceFromEvents()`

これにより、描画・再生・保存がそれぞれ独自に
`voices` の有無を解釈してズレることを防ぐ。

### 3. PianoSystemCanvas は複数 Voice を重ね描きする

- primary voice は既存の `measure.events` ベース
- 追加 voice は `measure.voices[1...]` から読む
- VexFlow の `Formatter.joinVoices()` を使って同じ小節幅へ収める
- `stemDirection` が指定されていればそれを優先する

### 4. 再生経路は `startBeat` つきイベントへ平坦化する

再生ボタンは `ScorePage -> PlaybackEngine.playParts()` を使うため、
ここへ渡す前に voice ごとの累積拍から `startBeat` を計算する。

- 上声 8 分音符と下声 4 分音符を同じ小節頭で同時に鳴らせる
- エンジン側は `startBeat` があるときだけ未来時刻予約を使う

### 5. サンプル譜の一部を 2 voice 化する

`エリーゼのために` の右手で、
メロディと低い補助声部が同じ小節に混在する箇所を
`voice-1 / voice-2` へ分ける。

今回はまず「見た目が分かる」範囲から始め、
将来はサンプル全体を本格的に voice 化できる土台を作る。

## 影響範囲

- `src/types/storage.ts`
- `src/utils/voiceMeasureUtils.ts`
- `src/utils/repeatMarkerUtils.ts`
- `src/utils/storage.ts`
- `src/components/PianoSystemCanvas.tsx`
- `src/components/ScorePage.tsx`
- `src/audio/PlaybackEngine.ts`
- `src/audio/SimpleAudioEngine.ts`
- `src/audio/SoundFontEngine.ts`
- `src/data/demoScores.ts`
- `README.md`

## 追記: 入力UI対応（2声部入力トグル）

これまでは `MeasureData.voices` と描画・再生・保存の土台だけが存在し、
**声部を切り替えて入力するUI自体が無かった**。ここではその入力経路を実装した内容を記録する。

### 問題

- `PianoSystemCanvas` は `getMeasureVoices()` で複数 Voice を読み取り、
  `Formatter.joinVoices()` で描画する土台は既にあったが、
  クリック入力・選択・削除はすべて `measure.events`（声部1）だけを対象にしていた。
- そのため、ユーザーが下声を別声部として入力する手段がなかった。

### 修正設計

1. **`voiceMeasureUtils.ts` に入力用ヘルパーを追加**
   - `getVoiceEvents(measure, voiceIndex)`: 指定声部の events を読む（voiceIndex 0 は `measure.events`、
     1 以降は `measure.voices[voiceIndex]`、未作成なら空配列）。
   - `withVoiceEventsUpdated(measure, voiceIndex, updater)`: 指定声部の events だけを更新した
     新しい `MeasureData` を返す。voiceIndex 1 以降を初めて使うときは `measure.voices` を必要な数だけ
     自動生成し、声部2はデフォルトで `stemDirection: 'down'`（下声らしく符幹を下向きに）にする。
   - 既存の `events` を直接書き換える箇所をすべて置き換えるのは大きすぎるため、
     **声部2（voiceIndex 1）を使うときだけ**このヘルパー経由にし、
     声部1（voiceIndex 0）は既存互換のため従来通り `measure.events` を直接操作する。

2. **`ScorePage.tsx` に声部切り替えトグルを追加**
   - `activeVoice`（0 | 1）を state として持ち、ピアノ譜のときだけツールバー（音符・休符タブ）に
     「声部1（上声）/ 声部2（下声）」のトグルを表示する。
   - `V` キーで `activeVoice` をトグルするショートカットを追加（テキスト入力中は既存の仕組みで無効化）。
   - `activeVoiceIndex` として `PianoStaff` → `PianoSystemCanvas` へ橋渡しする。

3. **`PianoSystemCanvas.tsx` の入力・選択・削除を声部対応**
   - `doInsert`（クリックで音符を置く処理）の先頭で `activeVoiceIndex === 1` を判定し、
     声部2のときは `measure.voices[1].events` へ追加する専用の分岐に入れた。
   - 声部2の挿入位置は、声部1のようなクリックX座標→挿入位置の割り出しをそのまま流用できないため、
     **今回は「小節末尾に追記する」だけのシンプルな挙動**にした（位置指定した挿入は将来の改善事項）。
   - 音符選択の型 `Sel` に `voiceIndex?: number` を追加し、声部2の音符をクリックで選択できるように、
     声部2専用の透明な当たり判定（`rect.vf-hit-voice2`）を音符ごとに重ねて描画した。
   - 声部2の音符を選択しているときは **Delete/Backspace キーによる削除のみ** 対応する。
     矢印キーでの音高変更やアーティキュレーション付与などは、声部1のインデックス前提で
     書かれた既存コードを流用すると声部1側を誤って書き換える恐れがあるため、今回は対象外にした
     （安全のため、声部2選択中はこれらのキー操作を無視する）。

4. **再生・保存は既存の土台をそのまま利用**
   - 再生は `flattenMeasureForPlayback()` が既に `startBeat` 付きで声部を平坦化しているため、
     追加実装なしで両声部が同時に鳴った（ブラウザ確認: 声部1の4分音符2つ + 声部2の2分音符が
     同じタイミングで再生された）。
   - 保存・読込も `voices` フィールドがそのまま JSON に載るため、追加実装なしで往復できた。
   - Undo/Redo も既存の `setPartsScore` 経由の履歴機構にそのまま乗るため、声部2の編集も
     Undo で復元できることを確認した。

### ブラウザ確認で見つけたバグと修正（クリックが声部1のロジックに横取りされる問題）

実装直後にブラウザで動作確認したところ、**声部2の小節に既に声部1の音符がある状態で
声部2をクリックしても、挿入も選択もできない**不具合が見つかった。

- 原因: `PianoSystemCanvas.tsx` の音符クリックハンドラ（`hit.addEventListener('click', ...)`、
  和音追加・休符置換・臨時記号などを判定する大きな分岐）は、すべて `safeEvs`（= 声部1の
  `measure.events`）を前提に書かれていた。`activeVoiceIndex` を一切見ていなかったため、
  声部2を選んでいてもクリックはこの声部1向けの分岐（和音追加や休符置換など）に流れてしまい、
  `doInsert` に到達しなかった。
  - 同様に、小節の背景クリック用ハンドラ（`ir.addEventListener('click', ...)`、空の小節を
    クリックしたときに使われる）も `doInsert(lx,ly)` を直接呼ぶだけで、声部2の既存音符を
    クリックして選択する経路が無かった。
  - さらに、声部2の音符専用の当たり判定 `rect.vf-hit-voice2` も別途用意されていたが、
    声部1向けの `hit`/`ir` の rect が **後から** `svgRoot` に追加されるため、SVG の描画順
    （後勝ち）で `vf-hit-voice2` の上に重なってしまい、実際にはクリックが届かなかった。
- 修正: `activeVoiceIndex === 1` のときのクリックだけをまとめて処理する `handleVoice2Click(lx, ly)`
  を追加し、`hit`（音符ごとの当たり判定）と `ir`（小節背景の当たり判定）の両方から呼ぶように
  した。`handleVoice2Click` は次のように動く。
  1. `renderedVoiceEntries` から声部2（`voiceIndex === 1`）の音符一覧を取り、クリック座標が
     どれかの符頭の描画範囲（`getAbsoluteX()` / `getBoundingBox()` 基準、`vf-hit-voice2` と
     同じ判定式）に入っていれば、その音符を選択する（`setSelected({ ..., voiceIndex: 1 })`）。
  2. どの音符にも当たらなければ、`doInsert(lx, ly)` を呼んで小節末尾へ追記する。
  - この対応により、`rect.vf-hit-voice2` は実質使われなくなったが、実害が無いため残してある
    （将来 DOM の描画順を整理する際にまとめて削除する余地がある）。
- 学び: 「声部を切り替える UI」を作るときは、挿入経路（`doInsert`）だけでなく、
  **既存のクリックハンドラすべてが「声部1前提」で書かれていないかを見直す必要がある。**
  データ層（`voiceMeasureUtils.ts`）とヘルパー（`withVoiceEventsUpdated` 等）が声部を
  意識していても、UI 側のイベントハンドラが意識していなければ機能しない。

### 今回のスコープ外（既知の制限）

- **`StaffCanvas.tsx`（単旋律譜・弦楽四重奏など、ピアノ譜以外の五線）には声部切り替えUIを出していない。**
  声部2という概念自体がピアノ譜の右手内で上声・下声を分けるためのものなので、
  ロードマップ項目のタイトル通り「ピアノ譜の2声部入力UI」にスコープを絞った。
  弦楽四重奏などで別パートを2声部化したい場合は別途検討する。
- 声部2への挿入は「小節末尾への追記」のみで、既存音符の間に位置指定して挿入することはできない。
- 声部2の音符に対する音高変更（ドラッグ・矢印キー）、アーティキュレーション、強弱記号、タイ／スラーの付与は未対応（削除のみ対応）。
- MusicXML 書き出し・読み込みは、今回は声部2を反映しない（`<voice>1</voice>` のみを前提にした
  既存実装のまま）。書き出し側で `<voice>2</voice>` と `<backup>` を追加する対応は
  影響範囲が広く、既存のタイ・連符・臨時記号処理と絡むため次回以降に持ち越す。

## 追記: 2声部の描画を標準の浄書ルールに合わせる修正

コミット `e3fbfe4` で2声部入力UIが入った後、ユーザーから「2声部が同じ小節に
共存すると表示が崩れる（符幹の向きが混在する、音符・休符が重なる、ビームが
声部をまたいで変になる）」との報告があった。バッハのアルマンドのような
2声部書法が正しく描けることを目標に、以下の5点を修正した。

### 問題

- `PianoSystemCanvas.tsx` はすでに `getMeasureVoices()` で複数 Voice を読み取り、
  `Formatter.joinVoices().formatToStave()` で同じ小節へ整形する土台があったが、
  符幹の向き（`stemDirection`）は `measure.voices[n].stemDirection` に
  明示的な値が保存されているときしか使われず、既定では未設定（=自動判定）だった。
  声部2は入力時に既定で `stemDirection: 'down'` を持つが、声部1側は
  常に未設定のままだったため、声部1の符幹向きが音高によってばらつき、
  声部2の符幹（下向き固定）と衝突しているように見えることがあった。
- ビーム生成 (`Beam.generateBeams(vfNotes,{beamRests:false})`) は声部ごとに
  呼ばれてはいたが、`stemDirection` を渡していなかったため、VexFlow が
  ビーム内の符幹向きを再計算し、`makeVFNote` 側で明示した向きと食い違う
  ことがあった。
- 休符の描画位置は声部を区別せず、常に五線の同じ既定位置
  （`restKeyForClef` = line 2）に描かれていたため、2声部の休符が
  同じ位置に重なって表示されていた。

### 修正設計

1. **符幹の向き固定** (`src/utils/voiceMeasureUtils.ts` の `resolveVoiceStemDirections`)
   - 小節の声部数が2以上のときだけ、`voices[0].stemDirection` を `'up'`、
     `voices[1]` 以降を `'down'` に強制する純関数を追加した。
   - 声部が1つしかない小節ではこの関数は入力をそのまま返す（何も上書きしない）ため、
     既存の「VexFlow の自動判定に任せる」挙動を壊さない（リグレッション防止）。
   - `PianoSystemCanvas.tsx` の描画ループで `getMeasureVoices(data)` の結果を
     `resolveVoiceStemDirections()` に通してから `makeVFNote` の `stemDirection`
     引数へ渡すよう変更した。

2. **声部ごとの独立ビーム**
   - `Beam.generateBeams(vfNotes, { beamRests:false, stemDirection, maintainStemDirections:true })`
     のように、2声部共存時は解決済みの符幹向きをビーム生成にも渡すよう変更した。
     `maintainStemDirections:true` を付けないと、ビーム生成時に VexFlow が
     符幹向きを自動再計算してしまい、`makeVFNote` 側の指定と食い違うため。
   - 単声部の小節ではこのオプションを渡さず、従来通りの自動ビームのまま。

3. **符頭衝突の自動オフセット**
   - もともと `Formatter.joinVoices([voice1, voice2]).formatToStave(...)` を
     使っており、VexFlow 標準の衝突回避（2度でぶつかる符頭の横ずらし）は
     すでに効く構成だった。今回の符幹向き固定・独立ビームの修正と合わせて、
     ブラウザ確認で近い音高の声部1/声部2が正しく左右にずれて両方読めることを確認した。

4. **休符の上下避け** (`src/components/clefUtils.ts` の `restDisplayLineForVoice` / `restKeyForVoice`)
   - 声部数が1つの小節では従来通り `DEFAULT_REST_DISPLAY_LINE`（line 2）のまま。
   - 声部数が2以上の小節では、声部1の休符を `line 1`（やや上）、
     声部2以降の休符を `line 3`（やや下）にずらす。
   - `PianoSystemCanvas.tsx` の `makeVFNote` に `restKeyOverride` 引数を追加し、
     「ユーザーが休符位置をカスタマイズしていない（保存データの休符キーが
     `defaultRestKeyForClef` のまま）」場合にだけ声部別の位置を適用するようにした。
     ユーザーが休符位置を個別に動かしている場合はその値を優先し、上書きしない。

### ブラウザ確認

ローカル dev サーバー（`docker compose run --rm --service-ports app npm run dev -- --host`）
に接続し、ピアノ譜（声部1/声部2トグルあり）へ以下を入力して確認した。

- 声部1に8分音符を2つ入力 → 符幹が上向きでビームが繋がった
- 同じ小節の声部2に4分音符を1つ入力（声部1の1音目と同じ高さ g/5）
  → 符幹が下向きになり、符頭が声部1側から右にずれて両方見える（衝突回避）
- 声部2の無い小節（声部1しか入力していない小節）は従来通りの見た目のまま
  （symptoms of regression なし）
- ブラウザのコンソールにエラーは出ていない

### 今回のスコープ外（既知の制限）

- 休符の上下避けは自動ユニットテスト（`clefUtils.test.ts`）で計算ロジックを検証したが、
  声部2の休符挿入は「小節末尾への追記」という既存の制限があり、ブラウザ上で
  休符を含む2声部小節を対話的に作るところまでは今回のセッションでは確認しきれていない。
  次回、休符を含むケースもブラウザで実際に確認することが望ましい。
- `StaffCanvas.tsx`（ピアノ譜以外の五線）は今回もスコープ外のまま
  （声部2という概念自体がピアノ譜の右手内の上声・下声分離のためのものであるため）。

## セキュリティ・安定性配慮

- 保存前に `voices[0]` と `events` を同期し、データ不整合を減らす
- `startBeat` と `velocity` は再生直前に安全な数値として扱う
- 既存の単声部データは `voices` なしのままそのまま読める
- 編集系はまず primary voice を正本に据え、複数箇所の一括改修を避けて退行を抑える
