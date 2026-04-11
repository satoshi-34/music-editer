# 実装計画: ページスケール自動管理

## 概要

ブラウザウィンドウ幅に応じた A4 ページの自動スケール計算フックの実装状況を追跡します。すべてのタスクは実装済みです（`src/components/useAutoPageScale.ts`）。

---

## タスク

- [x] 1. フック基本構造の実装
  - `useAutoPageScale(columns, gapPx)` のシグネチャ定義
  - `spreadRef` / `scale` の返却
  - `lastScaleRef` / `rafRef` の内部 Ref 宣言
  - _要件: 1.1, 4.1_

- [x] 2. A4 スケール計算式の実装
  - `pageWidthPx = 210 * 3.78` の定義
  - `need = pageWidthPx * cols + totalGap` の計算
  - `next = clamp(avail * 0.98 / need, 0.1, 1.0)` の実装
  - _要件: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. ヒステリシス判定の実装
  - `diff < max(0.005, prev * 0.005)` の条件式
  - 条件を満たす場合の早期リターン
  - `lastScaleRef.current = next` による前回値の更新
  - _要件: 2.1, 2.2, 2.3_

- [x] 4. rAF スロットリングの実装
  - `schedule()` 関数の定義
  - `rafRef.current != null` による重複防止チェック
  - `requestAnimationFrame` コールバック内での `rafRef` リセットと `recompute()` 呼び出し
  - _要件: 3.3_

- [x] 5. ResizeObserver 監視の実装
  - `rail = spread.parentElement` の取得
  - `new ResizeObserver(() => schedule())` による rail 監視
  - `window.addEventListener('resize', onWin)` によるウィンドウリサイズ監視
  - _要件: 3.1, 3.2_

- [x] 6. 初回計算とクリーンアップの実装
  - `useEffect` 内での `schedule()` 即座呼び出し（初回）
  - クリーンアップ関数での `ro.disconnect()` / `removeEventListener` / `cancelAnimationFrame`
  - `useCallback` の deps に `[columns, gapPx]` を指定（レイアウト変更への対応）
  - _要件: 3.4, 4.1, 4.2_

---

## テスト観点

- `rail.clientWidth = 794px`（1列）: scale ≒ 1.0（上限クリップ）を確認
- `rail.clientWidth = 400px`（1列）: scale ≒ 0.494 を確認
- `rail.clientWidth = 1200px`（2列）: scale ≒ 0.732 を確認
- 0.1% の幅変化: scale が更新されないことを確認（ヒステリシス）
- 1% 超の幅変化: scale が更新されることを確認
- コンポーネントアンマウント: ResizeObserver / rAF がクリーンアップされることを確認
- `columns` を 1 → 2 に変更: 即座にスケールが再計算されることを確認
