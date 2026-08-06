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
  → アーティキュレーション・強弱は 2026-07-15 の「アクティブ声部編集への一般化」で、
  矢印キーでの音高変更は 2026-08-03（Issue #112）で解消。タイ／スラーは #169 で継続。
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

## アクティブ声部編集への一般化（2026-07-15 追記）

### 問題

`e3fbfe4` / `42b7b08` で2声部の入力・描画自体は動くようになったが、クリック処理が
「声部1前提の当たり判定（`vf-note-hit` / `ir`）」と「声部2専用の暫定実装
（`vf-hit-voice2` / `handleVoice2Click`）」の二重構成になっていた。

- 声部2アクティブ時は `handleVoice2Click` が「既存音符クリックで選択」「それ以外は
  小節末尾へ追記」の2択しかなく、クリック位置への挿入・和音追加・臨時記号・強弱・
  テキストなどのクリック系ツールが声部2の音符に効かなかった（`activeVoiceIndex===1`
  のとき早期 return して声部1側の処理へ流していたため）。
- 声部1アクティブ時は、和音追加ゾーン判定・個別音選択・休符置換などがすべて
  `measure.events`（声部1）前提の `vfNotes`/`safeEvs` を直接参照していたため、
  声部2の音符の上をクリックしても声部1の当たり判定に吸われてしまっていた。
- `vf-hit-voice2` は選択専用の別レイヤーとして声部1の当たり判定の下に重ねて
  置かれており、声部1の `vf-note-hit`（和音追加ゾーンが五線±3加線と広い）が
  常に先に拾ってしまう構成だった。

### 修正設計

1. **当たり判定のアクティブ声部化**
   - 各パート・小節の描画ループ内で `renderedVoiceEntries`（声部ごとに描画済みの
     `vfNotes`/`sourceEvents`/`voice`/`beams` を持つ配列）から、
     `activeVoiceIndex` と一致するエントリを `activeRenderedEntry` として取り出し、
     `activeVfNotes` / `activeEvs` という名前で以降の**インタラクション層**
     （`vf-note-hit` の生成ループ・`ir` 背景クリック・`doInsert` の挿入位置計算）
     に使う。声部1（`voiceIndex 0`）のときは `activeRenderedEntry` が従来の
     `primaryRenderedVoice` と一致するため、`vfNotes`/`safeEvs` を直接使っていた
     ときと完全に同じ挙動になる（リグレッション防止）。
   - 一方、実際の音符描画（ビーム生成・タイの位置計算・連符描画・全休符の中央寄せ）
     は従来通り声部1の `vfNotes`/`safeEvs` を使い続ける。これらは「声部1の見た目」
     を決めるロジックであり、アクティブ声部に応じて差し替える対象ではないため。
   - `vf-hit-voice2` の専用当たり判定と `handleVoice2Click` は削除し、
     声部2の音符クリックも `vf-note-hit`（アクティブ声部から生成）で
     声部1と同じコードパス（和音追加ゾーン判定・個別音選択・臨時記号・強弱など）
     を通るようにした。
2. **更新系の一般化**
   - 音符1件を書き換えるツール（臨時記号・強弱・カスタム記号トグル・前打音・
     トリル・ペダル・オッターバ・和音追加）は `updateActiveEvent(j, compute)` という
     共通ヘルパーに統一した。内部で `getVoiceEvents(measure, activeVoiceIndex)[j]`
     を読み、`compute` の結果を `withVoiceEventsUpdated(measure, activeVoiceIndex, ...)`
     で書き戻す。`activeVoiceIndex===0` のときは `withVoiceEventsUpdated` が
     `measure.events` を直接更新する既存互換の挙動なので、声部1の保存形は変わらない。
   - 位置指定挿入（`doInsert`）・休符置換／分割（休符クリック2回目）も同様に
     `withVoiceEventsUpdated` 経由の `splice` に統一し、声部2でも「クリック位置への
     挿入」「休符クリックでの置換・分割」ができるようになった
     （以前は声部2は常に「小節末尾へ追記」のみだった）。
   - `selected` state に常に `voiceIndex: activeVoiceIndex` を持たせるよう統一。
     以前は一部の setSelected 呼び出しで `voiceIndex` を省略しており、
     声部2の音符を選択しても「声部1の同じインデックスの音符」が青枠になる
     潜在バグがあった（`isSel` 判定・休符の「同じ休符を選択中か」判定に影響）。
3. **非アクティブ声部の淡色表示**
   - `makeVFNote` で生成した `StaveNote` に対し、`isMultiVoiceMeasure &&
     voiceIndex !== activeVoiceIndex` のときだけ `setStyle({ fillStyle:
     '#9ca3af', strokeStyle: '#9ca3af' })` を適用する。声部1しか無い小節や
     単旋律譜・弦楽四重奏など声部トグル自体が無い画面は `isMultiVoiceMeasure`
     が常に `false` のままなので、従来通り常に黒。
   - 強弱記号・カスタム記号・ペダル・オッターバの「見た目」（`dynamicTextEntries`
     等の描画専用配列に積む処理）は、当たり判定とは別に
     `renderedVoiceEntries.filter(entry => entry.voiceIndex !== activeVoiceIndex)`
     を追加でなめて、非アクティブ声部の分もそのまま描画し続けるようにした。
     当たり判定生成をアクティブ声部だけに絞った結果、「声部を切り替えた瞬間、
     非アクティブ声部に付けていた強弱記号が画面から消える」という表示退行が
     起きかけたため、この補完ループで防いでいる。
   - 印刷時は `App.css` の `@media print { .print-page svg path, .print-page
     svg line { fill:#000 !important; stroke:#000 !important; } }` が
     `setStyle` で付けた淡色より優先されるため、印刷結果は常に声部を問わず黒。
     `.vf-hit-voice2` を参照していた print CSS のセレクタも、当たり判定クラス
     自体を削除したのに合わせて掃除した。
4. **自動休符補完の整合**
   - `fillPriorMeasureRests` は元から `measure.events`（声部1）だけを対象にしており、
     声部2は「使っている小節にだけ存在する」データモデルのまま変更していない。
     声部2への挿入時に呼んでいるのは、声部1側の拍位置を保証して小節数を揃えるため
     （2声部の小節インデックスをそろえる目的）であり、声部2自体に休符を強制するもの
     ではない。

### 今回のスコープ外（既知の制限）

- **3連符ツール・タイ/スラーのドラッグ入力**は、連符描画（`Tuplet` でくくる処理）や
  タイ弧線の位置計算が声部1（`vfNotes`/`safeEvs`）前提のままのため、声部2が
  アクティブなときはこれらのツールは無効（3連符は何もしない、タイは声部1の
  音符間でのみ張れる）。連符・タイの描画基盤自体を声部ごとに持たせる改修は
  影響範囲が大きいため、今回は見送った。
