# 自由注釈テキスト（音符に紐づかないテキスト）設計書

対応 Issue: #421 「任意の位置に置けるテキストボックス（自由注釈）」

## 問題

これまでのテキスト（歌詞・コード記号・テンポ表記・発想標語・運指）はすべて
**音符（NoteEvent）にぶら下がる**形でしか置けなかった。楽譜には音符に紐づかない
自由テキストの需要がある（献呈、演奏メモ、リハーサル指示、脚注、段間の説明書きなど）。

具体的な目標は運用者トリアージ（2026-08-27）で確定した月光ソナタ第1楽章冒頭の指示文:

- 五線上の「Si deve suonare tutto questo pezzo delicatissimamente e senza sordini」
  （イタリック・1小節目アンカー・上側）
- 左手五線上の「sempre pianissimo e senza sordini」

## アンカー方式の裁定（運用者トリアージ）

**小節アンカー＋オフセット方式**で確定。ページ絶対座標にしない理由は、段割り・レイアウトを
変えたときにテキストだけ紙面に取り残されるため（Finale のページテキストで嫌われる挙動）。

このリポジトリには既に「小節に属する属性」を保持する場所（`MeasureData.rehearsalMark` /
`bpm` / `keySignature` / `clef`）があり、描画は毎回のレイアウト計算のなかで
「その小節を描いた Stave の座標」を基準に配置している。**同じ場所に同じ流儀で載せれば、
リフロー追従は書かなくても手に入る**（段あたり小節数を変えても、その小節を描く場所に
一緒に付いていく）。これが今回の設計の中心。

## データ構造

`src/types/storage.ts`

```ts
export interface FreeTextAnnotation {
  text: string;        // 1行のテキスト（空文字列は「注釈なし」＝フィールドごと削除）
  offsetX?: number;    // 既定位置からの横ズレ（px、正で右）。省略時 0
  offsetY?: number;    // 既定位置からの縦ズレ（px、正で下）。省略時 0
  scale?: number;      // 既定サイズに対する倍率（0.25〜4）。省略時 1
}
```

`MeasureData.freeText?: FreeTextAnnotation` として**パートごとの小節データ**に持つ。

- **なぜ「パートごと」か**: Issue 本文の v1 案は「partIndex 不要・システム単位」だったが、
  トリアージの受入条件が「1小節目の上**と、大譜表の下段側の上**へ置ける」ことを求めている。
  システム単位（＝最上段の上だけ）では左手五線の上に置けない。途中クレフ変更
  （`MeasureData.clef`）と同じ「クリックした段自身の小節データに保存する」流儀にそろえた。
  本文とトリアージが食い違う点なので、トリアージ優先（AGENTS/SKILL の信頼境界ルール）。
- 1小節・1パートにつき1つ。複数行・複数配置は v2（下記「積み残し」）。

## 描画

`PianoSystemCanvas.tsx`（全譜種がこの1コンポーネントを通るので実装は1箇所）

1. 収集: Stave を描くループで、`measure.freeText` があれば
   `freeTextEntries.push({ x, topY: stave.getYForLine(0), text, scale, offsetX, offsetY, partIndex, measureAbsoluteIndex })`。
   `topY` は**実際に描いた Stave** から取る（レイアウト計算の staveYs は五線1つぶん高い）。
   リハーサルマークと違い `pi === 0` に限定しない＝どの段の上にも置ける。
2. 描画: 五線上端の `FREE_TEXT_BASE_OFFSET_Y`(=22) px 上へ、
   `SCORE_TEXT_FONT_FAMILY` のイタリック・`ENGRAVING_TEXT_UNITS.expressiveText × scale` で描く。
   発想標語（expressionMarking）と同じ書体・同じイタリックにするというトリアージの指定に従う。
   ♩=XXX（36px 上）・リハーサルマーク（72px 上）より**下**の帯を使うので、同じ小節に
   3つとも付いても既定位置では重ならない。
3. 印刷: 五線と同じ SVG に描くだけなので、画面と印刷で同じ位置関係が保たれる
   （リハーサルマーク・小節番号と同じ理屈。印刷専用の分岐は書かない）。

### 自動衝突回避の対象外にする

Issue の論点「記号序列（#416）上の扱い」については、**自由注釈は衝突回避の対象外**とした。
自由注釈は「利用者が任意の場所へ置くもの」であり、勝手に押し出されると
「置いた場所に出ない」ほうが事故になるため。位置の最終決定権は offsetX/offsetY を持つ
利用者側にある。

## 操作（UI）

