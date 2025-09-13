# Music Editor MVP

Finale ライクな楽譜作成 Web アプリの最小構成（MVP）です。  
React + TypeScript + Vite + VexFlow を使って、**クリックで五線譜に音符を配置**できます。  
MuseScore 風の **小節幅の自動割り付け** と、**クリック位置の高精度スナップ**（線に置きやすいバイアス付き）を実装しています。

---

## 機能

- React + TypeScript + Vite による高速な開発体験
- ト音記号・4/4 拍子の五線譜を表示（複数段レイアウト）
- クリックで音符／休符を配置（加線域も含め 0.5 行刻みでスナップ）
- 小節幅の自動割り付け（全・二分はやや広め。細かい音符は過密回避）
- 見た目の横位置に最も近い場所へ自然に挿入（getAbsoluteX + BoundingBox）

## 技術スタック

- React
- TypeScript
- Vite
- VexFlow（SVG レンダリング）

## セットアップと起動

```bash
git clone https://github.com/satoshi-34/music-editer.git
cd music-editer
npm install
npm run dev
```
ブラウザで表示された URL（例: http://localhost:5173）へアクセスします。

## 使い方（簡単）

1. 画面上の Palette で音価（四分・八分・十六分など）や休符を選びます。
2. 五線譜の置きたい位置をクリックします。線／間／五線の外（加線域）も 0.5 行刻みでスナップします。
3. 小節の拍数（4/4）を超える配置は無視されます。

## 実装のポイント（要点）

### 1. クリック座標と描画座標の基準を統一
- クリックはクライアント座標、VexFlow は `<svg>` 内の `<g>` ユーザー座標です。
- `getScreenCTM().inverse()` を使い、**client → `<g>` ユーザー座標**へ正確に変換。
- クリック用の透明 `<rect>` も同じ `<g>` に追加し、座標系を完全一致させています。

### 2. Y 方向スナップ（音高決定）
- `stave.getSpacingBetweenLines()` を基準に **0.5 行刻み**でスナップ。
- 線に置きやすいよう **線バイアス**（`LINE_PAD_RATIO`, `LINE_BIAS`）を適用。

### 3. X 方向の挿入位置
- 各音符の `getAbsoluteX()` と幅（BoundingBox）を使い、クリック X に最も近い隙間へ挿入。

### 4. 小節幅の自動割り付け
- 音価の「占有感」に重みを持たせて比率配分。全・二分を含む小節は下限幅を広めに確保。
- 16 分や 32 分が並んでも符頭が重なりにくいようチューニング。

## クリック精度のチューニング

`src/components/StaffCanvas.tsx` の定数で調整できます。

```ts
// 線の中心 ± (spacing * LINE_PAD_RATIO) に入れば即スナップで線確定
const LINE_PAD_RATIO = 0.18; // 例: 0.15〜0.25

// 線候補の距離スコアに掛ける係数（1 未満で線を優遇）
const LINE_BIAS = 0.82; // 例: 0.7〜0.9
```
- 線に置きづらい → `LINE_PAD_RATIO` を上げる、または `LINE_BIAS` を下げる
- 間に置きたいのに線に吸われる → `LINE_PAD_RATIO` を下げる、または `LINE_BIAS` を上げる

## フォルダ構成（抜粋）

```
src/
├─ components/
│  ├─ StaffCanvas.tsx   # クリック精度 / 小節幅ロジック
│  ├─ Palette.tsx       # 音価/休符の選択 UI
│  ├─ ScorePage.tsx     # ページレイアウト・スケール
│  └─ ...
├─ App.tsx
└─ App.css
```

## 最小チェック

- scale=1.0 / 0.86 / 0.8 で E4→G4→B4→D5（ミ・ソ・シ・レ）が狙い通り置ける。
- 線の上クリックでも間に吸われない。
- 16 分×3 + 二分 などでも小節から溢れない。

## ライセンス

MIT