- **カスタム記号のサイズ変更・位置調整・テキスト要素（歌詞・強弱記号などの
  自由テキスト）** は、確定処理（`handleSymbolResizeConfirm` 等）が
  `partData[measureAbsoluteIndex].events[eventIndex]` を直接書き換える前提の
  実装のままで、まだ `voiceIndex` を持たない。声部2の音符へ適用すると声部1側を
  誤って書き換えてしまうため、当面「声部1のみ対応」とし、声部2アクティブ時は
  クリックしても何も起きないようガードした。
  → **2026-08-03（Issue #112）で解消。** 下の「声部2の音高移動・記号編集への対応」節を参照。
- **矢印キーでの音高変更**（Delete 以外のキーボード操作）も、既存の実装が
  `measure.events`（声部1）前提のままで、声部2の音符選択時は Delete 以外は
  何もしない（`sel.voiceIndex` があるときは Delete/Escape のみ受け付ける既存挙動を維持）。
  → **2026-08-03（Issue #112）で解消。** ↑↓ と 0 キーは声部2でも使える。

### ブラウザ確認（2026-07-15）

`docker compose` の dev サーバーに接続し、ピアノ譜で以下を確認した。

- 声部1に8分音符を複数入力 → 従来通りビームが繋がって入力できる（リグレッション無し）
- 声部2へ切替 → 声部1の音符がグレー（`#9ca3af`）に変わることを DOM 属性で確認
- 声部2の空の小節でクリック → クリック位置に音符が挿入される
- 声部2の既存音符の真上をクリック → 和音が追加される（2音目が同じ符幹に追加）
- 声部2の音符に臨時記号（シャープ）を適用 → `#` が表示され、選択枠も声部2の音符に付く
- 声部1へ戻す → 今度は声部2の音符（2和音）がグレーになる（双方向で確認）
- 声部1の音符クリック（個別音選択）が声部2追加後も従来通り動作する
- コンソールエラーなし（`read_console_messages` で確認）

## 追記: 拍が足りない声部への表示用休符補完（2026-07-20）

### 問題

複雑テスト楽譜のブラウザ確認で、ユーザーから「ある小節の下声には休符が付けられるべきではないか」という指摘があった。
調べたところ、当時のテストデータ自体には拍が不足した多声小節は無かったが、実際にブラウザで
声部2（下声）へ1拍だけ音符を入力し、残り3拍を空けたまま保存すると、`PianoSystemCanvas` の描画側は
その3拍ぶんを「何も描かない空白」のまま表示していた。VexFlow の `Voice` を `Mode.SOFT` で使っているため、
拍子ぶん埋まっていない声部でも例外を投げずに描画できてしまい、見た目上「休符が足りない」状態を
検出・警告する仕組みが無かった。

市販の(特に2段以上の)ピアノ譜では、複数声部が共存する小節で、ある声部が小節の一部の拍しか
埋めていないとき、残りの拍には休符を明示するのが浄書の作法。単に空白のままにするのは楽譜として不完全に見える。

### 修正設計

**方式**: 保存データは変えず、描画時にレンダリング用のコピーへ表示用の休符を補完する（データ正規化ではなく描画側の補完を選択）。

理由:
- 声部2の入力は「小節末尾に追記するだけ」という単純な挙動のため（前セクション参照）、
  ユーザーが編集を続けている途中の状態（まだ拍が埋まっていない）でも正しく編集を継続できる必要がある。
  読込時にデータへ直接休符を書き込んでしまうと、その後の追記位置の計算（末尾に追記）が
  補完した休符の後ろになってしまい、意図しない位置に音符が入る事故につながる。
- 見た目だけの補完なら、保存・Undo/Redo・MusicXML書き出し・再生（`flattenMeasureForPlayback`）など
  既存のデータ経路に一切手を入れずに済み、リグレッションのリスクが小さい。

**実装**:

1. `src/utils/voiceMeasureUtils.ts` に `computeVoiceDisplayPadding(events, totalBeats, restKey)` を追加。
   - `getEventDurationBeats`（付点・連符対応済みの既存ヘルパー）で占有拍数を計算し、
     `totalBeats`（小節の拍子ぶんの拍数）に対する不足分を求める。
   - 不足分は `buildTrailingRestEventsForBeats` で、全音符→2分音符→4分音符→…の順に大きい音価から
     貪欲に分割した休符イベント列にする（付点休符への分割はしない簡易実装）。
   - ちょうど埋まっている・オーバーしている声部には空配列を返す（既存の正しい多声小節を壊さない）。

2. `PianoSystemCanvas.tsx` の小節描画ループで、`isMultiVoiceMeasure`（`measureVoices.length > 1`）のときだけ、
   各声部の `sourceEvents`（レンダリング用コピー）へ `computeVoiceDisplayPadding` の結果を末尾に追加する。
   追加した休符イベントには `__isPlaceholder: true` を付け、空小節の全休符プレースホルダと同じ仕組みで
   クリック当たり判定（`vf-note-hit`）を持たせないようにした（クリックは常に背景クリック＝挿入として扱われる）。
   `__isPlaceholder` を付けた休符は、実データ（`measure.events` / `measure.voices[n].events`）には
   一切追加しないため、`updateActiveEvent` などが参照する実イベントのインデックスはズレない
   （補完は常に末尾へ追記するだけなので、既存インデックスの前には割り込まない）。

3. **見つけて直したバグ**: 上記の休符を最初に足したとき、既存の `shouldRenderGhostRest`（追加声部の
   前後にあるダミー休符を非表示の `GhostNote` として描く既存ロジック）が、末尾に付けた新しい休符も
   「ダミー休符」とみなして非表示にしてしまい、結局何も見えないままだった。
   `shouldRenderGhostRest` の先頭で `event.__isPlaceholder` を見て、表示用に補完した休符は
   ghost 扱いにしない（＝必ず見える休符として描く）よう分岐を追加した。ユーザーが保存データへ
   直接入力した末尾休符（本来のダミー休符）はこれまで通り ghost 扱いのままなので、既存の見た目は変わらない。

4. 単声部の小節（`voices` が無い、または1つだけ）は `isMultiVoiceMeasure` が false のため、
   この補完ロジックを一切通らない。既存の正しく埋まっている多声小節（デモの `voice-1`/`voice-2` が
   4拍ぴったりのもの）も、`computeVoiceDisplayPadding` が空配列を返すため見た目は変わらない。

### 影響範囲

- `src/utils/voiceMeasureUtils.ts`（`computeVoiceDisplayPadding` / `buildTrailingRestEventsForBeats` 追加）
- `src/components/PianoSystemCanvas.tsx`（`sourceEvents` 計算箇所への補完呼び出し、`shouldRenderGhostRest` の `__isPlaceholder` 除外）
- `src/utils/voiceMeasureUtils.test.ts`（`computeVoiceDisplayPadding` の単体テスト追加: 過不足なし/不足あり/オーバー/空声部/付点/連符の各ケース）

### ブラウザ確認（2026-07-20）

