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
- **スラー**: 三次ベジェ C。制御点を `span * SLUR_CP_X_RATIO`（0.32）で左右に分けて自然な立ち上がりを出す。`obstacleY` から `clearance` 分外側に制御点を置き、符頭との最低隙間 `SLUR_OBSTACLE_MIN_GAP_PX`（9px）を確保する。
  - `clearance = max(SLUR_MIN_CLEARANCE_PX, min(SLUR_MAX_CLEARANCE_PX, span × SLUR_CLEARANCE_SPAN_RATIO))` = `max(5, min(16, span × 0.09))`
  - **これらは規格ではない**。SMuFL/Bravura が定めるのは線の太さ（`slurEndpointThickness` / `slurMidpointThickness`）だけで、曲率の規定は無い。浄書の慣習に寄せた調整値であり、変えるときはこの4つの定数（arcUtils.ts の先頭）を動かす
  - 2026-08-24: 運用者の実機所感「もうちょい緩やか」を受けて2段階で調整。下限10→5px・係数0.15→0.09・上限24→16px・制御点0.25→0.32。**上限を下げないと長い弧には効かない**（長い弧は上限に張り付くため）
  - 適用の順序が重要: **①既定の離れに最低隙間を先に適用（`max(clearance + conflict分, 9px)`）→ ②ユーザーオフセットを加算 → ③内側へ引っ張った場合だけ符頭手前で再クランプ**。
    ②の後に最低隙間を掛けると、既定値が最低隙間より小さい短い弧で「外へドラッグしても見た目が動かないのに値だけ溜まり、後から跳ねる」無反応帯ができる（#406 Codex round2）。回帰テストは `arcNoteheadClearance.test.ts`
  - 同時に符頭との最低隙間を6→9pxへ。曲率を緩めた結果、符幹が上向きで conflict の +8px が付かない短いスラーが符頭の縁に接するようになったため（頂点は `端点×0.25 + 制御点×0.75` で決まるので、9px なら符頭中心から約7.5px＝符頭の縁5pxを越える）。回帰テストは `arcNoteheadClearance.test.ts`
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
  → **Issue #445 で変更**（下の「追記（Issue #445）」を参照）。現在の再生は `ScorePlayer` ではなく
  `ScorePage` → `PlaybackEngine` の経路を通り、そこでタイを1音へ畳んでいる
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

---

## 追記（Issue #260）: 頂点ハンドル（頂点位置と膨らみの調節）

### 要望と、その前提になっていた問題

Finale 相当の「スラーの頂点を左右にも寄せられる」調節を入れる。あわせて、PR #257 で
当たり判定を弧の中央部だけに絞ったこと（`computeArcHitGeometry`）で表面化した
3点をトリアージ追記で受けている。

1. **ズーム対応**: ヒット帯の太さ（stroke 10）が SVG 内部単位（raw）の定数だったため、
   画面表示のズームを変えると「画面上の掴みやすさ」が倍率ぶんズレる
2. **短いタイの掴み代**: 中央 t∈[0.25,0.75] 方式では、全長 15〜20px の短いタイで
   掴める長さが 7〜10px しか残らず、実質つまめない
3. **発見可能性**: 掴める場所が中央だけになったのに、画面上の手がかりが無い

### データモデル

`TieArc` に、膨らみ（`cpDyOffset`）とは**独立**の新パラメータを追加する（トリアージ指定）。

| キー | 意味 |
|---|---|
| `apexXRatio?: number` | 頂点の左右位置。「頂点が中央からずれる量 ÷ 弧のスパン」の比率、正 = 右 |
| `apexXRatio2?: number` | 段またぎ第2セグメント（下段側）の同じ値。`cpDyOffset2` と同じ考え方 |

**px ではなく比率にした理由**: 段割り（段あたり小節数・ページ幅）が変わると弧のスパンが
伸び縮みする。px で保存すると、同じ 20px でも短い弧では寄せすぎ・長い弧では効かない、と
見た目が別物になる。比率なら「スパンの何％寄せたか」が保たれる。

