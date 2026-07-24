# 段ごとの小節数の個別調整（systemMeasureOverrides）

## 問題

小節幅の自動計画（`src/utils/measureLayoutUtils.ts` の `planSystemMeasureRanges` /
`planEffectiveMeasuresPerSystem`）は、段あたりの最低幅の合計が使用可能幅に収まる最大の
小節数を貪欲法で決める。音符が密な小節が続くと、その付近だけ「1段1小節」まで縮んでしまう
ことがある。ユーザーからは「この段だけもう1小節増やしたい／減らしたい」という、段単位で
小節数を手動調整したい要望があった。

## 修正設計

### データモデル

`SavedScoreData`（`src/types/storage.ts`）に optional フィールドを追加した。

```ts
export interface SystemMeasureOverride {
  startMeasure: number;
  count: number;
}

export interface SavedScoreData {
  // ...
  systemMeasureOverrides?: SystemMeasureOverride[];
}
```

「段の通し番号」ではなく「絶対小節インデックス `startMeasure` から始まる段は `count`
小節」という形にしたのは、小節の挿入・削除でページ割りが多少ずれても、上書きの意味
（＝どの小節群を1段にまとめるか）をなるべく保てるようにするため。段番号（0, 1, 2...）を
キーにすると、前の方の段に小節を1つ足しただけで後続の全上書きがずれてしまう。

`storage.ts` に `validateSystemMeasureOverrides` を追加し、以下を検証する。

- `startMeasure` は 0 以上の整数
- `count` は 1 以上の整数
- `startMeasure` の重複禁止（同じ開始小節に矛盾する段の切り方を許さない）

省略時（`undefined`）は許容し、旧データ互換を保つ。

### 計画ロジック

`planSystemMeasureRanges` に第5引数 `overrides?: SystemMeasureOverrideInput[]` を追加した。
既存の貪欲ループが段の開始位置 `start` を進めるとき、`start` が上書き一覧のいずれかの
`startMeasure` と一致すれば、その上書きの `count`（残り小節数でクランプ）をそのまま採用する。
このとき使用可能幅（`availableWidth`）を超えても縮めず、`overflow: true` を返すだけにする
（音符が詰まる／はみ出す可能性はユーザー判断に委ねる、という要件どおり）。

`start` が一致しない場合は従来どおりの自動計画（3→2→1 と段の小節数を減らして幅に収める
処理）を行う。この性質により、

- 上書きした段より前は変化しない
- 上書きした段の直後からは自動計画が「ずれた位置」から続きを計画する
- 上書きの `startMeasure` が実際の段境界と一致しなくなった場合（他の上書きで前段の
  小節数が変わった結果など）、その上書きは単に一致せず無視される（データが壊れることはなく、
  静かに無効化されるだけ）

`ScorePage.tsx` 側は `plannedRanges` の `useMemo` に `systemMeasureOverrides`（React state）を
そのまま渡している。

### UI

譜面エリア（`.score-area`）の下、ページごとに「段N ◀ N小節 ▶」の行を1段につき1行並べる
（`.system-measure-override-controls` / `.system-measure-override-row`、`App.css`）。

- ▶: 次段の先頭小節をこの段へ引き込む（`count + 1`）。残り小節が無い場合は disabled
- ◀: この段の末尾小節を次段へ送る（`count - 1`）。`count` が1のときは disabled（0小節の段は作らない）
- 編集モード（`isPartExtractionActive` が false かつ `isEditingDisabled` が false）のときだけ表示
- 印刷には出さない。`App.css` の `@media print` で `.system-measure-override-controls { display: none !important; }`

「その他」タブに「段割りをリセット」ボタンを追加し、`systemMeasureOverrides` を空配列に
戻せるようにした（上書きが無いときは disabled）。

### Undo/Redo・保存/読込との整合

`ScorePage.tsx` の Undo/Redo スナップショット型 `ScoreSnapshot` に `systemMeasureOverrides`
フィールドを追加し、`currentScoreRef` の同期・`pushHistory`・`applySnapshot`（Undo/Redo 共通の
復元処理）のすべてで他のパートデータと同様に扱う。▶/◀ ボタン・リセットボタンはどちらも
実際の変更前に `pushHistory()` を呼ぶため、通常の編集操作と同じ Undo 履歴に積まれる。