複雑テスト楽譜を読み込み、声部2へ切り替えて既存の空いている小節に4分音符を1つだけ入力（4/4で残り3拍が不足する状態を意図的に作成）し、以下を確認した。

- 補完前は残り3拍が空白のままだったが、修正後は同じ小節に2分休符+4分休符（残り3拍ぶん）が可視の休符として表示された
- 元から正しく2声部が4拍ぴったり埋まっている小節（デモフレーズの該当小節）や、単声部の小節の見た目は変化しなかった
- 拍の縦位置（合同フォーマット）は保たれたままだった
- コンソールエラーなし
- Undo で元の状態（`voices` フィールドなし）に戻ることを確認した

## セキュリティ・安定性配慮

- 保存前に `voices[0]` と `events` を同期し、データ不整合を減らす
- `startBeat` と `velocity` は再生直前に安全な数値として扱う
- 既存の単声部データは `voices` なしのままそのまま読める
- 編集系はまず primary voice を正本に据え、複数箇所の一括改修を避けて退行を抑える

### 追補（2026-07-20）: 単声部小節への拡張

ユーザーテストで「単旋律の小節に3拍分しか音符が無いとき、4拍目が空白のままで入力先が
視覚的に分からない」という指摘があり、上記3.の `isMultiVoiceMeasure` 限定を外し、
声部数によらず常に `computeVoiceDisplayPadding` を呼ぶよう変更した（`PianoSystemCanvas.tsx`）。

- 全休符プレースホルダ（`data.events` が空の小節）は `computeVoiceDisplayPadding` が
  追加分0件を返すため、既存の見た目（全休符1個）は変わらない。
- スタイリングも合わせて拡張し、`__isPlaceholder && ev.isRest` の音符は常に
  `INACTIVE_VOICE_COLOR`（`#9ca3af`）の薄いグレーで描画するようにした
  （以前は多声小節の非アクティブ声部だけがグレーだった）。これにより空小節の全休符
  プレースホルダも含めて「データにまだ無い」ものが一目でグレーだと分かるようになった
  （これは意図した仕様変更で、以前は空小節の全休符が黒で描かれていた）。
- 印刷（PDF書出）でこのパディング休符が紙面に残ると「未完成の小節がそのまま印刷される」ため、
  `PianoSystemCanvas.tsx` の描画後に `StaveNote.getSVGElement()` へ `vf-padding-rest` クラスを
  付与し、`App.css` の `@media print { .vf-padding-rest { display: none !important; } }` で
  印刷時のみ非表示にする。画面表示は変えない。
- テスト: `src/components/PianoSystemCanvasPaddingRest.test.tsx`
  （3拍入力時に `.vf-padding-rest` が1個描画される／編集ヒット領域を持たない／
  4拍ぴったり埋まっている小節には出ない、の3点を確認）

## 追記: 声部が未入力の小節でクリックが声部1へ誤爆する不具合の修正（Issue #105, 2026-07-28）

### 問題

「下声（声部2）を選択した状態で上声（声部1）の音符をクリックすると、声部1側が
編集されてしまう」という報告があった。上の「アクティブ声部編集への一般化」節で、
クリックのヒット判定（`.vf-note-hit`）は `activeRenderedEntry.vfNotes` /
`activeRenderedEntry.sourceEvents`（＝アクティブ声部の描画済み音符）からしか
作られないよう既に一般化されていたはずで、一見矛盾する報告だった。

原因は `PianoSystemCanvas.tsx` の以下の行にあった:

```ts
const activeRenderedEntry = renderedVoiceEntries.find((entry) => entry.voiceIndex === activeVoiceIndex)
  ?? primaryRenderedVoice;
```

`renderedVoiceEntries` は `getMeasureVoices(data)`（`voiceMeasureUtils.ts`）の結果で、
この関数は **`measure.voices` が存在しない（＝その小節で声部2をまだ一度も
入力していない）ときは声部1のエントリ1件だけを返す**（`getMeasureVoices` 冒頭の
`if (!measure.voices || measure.voices.length === 0) return [{ id: 'voice-1', ... }]`）。
そのため、アプリ全体としては「下声（声部2）モード」がアクティブでも、まだ声部2の
データを持たない個々の小節では `renderedVoiceEntries` に `voiceIndex === 1` の
エントリが存在せず、`.find(...)` が `undefined` を返す。このとき
`?? primaryRenderedVoice` のフォールバックが効き、**声部1のレンダリング結果
（`vfNotes`/`sourceEvents`）がそのまま `activeVfNotes`/`activeEvs` になっていた**。

結果として、そうした小節では（下声モードのつもりでも）クリック用のヒット領域
（`.vf-note-hit`）が声部1の音符から作られ、そこをクリックすると声部1の個別音選択・
和音追加・臨時記号付与などがそのまま実行されてしまっていた。ピアノ譜は大半の小節が
「声部2をまだ使っていない」状態から始まるため、実運用ではかなりの頻度で踏む
バグだった。

### 修正設計

フォールバック先を声部1に固定するのをやめ、**アクティブ声部がこの小節にまだ
存在しないときは「空の声部」として扱う**ようにした。

```ts
const activeRenderedEntry = renderedVoiceEntries.find((entry) => entry.voiceIndex === activeVoiceIndex);
const activeVfNotes = activeRenderedEntry?.vfNotes ?? [];
const activeEvs = activeRenderedEntry?.sourceEvents ?? [];
```

- `activeVfNotes` が空配列になることで、個別音符のヒット領域（`.vf-note-hit`）を
  作る `if (activeVfNotes.length > 0) { ... }` ブロックがまるごとスキップされ、
  声部1の音符に対するヒット領域は一切作られない。
- クリックは常に小節背景（`.vf-hit` の `ir`）で受け止められ、`doInsert` が呼ばれる。
  `doInsert` は `activeEvs.length`（＝0）を初期値に使うため、この小節の
  アクティブ声部（声部2）へ「小節の先頭に新規音符を追加」という、意図どおりの
  動作になる。
- 声部1（`activeVoiceIndex === 0`）は `getMeasureVoices` が単声部小節でも常に
  声部1のエントリを返す（`voices` が無い小節は `[{id:'voice-1', events: measure.events ?? []}]`
  を返す）ため、この変更による影響を受けない（従来どおり自分自身のエントリが
  そのまま見つかる）。
- `primaryRenderedVoice` はこのクリック判定の文脈では未使用になったため、
  Pass 3 の分割代入から削除した（Pass 1 側の型定義・null チェックでは引き続き使用）。

### テスト

`src/components/PianoSystemCanvasVoiceClickScope.test.tsx`（新規）:
- 声部2アクティブ・かつ声部2未入力の小節で、声部1の音符に対する `.vf-note-hit` が
  1件も作られないこと
- その状態で小節背景をクリックすると、声部1の `events` は一切変化せず、
  声部2（`voices[1]`）に新規音符が1件追加されること

修正前のコード（`primaryRenderedVoice` へのフォールバックあり）に対してこの
テストを実行すると1件目が失敗する（`.vf-note-hit` が声部1の音符から2件作られて
しまう）ことを確認済み。

