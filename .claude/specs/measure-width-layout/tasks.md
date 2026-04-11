# 実装計画: 小節幅の自動割り付け

## 概要

VexFlow の Formatter に依存せず、音価と拍数に基づいた独自の幅計算アルゴリズムで小節幅を決定します。
すべてのタスクは実装済みです（`src/components/StaffCanvas.tsx`）。

---

## タスク

- [x] 1. 音価変換ユーティリティの実装
  - `toVFDur()` — DurKey → VFDur
  - `beatsFromVF()` — VFDur → 拍数
  - `vfToDenom()` — VFDur → 分母数値
  - _要件: 4.1, 4.2_

- [x] 2. UNIT_BY_DENOM テーブルの定義
  - 全音符〜六十四分音符の 7 種を定義
  - 32/64 分に FLAG_EXTRA_PX を追加
  - _要件: 1.1, 1.3_

- [x] 3. unitsForEvent() の実装
  - 休符係数（0.85）の適用
  - フラグ余白の加算
  - _要件: 1.1, 1.2, 1.3_

- [x] 4. minContentWidth() の実装
  - 空小節の最小幅計算
  - hasWhole / hasHalf による下限保証
  - MIN_MEASURE_W の常時保証
  - _要件: 2.1, 2.2, 2.3, 2.4_

- [x] 5. 段あたり小節数の自動決定
  - candidates = [4, 3, 2, 1] の試行ループ
  - TARGET_FILL の充填率制約
  - _要件: 3.1, 3.2_

- [x] 6. 残余幅の比例配分
  - 各小節の minContentWidth の比率で残余幅を配分
  - _要件: 3.3_

- [x] 7. 拍数制限の検証
  - beatsFromVF による拍数合計チェック
  - BEATS_PER_MEASURE を超えた場合の追加拒否
  - _要件: 4.3_

---

## テスト観点

- 全音符のみの小節: 92px 以上であることを確認
- 八分音符 ×8 の小節: MIN_MEASURE_W 以上、かつ幅が適切に広がることを確認
- 空小節: MIN_MEASURE_W（52px）が確保されることを確認
- ページ幅に4小節が入らない場合: 自動的に3→2→1と降格することを確認
- 合計5拍の音符を追加しようとした場合: 追加が拒否されることを確認
