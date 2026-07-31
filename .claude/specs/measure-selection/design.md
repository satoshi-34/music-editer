# 設計書: 小節選択の操作性改善（ドラッグ範囲選択・他ツール中の Shift+クリック・ハイライト強調）

Issue #145。運用者から挙がった3点の指摘に対応する。

1. 小節選択ツール中まで `Shift` を要求するのは冗長（範囲を選ぶだけなのに修飾キーが要る）
2. コピー＆ペーストのためだけにツールを持ち替えるのが面倒
3. 選択ハイライト（青枠＋薄青塗り）に気づけない

## 問題点（実装前の状況）

### 1. 範囲選択が Shift+クリックのみ

`PianoSystemCanvas` の小節当たり判定（`rect.vf-hit`）は `click` だけを見ており、
`onMeasureSelect(absoluteIndex, shiftHeld)` を呼ぶ。`ScorePage` 側の `handleMeasureSelect` が
`shiftHeld` のときだけ既存 `start` を保って `end` を伸ばす。ドラッグという入力経路は無かった。

### 2. 小節選択は `Tool { mode: 'select' }` 専用

`click` ハンドラの先頭で `tool.mode === 'select'` のときだけ小節選択へ分岐していたため、
音符ツールを選んでいる間は小節を選ぶ手段が無かった。

**着手前の確認（Issue の指示）**: 五線上のマウス操作で `Shift` に別の意味が割り当てられていないかを
調べた。`src` 全体で `shiftKey` を読んでいるのは
`PianoSystemCanvas.tsx`（小節選択の範囲拡張）・`SymbolEditor.tsx`（キーボードのナッジ量）・
`pitchShiftUtils.ts`（`Shift+↑/↓` のオクターブ移動）・`ScorePage.tsx`（`Cmd+Shift+Z` 等）だけで、
**マウスクリックの `Shift` は小節選択以外に使われていない**。よって衝突なしと判断して実装した。

### 3. ハイライトが「地味」ではなく「そもそも出ていなかった」

`App.css` の

```css
.vf-hit {
  fill: transparent !important;
  stroke: none !important;
}
```

は当たり判定を必ず透明にするためのルールだが、CSS は SVG のプレゼンテーション属性より強い。
`PianoSystemCanvas` が選択中の小節に `fill="rgba(59,130,246,0.15)"` / `stroke="#3b82f6"` を
**属性で**書いても、この `!important` に負けて画面には何も出ない。

ブラウザ上で実測して確認した（選択中の rect の `getComputedStyle`）:

| 状態 | computed fill | computed stroke |
| --- | --- | --- |
| 修正前と同じ書き方（`class="vf-hit"` ＋ 属性で色） | `rgba(0, 0, 0, 0)` | `none` |
| 修正後（`class="vf-hit vf-measure-selected"`） | `rgba(37, 99, 235, 0.18)` | `rgb(29, 78, 216)` |

つまり指摘3は「強調が足りない」ではなく「選択しても見た目が変わらない」状態だった。

## 修正設計

すべて `PianoSystemCanvas` 側の入力処理と CSS で完結させ、選択状態のデータ構造
（`selectedMeasures = { start, end }`）と、選択後の操作（Cmd+C/V・移調・小節挿入削除）は変更しない。
4譜種（単旋律・ピアノ・弦楽四重奏・編成譜）はすべて `PianoSystemCanvas` を通るため、
入力処理を1か所直せば全譜種に効く。

### 1. ドラッグ範囲選択

新しいコールバック `onMeasureRangeSelect?(startIndex, endIndex)` を追加し、
小節の当たり判定へ `mousedown` / `mouseenter` を付けた。

- `mousedown`（小節選択ツール中・左ボタン・Shift なし）: 押した小節を `measureDragAnchorRef` に記録
- `mouseenter`（ドラッグ中）: アンカーと今の小節を小さい順に並べて `onMeasureRangeSelect` を呼ぶ
- `window` の `mouseup`: アンカーを消す（譜面の外で指を離しても確実に終わるように）

**ドラッグ状態を state ではなく ref に持つ理由**: 選択が変わるたびに描画 useEffect が SVG を
作り直すため、`mousedown` を受けた rect はドラッグの途中で消える。ref なら作り直されても値が残る。

**音符の当たり判定にも同じ処理を付ける理由**: `.vf-note-hit` は小節背景より手前にあるので、
音符の上を通った瞬間に `mouseenter` が途切れてしまう。同じ `attachMeasureSelectDrag()` を
`.vf-note-hit` にも付けて、音符が詰まった小節でもドラッグが続くようにした。

**無限ループ対策**: ドラッグ中は同じ範囲のまま何度も `onMeasureRangeSelect` が呼ばれる。
`ScorePage` の `handleMeasureRangeSelect` は範囲が変わらないとき前の state をそのまま返す。
新しいオブジェクトを返すと「再描画 → 要素の作り直し → `mouseenter` 再発火」を往復し続けてしまう。

