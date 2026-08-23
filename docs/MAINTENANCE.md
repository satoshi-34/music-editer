# MAINTENANCE.md — AI が使えないときの修理ガイド

この文書は、**AI の助けなしで**このアプリの不具合を調べて直すための入口です。
コードを日常的に読まない人（運用者・家族の共同利用者）が「症状 → どこを見るか → どう確認するか」を辿れることを目的にしています。

- 開発環境の作り方・コマンド一覧は [DEVELOPMENT.md](DEVELOPMENT.md)（ここだけ読めば動く節あり）
- 手動の回帰チェック手順は [REGRESSION.md](REGRESSION.md)
- 機能ごとの設計の正本は `.claude/specs/<領域>/design.md`（下の索引を参照）

## 0. 直す前の3点セット（毎回これから）

```bash
docker compose up -d
docker exec -w /app music-editer-dev npx vitest run
docker exec -w /app music-editer-dev npm run lint:ratchet
```

- テストが**すでに赤**なら、壊したのは直近の変更。`git log --oneline -10` で直近コミットを見て、`git revert <コミット>` が最短の復旧
- テストが緑なのに画面がおかしいなら、下の「症状→場所」表へ
- lint:ratchet は「エラーを今より増やさない」仕組み。基準値ちょうど（`OK` 表示）なら合格

## 1. 症状 → 見る場所の対応表

| 症状 | まず見るファイル | 設計メモ |
| --- | --- | --- |
| クリックしても音符が置けない・変な場所に入る | `src/editor/hitResolution.ts`（当たり判定の座標計算）と `src/components/PianoSystemCanvas.tsx` のクリックテーブル（「段3c」で検索） | `editor-state-refactor` §2-3 |
| クリックで何も起きないのに**通知も出ない** | クリックテーブルの `rejected`/`handled` の分岐（無言の行き止まりは型で禁止されている。例外は理由コメント付き） | `dead-end-speaks` |
| 譜面の描画が崩れる（音符・連桁・連符） | `buildPartVoicesForMeasure`（PianoSystemCanvas 内、「Pass 1」で検索）。連桁の束ね方はこの関数の中だけにある | `editor-state-refactor` §2-4 / `cross-staff-notation` |
| 右手・左手の拍が縦に揃わない | `formatSystemColumnVoices`（「Pass 2」で検索） | 同上 |
| 強弱・ペダル・歌詞などの**記号**が出ない/ずれる | `drawCollectedSymbolEntries`（記号13種の最終描画）と `RenderCollectors`（記号の収集器） | `editor-state-refactor` §10 |
| 段またぎ（⇵）の音符がおかしい | `src/utils/crossStaffBeamUtils.ts` と `buildPartVoicesForMeasure` の段またぎ分岐 | `cross-staff-notation` |
| 声部2（下声）のデータが消える・ずれる | `src/utils/voiceMeasureUtils.ts`（events と voices の正規 API）。**編集後は常に events ≡ voices[0]** が約束（テスト: `primaryVoiceMirrorInvariant.test.ts`） | `editor-state-refactor` §2-5・§11・§12 |
| 移調楽器の音高が保存でずれる | `src/utils/displayTransposeUtils.ts`（表示⇄保存の対変換。keys・弧・前打音・全声部が対象） | `editor-state-refactor` §11 |
| 保存/読込がおかしい | `src/utils/storage.ts`（検証・正規化・保存時同期） | `save-load-redesign` / `multi-score-storage` |
| 再生の音・タイミングがおかしい | `src/audio/ScorePlayer.ts` / `flattenMeasureForPlayback`（voiceMeasureUtils） | `swing-playback` ほか |
| タイ・スラーのドラッグや選択が変 | PianoSystemCanvas の弧まわり（`arcDragContextRef` で検索）と `clickCycleUtils` | `click-target-cycling` / `voice2-arc-support` |

ファイル内の検索は「段3c」「Pass 1」「#244」など**コメント内のキーワード**が目印になるよう書いてある。

## 2. 直し方の型（この順で）

1. **再現手順を最小化する**（何小節目・どのツール・どの声部か）。`docs/REGRESSION.md` の手順に似た症状があればそれに従う
2. **対応表から該当ファイルを開き、コメントを読む**。このリポジトリのコメントは「なぜこうなっているか」「昔どう壊れたか（Issue 番号）」を書いてあるので、コメントだけで原因の見当がつくことが多い
3. **テストを先に書く（または既存テストを走らせる）**。該当ファイルの隣の `*.test.ts` が仕様のカタログになっている
4. 直したら3点セット（テスト・lint:ratchet・`npm run build`）→ ブラウザで実物確認 → [REGRESSION.md](REGRESSION.md) の該当節
5. **設計メモに記録を残す**（AGENTS.md の規則）: 問題・修正設計・影響範囲・経緯を `.claude/specs/<領域>/design.md` へ。これを怠ると次に直す人（未来の自分）がまた迷う

## 3. データの救出

- 譜面データはブラウザの **localStorage** に入っている。開発者ツール → アプリケーション → ローカルストレージ → `http://localhost:5173`
- アプリ内の「書き出し」で JSON ファイルに退避できる。**大きな修正の前には必ず書き出しておく**
- 保存データが壊れて開けないときは、読込側の正規化（`storage.ts` の `validateSavedScoreData` 付近）が守ってくれるのが正常。開けないほど壊れているなら、書き出した JSON をテキストエディタで開き、`parts[].measures[]` の該当小節を削って読み直すのが最終手段

## 4. 設計メモ（.claude/specs/）の読み方

60以上あるが、全部読む必要はない。**いま効いている大物**はこの3つ:

1. **`editor-state-refactor/`** — 2026-08 の大規模整理（#244）の正本。エディタの状態・クリック・描画・データモデルの現在の構造はすべてここ。§番号は本ガイドの表からも参照している
2. **`cross-staff-notation/`** — ピアノの段またぎ記譜（⇵）の設計と落とし穴
3. **`piano-two-voice-implementation/` + `voice2-arc-support/`** — 2声部（上声/下声）の仕組みと弧の索引の約束

それ以外は「機能名 = ディレクトリ名」なので、症状の機能名で探せばよい。各 design.md の末尾に**実装記録**（いつ・何を・なぜ）が積んである。

## 5. やってはいけないこと（過去の事故から）

- `measure.events` を**直接書き換えない**（push/splice/代入）。必ず `withVoiceEventsUpdated` を通す。直接書くと声部データ（voices[0] の鏡）が古いまま残る（#244 段5-1）
- 表示用データと保存データを混ぜない。記譜音モードの変換は `displayTransposeUtils` の**対**を必ず両方向で通す
- `git reset --hard` や `git checkout <ファイル>` で「一時的な変更」を戻さない — 未コミットの本修正まで消える。一時改変の復元は cp でバックアップを取ってから
- テストが赤のままコミットしない。lint:ratchet の基準値も増やさない
