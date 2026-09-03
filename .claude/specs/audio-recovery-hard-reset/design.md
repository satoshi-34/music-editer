# 音声復旧の強化

## 背景

通常の AudioContext 再初期化だけでは、
保存済みの音源方式や音色プロファイル自体が壊れている場合に
無音が続くことがあった。

## 方針

- `音声復旧` 実行時は現在設定の保持より「まず確実に鳴ること」を優先する
- 既定の再生設定（`DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS` = SoundFont/MusyngKite + ピアノ + 既定プロファイル）を安全な避難先として使う（#551 で記述を実挙動へ統一）
- localStorage の再生設定も同じ既定値へ戻し、次回起動へ不正状態を持ち越さない

## 実装

- `ScorePage.tsx`
  - `resetAudioSettingsToSafeDefaults()` を追加
  - `音声復旧` 時はこの関数を呼んでから既定設定で新しいエンジンを作る
  - 復旧後の楽器は `ピアノ`、音源方式は既定（`soundfont`・MusyngKite）、音色プロファイルは既定値へ固定する
  - `最小テスト音` を追加し、再生エンジンを通さない Web Audio の生存確認もできるようにする

## 安定性

- 無音時に原因が `SoundFont` 側か `AudioContext` 側か切り分けしやすくなる
- 壊れた保存設定が毎回読み込まれて無音を再発させるループを避ける