## 追記: 声部2の音高移動・記号編集への対応とタイ誤爆の修正（Issue #112, 2026-08-03）

上の「アクティブ声部編集への一般化」節で「今回のスコープ外」として残していた制限のうち、
**矢印キーでの音高変更・0キーでの休符位置リセット・記号のサイズ/位置調整・テキスト要素**を
声部2でも使えるようにし、あわせて調査中に見つかった**タイ／松葉ツールの声部2誤爆バグ**を塞いだ。
連符（#168）とタイ／スラーのフル対応（#169）は引き続きスコープ外。

### A. タイ／松葉ドラッグの声部2誤爆（無言のデータ破壊）

- 症状: 声部2をアクティブにしてタイ／松葉ツールで声部2の音符間をドラッグすると、
  **声部1の `measure.events` に arcs / hairpins が追記される**。画面上は「何も起きていない」
  ように見えるため気づけない（声部1の同じインデックスに音符があると成立する）。
- 原因: 当たり判定はアクティブ声部（`activeEvs` / `activeVfNotes`）から作られるのに、
  確定処理 `applyArc` / `applyHairpin` の書き込み先が `next[m1].events[n1]`（＝声部1）固定だった。
- 修正: `hit` の `mousedown` / `mouseup` の両方に `activeVoiceIndex !== 0` の早期 return を追加した。
  `applyArc` / `applyHairpin` 自体は変更していない（声部2のタイは #169 で描画基盤ごと扱うため、
  ここでは「書き込み経路の入口を塞ぐ」ことだけを行う）。mouseup 側は開始が記録されていない以上
  到達しても無害だが、将来の改修で片方だけ残る事故を防ぐため両方に置いている。

### B. 矢印キー・0キーの声部2対応

- `applyPitchChangeToMeasures`（`src/utils/pitchShiftUtils.ts`）に **optional 引数 `voiceIndex`（既定 0）**
  を追加した。既定値のままなら単声部前提の StaffCanvas 側の呼び出しは一切変わらない。
- 内部実装は `getVoiceEvents` / `withVoiceEventsUpdated` 経由へ書き換えた。このとき
  **「中身が実際に変わった小節だけ差し替える（変化が無ければ元の参照をそのまま返す）」**
  ようにしている。理由は2つある。
  1. 無条件に `withVoiceEventsUpdated` を通すと、arcs 追従のために全小節をなめる過程で
     **声部2をまだ使っていない小節にまで空の `voices[1]` が作られてしまう**。声部が2本ある小節は
     多声小節と判定され、符幹の向き固定・休符の上下避けが働くため、見た目が勝手に変わる。
  2. 旧実装は `measures.map(m => ({ events: ... }))` と書かれており、**events 以外のフィールド
     （`repeatStart`・途中拍子・`voices` など）を落としていた**。参照を返す形にしたことでこれも直る
     （単声部でも矢印キー1回で反復記号が消える潜在バグだった）。
- `PianoSystemCanvas` の keydown ハンドラは、`sel.voiceIndex ?? 0` を `voiceIndex` として持ち、
  読みを `getVoiceEvents(prev[measure], voiceIndex)` に、書きを上記の第6引数付き呼び出しに変えた。
  声部2選択時の早期打ち切りは「Delete/Escape のみ」から「↑↓と0も通す」に緩めた。

### C. 記号編集オーバーレイの声部2対応

- `textEditState` / `symbolResizeEditState` / `symbolOffsetEditState` / `symbolAdjustPickerState` に
  `voiceIndex` を追加し、オーバーレイを開くときに `activeVoiceIndex` を保存する。
  `eventIndex` は「その声部の events 配列の中での位置」なので、声部を一緒に覚えないと確定時に
  別の声部の同じインデックスへ書いてしまう。
- 確定処理 `handleTextConfirm` / `handleSymbolResizeConfirm` / `handleSymbolOffsetConfirm` の
  `partData[...].events[eventIndex]` 直書きを `getVoiceEvents` + `withVoiceEventsUpdated` 経由に変更。
- クリック側の `activeVoiceIndex !== 0` ガード4本（customSymbolResize / customSymbolOffset /
  symbolAdjust / textElement）を削除した。
- 記号そのものをクリックして位置調整に入る経路（`appendSymbolHitRegion` → `openSymbolAdjustEditor`）にも
  `voiceIndex` を渡す。この経路の描画エントリはアクティブ声部からしか積まれないため `activeVoiceIndex`
  をそのまま渡してよい。
- `closeEventEditOverlaysFor` の一致条件にも `voiceIndex` を加えた（声部が違えば別の音符のため）。

### D. ブラウザ確認で見つけた本命バグ: 声部を切り替えても五線が描き直されない

上記を実装してブラウザで確認したところ、**声部トグルを押しても当たり判定が作り直されない**ことが分かった。
描画 effect の deps 配列に `activeVoiceIndex` が入っておらず（origin/main の時点から）、
SVG も `.vf-note-hit` も古い声部のまま残る。クリックハンドラは描画時点の `activeVoiceIndex` を
クロージャに閉じ込めているので、**声部2に切り替えたのにクリックが声部1を書き換える**状態だった
（Issue #105 で直したはずの症状が、別経路でそのまま残っていたことになる）。

- 修正: 描画 effect の deps 末尾に `activeVoiceIndex` を追加した。
- 確認: 修正後は声部トグルで SVG が作り直され、声部2未入力の小節では `.vf-note-hit` が
  0 件になる（＝声部1の音符をクリックしても声部1が編集されない）ことをブラウザで確認した。
- 学び: この画面は「React の state」と「effect が手で作った SVG・DOM リスナー」の二重構造なので、
  **ハンドラが参照する値はすべて deps に入れる**必要がある。入れ忘れは型でもテストでも
  検出できず（ユニットテストは最初から目的の `activeVoiceIndex` でマウントするため素通りする）、
  ブラウザ操作でしか見つからない種類のバグだった。

### テスト

- `src/components/PianoSystemCanvasVoice2Editing.test.tsx`（新規）
  - 声部2の音符を選択して↑ → 声部2だけ音高が上がる（声部1は不変）
  - 声部2の休符を選択して0 → 声部2の休符だけ標準位置（b/4）へ戻る
  - 声部2の音符へテキスト要素（運指）を付与 → 声部2だけに入る
  - 声部2の音符の既製記号サイズ変更 → 声部2だけに `symbolAdjust` が入る
  - 声部2アクティブでタイをドラッグ → `onChange` が呼ばれない（＋対照実験として声部1では張れる）
  - 補足: 追加声部の**先頭・末尾の休符は ghost（非表示）**として描かれる既存仕様があるため、
    休符のテストでは音符で挟んだ位置に休符を置いている（末尾に置くとクリックできない）。
