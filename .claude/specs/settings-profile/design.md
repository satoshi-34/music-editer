# 譜面設定の初期値プリセット（issue #39）

## 問題

「楽譜設定」タブには、楽譜の種類・編成テンプレート・拍子・調号・段あたり小節数・段数/ページ・表示ウェイト・小節幅の均等さ・音符の大きさ・ページ余白（左右/上/下）・段の間隔など、多くの設定項目がある。

このうちページ余白・段の間隔・音符の大きさ・小節幅の均等さ・段数/ページは個別の localStorage キー（`score-page-margin-side` 等）で「直近に使った値」を次回リロード時にも復元していたが、以下の課題があった。

- **楽譜の種類・編成テンプレート・拍子・調号・段あたり小節数は一切永続化されておらず**、「新規作成」を押すたびに単旋律・4/4拍子・Cメジャー・4小節/段という固定値へ強制的に戻っていた。
- 個別キーはそれぞれ独立していて「自分の standard な設定一式」としてまとめて保存・復元する手段が無かった。
- 「工場出荷時の既定へ戻す」手段が無かった（ページ余白系だけは「レイアウトをリセット」ボタンで個別に戻せたが、対象が限定的だった）。

## 修正設計

### 単一キーの「設定プロファイル」

新規ファイル `src/utils/settingsProfile.ts` に、上記の全項目をまとめた `ScoreSettingsProfile` 型と、単一の localStorage キー（`music-score-app-settings-profile`）で読み書きする純関数群を実装した。

- `version` フィールドを持つスキーマとして保存し、`parseSettingsProfile(raw)` が「JSON として解析できない」「`version` が現在のスキーマと不一致」の場合は**プロファイル全体**を工場出荷既定値（`getFactoryDefaultSettingsProfile()`）へフォールバックする。
- `version` が一致する場合は、フィールドごとに型・範囲を検証し、**個別のフィールドだけ**既定値へフォールバックする（1項目の異常でプロファイル全体を捨てない）。
- 範囲チェックに使う定数（`NOTATION_SIZE_MULTIPLIER_MIN/MAX` 等）は、従来 `ScorePage.tsx` にローカル定義されていたものを `measureLayoutUtils.ts` へ集約し、スライダーの実装側と `settingsProfile.ts` の両方から同じ値を参照するようにした（値の二重管理を避けるため）。

### 既存の個別 localStorage キーとの役割分担

個別キー（`score-page-margin-side` 等）と、新しい単一プロファイルキーは役割が異なるため、両方を残した。

- **個別キー**: 「直近にスライダーをどこまで動かしたか」を保持し、通常のリロードでは常にこれが復元される（既存の挙動を一切変えていない）。
- **設定プロファイル**: 「新規譜面の作成時」と「保存済み譜面が無い状態での起動時（初回起動・localStorage クリア後など）」にだけ適用される、明示的に保存する「自分の既定値」。

この2つが食い違って「二重管理」にならないよう、プロファイルを適用する箇所（`ScorePage.tsx` の `applySettingsProfileToState`）では、画面の state を更新すると同時に対応する個別キーへも書き込み、以後のリロードでも一貫した値になるようにしている。

**未保存のユーザーには一切影響しない**設計にした点が重要な安全策になっている。`hasSettingsProfile()` が false のとき（一度も「既定として保存」を押していないとき）は、起動時の適用処理は何もしない。これにより、既存ユーザーが既に調整済みの個別スライダー値を、プロファイル機能の追加によって意図せず工場出荷値へ巻き戻してしまう回帰を避けている。

### 適用タイミング

1. **新規作成**（`handleNewScore`）: 確認ダイアログの後、`applySettingsProfileToState(loadSettingsProfile())` を呼ぶ。プロファイル未保存なら `loadSettingsProfile()` は工場出荷既定値を返すため、この場合は従来と全く同じ値（単旋律・4/4・Cメジャー・4小節/段・既定レイアウト）になる。
2. **起動時のサイレント復元で「自動保存データが無い」場合**: `hasSettingsProfile()` が true のときだけ `applySettingsProfileToState(loadSettingsProfile())` を呼ぶ。既存の譜面読込・自動保存からの復元経路（`handleLoad` / `handleImportFile` / 自動保存復元）ではこの適用を一切行わず、読み込んだ譜面側の値を上書きしない。

### 編成テンプレート（`instrumentationPresetId`）の扱い

`scoreType` が `'ensemble'` のときだけ意味を持つフィールドで、`'custom'`（パート編集で作った独自編成）が保存されていた場合はパート構成そのものを復元できないため、適用時は `getDefaultInstrumentationForScoreType('ensemble')`（= `chamber-orchestra` プリセット）へフォールバックする、というスコープ判断をした。カスタム編成そのものの保存は本 Issue の対象外。

### UI

「楽譜設定」タブの「レイアウトをリセット」ボタンの下に「初期値プリセット」セクションを追加した。

