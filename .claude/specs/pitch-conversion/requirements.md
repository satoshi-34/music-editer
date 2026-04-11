# Requirements Document

## Introduction

五線譜エディタにおいて、五線位置（line番号）・VexFlow形式のkey文字列・MIDI番号の3種の音高表現を相互変換する機能の仕様を定義します。これらの変換は音符の配置・移動・再生において中核を担うアルゴリズムです。

## Glossary

- **Line_Number**: 五線上の位置。0 = 第1線（F5）、0.5 = 第1線と第2線の間、4 = 第5線（E4）等。加線も含み負数（上加線）や 4 以上（下加線）の値を取る
- **Key_String**: VexFlow形式の音高文字列。例: `"c/4"`, `"f#/3"`, `"bb/5"`
- **MIDI_Number**: MIDI音高番号。C4（中央ド）= 60、半音ごとに1増減
- **Treble_Clef**: ト音記号（第2線がG4）
- **Pitch_Class**: オクターブを無視した音名の種類（0〜11）
- **Accidental**: 臨時記号（# = シャープ、b = フラット）
- **Enharmonic**: 異名同音（C# と Db が同じ音高）

## Requirements

### Requirement 1: 五線位置から Key_String への変換

**User Story:** 楽譜エディタとして、ユーザーがクリックした五線上の位置（Line_Number）から正確な音高（Key_String）を生成したい。

#### Acceptance Criteria

1. WHEN Line_Number が整数の場合（例: 0, 1, 2）、THE Pitch_System SHALL ト音記号における対応する「線上の音」の Key_String を返す
2. WHEN Line_Number が 0.5 刻みの値（例: 0.5, 1.5）の場合、THE Pitch_System SHALL ト音記号における対応する「間の音」の Key_String を返す
3. WHEN Line_Number が 0 の場合、THE Pitch_System SHALL `"f/5"` を返す（第1線 = F5）
4. WHEN 変換された Key_String を再度 Line_Number に変換した場合、THE Pitch_System SHALL 元の Line_Number と等しい値を返す（ラウンドトリップ保証）
5. WHEN Line_Number が五線範囲外（加線域）の場合、THE Pitch_System SHALL 正しいオクターブを計算した Key_String を返す

### Requirement 2: Key_String から五線位置への変換

**User Story:** 楽譜エディタとして、配置済み音符の Key_String から五線上の描画位置（Line_Number）を算出したい。

#### Acceptance Criteria

1. WHEN Key_String が `"c/4"` の場合、THE Pitch_System SHALL Line_Number として `3.5` を返す（中央ド = 第3線と第4線の間）
2. WHEN Key_String に臨時記号（# / b）が含まれる場合、THE Pitch_System SHALL 臨時記号を無視して基音名のみで Line_Number を計算する
3. WHEN 無効な Key_String が渡された場合、THE Pitch_System SHALL デフォルト値（2.0 = 第3線 B4）を返してクラッシュしない
4. WHEN `lineToKeyTreble(keyToLineTreble(key))` を実行した場合、THE Pitch_System SHALL 元の key と同じ音名・オクターブ（臨時記号除く）を返す

### Requirement 3: Key_String から MIDI 番号への変換

**User Story:** 音声再生システムとして、VexFlow形式の Key_String から MIDI 番号を計算し、正確な周波数で音を再生したい。

#### Acceptance Criteria

1. WHEN Key_String が `"c/4"` の場合、THE Pitch_System SHALL MIDI 番号として `60` を返す
2. WHEN Key_String が `"a/4"` の場合、THE Pitch_System SHALL MIDI 番号として `69` を返す（A440 の基準音）
3. WHEN Key_String にシャープ（#）が含まれる場合、THE Pitch_System SHALL 対応する MIDI 番号を 1 増加させる
4. WHEN Key_String にフラット（b）が含まれる場合、THE Pitch_System SHALL 対応する MIDI 番号を 1 減少させる
5. WHEN 無効な Key_String が渡された場合、THE Pitch_System SHALL `null` を返してエラーを伝播する

### Requirement 4: MIDI 番号から Key_String への変換

**User Story:** 音符移動機能として、半音単位の上下移動後の MIDI 番号から適切な Key_String を生成したい。

#### Acceptance Criteria

1. WHEN MIDI 番号が 60 の場合、THE Pitch_System SHALL `"c/4"` を返す
2. WHEN preferSharp が `true` の場合、THE Pitch_System SHALL 黒鍵をシャープ記法（例: `"c#/4"`）で返す
3. WHEN preferSharp が `false` の場合、THE Pitch_System SHALL 黒鍵をフラット記法（例: `"db/4"`）で返す
4. WHEN MIDI 番号が負または 127 超の境界値の場合、THE Pitch_System SHALL 算術的に正しいオクターブの Key_String を返す
5. WHEN `keyToMidi(midiToKey(n, true))` を実行した場合、THE Pitch_System SHALL 元の MIDI 番号 n と等しい値を返す

### Requirement 5: 半音・オクターブ移動の統合

**User Story:** キーボード操作による音符移動機能として、Alt+↑/↓（半音）と Shift+↑/↓（オクターブ）の操作で正確な音高変更を行いたい。

#### Acceptance Criteria

1. WHEN Alt+↑ が押された場合、THE Pitch_System SHALL keyToMidi で MIDI 番号を取得し、+1 した後 midiToKey（preferSharp=true）で Key_String を生成する
2. WHEN Alt+↓ が押された場合、THE Pitch_System SHALL MIDI 番号を -1 した後 midiToKey（preferSharp=false）で Key_String を生成する
3. WHEN Shift+↑ が押された場合、THE Pitch_System SHALL keyToLineTreble で -3.5（7 音 = 1 オクターブ分）して lineToKeyTreble で Key_String を生成する
4. WHEN ↑ が押された場合、THE Pitch_System SHALL keyToLineTreble で -0.5（1 段分）して lineToKeyTreble で Key_String を生成する
5. WHEN 変換元が休符の場合、THE Pitch_System SHALL いかなる移動操作も行わずに元の状態を維持する
