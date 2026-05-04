# Git運用メモ

このメモは、このリポジトリで安全に作業するための
**かんたんな Git ルール** をまとめたものです。

IT にあまり詳しくない人でも、
「どこで作業するか」「何を push するか」が分かるようにしています。

## まず覚えること

- `main` は完成版です
- 普段の作業は `main` ではしません
- 作業するときは **自分のブランチ** を作ります

ひとことで言うと、

- `main` = いま動く最新版
- `branch` = 作業用コピー

です。

## ルール 5つ

1. `main` では直接作業しない
2. 機能ごと、修正ごとにブランチを作る
3. 作業前に `main` の最新を取り込む
4. コミットは小さめに分ける
5. `main` に入れる前に起動確認と `npm run build` をする

## おすすめブランチ名

新機能:

```bash
feat/fur-elise-sample
feat/rest-editing
```

バグ修正:

```bash
fix/repeat-playback
fix/time-signature-display
```

まずは自分用で分けたい場合:

```bash
my_name-2026-05-04
```

## いつもの作業手順

### 1. 作業を始める

```bash
cd ~/Desktop/my-music-app_26.05.04
git switch main
git pull origin main
git switch -c feat/作業名
```

例:

```bash
git switch -c feat/playback-fix
```

### 2. アプリを起動する

Node.js で起動する場合:

```bash
npm run dev
```

Docker で起動する場合:

```bash
docker compose up
```

### 3. 作業が終わったら保存する

```bash
git add .
git commit -m "変更内容"
git push origin feat/作業名
```

例:

```bash
git add .
git commit -m "再生位置のずれを修正"
git push origin feat/playback-fix
```

## よく使うコマンド

今どのブランチにいるか確認:

```bash
git branch --show-current
```

変更されたファイルを見る:

```bash
git status
```

直近の履歴を見る:

```bash
git log --oneline -5
```

## やってはいけないこと

- `main` のまま作業する
- `git push origin main` を気軽に実行する
- 関係ないファイルまでまとめて直す
- 意味の分かりにくいコミットメッセージにする

悪い例:

```bash
git commit -m "いろいろ"
```

よい例:

```bash
git commit -m "反復記号の再生ずれを修正"
```

## 自分用の短い版

これだけ覚えれば大丈夫です。

```bash
cd ~/Desktop/my-music-app_26.05.04
git switch main
git pull origin main
git switch -c my_name-2026-05-04
npm run dev
git add .
git commit -m "修正"
git push origin my_name-2026-05-04
```

## 困ったとき

### いま何をしたらいいか分からない

```bash
git status
```

### いまどのブランチか分からない

```bash
git branch --show-current
```

### `main` で作業してしまった

あわてて `push` しないで、まず相談してください。

## このリポジトリでの考え方

このプロジェクトでは、

- まず安全に動くこと
- 差分を追いやすいこと
- あとで戻しやすいこと

を大事にします。

そのため、**`main` はなるべくきれいに保ち、作業はブランチで行う** のがおすすめです。
