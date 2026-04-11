# Requirements Document

## Introduction

五線譜エディタにおいて、ブラウザウィンドウの幅に応じてページの表示スケールを自動的に調整する機能の仕様を定義します。A4 用紙サイズのページが常に画面に収まるよう縮尺を自動計算し、ふらつき（スケールの頻繁な微小変動）を防止します。

## Glossary

- **Page_Scale**: ページの表示倍率（0.1〜1.0）
- **A4_Width**: A4 用紙の幅（210mm × 3.78px/mm ≒ 793.8px）
- **Rail**: ページ群を包む外側のコンテナ要素（利用可能幅の計測対象）
- **Spread**: ページ群を並べる内側のコンテナ要素（スケール変換の基点）
- **Columns**: 1 行に並べるページ数（1 または 2）
- **Hysteresis**: ふらつき防止のための変化量しきい値（±0.5%）
- **ResizeObserver**: 要素のサイズ変化を監視するブラウザ API
- **rAF**: requestAnimationFrame（描画フレームに同期した更新スロットリング）

## Requirements

### Requirement 1: A4 ページの自動スケール計算

**User Story:** 楽譜エディタのユーザーとして、ウィンドウサイズに関わらず A4 用紙全体が常に画面内に収まるよう自動的に縮小表示されることを期待する。

#### Acceptance Criteria

1. WHEN ページを表示する場合、THE Scale_System SHALL A4 幅（210mm × 3.78px/mm = 793.8px）を基準としてスケールを計算する
2. WHEN 複数列表示（columns=2）の場合、THE Scale_System SHALL 2ページ分の合計幅（2 × A4 幅 + gap）に対してスケールを計算する
3. WHEN 計算したスケールが 1.0 を超える場合、THE Scale_System SHALL スケールを 1.0 に上限クリップする（拡大は行わない）
4. WHEN 計算したスケールが 0.1 を下回る場合、THE Scale_System SHALL スケールを 0.1 に下限クリップする
5. WHEN スケールを計算する場合、THE Scale_System SHALL `avail × 0.98 / need` の計算式を使用し、左右 1% の余白を確保する

### Requirement 2: ふらつき防止（ヒステリシス）

**User Story:** 楽譜エディタのユーザーとして、ウィンドウサイズのわずかな変化（1px 単位のリサイズなど）でページが連続的にスケール変動しないことを期待する。

#### Acceptance Criteria

1. WHEN 新たに計算したスケールと前回スケールの差が ±0.5% 未満の場合、THE Scale_System SHALL スケールを更新せず現在値を維持する
2. WHEN 差分の判定に使用するしきい値を計算する場合、THE Scale_System SHALL `max(0.005, prevScale × 0.005)` を使用して相対しきい値を適用する
3. WHEN スケールが大きく変化した場合（±0.5% 以上）のみ、THE Scale_System SHALL React の state を更新して再描画をトリガーする

### Requirement 3: 効率的なリサイズ監視

**User Story:** 開発者として、リサイズ処理が過剰に実行されることなく、かつリサイズ完了時には必ずスケールが更新されることを期待する。

#### Acceptance Criteria

1. WHEN Rail 要素のサイズが変化した場合、THE Scale_System SHALL ResizeObserver を通じて変化を検知する
2. WHEN ウィンドウのリサイズイベントが発生した場合、THE Scale_System SHALL window の resize イベントも監視してスケールを更新する
3. WHEN スケール更新が要求された場合、THE Scale_System SHALL requestAnimationFrame でスロットリングし、同一フレーム内での重複計算を防止する
4. WHEN コンポーネントがアンマウントされた場合、THE Scale_System SHALL ResizeObserver の disconnect・イベントリスナーの削除・rAF のキャンセルをすべて実行してリソースリークを防止する

### Requirement 4: 初期スケールの即座な適用

**User Story:** 楽譜エディタのユーザーとして、ページ初回表示時にスケールが正しく設定された状態で描画されることを期待する。

#### Acceptance Criteria

1. WHEN コンポーネントがマウントされた場合、THE Scale_System SHALL 監視開始と同時に初回スケール計算を即座に実行する
2. WHEN columns または gapPx が変更された場合、THE Scale_System SHALL スケールを再計算して新しいレイアウトに適応する