可動範囲は `APEX_X_RATIO_MAX = 0.15`（スパンの ±15%）。これ以上ずらすと三次ベジェの
制御点が終点の外側へ出て、弧の端がフック状に折れ返る。読み込み時・描画時の両方で
`clampApexXRatio()` を通すので、壊れた保存値（NaN・極端な値）でも形は壊れない。

### 弧形状計算の共通化（arcUtils.ts）

`computeArcGeometry` / `computeArcHitGeometry` が制御点の計算を各自で持っており、
「変えるときは両方そろえること」というコメントで整合を人力に頼っていた。頂点ハンドルは
3つ目の利用者（頂点座標）になるため、制御点の計算を `computeArcControlPoints()` に集約した。

```
computeArcControlPoints()  ← 制御点はここだけで決まる
  ├─ computeArcGeometry()      表示パス（d 属性）
  ├─ computeArcHitGeometry()   当たり判定パス（中央部の切り出し）
  └─ computeArcApexPoint()     頂点ハンドルの位置（t=0.5 のベジェ点）
```

`apexXRatio` は「頂点が動く量」なので、制御点へ渡すときに種類ごとの係数で換算する
（二次は頂点 = 中点 + 0.5×制御点のずれ → ×2、三次は 0.75 → ÷0.75）。この換算を
入れてあるおかげで、ハンドルはカーソルと**同じ距離だけ**横に動く。

### インタラクション（頂点ハンドル）

- 選択中の弧の頂点に、白い四角（一辺 `ARC_APEX_HANDLE_SIZE = 9`、青枠、cursor: move）を描く。
  端点の丸ハンドル（r=5・青塗り）と見た目で区別できるようにしている
- 上下ドラッグ = 膨らみ（`cpDyOffset`。向きの自動反転も従来どおり効く）、
  左右ドラッグ = 頂点位置（`apexXRatio`）。1回のドラッグで両方同時に動かせる
- ドラッグ状態は既存の `cpDragRef` を拡張（`apex: boolean` / `startSvgX` / `originalRatio`、
  Esc 用の `origin` にも `svgX` / `ratio` を追加）。**弧の本体を掴む従来のドラッグでは
  `apex: false` なので、左右に動かしても `apexXRatio` は保存しない**（リグレッション防止）
- 確定は既存の mouseup 経路に相乗り。段またぎでは掴んだセグメントの値だけを更新する
  （`-2` なら `apexXRatio2`）。頂点ハンドル以外のドラッグでは `apexXRatio` を書かない
  （`undefined` のときはパッチを当てない）
- 頂点は端点や膨らみが変わると移動するので、端点ドラッグ・曲率ドラッグのプレビューでも
  ハンドルを一緒に置き直す（`moveApexHandle`）

**既知の癖**: 上下方向はハンドルがカーソルより遅れて動く（頂点は制御点の 0.75 倍しか
動かないため）。従来の「弧の本体を掴んで上下」と同じ感触にそろえた結果であり、
左右（比率へ換算済み）は 1:1 で追従する。

### ヒット帯のズーム対応・掴み代の下限（トリアージ追記1・2）

- `ARC_HIT_STROKE_SCREEN_PX = 10` / `ARC_HIT_MIN_LEN_SCREEN_PX = 28` を**画面px基準**の
  定数にし、描画時に `getRawPerScreenPx(svg)` で raw 単位へ変換する（音符側 `keySelectXPad`
  と同じ流儀）。描画時に実測を読むため、`svg` の寸法が読めない環境（jsdom・レイアウト前）でも
  描画を止めないよう `getRawPerScreenPxSafe()`（失敗時は 1）を通す
