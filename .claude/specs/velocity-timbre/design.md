# 強弱を音色にも効かせる（velocity → 音色・Issue #670）— 設計メモ

## 出典と問題
発案者ユーザー（作曲専攻）のフィードバック（2026-09-05）:「ベロシティが変化するといいかも」＝「音の大小だけでなく、
強くて鋭い／弱くてソフトという強弱の概念がベロシティ」。従来は強弱記号（#514/#626/#627）から来る
velocity を**ゲイン（音量）にだけ**掛けていたので、pp でも「小さいが硬い音」のままだった。

## 段1（本 PR）: 音源に依存しない方法
- **弱い音だけ**にローパスフィルタ（BiquadFilter・Q 0 dB）を 1 つ挟み、カットオフを velocity で動かす。
  対応表は純関数 `velocityToCutoffHz`（`src/audio/velocityTimbre.ts`）: velocity **0.5 以上は素通し**
  （強弱記号の無い音＝0.5、mf＝0.58、f 以上を 1 音も変えない。round1 P1: 中点補間だと無記号譜面が
  一律にこもった）。0.5 未満は 600Hz（v=0）〜16kHz（v=0.5）を対数補間（pp 0.22 で約 2.5kHz、
  p 0.35 で約 6kHz。初版の 1.4kHz 下限は運用者検聴で「柔らかさ不足」→ 600Hz に）。素通しの音にはフィルタ自体を作らない（ノードを増やさない）
- **内蔵音源（SimpleAudioEngine）**: 音ごとの GainNode → フィルタ → マスターゲイン。
  `registerOscillators` に velocity を渡したとき（＝譜面再生）だけ挟む。確認音・テスト音（velocity
  無し）は素通し。**Safari の簡易経路（`playSafariSafeVoice`）には挟まない**（「1 osc + 1 gain に
  絞る」という経路の存在理由と衝突する。Safari では音量差だけ）
- **SoundFont（SoundFontEngine）**: soundfont-player の `play()` は内部で「音ノード → player.out →
  destination」と配線してしまうので、返ってきた音ノードを **player.out からだけ** `disconnect(out)`
  して、フィルタ経由でマスターゲインへつなぎ直す（`applyVelocityTimbre`）。順序は「フィルタ→
  マスター」「音ノード→フィルタ」「player.out から外す」で、途中で失敗したら player.out へ戻す
  （無音にしない）。`play()` が undefined（音域外）でも何もしない
- 設定: `PlaybackSoundRuntimeSettings.velocityTimbreEnabled`（既定 **true**。既存の保存データに項目が
  無ければ true）。音色詳細の「強弱で音色も変える」で OFF にできる。エンジンへは
  `setVelocityTimbreEnabled?`（optional・偽エンジンや外部プラグイン経路が持たなくてよい）で流す
- ノード数: 1 音あたりフィルタ 1 個。先読み窓（#622）で逐次予約するので同時に生きるノードは
  窓ぶんだけ。同時発音数の上限（#605）の内側

## 段2（別 Issue 候補・調査結果）
MusyngKite（midi-js-soundfonts）は **1 音 1 サンプル**で velocity レイヤー（強弱ごとの別録音）を
持たない。soundfont-player もその前提の構造なので、レイヤー切替をやるなら別の音源（SF2 の
velocity レイヤー付き）と別のローダーが要る。まず段1の耳での評価（運用者・ユーザー）を待つ。

## テスト
（Issue の「AnalyserNode で単体テスト」は jsdom では実測できないので、偽ノードの設定値で検証する。
実音のスペクトルはブラウザで耳・アナライザ確認）
- `velocityTimbre.test.ts`: 対応表（素通し境界・順序・幾何平均・範囲外）、ノード生成（設定値・素通しでは作らない・作れない context）
- `SimpleAudioEngine.test.ts`: 譜面再生で音ごとに 1 つ・弱い音ほど低い／OFF で作らない／確認音は挟まない
- `SoundFontEngine.test.ts`: 音ノードの disconnect → フィルタ → マスターの配線／OFF でつなぎ直さない
- `playbackSettings.test.ts`: 既定 true・保存済み false を尊重
- `ScorePageVelocityTimbreWiring.test.tsx`: トグル → エンジンへ false・設定へ保存

## やってはいけないこと
- 確認音（音符クリック・テスト音）に velocity を渡さない（挟むと「音が曇った」と誤解される）
- フィルタの生成失敗で再生を止めない（素通しで鳴らす）