- `src/utils/pitchShiftUtils.test.ts`: `voiceIndex` 指定時の挙動、声部2を持たない小節に
  空の声部を作らないこと、events 以外のフィールドを落とさないことを追加した。

### ブラウザ確認（2026-08-03）

共有 dev サーバー（5173）にデモのピアノ譜を読み込み、声部2で以下を確認した。

- 声部2へ切替 → 声部1の音符が淡色になり、声部2に8分音符を2つ入力できる（声部1のデータは不変）
- 声部2の音符を選択して↑ → g/4 → a/4 と上がり、声部1の events は変化しない
- 声部2でタイをドラッグ → 声部1・声部2とも arcs / hairpins が増えない
- 声部2の音符に運指「3」を付与し、記号サイズを150%へ変更 → いずれも `voices[1]` 側だけに保存される
- 声部1へ戻して音符を選択し↑ → 従来どおり声部1の音高が変わる（リグレッション無し）
- コンソールエラーなし

### 今回もスコープ外（既知の制限）

- 3連符ツール（#168）と、声部2のタイ／スラーを実際に張れるようにする対応（#169）。
  タイ・松葉は「声部2では無反応」が現時点の正しい挙動。
  → **連符（#168）は 2026-08-04 に解消。** 下の「声部2の連符入力への対応」節を参照。
- 声部2の強弱記号・松葉の MusicXML 書き出し／読み込み（入力UI自体が無いため従来どおり対象外）。

## 追記: 声部2の連符入力への対応（Issue #168, 2026-08-04）

上の「アクティブ声部編集への一般化」以降ずっと残っていた「3連符ツールは声部1のときだけ有効」
という制限を解消した。タイ／スラー（#169）は引き続きスコープ外。

### 問題

制限が入った 2026-07-15 時点では連符の**描画**が声部1（`vfNotes`/`safeEvs`）前提だったが、
その後の改修で連符描画は声部エントリごとに行われるようになっていた
（`PianoSystemCanvas.tsx` の声部ごとの map の中で `createVexFlowTuplets(sourceEvents, vfNotes)` を呼び、
`entry.tuplets` として声部ごとに draw する）。つまり描画側は既に声部対応済みで、
残っていたのは**入力経路の声部1前提だけ**だった。

具体的には `doInsert` の連符分岐に次の2つの問題があった。

1. ガード `if((tool as any)?.tuplet && activeVoiceIndex === 0)` により、声部2では連符ツールが
   何も起こさない（クリックしても無反応）。
2. その分岐の中だけ挿入先が `m.events.splice(...)`（＝声部1の events 直書き）になっていた。
   すぐ下の通常音符の挿入は既に `withVoiceEventsUpdated(next[absI], activeVoiceIndex, ...)` 経由に
   統一されていたのに、連符分岐だけが取り残されていた。**ガードを外すだけだと、
   声部2のつもりの操作が声部1へ書き込まれる**（#112 で塞いだタイ誤爆と同じ形の無言のデータ破壊）。

### 修正設計

1. `activeVoiceIndex === 0` の条件を外し、連符ツールを声部によらず有効にした。
2. 連符グループの挿入を、通常音符と同じ `withVoiceEventsUpdated(next[absI], activeVoiceIndex, ...)`
   経由の `splice` へそろえた。挿入位置 `at` はアクティブ声部の描画済み音符（`activeVfNotes`）から
   求めているので、声部2でもクリック位置に応じた位置へ入る。
3. 空き拍判定（`currentBeats + groupBeats > beatsPerMeasure`）は、`currentBeats` が既に
   `getVoiceEvents(currentMeasure, activeVoiceIndex)` から計算されているため変更不要だった
   （声部2の占有拍だけを見て「入るかどうか」を判定できている）。
4. 連符内休符の音符置換（`buildTupletRestReplacement` を通る休符クリック経路）も
   既に `getVoiceEvents` + `withVoiceEventsUpdated` 経由だったため変更不要。テストで固定した。

### あわせて直した点: 声部2の連符グループ削除

`doInsert` の4点とは別に、**声部2選択時の Delete/Backspace が連符に対応していなかった**。
声部1・単旋律譜は `deleteEventFromMeasures`（内部で `planTupletGroupDeletion`）を通り
「グループ全体を同じ長さの通常の休符へ置き換える」仕様だが、声部2の分岐だけは
`copy.splice(index, 1)` の素の1件削除だった。連符入力を声部2で解禁すると、
**連符の一部だけが消えて残り2件が `tuplet.id` を持ったまま半端な音価で残る**状態を
簡単に作れてしまい、描画（VexFlow の Tuplet）と再生の拍計算が壊れる。

そこで声部2の Delete 分岐にも `planTupletGroupDeletion` を通す処理を追加した
（`withVoiceEventsUpdated` の中で、グループ範囲をまとめて通常休符へ差し替える）。
Issue #168 の「やること」には挙がっていないが、連符入力の解禁が直接生む破綻経路のため
同じ変更に含めた。

### テスト

`src/components/PianoSystemCanvasVoice2Tuplet.test.tsx`（新規）:

- 声部2アクティブで3連符ツール → `voices[1]` に「音符1＋連符内休符2」が同じ `tuplet.id` で入り、
  声部1の `events` は変化しない
- 声部2の空き拍が足りない小節（既に4拍埋まっている）では `onChange` 自体が呼ばれない
- 声部1・声部2の両方に連符がある小節で `g.vf-tuplet`（VexFlow の Tuplet が draw 時に作るグループ）が
  ちょうど2つ描かれ、連符描画のエラーログが出ない
- 声部2の連符内休符を同じ音価の音符ツールでクリック → 個数は変わらず `tuplet` を保ったまま音符になる
- 声部2の連符内の音符を Delete → グループ全体が通常の4分休符1つに置き換わる（`tuplet` が残らない）

補足: 追加声部の**末尾の休符は ghost（非表示）**として描かれる既存仕様があるため、
連符内休符をクリックするテストでは連符の後ろに音符を1つ足している（末尾のままだとクリックできない）。

### ブラウザ確認で見つかった未解決の問題: ghost 休符を含む連符が描画できない（要・別対応）

ブラウザ確認（2026-08-04、ピアノ譜・4♯・4/4）で、**声部2に連符を置いた直後の
「音符1＋末尾の連符内休符2」という、まさに既定の形が描画できない**ことが分かった。

- 症状: 連符のブラケットと数字（「3」）が描かれず、描画のたびに
  `連符の描画でエラーが発生しました: [RuntimeError] NoStem: No stem attached to this note.`
  がコンソールへ出る。音符・休符そのものと拍位置は正しく、声部1側の連符は影響を受けない。
- 原因: 追加声部（voiceIndex >= 1）では、**最後の発音イベントより後ろにある休符が
  `GhostNote`（非表示）として描かれる**既存仕様がある（本ファイル冒頭の `shouldRenderGhostRest`）。
  連符を置いた直後の声部2は `[音符, 休符, 休符]` なので、連符内の休符2つがそのまま
  ghost 化する。`GhostNote` は符幹を持たないため、`Tuplet.draw()` →
  `Tuplet.getYPosition()` → `GhostNote.getStemDirection()` が例外を投げ、
  `PianoSystemCanvas` の try/catch に落ちてブラケットだけ描かれない。