保存経路（`saveScoreData` / `createSavedScoreData` / `useScoreStorage.saveScore`）・読込経路
（`loadScoreData` 経由の `handleLoad`）・ファイル書出/読込（`handleExportFile` /
`handleImportFile`、`fileStorage.ts` 経由）のすべてに `systemMeasureOverrides` 引数を追加した。
新規作成・サンプル読込・MusicXML読込では前の譜面の上書きを引き継がないよう明示的に
`setSystemMeasureOverrides([])` する。

`isSameScoreIgnoringPadding`（末尾空小節パディングの差だけで Undo 履歴を汚さない判定）は
`MeasureData[]` 専用の関数で、`systemMeasureOverrides` は対象外（上書き変更は常にパディングと
無関係な「実質的な変更」なので、この関数を通す必要がない）。

## 影響範囲

- `src/types/storage.ts`: `SystemMeasureOverride` 型・`SavedScoreData.systemMeasureOverrides` 追加
- `src/utils/storage.ts`: `validateSystemMeasureOverrides` 追加、`validateSavedScoreData` /
  `createSavedScoreData` へ組み込み
- `src/utils/measureLayoutUtils.ts`: `planSystemMeasureRanges` に `overrides` 引数を追加
- `src/hooks/useScoreStorage.ts`: `saveScore` に `systemMeasureOverrides` 引数を追加
- `src/components/ScorePage.tsx`: state・Undo/Redo スナップショット・保存/読込/新規作成/
  サンプル読込/MusicXML読込の各経路・段ごとのコントロール UI・リセットボタンを追加
- `src/App.css`: `.system-measure-override-controls` 系のスタイルと印刷時非表示ルールを追加

終止線＋最終小節ページ右下寄せ（`breakAt=contentMeasureCount`）、タイトルページの減段
（`pageSystemLayoutUtils.ts`）、末尾空段非表示、「＋小節を追加」、小節幅の均等さ・音符の
大きさスライダーとは独立した層で動作するため、これらの既存ロジックには変更を加えていない。

## 検証

- `src/utils/measureLayoutUtils.test.ts`: `planSystemMeasureRanges` の overrides 対応
  （上書き適用・overflow 許容・後続段の再計算・startMeasure 不一致時の無視・クランプ・
  後方互換）
- `src/utils/storage.test.ts`: `systemMeasureOverrides` の保存/読込往復・省略時の後方互換・
  重複 startMeasure/不正な count・負数 startMeasure の拒否
- ブラウザ確認（`docker compose` の dev-alt サーバー、複雑テスト楽譜シード）: ▶ で段の
  小節数が増え後続段が再配置されること、Undo/Redo で戻せること、保存→再読込で上書きが
  維持されること、リセットで解除されること、印刷 CSS（`@media print`）でコントロールが
  非表示になること、コンソールエラーが出ないことを確認済み

## 追補: 上書き段が「音符の大きさ」変更で右端からはみ出す不具合の修正

### 問題

上で書いたとおり `planSystemMeasureRanges` は、上書きした段の最低幅合計が
`availableWidth` を超えても `overflow: true` を返すだけで縮めない。この
`overflow: true` の段を Canvas 側（`PianoSystemCanvas.tsx` / `PianoStaff.tsx`）へ渡すと、
「音符の大きさ」スライダー（`effectiveRenderScale`、コミット 98e5bad）で `renderScale` が
大きくなるほど、各小節の物理最低幅（`論理幅 × renderScale`）の合計も比例して増える。
上書きした段だけこの合計が使用可能幅を超えたまま SVG に渡ると、その段の SVG だけ他の段
より右へ広がって描画され、ページの右マージンをはみ出して見えてしまっていた
（実機スクリーンショットで確認）。

### 修正設計

`src/utils/measureLayoutUtils.ts` の `allocateCombinedMeasureWidths`（小節の合同幅を
実際の描画幅へ配分する、唯一の配分ロジック）に、圧縮処理を集約した。

