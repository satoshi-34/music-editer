# 設計書: タイ／スラー（TieArc）実装

## 概要

楽譜の弧記号（タイ・スラー）を実装した。ドラッグ入力・弧の選択・形状調節（曲率・始終点・向き反転）をすべてサポートする。

旧実装（`tiedToNext: boolean` による StaveTie）から、`arcs: TieArc[]` 配列方式へ完全移行した。旧データとの後方互換は `tiedToNext` レガシーパスとして維持する。

---

## データモデル

### 変更ファイル: `src/types/storage.ts`

```typescript
export interface TieArc {
  fromKey: string;         // 開始符頭の key（例: "e/4"）
  toKey: string;           // 終了符頭の key
  toMeasureIndex: number;  // 終了音符の絶対小節インデックス
  toEventIndex: number;    // 終了音符のイベントインデックス
  kind: 'tie' | 'slur';
  cpDyOffset?: number;     // 弧曲率の縦オフセット（SVG px）
  cpDyOffset2?: number;    // 段またぎ第2セグメント（下段側）の曲率オフセット
  flipDirection?: boolean; // 向き手動反転フラグ
  startDx?: number;        // 始点X調節量（SVG px）
  startDy?: number;        // 始点Y調節量
  endDx?: number;          // 終点X調節量
  endDy?: number;          // 終点Y調節量
  breakEndDx?: number;     // 段またぎ上段セグメントの切れ目終点X調節量
  breakEndDy?: number;
  breakStartDx?: number;   // 段またぎ下段セグメントの切れ目始点X調節量
  breakStartDy?: number;
}

export interface NoteEvent {
  // ...
  tiedToNext?: boolean; // レガシー。旧データ互換のため残す
  arcs?: TieArc[];      // この音符を始点とする弧リスト（新方式）
}
```

すべてのフィールドは optional のため、既存セーブデータの読み込みに影響なし。

---

## UI / ツール

### `src/components/Palette.tsx`

`Tool` 型は判別共用体のまま変更なし:

```typescript
export type Tool =
  | { duration: DurKey; isRest?: boolean }  // 音符入力
  | { mode: 'tie' };                        // タイ／スラー入力
```

パレット下部のタイボタン（弧形 SVG アイコン）は既存実装のまま。

---

## 弧形状計算（arcUtils.ts）

`src/components/arcUtils.ts` として分離した純粋関数。`StaffCanvas` / `PianoSystemCanvas` の両方から共通利用する。

```typescript
export function computeArcGeometry(
  x1, y1, x2, y2,
  upward: boolean,
  kind: 'tie' | 'slur',
  stemDir: number,
  obstacleY: number | undefined,
  cpDyOffset: number
): { dAttr: string }
```

- **タイ**: 二次ベジェ Q。`cpY = 中点Y + (upward ? -curve : curve) + cpDyOffset`
- **スラー**: 三次ベジェ C。制御点を `span * 0.25` で左右に分けて自然な立ち上がりを出す。`obstacleY` から `clearance` 分外側に制御点を置き、符頭と最低 6px の隙間を確保する。
- 符幹との衝突判定: `(upward && stemDir > 0) || (!upward && stemDir < 0)` のときカーブ量を加算。

---

## 描画方式（drawArcPath）

各弧を **2枚重ね** で描画する。

| レイヤー | stroke-width | pointer-events | 用途 |
|---|---|---|---|
| 透明ヒットパス | 10px | stroke | クリック・ドラッグの入力領域 |
| 可視パス | 1.5px | none | 視覚表示（選択中は青 `#3b82f6`） |

さらに選択中の弧には **始点・終点ハンドル**（r=5 の青い丸）を SVG 上に描画する。

### arcGeomMap

```typescript
const arcGeomMap = new Map<string, {
  x1, y1, x2, y2,
  upward, kind, stemDir, obstacleY?,
  minNoteY?, maxNoteY?,    // 向き反転の閾値計算に使用
  startDx, startDy,        // 始点ユーザーオフセット
  endDx, endDy,            // 終点ユーザーオフセット
  cpDyOffset,              // 第1セグメントの曲率オフセット
  cpDyOffset2?,            // 第2セグメントの曲率オフセット（段またぎ時のみ）
}>();
```

