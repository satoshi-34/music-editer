# 選択小節からの途中再生（Issue #108 の中核）

2026-08-22。#108「再生位置表示を実際の再生と同期」のうち、
表示同期（位置タイムライン+PlaybackHighlight）は実装済みだったため、
残っていた中核「途中からの再生」を実装した。

## 問題

再生は常に先頭から。handleSeek は表示 state を変えるだけで実音は動かない
（コード内コメントでも明示されていた既知の未実装）。

## 修正設計

- **UX**: 小節を選択したまま ▶ を押すと、その小節（selectedMeasures.start）から再生。
  開始時に「◯小節目から再生します（先頭から聴くには Escape で選択を外してください）」を通知
  （describePlaybackFromMeasure・#318）。選択なしは従来どおり先頭から
- **実音**: 全パートの展開後小節列（先頭パートの反復順にそろえてある）を
  同じ展開インデックスで slice して playParts へ渡す。開始位置は
  findPlaybackStartExpandedIndex = 「その小節が展開順で最初に現れる位置」
  （リピート2周目のどこか、を選ぶ UI は持たない）
- **表示**: buildPlaybackPositionTimeline に startExpandedIndex を追加し、
  先頭 N 個の展開小節を丸ごと飛ばす（atMs は 0 起点のまま実音と一致）。
  再生開始時に currentPosition を開始小節へ即時反映
- **残り時間**: 途中再生時のみ、切った後の展開小節列から calculateScoreDuration で数える。
  先頭からの再生は従来どおり生の小節列（挙動を変えない）

## 既知の制限（v1）

- 開始位置より前から始まる cresc./dim. の途中経過は反映されない
  （強弱の傾斜は切った後の並びで計算し直すため）
- 拍単位の途中再生（小節の頭以外から）は対象外
- 一時停止→再開は従来機構（残りミリ秒）がそのまま機能する

## 別Issue化（#108 のその他の提案）

ループ再生・メトロノーム/カウントイン・再生カーソルの自動スクロール・
音符クリック位置（イベント単位）からの再生は、フォローアップ Issue へ分離。

## 影響範囲

- utils/playbackPositionUtils.ts（startExpandedIndex・findPlaybackStartExpandedIndex）
- ScorePage の handlePlayScore（展開の共有・slice・通知・位置初期化・残り時間）
- scoreEditorNotices（describePlaybackFromMeasure）・README
- テスト: タイムラインの途中開始・リピート展開の最初の出現（展開順 [0,1,0,1,2] を固定）
