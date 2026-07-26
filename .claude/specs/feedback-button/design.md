# 設計書: アプリ内フィードバックボタン

対象 Issue: #91「アプリ内フィードバックボタン（譜面データ・設定・画面状態を添えてIssue下書きを1タップ生成）」

## 1. 問題

今後の改善サイクルは「運用者が楽譜を書きながら気づいたことを直す」形になるが、不具合報告の手間（スクショ・状況説明・再現手順の往復）が運用者のボトルネックになっていた。報告コストを1タップまで下げ、報告に再現可能な状態を自動添付したい。

## 2. 修正設計

### 2.1 状態JSONの形式（既存のファイル保存形式との互換）

フィードバックJSONは、ファイル保存（`handleExportFile` → `createSavedScoreData()`）が生成するのと**全く同じトップレベル形式**をそのまま使い、そこへ次の2フィールドだけを追加する。

```
{
  ...createSavedScoreData() の全フィールド（version, timestamp, metadata, scoreType, keySignature,
      timeSignature, instrumentation, notationMode, parts, systems, measuresPerSystem,
      customSymbolDefs, systemMeasureOverrides, systemRowGapOverrides）,
  appVersion: string,   // ビルド時に埋めた git sha（vite.config.ts の define、取得不可時は 'dev'）
  viewState: {          // 画面表示状態。診断用の付加情報で、読込時には使われない
    viewZoom, notationSizeMultiplier, measureWidthEvenness,
    pageMarginSideMm, pageMarginTopMm, pageMarginBottomMm,
    systemRowGapPx, displayWeight, isPrintPreview,
  }
}
```

`src/utils/storage.ts` の `validateSavedScoreData()` は既知のフィールドの型だけを検証し、未知のフィールド（`appVersion` / `viewState`）があっても無視して通す。そのため、この状態JSONをそのまま `.score.json` として保存し「ファイルを開く」（`handleImportFile` → `importScoreFromFile` → `validateSavedScoreData`）に読み込ませると、追加の変換なしに譜面・設定（メタ情報・調号・拍子・パート編成・カスタム記号・段/段間隔の手動上書き）が再現される。`viewState`（ズーム等の表示状態）は診断用の添付情報であり、インポート処理には読まれない（受入条件が求めるのは「譜面・設定の再現」であり、表示状態の自動復元までは要求していない）。

### 2.2 ビルド時 git sha 埋め込み

`vite.config.ts` に `define: { __APP_GIT_SHA__: JSON.stringify(resolveGitSha()) }` を追加。`resolveGitSha()` は `git rev-parse --short HEAD` を試み、失敗（`.git` が無い・`git` コマンドが無い等）した場合は `'dev'` にフォールバックする。Docker イメージは `.dockerignore` で `.git` を除外しているため、`docker build` でイメージに焼き込む場合は常に `'dev'` になるが、本プロジェクトの開発コンテナは `docker-compose.yml` の `volumes: - .:/app` でリポジトリ全体（`.git` 込み）をバインドマウントしているため、`npm run dev` / `npm run build` を worktree 内で実行する通常運用では実際の git sha が解決される。型は `src/vite-env.d.ts` に `declare const __APP_GIT_SHA__: string` を追加して宣言している。

### 2.3 UI・フロー

その他タブの「PDF書出 / 印刷」ボタンの隣に「フィードバック」ボタンを追加（`ScorePage.tsx`）。押すと `handleFeedback()` が次を行う。

1. `buildScoreData()` + `createSavedScoreData()` で状態JSON（2.1）を組み立てる
2. `navigator.clipboard.writeText(json)` でクリップボードへコピー
3. `window.open('https://github.com/satoshi-34/music-editer/issues/new?template=feedback.md', '_blank')` でIssue下書き画面を新しいタブで開く
   - `noopener` は使わない: 指定すると `window.open()` の戻り値が仕様上常に `null` になり、ポップアップブロックの検知ができなくなるため。代わりに開いた直後に `popup.opener = null` を代入し、リバースタブナビング対策とブロック検知を両立させる
4. 結果をボタン脇の通知（`role="status"`）で必ず伝える。無言で失敗させない（Issue #66のポップアップブロック対策と同じ配慮）
   - クリップボードコピー失敗（権限拒否等）→ エラー表示（自動では消さない。見落とすと再試行されないため）
   - `window.open` がブロックされ `popup` が `null` → 開くべきURLを案内するエラー表示（自動では消さない）
   - 両方成功 → 5秒で消える成功通知

状態JSONには譜面内容（曲名・歌詞等）が含まれ、公開リポジトリへ投稿されるため、ボタンの `title`（ツールチップ）とIssueテンプレート本文の両方にその旨を明記した。

### 2.4 Issueテンプレート

`.github/ISSUE_TEMPLATE/feedback.md` を新規追加。「現象」「期待していた動作」「状態JSON」の3セクション。`ai-ready` ラベルは付けない（トリアージは人間/レビュアーが行う運用のため）。

## 3. 影響範囲

- `vite.config.ts`: `execSync` で git sha を解決する `resolveGitSha()` と `define` を追加
- `src/vite-env.d.ts`: `__APP_GIT_SHA__` のグローバル型宣言を追加
- `.github/ISSUE_TEMPLATE/feedback.md`: 新規追加
- `src/components/ScorePage.tsx`:
  - `feedbackNotice` / `feedbackNoticeTimerRef` の state を追加
  - `handleFeedback()` を追加（`handleExportFile` と同じ理由で、`totalSystems` / `measuresPerSystem` の後方宣言による TDZ を避けるため通常関数として定義）
  - その他タブに「フィードバック」ボタンと通知表示を追加
- `src/components/ScorePageFeedback.test.tsx`: 新規追加。クリップボードコピー・Issue下書き画面オープン・`validateSavedScoreData` による往復互換・ポップアップブロック時のフォールバック・クリップボード失敗時のフォールバックを検証
- 依存ライブラリの追加はなし

## 4. 既知の制限・今後の課題

- `viewState` の内容（ズーム・音符の大きさ等）は「ファイルを開く」では復元されない。診断用の付加情報として人間が読むことのみを想定している。将来的に表示状態まで往復させたい場合は、`handleImportFile` 側に `viewState` を読んで各 setter へ反映する処理を追加する必要がある
- クリップボード書き込み失敗時、JSON本文そのものをダイアログ等で提示するフォールバックまでは実装していない（エラーメッセージでの案内のみ）。運用上の必要が出た場合に追加を検討する