- **残る制限（ブラウザ実測で確認）**: 「画面表示のズーム」は `.page-wrapper` の CSS transform を
  変えるだけで再描画を伴わない（`PianoSystemCanvas` の `scale` prop は `effectiveRenderScale`＝
  レイアウト用の倍率であり、画面ズームではない）。そのためズーム直後に何も編集せずクリックすると、
  帯の幅は描画時の倍率のまま＝画面px換算でズーム倍率ぶんズレる。実測値:
  100% で描画 → 10.00px、そのまま 200% へズーム → 17.36px、そこで弧を選び直して再描画 → 10.00px。
  これは raw 定数だった従来とズレ方は同じで、基準が「その時点で画面 10px」になるぶん必ず従来以上に
  正確になる。符頭側の拡張帯（#246）も同じ割り切り
- 掴み代の下限は `computeArcHitGeometry(..., minHitLen)` で受け、切り出す t 範囲を
  中央から広げる（`half = max(0.25, min(0.4, (minHitLen/2)/弦長))`）。
  **上限 0.4 を設けているのは、広げすぎると端点＝符頭のすぐ隣まで帯が伸びて、
  PR #257 で直した「音符のクリックを弧が吸う」事故に逆戻りするため**

### 発見可能性（トリアージ追記3）

ヒットパスの `mouseenter` / `mouseleave` で可視パスの `opacity` を `0.55` にする。
色ではなく opacity を使うのは、選択中の青（`#3b82f6`）や非アクティブ声部の淡色表示と
衝突させないため（音符側 `setNoteHoverHighlight` と同じ判断）。

### 影響範囲

- `apexXRatio` を指定しない既存データの見た目は1pxも変わらない（既定 0 のとき、
  制御点の式は従来と同一。`arcApexGeometry.test.ts` で d 属性の実値を固定した）
- 段のレイアウト計算・MusicXML 書出には影響しない（弧は元から MusicXML 非対応）
- 曖昧クリックの解決（頂点ハンドルと他要素の重なり）は #264（再クリック巡回）の担当

### 今回は対象外

- 頂点ハンドルそのものの大きさは raw 単位のまま（端点ハンドル r=5 と同じ扱い）。
  極端に縮小した譜面ではどちらも小さくなる
- 松葉（ヘアピン）にはハンドルが無い（#235 の時点から変わらず）

---

## 追記（Issue #261）: 弧を「中央が太く端が細い」テーパー形状で描く

### 問題

弧の可視パスは `stroke-width: 1.5`（実際には App.css の一律指定に負けて 1.2 u）の
**均一な太さの線**だった。浄書のスラー・タイは中央がいちばん太く、端に向かって
細くなる形で描くのが慣行で、均一線のままだと版面が「手描きの下書き」に見える
（#89 対象者の知見。#195 §5 の「線の太さに階層が無い」と同じ根）。

Bravura（このアプリが使う楽譜フォント）の `engravingDefaults` は次を推奨している。

| キー | 値 |
| --- | --- |
| `slurEndpointThickness` / `tieEndpointThickness` | 0.10 sp（= 1.0 u） |
| `slurMidpointThickness` / `tieMidpointThickness` | 0.22 sp（= 2.2 u） |

### 修正設計

**閉パス + 塗り（fill）**で描く。SVG の `stroke` は太さを途中で変えられないため、
「線を太らせる」のではなく「弧の形をした面を塗る」方式に変える（浄書ソフトの定石で、
VexFlow の `Curve` も同じ作りをしている）。

- `src/components/arcUtils.ts` に **`computeArcTaperGeometry()`** を新設した。
  `computeArcGeometry()` と**同じ引数・同じ制御点**（`computeArcControlPoints`）から、
  中心線を挟んで外側・内側へ制御点だけをずらした2本の曲線をつなぎ、
  始点・終点で閉じた輪郭（末尾 `Z`）を返す
- ずらす向きは**弦（始点→終点）の法線**。縦方向にずらすと、斜めに架かる弧
  （音高の違う音を結ぶタイ）で太さが弧に対して斜めに測られてしまう
