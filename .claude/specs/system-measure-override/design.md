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