演奏記号タブに「T」ボタン（`{ mode: 'measureText' }`）を追加。小節をクリックすると、
その小節・その段に対する編集オーバーレイが開く（途中クレフ変更と同じ導線）。

オーバーレイ1枚で **文字・サイズ・位置** をまとめて扱う:

- テキスト入力（空欄で確定＝注釈を削除）
- サイズ（％。25〜400、空欄で100）
- 位置（横・縦 px、空欄で0）

既存の記号調整（⤢/✥）は「音符に付いた記号」を対象にした仕組み
（`appendSymbolHitRegion` が partIndex/measureIndex/eventIndex/voiceIndex で同定する）
なので、音符を持たない自由注釈はその台帳に載らない。**別系統を増やすのではなく、
1枚のオーバーレイに寄せる**ことで、追加する状態は overlay 1種類だけに収めた。

## 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/types/storage.ts` | `FreeTextAnnotation` 追加、`MeasureData.freeText?` 追加 |
| `src/utils/freeTextUtils.ts` | 新規。入力の正規化（trim・クランプ）と保存データの検証 |
| `src/utils/storage.ts` | `validateMeasureData` に `freeText` の検証を追加 |
| `src/components/Palette.tsx` | `{ mode: 'measureText' }` とツールボタン |
| `src/utils/uiContextBar.ts` | ツール名ラベル |
| `src/components/PianoSystemCanvas.tsx` | 収集・描画・クリック導線・オーバーレイ・確定処理 |

旧データ（`freeText` を持たない譜面）は `undefined` のまま何も描かれないので、見た目は 1px も変わらない。

## 受入テスト（実装の合格基準）

`src/utils/freeTextUtils.test.ts`

1. 空文字列・空白のみ → `undefined`（フィールドごと削除）
2. 前後の空白は落として保持する
3. サイズは 0.25〜4 にクランプ、空欄・不正値は 1
4. オフセットは ±MAX にクランプ、空欄・不正値は 0
5. `isValidFreeTextAnnotation`: 非文字列 text・NaN・範囲外 scale を弾く

`src/components/PianoSystemCanvasFreeText.test.tsx`

6. 1小節目に `freeText` を置くと、その段の五線上端より上にイタリックのテキストが描かれる
7. 大譜表の下段（partIndex 1）に置いた注釈は、下段の五線の上に描かれる（上段のではない）
8. 段あたり小節数を変えても、注釈は同じ小節（＝移動後の描画位置）に付いてくる
9. `scale` / `offsetX` / `offsetY` が font-size と x/y に効く
10. `freeText` の無い譜面には注釈テキストが1つも描かれない（回帰防止）

`src/utils/storage.test.ts`（追記）

11. `freeText` 付きの譜面が保存→読込で往復する
12. 壊れた `freeText`（text が数値・scale が範囲外）を持つデータは読込で弾かれる

## 積み残し（v1 の外）

- **複数行テキスト**: v1 は単一行（Issue 本文で「v1 は単一行でも可」と明示）
- **ページ固定アンカー**（タイトル脇など紙面固定の用途）: Issue の論点3のハイブリッド案。v2
- **ドラッグでの移動**: v1 は数値入力（オーバーレイ）のみ。音符に付いた記号のドラッグ移動は
  `appendSymbolHitRegion` の台帳経由なので、自由注釈をそこへ載せる改修が別途必要
- ~~**フォント指定**~~: Issue #432 で対応済み（下記「書体選択」）
- **MusicXML 入出力**: `<direction><words>`（小節付き）への対応は未着手
- **1小節に複数の注釈**: v1 はパート×小節につき1つ

## Codex round1 対応（2026-08-27）

- **オーバーレイの対象持ち越し（P1）**: 入力欄は非制御（defaultValue）のため、開いたまま別の小節をクリックすると前の入力値が残り別対象へ上書き保存された。オーバーレイ root に `key={part-measure}` を付け、対象が変わったら DOM ごと再マウントする
- **ScorePage 配線テスト（P1）**: ScorePageFreeText.test.tsx を追加。パレット→小節クリック→入力→自動保存の実経路で、受入条件（右手上・左手上の指示文2つ／対象切替時の持ち越し無し／空欄確定での削除と再編集時の現在値表示）を固定

## 矢印キーでのライブ移動（2026-08-27 実機所感）

