# タイトル編集ダイアログ（Issue #576 / #636）

タイトル・サブタイトル・作詞者・作曲者・編曲者の**文字そのものと書式**を、
1つのダイアログにまとめる。設計の正本はこのファイル。書体・文字サイズ・太さの
値の意味と保存形式は `.claude/specs/title-font/design.md`（#342 / #420）が正本で、
本ファイルはその**入口（UI）**だけを扱う。

## 問題

2026-09-05 時点の姿は、同じ「タイトル」を触るのに操作が2か所に割れていた。

| 何を変えるか | どこで |
| --- | --- |
| 文字（タイトル・サブタイトル・作者） | 譜面の上で直接タイプ（`contentEditable`） |
| 書体・文字サイズ・太さ | 「楽譜設定」タブに常設された3項目 |

- 書式3項目は使用頻度「まれ」なのに常に見えていて、パレットが混んでいた
  （`.claude/specs/toolbar-organization/design.md` §1-3 の棚卸し）
- 譜面上の直接入力は Enter が確定扱いで、**改行が入れられなかった**（Issue #636）
- 書体を選ぶ場所と、結果が出る場所（譜面のタイトル）が遠い

運用者裁定（2026-09-05・Issue #576 のトリアージコメント）:
「タブから削除して、タイトルを選択したら編集用のダイアログが出て、そこで全部決められる」
「編集して即座にプレビューされるのがいい（特にフォントと文字の大きさ）」。
あわせて #636（複数行タイトル）の表示・印刷・MusicXML 対応も本 Issue に取り込む。

## 修正設計

### 1. 入口: タイトルブロックのクリック

`.score-title` / `.score-subtitle` / `.score-credit`（作者行）のどれをクリックしても
**同じダイアログ**が開く。キーボードでも開けるよう `role="button"` + `tabIndex={0}` +
Enter / Space を受ける。`button` 要素にしないのは、`h1` / `p` の中にボタンを入れると
浄書用の見た目（字送り・中央寄せ）へブラウザ既定のボタン装飾が混ざるため。

`contentEditable` は廃止した（仕様5）。譜面上とダイアログの2つの入力経路が残ると、
「どちらで打った値が正か」という同期の問題が生まれる。

### 2. 即時プレビュー = 下書きを持たない

ダイアログは**状態を持たない**。入力のたびに親（`ScorePage`）の本物の state
（`title` / `subtitle` / `lyricist` / `composer` / `arranger` と書体3つ）を直接書き換えるので、
後ろの譜面のタイトルがその場で変わる。暗幕（モーダルのオーバーレイ）は**置かない**:
書体・文字サイズの結果は後ろの譜面で確かめるものなので、覆うと用をなさない。
位置は画面右下の固定（タイトルは紙面の上・中央にあるので、編集中も隠れない）。

### 3. 決定 / キャンセルの責任は親が持つ

「開く前の値」（`ScoreSnapshot` 1つぶん）を `titleEditBaselineRef` に控える。

- **キャンセル / Esc**: 控えた値を全項目へ書き戻す。プレビュー中に変えたものも戻るので
  「開く前と 1px も変わらない」（受入条件）
- **決定**: 控えた値を**そのまま履歴へ積む**（`pushHistoryWithSnapshot`）。
  即時プレビューのため `currentScoreRef` はもう変更後の値になっており、
  通常の `pushHistory`（＝いまの値を積む）では Undo しても何も戻らない。
  8項目のどれも変わっていなければ積まない（Undo の空振りを作らない）

このために `ScoreSnapshot` へタイトル5項目と書体3項目を追加した。音符の大きさ（#571）と
同じ形で、古い履歴では `undefined` になり得るため復元側は「入っていなければ今の値を保つ」。
太さだけは `undefined` 自体が「既定（タイトルのみ太字）」という意味を持つ値なので、
値ではなく**キーの有無**（`'titleFontWeight' in restored`）で判定する。

### 4. 複数行（#636 を取り込み）

- 入力は `textarea`。Enter がそのまま改行になる（#636 の「Shift+Enter」は、
  ダイアログ化で不要になったため採らない＝運用者裁定どおり）
