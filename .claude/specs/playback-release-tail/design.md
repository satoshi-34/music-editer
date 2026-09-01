# リリースの尻尾（長い音符の切り方）— Issue #525

親: #468（再生の音楽性）の観点2「ベタ打ち・切り方」。

## 問題

運用者の検聴（2026-08-31・月光検聴版の左手全音符ほか）で「二分音符とか全音符もっと伸びた方がいい」。
過去にも同趣旨の報告があった。

実際のピアノは、音価の終わりで音が消えるのではなく、ダンパーが降りたあとも短い減衰の尻尾が残る。
一方この実装は、**音価ちょうどで鳴り終わる**設計になっていた。

| 音源 | 変更前の尻尾（余韻スライダー既定 0.5） |
| --- | --- |
| SoundFont（既定の音源） | `release: 0.05 + 0.5×0.45 = 0.275` 秒（＋ duration に 0.075 秒を上乗せする小細工） |
| 内蔵音源（ピアノ＝既定プリセット） | `tailSeconds: 0.05` → 調整後 **0.06 秒** |

長い音ほど「早く切られた」硬い印象になるのはこのため。0.06 秒はほぼ即断で、
2分・全音符のように「まだ鳴っていてほしい」音でも音価の瞬間に消えていた。

## 修正設計

**「鳴り終わりの時刻」だけを後ろへ伸ばす**。音の開始時刻・次の音までの間隔は一切変えない
（テンポ・リズムは不変。尻尾が次の音へ重なるのは実ピアノのペダル感どおり・仕様案2）。

### 尻尾の長さは1か所で決める（`src/audio/releaseTail.ts`）

内蔵音源と SoundFont の**両方**が同じ尻尾を持つ必要があり、係数を別々に書くと
片方だけ調整されて音の印象が食い違う。長さの決め方は新しい純粋モジュールへ集約した。

- `MIN_RELEASE_TAIL_SECONDS = 0.3` / `MAX_RELEASE_TAIL_SECONDS = 0.6`
  （仕様案1の「0.3〜0.6秒・profile.release と連動」をそのまま定数化）
- `resolveReleaseTailSeconds(profileRelease, noteDurationSeconds)`
  = 余韻スライダー（0〜1）で 0.3〜0.6 秒を線形に選ぶ
- **短い音符は音符自身の長さまでに抑える**（下限 `SHORT_NOTE_MIN_TAIL_SECONDS = 0.12` 秒）。
  16分音符に 0.45 秒の尻尾を丸ごと付けると、速いパッセージで前の音の尻尾が積み重なって濁る
  （仕様案3「濁りすぎない」への対処。同時発音数の上限・同音の切替は今回のスコープ外）

### 各音源への配線

- **SoundFont**（`SoundFontEngine.buildPlaybackOptions`）:
  `release` を共通計算の値にし、`duration` は**記譜どおり**へ戻した。
  以前は `duration + release×0.15` と短い `release` の合わせ技だったが、
  全音符でも尻尾が 0.3 秒に届かなかった。尻尾を `release` 側へ一本化することで、
  「ダンパーが降りる時刻＝音価」「そのあとに尻尾」という素直な形になる
- **内蔵音源**（`SimpleAudioEngine`）: 音色ごとの `tailSeconds`（ギターの残響感など**その楽器の個性**）と
  共通の下限の**長い方**を採る（`resolveEffectiveTailSeconds`）。
  個性として長い尻尾を持つ音色（ギター 0.3秒など）はその長さのまま維持される。
  エンベロープの終端と `oscillator.stop()` は元から `duration + tailSeconds` を見ているので、
  尻尾の値を差し替えるだけで「音価の終わりで即カットしない」形になる
- **Safari 向けの簡易発音経路**（`playSafariSafeVoice`）にも同じ尻尾を入れた。
  ここだけ短いと Safari でだけ長い音がプツンと切れる

## 影響範囲

- `src/audio/releaseTail.ts`（新規・純粋関数）／`src/audio/releaseTail.test.ts`（新規・3件）
- `src/audio/SoundFontEngine.ts`: `buildPlaybackOptions` の `release` / `duration`
- `src/audio/SimpleAudioEngine.ts`: `resolveEffectiveTailSeconds` を追加し、
  `playNote` / `playNoteAtTime` / `playSafariSafeVoice` の3経路で使う