- **既定として保存**: 現在の画面設定（音符データは含まない）をまるごとプロファイルとして保存する。
- **工場出荷時に戻す**: 保存済みプロファイルを削除するだけで、**今開いている譜面の設定はその場では変えない**。次回の「新規作成」または「保存済み譜面が無い状態での起動」から工場出荷既定値が使われる。今の画面を即座に書き換えないのは、編集中の譜面をボタン1つで強制的に変えてしまう影響の大きさを避けるため（受入条件の確認手順「設定変更→保存→リロード→新規譜面で復元確認」とも合致する設計）。

## テスト

- `src/utils/settingsProfile.test.ts`: 純関数のユニットテスト（正常・欠損キー・不正JSON・バージョン不一致・範囲外の値・不正な列挙値・null 許容フィールドのフォールバック）。
- `src/components/ScorePageSettingsProfile.test.tsx`: `ScorePage` を実際にマウントする統合テスト（`PrintPreview.test.tsx` と同じレンダー手法）。「既定として保存」→ localStorage への反映、「新規作成」での復元、保存済み譜面が無い状態での再マウントでの復元、「工場出荷時に戻す」後の新規作成で工場出荷値になることを確認している。

## 影響範囲・スコープ外

- `src/utils/measureLayoutUtils.ts`: レイアウト系の範囲定数（`NOTATION_SIZE_MULTIPLIER_MIN/MAX` 等）を `ScorePage.tsx` から移設。値そのものは変更していないため、既存の見た目・挙動に影響はない。
- ブラウザでの実機確認は実施していない（夜間無人実行のため、共有 devcontainer 上で他セッションが使用中の可能性がある dev サーバーへ干渉しないことを優先した。詳細は PR 本文を参照）。代わりに `npx tsc -b --noEmit` によるコンパイル確認と、`ScorePage` を実マウントする統合テストで UI の配線（ボタンのクリック・state 反映）を確認している。

## 追補: 音符の大きさ・段の間隔の既定値を楽譜種別ごとに変える（Issue #49、2026-07-24）

### 問題

工場出荷既定値（`getFactoryDefaultSettingsProfile()`）は「音符の大きさ100%・段の間隔0px」で全楽譜種別共通だった。運用者からの明示的な指定として、単旋律・ピアノは見やすさのため150%を、ピアノの大譜表はさらに段間隔+30pxを既定にしたい、というリクエストがあった（弦楽四重奏・編成譜は現状維持）。

### 修正設計

- **既定値の解決を純関数へ切り出す**: `measureLayoutUtils.ts` に `resolveDefaultLayoutForScoreType(scoreType): { notationSizeMultiplier, systemRowGapPx }` を新設した。単旋律・ピアノは `notationSizeMultiplier = 1.5`、それ以外（弦楽四重奏・編成譜）は `1`。`systemRowGapPx` はピアノだけ `30`、それ以外は `0`。この関数は `measureLayoutUtils.ts` 側に置くことで、`settingsProfile.ts`（工場出荷プロファイル）と `ScorePage.tsx`（画面のスライダー state）の両方から同じ値を参照でき、値の二重管理を避けている。
- **`getFactoryDefaultSettingsProfile()`**: 従来ハードコードしていた `notationSizeMultiplier: 1` / `systemRowGapPx: 0` を、`resolveDefaultLayoutForScoreType('single')` の解決結果（1.5 / 0）に置き換えた。このプロファイルの `scoreType` は常に `'single'` なので、単旋律の既定値がそのまま反映される。
- **`ScorePage.tsx` の該当2つの `useState` 初期化**（`notationSizeMultiplier` / `systemRowGapPx`）: localStorage未保存時のフォールバックを、ハードコードの `1` / `0` から `resolveDefaultLayoutForScoreType(scoreType)`（マウント時点の `scoreType`、既定 `'single'`）に変更した。
- **楽譜種別の切り替え時にも既定値へ追従させる**: 「楽譜の種類」ボタン（`handleScoreTypeChange`）と編成テンプレートの切り替え（`handleInstrumentationPresetChange`）で、切り替え先の `resolveDefaultLayoutForScoreType(nextType)` を計算し、**`score-notation-size` / `score-system-row-gap` がまだ localStorage に保存されていない場合だけ** `setNotationSizeMultiplier` / `setSystemRowGapPx` で反映する。ユーザーが一度でもスライダーを動かして値が保存されている場合は、種別を切り替えてもその値のまま変えない（この issue のノート「ユーザーが保存した設定・初期値プリセットが存在する場合はそちらを尊重し、上書きしない」を、個別スライダーの保存有無で判定する形で実装した）。
- **「レイアウトをリセット」ボタン**（`handleResetPageLayout`）: 段の間隔のリセット先も `resolveDefaultLayoutForScoreType(scoreType).systemRowGapPx` に変更した（従来はページ余白と同様ハードコード0へ戻していたが、「既定値へ戻す」という表示ラベルと矛盾しないよう、種別ごとの既定値に揃えた）。ページ余白3つは種別に依らない固定既定値のままなので変更していない。
- **段数/ページの推奨値への波及**: `recommendedSystemsPerPage` / `maxSystemsPerPage` は既存どおり `notationSizeMultiplier` / `systemRowGapPx` に連動する計算式のままのため、単旋律・ピアノの初期表示（推奨段数）が新しい既定サイズに自動で追従する（単旋律8段→5段、ピアノ4段→3段。詳細は `.claude/specs/page-layout-controls/design.md` の追補を参照）。

