# 楽譜編集・選択・休符補完 設計ノート

このメモは、音符入力まわりのコードを初めて読む人が迷いやすい点をまとめたものです。

特に大事なのは、**見た目の青枠**、**実際のクリック範囲**、**保存される音符データ**が別々に扱われていることです。

---

## 関連ファイル

| 役割 | ファイル |
|---|---|
| 単旋律譜の描画・入力 | `src/components/StaffCanvas.tsx` |
| ピアノ譜・弦楽四重奏・編成譜など複数段の描画・入力 | `src/components/PianoSystemCanvas.tsx` |
| パート編集ウィンドウ、再生、保存、譜面種別の管理 | `src/components/ScorePage.tsx` |
| 選択枠・透明ヒット領域などの見た目 | `src/App.css` |
| 音色の種類と内蔵音源設定 | `src/audio/SoundSource.ts` |
| SoundFont の楽器名マッピング | `src/audio/SoundFontEngine.ts` |

---

## データの基本形

音符も休符も `NoteEvent` として小節の `events` 配列に入ります。

```ts
{
  dur: '4',
  keys: ['c/4'],
  isRest: false
}
```

- `dur` は音価です。`'4'` は四分、`'8'` は八分です。
- `keys` は音高です。和音では複数入ります。
- 休符でも `keys` を持ちます。これは音高ではなく、休符を五線のどの高さに描くかの目安です。

---

## クリック範囲と選択枠は別物

音符や休符をクリックしやすくするため、SVG 上には透明な `rect.vf-note-hit` を置いています。

この透明 rect が実際のマウスイベントを受けます。青い枠 `rect.vf-note-selected` は、現在選択中の対象を見せるだけです。

```text
透明ヒット領域: クリック・ホバーを受ける
青い選択枠: 見た目だけ、pointer-events: none
```

そのため、青枠を大きくしてもクリック範囲は変わりません。クリックしやすさを変える場合は、各 Canvas の先頭付近にある定数を調整します。

### 単旋律譜

`src/components/StaffCanvas.tsx`

- `CELL_PAD`: 音符イベント全体の左右クリック範囲を広げる
- `HIT_MIN_W`: クリック範囲の最小幅
- `CHORD_HIT_PAD`: 和音追加・和音内個別選択の横方向の余白
- `CHORD_LEDGER_TOP` / `CHORD_LEDGER_BOT`: 和音操作として扱う上下範囲
- `SELECTED_KEY_*` / `SELECTED_EVENT_PAD`: 青枠の見た目だけ

### 複数段譜

`src/components/PianoSystemCanvas.tsx`

同じ名前の定数があります。ピアノ譜・弦楽四重奏・編成譜は基本的にこちらを通ります。

---

## 和音内の個別音選択

和音内の音を個別選択するときは、クリックした Y 座標をそのまま比較しません。

1. `snapLineBySpacing()` または `snapLine()` で、クリック位置を五線の線/間に丸める
2. `findKeyIndexAtLine()` で `keys[]` のどの音と一致するか調べる
3. 一致したら `selected.keyIndex` に保存する

`selected.keyIndex` があると、Delete や矢印キー、臨時記号は和音全体ではなくその 1 音だけに効きます。

### 五線から遠い音符（複数段譜, Issue #218）

`CHORD_LEDGER_TOP` / `CHORD_LEDGER_BOT`（五線 ± 3 加線）の外にいる音符は、
この固定範囲のままだと符頭の中心をクリックしても選択できません（ヘ音記号の `g/4` など）。

そのため `PianoSystemCanvas.tsx` では、当てはまる音符に限って判定範囲を
「その音符が持つ key の線 ± 1 ライン」まで広げます（`noteKeyLineExtent()`）。

- 広がるのはヒット領域と「既存の符頭への一致判定」だけです
- 和音追加ゾーンと、新しく置ける音域は従来のままです
- 広げたぶんは隣のパートとの中間線でクリップします（上のパートがクリックを奪わないため）