- `src/audio/releaseTailEngines.test.ts`（新規・5件。両音源の尻尾とスライダー連動）
- `README.md`: 「余韻」スライダーの説明

## 受け入れ条件との対応

| 受入 | 対応 |
| --- | --- |
| 1. 全音符の停止が即断ではなくリリース減衰になる | 両音源とも鳴り終わりが `音価 + 尻尾` に。テストで `oscillator.stop` の時刻と SoundFont の `release` を固定 |
| 2. 開始タイミング・小節の進行は完全に不変 | 変更したのは終端だけ。既存の再生タイミング系テスト（`src/audio` 218件）が全緑 |
| 3. profile.release スライダーが尻尾の長さに効く | 0→0.3秒・1→0.6秒。両音源のテストで固定し、実機でも確認 |

## 実機確認（2026-09-01・worktree の一時エントリ経由）

`AudioBufferSourceNode` / `OscillatorNode` の `start` / `stop` にフックを掛け、
全音符（BPM120 ＝ 2.0秒）1つの譜面を再生して「実際に何秒鳴らす予約をしたか」を測った。

| 音源 | 余韻スライダー | 実測（start→stop） | 期待 |
| --- | --- | --- | --- |
| SoundFont | 0.50（既定） | 2.450 秒 | 2.0 ＋ 0.45 |
| SoundFont | 1.00 | 2.600 秒 | 2.0 ＋ 0.6 |
| 内蔵音源 | 1.00 | 2.600 秒 | 2.0 ＋ 0.6 |

開始時刻は 3 回とも記譜どおりで、コンソールエラーなし。

## 今後の課題（このIssueのスコープ外）

- 同時発音数の上限・同音連続時の前の尻尾の切替（仕様案3の残り）。
  短い音符の尻尾を抑える形で暫定対処しているが、和音の連打では重なりが増える
- 尻尾の形（減衰カーブ）は既存のエンベロープのまま。実ピアノのダンパー特性に寄せるなら別途調整が要る


## 追記（round 1/2 レビュー対応・2026-09-01）

- **短音の上限（round1/2 P2）**: 音色固有の `tailSeconds`（ギター等）も含め、実効の尻尾は
  `min(max(音色固有, 共通計算), max(0.12, 音符長))`。長い音符では音色の個性を維持し、
  短い音符では音符長までに抑える（速いパッセージの濁り防止）。
- **エンベロープの終端点（round1/2 P2）**: 3経路（時刻指定・即時・Safari簡易）すべてで
  「attack → decay → **音価終端（releaseFloor の明示点）** → 尻尾で 0.0001」の形。
  短音では attack/decay の時刻を `clampEnvelopeTimes` で音価終端までに収める
  （Web Audio の点は時刻順評価のため、終端より後ろに attack が並ぶと音量が再上昇する）。
- **stopAll の設計（round1/2 P1）**:
  - 内蔵音源: Safari 簡易経路の音も台帳（this.oscillators）へ**登録のみ**行い
    （trackOscillatorsForStop。registerOscillators は配線まで行うため二重配線になる）、
    stopAll が尻尾ごと停止できる。
  - SoundFont: sample-player の stop はリリースを鳴らし切るため、**出力経路の世代交代**で
    即時消音する（旧マスターゲインを destination から切断＝旧音の尻尾は行き場を失う。
    旧マスターへ配線済みの player キャッシュは捨て、次の再生で作り直す。音源データは
    HTTP キャッシュが効く）。ゲインを下げて戻す方式は、戻した瞬間に尻尾が再び聞こえるため不採用。
    - **世代番号（round3 P1）**: stopAll のたびに outputGeneration を進め、非同期の
      player 作成が完了した時点で世代が違えばキャッシュせず新世代で作り直す
      （停止をまたいだ読み込みが「切断済みマスター配線の無音 player」を残す競合の防止）。
    - **先読み（round3 P2）**: stopAll 直後に現在の楽器を裏で読み込み直し、
      「停止→再生」の再作成待ち（読込・デコード・構築）をユーザーの操作間隔で隠す。
- **配線テスト（round1 P3）**: ScorePageReleaseSliderWiring が「音の余韻」スライダー→
  エンジン setSoundProfile の受け渡しを実マウントで固定。