- ずらす量は次数ごとに違う。中央（t=0.5）の点は制御点のずれを一定割合しか
  反映しないため、その割合で割り戻す
  - 二次（タイ）: 中央の幅 = ずらし量 × 1.0
  - 三次（スラー）: 中央の幅 = ずらし量 × 1.5
- `computeArcGeometry()` は**変更していない**。中心線の計算はこれまでどおりで、
  当たり判定（`computeArcHitGeometry`）・頂点ハンドル（`computeArcApexPoint`）は
  1行も変えずに従来の位置を保つ

### 端の厚みは stroke が受け持つ（太さを2つに分けた理由）

閉パスの端は2本の曲線が同じ点に集まるので**幅ゼロ＝針のように尖る**。
浄書では端にもわずかな厚み（0.10 sp）を残すので、輪郭に同じ色の細い `stroke` を
`stroke-linejoin: round` / `stroke-linecap: round` で掛けて丸く落としている。

結果として太さの担当は次の2つに分かれる。

| 担当 | 値 | どこで決まるか |
| --- | --- | --- |
| 端の厚み | 0.10 sp（1 u） | App.css の `.score-area svg path.vf-arc` の `stroke-width` |
| 中央の膨らみ（中央 − 端） | 0.12 sp（1.2 u） | `ARC_TAPER_BULGE_UNITS`（塗りの形） |

分けたのは、**表示ウェイト設定（細/標準/太）・印刷時の細線化・画面表示のフロア
（Issue #210）を弧にも効かせ続けるため**。これらはすべて CSS の `--score-stroke-scale`
経由で `stroke-width` に掛かる仕組みなので、塗りだけで描くと弧だけが設定から
外れてしまう。あわせて、#202 の設計書 §11-1 が「段3以降の残作業」として挙げていた
**「一律指定に取り残された弧を個別指定へ移す」も、この変更で解消**した。

なお、この分担のぶん**ウェイト設定は端の厚みにだけ比例して効く**（細では
中央 1.87 u / 端 0.67 u、太では中央 2.7 u / 端 1.5 u）。中央と端の比が設定で
多少変わるが、太さの向き（細くする / 太くする）は直感どおりに動く。

### 描画側の変更（`PianoSystemCanvas.tsx`）

可視パスの属性を次のように変えた。`d` を書き込む場所は
`drawArcPathP()` とドラッグ中プレビュー（`updateArcDragPreview` の3か所）で、
すべて `computeArcTaperGeometry()` へ差し替えている（片方だけ残すと、ドラッグした
瞬間に弧が均一線へ戻る）。

| 属性 | 変更前 | 変更後 |
| --- | --- | --- |
| `fill` | `none` | 弧の色（選択中は `#3b82f6`） |
| `stroke` | 弧の色 | 弧の色（塗りと同色。端の丸めのため） |
| `stroke-width` | `1.5`（CSS の一律指定で実質 1.2） | `1`（属性は保険。実効値は `path.vf-arc` の CSS） |
| `class` | なし | `vf-arc` |

新規ドラッグ中のプレビュー弧（`tiePreviewPath`）は点線の下書きなので、
従来どおり `computeArcGeometry()`（中心線）のままにしている。

### 印刷・PDF書出

App.css の印刷ルールは「元の描画に線／塗りがある要素だけ色を黒へ統一する」作りで、
`fill="none"` を除外している（Issue #203 の経緯）。弧は今回**意図して塗りを持つ**ため、
`.print-page svg path:not([fill="none"])` に自然に拾われて黒く印刷される。
選択中の青も印刷では黒になる（従来と同じ扱い）。当たり判定パス（`.vf-arc-hit`）は
これまでどおり除外されたままで、印刷に出ない。

### 影響範囲

- 当たり判定・頂点ハンドル・端点ハンドル・向き反転・段またぎの2セグメント分割は
  **中心線が変わらないため無改修**。`arcTaperGeometry.test.ts` が
  「帯の中心＝`computeArcApexPoint` の位置」を固定して見張っている
