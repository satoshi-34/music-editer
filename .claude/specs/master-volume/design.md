# 設計書: マスター音量スライダー

## 背景

SoundFont（特に FluidR3_GM パック）はサンプル自体の音量が控えめで、強弱記号なしの
既定状態では `(0.45 + 明るさ×0.15 + 厚み×0.35) × ベロシティ0.5 ≒ 0.35` までしか
上がらず「音が小さい」という報告があった。音色キャラの 4 スライダーとは別に、
全体音量を直接調整できる手段が欲しい。

## 設計

### 方針: 各エンジンにマスター GainNode を1つ置く

音符ごとの gain 計算式へ係数を掛ける方式ではなく、
**すべての発音ノードをマスター GainNode 経由で destination へ流す**構成にした。

- 1 か所の gain 変更で全音（再生・プレビュー・入力確認音）に効く
- 再生中でも即座に反映できる
- volume=0 で正確にミュートできる（式の下限クランプに邪魔されない）

### 1. 設定（`src/audio/playbackSettings.ts`）

- `PlaybackSoundProfile` に `volume: number`（0〜1）を追加。既定値 0.5
- `getMasterVolumeGain(profile)`: スライダー値 → GainNode 値の変換
  - **二乗カーブ `(volume × 2)²`: 0.5 → 1.0（従来どおりの音量）、1.0 → 4.0（約4倍）、0 → 0（ミュート）**
  - 二乗カーブの理由: 50% を従来音量に固定したまま上側の伸びしろを増やせる
    （線形 ×4 だと 50% が従来の2倍になり、既存ユーザーの聞こえ方が変わってしまう）。
    また人の耳には二乗的な音量カーブのほうが自然に聞こえる
  - 旧保存データに volume が無い場合は従来音量（1.0）に補完
- `sanitizePlaybackRuntimeSettings` で 0〜1 へ丸め（localStorage 改ざん対策は既存方針踏襲）
- profile に乗せたことで、保存（localStorage）・エンジン反映（setSoundProfile）・
  UI 配線（onSoundProfileChange）が**既存の配管そのまま**で動く

### 2. エンジン（`SimpleAudioEngine` / `SoundFontEngine`）

- `masterGainNode` フィールドと `getOutputNode(context)` を追加
  - AudioContext が作り直されたときは `masterGainNode.context !== context` で検出して再作成
  - `dispose()` で null へ戻す（閉じた context のノードは再利用できない）
- SimpleAudioEngine: 発音 gainNode の接続先を `destination` → `getOutputNode()` へ変更
  （通常経路と Safari セーフ経路の両方）。`primeOutput()` のウォームアップは
  「出力経路を起こす」のが目的なので destination 直結のまま
- SoundFontEngine: `soundfont-player` の `instrument()` に `destination` オプションで
  マスター GainNode を渡す（player は内部でここへ接続する）
- `setSoundProfile()` で `masterGainNode.gain.value` を即時更新（再生中でも効く）

### 3. UI（`PlaybackControls.tsx` / `App.css`）

- 音色詳細パネルの中ではなく、**常時見える再生コントロール列**に「音量: NN%」スライダーを配置
- 既存の `handleSoundProfileSliderChange('volume')` がそのまま使える
- `.volume-controls` / `.volume-label` / `.volume-slider` を App.css に追加

## 検証

- 単体テスト 4 件追加（旧データ補完・丸め・変換値・volume 欠落 profile）。全 572 件パス、ビルド成功
- 実ブラウザ（Chromium）で `createGain` を記録するパッチを当てて確認:
  - 既定 50% で master gain = 1.0（従来音量から変化なし）
  - スライダー 100% → 2.0、0% → 0 が**再生中に即時反映**
  - localStorage に `profile.volume` が保存される

## 影響範囲

- 既定値 0.5 は従来音量と等価のため、**既存ユーザーの聞こえ方は変わらない**
- 100% は約 2 倍のため、和音や多パートでクリッピング（音割れ）し得る。
  音割れを感じたら下げてもらう運用（スライダーはそのための UI）