### 検証結果

- `docker exec -w <worktree> music-editer-dev npx vitest --run src`: 95ファイル1085テスト全緑（新規: `resolveDefaultLayoutForScoreType` の単体テスト4件、`ScorePageDefaultLayout.test.tsx` の統合テスト5件。既存の `ScorePageSystemsPerPage.test.tsx` は新しい既定値（単旋律5段・ピアノ3段）に合わせてアサーションを更新した）。
- `docker exec -w <worktree> music-editer-dev npm run build`（`tsc -b && vite build`）: エラーなし。
- `docker exec -w <worktree> music-editer-dev npx eslint <変更ファイル>`: 変更ファイルに絞って実行し、新規のエラー・警告は0件（既存の `any` 型エラー等はすべて今回変更していない行）。プロジェクト全体では既存の技術的負債として353件のlintエラーがあり、`npm run lint`（全体）は本変更以前から通らない状態のため、変更ファイル限定の実行で代替確認した（main チェックアウト側でも同数のエラーがあることを確認済み）。
- **ブラウザ実測**: 夜間無人実行のため、共有 devcontainer で他セッションが使用中の dev サーバー（port 5173, `/app` 直下の main チェックアウトを配信）には干渉せず、同じ Docker イメージ（`music-editer-app`）から worktree 用の一時コンテナ（`music-editer-preview-issue49`、host port 5174、`music-editer-dev` コンテナとは別プロセス）を立てて確認した。新規ユーザー状態（localStorage空）で単旋律を開くと音符150%・段間隔0px、ピアノへ切り替えると音符150%・段間隔30px・段数/ページの推奨値が自動で3段になること、弦楽四重奏・編成譜は100%・0pxのまま変わらないことをスクリーンショットで確認し、コンソールエラーが無いことも確認した。確認後、一時コンテナは停止・削除した。

### 影響範囲（追補）

- `src/utils/measureLayoutUtils.ts`: `resolveDefaultLayoutForScoreType` と関連定数（`NOTATION_SIZE_MULTIPLIER_LARGE_DEFAULT` 等）を追加。
- `src/utils/settingsProfile.ts`: `getFactoryDefaultSettingsProfile()` の `notationSizeMultiplier` / `systemRowGapPx` を `resolveDefaultLayoutForScoreType('single')` 経由に変更。
- `src/components/ScorePage.tsx`: `notationSizeMultiplier` / `systemRowGapPx` の `useState` 初期化、`handleScoreTypeChange` / `handleInstrumentationPresetChange` / `handleResetPageLayout` を変更。UIツールチップ・コード内コメントも新しい既定値に合わせて更新。
- `src/utils/measureLayoutUtils.test.ts` / `src/utils/settingsProfile.test.ts`: `resolveDefaultLayoutForScoreType` と工場出荷既定値の単体テストを追加。
- `src/components/ScorePageDefaultLayout.test.tsx`: 新規。新規ユーザー状態での楽譜種別ごとの既定値、種別切り替え時の追従、ユーザー保存値の非上書き、「レイアウトをリセット」の既定値追従を確認する統合テスト。
- `src/components/ScorePageSystemsPerPage.test.tsx`: 既定サイズ変更に伴う推奨段数の変化（単旋律8段→5段、ピアノ4段→3段）に合わせてアサーションとテスト名を更新。
- `README.md`: 「音符の大きさ調整」「ページ余白・段の間隔の調整」「譜面設定の初期値プリセット」の各節に、楽譜種別ごとの既定値と、それに伴う段数/ページ推奨値の変化を追記。

## 追補: 「工場出荷時に戻す」→「初期設定に戻す」へ改名（Issue #143・2026-08-01）

「工場出荷時」は開発側の内輪の言い回しで、譜面を書きに来た利用者には何が戻るのか伝わらない。
Issue #114 の「レイアウトタブの整理」方針に従い、ボタンのラベルを **「初期設定に戻す」** へ改名した。

- 変えたのは表示ラベルとコメント・ドキュメントの文言だけで、`resetSettingsProfile()` の
  処理・localStorage キー・「今の画面は変えない」という上記の設計はそのまま。
- 改名にあわせてボタンの置き場所も変わり、レイアウトタブ直下ではなく
  「リセット」メニューの中の1項目になった（`.claude/specs/toolbar-tab-layout/design.md` の
  Issue #143 の追補を参照）。メニュー内では「影響範囲: 上で保存した初期値を削除します。
  今の画面の譜面（音符・記号）はそのままで、次の新規作成・次回起動からアプリ既定の設定に
  なります」という説明文を添えており、上記の「今の画面は変えない」設計を押す前に読めるように
  している（「譜面（音符・記号）」の明記は Issue #155 で追加。音符が消えるのではと不安に
  なった運用者の実体験による）。
- `ScorePageSettingsProfile.test.tsx` の該当テストも新しいラベルへ更新した（テストの
  観点は変えていない）。