- 保存データ（`TieArc`）の形式は変わらない。既存譜面は開き直すだけで新しい形になる
- MusicXML 書出には影響しない（弧は元から MusicXML 非対応）
- 松葉（ヘアピン）は対象外。直線区間の記号なのでテーパーの対象ではない
  （太さは #202 で 0.16 sp 済み）

### 今回は対象外

- 弧の**端の位置**（符頭のどこから出るか）の浄書規則は変えていない
- 太さを譜種・弧の長さで変える（長い弧ほど太くする等）調整は入れていない。
  Bravura の推奨値は長さによらず一定のため

---

## 追記（Issue #296）: 多声部での端点は符幹先端側へ寄せる

多声部小節で弧が符幹と同じ側を通るとき、端点を符頭ではなく**符幹先端側**へアンカーし、
スラーが避ける高さにも符幹先端を含めるようにした（Issue #296）。

**この追記で `arcUtils.ts` は1行も変更していない。** #288 で制御点計算を
`computeArcControlPoints` へ一本化してあるおかげで、直したのは呼び出し側が渡す
「端点の Y」と「`obstacleY`」という入力だけで、表示パス・当たり判定・頂点/端点ハンドル・
テーパー（#261）はすべて自動で追従した。一本化の効果がそのまま出た例として記録しておく。

判断ロジックは `src/utils/arcStemAnchorUtils.ts`（純関数）に切り出してある。
設計の詳細・実測値・単声部が変わらないことの担保は
[`.claude/specs/voice2-arc-support/design.md`](../voice2-arc-support/design.md) §20 を参照。

---

## 追記（Issue #445）: タイで結ばれた音を再生でも1音として鳴らす

### 問題

記譜上はタイで結ばれた2音でも、再生では2回発音していた（「タ〜ン」ではなく「タン・タン」）。
制作中の確認音がそのまま完成音源として使われるため、この差は製品価値に直結する。
原因は、再生経路が `arcs[]` をまったく見ていなかったこと（この設計書の「影響範囲」に
「arcs[] は再生に影響しない」と明記されていたとおりの状態）。

### 修正設計

**「開始音を伸ばす・継続音を止める」の2点セット**で表現する。音価そのものは書き換えない
（`DurKey` は決まった音価しか表せず、「4分＋8分＝1.5拍」のような合計を入れられないため）。

再生イベント（`PlaybackMeasureEvent`）に2つの指示を足した:

| フィールド | 意味 |
| --- | --- |
| `tieExtendBeatsByKey?: Record<string, number>` | この音を何拍ぶん長く鳴らすか（キーごと） |
| `tieSuppressedKeys?: string[]` | 継続音として発音（アタック）を止めるキー |

どちらも**キー単位**にしてあるのは、和音の一部だけがタイで結ばれることがあるため
（`TieArc.fromKey`/`toKey` は単一の符頭を指す）。`durationScale`（アーティキュレーション）と
同じく、**タイミング（次の音までの間隔）は一切変えず、鳴っている長さだけを変える**。
そのため小節長・テンポ・再生位置ハイライトの計算は従来のまま影響を受けない。

### 実装のポイント

#### 1. 索引空間のずれを吸収する（いちばんの難所）

`TieArc.toMeasureIndex` / `toEventIndex` は「**展開前**の絶対小節番号」と
「**声部内**のイベント位置」を指す（`toEventIndex` の声部ローカル性は
[`voice2-arc-support/design.md`](../voice2-arc-support/design.md) の案A）。
一方、再生エンジンが受け取るのは「反復展開後の小節列」で、各小節は
`flattenMeasureForPlayback` により声部を混ぜて開始拍順に並べ替えられている。
このままでは弧の終点を特定できない。

そこで:

- `flattenMeasureForPlayback` の戻り値に `voiceIndex` と `eventIndex`（畳む前の声部内位置）を
  持たせた。並べ替えても「元がどの声部の何番目か」を失わない
  （※単声部では `startBeat` を付けない性質は変えていない。再生エンジンは `startBeat` の有無で
  「順に積む小節」か「開始拍で並べる小節」かを見分けているため）
