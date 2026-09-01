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
- **残り時間（終了タイマー）**: 選択の有無にかかわらず、実際にエンジンへ渡す
  展開済み小節列から calculateExpandedPlaybackDurationMs で数える
  （旧 calculateScoreDuration は round3 で廃止。経緯は下の対応記録）

## 既知の制限（v1）

- 拍単位の途中再生（小節の頭以外から）は対象外
- 一時停止→再開は従来機構（残りミリ秒）がそのまま機能する

## 別Issue化（#108 のその他の提案）

ループ再生・メトロノーム/カウントイン・再生カーソルの自動スクロール・
音符クリック位置（イベント単位）からの再生は、フォローアップ Issue へ分離。

## 影響範囲

- utils/playbackPositionUtils.ts（startExpandedIndex・findPlaybackStartExpandedIndex）
- ScorePage の handlePlay（展開の共有・slice・通知・位置初期化・残り時間）
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

## Codex round3 対応（2026-08-22）

- **終了タイマーを全再生でも統一**: 旧 calculateScoreDuration（未充足小節を実長のみ・
  末尾判定は主声部のみ・途中テンポを独自解釈）を廃し、選択の有無にかかわらず
  展開済み列 + calculateExpandedPlaybackDurationMs で数える。旧計算は拍子長を下限に進む
  実音・タイムラインより早く stopped になっていた
- 補足: 途中テンポ変更（measure.bpm）は再生ボタン経路（playParts）では実音にも
  ハイライトにも効いていない（効くのは ScorePlayer 経路のみ）。旧計算だけが bpm を
  追跡しており、実音と食い違う見積もりだった。経路統一は #365（再生機能の拡張）の範囲

## 小節番号を指定した途中再生（Issue #545・2026-09-02）

### 問題

途中再生は「小節を範囲選択してから再生」でしかできず、長い曲では聴きたい小節まで
画面をスクロールして選択する手間がかかっていた（Finale のプレイバック・コントローラーは
小節番号の入力でジャンプできる）。

### 修正設計

- **UI**: 「再生・音色」タブの位置表示のとなりに「小節番号」の入力欄と
  「この小節から再生」ボタンを置く（`PlaybackControls`）。入力欄で Enter を押しても
  同じ動作にして、入力→ボタンへマウスを動かす往復を省く
- **実音**: 選択起点の途中再生と**同じ経路を共用**する。`handlePlay` に
  `options.startMeasureIndex`（0 始まり）を足しただけで、展開・`findPlaybackStartExpandedIndex`・
  slice・強弱/テンポの「絞り込み前に解決してからオフセットで引く」規則はそのまま。
  開始位置より前のテンポ変更・速度標語・絶対強弱が引き継がれるのはこの共用の結果
  （同じロジックの2枚目を作らない。#280 の再発防止）
- **優先順位**: `startMeasureIndex` の指定があるときは選択起点より優先し、
  一時停止からの `resume` 分岐にも入らない（「その小節から鳴らし直す」意味のため）
- **判定の置き場所**: 「番号 → 小節インデックス」と範囲外の判定は
  `resolvePlaybackStartMeasureNumber`（`utils/playbackPositionUtils.ts`）に集約し、
  `PlaybackControls` は入力欄の**生の文字列**を親へ渡すだけにする。総小節数を知っているのは
  ScorePage 側なので、判定を両側に置くと二重管理になる
- **行き止まりは喋る（#318）**: 範囲外（0以下・総小節数超）・数字として読めない入力・
  再生できる小節がまだ無い譜面の3つを理由として返し、
  `describePlaybackStartMeasureRejected` の通知で「なぜ効かないか」「どう入れ直すか」を出す。
  `parseInt` の部分解釈（`"3abc"` → 3）に頼らず、数字だけの入力かを正規表現で先に見る
- **再生中の指定**: いったん `handleStop` してから頭出しし直す（音の途中への飛び込み＝
  シークは本Issueのスコープ外。#545 仕様4）
- **上限に使う小節数**: `contentMeasureCount`（末尾の空小節を除いた「内容のある小節数」）。
  鳴らすものが無い末尾の空小節を指定できても意味が無いため

### 既知の制限

- 弱起（#473・実装中）が入ったときの表示番号（弱起=0）との一致は、#473 のマージ後に
  `contentMeasureCount` と表示番号の対応を見直す必要がある（本PR時点では #473 未マージ）

### 影響範囲

- `utils/playbackPositionUtils.ts`（`resolvePlaybackStartMeasureNumber` と結果型）
- `utils/scoreEditorNotices.ts`（`describePlaybackFromMeasureNumber` /
  `describePlaybackStartMeasureRejected`）
- `components/PlaybackControls.tsx`（入力欄・ボタン・`onPlayFromMeasure` / `totalMeasureCount`）
- `components/ScorePage.tsx`（`handlePlay` の引数追加・`handlePlayFromMeasureNumber`・配線）
- `App.css`（`.playback-start-measure` 一式）
- テスト: `utils/playbackPositionUtils.test.ts`（解決規則）／
  `components/ScorePagePlayFromMeasureNumber.test.tsx`（配線: エンジンへ渡る開始小節・
  手前のテンポ引き継ぎ・範囲外は再生しない）