キー形式: `"${fromMeasure}-${fromEvent}-${arcIndex}"`（`PianoSystemCanvas` では先頭に `${partIndex}-` が付く）。段またぎ時は `-1` / `-2` サフィックスを付けて 2 本に分割。

---

## インタラクション

### 弧の入力（新規ドラッグ）

1. タイモードで開始音符の `mousedown` → `tieStartRef` に開始符頭 key・座標・stemDir を記録
2. `mousemove` → プレビュー弧（青い点線）をリアルタイム描画
3. 終了音符の `mouseup` → `fromKey === toKey` ならタイ、異なればスラーとして `applyArc()` が `arcs[]` に追記
4. 音符外で `mouseup` → キャンセル（`tieStartRef = null`）

### 弧の曲率ドラッグ（cpDrag）

```
hitPath の mousedown
  → selectedArc をセット（青ハイライト）
  → cpDragRef に { fromMeasure, fromEvent, arcIndex,
                   startSvgY, originalOffset,
                   baseArcKey, flipApplied: false } を記録

SVG の mousemove（cpDragRef が非 null かつ epDragRef が null のとき）
  1. 向き反転判定（後述）
  2. effectiveOffset = originalOffset + (svgY - startSvgY)
  3. arcGeomMap から各セグメントの geom を取得し computeArcGeometry で dAttr を再計算
  4. querySelector('[data-arc-key="..."]') で直接 d 属性を更新（React 再レンダなし）

SVG の mouseup
  → 通常 / 第1セグメント: cpDyOffset、第2セグメント: cpDyOffset2 に保存
  → flipApplied なら flipDirection をトグル
  → cpDragRef = null
```

### 向き自動反転（drag-to-flip）

曲率ドラッグ中にカーソルが音符クラスタを 20px 超えて反対側に入ると、弧の向きを自動反転する。

```typescript
const noteRef = currentlyUpward
  ? (primaryGeom.maxNoteY ?? midY + 5)  // 上向き弧: 最低符頭Y が基準
  : (primaryGeom.minNoteY ?? midY - 5); // 下向き弧: 最高符頭Y が基準

const shouldFlip = currentlyUpward
  ? svgY > noteRef + 20
  : svgY < noteRef - 20;

if (shouldFlip) {
  drag.flipApplied = !drag.flipApplied;
  drag.originalOffset = 0;  // 反転時点で offset をリセット
  drag.startSvgY = svgY;
}
```

反転は往復可能（ドラッグを戻せば元の向きに戻る）。

### 始点・終点ハンドルドラッグ（epDrag）

```
ハンドル（circle）の mousedown
  → epDragRef に { endpoint: 'start'|'end', baseArcKey,
                   startSvgX/Y, originalDx/Dy } を記録

SVG の mousemove（epDragRef が非 null のとき、cpDrag より優先）
  → 始点: ベースセグメントまたは -1 セグメントの x1/y1 を更新
  → 終点: ベースセグメントまたは -2 セグメントの x2/y2 を更新
  → arcGeomMap の startDx/Dy（または endDx/Dy）との差分で新座標を計算
  → computeArcGeometry で d 属性と handle の cx/cy を更新（React 再レンダなし）

SVG の mouseup
  → startDx/Dy または endDx/Dy を score に保存
  → epDragRef = null
```

### Delete キー優先順位

```
1. arcSel が non-null → 弧を削除（音符は残す）
2. selected が non-null → 音符を削除（従来通り）
```

弧削除時は `ev.arcs.filter((_, i) => i !== arcSel.arcIndex)` で当該弧のみ取り除く。音符を削除する際は、その音符を終点とする arcs を他の NoteEvent から除去し、後続の `toEventIndex` を繰り上げる。

---

## 段またぎ弧

