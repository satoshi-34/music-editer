# SoundFont 既定パックの整理 — Issue #551

関連: #549（ペダル再生）/ #550（長い音の減衰カーブ）。
本メモは「どのパックを既定にするか」だけを扱い、減衰カーブそのもの（#550）や
ペダルによる持続（#549）には踏み込まない。

## 問題

運用者検聴（2026-09-01）で、ピアノの全音符が早くフェードすることが指摘された。
その環境の SoundFont パックは `FluidR3_GM` で、`MusyngKite` へ手動で切り替えると
持続が明確に改善した（「音違うね」）。

Issue 本文では「コード上の既定は MusyngKite だが、運用者環境・レビュアーのブラウザペイン双方が
FluidR3_GM に設定されていた（過去の音声デバッグ時に変更された可能性）」と推測されていた。

### 調査結果: 推測は誤りで、既定そのものが `FluidR3_GM` だった

`main`（`50a4a28`）時点の実装を確認した。

| 場所 | 値 | 役割 |
| --- | --- | --- |
| `src/audio/playbackSettings.ts` の `DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.pluginName` | **`FluidR3_GM`** | 保存データが無い新規環境で最初に選ばれるパック |
| `src/audio/SoundFontEngine.ts` の `DEFAULT_SOUNDFONT_NAME` | `MusyngKite` | 空文字・未知の名前が来たときの**フォールバック** |

「既定は MusyngKite」と読めていたのは後者（フォールバック）で、
実際に新規環境へ入るのは前者の `FluidR3_GM` だった。
`git blame` では `eb2843d`（2026-05-04「fix: 音色の既定値をFluidR3_GMへ変更」）で
意図的に `FluidR3_GM` へ変更されており、**どこかが勝手に自動設定していたわけではない**。
つまり運用者環境・レビュアー環境が `FluidR3_GM` だったのは、
デバッグ時の変更ではなく単に既定値をそのまま使っていたためと説明できる。

## 修正設計

### 1. 新規環境の既定を `MusyngKite` へ戻す

`DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.pluginName` を `MusyngKite` にする（`engineMode` は `soundfont` のまま）。
`eb2843d`（engineMode: built-in → soundfont と pluginName: 空 → FluidR3_GM の両方を変更し、
SoundFont を選ぶ理由はコメントに残している）のうち**パック名の部分だけ**を戻す。
FluidR3_GM を MusyngKite より選んだ理由は残っておらず、今回は運用者検聴という
具体的な根拠（ピアノの持続）があるため、そちらを採る（round1 P3 で記述を訂正）。

### 2. 既存ユーザーの設定は書き換えない

既定値は「保存データがまだ無い環境」にしか効かない。
`ScorePage` は `localStorage` の値を `sanitizePlaybackRuntimeSettings` に通して読むが、
`pluginName` が文字列であればその値をそのまま保持する（既定へ寄せるのは非文字列のときだけ）。
そのためマイグレーションも通知も行わない（Issue のやること3）。

なお `音声復旧`（`resetAudioSettingsToSafeDefaults`）はユーザーが明示的に押したときだけ
既定値を `localStorage` へ書き戻すため、この経路では復旧後のパックが `MusyngKite` になる。
これは「安全な既定へ戻す」という当該機能の意図どおりで、勝手な書き換えには当たらない。

### 3. 説明文に「ピアノの持続は MusyngKite 推奨」を一言だけ足す

`PlaybackControls` の SoundFont パック名入力欄の下にある説明文（#318 の範囲）へ 1 文を追記する。
UI 要素の追加・構造変更は行わない（受入条件2）。

## 受入テスト

| 受入条件 | 固定するテスト |
| --- | --- |
| 1. 新規環境の既定が `MusyngKite` | `src/audio/playbackSettings.test.ts`「新規環境の既定 SoundFont パックは MusyngKite」 |
| （やること3の裏取り） | 同ファイル「既存ユーザーが保存済みのパック名（FluidR3_GM）は既定へ書き換えない」 |
| 2. 説明文の追記のみで UI 構造は不変 | `src/components/PlaybackControls.test.tsx`「音色詳細を開くと MusyngKite 推奨の一言が説明文に出る」（推奨文の存在＋パック名入力欄が1個のまま） |

## 影響範囲

- `src/audio/playbackSettings.ts`: 既定パック名のみ変更。型・関数の signature は不変
- `src/components/PlaybackControls.tsx`: 既存の説明文 `div` に 1 文追記のみ
- 既定値を参照する箇所（`SoundFontEngine` / `SimpleAudioEngine` の初期プロファイル、`ScorePage` の初期化・音声復旧）は
  `profile` と `engineMode` を使っており、`pluginName` を見るのは `createPlaybackEngine`（＝どのパックを読み込むか）だけ
- `MusyngKite` は `KNOWN_SOUNDFONT_NAMES` に含まれるため、`resolveSoundFontName` の警告経路には入らない
- ドキュメント: `docs/DEVELOPMENT.md` の SoundFont 実装の記述を更新。README は
  ユーザー向けの操作・画面の説明にパック名を書いていないため変更なし

## 残る論点（本 Issue のスコープ外）

- 長い音の減衰カーブそのものの調整は #550。#549（ペダル再生）の実装後に再判定する順序で裁定済み
- `resetAudioSettingsToSafeDefaults` の `alert`・DEVELOPMENT.md は「built-in のピアノへ戻す」と
  書いていたが、実際に戻るのは `soundfont`（MusyngKite）。この PR が変更する定数の直接利用箇所の
  ため、round1 P2 を受けて**案内・文書を実挙動（SoundFont/MusyngKite）へ統一**した
