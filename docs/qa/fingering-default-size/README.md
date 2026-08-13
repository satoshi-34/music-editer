# 運指の既定サイズ A/B 画像（Issue #232）

運指（指番号）の既定フォントサイズを **10 u → 18 u（従来の180%）** へ拡大したときの
前後比較画像です。設計の詳細は `.claude/specs/engraving-defaults/design.md` の §20 を参照してください。

| ファイル | 内容 |
| --- | --- |
| `images/fingering-before-100.png` | 変更前（既定 10 u）。運指は `3` / `1,3,5` / `4` の3か所 |
| `images/fingering-after-180.png` | 変更後（既定 18 u）。**同じ譜面・同じ切り出し矩形・同じ倍率** |

## 作り方（再現手順）

`docs/qa/engraving-defaults/capture-ab-images.js` の仕組みをそのまま使っています
（画面キャプチャではなく、計算後スタイルを焼き込んだ単体 SVG を canvas で PNG 化する方法。
同じ矩形を viewBox で切り出すので、前後の画像が構造的に一致します）。

1. アプリを開き、運指を付けた譜面を用意する（例: 五線内の音符に `3`、加線の上の高音に `1,3,5`、別の小節の音符に `4`）
2. コンソールで `docs/qa/engraving-defaults/capture-ab-images.js` を読み込む
3. `await engravingShot('after.png')` で 1 ページぶんを書き出す
   （段だけを切り出したい場合は、スニペット内の `cropBox()` / `applyCrop()` を使って
   `viewBox` を差し替えてから canvas へ描く）
4. 変更前の画像は、`src/` を変更前のコミットへ戻して同じ手順を繰り返す
   （dev サーバーの HMR が効くので、譜面もズームもそのままで撮り比べられる）
