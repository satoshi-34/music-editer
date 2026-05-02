# Safari 音声メモ

> **Safari では、再生コードが最後まで動いていても無音になることがある。**
> 特に開発中のホットリロード、別タブの動画再生、タブの復帰後に起きやすい。

---

## 症状

- `SimpleAudioEngine` のログでは `音符再生開始` まで出ている
- Chrome では鳴るのに Safari だけ鳴らない
- さっきまで鳴っていたのに、別タブで動画を見たあと急に無音になる

---

## 見立て

Safari では `AudioContext.state === 'running'` に見えても、実際の出力経路が眠ったままで音が出ないことがある。

今回のアプリでは、次のような場面で起きやすかった。

- `vite` のホットリロード後
- 別タブで動画や音声を再生したあと
- タブをバックグラウンドに送って戻したあと
- 既存の `AudioContext` を再利用したとき

---

## 実装上の対策

対策の中心は [src/audio/SimpleAudioEngine.ts](../src/audio/SimpleAudioEngine.ts)。

### 1. 再生前に `AudioContext` の状態を確認する

- `suspended` / `interrupted` なら `resume()` する
- `running` に戻らない場合は作り直す

該当箇所:

- [initialize()](../src/audio/SimpleAudioEngine.ts)
- [ensureContextReady()](../src/audio/SimpleAudioEngine.ts)

### 2. 再生・プレビュー時に `AudioContext` を作り直せるようにする

Safari では「見かけ上 running の古い context」が無音のまま残ることがあるため、
ユーザー操作起点の再生では古い context を捨てて作り直せるようにしている。

該当箇所:

- [src/components/ScorePage.tsx](../src/components/ScorePage.tsx)

### 3. 出力経路をウォームアップする

これが今回の Safari 対策の決め手。

`AudioContext` の初期化直後や `resume()` 直後に、
**ごく短い、ほぼ無音のオシレーター**を 1 回だけ流して、
Safari 側の出力経路を起こしている。

該当メソッド:

- `primeOutput()`

ログ:

- `[SimpleAudioEngine] 出力経路をウォームアップしました`

---

## ユーザー向けの切り分け

Safari でまた鳴らなくなったときは、まず次を確認する。

1. Chrome では鳴るか
2. Safari のそのタブだけ無音ではないか
3. 別タブで動画や音声を流した直後ではないか
4. ページ再読み込みで戻るか

もし **Chrome では鳴る / Safari だけ鳴らない** なら、
アプリ全体のロジック崩れより Safari 側の音声状態を疑う。

---

## 開発中の確認ポイント

- コンソールに `音符再生開始` が出ているか
- その前後で `AudioContext作成完了` が出ているか
- `出力経路をウォームアップしました` が出ているか

ここまで出ていて Safari だけ無音なら、
再生処理そのものより Safari の出力経路問題である可能性が高い。

---

## 再発したときの手順

1. まず Chrome で鳴るか確認
2. Safari でページを再読み込み
3. それでもだめならタブを開き直す
4. さらに再発するなら `SimpleAudioEngine` の `primeOutput()` と `ensureContextReady()` を確認

---

## 関連ファイル

- [src/audio/SimpleAudioEngine.ts](../src/audio/SimpleAudioEngine.ts)
- [src/components/ScorePage.tsx](../src/components/ScorePage.tsx)
- [README.md](../README.md)
- [docs/REGRESSION.md](REGRESSION.md)
