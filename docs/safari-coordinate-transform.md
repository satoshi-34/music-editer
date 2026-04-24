# Safari 座標変換バグ — 設計ノート

> **このバグは繰り返し再発している。** 修正後も将来の変更で同じ問題が戻る可能性が高い。
> このドキュメントを読めば原因・修正箇所・正しい実装を即座に把握できる。

---

## 症状

Safari でノートを配置しようとすると、ガイドライン（ホバー時の横線プレビュー）とクリックで実際に描画される音符の高さがずれる。Chrome では正常。

---

## 根本原因

### CSS zoom と getBoundingClientRect の非互換

`App.css` でページ全体を CSS `zoom` プロパティでスケールしている:

```css
/* App.css */
.page-wrapper {
  zoom: var(--scale, 1);
}
```

`getBoundingClientRect()` の返す値がブラウザによって異なる:

| ブラウザ | getBoundingClientRect() の返す幅 |
|---|---|
| Chrome / Firefox | **視覚サイズ**（zoom 後のピクセル値） |
| Safari 旧版 | **論理サイズ**（zoom 前のピクセル値） |

scale=0.86 のとき Chrome は幅 `W * 0.86`、Safari は幅 `W` を返す。
この差を補正せずに座標計算すると、Safari だけ Y 座標が `1/0.86 ≈ 1.16` 倍ずれる。

### なぜ getScreenCTM().inverse() では直らないのか

`getScreenCTM()` は SVG の transform 属性は正しく反映するが、祖先要素の **CSS zoom は反映しない**（Safari のバグ/仕様）。
そのため `pt.matrixTransform(ctm.inverse())` で変換しても zoom の分がずれたままになる。

---

## 正しい実装

`StaffCanvas.tsx` と `PianoSystemCanvas.tsx` の両方に以下のパターンを使う。

### 1. CSS zoom 累積値の取得

```typescript
// DOM ツリーを上へ辿り、CSS zoom の累積値を返す。
// Safari 旧版は getBoundingClientRect() が CSS zoom を反映しない（論理サイズを返す）ため補正に使う。
function getAccumulatedCSSZoom(el: Element): number {
  let zoom = 1;
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const z = parseFloat(window.getComputedStyle(node).zoom || '1');
    if (Number.isFinite(z) && z !== 1) zoom *= z;
    node = node.parentElement;
  }
  return zoom;
}
```

### 2. Safari 対応の clientToGroup

```typescript
// client座標 → SVG viewBox 座標
// Safari 旧版では getBoundingClientRect() が CSS zoom を反映しないため、
// zoom 累積値で補正して正確な座標を返す。
function clientToGroup(
  svg: SVGSVGElement,
  _group: SVGGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const viewBox = svg.viewBox?.baseVal;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : svg.width.baseVal.value;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : svg.height.baseVal.value;
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;

  const cssZoom = getAccumulatedCSSZoom(svg);

  // Chrome: getBoundingClientRect() は CSS zoom 込みの視覚サイズ → svgRect.width ≒ logW * cssZoom
  // Safari 旧版: CSS zoom を反映しない論理サイズ → svgRect.width ≒ logW
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  const x = (clientX - svgRect.left) * (vbW / visualW);
  const y = (clientY - svgRect.top)  * (vbH / visualH);

  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}
```

---

## 修正が必要なファイル

新しい SVG キャンバスコンポーネントを追加した場合や、既存コンポーネントで `getBoundingClientRect()` を使って座標変換しているコードを変更した場合、このバグが再発する可能性がある。

| ファイル | 関数 | 状態 |
|---|---|---|
| `src/components/StaffCanvas.tsx` | `clientToGroup()` | 修正済み（上記実装） |
| `src/components/PianoSystemCanvas.tsx` | `clientToGroup()` | 修正済み（上記実装） |

### 新規コンポーネントを追加するとき

SVG キャンバスで mouse/click イベントを受け取り座標変換するコンポーネントを新たに作る場合は、必ず上の `getAccumulatedCSSZoom` + `clientToGroup` パターンをコピーすること。`getScreenCTM().inverse()` や `getBoundingClientRect()` の単純差分は使わない。

---

## やってはいけない実装

```typescript
// NG: getScreenCTM は Safari で CSS zoom を反映しない
const ctm = group.getScreenCTM?.();
if (ctm) {
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

// NG: getBoundingClientRect の単純差分は Safari で zoom 分がずれる
const rect = svg.getBoundingClientRect();
return { x: clientX - rect.left, y: clientY - rect.top };
```

---

## 診断手順

このバグが再発したと思われるとき、以下の手順で確認する。

1. Safari の DevTools を開き、コンソールで次を実行:
   ```javascript
   const svg = document.querySelector('.vf-stavenote')?.closest('svg');
   const rect = svg?.getBoundingClientRect();
   console.log('bcrW:', rect?.width, 'svgLogW:', svg?.width.baseVal.value);
   ```
2. `bcrW ≒ svgLogW` なら Safari が zoom を反映していない（このバグの症状）。
3. `bcrW ≒ svgLogW * zoom` なら Chrome 方式（正常）。

---

## 関連ファイル

- [src/components/StaffCanvas.tsx](../src/components/StaffCanvas.tsx) — `getAccumulatedCSSZoom`, `clientToGroup`
- [src/components/PianoSystemCanvas.tsx](../src/components/PianoSystemCanvas.tsx) — 同上（参照実装）
- [src/App.css](../src/App.css) — `.page-wrapper { zoom: var(--scale, 1) }` （根本原因の CSS）
- [docs/REGRESSION.md](REGRESSION.md) — Safari チェックリスト（セクション D）
