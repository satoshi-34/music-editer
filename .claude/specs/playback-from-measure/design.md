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

## Codex round1 対応（2026-08-22）

- **残り時間の専用計算**（P1/P2）: calculateScoreDuration は内部でリピートを再展開し、
  末尾判定も主声部しか見ない（声部2のみの譜面で 0 秒 → 即 stopped）。展開済み列専用の
  calculateExpandedPlaybackDurationMs を新設（再展開しない・末尾判定は全声部・
  前進規則はタイムラインと同じ向きで、主声部が空の小節は拍子と実長の大きい方）
- **強弱は切る前の全列で解決**（P2）: resolveDynamicVelocities を全展開列で実行し、
  キーの小節番号を startExpandedIndex でオフセットして引く。開始位置より前の
  絶対強弱（p/f）も cresc./dim. の途中経過も正しく引き継がれる
  （→ 当初「既知の制限」としていた cresc. の件はこの方式で解消）
- **パート譜表示中は選択起点にしない**（P2）: 選択UIが無く見えない選択で途中再生になるため
- **1小節目選択でも通知**（P3）: 通知条件を展開インデックスではなく「選択起点かどうか」に

## Codex round2 対応（2026-08-22）

- **前進規則を実音エンジンに一致させて共通化**（P2）: SimpleAudioEngine は小節末で
  `max(小節内の実終了時刻, measureStartTime + measureBeats)` と進む（実装で確認）。
  タイムライン・残り時間とも measureAdvanceBeats = max(全声部の実長, 拍子長) に統一。
  旧タイムラインは未充足小節を実長だけで進めており、**ハイライトが実音より先行する
  既存バグ**だった（既存テストの期待値 1000ms → 2000ms を実挙動に合わせて更新）
- **duration 分岐は選択起点かどうか**（P1）: 1小節目の選択（startExpandedIndex=0）でも
  専用計算を通す（旧計算は声部2のみの譜面で 0 秒 → 即 stopped）
