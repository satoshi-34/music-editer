# タイトルまわりのフォント選択（Issue #342）

2026-08-22。ユーザーインタビュー回答5（#89）:「Finaleはフォントが少なく不便。Wordくらいのフォントが欲しい」。

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

## Codex round2 対応（2026-08-22）

- **フォント読込待ちの厳密化**（P1）: fonts.load の第2引数省略は空白1文字ぶんの face しか
  対象にせず、unicode-range 分割配信の Google Fonts では日本語グリフの完了を保証しない。
  また stylesheet 解釈前は face 未登録のまま即 resolve する。対応:
  ①注入 <link> の onload を Promise 化（ensureTitleFontLink）して先に待つ
  ②fonts.load へ実際に印刷される文字列（タイトル・サブタイトル・作者欄の連結）を渡す
  ③標準/太字（600）の両ウェイトを対象 ④最後に document.fonts.ready も同じタイムアウト内で待つ。
  テストは「link 読込前に fonts.load が呼ばれない」順序と、文字列・両ウェイトの引数を固定

## 第2段: 書体の拡充と文字サイズ・太さの調整（Issue #420・2026-08-27）

### 問題

ユーザーインタビュー（2026-08-26）の「Finale は Word くらいのフォントの多様さが欲しい」（羅針盤④）。
第1段は提供7択（システムスタック4＋Noto 2＋既定）に絞っており、浄書向きの書体が足りない。
また文字の大きさ・太さがまったく調整できず、市販譜の見出しの再現度が上げられなかった。

### 修正設計

#### 1. 書体の拡充（TITLE_FONT_OPTIONS へ10種追加）

既存の `googleFontFamily` 機構をそのまま使い、定数へ10行足すだけにした。

- 欧文6: EB Garamond / Cormorant Garamond / Playfair Display / Libre Baskerville / Lora / Montserrat
- 日本語4: しっぽり明朝 / Zen Old Mincho / BIZ UDP明朝 / Zen Kaku Gothic New

選定基準は **400（標準）と 700（太字）の両方を配信している書体だけ**にしたこと。
太さトグルで 700 を使うため、700 を持たない書体を混ぜるとブラウザの合成太字になって品位が落ちる。
既存の Noto 2種のクエリも `wght@400;600` → `wght@400;600;700` へ広げ、
`waitForTitleFontReady` の待ち対象にも 700 を追加した（印刷時に太字が
フォールバック書体で焼き付くのを防ぐため。第1段の Codex round2 P1 と同じ理由）。

#### 2. 文字サイズは「px の実値」ではなく倍率で持つ

保存データは `titleFontSize?: number`。**既定の見た目に対する倍率**（1 = 従来どおり、0.7〜1.6）。

px の実値にしなかったのは、タイトル・サブタイトル・作者欄が画面と印刷で基準サイズが違うため
（タイトルは画面 26px／印刷 24px、サブタイトルは 14px／12px）。倍率なら
`font-size: calc(26px * var(--title-font-scale, 1))` の形で画面・印刷の両方へ同じ比率で効き、
「画面では大きいのに印刷すると元のまま」が構造的に起きない。

#### 3. 太さは2つの CSS 変数を1つのトグルで動かす

保存データは `titleFontWeight?: 'normal' | 'bold'`。未指定は「従来どおり」＝タイトル行だけ太字。

CSS 側は `--title-font-weight`（タイトル行）と `--title-font-weight-sub`（サブタイトル・作者欄）の
2変数に分けてある。1変数にすると、既定の見た目（タイトル 700・他 400）と
一括指定（3つとも同じ太さ）を同時に表現できないため。
UI は3択（既定／標準／太字）で、`titleBlockStyleVars()` が両変数を同じ値で注入する。

#### 4. 既定値のときは変数を注入しない（第1段と同じ流儀）

`titleBlockStyleVars(stack, size, weight)` は、既定値の項目について**変数を1つも返さない**。
App.css のフォールバック（従来の px 値・従来の太さ）がそのまま効くので、
旧データ・未設定の譜面は 1px も見た目が変わらない。
保存データの値は `normalizeTitleFontSize` / `normalizeTitleFontWeight` を通してから state へ入れるため、
手書き JSON の未知の値（太さ）や数値でないサイズは既定へ倒れる。サイズの**範囲外は最小/最大へクランプ**する（既定へ戻すより打ち込みの意図を保てるため。#420 Codex round1 P2 で仕様と実装のどちらを正とするか確定し、クランプを正とした）。

### 影響範囲

- `utils/titleFontOptions.ts`: 書体10追加、サイズ・太さの定数/正規化/CSS変数生成を追加
- `types/storage.ts` / `utils/storage.ts`: `titleFontSize` / `titleFontWeight` の追加・検証・`createSavedScoreData` 引数
- `components/ScorePage.tsx`: state 2つ、保存4箇所・読込/復元2箇所、楽譜設定タブのスライダーとセレクト、ヘッダーへの変数注入
- `App.css`: `.score-title` / `.score-subtitle` / `.score-credit` と `@media print` の font-size を calc 化、font-weight を変数化、`.toolbar-range-value` を追加
- テスト: `titleFontOptions.test.ts`（正規化・変数生成・追加書体のウェイト指定）、
  `storage.test.ts`（保存往復・旧データ互換・型検証）、
  `engravingDefaults.test.ts`（**既存テストの regex を calc 形へ更新**）

### 既存テストを変更した理由

`engravingDefaults.test.ts` の「タイトル・作者欄が候補Aの大きさで書かれている」は
`font-size: 26px` という**リテラルの px 指定**を固定していた。倍率を掛けられるようにしたことで
指定が `calc(26px * var(--title-font-scale, 1))` になったため、regex を calc 形へ更新した。
固定したい性質（＝倍率が既定のときの基準 px 値が候補Aの数字であること）は変えていない。
あわせて印刷側（24px / 12px）にも倍率が掛かっていることを確かめる行を足した。

### やらないこと（Issue の線引きどおり）

- **記譜側（音符・強弱・記号）のフォントは Bravura 固定のまま**。衝突回避・クリック判定が
  Bravura の SMuFL メタデータで字面矩形を計算しているため（#380）、差し替えると全部狂う
- タイトル／サブタイトル／作者欄の**個別指定**はやらない（v1 はタイトルブロック一括）

## Codex round1 対応（2026-08-27・#420）

- **旧 Noto 2書体の互換ウェイト（P1）**: 配信ウェイトへ 700 を追加した影響で、太さ未指定の既存譜面が 600（旧来の実描画）→700 へ変わっていた。`TitleFontOption.legacyTitleWeight`（600）を旧 Noto 2書体に持たせ、**未指定時のみ** `--title-font-weight: 600` を注入して旧来の見た目を維持。明示的な「太字」だけが 700 になる
- **新規作成のリセット漏れ（P1）**: 書体 id しか既定へ戻しておらず、サイズ・太さが前の作品から残っていた。`setTitleFontSize`/`setTitleFontWeight` を新規作成パスへ追加
- **ScorePage 配線テスト（P1）**: ScorePageTitleFontWiring.test.tsx（設定タブ操作→CSS変数→自動保存往復→新規作成リセット、旧Notoの互換ウェイトと明示太字）。両修正とも外すとテストが落ちることを確認済み
- **範囲外サイズの仕様確定（P2）**: クランプを正とし、JSDoc・設計書を実装へ整合
