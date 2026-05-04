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

## セキュリティ・安定性配慮

- 保存前に `voices[0]` と `events` を同期し、データ不整合を減らす
- `startBeat` と `velocity` は再生直前に安全な数値として扱う
- 既存の単声部データは `voices` なしのままそのまま読める
- 編集系はまず primary voice を正本に据え、複数箇所の一括改修を避けて退行を抑える
