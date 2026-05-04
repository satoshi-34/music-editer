# 設計書: ピアノ譜 2 Voice 基盤

`.claude/specs/piano-two-voice-implementation/design.md` と同じ方針で、
まずは **ピアノ譜だけ** に `2 voice` の土台を入れる。

## 要点

- `MeasureData.voices` を追加して、同じ小節内に複数声部を持てるようにする
- 既存互換のため `measure.events` は primary voice の正本として残す
- 描画は `PianoSystemCanvas` が複数 `Voice` を重ねる
- 再生は `startBeat` つきイベントへ平坦化して、同時発音位置を保持する
- サンプル譜 `エリーゼのために` の一部を 2 voice 化して見た目を改善する
