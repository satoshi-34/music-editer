# 設計書: スウィング再生（ジャズ）

## 概要

README ロードマップの「スウィング再生（ジャズ）」を実装する。
**記譜（見た目・保存データの音価）は一切変えず、再生タイミングだけ**を
3連系（スウィング）に揺らすトグルを「再生・音色」タブに追加する。

## 問題点

- 8分音符を均等に並べても、ジャズ風の「跳ねる」ノリでは聴こえない
- 記譜自体を3連符に書き換えると、楽譜の見た目・入力の手間が増え、他の記法（アーティキュレーション・強弱・タイ等）とも相性が悪い
- 再生エンジンが `SimpleAudioEngine`（内蔵音源）と `SoundFontEngine` の2系統に分かれており、タイミング計算がそれぞれ独立している。片方だけ直すと挙動が食い違う

## スウィングの定義

- 拍（4分音符1拍）を8分音符2つで割っているとき、
  - 表拍（拍頭ちょうど）の8分音符 → 「3連の2つ分（2/3拍）」の長さに伸ばす（開始位置はそのまま）
  - 裏拍（拍の真ん中）の8分音符 → 開始位置を「2/3拍の位置」まで遅らせ、長さを「3連の1つ分（1/3拍）」にする
  - 表拍 2/3 + 裏拍 1/3 = 1拍で、合計の長さは変わらない
- **判定は「拍内オフセット（拍頭からの相対位置）」だけで行う**。前後のペアリングを見ずに、1つの音符単体で「オフセットが 0 か 0.5 か」を見れば判定できるため、休符や和音が間に挟まっても取りこぼしにくい
- 対象は「付点なし・連符なしの8分音符」のみ。16分音符以下・3連符・付点8分音符は一般的なスウィング再生の慣例どおりストレートのまま
- スウィング比は **2:1 固定**。ただし将来「比率を変えられるように」という要望が来ても対応しやすいよう、`SWING_ON_BEAT_RATIO` / `SWING_OFF_BEAT_RATIO` という定数として持たせ、計算式自体は比率に依存しない形にしてある

### 複合拍子（6/8, 9/8, 12/8）の扱い

このアプリの拍数計算（`getMeasureBeats`）は複合拍子でも「4分音符=1拍」の単位でそのまま数値化する
（例: 6/8 は 3 拍分）。そのため8分音符の並びだけを見ると、6/8 拍子と 3/4 拍子の区別がつかない。

しかし複合拍子では「8分音符3つ＝付点4分音符」がもとの拍そのものであり、単純拍子と同じ
「表拍/裏拍を2:1で跳ねさせる」判定を当てはめると、本来のリズムと違う揺れ方になってしまう。

**判断: 複合拍子（分母が8かつ分子が3の倍数かつ6以上、= 6/8, 9/8, 12/8 等）はスウィング対象から除外する。**
`swingUtils.isCompoundTimeSignature` で判定し、`shouldApplySwing` がこれを見て自動的に無効化する。
3/8 のような単純拍子（8分音符が単位拍にならない、または3連ではない）は対象に含む。

## 実装

### 1. `src/utils/swingUtils.ts`（新規）

タイミング変換だけを行う純関数群。各エンジンから同じ関数を呼ぶことで、
「エンジンごとに微妙にロジックがずれて鳴り方が食い違う」事故を防ぐ。

| 関数 | 役割 |
|---|---|
| `SWING_ON_BEAT_RATIO` / `SWING_OFF_BEAT_RATIO` | スウィング比（2/3, 1/3） |
| `isSwingEligibleNote(dur, dots, tuplet)` | 付点なし・連符なしの8分音符かどうか |
| `applySwingToTiming({startBeat, durationBeats}, dur, dots, tuplet)` | 1音符の開始拍位置・長さを変換する中心ロジック |
| `isCompoundTimeSignature(timeSignature)` | 6/8, 9/8, 12/8 等の複合拍子判定 |
| `shouldApplySwing(swingEnabled, timeSignature?)` | トグルON かつ 複合拍子でない場合だけ true |

`applySwingToTiming` は「拍頭からの相対オフセット」を `Math.floor` で求め、
0 に近ければ表拍、0.5 に近ければ裏拍として変換する。浮動小数点誤差を吸収するため
`EPSILON = 1e-6` の許容幅を持たせている。

### 2. 各再生エンジンへの組み込み

いずれのエンジンも「小節頭からの開始拍位置」と「音価の拍数」を求めたうえで
`applySwingToTiming` を通し、変換後の値だけを実際の発音予約（秒への変換・
`triggerAttackRelease` / `playNoteAtTime` / `player.play` への引数）に使う。