- 解決そのものは純関数 `src/utils/tiePlaybackUtils.ts` の `buildTiePlaybackPlan()` に切り出し、
  `小節:声部:イベント` をキーにした計画（Map）を返す

#### 2. リピート展開での曖昧さ

反復を展開すると同じ小節が何度も現れるため、「元の小節番号」だけでは終点を一意に決められない。
終点は**自分自身の小節、または並び上の後続で元小節番号が単調増加している区間内に
最初に現れる該当小節**とする（round2 で「自小節+すぐ次だけ」から拡張。
入力は任意の後続小節へタイを張れるため）。
リピートの飛び先が変わって次の小節が終点でなくなった場合（1番括弧の末尾から小節をまたぐタイ等）は
**繋げず、記譜どおり2音として鳴らす**。音が丸ごと消えるより安全側に倒す判断。

#### 3. 途中再生（#108）との関係

強弱（`resolveDynamicVelocities`）は「切る前の全列」で解決するが、タイは逆に
**切ったあとの列**で解決する。開始音が開始位置より手前にあって切り落とされた継続音は、
どの開始音からもたどり着けないので抑制されず、単独の音として普通に鳴る。
「途中から再生したら最初の音が鳴らない」という壊れ方を構造的に防いでいる。

#### 4. 壊れたデータへの防御

保存データの `arcs` は読み込み時に検証されていない（`storage.ts` に `arcs` の記述は無い）。
そのため `buildTiePlaybackPlan` は次をすべて黙って読み飛ばす:
行き先の小節・声部・イベントが存在しない／行き先が休符／`fromKey`・`toKey` が
その音符の `keys` に無い／同じ小節内で手前を指している（循環防止）／`kind` が `'slur'`。
連鎖のたどり直しにも訪問済み集合と上限（128）を置いた。

#### 5. 連鎖と和音

A—B—C のように続くタイは、**連鎖の先頭**（誰の終点にもなっていない符頭）だけを起点にして
合計拍数を積む。途中の音から数え直すと二重に伸びるため。和音では結ばれたキーだけが伸び、
結ばれていないキーは2回目もそのまま鳴る。

### データ構造

```
buildTiePlaybackPlan(展開後の小節列) => Map<"小節:声部:イベント", {
  extendBeatsByKey: { "c/4": 2 },   // 開始音: 2拍ぶん伸ばす
  suppressedKeys: ["c/4"],          // 継続音: この高さは鳴らさない
}>
```

### 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/utils/tiePlaybackUtils.ts` | 新規。タイ解決の純関数 |
| `src/utils/voiceMeasureUtils.ts` | `flattenMeasureForPlayback` の戻り値に `voiceIndex` / `eventIndex` を追加 |
| `src/audio/PlaybackEngine.ts` | `PlaybackMeasureEvent` に `tieExtendBeatsByKey` / `tieSuppressedKeys` |
| `src/audio/SoundFontEngine.ts` | 既定エンジン。キーごとに抑制・延長を反映 |
| `src/audio/SimpleAudioEngine.ts` | 内蔵エンジン。先頭音（keys[0]）についてのみ反映（元から単音再生のため） |
| `src/components/ScorePage.tsx` | 切ったあとの展開列から計画を作り、各イベントへ載せる |

タイが1つも無い譜面では両フィールドとも `undefined` のままなので、**従来の再生と完全に同じ**。

### MIDI 書き出しの現状（調査結果・本Issueでは未修正）

`src/utils/midiExport.ts` の `buildNoteTrack()` は `arcs` をまったく見ておらず、
タイで結ばれた2音にそれぞれ Note-On / Note-Off を書き出している（再生と同じ欠陥）。
ここは再生経路（反復展開・途中再生あり）と違い、`MeasureData[]` を声部ごとに素直に走査するため、
`TieArc` の索引空間とそのまま一致する。`getEventDurationBeats` の合算を
`ticks` に足して継続音の Note-On を落とすだけで直せる見込み。
本Issueの受入条件は再生スケジューラに限定されているため、修正は別Issueに委ねる。

