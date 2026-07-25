# lint ラチェット（逆戻り防止）設計書

対象 Issue: #73「lintエラー353件の削減とラチェット化（増加をCIで拒否できる状態にする）」

## 1. 問題

`npm run lint` は main で **エラー353件・警告6件** が常態だった。夜間エージェントの PR は「変更前後で件数が同じこと」を合格基準にしていたが、この方式には次の弱点がある。

- 353件という大きな母数に紛れて、新しく入った1〜2件の問題を人間が見つけられない
- 「同数であること」を判定するのが人間の目視で、機械的に強制されていない
- ゼロでない限り `npm run lint` の終了コード（エラーがあれば常に 1）は判定に使えない

一方で、353件を一気にゼロにするのは現実的ではない。大半が `@typescript-eslint/no-explicit-any`（314件）で、型を正しく付ける作業は挙動変更のリスクを伴い、1晩の作業単位に収まらない。

## 2. 方針: ラチェット（爪車）方式

「今の件数を上限として記録し、**増えたら失敗・減ったら上限を締め直す**」という一方向のみに進む仕組みにする。

- 上限を超えたら終了コード 1 → CI や夜間ルーチンの合格基準として機械的に使える
- 下回ったら基準値を自動更新 → 減らした成果がそのまま次回の上限になり、元に戻せなくなる
- ゼロを要求しない → 既存の技術的負債を抱えたままでも今日から導入できる

## 3. 実装

### 3.1 構成

| ファイル | 役割 |
| --- | --- |
| `scripts/lint-ratchet.mjs` | eslint を JSON 形式で実行し、エラー件数を基準値と比較する |
| `scripts/lint-baseline.json` | 基準値（`maxErrors`）を保持する。減ったときスクリプトが自動で書き換える |
| `package.json` の `lint:ratchet` | `node scripts/lint-ratchet.mjs` を呼ぶ入口 |

### 3.2 判定の流れ

1. `npx eslint . -f json` を実行する。**終了コードは見ない**（eslint はエラーが1件でもあれば 1 を返すため、件数の判定には使えない）。判定は JSON の中身だけで行う
2. `severity === 2` を数えてエラー件数、それ以外を警告件数とする
3. `scripts/lint-baseline.json` の `maxErrors` と比較する
   - 超過 → ルール別の内訳を出力して終了コード 1
   - 下回る → 基準値を新しい件数へ書き換えて終了コード 0
   - 一致 → 終了コード 0

### 3.3 実装上の注意点

- **`maxBuffer` を 64MB に拡張している**: eslint の JSON 出力は数MBになり、Node の既定（1MB）では途中で切れて JSON.parse に失敗する
- **JSON として読めない場合は終了コード 2 で異常終了する**: eslint 自体が設定エラーで落ちたケースを「エラー0件」と誤読して素通ししないため。合格（0）とも件数超過（1）とも区別できるようにしてある
- **`--check` オプション**: 基準値を書き換えずに判定だけ行う。CI で基準値ファイルが勝手に変わるのを防ぐ用途

## 4. 今回の削減内容（353 → 326、27件）

`eslint --fix` で自動修正できるものは実質1件だけだった（`no-explicit-any` などは自動修正の対象外）。そのため、**挙動に影響しないルールに限定して手作業で修正した**。

| ルール | 件数 | 対応 |
| --- | --- | --- |
| `@typescript-eslint/no-unused-vars` | 20 | 未使用の import・変数の削除。詳細は下記 |
| `jsx-a11y/no-autofocus` ほか | 0 | 未対応（挙動・UXに関わるため別Issue） |
| `no-empty` | 3 | 空の `catch {}` に「なぜ握りつぶしてよいか」の日本語コメントを追加（`no-empty` はコメントを含むブロックを空とみなさない） |
| `no-useless-escape` | 2 | 文字クラス内の不要なエスケープ `[\/\s]` → `[/\s]`（正規表現の意味は同一） |
| 不要な eslint-disable ディレクティブ | 1（警告） | `PianoSystemCanvas.tsx` の `eslint-disable-next-line react-hooks/exhaustive-deps` を削除。**次の行がコメント行だったため、そもそも何も抑制していなかった**（deps 配列は完備している） |

`no-explicit-any`（314件）は今回のスコープ外とした。型を付ける作業は挙動変更のリスクがあり、1晩1Issueの粒度を超えるため。

### 4.1 未使用変数の内訳と判断

- **未使用 import の削除**（テストファイル中心）: `Tone` / `SoundSource` / `AudioEngine` / `PlaybackState` / `ScorePlaybackOptions` / `NoteEvent` / `TempoSettings` / `TempoChangeCallback` / `vi` など。`vi.mock('tone', ...)` は import 無しで動くため、モックの動作には影響しない
- **死んだ変数の削除**: `mockContext`（代入のみで一度も読まれていない）、`callCount`（インクリメントのみで検証に使われていない、2箇所）
- **暗黙のアサーションを明示化**: `PlaybackControls.test.tsx` の `const instrumentSelect = screen.getByLabelText('楽器選択')` は、変数こそ未使用だが `getByLabelText` が見つからないと例外を投げるため「要素が存在すること」の検査を兼ねていた。単純に削除すると検査が1つ減るので、`expect(...).toBeInTheDocument()` へ書き換えて意図を残した
- **未使用の引数の削除**: `midiExport.ts` の `buildNoteTrack` の第6引数 `_globalTimeSig`。モジュール内部の関数で呼び出し元が1箇所しかないため、引数ごと削除した（拍子情報はテンポトラック側の `timeSig` で出力しており、ノートトラックでは元々使っていなかった）
- **`ignoreRestSiblings: true` の追加**（唯一の設定変更）: `voiceMeasureUtils.ts` の `flattened.map(({ voiceIndex, ...event }) => event)` は「あるキーだけ取り除いた残りを作る」定型句で、取り除く側の変数を使わないのは当然である。ESLint 本体の `no-unused-vars` では既定で有効な設定だが、`@typescript-eslint` 版では既定で無効なため明示的に有効化した。**件数を減らす目的の抑制ではなく、この定型句を正しく扱うための設定**であり、影響は1件のみ

## 5. 影響範囲

- **アプリの挙動は変更していない**。修正はすべて未使用コードの削除・コメント追加・正規表現の等価な書き換えに限られる
- `npm run build`（`tsc -b && vite build`）成功
- `npx vitest --run src`: 1158件中1154件成功。失敗4件（`ScorePageEmptyStaveFiller.test.tsx`）は **本ブランチの変更前から main で同一に失敗している既存問題**で、同じ worktree で変更を stash して再実行し同一の4件が失敗することを確認済み（期待値が Issue #49 以前の「既定8段/ページ」時代のまま。PR #84 で修正が進行中）

## 6. 今後

1. `no-explicit-any` 314件を、ファイル単位・領域単位で少しずつ減らす（1晩1Issueの粒度に分割する）
2. `jsx-a11y/no-autofocus`（8件）・`react-refresh/only-export-components`（6件）は、挙動やコンポーネント分割に関わるため個別に検討する
3. 夜間ルーチンの合格基準を「lint 件数が main と同数」から「`npm run lint:ratchet` 成功」へ置き換える（`.claude/scheduled-tasks/*/SKILL.md` の更新。運用者の判断が必要なため本PRのスコープ外）
4. CI を導入する際は `npm run lint:ratchet -- --check` を使い、基準値ファイルが CI 上で書き換わらないようにする
