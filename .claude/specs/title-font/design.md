# タイトルまわりのフォント選択（Issue #342）

2026-08-22。弟インタビュー回答5（#89）:「Finaleはフォントが少なく不便。Wordくらいのフォントが欲しい」。

## 問題

タイトル・サブタイトル・作者欄の書体は App.css の `--score-text-font`（浄書セリフ体）固定で、
利用者が変えられない。

## 修正設計

- **第1弾は限定リスト**（Issue 側で Codex レビュー済みの仕様）。「Wordくらいの種類」を
  目指すと端末間再現性・PDF埋め込み・ライセンスが別課題になるため:
  - システム標準スタック4種（明朝/ゴシック/欧文セリフ/欧文サンセリフ）
  - Google Fonts 2種（Noto Serif JP / Noto Sans JP）— 選んだときだけ `<link>` を1回注入。
    オフライン時はスタック後続のシステムフォントへフォールバック
- 一覧の正本は `src/utils/titleFontOptions.ts` の定数1か所（追加は1行）。
  `resolveTitleFontOption(id)` は未知 id・未指定を既定へ倒す＝読込側の後方互換はこれだけで済む
- **適用は CSS 変数1本**: ScorePage がページヘッダーへ `--title-font-override` を注入し、
  App.css の `.score-title` / `.score-subtitle` / `.score-credit` / `.page-title` が
  `var(--title-font-override, 従来値)` で読む。**既定（id='default'）はスタックが空文字で
  変数を注入しない**＝既存譜面の見た目は1pxも変わらない。印刷・PDFはCSS変数がそのまま効く
- 音符・記号のフォント（Bravura系）には一切触らない

## データ構造

- `SavedScoreData.titleFontId?: string`（省略可・トップレベル。notationMode と同じ互換規則）
- 保存経路: createSavedScoreData / saveScore（手動）/ 自動保存 / 作品スロット / フィードバック
  payload の土台 — すべて createSavedScoreData の末尾引数として通す
- 読込経路: 手動読込・自動保存復元・ファイル取込の3経路 + 新規リセット。
  いずれも `data.titleFontId ?? DEFAULT_TITLE_FONT_ID`

## 影響範囲

- ScorePage（state・保存/読込5+3箇所・楽譜設定タブのセレクト・ヘッダー style）
- utils/titleFontOptions.ts（新設）・utils/storage.ts（スキーマ+検証）・hooks/useScoreStorage.ts
- App.css（フォント指定4箇所を var() フォールバック化）
- テスト: titleFontOptions.test.ts（既定＝上書きなし・id一意・link注入1回）、
  storage.test.ts（保存往復・旧データ互換・型検証）

## 経緯

- 受入条件「既存譜面の見た目が1pxも変わらない」を「変数を注入しない」で満たす設計にした。
  既定にもスタック文字列を持たせて常に注入する案は、--score-text-font との二重管理になるため不採用

## Codex round1 対応（2026-08-22）

- **印刷前にWebフォントの読み込みを待つ**（P1）: handleExportPdf を async 化し、
  waitForTitleFontReady（新設）で document.fonts.load をスタック先頭 family 名で待つ。
  タイムアウト付き（既定2秒）でオフラインでも印刷は止まらない（フォールバック書体で出る）。
  システムスタックのフォントは即 resolve
- **未知IDの読込時正規化**（P2）: 読込3経路の `?? DEFAULT` を `resolveTitleFontOption(id).id` へ。
  一覧から消えたIDが state に残ってセレクトが空欄になり、そのIDが再保存され続けるのを防ぐ
