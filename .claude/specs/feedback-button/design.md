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

## 3.5 追補: ヘッダーのタブ行右端へ常設（Issue #142・2026-08-01）

### 問題

上の 2.3 で「その他」タブ内（PDF書出/印刷の隣）に置いたが、これは分類ミスだった。

- フィードバックは譜面操作ではなく**アプリへのメタ操作**であり、ファイル入出力の並びに埋もれている
- 何より、この機能は**押した時点の表示状態（`viewState`）をJSONへ写して送る**仕様のため、
  「困った画面から『その他』タブへ移動してから押す」と、移動によってツール選択などの表示状態が
  変わってしまい、報告に添える再現情報が劣化する（タブ切替は `handleToolbarTabChange` で
  `tool` state をリセットする）

### 修正設計

Issue #114 の 2026-07-29 コメント「フィードバックボタンの配置」の仕様どおり、ヘッダーの
タブ行の右端へ移した。

- `.toolbar-tabs`（`role="tablist"`）を新しい `.toolbar-tab-row` でくるみ、その右端に
  フィードバックボタンと結果通知（`role="status"`）を置いた。JSXの移動のみで、
  `handleFeedback()` の処理・状態JSONの中身は一切変更していない
- **タブとは見た目を分ける**（7個目のタブに見せない）。`role="tab"` を付けない
  （`tablist` の外に出す）ことに加え、専用クラス `.toolbar-feedback-button` で
  ピル型（`border-radius: 999px`）・琥珀色の枠と背景・先頭に 💬 アイコン、という
  タブボタン（四角い白ベースの `.toolbar-tab-button`）と明確に異なる見た目にした。
  アイコンは `aria-hidden` にし、`aria-label="フィードバック"` で読み上げ名は元のまま保つ
- 折り畳み（Issue #125）中はタブ行ごと隠れる。CSS の
  `.toolbar.collapsed .toolbar-tabs` を `.toolbar-tab-row` へ差し替えただけで、
  折り畳み仕様自体は変えていない
- 狭い画面（`max-width: 768px`）では、従来 `.toolbar-tabs` に付けていた `width: 100%` を外し、
  代わりに `flex: 1 1 auto; min-width: 0;` にした。100% のままだとフィードバックが
  次の行へ押し出され、「タブ行の右端」でなくなるため

### 影響範囲

- `src/components/ScorePage.tsx`: タブ行を `.toolbar-tab-row` でくるみ、フィードバック
  ボタンと通知を「その他」タブから移設
- `src/App.css`: `.toolbar-tab-row` / `.toolbar-feedback` / `.toolbar-feedback-button` /
  `.toolbar-feedback-notice` を追加。折り畳み時に隠す対象とレスポンシブ指定を更新
- `src/components/ScorePageFeedback.test.tsx`: 「その他」タブを開くヘルパーを削除し、
  「6タブすべてでボタンが見える・押せる」「`role="tab"` を持たずタブ数は6のまま」の
  2テストを追加
- `README.md` / `docs/DEVELOPMENT.md`: 置き場所の説明を更新

### ブラウザ確認で見つけて直した点

夜間worktreeでも共有dev サーバー（5173）に一時エントリHTMLを置く方法でブラウザ確認した
（`.claude/specs` 外の運用メモ。確認後にHTMLは削除済み）。そこで2点直している。

1. 通知が出るとフィードバックボタンが押し縮められ、ラベルが「フィードバ／ック」と
   2行に折れていた → ボタン側に `flex-shrink: 0; white-space: nowrap;`、通知側に
   `min-width: 0` を付け、縮むのは通知だけにした
2. 通知をボタンの後ろ（右）に置くと、通知が出るたびにボタンが左へずれて
   「タブ行の右端」から動いてしまっていた → JSXの順序を通知→ボタンに変え、
   ボタンの位置を固定した

なお、この一時エントリHTML経由では vite の `define`（`__APP_GIT_SHA__`）が適用されず、
ボタンを押すと `__APP_GIT_SHA__ is not defined` で `handleFeedback()` が途中終了する。
これはプレビュー方法側の制約（本来の `index.html` 経由では置換される）なので、確認時は
`globalThis.__APP_GIT_SHA__` を手で定義してから操作した。

### 検証

- `docker exec -w /app/.night-worktrees/issue-142 music-editer-dev npx vitest --run src`:
  1257 Tests中 1253 成功 / 4 失敗。失敗4件はすべて `Test timed out`（`ScorePageDefaultLayout` /
  `ScorePageInstrumentationEditor` / `ScorePagePartSpacing` / `ScorePageSettingsProfile`）で、
  変更前から `origin/main` で同じ4件がタイムアウトする既知のベースライン失敗（Issue #125 の
  追補に記録済みのものと同一）。新規テスト2件は単体・全体実行とも成功