開始スタヴと終了スタヴの `getYForLine(2)` の差が 30px を超えた場合、段またぎと判定して 2 本に分割する。

- **-1 セグメント**: `(x1 + startDx, y1 + startDy)` → `(edgeX1 + breakEndDx, y1 + startDy + breakEndDy)`
- **-2 セグメント**: `(edgeX2 + breakStartDx, y2 + endDy + breakStartDy)` → `(x2 + endDx, y2 + endDy)`
- 曲率は `cpDyOffset`（-1 側）と `cpDyOffset2`（-2 側）で独立して保持する
- 境界点のYは各段の符頭Yに合わせる。ふくらみは制御点で作り、片側セグメントが斜め線に見えないようにする
- 選択時は 4 点すべてにハンドルを表示し、切れ目位置もユーザーが直接調節できる

---

## arcKey と selectedArc の対応

| コンポーネント | arcKey 形式 | selectedArc 型 |
|---|---|---|
| StaffCanvas | `${fromMeasure}-${fromEvent}-${arcIndex}` | `{ fromMeasure, fromEvent, arcIndex }` |
| PianoSystemCanvas | `${partIndex}-${fromMeasure}-${fromEvent}-${arcIndex}` | `{ partIndex, fromMeasure, fromEvent, arcIndex }` |

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/types/storage.ts` | `TieArc` インタフェース追加（cpDyOffset, cpDyOffset2, flipDirection, startDx/Dy, endDx/Dy, breakEndDx/Dy, breakStartDx/Dy）|
| `src/components/arcUtils.ts` | 新規作成。`computeArcGeometry()` 純粋関数 |
| `src/components/StaffCanvas.tsx` | selectedArc 状態・cpDragRef・epDragRef・drawArcPath・drawTieArc・onKey 優先順位・arcGeomMap |
| `src/components/PianoSystemCanvas.tsx` | StaffCanvas と同様（arcKey に partIndex を先頭付加）|

---

## レガシー互換

旧データの `NoteEvent.tiedToNext: true` は `drawTieArc(..., 'legacy', false)` パスで引き続き描画される。新規入力は arcs[] 方式のみ使用する。

---

## 影響範囲

- `ScorePlayer`（再生）: arcs[] は再生に影響しないため変更なし
- 保存データ: TieArc の各フィールドはすべて optional → 既存スコアは壊れない
- `tiedToNext` レガシーフィールドは削除せず `NoteEvent` に残す（旧保存データとの互換維持）

---

## 追記（Issue #235）: 弧のドラッグを「1つのドラッグセッション」にする

### 症状（起票時）

小節をまたぐ長いスラーの端点ハンドルを掴んで動かそうとすると、掴んだ点がカーソルから
逃げてしまい位置調整にならない。起票時の仮説は「ドラッグ中に毎フレーム `setPartsScore` が
走り、段の高さが再計算されて譜面が上下に動く」だった。

### 実測でわかったこと（仮説は外れ、原因は別だった）

現行 main をブラウザで実測した結果は次のとおり。

| 確認したこと | 結果 |
|---|---|
| ドラッグ中に `setPartsScore` が呼ばれるか | **呼ばれない**。`d` 属性を直接書き換えるプレビューのみ |
| ドラッグ中に `.system-stack` の子要素の高さ・`margin-top` が動くか | **動かない**（高さ 136.03px / `margin-top` 0px のまま） |
| ドラッグ中に `window.scrollY` が動くか | **動かない** |

段の高さは DOM の実測ではなく `measuredSystemHeightPx()`（純粋計算）で決まるため、
弧の形は段配置にそもそも影響しない。よって「譜面が上下に動く」は起きていなかった。

**本当の原因は、ドラッグの mousemove / mouseup を段の `<svg>` 要素に付けていたこと。**
段の `<svg>` は五線ぶんの高さしか無く、実測で **端点ハンドルから SVG の下端までわずか 4px**
（ハンドル中心 y=480.3 / SVG の下端 y=484.3）しかない。このため:

1. 少し引っぱるだけでカーソルが SVG の外に出て `mousemove` が届かなくなり、
   端点がその場に取り残される（＝掴んだ点がカーソルから逃げる）
2. SVG の外で指を離すと `mouseup` も届かないので `epDragRef` が残る。
   そのあと**ボタンを押していないのに弧がカーソルを追い続ける**
   （実測: 離したあとの単なる `mousemove` でハンドルが (398,480) → (298,460) へ移動した）

2 の状態では画面上で弧が勝手に動き回るため、症状の見え方としては起票時の記述と一致する。

### 修正設計

**ドラッグは「掴んでから離すまでを1つのセッション」として window で受ける。**

- `mousemove` / `mouseup` の弧ドラッグ処理を段の `<svg>` から **`window`** へ移した
  （マウント時に1回だけ貼る `useEffect`。段の再描画で貼り直されない）
- 段の `<svg>` 側の `mousemove` / `mouseup` は、ドラッグ中なら**何もせず return** する。
  両方で処理すると同じイベントを2回適用してしまい、弧がカーソルの倍の速さで動く
- window 側のハンドラから「いま描かれている SVG と弧の形状台帳」を参照するため、
  描画のたびに `arcDragContextRef` を差し替える（`{ svg, svgRoot, arcGeomMap }`）。
  SVG は再描画のたびに `innerHTML=''` で作り直されるので、古い要素を掴んだままにしない
- `updateArcDragPreview(svgX, svgY)` に切り出した。引数は SVG 内部座標。
  画面座標ではなく内部座標を受けるのは、Esc の中止処理から「開始時点の座標」をそのまま渡すため
- **確定は離した瞬間の1回だけ**。さらに `moved` フラグを見て、動かしていないとき
  （＝選択のためにクリックしただけ）は `setPartsScore` を呼ばない。
  以前は無変更でも必ず1回書き込んでいた
- **Esc で中止**（`cancelArcDrag()`）。開始時点の形へプレビューを戻し、保存はしない。
  弧の**選択は残す**（掴み直せる）。曲率ドラッグは向き反転のたびに `startSvgY` /
  `originalOffset` を書き換えるため、`origin`（開始時の値）を別に持って戻し先にする
- ドラッグの終わりに必ず来る `click` で選択が解除されないよう、`arcDragMovedRef` で
  1回だけ読み飛ばす（小節のドラッグ範囲選択が `measureDragMovedRef` でしているのと同じ形）。
  SVG の外で離すと `click` 自体が来ないので、0ms のタイマーで必ずフラグを下ろす

### 対象範囲

| 操作 | 対応 |
|---|---|
| スラー／タイの端点ドラッグ（`epDrag`） | 対応（段またぎの各セグメントも同じ） |
| スラー／タイの曲率ドラッグ（`cpDrag`・向き反転を含む） | 同じ仕組みに載せ替え |
| 松葉（ヘアピン）の端点ドラッグ | **存在しない**。松葉はクリックで選択・Delete で削除のみで、ハンドルもドラッグ処理も無い（`hairpinRenderUtils.drawHairpinSegment` は `onClick` しか受けない）。今回は対象外 |

### 影響範囲

- 保存データの形式は変更なし（`startDx/Dy`・`endDx/Dy`・`cpDyOffset` などそのまま）
- 段のレイアウト計算には元から触れていないので、レイアウト側の変更なし
- 既存テスト `PianoSystemCanvasVoice2ArcEditing.test.tsx` の2件は、
  掴んだあとに**作り直された** SVG を測り直すよう直した。旧実装は「古い（DOM から外れた）
  SVG 要素に付いたリスナー」経由で動いており、jsdom でだけ成立していた形だったため

### 今回は直していない既知の点

- **段またぎの弧は、第2セグメント（`-2`）側に端点ハンドルが出ない**（実測。`-1` 側の
  始点・終点2つだけが描かれる）。design の「選択時は4点すべてにハンドルを表示」と食い違うが、
  #235 の受入条件の外なので別Issue向け
