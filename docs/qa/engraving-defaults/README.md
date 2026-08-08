# 浄書の既定値 A/B 比較の材料（Issue #195 段1）

調査と値の根拠は **[`.claude/specs/engraving-defaults/design.md`](../../../.claude/specs/engraving-defaults/design.md)** にある。
ここに置いてあるのは、その比較を自分の目で確かめるためのファイル。

| ファイル | 何に使うか |
| --- | --- |
| `images/` | **A/B比較画像（PNG）**。まずここを見れば判断できる。下の表を参照 |
| `thickness-specimen.svg` | 五線・符幹・小節線・加線・松葉の太さを「現状 / 候補A / 候補B」で並べた模式図。GitHub 上でそのまま開ける |
| `ab-preview.js` | アプリを開いた状態でブラウザのコンソールに貼り付けると、実際の譜面の見た目を候補値へ切り替えられる |
| `capture-ab-images.js` | `images/` の PNG を作り直すためのスニペット。`ab-preview.js` の後に貼り付けて使う |
| `moonlight-figure-piano.json` | 検証用譜例1（ピアノ大譜表）。アプリの「読込」で開く |
| `wind-band-score.json` | 検証用譜例2（吹奏楽の総譜・10パート）。アプリの「読込」で開く |

## 比較画像（`images/`）

**まず見るのは `*-compare.png` の2枚**。同じ箇所を同じ倍率で切り出し、現状 / 候補A / 候補B を
縦に並べてある。1ページ全体の第一印象を見たいときは `*-current.png` / `*-a.png` / `*-b.png` を見比べる。

| ファイル | 中身 |
| --- | --- |
| `piano-moonlight-compare.png` | ピアノ譜の第1段を4倍に拡大し、3案を縦に並べたもの |
| `windband-compare.png` | 吹奏楽総譜の第1段を2倍に拡大し、3案を縦に並べたもの |
| `piano-moonlight-{current,a,b}.png` | ピアノ譜の1ページ目（A4全体・2倍） |
| `windband-{current,a,b}.png` | 吹奏楽総譜の1ページ目（A4全体・2倍） |

画像はアプリの実際の描画をそのまま書き出したもので、**現状の不具合もそのまま写っている**
（長いタイトルと作者欄の重なり、強弱記号の黒いクリック判定枠、2段目にパート名が出ないこと）。
これらは既定値の問題ではないので、案を選ぶときは無視してよい。詳細は設計書 §6 を参照。

## 使い方（3分）

1. アプリを開く
2. 「読込」から `wind-band-score.json`（または `moonlight-figure-piano.json`）を読み込む
3. ブラウザの開発者ツール → コンソールに `ab-preview.js` の中身を貼り付けて実行
4. `engravingAB('a')` → `engravingAB('b')` → `engravingAB('current')` と打って見比べる

保存データもアプリのコードも変更しない。リロードすれば元に戻る。

## 比較画像を作り直す

値の候補を変えたとき（`ab-preview.js` の `PRESETS` を編集したとき）は、上の1〜3のあとに
`capture-ab-images.js` の中身も貼り付けて実行し、次を打つ。PNG がダウンロードされる。

```js
await engravingCompare('windband-compare.png');                                   // 吹奏楽の拡大比較
await engravingCompare('piano-moonlight-compare.png', { zoom: 3, padTop: 30, padBottom: 32 }); // ピアノの拡大比較
await engravingShot('windband-current.png');                                      // 1ページ全体
```

`engravingShot` は「いま画面に出ている状態」を撮るので、1ページ全体を3案ぶん作るときは
`engravingAB('a')` などで切り替えてから毎回呼ぶ。

## 譜例についての注意

`moonlight-figure-piano.json` はベートーヴェン「月光」第1楽章 冒頭の**音型**（右手＝8分3連の分散和音、
左手＝オクターブの全音符、嬰ハ短調）を8小節ぶん反復した検証用データで、**楽曲の忠実な再現ではない**。
`wind-band-score.json` の音型も検証用に組んだもので、実在の曲ではない。