- `npm run lint:ratchet`: エラー326件/警告5件で基準値ちょうど（変化なし）
- `npm run build`: `tsc -b && vite build` がエラーなく完走
- ブラウザ確認（1280×720 / 390×800・ピアノデモ譜）: 6タブすべてでボタンが右端に見えること、
  「その他」タブからボタンが消えていること、押すと状態JSON（22KB・`viewState` 11項目）が
  コピーされ Issue下書きURLが開くこと、成功通知が出て5秒で消えること、折り畳み中は
  タブ行ごと隠れること、390px幅でもタブだけが折り返してボタンは同じ行の右端に残ることを確認。
  コンソールエラーなし

### 受入条件のうち解釈を補足した項目

受入条件に「状態JSONに折り畳み等の表示状態が従来どおり含まれる」があるが、`viewState` に
折り畳み状態（`isToolbarCollapsed`）は**もともと含まれていない**。同じIssueに
「機能自体（状態JSONコピー→Issue画面を開く）は変更しない」と明記されているため、
この条件は「移設によって `viewState` の中身が欠けないこと」の意と解釈し、フィールドの
追加は行っていない（既存テストで `viewState` の存在を検証済み）。折り畳み状態を
JSONへ含めたい場合は別Issueで扱う。

## 3.6 追補: ツールバー折り畳み中も押せるようにする（Issue #150・2026-08-01）

### 問題

3.5 でタブ行の右端へ常設したが、折り畳み（Issue #125）中は
`.toolbar.collapsed .toolbar-tab-row { display: none }` でタブ行ごと隠れるため押せなかった。

常設化の理由（「困った瞬間に、タブ移動せずその表示状態のまま報告できる」）は、
**譜面だけを表示している折り畳み中にこそ当てはまる**。表示の不具合に気づくのは譜面を
見ているときであり、報告のために折り畳みを解除させると `viewState` も変わってしまう。

### 修正設計

#### 置き場所: 「折り畳み中だけ折り畳み行へ移す」を選んだ

Issue は「折り畳み中のみ折り畳み行に出す」か「常に折り畳み行に置きタブ行から外す」の
どちらでもよいとし、折り畳み行の混み具合を見て決めるよう求めていた。**前者**を選んだ。

- 後者はタブ行からボタンを外すことになり、「タブ行の右端へ常設する」という #142
  （仕様の正本は Issue #114 の 2026-07-29 コメント「フィードバックボタンの配置」）の
  設計を上書きしてしまう
- 折り畳み行は既に「画面表示のズーム」（#143 で移設）と折り畳みトグルが入っており、
  実測幅は 1280px 時点で ズーム231px + トグル132px。ここへ常時125pxのボタンを足すと
  狭い画面での折り返し余地がさらに減る。折り畳み中だけに出せば、展開中の折り畳み行は
  従来どおりの余裕を保てる

JSX は同じ内容を2か所に書かず、`feedbackControls`（通知＋ボタン）という1つの変数にして
置き場所だけを出し分けている。**同時に2か所へは描かない**（展開中はタブ行のみ、折り畳み中は
折り畳み行のみ）。ボタンが2個見えると混乱するのに加え、結果通知（`role="status"`）が
2つ存在すると支援技術に二重読み上げされるため。

#### 折り畳み帯の高さ（33px）を増やさないための3点

受入条件「折り畳み帯の高さが増えない（#125 の約33px）」を満たすため、ブラウザで実測しながら
次の3点を入れた。**いずれも実測で初めて分かった問題**である。

1. **結果通知は帯の中ではなく帯の下へ重ねて出す**（`.toolbar.collapsed .toolbar-feedback-notice`
   を `position: absolute; top: 100%`）。帯の中に流し込むと、長い文（特にポップアップ
   ブロック時のURL案内）が折り返して帯が **33px → 41px** に伸びた。
   省略記号で切る案は、エラー文（自動では消えない＝読んで対処してほしい文）の肝心のURLが
   読めなくなるため採らなかった。位置の基準は `position: fixed` の `.toolbar` 自身。
2. **狭い画面（≤768px）ではボタンをアイコン（💬）だけにする**。ラベル込み125pxのままだと
   ズーム・フィードバック・トグルの3つが1行に収まらず、帯が **33px → 69px** の2行になった。
   ラベルは `.toolbar-feedback-label` の span で包み CSS で隠す。読み上げ名は
   `aria-label="フィードバック"` のままなので支援技術から見た情報は減らない。