**ドラッグ直後の click 対策（ブラウザ確認で見つけた不具合）**: 実ブラウザでは、ドラッグの終わりに
`click` が飛んでくる場合と飛んでこない場合がある（押した rect が再描画で作り直されると、
`click` の発火先が親要素になるため rect のハンドラは呼ばれない）。

- 飛んでくる場合: そのまま処理すると範囲選択が単一選択へ戻ってしまう
- 飛んでこない場合: 「次の click を読み飛ばす」フラグ（`measureDragMovedRef`）が残ってしまい、
  **次の1クリックが無反応になる**（編成譜・弦楽四重奏で実際に再現した）

そのためフラグは「click で1回だけ消費する」ことに加えて、**新しい `mousedown` の先頭で必ずリセット**
している（早期 return より前でリセットするのがポイント。押したときのツールに関係なく捨てる）。

**「2クリック目で範囲拡張」方式を採らない理由**: Issue のトリアージ済みの設計判断どおり、
選び直し（別の小節を単一選択したいだけ）の操作と区別できなくなるため。

### 2. 他ツール中の Shift+クリック

小節背景と音符、どちらの `click` ハンドラでも先頭で

```ts
if (isSelectTool || event.shiftKey) { onMeasureSelect?.(absI, event.shiftKey); return; }
```

とした。音符ツール中に `Shift` を押しながらクリックしても、音符の配置・選択は起こらない。

`shiftHeld` はそのまま渡すので、**他ツール中の Shift+クリックも「選択済みなら範囲拡張」**として
振る舞う（1回目で単一選択 → 2回目で範囲）。選択後の操作（Cmd+C/V・移調・挿入削除）は
従来の選択と完全に同じ state を使うので違いはない。選び直したいときは `Escape` で解除する。

**副作用として変わる挙動（正直に記録）**: 小節選択ツール中に音符の上をクリックしたとき、
これまでは音符の選択・挿入処理へ流れていたが、今後は「その小節の選択」になる。
小節選択ツールの目的からするとこちらが自然で、ドラッグ範囲選択とも整合するため意図的に変更した。

### 3. ハイライトの強調

選択中の小節にだけクラス `vf-measure-selected` を足し、`App.css` に

```css
.vf-hit.vf-measure-selected {
  fill: rgba(37, 99, 235, 0.18) !important;
  stroke: #1d4ed8 !important;
  stroke-width: 3;
}
```

を追加した。クラス2つぶんの詳細度で `.vf-hit` の `!important` に勝てるので、選択中だけ色が出る。

**印刷・PDF書出に出ないこと**: `@media print` の
`.print-page svg rect.vf-hit`（詳細度がさらに上）と、印刷プレビュー用の
`.print-preview .print-page svg rect.vf-hit` が透明へ戻すため、既存どおり出力には出ない。

## 影響範囲

- `src/components/PianoSystemCanvas.tsx`: `onMeasureRangeSelect` prop、ドラッグ用の2つの ref、
  `attachMeasureSelectDrag()`、小節背景・音符の `click` の先頭分岐、選択中のクラス付与
- `src/components/ScorePage.tsx`: `handleMeasureRangeSelect`（同じ範囲なら state を更新しない）と
  4譜種への配線
- `src/components/SingleStaff.tsx` / `PianoStaff.tsx` / `QuartetStaff.tsx` / `EnsembleStaff.tsx`:
  `onMeasureRangeSelect` の中継のみ
- `src/App.css`: `.vf-hit.vf-measure-selected` の追加
- `src/components/Palette.tsx`: 小節選択ボタンの説明文（ドラッグ・Shift+クリックを追記）
- 新規テスト: `src/components/PianoSystemCanvasMeasureSelect.test.tsx`
- データモデル（`MeasureData` / 保存データ / MusicXML）への変更なし

## 動作確認（ブラウザ・4譜種）

| 譜種 | ドラッグ範囲選択 | 他ツール中の Shift+クリック |
| --- | --- | --- |
| ピアノ | 1〜3小節目 → ハイライト6個（3小節 × 2段） | 単一選択 → 2回目で範囲拡張。音符は増えない |
| 単旋律 | 1〜3小節目 → 3個 | 単一選択。音符は増えない |
| 弦楽四重奏 | 1〜3小節目 → 12個（3 × 4パート） | 選択できる |
| 編成譜 | 1〜3小節目 → 24個（3 × 8パート） | 選択できる（ドラッグ直後でも反応する） |

あわせて確認したこと:

- ドラッグで選んだ範囲を `Cmd+C` → 別の小節をクリック → `Cmd+V` で貼り付けられ、`Cmd+Z` で戻る
- 音符ツールの通常クリック（Shift なし）は従来どおり音符が置かれる
- コンソールエラーなし
