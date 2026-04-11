# 設計書: ページスケール自動管理 (Page Scale Management)

## 概要

本設計書は、`useAutoPageScale.ts` に実装されているページスケール自動計算フックを文書化します。A4 用紙サイズに基づくスケール計算・ヒステリシスによるふらつき防止・ResizeObserver + rAF によるスロットリングの仕組みを説明します。

---

## アーキテクチャ

### 処理フロー

```
コンポーネントマウント
        ↓
ResizeObserver(rail) + window.resize
        ↓
schedule() — rAF でスロットリング
        ↓
recompute()
        ↓
avail = rail.clientWidth
need  = A4px × cols + gap × (cols-1)
next  = clamp(avail × 0.98 / need, 0.1, 1.0)
        ↓
diff = |next - prev| < max(0.005, prev*0.005) ?
  → スキップ（ヒステリシス）
  → setScale(next)（React 再描画）
        ↓
spread要素に CSS transform: scale(next) が適用される
```

### 関係するファイル

| ファイル | 役割 |
|---|---|
| `src/components/useAutoPageScale.ts` | スケール計算フック本体 |
| `src/components/ScorePage.tsx` | `columns` 状態管理・`useAutoPageScale` 呼び出し |
| `src/App.tsx` | Spread/Rail 要素のレイアウト構造 |

---

## コアアルゴリズム

### 定数

```typescript
const A4_WIDTH_PX = 210 * 3.78; // ≒ 793.8px（A4幅 210mm × 3.78px/mm）
const DEFAULT_GAP = 20;          // デフォルトのページ間ギャップ（px）
const AVAIL_RATIO = 0.98;        // 利用可能幅の使用率（左右 1% ずつ余白）
const SCALE_MIN   = 0.1;         // スケール下限
const SCALE_MAX   = 1.0;         // スケール上限（拡大なし）
const HYSTERESIS  = 0.005;       // ふらつき防止しきい値（0.5%）
```

### スケール計算式

```typescript
const recompute = useCallback(() => {
  const spread = spreadRef.current;
  if (!spread) return;

  const rail = spread.parentElement;
  if (!rail) return;

  const pageWidthPx = 210 * 3.78; // A4幅（px）
  const cols = Math.max(1, columns);
  const totalGap = (cols - 1) * gapPx;

  const need  = pageWidthPx * cols + totalGap; // 必要幅（px）
  const avail = rail.clientWidth;               // 利用可能幅（px）

  const next = Math.min(1, Math.max(0.1, (avail * 0.98) / need));

  // ヒステリシス: 変化量が閾値未満ならスキップ
  const prev = lastScaleRef.current;
  const diff = Math.abs(next - prev);
  if (diff < Math.max(0.005, prev * 0.005)) return;

  lastScaleRef.current = next;
  setScale(next);
}, [columns, gapPx]);
```

**計算例（1列表示）:**

| rail.clientWidth | need(1col) | next = avail*0.98/need | クリップ後 |
|---|---|---|---|
| 800px | 793.8px | 0.988 | 1.0（上限） |
| 600px | 793.8px | 0.741 | 0.741 |
| 400px | 793.8px | 0.494 | 0.494 |

**計算例（2列表示）:**

| rail.clientWidth | need(2col+20px) | next | クリップ後 |
|---|---|---|---|
| 1650px | 1607.6px | 1.007 | 1.0（上限） |
| 1200px | 1607.6px | 0.732 | 0.732 |

---

### rAF スロットリング

```typescript
const schedule = () => {
  if (rafRef.current != null) return; // 既にスケジュール済みならスキップ
  rafRef.current = window.requestAnimationFrame(() => {
    rafRef.current = null;
    recompute();
  });
};
```

**効果:** ResizeObserver は1ピクセルの変化ごとに発火する可能性があるが、rAF により描画フレーム（≒16ms）ごとに1回のみ `recompute()` が実行される。

---

### ヒステリシス判定

```typescript
const diff = Math.abs(next - prev);
if (diff < Math.max(0.005, prev * 0.005)) return;
```

| 状況 | しきい値 | 効果 |
|---|---|---|
| スケール 1.0 付近 | max(0.005, 0.005) = 0.005 | ±0.5% 未満の変化を無視 |
| スケール 0.5 付近 | max(0.005, 0.0025) = 0.005 | 固定 0.5% が有効 |
| スケール 0.1 付近 | max(0.005, 0.0005) = 0.005 | 固定 0.5% が有効 |

---

## データモデル

### フックの入出力

```typescript
function useAutoPageScale(
  columns: number,   // 1行あたりのページ列数（1 or 2）
  gapPx: number = 20 // ページ間ギャップ（px）
): {
  spreadRef: React.MutableRefObject<HTMLDivElement | null>; // Spread要素にアタッチ
  scale: number;    // 計算されたスケール値（0.1〜1.0）
}
```

### 内部 Ref

```typescript
const spreadRef    = useRef<HTMLDivElement | null>(null); // 監視対象要素
const lastScaleRef = useRef(1);                           // 直前スケール（ヒステリシス用）
const rafRef       = useRef<number | null>(null);         // rAF ID（重複防止用）
```

---

## 利用側の実装

```typescript
// ScorePage.tsx での呼び出し例
const { spreadRef, scale } = useAutoPageScale(columns, 20);

return (
  <div className="rail"> {/* ← Rail: clientWidth の計測対象 */}
    <div
      ref={spreadRef}  {/* ← Spread: ResizeObserver の監視対象の親 */}
      style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
    >
      {pages.map(page => <ScorePage key={page.id} ... />)}
    </div>
  </div>
);
```

---

## 正確性プロパティ

**プロパティ1: スケール上限**
`recompute()` の戻り値（`setScale` に渡す値）は常に `≤ 1.0`。ページが画面より小さくても拡大しない。

**プロパティ2: スケール下限**
`recompute()` の戻り値は常に `≥ 0.1`。極端に小さいウィンドウでも最低 10% は表示する。

**プロパティ3: rAF の一意性**
`rafRef.current != null` チェックにより、同一フレーム内で `requestAnimationFrame` が複数登録されることはない。

**プロパティ4: ヒステリシスの方向非依存性**
`Math.abs(next - prev)` により、スケールの増加・減少両方向でヒステリシスが均等に適用される。

**プロパティ5: リソースリークなし**
`useEffect` のクリーンアップ関数で `ro.disconnect()` / `window.removeEventListener` / `cancelAnimationFrame` が必ず実行される。

---

## エラーハンドリング

| シナリオ | 対応 |
|---|---|
| `spread` が null | `if (!spread) return` で早期リターン |
| `rail`（親要素）が null | `if (!rail) return` で早期リターン |
| `rail.clientWidth === 0` | `next = 0.1`（下限クリップで最小スケールを保証） |
| `columns === 0` | `Math.max(1, columns)` で最低1列を保証 |
| コンポーネントアンマウント後の rAF 発火 | クリーンアップで `cancelAnimationFrame` 済み |