⤢/✥ の記号調整と同じ手触りに揃える: オーバーレイのどの入力欄（本文・サイズ・横・縦）に
フォーカスがあっても、矢印キーで 1px（Shift で 10px）動く。押している間は横・縦の入力欄と
**譜面上の SVG テキストを DOM 直更新**でライブ追従させ（描画時に `data-free-text` /
`data-base-x/y` を持たせて対象を特定）、保存は Enter の1回だけ（Undo も1回で戻る）。
オフセットは ±MAX_FREE_TEXT_OFFSET にクランプ。テスト: ScorePageFreeText.test.tsx。

## クリック選択（2026-08-27 実機所感・同日2件目）

演奏記号タブでは、**置いた注釈テキストを直接クリック**して編集オーバーレイを開ける
（他の記号のクリック選択 #398 と一貫させる。従来はTツールを選び直して小節を押すしかなかった）。
描画後に `text[data-free-text]` の bbox へ透明の判定 rect（`symbol-hit-region vf-screen-only`）を
重ねる方式。getBBox が使えない環境（jsdom 等）では x/y・フォントサイズからのフォールバック見積もり。

## 書体選択（Issue #432）

### 問題

#421 の当初仕様にあった「フォントは #420 のタイトル書体リストを共用」が v1 実装で落ちていた
（#420 が当時未マージだったため）。指示文（senza sordini 型）はイタリックのセリフ体が浄書慣習
として正しいが、献呈・出典・説明書きでは書体を変えたい。

### 修正設計

**データ**: `FreeTextAnnotation.fontId?: string`。`titleFontId` と同じ後方互換パターンで、
**省略時＝既定＝従来のイタリックのセリフ体**。未知の id（手書き JSON・将来の一覧変更）は
読み込み時に既定へ倒す。検証（`isValidFreeTextAnnotation`）は「文字列であること」だけを見て、
一覧に無い id でも**弾かない**——弾くと「選択肢を1つ減らしただけで昔のファイルが開けない」
ことになってしまうため。

**選択肢の共用**: 一覧は `TITLE_FONT_OPTIONS` をそのまま使う（別リストを作らない）。
Webフォントの読み込みも `ensureTitleFontLoaded` / `waitForTitleFontReady` を共用する。
「同じ目的の2枚目の実装」を作らないのが要点で、書体を追加するときは #420 と同じ 1 か所
（`titleFontOptions.ts`）を触れば自由注釈にも増える。

**描画**: `resolveFreeTextFont(fontId)` が font-family / font-style を決める1か所。

| fontId | font-family | font-style |
| --- | --- | --- |
| 未指定・`default`・未知の id | `SCORE_TEXT_FONT_FAMILY` | `italic` |
| 一覧にある id | その選択肢の `stack` | `normal` |

**書体を選んだときに italic を外す**のは、選んだ書体そのものの見た目を見せるため
（イタリックを重ねるとブラウザの合成斜体になり品位が落ちる。#420 で太さの合成を避けたのと同じ理由）。
描画時に `ensureTitleFontLoaded` を呼んで `<link>` を1回だけ注入する。読み込み前はスタックの
後続フォント（Hiragino 等）で表示され、完了後に自動で切り替わる。

**UI**: 自由注釈オーバーレイに書体セレクトを1行追加。既定の表示名だけはタイトル側の
「既定（浄書セリフ体）」ではなく **「既定（イタリック・指示文向き）」** にする（自由注釈での
既定はイタリック込みという意味なので、同じ文言だと誤解を招く）。セレクトでは**矢印キーを
横取りしない**——矢印は選択肢の移動に要るため（位置の微調整は他の3つの入力欄で従来どおりできる）。
ライブプレビューは実装していない: 確定すれば即座に描き直されるうえ、プレビューを入れると
Escape で閉じたときの復元（#429 round1 P2 と同じ型のバグ）を font まで面倒見る必要が出るため。

**印刷・PDF**: `handleExportPdf` が、タイトル書体に加えて**譜面内で実際に使われている自由注釈の
書体ごとに** `waitForTitleFontReady` を待つ。待たずに印刷すると読み込み前のフォールバック書体が
PDF へ固定される（#420 Codex round1 P1 と同じ）。Google Fonts は unicode-range で分割配信される
ため、その書体で描かれる文字を連結して渡す。

### 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/types/storage.ts` | `FreeTextAnnotation.fontId?: string` |
| `src/utils/freeTextUtils.ts` | `buildFreeTextAnnotation` / `resolveFreeTextAnnotation` / `isValidFreeTextAnnotation` に fontId、`resolveFreeTextFont` を新設 |
| `src/components/PianoSystemCanvas.tsx` | 収集・描画（font-family/font-style）・オーバーレイの書体セレクト・確定処理 |
| `src/components/ScorePage.tsx` | 印刷前のWebフォント待ち |

