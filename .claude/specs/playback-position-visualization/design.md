# 再生位置の視覚化

## 背景

再生ボタンで譜面を流しても、どの音符を鳴らしているかが画面から分かりにくかった。
特にサンプル譜でリピートや終止括弧を使い始めると、
「いまどこを再生中なのか」を追えないと体験価値が下がる。

## 方針

- 実音のスケジュールは既存の `PlaybackEngine` に任せる
- 画面側では別途「再生位置タイムライン」を作り、同じ時刻で `currentPosition` を進める
- SVG 上の音符ヒット領域へ `data-measure` / `data-note` を付け、
  `PlaybackHighlight` が現在位置を見つけられるようにする

## 実装

- `playbackPositionUtils.ts`
  - 譜面データ、BPM、拍子から `atMs` つきの再生位置配列を作る
  - リピート記号と 1番括弧 / 2番括弧も既存展開ロジックに乗せて反映する
- `ScorePage.tsx`
  - 再生開始時に位置タイムラインを作ってタイマー予約する
  - 一時停止時は経過ミリ秒を保存し、再開時は残りだけ予約し直す
  - 停止、サンプル切替、背景復帰ではタイマーを安全にクリアする
- `StaffCanvas.tsx` / `PianoSystemCanvas.tsx`
  - 音符ヒット矩形へ `data-measure` / `data-note` を付与する
- `PlaybackHighlight.tsx`
  - `vf-note-hit` もハイライト対象として検索する

## セキュリティ / 安定性

- 視覚更新は UI の `setTimeout` に限定し、音声処理そのものには介入しない
- 停止や背景復帰でタイマーを必ず破棄し、古い予約が次の再生へ混ざらないようにする
- 再生位置タイムラインは譜面データから毎回再計算し、外部入力をそのまま DOM セレクタへ流し込まない

## 実装状況の追記（issue #128, 2026-07-30）

上記の方針・実装計画は本 issue まで `playbackPositionUtils.ts`（タイムライン生成・テスト済み）だけが存在し、`ScorePage.tsx` 側の配線が未着手だった。そのため画面の「N小節目 M音符目」表示が再生中もほぼ先頭のまま動かず、シーク（`handleSeek`）も表示 state を書き換えるだけで実音は動かないという「表示と実音の二重管理」状態が残っていた（issue #108 の指摘）。

今回、計画どおり配線した。

- `ScorePage.tsx` に `positionTimelineRef` / `positionTimeoutsRef` / `totalPlaybackMsRef` を追加
- 再生開始時（`handlePlay` の複数パート分岐）: `referenceMeasures`（`parts[0].measures`。他パートの反復展開もこれを基準にしているため位置表示の基準としてもズレにくい）から `buildPlaybackPositionTimeline()` でタイムラインを作り、`schedulePositionTimeline(0)` で `setTimeout` 予約。単一代表音（空譜面時の C4 ビープ）では小節位置が無いためタイムラインは空にする
- 一時停止 → 再開時: `elapsedMs = totalPlaybackMsRef - remainingPlaybackMsRef` を求め、`schedulePositionTimeline(elapsedMs)` でその時点から先だけ再予約する（`atMs < elapsedMs` の項目はスキップ）
- `clearPlaybackTimer()` に位置タイマーのクリアも統合した。停止・一時停止・音声復旧・サンプル切替・背景復帰など、既存で `clearPlaybackTimer()` を呼んでいた箇所はコード変更なしにそのまま位置タイマーも片付く
- `resetPlaybackClock()` は `positionTimelineRef` と `totalPlaybackMsRef` もあわせて初期化する

### 既知の制限（未対応のまま残す点）

- **シーク（`handleSeek`/`onSeek`）は実音を動かさない。** 現時点でこれを呼び出す UI 要素が存在しない（`PlaybackControls.tsx` に `onSeek` は渡されているが呼び出し箇所が無い、コード上の死経路）。実音側のジャンプには `PlaybackEngine.playParts()`（`SimpleAudioEngine.ts` / `SoundFontEngine.ts`）へ開始オフセットを渡す改修が必要で、これは Web Audio の先読みスケジューリング全体に関わるためブラスト半径が大きい。呼び出し口が存在しない状態でこの改修だけ先に入れてもブラウザで検証できないため、本 issue では見送った。クリックでの途中再生（issue #108 の残り4件のうちの1つ）を実装する際に、シークの UI 契機と実音ジャンプを同じタイミングで実装するのが安全と考える
