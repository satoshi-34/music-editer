# CI（GitHub Actions）設計書

対象 Issue: #115（トリアージで (A) CI整備 に範囲を絞った部分）

## 1. 問題

`.github/workflows` が1つも存在せず、PR の検証（テスト・lint・build）は毎回レビュアーが手元の Docker で実行していた。機械的な保証が無いため、2026-07-28 に PR #118 と PR #119 が個別のブランチ上ではそれぞれ緑だったにもかかわらず、合流した `main` でのみ3件のテストが失敗する事故が起きた（変更行が重ならずコンフリクトにならない「意味的なコンフリクト」。修正: PR #123）。CI があればマージ直後に検出できていた。

## 2. 修正設計

`.github/workflows/ci.yml` を追加し、`pull_request` と `main`・`release` への `push` をトリガーに以下をこの順で実行する。

1. `actions/checkout@v4`
2. `actions/setup-node@v4`（`node-version: 20`。`Dockerfile` の `FROM node:20-slim` に合わせた）
3. `npm ci`
4. `npm test`（`vitest --run`。`package.json` の `test` スクリプト）
5. `npm run lint:ratchet -- --check`（`--check` を付け、CI 実行のたびに `scripts/lint-baseline.json` が書き換わるのを防ぐ。減った分の基準値更新は、人がローカルで実行してコミットする既存フローのまま）
6. `npm run build`（`tsc -b && vite build`。型エラーもここで検出する）

各ステップを個別の `steps` に分けているため、失敗時にどの段階か GitHub の Checks 画面から一目で分かる。

### スコープ外にした理由

トリアージコメントの通り、以下はこの Issue には含めない。

- ブラウザでの4譜種（単旋律・ピアノ・弦楽四重奏・編成譜）動作確認
- 代表譜面のスクリーンショット比較

理由は実行時間とフレーキーさ（不安定さ）の見極めが別途必要なため。CI が定着してから別Issueで検討する。

## 3. 影響範囲

- 新規ファイル `.github/workflows/ci.yml` のみ。既存のビルド・テスト・lint スクリプトや Docker 開発フローには変更を加えていない
- README.md に CI セクションを追記（何を・いつ実行するか、スコープ外の説明）
- ローカルの Docker 開発フロー（`docker exec music-editer-dev ...`）はこれまでどおり使える。CI は置き換えではなく追加のセーフティネット

## 4. 動作確認

- ワークフロー追加前に、同じ3コマンド（`vitest --run src`・`lint:ratchet -- --check`・`build`）をこの worktree 内で Docker 経由で実行し、いずれも成功することを確認した
- CI が実際に赤くなることの確認は、PR 側でテストを1件意図的に壊したコミットを push し、GitHub Actions の実行結果が failure になることを確認してから元に戻す形で行った（証跡は対象 PR に記載）