```ts
type SelectedNote = {
  measure: number;
  index: number;
  keyIndex?: number;
};
```

`keyIndex` がない選択は、音符イベント全体の選択です。

---

## 休符の編集

休符は 1 回目のクリックで選択されます。これは Delete や矢印キーの対象にできるようにするためです。

同じ休符をもう一度クリックしたとき、選択中の音価ツールに応じて置換または分割します。

例:

- 16分音符ツールで 16分休符をクリック: 16分音符へ置換
- 16分音符ツールで 8分休符の右半分をクリック: 16分休符 + 16分音符
- 16分音符ツールで 8分休符の左半分をクリック: 16分音符 + 16分休符

左右どちらに差し込むかは、クリック判定用の大きな透明範囲ではなく、実際に見えている休符記号の中心で決めます。
これにより、小節の左端やクレフ側まで広がったヒット範囲の影響で、右側をクリックしたつもりなのに前へ挿入される誤判定を避けます。

この処理は `buildRestEditReplacement()` が担当します。

---

## 自動休符補完

ユーザーが次の小節を編集し始めたとき、それ以前の未完成小節には自動で休符を足します。

担当関数:

- `buildRestEventsForBeats()`
- `fillPriorMeasureRests()`

重要なルール:

- 今クリックした小節そのものは補完しません
- その前の小節だけを拍子ぶんの長さへ整えます
- 複数段譜では、編集しているパートだけを補完します
- 既に拍が埋まっている小節には何もしません

これにより、空白のあるまま次の小節へ進んでも、前の小節が楽譜として成立しやすくなります。

---

## カーソルプレビューと加線

ホバー時の横線・点・加線は、実際に音符を置く前の見た目です。

- 五線内: 横線と点
- 五線の外: 追加で短い加線を表示
- 和音ゾーン: 縦ストライプ表示

プレビューは `pointer-events: none` なので、クリックを邪魔しません。

---

## パート編集の別ウィンドウ

パート編集 UI は `ScorePage.tsx` で `window.open()` した別ウィンドウへ表示します。

React 的には別アプリを起動しているわけではなく、`createPortal()` で親画面の React UI を別ウィンドウの DOM へ差し込んでいます。

注意点:

- 別ウィンドウは親の CSS を自動共有しません
- 必要な CSS は `ScorePage.tsx` 内で style タグとして注入します
- ブラウザのポップアップブロックがあると開けない場合があります
- 閉じるときは Window と React state/ref の両方を片付けます

---

## クラリネット音色

`InstrumentType.CLARINET` は次の場所で使われます。

- `SoundSource.ts`: 内蔵音源のシンセ設定
- `SoundFontEngine.ts`: SoundFont 楽器名 `clarinet` への変換
- `PlaybackControls.tsx`: UI ラベルと木管グループ
- `InstrumentSelector.tsx`: 楽器説明
- `instrumentationPresets.ts`: B♭クラリネットのプリセット

内蔵音源ではクラリネット専用サンプルではなく、Tone.js のシンセ設定で木管らしい丸い音へ寄せています。SoundFont 使用時は `clarinet` のサンプルを読みます。

---

## 調整するときの見方

1. クリックしづらい場合: `CELL_PAD` / `HIT_MIN_W`
2. 和音追加になりにくい場合: `CHORD_HIT_PAD`
3. 五線外の和音操作範囲を変えたい場合: `CHORD_LEDGER_TOP` / `CHORD_LEDGER_BOT`
   （複数段譜では、遠い音符の選択だけ `noteHitLineRange()` がここから自動で広げます）
4. 青枠の見た目だけ変えたい場合: `SELECTED_KEY_*` / `SELECTED_EVENT_PAD`
5. 和音内の個別選択が厳しすぎる場合: `KEY_SELECT_LINE_EPS`

迷ったら、まず青枠ではなく透明な `.vf-note-hit` がクリックを受けていることを思い出してください。
