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
- **フォント指定**: トリアージの「#420 の仕組みで変更可」は、#420（PR #426）が未マージのため
  v1 では**サイズのみ**対応。書体の指定は #420 マージ後に `titleFontId` と同じ仕組みで足す
- **MusicXML 入出力**: `<direction><words>`（小節付き）への対応は未着手
- **1小節に複数の注釈**: v1 はパート×小節につき1つ

## Codex round1 対応（2026-08-27）

- **オーバーレイの対象持ち越し（P1）**: 入力欄は非制御（defaultValue）のため、開いたまま別の小節をクリックすると前の入力値が残り別対象へ上書き保存された。オーバーレイ root に `key={part-measure}` を付け、対象が変わったら DOM ごと再マウントする
- **ScorePage 配線テスト（P1）**: ScorePageFreeText.test.tsx を追加。パレット→小節クリック→入力→自動保存の実経路で、受入条件（右手上・左手上の指示文2つ／対象切替時の持ち越し無し／空欄確定での削除と再編集時の現在値表示）を固定