なお MusicXML の書出・読込は `<tied>` / `<slur>` 自体が未対応（既知の制限）で、
タイ情報は往復で失われる。こちらも本Issueの範囲外。

### 手で確かめる手順

`docs/REGRESSION.md` の「U. タイの再生（Issue #445）」を参照。


## タイ再生のレビュー対応（2026-08-29・Codex round1）

- **[P1] スウィングON時の長さ**: 継続音の記譜拍を「スウィング変換後の開始音の長さ」へ
  そのまま足すと、表拍開始で長すぎ・裏拍開始で短すぎになる。両エンジンとも
  「連鎖の終端（記譜どおりの位置）は動かない」前提で、**終端から逆算**する形へ修正
  （tiedSoundDuration = (連鎖終端拍 − スウィング後の開始拍) × 秒/拍）
- **[P2] 隙間のあるタイの実時間**: 入力上、タイは間にイベントを挟んだ後続音へも張れる。
  伸ばす量を「終点音の音価」から「**開始音の鳴り終わり→終点音の鳴り終わりの実時間**」へ変更
  （buildTiePlaybackPlan が展開列全体の絶対位置表を作って差分で算出。小節送りは
  エンジンと同じ「内容と拍子長の大きい方」= measureBeatsFloor 引数）。
  間に休符や別の音を挟むタイは、その区間も鳴り続ける（弧が視覚的に覆う範囲=鳴る範囲）
- **トリルとの相互作用（マージ統合時の裁定）**: タイの延長・抑制が付いた音はトリル展開しない
  （展開するとタイ情報がサブ音符へ複製され拍が壊れる。「タイで伸びた長さの中で交互連打」は
  別課題）。ScorePage の flatMap 内で tieAdjustment があれば展開をスキップ
- テスト追加: 隙間タイ2件（同小節内・小節またぎ非境界）・スウィングON の表拍/裏拍タイ
  （SimpleAudioEngine）・声部2の配線・タイ+トリル非展開の配線

## タイ再生のレビュー対応（2026-08-29・Codex round2）

- **[P1] スウィングが小節線を動かす既存バグ**: 内蔵音源の複数声部経路が小節終端を
  「スウィング後の開始+変換前音価」で数えており、4拍目裏の8分で次小節が 1/6 拍遅れていた。
  終端を記譜どおりの位置（nominal）で数えるよう修正（単声部経路と同じ理由）。
  タイ計画の物差し（4拍基準）とも一致する
- **[P2] 2小節以上先へ張ったタイ**: 終点解決を「自小節+すぐ次」から「元小節番号が
  単調増加している区間内の前方探索」へ拡張。リピート折返し（番号が戻る/同じ小節の再登場）に
  当たったら打ち切り null（繋げず2音・安全側）— 従来のリピート挙動は不変
- **[P3] 旧形式 tiedToNext**: arcs を持たない旧保存データのタイ（tiedToNext=true）を
  「同じ声部の次のイベント（小節末尾なら次小節頭）の同じキーへのタイ」として計画へ読み替え。
  描画のレガシー経路と再生が一致する
- **[P4・仕様として明記] タイとアーティキュレーションの合成**: タイは「1音として鳴る」ため、
  開始音の durationScale（スタッカート・フェルマータ等）が**繋がった全体**へ掛かる。
  継続音側に付いたアーティキュレーションは再生へ反映されない（発音自体が抑制されるため）。
  タイの途中の音へ記号を付ける記譜は稀で、必要になったら連鎖ごとの倍率合成を別Issueで設計する

## 追記（Issue #446）: 端点と符頭の隙間を広げた

### 問題

利用者フィードバック（2026-08-28）:「タイが音符とくっつきすぎだと思う。」

