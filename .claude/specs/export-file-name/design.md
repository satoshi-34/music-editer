# 書き出しファイル名の編集（Issue #507）

## 問題

書き出しの既定ファイル名は「タイトル由来（空なら『楽譜』）」で、実質固定だった。

| 書き出し | これまでの名前 | 変えられるか |
| --- | --- | --- |
| 作品ファイル `.score.json` | `<タイトル>.score.json` | Chrome/Edge のみ（保存先ダイアログで変更できる） |
| MusicXML | `<タイトル>.musicxml` | 不可（ダイアログなしの即ダウンロード） |
| MIDI | `<タイトル>.mid` | 不可（同上） |
| PDF | — | 対象外（ブラウザの印刷ダイアログ側） |

Safari は `showSaveFilePicker`（File System Access API）が無く、作品ファイルもダウンロード
経路になるため、**どの形式でも名前を変える手段がまったく無かった**（#464 と同文脈）。

運用者の実利用で困った実例は「取り込んだ楽譜を、作曲者名などをマスクした共有用コピーとして
**別名で**書き出したい」というケース。現状はダウンロード後に手でリネームするしかなかった。
また、タイトル未入力のまま書き出すと `楽譜.musicxml` が量産され、上書き・取り違えが起きていた。

さらに、同じ「ファイル名を作る」処理が3か所に散っていて、**揃っていなかった**:

- `fileStorage.ts` … `safeFileName()` で使えない文字を除去（空なら `score`）
- `musicXmlExport.ts` / `midiExport.ts` … **サニタイズ無し**でタイトルをそのまま連結（空なら `楽譜`）

タイトルに `/` や `:` が入っていると、MusicXML / MIDI 側だけ壊れた名前が出る状態だった。

## 修正設計

### 1. ファイル名の組み立てを1か所へ集約（`src/utils/exportFileName.ts` 新規）

「同じ目的の実装を2枚持たない」という方針（#223 → #280 の教訓）に従い、
3経路が同じ関数を通るようにする。

- `EXPORT_FILE_TYPES` … 種類（`score` / `musicxml` / `midi`）ごとの拡張子と、
  「重複とみなして取り除く末尾」の一覧
- `sanitizeFileNameBase(input, fallback = '楽譜')`
  - Windows で使えない記号（`\ / : * ? " < > |`）と制御文字を除去
  - 先頭のドット（macOS/Linux で隠しファイルになる）・末尾のドット（Windows が黙って落とす）を除去
  - 80文字で切る（多くのファイルシステムの 255 バイト上限。日本語は1文字3バイト）
  - 空になったら `楽譜`
  - **名前の途中の空白・ハイフンは残す**（読みやすさのため。ここを消すと既存の書き出し名が変わる）
- `stripDuplicateExtension(base, type)` … 末尾の拡張子を大文字小文字を無視して除去。
  別名（`.xml` / `.midi` / `.json`）も重複扱い。`.mid.mid` のような重ね掛けにも対応。
  ただし「拡張子だけ」の入力（`.musicxml`）は名前が消えるので取り除かない
- `buildExportFileName(input, type)` … サニタイズ → 拡張子の重複除去 → 拡張子付与

**受入条件2「拡張子はアプリが付与し、ユーザー入力の拡張子重複を防ぐ」はこの関数が担当**。

### 2. 書き出し前にファイル名を聞く（`ConfirmDialog` の入力欄モード）

新しいモーダルを作らず、既存の `ConfirmDialog`（Issue #221）に**入力欄モードを足して共用**する。
理由:

- `window.prompt` は `window.confirm` と同じ理由で使えない。埋め込みブラウザ（CDP 制御下・
  一部の WebView・キオスク環境）では表示されず必ず `null` が返り、「押しても何も起きない」になる
- `ConfirmDialog` は、モーダル表示中のキー入力を `stopPropagation` で止める守り（#238 と同型の
  回帰対策）、Enter/Escape の明示処理、`createPortal` によるページ拡縮 transform からの退避を
  すでに持っている。2枚目のモーダルを作ると、この守りが片方にだけ入る状態になる

追加した props（すべて任意。渡さなければ従来どおり「確認だけ」のダイアログ）:

