# Changelog

## [0.3.0] - 2025-09-13
### Added
- MuseScore風の小節幅の自動割り付け
  - 全音符・二分音符はやや広め
  - 32分・64分は重みを強めて詰まりや溢れを防止

### Fixed
- クリック位置のズレを根本解消
  - client座標 → VexFlow `<g>` ユーザー座標に **CTM逆変換**で統一
  - Y方向は **getSpacingBetweenLines()** に基づく **0.5刻みスナップ**
  - **線バイアス**（LINE_PAD_RATIO/LINE_BIAS）で線上クリックの吸着性を改善
  - クリックヒット領域を **getYForLine(-1)〜(5)** に拡張

### Notes
- 既存譜への互換性に影響はありません（Breaking changes: なし）
- `StaffCanvas.tsx` に定数 `LINE_PAD_RATIO` / `LINE_BIAS` を導入（微調整可能）