- 物理最低幅の合計 `sumMin` が使用可能幅 `usableWidth` を超える場合だけ、
  `compressionRatio = usableWidth / sumMin` を全小節の物理最低幅に一律で掛けて縮小する。
- `renderScale`（フォント・五線の縦サイズに効く倍率）自体は変更しない。VexFlow の
  `Formatter` は割り当てられた幅へ詰め込む挙動なので、幅の配分だけを縮めれば音符間隔が
  詰まって収まる（極端に小節数を増やした場合に符頭同士が近づくのは許容する設計）。
- 圧縮後は必ず `usableWidth` ちょうどに収まるため、`doesFit` は常に `true` を返す。
  呼び出し元（`PianoSystemCanvas.tsx`）はこれをそのまま `svg.dataset.layoutOverflow` に
  反映しているため、「圧縮して収めたら overflow 扱いにしない」という自然な挙動になる。
- 自動計画（上書きなし）の段は `planEffectiveMeasuresPerSystem` が事前に
  `sumMin <= availableWidth` を保証してから段の小節数を選ぶため、この関数へ来る時点で
  常に `sumMin <= usableWidth` になっており、圧縮は発動しない（従来どおりの配分）。
  圧縮が効くのは実質的に「段の小節数のユーザー上書きで最低幅合計が予算を超えた」経路のみ。
- 圧縮とその後の余剰配分・`MEASURE_WIDTH_EVENNESS` によるブレンドは同じ関数内で一度だけ
  行われるため、二重に圧縮されることはない。

呼び出し元（`PianoSystemCanvas.tsx` の該当箇所、`PianoStaff.tsx` の
`plannedMeasureWidths={systemRanges?.[i]?.minimumWidths ?? ...}`）や
`planSystemMeasureRanges` 自体（`overflow` フラグの意味・上書きの許容仕様）は変更していない。

### 影響範囲

- `src/utils/measureLayoutUtils.ts`: `allocateCombinedMeasureWidths` に比例圧縮を追加
- `src/utils/measureLayoutUtils.test.ts`: 圧縮発動時の配分・総和・`doesFit`、非発動時の
  従来挙動維持を検証するテストを追加・既存テストの期待値を更新

### 検証

- `docker compose run --rm app npx tsc --noEmit` / `npx vitest run`（69ファイル922テスト
  全緑）
- ブラウザ確認（`docker compose` の dev-alt サーバー、複雑テスト楽譜シード、段3を2小節へ
  上書きした状態）: 「音符の大きさ」を 80% / 100% / 130% のいずれに変更しても、全段の
  SVG 幅（`getBoundingClientRect().width`）が一致し（504px）、`data-layout-overflow` が
  すべて `false` になることを確認。上書きなしでの自動計画の段幅・段割りは変化なし。
  コンソールエラーなし。最終状態は複雑テスト楽譜読込・ズーム100%/音符の大きさ100%/
  小節幅の均等さ65%・段割り上書きなしに戻して終了。

## 追記（2026-07-20）: 空き拍クリックが「最後の音符の選択」に吸われるバグの修正

### 問題

単旋律モード（SingleStaff → PianoSystemCanvas）で、小節に3音入れた後に4拍目の
空き領域をクリックしても音符が追加されず、最後の音符の「選択」になることがあった。
段ごとの小節数オーバーライド（◀▶）で小節幅が広がると確実に再現し、
「段割りをリセット」すると追加できるようになる、という再現条件が観察された。

### 原因

最後の音符の透明クリック領域（`.vf-note-hit`）は「前の音符との中間点〜小節右端」まで
広がる。click ハンドラの和音内個別音選択（`findKeyIndexAtLine`: クリックYを五線の
線/間へ丸めて `keys[]` の音高ラインと照合）が **X位置の制限なし**で行われていたため、
空き拍の領域を既存音と同じ高さでクリックすると、挿入（`doInsert`）へ到達する前に
「最後の音符の個別選択」として処理されていた。
小節数オーバーライドは原因そのものではなく、小節（＝最後の音符のヒット領域の空き部分）が
広がることで同じ高さのクリックが起きやすくなる増幅条件だった。

### 修正設計