- 保存形式は不変。`metadata.title` 等の1本の文字列に `\n` を持つだけ
- 表示は CSS の `white-space: pre-line`（改行だけ活かす）。行間は文字サイズに比例させたいので
  `line-height` を倍率で指定する。タイトル欄は通常フロー（`.page-head--title`）なので、
  行が増えれば譜面がその分だけ下へ送られる＝1段目の五線に重ならない
- MusicXML: `work-title` は「1本の文字列」なので行の分かれ目を持てない。**2行以上のときだけ**
  標準の `<credit><credit-type>title</credit-type><credit-words>…</credit-words>…</credit>` を
  1行につき1つ出す（他アプリが紙面の見た目を復元できるように）。`work-title` 側は
  改行を数値文字参照 `&#10;` で書く（生の改行は読み手の空白の扱いで潰れ得るため）。
  1行のときは**出力を1バイトも変えない**。読み込みは credit-type が title の
  credit-words が2つ以上あるときだけそれを採用し、無ければ従来どおり work-title →
  movement-title（#502 のフォールバック）

### 5. 書式コントロールは共通部品

`components/TextFormatContextPanel.tsx`（書体・サイズ・太さの3つだけ・状態を持たない）。
`labelPrefix` で読み上げ名を差し替えられるので、#451（テキストボックスごとのフォント変更）で
そのまま使える形にしてある。書体の一覧は `TITLE_FONT_OPTIONS` を共用する（一覧の2枚目を作らない）。

## 影響範囲

- `components/TitleEditDialog.tsx`（新設）・`components/TextFormatContextPanel.tsx`（新設）
- `components/ScorePage.tsx`: 楽譜設定タブの3項目を撤去（常設 10→7）、タイトルブロックを
  クリックで開く入口へ、`ScoreSnapshot` の拡張と `applySnapshot` の復元、
  `pushHistoryWithSnapshot`、開く/決定/キャンセルのハンドラ
- `App.css`: `.title-edit-dialog` 一式・`.text-format-context-panel` 一式・
  タイトル系3クラスの `white-space: pre-line` と `line-height`・印刷での非表示
- `utils/musicXmlExport.ts` / `utils/musicXmlImport.ts`: 複数行タイトルの credit 往復
- `utils/helpContent.ts`・`README.md`
- テスト: `ScorePageTitleFontWiring.test.tsx`（入口の移動・即時プレビュー・決定・Undo・
  キャンセル・タブからの消失）、`ScoreHeadCreditLayout.test.tsx`（作者欄の編集経路）、
  `musicXmlTitle.test.ts`（複数行の往復・1行は従来出力のまま）

## 積み残し

- ダイアログは画面右下の固定位置で、ドラッグでの移動はできない。タイトルが紙面の上・中央に
  あるため実害は無いと判断したが、狭い画面で譜面の右下（最終段）を見ながら直したい場合は
  邪魔になり得る
- `.print-page` の `@media print` ブロックへ新しいブロックを足していない点に注意。
  App.css の印刷指定を静的に検査しているテストは「最初に見つかった `@media print`」だけを
  見るため、前に別ブロックを足すと本来の印刷ブロックが検査されなくなる（#576 の前身 PR #637 で実発生）

## round1 レビューでの差し戻しと修正（2026-09-06・PR #687）

round1（P1 1件・P2 4件）で、設計そのものは妥当だが実装に4つの穴が見つかった。修正内容と理由。

### P1: `<credit>` の置き場所が score-header の順序に違反していた

**問題**: `<credit>` を `<identification>` の**前**に出していた。MusicXML の score-header は
work → movement-number → movement-title → identification → defaults → credit* → part-list の
順序が決まっており、書き出しは DOCTYPE で partwise の DTD を宣言しているので順序は必須。
Finale / Dolet のような厳格な読み手では不正扱い、または credit が無視される。

**修正**: `</identification>` の直後（`<part-list>` の直前）へ移した。`<defaults>` はこのアプリの
書き出しには存在しないため、この位置が credit* の正しい場所になる。
`musicXmlTitle.test.ts` に「`<credit>` は `</identification>` より後・`<part-list>` より前」を固定。

