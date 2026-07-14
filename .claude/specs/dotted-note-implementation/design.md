# 設計書: 付点音符・付点休符の実装

## 概要

音符・休符に「付点」（音価を1.5倍に伸ばす記号）を付けられるようにする。
複付点（1.75倍）もデータ・計算上は対応するが、入力UIは付点1個（dots:1）のみ提供する簡易仕様とする。

## 問題点

- 既存の `NoteEvent` は `dur: DurKey`（1,2,4,8,16,32,64）のみを持ち、付点を表現できない
- そのため「付点4分音符」のような一般的な音価を入力できず、6/8 拍子などの記譜が不自然になる
- 拍数（beat）計算をしている箇所が複数ファイルに分散しており、付点対応にはそれぞれに倍率計算を差し込む必要がある

## 修正設計

### 1. `NoteEvent` に付点フィールドを追加（`types/storage.ts`）

```ts
export interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  dots?: 1 | 2; // 1=付点(1.5倍), 2=複付点(1.75倍)。省略時は付点なし
  // ...既存フィールド
}
```

旧セーブデータとの互換のため必須フィールドにしない。

### 2. 入力UI（`components/Palette.tsx` / `components/ScorePage.tsx`）

- 音符/休符ボタン行に「付点トグルボタン（`.`）」を追加。クリックで現在の `Tool` の `dots` を `1` ⇔ `undefined` に切り替える。
- キーボードショートカット `.`（ピリオドキー）でも同様にトグルできる（`ScorePage.tsx` の keydown ハンドラに追加。テキスト入力中は既存の仕組みで無効化される）。
- 付点トグルON中に音符/休符を配置すると、生成される `NoteEvent` に `dots: 1` が付く。
- トグルボタンは ON のとき背景色を変えて（青枠＋薄い青背景）、押し忘れ・押しっぱなしが見た目でわかるようにした。

### 3. 描画（`components/StaffCanvas.tsx` / `components/PianoSystemCanvas.tsx`）

- 両ファイルとも VexFlow の `StaveNote` を生成する共通関数（`makeVFNote`）が1箇所ずつあるため、そこに集約する形で対応。
- `event.dots` の数だけ `Dot.buildAndAttach([note], { all: true })` を呼ぶ（1回呼ぶごとに付点が1個増えるVexFlow 5系の挙動を利用）。休符・通常の音符・全休符フォールバックのどの分岐でも同じ `attachDots` ヘルパーを通す。
- `StaveNote` の `duration` 文字列自体（`'4d'` のような接尾辞）は使わず、既存の「音符生成 → モディファイア追加」というこのプロジェクトのパターン（臨時記号・前打音・トリルと同様）に合わせた。

### 4. 拍数（beat）計算の一般化 ★重要

「4分音符=1拍」の基準で拍数を計算している箇所を洗い出し、すべてに付点倍率（1個=1.5倍、2個=1.75倍）を適用した。

共通ヘルパーは `src/utils/voiceMeasureUtils.ts` に集約:

```ts
export function dotsMultiplier(dots?: 1 | 2): number // 1→1.5, 2→1.75, undefined→1
export function getDurationBeats(dur, dots?): number  // 音価と付点から拍数を計算
export function getEventDurationBeats(event): number   // event.dots を反映済み（既存関数を拡張）
```

`ScorePage.tsx` は既に `getMeasureDurationBeats` / `getEventDurationBeats` 経由の共通関数のみを使っていたため、そこは自動的に付点対応した。

一方、`StaffCanvas.tsx` と `PianoSystemCanvas.tsx` は VexFlow の duration文字列（`'q'`, `'8'` 等）を経由するローカルな `beatsFromVF(toVFDur(dur))` を多用しており、`voiceMeasureUtils` の関数とシグネチャが噛み合わなかった。
共通化による広範囲な書き換えのリスクを避けるため、**各ファイルに小さな `dotBeatsMultiplier(dots)` 関数を複製し、`beatsFromVF(toVFDur(dur)) * dotBeatsMultiplier(dots)` という形で呼び出し側に掛け算を追加する**方針を採った（重複コードだが影響範囲が最小で安全）。対象は以下の箇所（両ファイルで同型）:

- `buildRestEditReplacement`（休符クリックで音符に置き換える／分割する処理）
- `fillPriorMeasureRests` 内の小節拍数集計
- 小節へ新規イベントを挿入する `doInsertAt` / `doInsert`（付点トグルの状態を `tool.dots` として受け取り、`addBeats` 計算と挿入イベントの `dots` フィールドの両方に反映）

`components/RestOverlapFixV2.ts`（休符の見た目位置調整）にも同様の `dotBeatsMultiplier` を追加し、`beats` 計算に反映した。

`src/audio/NotePlayer.ts` の `_durToSeconds` と `src/audio/ScorePlayer.ts` の `durToSeconds` はどちらも `(dur, bpm)` のシグネチャに `dots?` 引数を追加し、呼び出し側から `event.dots` を渡すよう変更した。

`src/utils/timeSignatureUtils.ts` は `DurKey`/`dur` を直接扱っていないことを確認済みのため変更不要。

### 5. 休符への差し込みルール（保守的な仕様）★設計判断

付点音符を既存の休符へ差し込む（`buildRestEditReplacement`）ときの仕様:

> **付点音符は「その場に少なくとも付点分の長さの空きがあるか」だけで判定する。**
> 休符側を付点休符に分割し直すような複雑な処理は行わない。

具体的には、`noteBeats`（付点込みの音符の長さ）と `restBeats`（対象休符の長さ、休符自体が付点休符ならそれも考慮）を比較し、