- `PianoSystemCanvas.tsx` に定数 `KEY_SELECT_X_PAD = 12` を追加し、個別音選択の判定を
  「符頭の描画X範囲（BoundingBox）± KEY_SELECT_X_PAD」内のクリックに限定した。
- 範囲外の同じ高さのクリックは従来の分岐どおり `isOnNote` 判定へ進み、
  符頭上でなければ `doInsert` による音符挿入になる。
- 符頭のすぐ近く（±12px）での同じ高さのクリックは従来どおり個別選択のまま
  （「符頭Xから少し外れても選択できる」という既存の操作感は維持）。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`: `KEY_SELECT_X_PAD` 追加、click ハンドラの
  個別音選択に X 範囲ゲートを追加
- `src/components/PianoSystemCanvasEmptyBeatClick.test.tsx`（新規）: jsdom の
  `clientWidth` と svg の `getBoundingClientRect`/`width.baseVal` をスタブして
  実寸ジオメトリで描画し、「空き拍を同じ高さでクリック → 4音目が末尾に追加される」
  「符頭付近を同じ高さでクリック → 選択のままで音符は増えない」を検証する再現テスト

### 検証

- `docker compose run --rm app npm test`（77ファイル973テスト全緑）
- ブラウザ確認（dev-alt サーバー）: 段1を4小節→3小節へ上書きした状態で、1小節目に
  同じ高さの4分音符を3つ入力し、4拍目の空き領域を同じ高さでクリック
  （クリックターゲットは最後の音符の `.vf-note-hit`）→ 4音目が追加されることを確認。
  コンソールエラーなし。

### 追補（2026-07-21）: 選択/追加のホバーフィードバック

上記の `KEY_SELECT_X_PAD` によるX範囲ゲートは「クリックしたら選択になるか追加になるか」を
正しく振り分けられるようにしたが、ユーザーテストでは「クリックする前にどちらになるか
画面上で分からない」という指摘が別途あった（≒仕様としては正しく動いているが、
体感として予測できない）。

**修正設計**: `.vf-note-hit` の `mousemove` ハンドラに、click ハンドラの
`nearNoteX`（符頭の描画X範囲 ± `KEY_SELECT_X_PAD`）+ `findKeyIndexAtLine`
（`snapLine` で丸めたYが `keys[]` のどれかと一致するか）と全く同じ判定式を追加し、
「今この位置でクリックしたら個別音選択になるか」をホバー時点で事前計算するようにした。
判定式をクリック時とホバー時で完全に一致させているのは、ズレるとホバー表示が
信用できなくなるため（「グレーになったのにクリックしたら選択にならなかった」という
新たな混乱を生まないように）。

- 選択になる位置: カーソルを `pointer` にし、対象の `StaveNote` の SVG 要素
  （`getSVGElement()`）に `opacity: 0.55` を設定して符頭を薄くする
  （新設のヘルパー `setNoteHoverHighlight()`）。
- それ以外（新規挿入・和音追加・休符置換分割など）: カーソルを `copy` にする。
  小節背景（`.vf-hit`）のクリックで新規挿入になる領域は、既存の実装がすでに
  `crosshair` を設定していたため変更していない。
- 挿入位置プレビューは、既存の `showGuide`（ガイド線）/`showChordGuide`
  （和音追加ゾーンのハイライト）がすでに mousemove のたびに更新されており、
  これがそのまま「ここに置く」という視覚フィードバックを兼ねるため、
  今回は新たに追加していない（最低限のコストで既存の仕組みを活かす）。
- `mousemove` ごとに React の再レンダーを走らせるとコストが高いため、
  DOM（SVG要素の `style.cursor` / `style.opacity`）を直接操作する方式にした
  （`PianoSystemCanvas.tsx` の既存の `showGuide`/`showChordGuide` も同じ直接DOM操作方式）。

**影響範囲**:
- `src/components/PianoSystemCanvas.tsx`: `setNoteHoverHighlight()` 追加、
  `.vf-note-hit` の `mousemove`/`mouseleave` ハンドラを拡張
- `src/components/PianoSystemCanvasHoverFeedback.test.tsx`（新規）: 符頭近傍の
  ホバーで `pointer` カーソル＋符頭の `opacity: 0.55`、小節端（空き拍）のホバーで
  `copy` カーソルになることを検証

**ブラウザ確認（2026-07-21）**: 4/4小節に4分音符を3つ入力し、実DOM座標（`clientToGroup`
と同じ変換式で client 座標を算出）で1音目の符頭付近へ `mousemove` を発火させたところ、
カーソルが `pointer` になり符頭の `<g>` 要素が `opacity: 0.55` になることを確認した。
コンソールエラーなし。単旋律譜・ピアノ大譜表・弦楽四重奏はすべて同じ
`PianoSystemCanvas.tsx` のコードパスを共有しているため、個別に確認しなくても
同じ修正が効く。

### 追補（2026-07-21 その2）: 編成譜（縮小スケール）で個別音選択の当たり判定が効かないバグ

**問題**: 編成譜（オーケストラスコアのように多パートを1ページに収める譜面）では、
符頭のすぐ近くをクリックしても「選択」にならず「音符追加」になってしまい、
単旋律譜では起きない現象としてユーザーテストで見つかった。

**原因**: 上記 `KEY_SELECT_X_PAD`（符頭からの当たり判定パディング）は
SVG内部座標（raw単位、VexFlowが実際に描画に使う座標系）の固定値 12 として
実装されていた。しかし PianoSystemCanvas は多パートを1ページに収めるため
`scale` prop（`requestedScale`、内部変数 `s`）でVexFlowの描画スケールを
`SCORE_LAYOUT_RENDER_SCALE` 相当まで縮小している。VexFlow の
`SVGContext.scale(s,s)` は各要素の座標そのものを書き換えるのではなく、
SVGの `viewBox` 幅を `width/s` に変更するだけ（`node_modules/vexflow/.../svgcontext.js`
の `scale()` 参照）。そのため「raw単位1」が画面上で占める大きさは概ね `s` px にしかならず、
`s` が小さい編成譜では固定12raw単位が画面上わずか数px相当まで縮んでしまい、
符頭のすぐ隣をクリックしても選択の当たり判定に入らなかった
（`clientToGroup` は画面クリック座標を `viewBox幅 / 実表示幅`（≒ `1/s`）倍して
raw座標に変換するため、raw単位の固定パディングは画面px換算で `s` に比例して縮む）。

**修正設計**:
- `KEY_SELECT_X_PAD`（raw単位の固定値）を廃止し、`KEY_SELECT_X_PAD_SCREEN_PX = 12`
  （画面px基準の定数）と、それを現在の描画スケール `s` で raw 単位に変換する
  ヘルパー `keySelectXPad(s) = KEY_SELECT_X_PAD_SCREEN_PX / s` を追加した。
- click ハンドラ（`nearNoteX`）とホバーフィードバック（`nearNoteXForHover`、
  上記追補のホバー機能と判定式を一致させる原則を継続）の両方で
  `keySelectXPad(s)` を使うよう変更した。
- 個別音選択のY方向判定（`findKeyIndexAtLine` / `snapLine`）はもともと
  「クリックYに最も近い五線ライン」を常に選ぶ実装で、しきい値による棄却が
  ないため screen-px 化の必要はなかった（単一音の音符では常に一致し、
  X方向のゲート `nearNoteX` だけが選択/追加を分けていた）。
- `s=1` 付近（既存の単旋律譜テストが使う scale）では `keySelectXPad(1)=12` と
  従来の raw 12 と一致するため、既存のEmptyBeatClick/HoverFeedbackテストは
  無改修で通る。

**影響範囲**:
- `src/components/PianoSystemCanvas.tsx`: `KEY_SELECT_X_PAD` → `KEY_SELECT_X_PAD_SCREEN_PX`
  + `keySelectXPad(s)` ヘルパーに置き換え、click/hover 両方の使用箇所を更新
- `src/components/PianoSystemCanvasSmallScaleSelect.test.tsx`（新規）: `scale=0.3`
  （編成譜相当の縮小スケール）で、符頭の少し外側（旧実装なら当たり判定を外れる位置）
  をクリックすると選択になること、符頭から十分離れた空き拍クリックは従来どおり
  音符追加になることを検証する再現・回帰テスト

**検証**:
- `docker compose run --rm app npm test`（453ファイル5730テスト全緑。
  無関係な `SaveLoadButtons.test.tsx` のプロパティテストが1回だけ偶発的に
  失敗したが、修正前のコードでも再現し、単体では再実行で常に通るためこの修正と無関係な
  既存のflaky testと判断した）
- `docker compose run --rm app npm run build`（クリーン）
- ブラウザ確認（dev-5178、実際に7パートの譜面が読み込まれる `印刷テスト用小品` サンプルで、
  実測スケール比 `viewBox幅/表示幅 ≈ 2.27`（`s ≈ 0.44`、多パート譜に相当する縮小率）の
  パートに対して、符頭の描画右端から画面px換算で約8px外側（旧実装の実効パディング
  ≈5.3pxは超え、新実装の実効パディング12pxの範囲内）をクリックし、選択（青枠表示）に
  なることを確認。ArrowUpで音高が動き、Deleteで削除できることも確認。空き拍領域の
  クリックでは従来どおり音符が追加されることも回帰確認。コンソールエラーなし。

## 追補: 画面表示のズームを上げると個別音選択の許容幅がズレる問題の修正（2026-07-22）

**問題**:
上記の `keySelectXPad(s)` は VexFlow の `requestedScale`（`s`）だけを使って
画面px基準のパディングを raw 単位に変換していたが、`s` には ScorePage の
「その他」タブ（実装上は『楽譜設定』タブ）にある「画面表示のズーム」スライダー
（0.5〜1.5、`.page-wrapper` の CSS変数 `--scale` として `.print-page` に
`transform: scale()` で適用される）の倍率が含まれていなかった。
`clientToGroup` は `svg.getBoundingClientRect()`（CSSズームを含む実際の見た目サイズ）
から画面px⇄raw座標を変換しているため、実際にクリック座標の変換に使われる
「実効スケール」は `s × 画面表示のズーム` になる。`keySelectXPad(s)` はズーム分を
無視していたため、画面px換算の許容幅が `12 × 画面表示のズーム` px になってしまい、
ズーム倍率によって実効パディングが変動していた
（150%ズームでは画面上約18px相当まで許容範囲が広がる一方、ズームを下げると
本来の12pxより狭くなる）。個別音選択とは別に、和音追加ゾーンの判定 `isOnNote` は
この影響を受けない固定raw値 `CHORD_HIT_PAD` を使っているため、ズームで許容幅が
本来の12pxからズレると「選択」と「和音追加／挿入」の境界が意図した位置からずれ、
狙った操作にならないことがあった。

**修正設計**:
- `clientToGroup` 内にあった「`svg.getBoundingClientRect()` と `viewBox` から
  画面px⇄raw単位の実効スケールを求める」ロジックを `getSvgVisualMetrics(svg)` として
  切り出し、`clientToGroup` はこの共通関数を呼ぶだけにした（Safari向けの
  フォールバック分岐 `bcrReflectsZoom` も含めてそのまま共通化）。
- `getSvgVisualMetrics` を使って「画面1px が何raw単位に相当するか」を返す
  `getRawPerScreenPx(svg)` を追加した。
- `keySelectXPad(renderScale: number)` を `keySelectXPad(svg: SVGSVGElement)` に変更し、
  `KEY_SELECT_X_PAD_SCREEN_PX * getRawPerScreenPx(svg)` で raw 単位のパディングを
  求めるようにした。`getRawPerScreenPx` は VexFlow の `requestedScale` と
  CSSズームの両方を含む実測値なので、画面表示のズームをどの値に変えても
  画面px換算の許容幅は常に `KEY_SELECT_X_PAD_SCREEN_PX`（12px）で一定になる。
- 呼び出し側（クリックハンドラの `nearNoteX`、ホバーフィードバックの
  `nearNoteXForHover`）はどちらも `svg`（クロージャ内で参照可能な `SVGSVGElement`）を
  渡すだけで済むよう更新した。

**影響範囲**:
- `src/components/PianoSystemCanvas.tsx`:
  - `clientToGroup` から `getSvgVisualMetrics(svg)` を切り出し
  - `getRawPerScreenPx(svg)` を追加
  - `keySelectXPad(renderScale)` → `keySelectXPad(svg)` に変更し、呼び出し箇所
    （個別音選択の `nearNoteX`、ホバーの `nearNoteXForHover`）を更新
- `src/components/PianoSystemCanvasZoomSelect.test.tsx`（新規）: `scale=0.3`
  （編成譜相当）かつ `.page-wrapper` の `--scale=1.5`（画面表示のズーム150%相当）で、
  符頭から画面px換算10px（新旧どちらの許容幅にも収まる）は選択になり、14px
  （修正後の許容幅12pxの外だが、ズーム分を無視していた旧実装の許容幅18pxの内側）
  は選択にならず音符追加になることを検証する再現・回帰テスト。
  修正前のコードでこのテストを実行すると14pxのケースが失敗する（誤って選択になる）
  ことを確認済み。

**検証**:
- `docker compose run --rm app npm test`（454ファイル5732テスト全緑）
- `docker compose run --rm app npm run build`（クリーン）
- ブラウザ確認（dev-5178、`印刷テスト用小品` サンプル。手順・結果は本追補の
  親コミットのやりとりに詳細を残す。要点のみ記載）:
  - 画面表示のズーム100%: Cl.パートの和音内の1音をクリックして個別音選択（青枠）
    になることを確認（回帰なし）
  - 画面表示のズーム150%（スライダーの上限）: 同じ和音の複数の音それぞれを
    クリックし、いずれも対応する音だけが個別選択されることを確認
    （実際のブラウザクリック・DOM経由での合成クリック双方で確認）
  - コンソールエラーなし
  - 画面表示のズームスライダーの上限は150%（実装上 `viewZoom` は0.5〜1.5に
    クランプされる）のため、200%ズームでの確認はスライダー仕様上できない
    （200%相当の検証は上記の自動テスト（`--scale=1.5` かつ `scale=0.3` の
    組み合わせで実効スケールを更に小さくする形）でカバーした）
  - 空き拍への音符追加・和音追加の直接的なブラウザ回帰確認は本セッションでは
    未実施（ロジック自体は今回変更しておらず、`PianoSystemCanvasEmptyBeatClick.test.tsx`
    等の既存自動テストが全緑であることで代替した）

## 追補: 編集位置より前の段だけを安定化し、詰めていく挙動を取り戻す（Issue #67、2026-07-25）

**前提**: 「入力のたびに段割り全体が再計画される」不具合の対策（Issue #58、PR #63）は
`previousRanges`（前回の段割り）を「収まる限り常に再利用」する設計だった。これが
強すぎる安定化になり、「段が埋まるにつれて小節が詰まっていき、溢れたら次の段へ送られる」
という組版の基本挙動まで止めてしまう新たなリグレッションを招いたため、PR #70 で
PR #63 の変更（`previousRanges` 引数・`ScorePage.tsx` 側の呼び出し・関連テスト）を
mainからrevertした（Issue #67）。本追補は revert 後の main を起点に、
「編集位置より前の段だけ安定化し、編集位置を含む段から後ろは常に貪欲法で計画し直す」
設計を新規に実装したものである。

**修正設計**:
- `planSystemMeasureRanges`（`src/utils/measureLayoutUtils.ts`）に
  `previousRanges?: SystemMeasureOverrideInput[]` と `lastEditedMeasureIndex?: number`
  の2引数を追加した。各段の開始位置 `start` について、`previousRanges` に同じ `start`
  のエントリがあり、かつ **その段が丸ごと `lastEditedMeasureIndex` より前で完結する**
  （`start + count <= lastEditedMeasureIndex`）場合だけ、前回の `count` をそのまま
  再利用する（breakAt をまたぐ場合や、再利用後に availableWidth を超える場合は
  下の貪欲法へフォールバックする）。`lastEditedMeasureIndex` が未指定、または該当の段が
  編集位置を含む／編集位置より後ろの場合は、前回の `count` を一切参照せず常に通常の
  貪欲法で計画し直す。PR #63 との違いはここで、「収まる限り再利用」ではなく
  「編集位置より前だけ再利用」にすることで、いま入力している段は常に貪欲法の恩恵
  （詰める／溢れたら次の段へ送る）を受けつつ、触れていない前の段の境界だけが
  安定する。
- `ScorePage.tsx` に `lastEditedMeasureIndex`（state）と `previousSystemRangesRef`（ref）
  を追加した。`previousSystemRangesRef` は `plannedRanges` を計算し終えたレンダーの
  直後（`useEffect`）に `{start, count}` の一覧として保持し、次回の `plannedRanges`
  計算へ渡す。`lastEditedMeasureIndex` は「音符追加/削除/小節追加のたびに更新」する
  ため、右手・左手・四重奏・編成譜の各 `on*Change` ハンドラで、変更前後のデータを
  `findFirstDifferingMeasureIndex`（`src/utils/scoreDataEquality.ts` に新規追加、
  末尾パディングを除いて先頭から比較し最初に異なる小節indexを返す純関数）で比較し、
  最初に異なった小節indexをセットする。範囲削除・貼り付け・移調（選択範囲の先頭を使う）
  でも同様にセットする。
- 「段割りをリセット」「段あたり小節数変更」「新規作成・読込・Undo/Redo」などの
  全体再計画を期待する操作では `lastEditedMeasureIndex` を `null` に戻し、安定化を
  一時的に外して貪欲法だけで組み直す（段ごとの個別上書き `systemMeasureOverrides` は
  従来どおり `previousRanges` より常に優先されるため、この一覧には影響しない）。

**影響範囲**:
- `src/utils/measureLayoutUtils.ts`: `planSystemMeasureRanges` に2引数追加
  （既存呼び出しは省略時 = 従来どおりの貪欲法のみで後方互換）
- `src/utils/scoreDataEquality.ts`: `findFirstDifferingMeasureIndex` を新規追加
- `src/components/ScorePage.tsx`: `lastEditedMeasureIndex` state・
  `previousSystemRangesRef` ref・`markMeasureEdited` ヘルパーを追加。
  各データ変更ハンドラ・削除／貼り付け／移調・各種リセット箇所を更新

**検証**:
- `docker exec music-editer-dev npx vitest --run src`
  （`measureLayoutUtils.test.ts`・`scoreDataEquality.test.ts` に本追補のテストを追加。
  既存の `ScorePageEmptyStaveFiller.test.tsx` の4件は revert 前のmainでも同じ内容・
  同じ件数で失敗することを確認済みの、本修正と無関係な既存の失敗（Issue化未実施）。
  それ以外は全緑）
- `docker exec music-editer-dev npm run lint`（353エラー・6警告はrevert前のmainと
  完全に同数・同内容で、本修正による新規エラーはゼロ。Issue #73 でラチェット化予定の
  既知の状態）
- `docker exec music-editer-dev npm run build`（クリーン）
- ブラウザ確認（新規譜面・単旋律、`docker run` で本worktreeを直接マウントした
  一時devサーバーで確認）:
  - 最後の段（当初は空の1段のみ）に音符を1つ入力すると、内容小節と編集バッファの
    混在を避ける既存の `breakAt` ロジックにより段が1小節ぶんへ強制的に区切られる
    （既存挙動、回帰なし）ことを確認
  - 続けて次の小節にも音符を入力すると、その段が2小節へ「詰まる」ことを確認
    （段の小節数表示が `1小節` → `2小節` に変化。Issue #67 が目的とした
    「段が埋まるにつれて詰まっていく」挙動の実地確認）
  - Undo で直前の入力（2小節目の音符）だけが取り消され、段の小節数表示も
    `2小節` → `1小節` に正しく戻ることを確認（`pushHistory`/`currentScoreRef` 同期の
    回帰なし）
  - コンソールエラーなし
  - 「編集位置より前の段の境界が動かない」ことの実地確認（多段にまたがる編集での
    安定化）は、本セッションでは自動テスト（`measureLayoutUtils.test.ts` の
    `previousRanges / lastEditedMeasureIndex` テスト群）でのみ確認し、ブラウザでの
    多段シナリオの手動確認は未実施
