# Requirements Document

## Introduction

五線譜エディタにおいて、Web Audio API を直接使用して楽譜データを音声再生する機能の仕様を定義します。ブラウザの自動再生ポリシー（Autoplay Policy）に完全対応し、Tone.js に依存せず軽量・安定した音声再生を実現します。

## Glossary

- **AudioContext**: Web Audio API の中核クラス。音声処理グラフのルート
- **OscillatorNode**: 正弦波などの波形を生成するノード
- **GainNode**: 音量（ゲイン）を制御するノード
- **Autoplay_Policy**: ブラウザがユーザーインタラクションなしの音声再生を禁止するポリシー
- **Envelope**: アタック・ディケイ・リリースによる音量変化のカーブ
- **Pitch_Class**: 音名に対応するオクターブ無視の音高番号（0〜11）
- **VexFlow_Format**: VexFlow 形式の音高文字列（例: `"c/4"`, `"f#/3"`）
- **MIDI_Format**: 大文字音名 + オクターブ番号（例: `"C4"`, `"F#3"`）

## Requirements

### Requirement 1: AudioContext の遅延初期化

**User Story:** ブラウザの自動再生ポリシーに対応するため、AudioContext をユーザーのインタラクション（クリック等）が発生した後に初期化したい。

#### Acceptance Criteria

1. WHEN `SimpleAudioEngine` のコンストラクタが呼ばれた場合、THE Audio_System SHALL AudioContext を作成せず、初期化を遅延させる
2. WHEN `initialize()` が呼ばれた場合、THE Audio_System SHALL 新しい `AudioContext` を作成する
3. WHEN `initialize()` 後に AudioContext が `suspended` 状態の場合、THE Audio_System SHALL `context.resume()` を呼び出して再生可能な状態にする
4. WHEN `initialize()` が既に完了している場合、THE Audio_System SHALL 二重初期化を防いで即座に返る
5. WHEN `initialize()` に失敗した場合、THE Audio_System SHALL エラーをスローして呼び出し元に伝播する

### Requirement 2: 単音の再生

**User Story:** 音符をクリック時などに即座に音を鳴らし、適切なエンベロープで自然な音色を実現したい。

#### Acceptance Criteria

1. WHEN `playNote(frequency, duration)` が呼ばれた場合、THE Audio_System SHALL OscillatorNode と GainNode を作成してサイン波音を生成する
2. WHEN 音を再生する場合、THE Audio_System SHALL アタック 10ms・ディケイを duration の 30% 地点・リリースを duration 終了時とするエンベロープを適用する
3. WHEN 音を再生する場合、THE Audio_System SHALL 最大ゲインを 0.3 に設定して適切な音量を保つ
4. WHEN AudioContext が初期化されていない場合、THE Audio_System SHALL エラーをスローする

### Requirement 3: 音高変換（VexFlow 形式 → 周波数）

**User Story:** VexFlow 形式の音高文字列（`"c/4"`）から正確な再生周波数（Hz）を計算したい。

#### Acceptance Criteria

1. WHEN `noteToFrequency("c/4")` が呼ばれた場合、THE Audio_System SHALL 261.63Hz（中央ド）に近い周波数を返す
2. WHEN `noteToFrequency("a/4")` が呼ばれた場合、THE Audio_System SHALL 440.0Hz を返す（A440 基準）
3. WHEN VexFlow 形式（`"c/4"`）の音高が渡された場合、THE Audio_System SHALL MIDI 形式（`"C4"`）に正規化してから計算する
4. WHEN 臨時記号（# / b）を含む音高が渡された場合、THE Audio_System SHALL 対応する周波数に変換する
5. WHEN 無効な音高名が渡された場合、THE Audio_System SHALL 440Hz（A4）をデフォルト値として返す

### Requirement 4: 音価から秒数への変換

**User Story:** アプリ内音価（`"1"`, `"2"`, `"4"` 等）と BPM から音符の再生時間（秒数）を計算したい。

#### Acceptance Criteria

1. WHEN `durationToSeconds("4", 60)` が呼ばれた場合、THE Audio_System SHALL 1.0 秒を返す（BPM=60 での四分音符）
2. WHEN `durationToSeconds("1", 120)` が呼ばれた場合、THE Audio_System SHALL 2.0 秒を返す（BPM=120 での全音符）
3. WHEN 未知の音価キーが渡された場合、THE Audio_System SHALL デフォルト値として 1 拍（四分音符相当）を返す

### Requirement 5: 楽譜全体の順次再生

**User Story:** 全小節の音符を BPM に従って順次再生し、休符は無音で時間を進めたい。

#### Acceptance Criteria

1. WHEN `playScore(scoreData, bpm)` が呼ばれた場合、THE Audio_System SHALL すべての小節・音符を順次スケジューリングする
2. WHEN 音符が休符（`isRest=true`）の場合、THE Audio_System SHALL 音を鳴らさず音価分の時間だけ進める
3. WHEN 小節が空の場合、THE Audio_System SHALL 全音符1つ分の時間を無音で進める
4. WHEN AudioContext が初期化されていない場合、THE Audio_System SHALL エラーをスローする

### Requirement 6: リソース解放

**User Story:** コンポーネントのアンマウント時やページ離脱時に音声リソースを正しく解放したい。

#### Acceptance Criteria

1. WHEN `dispose()` が呼ばれた場合、THE Audio_System SHALL すべての OscillatorNode を停止・切断する
2. WHEN `dispose()` が呼ばれた場合、THE Audio_System SHALL AudioContext を閉じて `null` に設定する
3. WHEN `dispose()` が呼ばれた場合、THE Audio_System SHALL `isInitialized` フラグを `false` にリセットする
4. WHEN `dispose()` 中にエラーが発生した場合、THE Audio_System SHALL エラーをログに記録するが例外を外部に伝播しない
