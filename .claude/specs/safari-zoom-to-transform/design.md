# 設計書: ページ縮小の zoom → transform: scale 置き換え（issue #13 根本対策）

## 問題

GitHub issue #13: Safari + Mac 内蔵ディスプレイ（scale < 1.0 になる環境）で、
ホバー時のガイドラインとクリック時の音符描画位置がマウスカーソルと縦方向にずれる。

### 根本原因（再掲）

`.page-wrapper { zoom: var(--scale) }` に対して、Safari は `getBoundingClientRect()`（BCR）が
**zoom を反映しない論理座標**を返す一方、`clientX/Y` は視覚座標を返す。この座標系の不一致が原因。

これまでの対処は「ブラウザごとの BCR 挙動を動的判別して補正する」防御的実装
（`getAccumulatedCSSZoom` + `bcrReflectsZoom` 分岐）で、Safari のバージョンによって
再発するリスクが残っていた（issue #13 はその追跡 Issue）。

## 修正設計

### 方針: 縮小手段そのものを zoom から transform: scale へ変更する

CSS `transform` は CSSOM 仕様により **全ブラウザで BCR へ視覚座標として反映される**。
そのため「BCR との単純差分 × viewBox 比率」だけで client → SVG 座標変換が正確になり、
ブラウザ判別が原理的に不要になる。

### 1. CSS（`src/App.css`）

```css
.page-wrapper {
  /* transform はレイアウトサイズを変えないため、ラッパー自身を縮小後サイズに合わせる */
  width: calc(210mm * var(--scale, 1));
  height: calc(297mm * var(--scale, 1)); /* 初回描画用フォールバック */
}
.page-wrapper > .print-page {
  transform: scale(var(--scale, 1));
  transform-origin: top left;
}
```

印刷時は画面用の縮小を持ち込まないよう `@media print` で `.print-page { transform: none }` を追加
（`.page-wrapper` の `transform: none` リセットは既存）。

### 2. 高さ補正（`src/components/ScaledPageWrapper.tsx` 新規）

`zoom` と違い `transform` はレイアウト上の占有サイズを変えない。そのままだと縮小前の高さで
グリッドに居座り、ページ間に大きな余白ができる。

- ページ高さは内容により A4（297mm ≒ 1122px）を超えることがある
  （実測: デフォルト単旋律譜で 1220px。大編成の総譜ではさらに伸びる）ため、CSS の固定計算では不十分
- `ScaledPageWrapper` が `.print-page` の `offsetHeight`（transform の影響を受けないレイアウト高さ）を
  ResizeObserver で監視し、「実測高さ × scale」をラッパーの高さとして設定する
- 計測不能（jsdom 等で 0）の場合は CSS フォールバック（A4 × scale）に任せる

`ScorePage.tsx` の `visiblePages.map` 内の `<div className="page-wrapper">` を
`<ScaledPageWrapper scale={scale}>` に置き換え。

### 3. 座標変換コード（`StaffCanvas.tsx` / `PianoSystemCanvas.tsx`）

`clientToGroup()` はロジック変更なし。transform 方式では `bcrReflectsZoom` が常に true となり
単純パスを通る。zoom 補正の分岐と `getAccumulatedCSSZoom()` は、**万一 zoom 方式へ退行した場合の
保険**としてコメントを更新のうえ残した。

## 検証

- 全テスト 557 件（38 + 新規 `ScaledPageWrapper.test.tsx` 4 件）パス、`tsc -b && vite build` 成功
- ブラウザ実測（Chromium、scale=0.633）:
  - SVG の BCR 幅 434.47px ≒ 論理幅 686 × 0.633（**BCR が scale を反映** = 修正の核心が成立）
  - ラッパー高さ 772.66px ≒ 実測 1220px × 0.633（高さ補正が動作）
  - クリック→符頭描画位置の差: **旧 zoom 方式と新 transform 方式で完全一致**（-4.750px、
    符頭グリフ由来の既存オフセット）= Chrome 系での挙動退行なし
- **Safari 実機での確認は未実施**。`docs/REGRESSION.md` セクション D のチェックリストで確認すること
  （確認できたら issue #13 をクローズ可能）

## 影響範囲

- `src/App.css` — `.page-wrapper` / `.print-page` / `@media print`
- `src/components/ScaledPageWrapper.tsx` — 新規
- `src/components/ScorePage.tsx` — page-wrapper の置き換えのみ
- `src/components/StaffCanvas.tsx` / `PianoSystemCanvas.tsx` — コメント更新のみ（ロジック不変）
- Y補正（手動キャリブレーション）機能はそのまま維持

## フォローアップ: 旧Y補正の自動リセット（実機検証で判明）

### 実機検証の結果（2026-06-11）

