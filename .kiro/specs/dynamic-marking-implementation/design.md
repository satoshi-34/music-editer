# 設計書: 強弱記号（Dynamics）実装

`.claude/specs/dynamic-marking-implementation/design.md` と同じ方針で、  
`p / mp / mf / f / ff / cresc. / dim.` を **音符起点の文字系強弱記号** として実装する。

## 要点

- 保存先は `MeasureData` ではなく `NoteEvent.dynamics`
- 入力は `Palette` の専用ツールから行う
- 描画は VexFlow 本体を壊さないよう SVG テキストを後描きする
- 再生では `dynamicMarkingUtils.ts` で解決したベロシティを、`ScorePage -> PlaybackEngine.playParts()` の現在経路にも渡す
- localStorage 読み込み時は `dynamics.value` を許可済み文字列だけ通す
