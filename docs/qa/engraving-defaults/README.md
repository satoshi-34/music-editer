# 浄書の既定値 A/B 比較の材料（Issue #195 段1）

調査と値の根拠は **[`.claude/specs/engraving-defaults/design.md`](../../../.claude/specs/engraving-defaults/design.md)** にある。
ここに置いてあるのは、その比較を自分の目で確かめるためのファイル。

| ファイル | 何に使うか |
| --- | --- |
| `thickness-specimen.svg` | 五線・符幹・小節線・加線・松葉の太さを「現状 / 候補A / 候補B」で並べた模式図。GitHub 上でそのまま開ける |
| `ab-preview.js` | アプリを開いた状態でブラウザのコンソールに貼り付けると、実際の譜面の見た目を候補値へ切り替えられる |
| `moonlight-figure-piano.json` | 検証用譜例1（ピアノ大譜表）。アプリの「読込」で開く |
| `wind-band-score.json` | 検証用譜例2（吹奏楽の総譜・10パート）。アプリの「読込」で開く |

## 使い方（3分）

1. アプリを開く
2. 「読込」から `wind-band-score.json`（または `moonlight-figure-piano.json`）を読み込む
3. ブラウザの開発者ツール → コンソールに `ab-preview.js` の中身を貼り付けて実行
4. `engravingAB('a')` → `engravingAB('b')` → `engravingAB('current')` と打って見比べる

保存データもアプリのコードも変更しない。リロードすれば元に戻る。

## 譜例についての注意

`moonlight-figure-piano.json` はベートーヴェン「月光」第1楽章 冒頭の**音型**（右手＝8分3連の分散和音、
左手＝オクターブの全音符、嬰ハ短調）を8小節ぶん反復した検証用データで、**楽曲の忠実な再現ではない**。
`wind-band-score.json` の音型も検証用に組んだもので、実在の曲ではない。
