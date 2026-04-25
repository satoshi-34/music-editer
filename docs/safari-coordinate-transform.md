# Safari 座標変換バグ — 設計ノート

> **このバグは繰り返し再発している。** 修正後も将来の変更で同じ問題が戻る可能性が高い。
> このドキュメントを読めば原因・修正箇所・正しい実装を即座に把握できる。

---

## 症状

Safari でノートを配置しようとすると、ガイドライン（ホバー時の横線プレビュー）とクリックで実際に描画される音符の高さがずれる。Chrome では正常。

**追記**: 外部モニター（画面幅に余裕あり → scale=1.0）では正常で、Mac の内蔵ディスプレイ（画面幅が狭い → scale<1.0）でのみズレるケースもある。scale=1.0 では zoom が効かないため症状が出ない。

---

## 根本原因

### CSS zoom と getBoundingClientRect の非互換（サイズ＋位置の両方）

`App.css` でページ全体を CSS `zoom` プロパティでスケールしている:

```css
/* App.css */
.page-wrapper {
  zoom: var(--scale, 1);
}
```

`getBoundingClientRect()` の返す値がブラウザによって異なる:

| ブラウザ | width/height | left/top |
|---|---|---|
| Chrome / Firefox | 視覚サイズ（zoom 後） | 視覚位置（zoom 後） |
| Safari 旧版 | 論理サイズ（zoom 前） | 論理位置（zoom 前） |

**重要**: Safari は**サイズだけでなく位置（left/top）も**論理座標を返す。一方 `clientX/Y` は視覚座標。
この座標系の不一致が原因。

具体例（zoom=0.86、SVG の論理 left = 100px）:
- Chrome: `svgRect.left = 86`（視覚）、クリック時 `clientX = 86` → 差分 = 0 ✓
- Safari: `svgRect.left = 100`（論理）、クリック時 `clientX = 86` → 差分 = -14 ✗

### なぜ getScreenCTM().inverse() では直らないのか

`getScreenCTM()` は SVG の transform 属性は正しく反映するが、祖先要素の **CSS zoom は反映しない**（Safari のバグ/仕様）。
そのため `pt.matrixTransform(ctm.inverse())` で変換しても zoom の分がずれたままになる。

---

## 正しい実装

`StaffCanvas.tsx` と `PianoSystemCanvas.tsx` の両方に以下のパターンを使う。

### 1. CSS zoom 累積値の取得

```typescript
// CSS zoom の実効値を返す。
// SVG 要素では Safari で --scale が getComputedStyle に継承されないため、
// HTML 要素である .page-wrapper から読み取る。
// （SVG 要素から読んだり、getComputedStyle(el).zoom で zoom: var(--scale) を解決しようとしても
//   Safari では失敗して 1 が返り、bcrReflectsZoom が false positive になる。）
function getAccumulatedCSSZoom(el: Element): number {
  const wrapper = el.closest('.page-wrapper');
  if (wrapper) {
    const v = parseFloat(window.getComputedStyle(wrapper).getPropertyValue('--scale').trim());
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 1;
}
```

### 2. Safari 対応の clientToGroup

`clientY` には呼び出し元で `yOffsetRef.current`（ユーザー設定の Y 補正値）が加算済みで渡される。

```typescript
// client座標 → SVG viewBox 座標
// Safari 旧版では getBoundingClientRect() が CSS zoom を反映しないため、
// サイズと位置の両方を補正して正確な座標を返す。
// clientY には事前に yOffset（Y補正値）を加算して呼ぶこと。
function clientToGroup(
  svg: SVGSVGElement,
  _group: SVGGElement,
  clientX: number,
  clientY: number  // = e.clientY + yOffsetRef.current
): { x: number; y: number } {
  const svgRect = svg.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return { x: 0, y: 0 };

  const viewBox = svg.viewBox?.baseVal;
  const vbW = (viewBox && viewBox.width > 0) ? viewBox.width : svg.width.baseVal.value;
  const vbH = (viewBox && viewBox.height > 0) ? viewBox.height : svg.height.baseVal.value;
  const logW = svg.width.baseVal.value;
  const logH = svg.height.baseVal.value;

  const cssZoom = getAccumulatedCSSZoom(svg);

  // Chrome: BCR は CSS zoom 込みの視覚サイズ/位置
  // Safari 旧版: BCR は論理サイズ/位置（zoom 前）
  const expectedVisualW = logW * cssZoom;
  const bcrReflectsZoom = Math.abs(svgRect.width - expectedVisualW) < logW * 0.05;
  const visualW = bcrReflectsZoom ? svgRect.width : expectedVisualW;
  const visualH = bcrReflectsZoom ? svgRect.height : logH * cssZoom;

  // Safari では left/top も論理座標だが clientX/Y は視覚座標。
  // .page-wrapper は zoom 境界要素で、その BCR.left/top は視覚座標として正確。
  // そこからの論理オフセットに cssZoom を掛けて視覚 origin を求める。
  let originLeft = svgRect.left;
  let originTop  = svgRect.top;
  if (!bcrReflectsZoom) {
    const zoomContainer = svg.closest('.page-wrapper');
    if (zoomContainer) {
      const cr = zoomContainer.getBoundingClientRect();
      originLeft = cr.left + (svgRect.left - cr.left) * cssZoom;
      originTop  = cr.top  + (svgRect.top  - cr.top)  * cssZoom;
    }
  }

  const x = (clientX - originLeft) * (vbW / visualW);
  const y = (clientY - originTop)  * (vbH / visualH);

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

// NG: getBoundingClientRect の単純差分は Safari で zoom 分がずれる（サイズも位置も）
const rect = svg.getBoundingClientRect();
return { x: clientX - rect.left, y: clientY - rect.top };

// NG: サイズは補正しても位置（left/top）の補正を忘れるパターン
const visualW = logW * cssZoom;
const x = (clientX - svgRect.left) * (vbW / visualW); // svgRect.left が論理座標のままでズレる
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

---

## 自動補正が効かない場合の手動 Y 補正

自動補正ロジックが Safari の特定バージョンで機能しないケースに備え、ユーザーが手動で Y 座標を補正できる「Y補正」機能を用意している。

- **UI**: ツールバーの「Y補正」ボタンを押すとポップアップが開く
- **操作**: ↑/↓ボタン、数値入力、またはキーボード ↑↓ キーで調整
- **方向**: 低音方向（画面下）がプラス、高音方向（画面上）がマイナス
- **保存**: 設定値は `localStorage` に保存される
- **実績**: Mac 内蔵ディスプレイ + Safari の環境では `yOffset = 24` で正確に一致することを確認

補正値は `StaffCanvas` / `PianoSystemCanvas` の全 `clientToGroup` 呼び出しに加算される:
```typescript
clientToGroup(svg, svgRoot, e.clientX, e.clientY + yOffsetRef.current)
```

---

## 関連ファイル

- [src/components/StaffCanvas.tsx](../src/components/StaffCanvas.tsx) — `getAccumulatedCSSZoom`, `clientToGroup`
- [src/components/PianoSystemCanvas.tsx](../src/components/PianoSystemCanvas.tsx) — 同上（参照実装）
- [src/components/ScorePage.tsx](../src/components/ScorePage.tsx) — Y補正 UI・状態管理
- [src/App.css](../src/App.css) — `.page-wrapper { zoom: var(--scale, 1) }` （根本原因の CSS）
- [docs/REGRESSION.md](REGRESSION.md) — Safari チェックリスト（セクション D）
