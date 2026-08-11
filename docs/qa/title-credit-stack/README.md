# 見出しの縦積み 前後比較（Issue #216）

市販譜の慣例にならい、見出しを「タイトル（中央・行を専有）→ サブタイトル（中央）→ 作者行（右寄せ）」の
**縦積み**へ変えた。設計と実測値は
**[`.claude/specs/engraving-defaults/design.md`](../../../.claude/specs/engraving-defaults/design.md) §6-2** にある。

画像はすべて **A4 の版面（794px 幅）をそのままの縮尺で 2 倍に拡大**したもので、
before / after は**同じ文字列・同じ条件**で撮っている。

| ファイル | 中身 |
| --- | --- |
| `before-long-title.png` | 修正前（横並び）: 長いタイトル＋作者3行。タイトルが 353px 幅に押し込まれて3行になり、作者名も各行が2行に折り返す |
| `after-long-title.png` | 修正後（縦積み）: 同じ内容。タイトルは版面の全幅（685.88px）を使って2行、作者3行は下に右寄せで折り返さない |
| `before-moonlight.png` | 修正前: 月光相当（タイトル＋作曲者のみ）。タイトル2行・作曲者2行 |
| `after-moonlight.png` | 修正後: 同じ内容。タイトル1行の下に作曲者1行（市販譜と同じ配置） |
| `after-empty-credit.png` | 修正後: 作詞者・作曲者・編曲者を3つとも空にした状態。作者行そのものが消え、タイトル直下にサブタイトルが続く |

## 撮り方（再現手順）

1. worktree だけを載せた dev サーバーを立てて、ブラウザで開く
2. タイトル・作者欄（`contentEditable`）へ文字を入れる
3. `.page-head--title` を複製し、`getComputedStyle` の値を各要素へ焼き込んでから
   `<foreignObject>` に入れた SVG を作り、`canvas` 経由で PNG にする
   （見出しは HTML なので、譜面用の `docs/qa/engraving-defaults/capture-ab-images.js` は使えない）
4. 修正前の画像は、`git checkout <main の SHA> -- src/` してから dev サーバーを再起動して撮る
   （`.night-worktrees` 配下は vite の watch 対象外なので、再起動しないと古いコードのままになる）