既定のまま置いた既存の注釈は `fontId` を持たず、描画も従来と同じ属性値になるので**見た目は 1px も変わらない**
（回帰テストで固定）。

### 受入テスト

`src/utils/freeTextUtils.test.ts`

- 既定・未指定・未知の id は `fontId` をフィールドごと省く（旧データと同じ形の JSON）
- 既定以外は `fontId` として保存する
- `resolveFreeTextFont`: 既定→セリフ体＋italic、選択→スタック＋normal、未知→既定
- 検証は文字列の fontId を受け入れ（一覧に無い id も可）、文字列でないものを弾く

`src/components/PianoSystemCanvasFreeText.test.tsx`

- `fontId` の無い注釈は従来どおり `SCORE_TEXT_FONT_FAMILY` ＋ italic（回帰防止）
- `fontId` 指定で font-family がその書体になり italic が外れる／未知の id は既定へ倒す
- Webフォントの書体で Google Fonts の `<link>` が1回だけ入る

`src/components/ScorePageFreeText.test.tsx`（配線）

- 書体を選んで確定→保存され、SVG の font-family が変わる。開き直すと現在の書体が選ばれている
- 書体を選ばずに置いた注釈は `fontId` を保存せず、従来どおりイタリックのセリフ体で描かれる

### 積み残し

- 一覧は**タイトル書体と完全に同じ**。自由注釈向けだけの書体（音楽記号を含む Unicode 対応フォント等）は
  入れていない。Issue #432 のコメントにある「テキスト記号をカスタム記号ライブラリへ寄せる」方向
  （#89 と合流）が出てきたときに、あらためて一覧の分離を検討する
- 1小節1注釈・単一行という v1 の制限はそのまま

## #432 Codex round 1 対応（2026-08-28）

- **Webフォント読み込み後の判定作り直し**: クリック判定 rect は描画時の getBBox() 実寸から
  作られるため、フォールバック書体で測ったままだと読み込み後に字面とずれる。
  「使われている書体ID＋文字列」の署名（useMemo）を監視し、waitForTitleFontReady の完了で
  tick を進めて描画 effect を再実行する。回帰テストは PianoSystemCanvasFreeText.test.tsx
  「フォント読み込み完了後に判定 rect が実寸で作り直される」。
  **検証の正直な記録**: tick を deps から外しても現状はテストが通る（描画 effect の依存に
  レンダーごとに identity が変わる値が含まれており、再レンダーだけで再描画されるため）。
  tick の役割は「フォント読み込み完了時に再レンダー自体を起こす」ことにある
- **PDF書き出しの待機の配線テスト**: handleExportPdf の注釈フォント集約は、削除しても他の
  テストが通ってしまう。ScorePageFreeText.test.tsx に「fonts.load へ注釈本文が渡る・
  読み込み完了までは print しない・完了後に print する」を追加（集約を外すと失敗する
  ことを負のテストで確認済み）
- README の矢印キー説明を「文章・文字サイズ・横・縦の入力欄で効く（書体リストでは
  選択に使われる）」へ限定
- **スクリーンショット添付は未達**: ブランチの dev サーバをアプリ内ブラウザで駆動し、
  注釈へ noto-serif-jp を設定 → svg text の font-family/font-style と <link> 注入を DOM で
  実測確認した。ただし本セッションの環境ではブラウザペインが非表示でスクリーンショットを
  取得できず、リポジトリに Playwright 等の撮影手段も無いため画像の添付は行っていない
  （行き止まりは喋る: 撮影は運用者の実機確認または撮影手段の導入後に補完する）

## #432 Codex round 2 対応（2026-08-28）

- **再描画トリガーは無期限待機・PDFは2秒維持**: 再描画用のフォント待機に印刷用の
  waitForTitleFontReady（2秒タイムアウト）を流用していたため、読み込みが2秒を超える
  遅い回線ではフォールバック寸法のまま再計測して終わり、その後の実フォント切り替えで
  再描画されなかった（round2 P1）。waitForTitleFontReady に `timeoutMs = Infinity` の
  経路を追加し、**再描画トリガーだけ**実際の読み込み完了まで待つ。PDF書き出しの待機は
  従来どおり2秒タイムアウト（オフライン等で印刷を永久に止めないため）。
  回帰テスト「フォント読み込みが2秒を超えても、完了時に判定 rect が作り直される」
  （2.5秒遅延モック）を追加し、Infinity 指定を外すと失敗することを負のテストで確認済み
