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