- **新しい Safari（Apple Silicon MacBook Pro）**: 修正前からズレない。新しい Safari は
  `zoom` を `getBoundingClientRect` に反映するよう改善されており、元のバグ自体が出ない
- **古い Safari（Intel Mac）**: transform 修正後もズレた。原因は zoom 時代に設定した
  手動Y補正（`localStorage['yOffset'] = 24`）の残留。`localStorage.removeItem('yOffset')`
  で**ピッタリ一致**することを実機確認

### 問題

座標が正しくなった transform ビルドでは、残留した旧Y補正がそのまま逆方向のズレになる。
zoom 時代にY補正を設定した利用者全員が「修正したのにズレる」状態になる。

### 修正設計（`src/utils/yOffsetMigration.ts`）

- transform ビルドの初回起動時に一度だけ `yOffset` を破棄する
- 「リセット済み」フラグ（`yOffsetResetForTransformScale`）を別キーで保持し、
  利用者が transform ビルド上で改めて設定したY補正は二度と消さない
- localStorage が使えない環境（プライベートブラウジング等）では補正なしで動作

## やってはいけないこと

- `.page-wrapper` / `.print-page` に CSS `zoom` を再導入しない
- `ScaledPageWrapper` を外して素の `<div className="page-wrapper">` に戻さない
  （ページ間の余白が崩れる）

## フォローアップ2: 手動Y補正（yOffset）の撤去（Issue #134）

### 問題

手動Y補正は、zoom 時代に「カーソル位置と描画位置がズレる」不具合を直しきれなかった
時期の**対症療法UI**（利用者が自分でズレ量を打ち消すためのスライダー）だった。
上記の根本対策（`transform: scale` 化）と旧補正値の自動リセットで当該バグは再現
しなくなり、残しておくと「何のための数値なのか分からないスライダー」として
むしろ混乱源になる（レイアウトタブの整理 #114 でも指摘）。

### 撤去前の確認（2026-08-01）

worktree のビルドを共有 dev サーバー経由でブラウザに読み込み、`localStorage` に
旧値 `yOffset = 24` をわざと残した状態で、4譜種すべての「カーソルの高さ」と
「アプリが描くガイドライン（＝音符が置かれる高さ）」の差を実測した:

| 譜種 | 測定点数 | ズレの最大値 |
| --- | --- | --- |
| ピアノ大譜表 | 24 | 0.5px |
| 単旋律譜 | 18 | 1.5px |
| 弦楽四重奏 | 24 | 1.7px |
| 編成譜 | 30 | 1.7px |

いずれも0.5行スナップ（半行 ≒ 5px相当）の範囲内で、旧バグの再現（`24 × scale ≒ 18px`
規模のズレ）は無し。よって撤去してよいと判断した。

### 修正設計

- **UI撤去**: レイアウトタブの「Y補正」ボタンとポップアップ（`ScorePageYOffsetPanel`
  相当の JSX）、`showOffsetPanel` / `yOffset` state、`handleYOffsetChange` を削除。
  ポップアップ専用だった CSS（`.y-offset-btn` / `.y-offset-reset` /
  `.coord-panel-header`）も削除する。`.coord-panel` 系は移調パネルが使うので残す
- **描画パスの単純化**: `PianoSystemCanvas` の `yOffset` prop・`yOffRef` と、
  クリック座標へ足していた `clientY + yOffRef.current` を削除し、値0として畳み込む。
  各 Staff コンポーネント（Single/Piano/Quartet/Ensemble/PartExtraction）と
  `ScorePage` からの受け渡しも削除する
- **保存データ**: `yOffset` は譜面データではなく `localStorage` の独立キーだったので、
  **読み捨て**（読まない・書かない）だけにし、マイグレーションでの削除はしない。
  古い値が残っていても実害が無く、削除処理を足すほうがコードの寿命が長くなるため
- **移行モジュールの削除**: `src/utils/yOffsetMigration.ts` とそのテストは役目を終えた
  ので削除。代わりに「旧 `yOffset` が残っていても起動でき、書き込みもしない」ことを
  `src/components/ScorePageLegacyYOffset.test.tsx` で検証する

### 影響範囲

- `src/components/ScorePage.tsx`（state・ハンドラ・JSX・prop受け渡し）
- `src/components/{SingleStaff,PianoStaff,QuartetStaff,EnsembleStaff,PartExtractionStaff}.tsx`
- `src/components/PianoSystemCanvas.tsx`（クリック座標変換）
- `src/App.css`、`README.md`、`docs/DEVELOPMENT.md`、`docs/REGRESSION.md`
- 削除: `src/utils/yOffsetMigration.ts(.test.ts)`、`src/components/ScorePageYOffsetPanel.test.tsx`

### 以後の指針

座標ズレが再発しても、利用者に手で打ち消させるUIは復活させない。
`transform: scale` と BCR ベースの座標変換（本設計書の本文）側の退行を疑うこと。
