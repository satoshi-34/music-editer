# 設計書: Safari silent failure の自動検知と復旧（issue #14）

## 問題

Safari では `AudioContext.state === 'running'` に見えても実音が出ない「silent failure」がある。
例外が出ないため既存の自動フォールバック（SoundFont 失敗時の built-in 退避など）が発火せず、
ユーザーは「再生ボタンを押しても無音」のまま原因が分からない。
従来は手動の「音声復旧」ボタンだけが対処手段だった。

## 修正設計

### 1. 出力ヘルスチェック（`src/audio/audioOutputHealth.ts` 新規）

再生開始の約 600ms 後に、次の 2 段階で「音が出ているはずの状態か」を確認する。

| 段階 | 見るもの | 検知できる故障 |
|---|---|---|
| currentTime 進行チェック | プローブ時間（250ms）内に `context.currentTime` が進むか | running 表示のままレンダリングが止まっている状態 |
| Analyser 無音プローブ | テスト用オシレーター → AnalyserNode の波形 | グラフ処理そのものが死んでいる状態 |

- プローブのオシレーターは **destination に接続しない**ため、ユーザーに聞こえる音は出ない
  （AnalyserNode は出力先に接続しなくても処理される、と Web Audio 仕様で定められている）
- 判定は 3 値（healthy / unhealthy / unknown）。**unknown では何もしない**。
  - context を取得できない（テスト環境・未対応エンジン）→ unknown
  - プローブを実施できない環境 → unknown
  - これにより誤検知での復旧ループを避ける
- 2 つとも正常でも OS の出力デバイス段で消えるケースは JS から観測できない（既知の限界）。
  その場合は従来どおり「音声復旧」ボタン・最小テスト音で切り分ける

### 2. エンジンへの診断用アクセサ

`PlaybackEngine` に optional の `getAudioContext?(): AudioContext | null` を追加し、
`SimpleAudioEngine` / `SoundFontEngine` で実装。診断専用で、再生制御には使わない。

### 3. ScorePage の配線（検知 → 自動復旧 → 通知）

- 再生ボタン（`handlePlay`）と音色プレビュー（`handleInstrumentPreview`）の成功後に
  `scheduleOutputHealthCheck()` を予約する
- **unhealthy 確定時のみ**:
  1. 診断ログを `console.warn` に一行で出力（Safari 実機からの報告にそのまま貼れる形式）
  2. クールダウン（30 秒）外なら: ユーザー設定は維持したままエンジンだけ再作成し、
     「無音状態を検知したため、音声エンジンを自動で再起動しました」と通知
  3. クールダウン内（直前に自動復旧したのに再発）なら: 再作成を繰り返さず
     「音声復旧」ボタンとページ再読み込みへ誘導する通知に切り替える
- 通知は `PlaybackControls` の再生ボタン直下に非モーダル表示（`.audio-health-notice`、`role="status"`）。
  healthy を確認したら自動で消える。手動の「音声復旧」でも消える

## 検証

- 単体テスト 7 件（`audioOutputHealth.test.ts`）: 3 値判定・プローブ不能環境・整形ログ
- 全テスト 568 件パス、`tsc -b && vite build` 成功
- 実ブラウザ（Chromium）で `createAnalyser` を「常に無音を返す」ようにパッチして silent failure を再現:
  - 検知 → 診断ログ → 自動再起動 → 通知の全経路が動作
  - 30 秒以内の再検知でクールダウン分岐（手動復旧への誘導）に切り替わることを確認
  - パッチなしの正常系では通知・警告とも出ない（誤検知なし）
- **Safari 実機での silent failure 再現確認は未実施**（再現条件が不安定なため）。
  実機で発生した際は、コンソールの `[ScorePage] 無音状態を検知しました:` 行を issue へ貼って追跡する

## 影響範囲

- `src/audio/audioOutputHealth.ts` / `.test.ts` — 新規
- `src/audio/PlaybackEngine.ts` — optional メソッド追加（既存実装への破壊的変更なし）
- `src/audio/SimpleAudioEngine.ts` / `SoundFontEngine.ts` — アクセサ追加のみ
- `src/components/ScorePage.tsx` — 検知経路の配線。既存の手動「音声復旧」「最小テスト音」は不変
- `src/components/PlaybackControls.tsx` — 通知表示の追加

## フォローアップ: 一時停止の誤検知修正（Safari 実機で発見）

再生開始から 600ms 以内にユーザーが一時停止すると、suspend された AudioContext を
ヘルスチェックが「unhealthy (state=suspended)」と誤検知し、自動復旧が走って
一時停止状態を壊してしまう不具合が Safari 実機で見つかった。

対策: `playbackStateRef`（最新の再生状態を setTimeout 越しに読むための ref）を導入し、
**ユーザーが一時停止中（'paused'）ならチェック自体をスキップ**する。
プローブ（約250ms）の最中に一時停止された場合も同様に無視する。
silent failure の前提は「running 表示なのに無音」なので、意図的な suspended を
対象から外しても検知能力は落ちない。

実装メモ: 2 回目の paused 判定を `ref.current === 'paused'` と直接書くと、
1 回目の早期 return の型絞り込みが await 越しに残り TS2367 になる。
判定を小さな関数（`isPausedByUser()`）に包んで回避している。

## やってはいけないこと

- `unknown` 判定で自動復旧を動かさない（テスト環境・古いブラウザで復旧ループになる）
- プローブのオシレーターを `destination` に接続しない（ユーザーに聞こえてしまう）
- クールダウンを外さない（壊れた環境でエンジン再作成が無限に繰り返される）
- 一時停止中（playbackState === 'paused'）にヘルスチェックを動かさない（suspended は正常な状態）
