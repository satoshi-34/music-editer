# 強弱を音色にも効かせる（velocity → 音色・Issue #670）— 設計メモ

## 出典と問題
弟（作曲専攻・発案者）のフィードバック（2026-09-05）:「ベロシティが変化するといいかも」＝「音の大小だけでなく、
強くて鋭い／弱くてソフトという強弱の概念がベロシティ」。従来は強弱記号（#514/#626/#627）から来る
velocity を**ゲイン（音量）にだけ**掛けていたので、pp でも「小さいが硬い音」のままだった。

## 段1（本 PR）: 音源に依存しない方法
- 音ごとにローパスフィルタ（BiquadFilter・Q 0.7）を 1 つ挟み、カットオフを velocity で動かす。
  対応表は純関数 `velocityToCutoffHz`（`src/audio/velocityTimbre.ts`）: 1.4kHz（v=0）〜16kHz（v=1）を
  **対数補間**（耳は周波数を対数で感じる。中点 0.5 で約 4.7kHz）。範囲外・非数は素通し側へ丸める
  （強弱の情報が無い音を勝手に曇らせない）
- **内蔵音源（SimpleAudioEngine）**: 音ごとの GainNode → フィルタ → マスターゲイン。
  `registerOscillators` / `playSafariSafeVoice` に velocity を渡したとき（＝譜面再生）だけ挟む。
  確認音・テスト音（velocity 無し）は従来どおり素通し
- **SoundFont（SoundFontEngine）**: soundfont-player の `play()` は内部で「音ノード → player の出力 →
  destination」と配線してしまうので、返ってきた音ノードをいったん `disconnect()` してから
  フィルタ経由でマスターゲインへつなぎ直す（`applyVelocityTimbre`）。想定外のノード・フィルタを
  作れない context では何もしない（従来どおり鳴る）
- 設定: `PlaybackSoundRuntimeSettings.velocityTimbreEnabled`（既定 **true**。既存の保存データに項目が
  無ければ true）。音色詳細の「強弱で音色も変える」で OFF にできる。エンジンへは
  `setVelocityTimbreEnabled?`（optional・偽エンジンや外部プラグイン経路が持たなくてよい）で流す
- ノード数: 1 音あたりフィルタ 1 個。先読み窓（#622）で逐次予約するので同時に生きるノードは
  窓ぶんだけ。同時発音数の上限（#605）の内側

## 段2（別 PR・音源次第）
ピアノ音源（MusyngKite）に velocity レイヤー（強弱ごとの別録音）があるなら velocity でレイヤーを選ぶ。
soundfont-player は 1 音 1 サンプルの構造なので、対応するなら別のローダーが要る。まず段1の耳での
評価（運用者・弟）を待つ。

## テスト
- `velocityTimbre.test.ts`: 対応表（両端・中点・順序・範囲外）、ノード生成（設定値・作れない context）
- `SimpleAudioEngine.test.ts`: 譜面再生で音ごとに 1 つ・弱い音ほど低い／OFF で作らない／確認音は挟まない
- `SoundFontEngine.test.ts`: 音ノードの disconnect → フィルタ → マスターの配線／OFF でつなぎ直さない
- `playbackSettings.test.ts`: 既定 true・保存済み false を尊重
- `ScorePageVelocityTimbreWiring.test.tsx`: トグル → エンジンへ false・設定へ保存

## やってはいけないこと
- 確認音（音符クリック・テスト音）に velocity を渡さない（挟むと「音が曇った」と誤解される）
- フィルタの生成失敗で再生を止めない（素通しで鳴らす）
