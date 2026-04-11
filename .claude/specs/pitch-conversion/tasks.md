# 実装計画: 音高変換システム

## 概要

五線位置・VexFlow Key_String・MIDI 番号の3種の音高表現を相互変換する関数群と、それを使ったキーボード操作による音符移動機能の実装状況を追跡します。すべてのタスクは実装済みです（`src/components/StaffCanvas.tsx`）。

---

## タスク

- [x] 1. lineToKeyTreble の実装
  - ト音記号基準（第0線=F5）での Line_Number → Key_String 変換
  - 0.5刻みスナップ処理（`Math.round(line*2)/2`）
  - オクターブ境界での while ループによる正規化
  - _要件: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. keyToLineTreble の実装
  - Key_String → Line_Number 変換
  - 臨時記号（#/b）を無視した基音名のみでの計算
  - 無効入力時のデフォルト値（2.0）返却
  - _要件: 2.1, 2.2, 2.3, 2.4_

- [x] 3. LETTER_TO_PC テーブルの定義
  - 音名（c〜b）からピッチクラス（0〜11）へのマッピング
  - 白鍵のみを定義（黒鍵は ±1 で計算）
  - _要件: 3.1, 3.2, 3.3_

- [x] 4. keyToMidi の実装
  - Key_String → MIDI 番号変換（C4=60 基準）
  - シャープ（+1）・フラット（-1）の適用
  - `((pc%12)+12)%12` による正規化（Cb→B 等）
  - 無効入力時の null 返却
  - _要件: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. midiToKey の実装
  - MIDI 番号 → Key_String 変換
  - `preferSharp` フラグによるシャープ/フラット記法の切り替え
  - 負または 127 超の MIDI 番号への対応
  - _要件: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. キーボード音符移動ハンドラの実装
  - ↑/↓: `keyToLineTreble(-0.5)` → `lineToKeyTreble` による半音名移動
  - Shift+↑/↓: `±3.5` による1オクターブ移動
  - Alt+↑/↓: `keyToMidi → ±1 → midiToKey` による半音移動
  - 休符に対する移動スキップ
  - _要件: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. スナップ精度の修正
  - `toFixed(1)` から `Math.round(line*2)/2` への変更（Bug Fix #5）
  - 浮動小数点誤差による音高ずれを防止
  - _要件: 1.4, 2.4_

---

## テスト観点

- `lineToKeyTreble(0)` → `"f/5"` を確認
- `lineToKeyTreble(3.5)` → `"c/4"` を確認（中央ド）
- `keyToLineTreble("c/4")` → `5.0`、往復 `lineToKeyTreble(5.0)` → `"c/4"` を確認
- `keyToMidi("c/4")` → `60` を確認
- `keyToMidi("a/4")` → `69` を確認（A440）
- `keyToMidi("f#/3")` → シャープが +1 されることを確認
- `midiToKey(60, true)` → `"c/4"` を確認
- `midiToKey(61, true)` → `"c#/4"`、`midiToKey(61, false)` → `"db/4"` を確認
- `keyToMidi(midiToKey(n, true))` → `n` のラウンドトリップを確認
- 休符ノードでの ↑↓ 操作 → 移動が発生しないことを確認
