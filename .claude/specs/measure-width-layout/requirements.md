# Requirements Document

## Introduction

五線譜エディタにおいて、音価の種類に応じて小節の描画幅を自動的に決定する機能の仕様を定義します。音符が密集して重ならず、かつ空白が過剰にならない、読みやすい楽譜レイアウトを実現します。

## Glossary

- **Measure_Width**: 小節の描画幅（ピクセル単位）
- **Duration_Unit**: 音価ごとに割り当てられた相対的な幅占有量
- **UNIT_BY_DENOM**: 音価（分母）から Duration_Unit へのマッピングテーブル
- **Content_Width**: 小節内の音符・休符が必要とする最小幅
- **UNIT_WIDTH**: 1 Duration_Unit あたりのピクセル数（基準値）
- **Long_Note_Floor**: 全音符・二分音符を含む場合の最小幅下限
- **Fill_Ratio**: 利用可能なページ幅に対する小節幅の充填率（TARGET_FILL）
- **Formatter**: VexFlow の Formatter クラス（幅配分の実行者）

## Requirements

### Requirement 1: 音価別の幅重みの定義

**User Story:** 楽譜レイアウトシステムとして、各音価が視覚的に適切な幅を占めることで、演奏者が読みやすい楽譜を生成したい。

#### Acceptance Criteria

1. WHEN 小節の幅を計算する場合、THE Measure_Width_System SHALL 以下の Duration_Unit テーブルを基準として使用する：
   - 全音符（1）: 1.45 units
   - 二分音符（2）: 1.25 units
   - 四分音符（4）: 1.00 units（基準）
   - 八分音符（8）: 0.60 units
   - 十六分音符（16）: 0.50 units
   - 三十二分音符（32）: 2.20 units（フラグ分の余白を含む）
   - 六十四分音符（64）: 2.60 units（フラグ分の余白を含む）
2. WHEN 休符を含む小節の幅を計算する場合、THE Measure_Width_System SHALL 休符の Duration_Unit を音符の 0.85 倍として計算する
3. WHEN 三十二分音符または六十四分音符が含まれる場合、THE Measure_Width_System SHALL フラグ描画のために FLAG_EXTRA_PX（4px）を追加する

### Requirement 2: 最小幅の保証

**User Story:** レイアウトエンジンとして、音符の符頭が重ならず視覚的に識別可能な最小幅を常に確保したい。

#### Acceptance Criteria

1. WHEN 全音符を含む小節の幅を計算する場合、THE Measure_Width_System SHALL LONG_WHOLE_MIN（92px）を下限として保証する
2. WHEN 二分音符を含む小節の幅を計算する場合、THE Measure_Width_System SHALL LONG_HALF_MIN（80px）を下限として保証する
3. WHEN いずれの条件も満たさない小節の幅を計算する場合、THE Measure_Width_System SHALL MIN_MEASURE_W（52px）を下限として保証する
4. WHEN 空の小節の幅を計算する場合、THE Measure_Width_System SHALL EMPTY_MEASURE_UNITS（0.6）を基準とした幅を確保する

### Requirement 3: ページ幅への充填

**User Story:** レイアウトエンジンとして、利用可能なページ幅を最大限に活用し、間延びした楽譜にならないようにしたい。

#### Acceptance Criteria

1. WHEN 小節をページ幅に配置する場合、THE Measure_Width_System SHALL TARGET_FILL（0.99）の比率でページ幅を充填する
2. WHEN 1行に配置する小節数を決定する場合、THE Measure_Width_System SHALL [4, 3, 2, 1] の候補から最大小節数を試行し、収まる最大値を選択する
3. WHEN 選択した小節数でページ幅を分配する場合、THE Measure_Width_System SHALL 各小節の最小必要幅（minContentWidth）を満たした上で残余幅を均等配分する

### Requirement 4: 音価変換の一貫性

**User Story:** 開発者として、アプリ内の音価表現（DurKey）と VexFlow の音価表現（VFDur）および数値分母（denom）の間で一貫した変換が行われることを期待する。

#### Acceptance Criteria

1. WHEN DurKey（'1'|'2'|'4'|'8'|'16'|'32'|'64'）を VFDur に変換する場合、THE Measure_Width_System SHALL toVFDur() 関数を通じて正確に変換する
2. WHEN VFDur から拍数（beats）を取得する場合、THE Measure_Width_System SHALL beatsFromVF() 関数を使用し、4/4 拍子における音価の拍数を返す
3. WHEN 小節の拍数合計を検証する場合、THE Measure_Width_System SHALL BEATS_PER_MEASURE（4）を超える音符の追加を拒否する

### Requirement 5: 既存機能との整合性

**User Story:** 楽譜エディタのユーザーとして、幅の自動調整が音符の位置精度や再生機能に悪影響を与えないことを期待する。

#### Acceptance Criteria

1. WHEN 小節幅が変更される場合、THE Measure_Width_System SHALL VexFlow Formatter の適用後も音符の相対的な順序を維持する
2. WHEN 幅計算後に音符を追加または削除する場合、THE Measure_Width_System SHALL 再描画時に幅を再計算する
3. WHEN 複数段・複数ページのレイアウトで幅を計算する場合、THE Measure_Width_System SHALL 各段の小節幅を独立して計算する