- **`sequentialBeatPosition`（単声部の累積拍位置）や `partTime` / `currentTime`（累積時間）は、
  変換前の値のまま進める。** スウィングは表拍+裏拍のペアで合計拍数が変わらないため、
  スウィングON/OFFで小節の長さ自体がズレることはない。もし変換後の値で進めてしまうと、
  誤差が蓄積して曲の後半でどんどんズレていく。
- `startBeat` を持つ複数声部イベント（`flattenMeasureForPlayback` 経由）は、その `startBeat` を
  そのままスウィング判定の入力に使う。
- `startBeat` を持たない単声部イベントは、直前までの累積拍位置を都度計算してから判定する。

対象ファイル:
- `src/audio/SoundFontEngine.ts`（`playParts`）
- `src/audio/SimpleAudioEngine.ts`（`playScore`。ここでは `PlaybackMeasureEvent` 型に
  `dots?` / `tuplet?` が無かったため、スウィング判定に必要な分だけ型を広げた。
  もともと `durationToSeconds` が dots/tuplet を考慮していなかった制限はそのまま残しており、
  スウィングOFF時の挙動・タイミング計算は一切変更していない）
- `src/audio/ScorePlayer.ts`（Tone.js 版。**現状 UI からは呼ばれていない未使用コード**だが、
  テストが存在し、今後使われる可能性があるため同じ変換を適用した）

いずれも `setSwingEnabled(enabled: boolean)` を `PlaybackEngine` インターフェースに追加し、
ScorePage 側から現在の設定を都度反映する。

### 3. 再生位置ハイライトへの反映

`src/utils/playbackPositionUtils.ts` の `buildPlaybackPositionTimeline` にも
`swingEnabled` 引数を追加し、同じ `applySwingToTiming` を通す。ハイライトのタイムラインも
「実際に鳴る位置」に揃うようにしてある。

ただし調査の結果、**現在の `ScorePage.tsx` はこの関数を実際には呼び出しておらず**
（`currentPosition` は再生開始/終了時にリセットされるのみで、再生中の音符ごとの
自動ハイライト送りには使われていない）、既知の制限として記録しておく。
将来この関数を使ってハイライトを動かす実装が追加された場合は、スウィングにも
自動的に追従する。

### 4. 設定の保存先

`src/audio/playbackSettings.ts` の `PlaybackSoundRuntimeSettings` に
`swingEnabled: boolean`（既定 `false`）を追加。既存の LocalStorage キー
（`playback-sound-runtime-settings` = `PLAYBACK_RUNTIME_SETTINGS_STORAGE_KEY`）に相乗りさせ、
`sanitizePlaybackRuntimeSettings` で読み込み時の型検証も行う。
新しいキーを増やさないことで、音色設定と同じライフサイクル（保存・読込・エンジンへの反映）に
乗せられる。

### 5. UI

`PlaybackControls.tsx` の「音色詳細」パネルに、既存の「臨時記号確認音」トグルと同じ見た目で
「スウィング再生（ジャズ）」チェックボックスを追加。記譜が変わらないことを一言添えている。

### 6. MIDI書き出し

`src/utils/midiExport.ts` はスウィング変換を一切通さない。**MIDI書き出しは常に記譜どおりの
ストレートな音価で出力する**（一般的なDAW/notationソフトの挙動に合わせた設計判断）。

## 影響範囲

- 新規: `src/utils/swingUtils.ts`, `src/utils/swingUtils.test.ts`,
  `.claude/specs/swing-playback/design.md`
- 変更: `src/audio/playbackSettings.ts`, `src/audio/PlaybackEngine.ts`,
  `src/audio/createPlaybackEngine.ts`, `src/audio/SoundFontEngine.ts`,
  `src/audio/SimpleAudioEngine.ts`, `src/audio/ScorePlayer.ts`,
  `src/utils/playbackPositionUtils.ts`, `src/components/PlaybackControls.tsx`,
  `src/components/ScorePage.tsx`, `README.md`
- 既存の楽譜データ・保存フォーマットへの変更なし（`swingEnabled` は再生設定側のみ）
- 既定値は `false`（スウィングOFF）のため、既存ユーザーの再生結果は変わらない

## 既知の制限

- 複合拍子（6/8, 9/8, 12/8）はスウィング対象外
- 再生位置ハイライト（`PlaybackHighlight.tsx` / `buildPlaybackPositionTimeline`）は、
  現状の実装では再生中の音符送りに使われていないため、スウィングによるズレの実害は無いが、
  将来ハイライトを実装する際はこの関数がスウィングに対応済みであることを前提にしてよい
- `SimpleAudioEngine`（内蔵音源）はもともと dots/tuplet を厳密に考慮したタイミング計算をしていない
  制限があり、今回はその制限自体には手を入れていない（スウィング判定用に dots/tuplet を
  読み取れるようにしただけ）