- **この不具合は本対応で作り込んだものではない。** 描画側のコード（`shouldRenderGhostRest` /
  `createVexFlowTuplets` / `entry.tuplets` の draw）は今回まったく変更しておらず、
  同じデータを origin/main のリビジョンで描かせても同じ例外が出ることを確認済み
  （調査用テストで `g.vf-tuplet` が 0 個・例外1件、main でも同一結果）。
  これまでは声部2に連符を作る手段が MusicXML 読込しか無かったため踏まれていなかっただけで、
  入力経路を開けたことで**通常操作で必ず踏む**位置に来た、という関係になる。
- 対応方針: Issue #168 の「注意」に従い、**描画側には手を入れずここで停止**した。
  想定される最小の直し方は `shouldRenderGhostRest` の先頭で
  「`event.tuplet` があるものは ghost 化しない」と分岐することだが、
  連符は過去に苦戦した領域であり、ghost 休符の仕様そのものへの影響を含めて
  別Issueで設計・確認するのが安全だと判断した。

### 今回もスコープ外（既知の制限）

- **ghost 休符を含む連符の描画**（上記）。声部2の連符入力は、この描画側の対応が入るまで
  ユーザーに公開できる状態ではない。README の制限記載も、そのため今回は更新していない。
  → **2026-08-04 に Issue #180（PR #182）で解消済み。** 下の「本ファイル末尾の
  『連符内の休符は ghost 化しない（Issue #180）』節」と、次の「受入条件の確認（2026-08-05）」を参照。
- 声部2のタイ／スラー（#169）。タイ・松葉は引き続き「声部2では無反応」が正しい挙動。
- 声部2の強弱記号・松葉の MusicXML 書き出し／読み込み（入力UI自体が無いため従来どおり対象外）。

### 受入条件の確認とブラウザ検証（Issue #168 の残り, 2026-08-05）

ghost 休符側（#180）が入ったため、上で保留していた受入条件2（両声部に連符がある小節が
崩れず描画される）と受入条件5（README の制限記載の更新）を、実際のブラウザ操作で確認して
片付けた。**この節でのコード変更は無く、確認と文書の更新のみである。**

検証環境: 共有 dev サーバーを `localhost:5173`（人間の自動保存データと別オリジンになるので
localStorage を壊さない）で開き、worktree 用の一時エントリから origin/main のコードを読ませた。
譜面はピアノ譜・嬰ハ短調（調号4♯）・4/4。

| 確認したこと | 結果 |
| --- | --- |
| 声部2アクティブで3連符ツール → `voices[1]` に「音符1＋連符内休符2」が同じ `tuplet.id` で入り、声部1は不変 | ✅ 保存データで確認 |
| **置いた直後の形**（音符1＋末尾の連符内休符2）が描画される | ✅ ブラケットと「3」が出て、連符内休符2つも見える。`g.vf-tuplet` = 1 |
| 声部1＝付点リズムの旋律／声部2＝3連符伴奏が同居する9小節の譜例が崩れず描画される | ✅ 連符36グループ（9小節×4）すべて描画。臨時記号（♮・♯）も表示される |
| 連符描画のコンソールエラー | ✅ 0件（`NoStem` 例外は出ない） |
| 声部2の空き拍が足りないとき（4拍ぶん埋まった状態）に3連符ツールでクリック | ✅ 何も起こらない（イベント数・描画とも変化なし） |

補足として、検証中に気づいた**崩れではない差分**を1点記録しておく。声部2（`stemDirection: 'down'`）の
連符ブラケットは五線の**上側**に描かれる。符幹が下向きの声部では下側に置くのが浄書の慣習だが、
VexFlow の `Tuplet` に配置（`location`）を渡していないため既定の上側になっている。
読みづらさや重なりは出ていないので、今回は変更せず記録だけに留める（直すなら別Issue）。

なお、Issue のトリアージ追記で指定された「ベートーヴェン『月光』第1楽章 冒頭9小節を実際に入力して
確認する」については、**楽譜を記憶から復元すると誤った譜例を残す risk がある**ため、指定の趣旨
（声部1＝付点リズムの旋律／声部2＝3連符伴奏が同居する・嬰ハ短調4♯・臨時記号あり）を満たす
9小節の譜例を用意して確認した。市販譜そのままの音高ではない。

## 追記: MusicXML 声部2 書き出し・読み込み対応（Issue #113, 2026-07-29）

上記「今回のスコープ外（既知の制限）」で保留していた MusicXML の声部2対応を実装した。

### 背景

Issue #113 のトリアージコメントは「声部（`<voice>`）の書出は対応済み」という前提で
読込側だけを実装対象としていたが、実装前にコードを確認したところ、この前提は誤りだった。
`musicXmlExport.ts` は常に `noteToXml(ev, 1, ...)` で `<voice>1</voice>` を固定出力しており、
`measure.voices[1]`（声部2）を参照する処理が export 側に一切無く、声部2のデータは
書出の時点で既に失われていた（この設計書の「今回のスコープ外」の記載通りの状態のまま）。
Issue の受入条件にある往復テスト（声部2を含む譜面を書き出し→読み込み→元データと一致）を
満たすには読込側だけでは不十分なため、書出側の対応もこの対応の一部として実装した
（設計書のこの節が最初から予告していた「次回以降」の実装であり、設計方針と矛盾しない）。

### 修正設計

1. **書出（`musicXmlExport.ts`）**
   - `eventDurationTicks(ev)` を `noteToXml` から切り出し、`<backup>` の巻き戻し量計算と共有した。
   - `measureToXml` で `getMeasureVoices(measure)` を呼び、`voices[1].events` が1件以上あれば、
     声部1の全イベントの合計 duration ぶん `<backup><duration>N</duration></backup>` を出力してから
     `noteToXml(ev, 2, staff)` で声部2の音符を続けて出力する。
   - 声部2が無い小節（`voices` が無い、または `voices[1]` が空）は従来通り `<backup>` を出力しない
     （既存の単声部エクスポートと完全に同じ出力のまま。リグレッション防止）。
   - 声部2は強弱記号・松葉の入力UIが無いため、`buildHairpinPositionMaps`（声部1の `measure.events`
     のみを走査）や `dynamicsDirectionXml` の呼び出し対象には含めていない。

2. **読込（`musicXmlImport.ts`）**
   - `<measure>` の直接の子要素を `<backup>` の位置で分割し、`<backup>` より前を声部1、
     後を声部2として扱う（音符ごとの `<voice>` テキストではなく `<backup>` で区切る方式にしたのは、
     自分の書出フォーマットが常にこの並びで出力するため、実装がシンプルになるから）。
   - 声部2側に音符があれば `MeasureData.voices` を
     `[{id:'voice-1', events: 声部1のevents}, {id:'voice-2', events: 声部2のevents, stemDirection:'down'}]`
     の形で組み立てる。`stemDirection: 'down'` は `voiceMeasureUtils.withVoiceEventsUpdated` が
     声部2を新規作成するときの既定値と揃えている。
   - 声部2が無い小節は `voices` フィールド自体を付けない（既存の単声部インポートと同じ形のまま）。

