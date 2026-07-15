# 設計書: ピアノ譜 2 Voice 基盤

`.claude/specs/piano-two-voice-implementation/design.md` と同じ方針で、
まずは **ピアノ譜だけ** に `2 voice` の土台を入れる。

## 要点

- `MeasureData.voices` を追加して、同じ小節内に複数声部を持てるようにする
- 既存互換のため `measure.events` は primary voice の正本として残す
- 描画は `PianoSystemCanvas` が複数 `Voice` を重ねる
- 再生は `startBeat` つきイベントへ平坦化して、同時発音位置を保持する
- サンプル譜 `エリーゼのために` の一部を 2 voice 化して見た目を改善する

## 追記: 入力UI対応（2声部入力トグル）

詳細は `.claude/specs/piano-two-voice-implementation/design.md` の同名セクションを参照（内容は同一に保つ）。

- `ScorePage.tsx` にピアノ譜専用の声部切り替えトグル（声部1/声部2、`V` キー）を追加した
- `PianoSystemCanvas.tsx` の `doInsert` は声部2選択時、`voiceMeasureUtils.withVoiceEventsUpdated()` で
  `measure.voices[1]` へ追記する（挿入位置は小節末尾への追記のみ）
- 声部2の音符はクリックで選択でき、Delete/Backspace キーで削除できる（それ以外のキー操作は対象外）
- 再生・保存・Undo は既存の `flattenMeasureForPlayback` / `voices` 永続化 / 履歴機構にそのまま乗るため追加実装なし
- スコープ外: `StaffCanvas.tsx`（ピアノ譜以外）への声部トグル表示、声部2への位置指定挿入、
  声部2の音高変更・アーティキュレーション・タイ／スラー編集、MusicXML の声部2書き出し・読み込み
- ブラウザ確認で見つけたバグ: 音符クリックハンドラ（`hit`/`ir`）が声部1（`safeEvs`）前提で
  書かれており、`activeVoiceIndex` を見ていなかったため、声部2の小節に声部1の音符があると
  クリックが声部1側の分岐（和音追加・休符置換など）に横取りされ、声部2への挿入・選択が
  効かなかった。`handleVoice2Click(lx, ly)` を追加し、両ハンドラの先頭で
  `activeVoiceIndex === 1` のときはそちらへ流すよう修正した（詳細は `.claude/specs/` 側を参照）