端点のYは `resolveArcEndpointY()` が `符頭の中心Y ± ARC_NOTEHEAD_GAP` で決めており、
この定数が **3**（SVG 論理単位。五線の1間 = 10）だった。符頭は高さの半分が約 **5** なので、
3 では端点が**符頭の輪郭の内側**にあり、弧の端が符頭にめり込んで見えていた。

### 修正設計

`ARC_NOTEHEAD_GAP` を **3 → 6** にした。根拠:

| 距離（符頭中心から） | 意味 |
| --- | --- |
| 5 | 符頭の縁（半分の高さ） |
| 0.5 | 弧の「端」の線の太さの半分（Bravura `slurEndpointThickness` 0.10 sp = 1 u） |
| **6** | 上の合計 5.5 を越える最小の整数値。これで輪郭が符頭に触れない |
| 10 | 隣の五線の線（1間）。ここを越えると線間の音符で端が線をまたいで見える |

Issue の指示「まず定数で +2〜3px 程度から調整」の範囲内で、
**符頭に触れなくなる最小値**を選んだ（+2 の 5 では、端の線の太さのぶんまだ接する）。

### 手動位置調整済みの端点は動かさない

端点ハンドル（✥）でユーザーが位置を決めた弧まで一律に押し出すと、
「合わせた位置が勝手に動く」ことになる。そこで
`resolveArcEndpointY({ hasManualEndpointOffset })` を追加し、
**その端点に手動オフセット（`startDx`/`startDy`、終点なら `endDx`/`endDy`）がある場合だけ**
従来値 `ARC_NOTEHEAD_GAP_LEGACY = 3` を使う。判定は
`hasManualArcEndpointOffset(dx, dy)`（未設定と 0 はどちらも「動かしていない」扱い）。

判定は**弧単位ではなく端点単位**にしている。片側だけ手で合わせた弧では、
触っていない側だけが新しい隙間になる（触った側は1pxも動かない）。

### 影響範囲

- **スラーとタイは同じ経路**（`resolveArcEndpointY`）なので、スラーの端点も同じだけ外へ出る。
  ふくらみ（制御点）は `obstacleY`＝符頭の高さを基準に決まるため**変わらず**、
  #406 で固定した「スラーが中間の符頭に重ならない」性質はそのまま
  （`arcNoteheadClearance.test.ts` に巻き添え確認を追加）
- **符幹アンカー（#296）の弧は不変**。`ARC_STEM_TIP_GAP = 5` 側で決まるため。
  例外は「符幹先端が符頭より内側」という壊れたデータのときの丸め込み先だけ
- 段またぎの2セグメント・段の右端で切れるセグメント・終点側 Canvas の第2セグメントも
  同じ隙間になるよう、4か所すべての呼び出しへ手動オフセット判定を渡した
  （ここがずれると、同じ弧なのに段の変わり目で高さが飛ぶ）
- 保存データ（`TieArc`）の形式は変わらない。既存譜面は開き直すだけで新しい隙間になる
- 当たり判定・頂点/端点ハンドル・テーパー形状は端点座標から作られるので自動で追従する

### テスト

- `src/utils/arcStemAnchorUtils.test.ts`: 手動調整済みの端点は従来値（3）のまま／
  未調整の端点は新しい隙間になる／`hasManualArcEndpointOffset` の境界（undefined・0）
- `src/components/arcNoteheadClearance.test.ts`: **間隔の下限を固定**
  （隙間 − 端の太さの半分 > 符頭の縁）。従来値 3 がこの下限を割っていたことも
  逆向きのテストで残し、定数を下げる変更が通らないようにした。
  広げすぎ側（1間 = 10 未満）も上限として固定
- `src/components/PianoSystemCanvasMultiVoiceArcStem.test.tsx`: 単声部の基準パス
  （`SINGLE_VOICE_ARC_D`）を実測値で更新（両端のYが 3 ずつ外側へ、制御点は不変）