- `noteBeats === restBeats` なら休符をそのまま音符に置き換える
- `noteBeats < restBeats` なら残り拍数から**付点なしの**休符を作って埋める（既存の `durKeyFromBeats` をそのまま使用）
- `noteBeats > restBeats` なら配置を拒否する（既存の「入らない音符は拒否」という挙動を踏襲）

これにより、「付点休符へ再分割して隙間なく詰める」といった高度な処理を実装せずに済み、既存の休符自動補完・分割ロジックとの整合性を保てる。

### 6. MusicXML 入出力（`utils/musicXmlExport.ts` / `utils/musicXmlImport.ts`）

- エクスポート: `<duration>` は `DUR_TO_DIV[dur] * dotMultiplier` を四捨五入した値。付点の数だけ `<dot/>` 要素を出力する。
- インポート: `<note>` の直接の子要素に含まれる `<dot/>` の数を数え、1個なら `dots: 1`、2個以上なら `dots: 2` として読み込む（`:scope` 疑似クラスは環境差が心配なため `children` を直接見て判定）。

### 7. MIDI書き出し（`utils/midiExport.ts`）

`DUR_TO_TICKS[dur] * dotMultiplier` を四捨五入してノートの長さ（tick数）とする。

### 8. 保存データのバリデーション（`utils/storage.ts`）

`validateNoteEvent` に `dots === undefined || dots === 1 || dots === 2` のチェックを追加。それ以外の値（文字列や3以上の数値など）を含むデータは、他の不正フィールドと同様に保存全体を拒否する（`corrupted_data` エラー）。

## 影響範囲（変更ファイル一覧）

- `src/types/storage.ts` — `NoteEvent.dots` 追加
- `src/components/Palette.tsx` — `Tool` に `dots` 追加、付点トグルボタン追加
- `src/components/ScorePage.tsx` — `.` キーのショートカット追加
- `src/components/StaffCanvas.tsx` — Dot描画、拍数計算、挿入処理の付点対応
- `src/components/PianoSystemCanvas.tsx` — 同上
- `src/components/RestOverlapFixV2.ts` — 休符位置調整の拍数計算に付点反映
- `src/utils/voiceMeasureUtils.ts` — `dotsMultiplier` / `getDurationBeats` 追加、`getEventDurationBeats` 拡張
- `src/audio/NotePlayer.ts` — `_durToSeconds` に `dots` 引数追加
- `src/audio/ScorePlayer.ts` — `durToSeconds` に `dots` 引数追加
- `src/utils/musicXmlExport.ts` — `<dot/>` 出力、duration計算に付点反映
- `src/utils/musicXmlImport.ts` — `<dot/>` 読み込み
- `src/utils/midiExport.ts` — tick計算に付点反映
- `src/utils/storage.ts` — `dots` のバリデーション追加
- `src/utils/voiceMeasureUtils.test.ts` — 付点拍数計算のテスト追加
- `src/utils/storage.test.ts` — 付点バリデーションのテスト追加
- `src/utils/musicXmlDots.test.ts`（新規） — MusicXML 付点ラウンドトリップのテスト
- `src/components/BackwardCompatibility.test.tsx` — パレットボタン数の期待値を +1（付点トグル分）に更新

## 追記: SoundFontEngine の付点対応漏れを修正（2026-07-14）

初回実装のレビューで、`src/audio/SoundFontEngine.ts` が `event.dots` を一切参照していない点が漏れとして見つかった。SoundFont再生（`NotePlayer`/`ScorePlayer` を使わない別経路の再生エンジン）では、付点音符が付点なしの長さで鳴り、以降のイベントのタイミングが前倒しにずれる不具合があった。

対応内容:

- `src/audio/PlaybackEngine.ts` の `PlaybackMeasureEvent` に `dots?: 1 | 2` を追加し、`NoteEvent.dots` と同じ意味のフィールドを再生エンジン間で受け渡せるようにした。
- `src/audio/SoundFontEngine.ts`
  - `durationToSeconds(duration, bpm, dots?)` に `dots` 引数を追加し、ローカルに複製していた `DURATION_TO_BEATS` テーブル＋独自倍率計算を廃止して、`voiceMeasureUtils.ts` の `getDurationBeats` を再利用する形に統一した（他の再生系と同じ計算式にすることで、今後の重複漏れを防ぐ狙い）。
  - `playParts` 内の呼び出し箇所（音符の発音長さ計算）と、複数声部小節の終端拍（`endBeat`）計算の2箇所で `event.dots` を渡すように修正した。
- テスト: `src/audio/SoundFontEngine.test.ts` に、`durationToSeconds` が dots=1 で1.5倍、dots=2 で1.75倍になることを確認するテストを追加した。

### 影響範囲（追加分）

- `src/audio/PlaybackEngine.ts` — `PlaybackMeasureEvent.dots` 追加
- `src/audio/SoundFontEngine.ts` — 付点を考慮した長さ計算に修正、ローカルの `DURATION_TO_BEATS` を削除して `voiceMeasureUtils.getDurationBeats` に統一
- `src/audio/SoundFontEngine.test.ts` — 付点の長さ計算テストを追加

## 実装内容メモ（実装後の補足）

- ブラウザ確認では、4/4拍子で付点4分音符を配置して丸い付点がVexFlow描画で表示されること、6/8拍子で付点4分音符2個がちょうど1小節を埋め、3個目は入力拒否（測度いっぱいの判定が効く）ことを確認した。
- 保存→リロードでも `localStorage` 上に `dots:1` が保持され、再描画時にも付点が表示されることを確認した。
