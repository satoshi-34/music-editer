# 再生の先読みリード — Issue #610

運用者QA（2026-09-03）「最初の音がずれる／プツる／和音の再生が苦手」への構造的対処。
セッション内実装（PR #616）。

## 問題

両エンジンの `playParts` は「開始時刻＝`AudioContext.currentTime`（今）」を起点に、
曲全体（長い曲では数百音）の予約ループを回す。予約処理そのものに実時間がかかるため、
先頭の音の開始時刻は予約完了時点ですでに過去になり、アタック途中から鳴る（ずれ＋プツ）。
和音は同時刻に複数ソースを起動するので被害が大きい。

## 設計

- `src/audio/scheduleLead.ts` の **`SCHEDULE_LEAD_SECONDS = 0.1`** を両エンジンで共用
  （`scheduleLeadSeconds()`。dev では #596 の調整パネル `audio.scheduleLead` で上書き、
  本番は DEV ガードで定数直返し＝tree-shake）。二重実装を作らない
- `SoundFontEngine.playParts` / `SimpleAudioEngine.playParts`: 起点 = `currentTime + リード`
- 単音プレビュー（`playNoteByName`）は即時のまま（押した瞬間に鳴る用途で、予約は1音）
- **画面側（ScorePage）の同期**（round1 P2）: エンジンは予約ループ開始時点の「今＋リード」を
  起点にするため、画面側も `playParts` を呼ぶ**前**の `Date.now()`（`scheduledAt`）を起点にする。
  タイムラインの各項目は `atMs + リード` へずらし、`schedulePositionTimeline` と終了タイマーには
  予約に使った実時間（`Date.now() - scheduledAt`）を差し引いて渡す。これで
  実音・ハイライト・終了状態の3つが同じ時計に乗る。pause/resume は AudioContext の
  suspend/resume で時計ごと止まるので追加の補正は不要
- 体感: 再生ボタン→発音が 0.1 秒遅れる。頭欠け解消を優先。値は運用者の耳で決める

## テスト

- `scheduleLead.test.ts`: 既定値・パネル登録の一致・dev 上書きが実効値へ届く
- `pedalPlaybackEngines.test.ts` / `SoundFontEngine.test.ts`: 先頭の予約時刻がリードぶん先、
  上書き時は上書き値、停止側も同量の平行移動
- `ScorePageScheduleLeadWiring.test.tsx`: 実マウントで、ハイライトの初回予約と終了タイマーが
  「リード − 予約に使った実時間」で組まれること
