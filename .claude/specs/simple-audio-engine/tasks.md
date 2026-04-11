# 実装計画: SimpleAudioEngine

## 概要

Web Audio API を直接使用したシンプルな音声エンジンの実装状況を追跡します。すべてのタスクは実装済みです（`src/audio/SimpleAudioEngine.ts`）。

---

## タスク

- [x] 1. クラス基本構造の実装
  - `SimpleAudioEngine` クラスの定義
  - `context` / `isInitialized` / `oscillators` の内部フィールド宣言
  - `defaultSimpleAudioEngine` シングルトンのエクスポート
  - _要件: 1.1_

- [x] 2. 遅延初期化（initialize）の実装
  - `new AudioContext()` によるコンテキスト作成
  - `context.state === 'suspended'` の場合の `resume()` 呼び出し
  - 二重初期化防止ガード
  - エラー時の例外スロー
  - _要件: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. エンベロープ付き単音再生（playNote）の実装
  - `OscillatorNode` + `GainNode` の生成と接続
  - アタック 10ms / ディケイ / リリース のゲインカーブ設定
  - `oscillator.start()` / `oscillator.stop()` のスケジュール
  - _要件: 2.1, 2.2, 2.3, 2.4_

- [x] 4. 時刻指定再生（playNoteAtTime）の実装
  - `startTime` パラメータによる未来時刻へのスケジュール
  - `playScore` からの呼び出しのみ（private）
  - _要件: 5.1_

- [x] 5. 音高変換（noteToFrequency / normalizeNoteFormat）の実装
  - VexFlow 形式 → MIDI 形式の正規化
  - `noteMap` テーブルによるピッチクラス計算
  - A4=440Hz 基準の周波数計算式
  - 無効入力時のデフォルト値（440Hz）
  - _要件: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. 音価変換（durationToSeconds）の実装
  - `durMap` テーブルによる拍数計算
  - `beats × (60 / bpm)` による秒数計算
  - 未知音価のデフォルト値（1拍）
  - _要件: 4.1, 4.2, 4.3_

- [x] 7. 楽譜全体再生（playScore）の実装
  - `context.currentTime` 基準の時刻管理
  - 空小節・休符の無音スキップ
  - 各音符の `playNoteAtTime` スケジューリング
  - _要件: 5.1, 5.2, 5.3, 5.4_

- [x] 8. リソース解放（dispose）の実装
  - `oscillators` Map の全停止・切断
  - `context.close()` + `context = null`
  - `isInitialized = false` リセット
  - エラーのキャッチとログ記録
  - _要件: 6.1, 6.2, 6.3, 6.4_

---

## テスト観点

- コンストラクタ直後: `context === null` / `isInitialized === false` を確認
- `initialize()` 呼び出し後: `isReady() === true` を確認
- `initialize()` の二重呼び出し: エラーなく完了し AudioContext が再作成されないことを確認
- `noteToFrequency("a/4")` → 440Hz を確認
- `noteToFrequency("c/4")` → 261.63Hz に近い値を確認
- `noteToFrequency("f#/3")` → 185.00Hz に近い値を確認（臨時記号対応）
- `durationToSeconds("4", 60)` → 1.0 秒を確認
- `durationToSeconds("1", 120)` → 2.0 秒を確認
- `playScore` で休符: 音が鳴らず時間が進むことを確認
- `dispose()` 後: `context === null` / `isInitialized === false` を確認