### テスト

`musicXmlVoice2.test.ts`（新規）: 書出のみ（`<backup>`/`<voice>2</voice>` の出力確認、声部2無し時に
出力されないこと）と、往復（声部1・声部2の音価・音高・休符が復元されること、声部2無し時は
`voices` が付与されないこと）を確認した。

### 今回のスコープ外（既知の制限、変更なし）

- 声部2の強弱記号・松葉（ヘアピン）は入力UI自体が無いため、書出・読込とも対象外のまま。
- 3声部以上（`voices[2]` 以降）は今回も対象外（アプリの入力UI自体が声部1・2の2つまでのため）。
- 外部ソフト（Finale/Sibelius/MuseScore）が出力した、`<backup>` を使わず音符ごとの `<voice>` 番号
  だけで多声を表現する MusicXML ファイルの読込互換は検証していない（自分の書出↔読込が
  閉じることを優先する方針。詳細は Issue #113 のトリアージコメント参照）。

## 追記: 非アクティブ声部の淡色表示をビーム・連符にも効かせる修正（Issue #175, 2026-08-04）

### 問題

ピアノ譜で声部を切り替えたとき、非アクティブ側の声部の音符（符頭・符幹）は
薄いグレー（`INACTIVE_VOICE_COLOR = '#9ca3af'`）になるが、**8分音符などを繋ぐ
ビーム（連桁）だけが黒いまま残っていた**ため、どちらの声部を編集中か一目で分からなかった。
運用者の実機確認（2026-08-03）で報告され、レビュアーの調査で「連符（3連符など）の
括弧・数字も同様の可能性が高い」と指摘されていた。確認したところ連符も同じく黒のままだった。

### 原因

淡色化は `PianoSystemCanvas.tsx` の Pass 1 で音符1つずつに
`n.setStyle({fillStyle:INACTIVE_VOICE_COLOR, strokeStyle:INACTIVE_VOICE_COLOR})` を
掛けることで行っている（`StaveNote.setStyle` は内部で `setGroupStyle` を呼ぶので、
符頭だけでなく符幹などの子要素にも伝播する）。

一方ビームと連符は Pass 3 で
`entry.beams.forEach(b => b.setContext(ctx).draw())` /
`entry.tuplets.forEach(t => t.draw())` とスタイル無指定のまま描いていた。

ここで重要なのは **VexFlow 5 の `Beam.draw()` / `Tuplet.draw()` は
`setStyle()` したスタイルを自分では適用しない**（`Element.applyStyle` を呼ばない）こと。
そのため「`setStyle()` を足すだけ」では直らない。スタイルを反映させたい場合は
`Element.drawWithStyle()`（内部で `ctx.save()` → `applyStyle()` → `draw()` →
`ctx.restore()` を行う）を使う必要がある。

### 修正設計

1. `RenderedVoiceEntry` に `isInactiveVoiceEntry: boolean` を追加した。
   音符ごとの判定（Pass 1 の `isInactiveVoice`）と同じ
   `isMultiVoiceMeasure && voiceIndex !== activeVoiceIndex` だが、
   ビーム・連符は声部単位で存在するため、声部エントリ側に持たせて Pass 3 へ渡す。
2. Pass 3 のビーム描画を、非アクティブ声部のときだけ
   `b.setStyle(inactiveVoiceStyle); b.drawWithStyle();` に切り替えた。
   アクティブ声部・単声部小節は従来どおり `b.draw()` のままにして、
   スタイル指定を一切増やさない（リグレッション防止）。
3. 連符も同じ分岐にした。既存の try/catch（1つの連符の描画失敗で譜面全体を
   真っ白にしないための握りつぶし）はそのまま維持している。

`drawWithStyle()` の結果、VexFlow が `ctx.openGroup('beam'|'tuplet', ...)` を呼ぶ時点の
コンテキスト属性がグループ要素へ書き出されるので、SVG 上は
`<g class="vf-beam" fill="#9ca3af" stroke="#9ca3af">` の形になる。
ビーム本体の `<path>` 自体には色が付かず、この `<g>` から継承する。

### 印刷・PDF での扱い

App.css の印刷ルールには
`.print-page svg g[fill]:not([fill="none"]) { fill: var(--print-ink) !important; }`
（`g[stroke]` 側も同様）が既にあるため、`<g>` の属性で淡色化していれば
印刷・PDF書出では自動的に黒へ戻る。**インラインの `style` 属性ではなく属性で色を付ける**
ことがこの前提であり、テストでもその形を固定している。
実機の印刷プレビューでも、両声部のビーム・連符の `getComputedStyle().fill` が
`rgb(0, 0, 0)` になることを確認済み。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`
  - `RenderedVoiceEntry` 型に `isInactiveVoiceEntry` を追加
  - Pass 1 の声部エントリ生成に `isInactiveVoiceEntry` を追加
  - Pass 3 のビーム・連符描画に淡色分岐を追加
- 単声部の小節（`isMultiVoiceMeasure === false`）と、声部トグルの無い譜種では
  `isInactiveVoiceEntry` が常に false になるため、描画経路は従来と完全に同じ。

### テスト

`src/components/PianoSystemCanvasInactiveVoiceBeam.test.tsx`（新規・6件）

1. 声部2アクティブ時に声部1のビームだけがグレーになる
2. 声部1アクティブ時に声部2のビームだけがグレーになる（逆方向）
3. 単声部の小節（`activeVoiceIndex` を渡さない場合も含む）ではビームに色指定が付かない
4. 非アクティブ声部の連符（括弧・数字）もグレーになる
5. アクティブ声部の連符は色指定なしのまま
6. 淡色化が `<g>` の `fill` / `stroke` **属性**で行われている（＝印刷CSSが黒へ戻せる形）

修正前のコードに対してこのテストを流すと 1・2・4・6 が失敗することを確認した
（テストが実際にこの不具合を捕まえていることの確認）。

### ブラウザ確認（共有 dev サーバー / ピアノ譜・4/4・ハ長調）

`localhost:5173`（人間の自動保存データと別オリジン）で、
1小節目＝声部1に8分×2＋4分×3／声部2に4分＋8分×2＋4分×2、
2小節目＝声部1に8分3連符＋4分×3／声部2に4分×4、という譜例を読み込んで確認した。

- 声部1アクティブ時: 声部2のビームがグレー、声部1のビーム・連符は黒
- 声部2アクティブ時: 声部1のビーム2本と連符の括弧・数字がグレー、声部2のビームは黒
- 印刷プレビュー ON: すべてのビーム・連符の `getComputedStyle().fill` が `rgb(0,0,0)`
- コンソールエラーなし

### スコープ外（今回変更していないこと）

- 声部2の連符に ghost 休符（末尾の非表示休符）が含まれる場合に
  `Tuplet.getYPosition()` が `NoStem` 例外で落ちる既知の問題（Issue #168 の調査コメント参照）。
  今回の修正は描画色だけを扱っており、この例外の発生条件は変えていない
  （例外時の握りつぶしも従来どおり）。
  → **Issue #180 で解消済み**（次節）。

## 連符内の休符は ghost 化しない（Issue #180）

### 問題

追加声部（voiceIndex >= 1）で、3連符ツールで置いた直後の既定形
`[音符, 連符内休符, 連符内休符]` の連符が描画されず、再描画のたびにコンソールへ
例外が出ていた。

```
連符の描画でエラーが発生しました: [RuntimeError] NoStem: No stem attached to this note.
  at GhostNote.getStemDirection → _Tuplet.getYPosition → _Tuplet.draw