3. **スマートフォン幅（≤480px）ではズームの見出し文字も省く**。アイコン化だけでは 375px で
   まだ収まらなかった。スライダーと％は残すので #143 の「畳んだままでも拡大縮小できる」は
   保たれる。`<label>` のテキストを隠すとスライダーの読み上げ名が失われるため、
   `input` 側に `aria-label="画面表示のズーム"` を明示して名前を保っている。

トグルは押す位置を覚えられている操作なので、フィードバックはトグルの**手前**に置き
（`.toolbar-collapse-row .toolbar-feedback { margin-left: auto }`）、右端はトグルのまま動かさない。

#### 状態JSON・`handleFeedback()` は変更していない

Issue の指示どおり処理には触れていない。なお Issue 本文の「viewState に折り畳み状態が
含まれること（既存の挙動）を維持する」については、3.5 の「受入条件のうち解釈を補足した項目」の
とおり **`viewState` に `isToolbarCollapsed` はもともと含まれていない**。本Issueにも
「状態JSONは変更しない」と明記されているため、フィールドの追加は行っていない。
受入条件「状態JSONは折り畳んだままの表示状態を反映」は、**折り畳みを解除させずに押せる＝
押した時点（折り畳み中）の `viewState` がそのまま入る**という意味で満たしている。

### 影響範囲

- `src/components/ScorePage.tsx`: `feedbackControls` 変数を追加し、タブ行／折り畳み行へ
  出し分け。フィードバックのラベルを `.toolbar-feedback-label` の span で包み、
  ズームの見出しを `.toolbar-view-zoom-label` の span で包んで `input` に `aria-label` を追加
- `src/App.css`: `.toolbar-collapse-row .toolbar-feedback`（右寄せ）、
  `.toolbar.collapsed .toolbar-feedback-notice`（帯の下へ重ねる）、
  ≤768px のアイコン化、≤480px のズーム見出し省略を追加
- `src/components/ScorePageCollapsedFeedback.test.tsx`（新規）: 折り畳み中に押せて
  状態JSONが従来どおり作られること／通知が折り畳み行側に出ること／ボタンは常に1個で
  展開中はタブ行・折り畳み中は折り畳み行にあり、トグルが右端のままであること
- `README.md` / `docs/DEVELOPMENT.md`: 折り畳み中も使える旨を追記

### 検証

- `docker exec -w /app/.night-worktrees/issue-150 music-editer-dev npx vitest --run src`:
  失敗は `ScorePageDefaultLayout` / `ScorePageInstrumentationEditor` / `ScorePagePartSpacing` /
  `ScorePageSettingsProfile` の `Test timed out` のみで、同じ時間帯に `origin/main` の
  ベースラインworktree（`.night-worktrees/baseline-150`）で実行した結果と**失敗5件が
  テスト名まで完全一致**（既知の環境依存タイムアウト）。フィードバック・折り畳み・ズーム関連の
  5ファイル18テストは個別実行で全緑
- `npm run lint:ratchet`: エラー326件/警告5件で基準値ちょうど（変化なし）
- `npm run build`: `tsc -b && vite build` がエラーなく完走
- ブラウザ確認（1280×720 / 375×812・ピアノデモ譜。3.5 と同じ一時エントリHTML方式）:
  折り畳み中に💬が見えて押せ、状態JSON（22KB・`viewState` 11項目）がコピーされ
  Issue下書きURLが開くこと、押しても折り畳みが解除されないこと、通知が帯の下に出て
  帯は **33px のまま**（成功通知・2行のエラー通知とも）であること、375px でも
  ズーム・💬・トグルが1行33pxに収まりエラー通知の全文（URL含む）が読めること、
  展開に戻すとラベル付きボタンがタブ行右端へ戻りボタンは常に1個であること、
  ヘッダー高さが展開時203.5pxで変わらないこと、コンソールエラーなしを確認

## 4. 既知の制限・今後の課題

- `viewState` の内容（ズーム・音符の大きさ等）は「ファイルを開く」では復元されない。診断用の付加情報として人間が読むことのみを想定している。将来的に表示状態まで往復させたい場合は、`handleImportFile` 側に `viewState` を読んで各 setter へ反映する処理を追加する必要がある
- クリップボード書き込み失敗時、JSON本文そのものをダイアログ等で提示するフォールバックまでは実装していない（エラーメッセージでの案内のみ）。運用上の必要が出た場合に追加を検討する