| prop | 役割 |
| --- | --- |
| `inputDefaultValue` | 入力欄の初期値。**渡されたかどうかで入力欄の有無が決まる**（空文字も入力欄つき） |
| `inputLabel` | 入力欄のラベル（スクリーンリーダー向け） |
| `inputSuffix` | 入力欄の右に固定表示する文字（拡張子）。ユーザーは編集できない |

`onConfirm` の型を `() => void` から `(inputValue: string) => void` へ広げた。引数を取らない
既存のハンドラはそのまま渡せる（TypeScript では引数の少ない関数を代入できる）ので、
新規作成・作品復元など既存の呼び出し側は無変更。

開いた直後のフォーカスは、入力欄つきなら**入力欄へ移して全選択**する。既定名のままの人は
Enter だけで進め、変えたい人はそのまま打ち始められる。

### 3. 画面側の配線（`ScorePage.tsx`）

`requestExportFileName(type, run)` を1つ用意し、`書き出し` メニューの3形式が共通で通る。

```
書き出しメニュー → requestExportFileName(種類, 実処理)
  → ConfirmDialog（既定値 = sanitizeFileNameBase(title)、添え字 = 拡張子）
    → OK   : 実処理(入力値)
    → 取消 : 何もしない（従来と同じ「無言」）
```

PDF は対象外（ブラウザの印刷ダイアログが名前を決めるため、ダイアログを挟まない）。

### 4. 保存先ハンドルの使い回しを「同じ名前のときだけ」に限定

作品ファイルは一度保存すると `FileSystemFileHandle` を覚えて次回は上書きする（ダイアログなし）。
ここに名前の編集が入ると、**別名で書き出したつもりが元のファイルを黙って上書きする**という
事故になる（匿名化コピーというこの Issue の用途では致命的）。

そこで `performExportFile` は、覚えているハンドルの `name` が今回のファイル名と一致するときだけ
使い回し、違えば `null` を渡して保存先ダイアログを出し直す。

## 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/utils/exportFileName.ts` | 新規。ファイル名の組み立て |
| `src/utils/fileStorage.ts` | ローカルの `safeFileName` を廃止し `buildExportFileName` へ |
| `src/utils/musicXmlExport.ts` | `downloadMusicXml` の名前組み立てを共通化（**サニタイズが新たに効く**） |
| `src/utils/midiExport.ts` | `downloadMidi` も同様 |
| `src/components/ConfirmDialog.tsx` | 入力欄モードを追加 |
| `src/App.css` | 入力欄の見た目（`.confirm-dialog-input-*`） |
| `src/components/ScorePage.tsx` | `requestExportFileName` と3経路の配線、ハンドル使い回しの限定 |

### 挙動が変わる点（意図した変更）

- 書き出し（ファイル / MusicXML / MIDI）を選ぶと、ダウンロードの前に確認ダイアログが1枚挟まる
- タイトルが空のときの作品ファイル名が `score.score.json` → `楽譜.score.json` に変わる
  （MusicXML / MIDI の既定名と同じ「楽譜」へ統一）
- タイトルに使えない文字が入っている場合、MusicXML / MIDI の名前もサニタイズされる（従来は素通し）
- **書き出される中身（JSON / XML / MIDI バイト列）は一切変えていない**（受入条件4）

## 受入テスト

| ファイル | 内容 |
| --- | --- |
| `src/utils/exportFileName.test.ts` | サニタイズ・拡張子の重複除去・既定名（受入条件2の正本） |
| `src/components/ScorePageExportFileName.test.tsx` | 画面まで通した受入条件1・2・3、キャンセル、ハンドル使い回しの限定 |

`ScorePageExportFileName.test.tsx` は jsdom に `showSaveFilePicker` が無い状態＝**Safari と同じ
経路**で「編集した名前でダウンロードされる」ことを確かめている（受入条件3の Safari 側）。
Chrome 側（`showSaveFilePicker` あり）は同ファイルの最後のケースで確認している。

既存テストのうち、書き出しメニューを操作するもの（`ScorePageFileSaveFallback` /
`ScorePageExportFeedback` / `ScorePageTimeSigSymbolExport` / `ScorePageQuartetPartName`）は、
ダイアログの「書き出す」を押す手順を1行足した。既定名のまま押しているので、
**確認しているふるまい自体は変えていない**。
