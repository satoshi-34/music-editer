# 記号の当たり判定（`rect.symbol-hit-region`）の修正前後の画像 — Issue #203

強弱記号 `f` のまわりを、譜面の SVG からそのまま切り出した画像です（4枚とも**同じ矩形・同じ倍率**）。

| 画像 | 状態 |
| --- | --- |
| `before-screen.png` | 修正前・画面。当たり判定が**黒い長方形の枠**として見える |
| `after-screen.png` | 修正後・画面。枠が消え、記号だけが残る |
| `before-print-preview.png` | 修正前・印刷プレビュー。枠の中が**黒く塗り潰され**、記号が読めない |
| `after-print-preview.png` | 修正後・印刷プレビュー。塗り潰しが消える |

## 作り方（同じ画像を作り直すとき）

画面キャプチャではなく、**描画中の SVG に計算後スタイルを焼き込んでから canvas で PNG 化**しています
（`docs/qa/engraving-defaults/capture-ab-images.js` と同じ考え方）。切り出しは当たり判定 rect の
`getBBox()` を基準に `viewBox` を差し替えるだけなので、修正前後で位置と倍率が必ずそろいます。

「修正前」は CSS を手で書き換えて作るのではなく、`git checkout -- src/App.css` で本当に修正前の
状態へ戻し、dev サーバーを再起動してから撮っています（Vite は `.night-worktrees/` 配下を watch
対象外にしているため、ファイルを戻しただけでは反映されません。**サーバーの再起動が必要**です）。