```

- 連符のブラケットと数字（「3」）だけが描かれず、音符・休符そのものと拍位置は正しい
- 声部1側の連符には影響しない
- 例外は `PianoSystemCanvas` の `entry.tuplets.forEach` の try/catch で握りつぶされるため、
  「エラーは出るが譜面は表示される」という気づきにくい壊れ方だった

### 原因

追加声部では「最後の発音イベントより後ろの休符」を非表示の `GhostNote` として描く
既存仕様（`shouldRenderGhostRest`）がある。置いた直後の声部2は「音符1つ＋休符2つ」なので、
**連符を構成する休符2つがまるごと ghost 化**されていた。

VexFlow の `Tuplet` はブラケットの縦位置を決めるときに構成音符の符幹（stem）の向きを見るが、
`GhostNote` は符幹を持たないため `getStemDirection()` が `NoStem` 例外を投げ、
連符の描画ごと失敗していた。

これは origin/main 時点から存在した既存バグで、声部2に連符を作る手段が MusicXML 読込しか
無かったため踏まれていなかっただけである（Issue #168 で声部2の連符入力を開けると、
通常操作で必ず踏む位置に来る）。

### 修正設計

`shouldRenderGhostRest` の先頭近く（`isRest` 判定の直後）に、
**`event.tuplet` を持つ休符は ghost 化しない（＝必ず見える休符として描く）** 分岐を追加した。

判断の根拠は2つある。

1. **浄書上の妥当性**: 連符は「音符1つ＋休符2つ」でもひとかたまりの単位であり、
   構成休符を隠すとブラケットと数字だけが宙に浮いて連符の意味が読めなくなる。
   連符内休符は常に可視が正しい
2. **ghost 休符の目的を損なわない**: ghost 休符の本来の目的は「追加声部の末尾を埋めるだけの
   ダミー休符を隠す」ことなので、連符**外**の休符に限定しても目的は達成される

`shouldRenderGhostRest` 以外（`createVexFlowTuplets`、`entry.tuplets` の draw、
`computeVoiceDisplayPadding`）は変更していない。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`（`shouldRenderGhostRest` に `tuplet` 分岐を追加。1関数のみ）
- 声部1（voiceIndex === 0）と単声部の小節は関数の先頭で `false` を返すため、見た目は一切変わらない
- 連符を含まない末尾のダミー休符は従来どおり ghost（非表示）のまま

### テスト

`src/components/PianoSystemCanvasTupletGhostRest.test.tsx`（新規・5件）

1. 声部2に連符を置いた直後の形で `g.vf-tuplet` が1つ描かれ、連符描画のエラーが出ない
2. 連符内の休符2つが見える休符として描かれる（`g.vf-stavenote` の個数で判定。
   `GhostNote` は `draw()` で何も描かないため、この g 要素を作らないことを利用している）
3. 連符に含まれない末尾のダミー休符は従来どおり ghost のまま（リグレッション）
4. 声部1の連符内休符は従来どおり見えるまま
5. 単声部の連符内休符も従来どおり

修正前のコードに対してこのテストを流すと 1・2 が失敗する
（`g.vf-tuplet` が0個、`g.vf-stavenote` が休符2つぶん少ない）ことを確認した。

### ブラウザ確認（共有 dev サーバー / ピアノ譜・嬰ハ短調4♯・4/4）

`localhost:5173`（人間の自動保存データと別オリジン）で、
1小節目＝声部1に4分×4／声部2に「置いた直後の形」の3連符、
2小節目＝声部1に4分×4／声部2に3連符4グループ（全て音符）、という譜例で確認した。

| | 修正前（main のエントリ） | 修正後（worktree のエントリ） |
| --- | --- | --- |
| `g.vf-tuplet` の総数 | 4 | **5** |
| `g.vf-stavenote` の総数 | 51 | **53**（連符内休符2つぶん増える） |
| コンソール | `NoStem` 例外 | エラーなし（声部トグルで3回再描画しても0件） |

声部1アクティブ時は連符のブラケット・数字がグレー、声部2アクティブ時は黒になる
（Issue #175 の淡色表示）ことも同じ譜例で確認した。

## 声部2のタイ／スラー・松葉（Issue #169）は別ファイルで設計中

このファイルで一貫して「スコープ外（声部2では無反応が正しい挙動）」としてきた
**タイ／スラー・松葉の声部2対応**は、Issue #169 として設計メモを先行作成した。
調査結果・データモデル案の比較・段階的PR分割案・未決定事項は
[`.claude/specs/voice2-arc-support/design.md`](../voice2-arc-support/design.md) を参照すること。

実装が入った段階で、実装記録（問題・修正設計・影響範囲）はこのファイルへ追記する
（このファイルが2声部実装の正本であるという既存の位置づけは変えない）。

### 実装の進み具合（段ごと）

| 段 | Issue | 状態 | 2声部の正本として押さえておく点 |
| --- | --- | --- | --- |
| 段1 描画収集の声部対応 | #186 | 実装済み | 位置マップのキーが声部込みの不透明文字列になり、`split('-')` 解析が全廃された。声部2の弧は**描かれるが掴めない**（当たり判定を作らない）状態 |
| 段2 編集整合性の声部対応 | #188 | 実装済み | 声部2の Delete が `noteDeletionUtils.deleteVoiceEventFromMeasures` を通るようになり、同じ声部の `arcs` / `hairpins` の終点除去・繰り上げ（連符グループ範囲を含む）が効く。**声部1のデータには触れない**のが仕様（索引は声部ローカル＝案A） |
| 段3 入力・選択・ドラッグの解禁 | 未起票 | 未着手 | `activeVoiceIndex!==0` のガードと、弧・松葉の Delete（`selectedArc` / `selectedHairpin` 経由）の声部1直書きが残っている |

各段の詳細な実装記録は [`.claude/specs/voice2-arc-support/design.md`](../voice2-arc-support/design.md) の
§15（段1）・§16（段2）にある。
