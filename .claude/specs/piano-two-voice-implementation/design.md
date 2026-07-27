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
- **矢印キーでの音高変更**（Delete 以外のキーボード操作）も、既存の実装が
  `measure.events`（声部1）前提のままで、声部2の音符選択時は Delete 以外は
  何もしない（`sel.voiceIndex` があるときは Delete/Escape のみ受け付ける既存挙動を維持）。

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
