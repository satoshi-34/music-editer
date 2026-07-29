# 設計書: 曲中への小節挿入・小節削除

## 概要

Issue #110「曲中への小節挿入・小節削除（現在未対応）」を実装する。
既存の「小節選択（`Tool { mode: 'select' }` → `selectedMeasures` state）」を起点にし、
[[transpose-selection]]（`.claude/specs/transpose-selection/design.md`）が確立した
「選択範囲 × 全パート」の考え方をそのまま踏襲した。

## 問題点（実装前の状況）

- 「＋小節を追加」ボタン（`ScorePage.tsx` の `extraEditingMeasures`）は、実データ配列を伸ばすのではなく
  「表示する編集可能バッファの数」を増やすだけで、しかも常に**末尾への追加専用**だった
- `insertMeasure` / `deleteMeasure` に相当する処理はリポジトリ内に存在せず、曲の途中に小節を差し込む・
  余分な小節を削る操作が一切できなかった

## 修正設計

### 1. `src/utils/measureInsertDeleteUtils.ts`（新規）

パート1本ぶんの `MeasureData[]` に対する純粋関数として実装した（`noteDeletionUtils.ts` の
「イベント単位パッチ」パターンを小節単位に広げた形）。

- `insertEmptyMeasureBefore(measures, index)`: `index` の直前に空の小節（`createEmptyMeasure()`）を1つ挿入する。
  `index` が配列長を超える場合は末尾への追加として扱う（範囲外アクセスを避けるため）。
- `deleteMeasureAt(measures, index)`: `index` の小節を1つ削除する。範囲外なら無変更で `measures` をそのまま返す。
- 両関数とも、全イベント（`events` と `voices[].events` の両方）を走査し、
  `NoteEvent.arcs[].toMeasureIndex`（タイ/スラーの終点小節）と `NoteEvent.hairpins[].endMeasure`
  （ヘアピンの終点小節）を付け替える:
  - 挿入: 挿入位置以降を指す参照はすべて `+1`
  - 削除: 削除位置ちょうどを指す参照は「参照先の小節が消えた」ため除去（`undefined` 化）、
    削除位置より後ろを指す参照は `-1`
- 拍子変更・調号変更・リピート記号・BPM・リハーサルマークなどは `MeasureData` 自体のフィールドなので、
  小節ごと `splice` すれば自動的に一緒に移動する（付け替え不要。これが今回の設計で新規ロジックが
  不要だった部分）
- `shiftOverridesStartMeasure(overrides, at, delta)`: `systemMeasureOverrides` /
  `systemRowGapOverrides`（どちらも `{ startMeasure, ... }` の形）の `startMeasure` を挿入・削除に
  合わせてずらす共通ヘルパー。タイ/ヘアピンと違って**除去はしない**（後述）。

### 2. `systemMeasureOverrides` / `systemRowGapOverrides` の扱い

これらは「小節 `startMeasure` から始まる段は〜」という**位置の指定**であり、タイ/ヘアピンのように
「参照先の音符が消えたら無効になる」ものではない。削除で `startMeasure` ちょうどの小節が消えても、
その位置には次の小節が繰り上がってくるので、位置の指定として引き続き有効に保てる。

そのため、`shiftOverridesStartMeasure` では:
- 挿入（`delta=1`）: `startMeasure >= at` を `+1`
- 削除（`delta=-1`）: `startMeasure > at` を `-1`、`startMeasure === at` は**据え置き**（除去しない）

`systemMeasureOverride.ts` 側の既存コメント（「段の並び順ではなく開始小節番号をキーにしたのは、
小節の挿入・削除で多少ずれても意味を保ちやすいようにするため」）が、この設計をそのまま裏付けている。

### 3. 適用対象パート（4譜種の扱い）

`ScorePage.tsx` に既にあった、移調（`handleTranspose`）専用の「対象パートを集める」ロジックを
`getEditablePartEntries()` として切り出し、移調・挿入・削除の3箇所で共有した（コピー/ペースト/
Deleteのキーボードハンドラは選択範囲へのスライス/上書きという別の形のロジックのため、今回は
対象外のまま既存の scoreType 分岐を踏襲している）。

- ピアノ譜: `rightHandData` と `leftHandData` の両方
- 四重奏・編成譜: `quartetParts` / `ensembleParts` の全パート（編成譜は `staffCount:2` パートの
  `ensembleSecondStaffParts` も含む）
- 単旋律: `rightHandData` のみ

挿入・削除とも `pushHistory()` を呼んでから全パートへ反映するため、Undo/Redo で一括して元に戻せる。

### 4. UI（音符・休符タブ）

