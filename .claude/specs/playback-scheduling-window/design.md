# 先読み窓の逐次スケジューリング — Issue #622

運用者QA（2026-09-04・全曲月光・学習停止済みでマシン健全）: #605 の上限導入後も途切れる。
ログは `ボイス 1182 / 最大同時 21 / 上限 48`＝同時発音は原因ではない。「先頭以外でも起き、
1〜2段目で起こりがち」「8小節版では起きない」。セッション内実装。

## 原因
両エンジンとも `playParts` が曲全体（1,182 音・ノード約 3,500）を予約時点で一括生成し音声グラフへ
接続していた。Web Audio は**まだ鳴っていないノードも毎レンダー量子で処理する**ため、序盤ほど
音声スレッドが重くバッファ落ちし、鳴り終わったノードが外れるにつれて軽くなる。

## 設計
- `src/audio/scheduleWindow.ts`: 純粋な計画部 `takeDueVoices`（時刻順一覧から窓内を切り出す）と
  `createWindowedScheduler`（`start` で先頭の窓を**同期的に**予約、以後 `setTimeout`（500ms）で
  `currentTime + LOOKAHEAD_SECONDS` までを順に予約、`stop` で以後を作らない）。両エンジン共通
- 時計は `AudioContext.currentTime`。一時停止（suspend）中は進まないので窓も進まず、再開で続く。
  別のタイマー制御を持たない
- 同時発音の上限（#605 `limitPolyphony`）は全曲の一覧に先に掛け、その後で窓を切る
- 先頭の窓を同期的に作るので #610 の先読みリード・`scheduledAtMs` はそのまま
- `SoundFontEngine` / `SimpleAudioEngine` は `activeScheduler` を持ち、`stopAll` で止める。
  内蔵音源は `playNoteAtTime` に楽器を引数で渡す（先読み窓ではパート別の音を非同期に予約するため、
  `currentInstrument` の一時切り替えでは混線する）。`getInstrumentConfig(instrument?)` も同様
- `LOOKAHEAD_SECONDS = 4`（dev パネル `audio.lookahead` 1〜12 秒）。短いほど軽いが、タブが裏に
  回って `setTimeout` が間引かれたとき（Chrome は最小 1 秒）の余裕が減る
- 計測ログに「先読み窓 Ns で先頭 M 音を予約」を追加

## テスト
- `scheduleWindow.test.ts`: 窓の切り出し・先頭同期・時計進行で続き・一時停止中は進まない・stop 後は作らない・入力順非依存・dev 上書き
- `SoundFontEngine.test.ts` / `pedalPlaybackEngines.test.ts`: 40 秒の譜面で先頭は一部だけ予約、時計を進めると続き、stopAll で止まる

## やらなかったこと
- `requestAnimationFrame` や AudioWorklet での進行。裏タブで止まる／過剰なので setTimeout で足りる
- ハイライトのタイムライン（#579）の窓化。setTimeout の予約はノードではないので負荷が違う