### P2-1: credit-words が2つ以上あれば無条件に改行結合していた

**問題**: Finale は**1行の中で書式が切り替わるだけ**でも credit-words を分けて出す。
「2つ以上あれば改行で結合し work-title より優先」だと、1行の題が2行に化け、
しかも正しい work-title を上書きしてしまう（Finale 持ち込み経路が最も影響を受ける）。

**修正**: credit を採用するのは次の2つの場合だけに絞った。
1. `work-title` も `movement-title` も無い（credit しか題の手がかりが無い）
2. credit の行を**空白でつないだ文字列**が work-title（movement-title）と一致する
   ＝ 同じ題を行分けしただけだと確認できる

(2) の比較は連続する空白（改行を含む）を1つの半角空白へ潰してから行う。
このアプリ自身の書き出しは work-title 側の改行を `&#10;` で保つため、潰さずに比べると
「改行 vs 半角空白」の差で自分の書いたファイルすら一致しなくなるため。

### P2-2: 「決定」で積む履歴が「開いた時点の譜面まるごと」だった

**問題**: このダイアログは暗幕（オーバーレイ）を意図的に置いていない＝開いたまま譜面を
編集できる。決定で `baseline`（開いた時点の譜面まるごと）を積むと、そのあとの Undo で
**ダイアログを開いている間にした音符の編集まで巻き戻る**。

**修正**: 積むのは「**いまの譜面**のタイトル系8項目**だけ**を開いた時点の値へ戻したもの」。
キャンセル側が既にこの考え方（8項目だけ書き戻す）だったので、決定側をそろえた形になる。
8項目の列挙が散らばると足し忘れるため、正本を `TITLE_SNAPSHOT_KEYS` と
`withTitleFieldsFrom` / `hasTitleFieldChanges`（ScorePage.tsx のモジュールスコープ）へ集約した
（#451 で同じダイアログを使い回す前提）。

### P2-3: 作品が入れ替わってもダイアログが開いたままだった

**問題**: 新規作成・ファイル読込・復元でダイアログを閉じていなかった。開いたまま別の作品を
開くと、キャンセルで前の作品のタイトルが新しい譜面へ書き戻され、決定では前の作品の
スナップショットが新しい履歴に積まれる。

**修正**: 呼び出し側4か所に閉じる処理を散らすのではなく、**作品の切替・復元の入口である
`beginWorkRestore()` の中**で控えを捨てて閉じる。これで今後この入口を通る経路が増えても
書き忘れが起きない。そのため `titleEditBaselineRef` の宣言を `beginWorkRestore` の直前へ移した。

### P2-4: タイトル欄が全部空だとクリックの入口が消えていた

**問題**: 譜面上の直接入力（contentEditable）を廃止したので、ダイアログを開く唯一の入口は
見出しのクリック。タイトル・サブタイトル・作者がすべて空だと h1 も p も高さ 0 になり、
掴む場所そのものが画面から消える（＝二度とタイトルを入力できない）。

**修正**: 5項目すべてが空のときだけ、h1 の中に薄い案内文「タイトルを入力」
（`.score-title-placeholder`）を出す。**画面だけのもの**で、印刷と印刷プレビューでは
`display: none`（紙面に出したら誤植になる）。

### P3 のうち取り込んだもの

- Cmd/Ctrl+Enter で決定（各欄が textarea で Enter は改行のため、修飾キーつきにした）
- `<creator type="composer">` の改行も work-title と同じく `&#10;` で書く
  （作曲者欄も textarea なので複数行になり得る）

閉じたあとのフォーカスを開いた要素へ戻す件は未対応（積み残し）。

### 追加したテスト

`components/ScorePageTitleDialogGuards.test.tsx`（新設・1ファイル1テスト）:
空タイトルでもクリックで開く → ダイアログを開いたまま「音符の大きさ」を変える →
決定 → Undo 1回でタイトルだけ戻り音符の大きさは戻らない → 新規作成でダイアログが閉じる。
`musicXmlTitle.test.ts`: credit の位置・creator の改行・credit-words の採用条件4件。