「音符・休符」タブに、`selectedMeasures` があるときだけ「小節を挿入」「小節を削除」ボタンを追加した
（既存の声部切り替えトグルと同じ `toolbar-chip-group` を使用）。

複数小節をまとめて挿入・削除する機能は範囲外（Issue本文の指定どおり）のため、
`selectedMeasures.start !== selectedMeasures.end`（複数小節選択中）のときはボタンを disabled にし、
理由をツールチップで示す。

### 5. 四重奏・編成譜のクリック選択が未配線だった問題（発見・対応）

実装前の調査で、`selectedMeasures`/`onMeasureSelect` は `PianoStaff`/`SingleStaff` にしか配線されておらず、
**弦楽四重奏・編成譜の画面ではクリックによる小節選択ができない**ことが判明した
（キーボードのCmd+C/V/Delete/移調は `scoreType` 分岐を持っていたが、その選択自体を得る手段がUI上に無かった）。

受入条件「4譜種すべてで動作する」を満たすには選択そのものが必要なため、今回のスコープに含めて対応した:

- `QuartetStaff.tsx` / `EnsembleStaff.tsx` の Props に `selectedMeasures?` / `onMeasureSelect?` を追加し、
  内部で使っている `PianoSystemCanvas`（これは元々 `selectedMeasures`/`onMeasureSelect` に対応済み）へ
  そのまま中継するだけの変更（空の段プレースホルダー用の2つ目の `PianoSystemCanvas` 呼び出しは
  `disabled` のため対象外）
- `ScorePage.tsx` の `<QuartetStaff>` / `<EnsembleStaff>`（パート譜表示ではない通常表示のほう）に
  `selectedMeasures={selectedMeasures ?? undefined}` / `onMeasureSelect={handleMeasureSelect}` を追加

これにより、移調（Issue #67で追加済み）も四重奏・編成譜でクリック選択から使えるようになった
（副次的な改善。既存の移調ボタンの動作自体は変更していない）。

## 影響範囲

- 新規ファイル: `src/utils/measureInsertDeleteUtils.ts`, `src/utils/measureInsertDeleteUtils.test.ts`
- 変更ファイル:
  - `src/components/ScorePage.tsx`: `getEditablePartEntries` の切り出し、
    `handleInsertMeasure`/`handleDeleteMeasure` の追加、「音符・休符」タブへのボタン追加、
    `QuartetStaff`/`EnsembleStaff` 呼び出しへの `selectedMeasures`/`onMeasureSelect` 追加
  - `src/components/QuartetStaff.tsx` / `src/components/EnsembleStaff.tsx`: `selectedMeasures`/
    `onMeasureSelect` の中継のみ（描画・レイアウトロジックへの変更なし）
- データモデル（`MeasureData`/`NoteEvent`/`SystemMeasureOverride`/`SystemRowGapOverride`）への
  型変更なし。既存の保存データ・MusicXML入出力への影響なし。

## 検証結果

- `npx tsc -b --noEmit`: エラーなし
- `npx vitest --run src`（`--maxWorkers=1`）: 1224 passed / 13 failed。失敗13件はすべて
  `ScorePageYOffsetPanel.test.tsx` / `ScorePageSettingsProfile.test.tsx` /
  `ScorePageDefaultLayout.test.tsx` など**今回変更していないテストファイル**で、
  `render(<ScorePage />)` 自体が既定の5000msタイムアウトを超える、Docker共有環境下の負荷起因の
  既知の事象（PR #129 でも同一パターンを報告済み）。実際に該当ファイルを単体実行すると全件成功する
  ことを確認済み（例: `ScorePageYOffsetPanel.test.tsx` 単体実行で3件とも成功、1テストあたり3〜4秒）。
  新規追加した `measureInsertDeleteUtils.test.ts`（18件）はすべて成功。
- `npm run lint`: 326 errors / 5 warnings。件数はこのdiff適用前と完全に一致しており
  （`RestOverlapFixV2.ts`/`storage.ts` などの既存 `no-explicit-any` のみ）、新規追加ファイルに
  lintエラー・警告は無い。
- `npm run build`: 成功

### ブラウザでの動作確認について（自信のない点）

共有Docker環境のポート5173には、今回の実行時点で既に別セッション（人間の作業用チェックアウト、
または他の実行）と思われるvite dev serverが稼働していた。夜間エージェントは本体checkoutは触らない
制約があり、また他セッションの開発サーバーを停止・上書きするのは安全側の判断に反すると考え、
今回はブラウザでの実機確認を行っていない。上記の型検査・テスト・lint・buildの結果と、
コードレビューでの手動トレース（挿入・削除ロジックのテストケースが受入条件の各項目をカバーしている
こと）で代替している。人間によるレビュー時に、4譜種それぞれで実際にクリックしての動作確認を推奨する。
