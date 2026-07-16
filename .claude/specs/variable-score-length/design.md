# 曲の長さの可変化（第1段）

## 背景・問題

`src/components/ScorePage.tsx` で `totalSystems`（総段数）が `12` にハードコードされており、
曲の長さが「12段 × 段あたり小節数」に固定されていた。保存データ（`SavedScoreData.systems`）
には段数フィールドが既にあったが、読み込み・自動保存のどちらでも参照されておらず、実質死に
フィールドだった。

また、ページ割り（`pages`）の計算も「最終ページも常に `systemsPerPage` 段ぶん描画する」実装
だったため、`totalSystems` を仮に可変にしても最終ページの見た目の段数は変わらない
（余白が空段で埋まっていただけ）という隠れた制約があった。

## 影響範囲の洗い出し（grep 結果）

`totalSystems` を参照しているのは `src/components/ScorePage.tsx` のみ（32箇所）。
小節データ（`MeasureData[]`）自体は `StaffCanvas.tsx` / `PianoSystemCanvas.tsx` 側で
`systems * measuresPerSystem` を必要長として都度 `Array.from` で埋める実装に既になっており
（`StaffCanvas.tsx:861`, `:1128` の `requiredLength` エフェクト）、固定長初期化はしていなかった。
そのため「小節配列の固定長初期化」を可変長対応させる大改修は不要で、`ScorePage.tsx` 側の
`totalSystems` の scope（state 化・永続化・UI）と `pages` のページ割り計算の2点が本丸だった。

## 修正設計

### 1. totalSystems の state 化
- `const totalSystems = 12` → `useState(DEFAULT_TOTAL_SYSTEMS)`（既定値12を維持）。
- Undo/Redo のスナップショット（`ScoreSnapshot`）に `totalSystems` を追加し、段の追加・削除・
  自動拡張も Undo/Redo 対象にした。
- 保存（`buildCurrentScoreData` / `createSavedScoreData`）は既存どおり `totalSystems` を
  そのまま `systems` フィールドへ書き出す（変更不要、変数が state になっただけ）。
- 読込（`handleLoad` / `handleImportFile`）は `loadedData.systems` を
  `MIN_TOTAL_SYSTEMS〜MAX_TOTAL_SYSTEMS` の範囲でバリデートして復元し、無い場合や範囲外は
  `DEFAULT_TOTAL_SYSTEMS`（12）にフォールバックする。これにより「12段固定時代」の
  保存データ（`systems` フィールドが無い）もそのまま12段として読める。
- MusicXML 読込・サンプル読込は `systems` の概念を持たないため、
  `computeMinTotalSystems(measuresPerPart, measuresPerSystem)` で「読み込んだ小節数が
  収まる最小の段数（下限は既定値12）」を逆算して設定する。

### 2. ページ割りの修正（最終ページの段数を可変にする）
- 以前: `pages = Array.from({ length: Math.ceil(totalSystems / systemsPerPage) }, () => ({ systems: systemsPerPage }))`
  → 常に全ページが `systemsPerPage` 段（最終ページも余白扱いで埋まっていた）。
- 修正後: 最終ページだけ `totalSystems - (numPages - 1) * systemsPerPage` 段（残り段数）を
  描画するようにした。これにより `totalSystems` を増減すると、最終ページの見た目の段数が
  そのまま増減するようになった（段の追加・削除ボタンの効果が画面に反映される前提条件）。
- `StaffCanvas` / `PianoSystemCanvas` などの描画コンポーネントは元々 `systems` prop
  の値を見て小節配列を都度伸長する実装だったため、この変更のみで対応できた。

### 3. UI（「その他」タブ）
- 「段あたり小節数」の隣に「段数」の数値入力（1〜200）、「段を追加」「末尾の段を削除」ボタンを追加。
- 「段を追加」: `totalSystems` を+1するだけ。実データの追記は上記の通り各描画コンポーネント側の
  自動伸長に任せる（空小節での明示的な追記はしていない）。
- 「末尾の段を削除」: 末尾の段（`(totalSystems-1) * measuresPerSystem` 以降の小節）に
  イベントを持つ小節が1つでもあれば `window.confirm` で確認してから `totalSystems` を-1する。
  **既知の割り切り**: 削除は `totalSystems` を減らすだけで、各パートの `measures` 配列自体は
  切り詰めない（データは残るが描画・書き出し対象からは除外される）。再度「段を追加」すると
  削除前の内容が復活する。小節データ自体の厳密な削除（配列のスライス）は、小節の途中挿入・
  削除を扱う次タスク（第2段）でまとめて対応する方が手戻りが少ないと判断した。

### 4. 最終段への自動追記（Finale 的な「書き進めれば伸びる」体験）
- `handleRightHandChange` / `handleLeftHandChange` / `handleQuartetPartChange` /
  `handleEnsemblePartChange` の各パート変更ハンドラに `autoExpandIfLastSystemHasContent`
  を追加。判定は「最終段の範囲（`(totalSystems-1)*measuresPerSystem` 以降）に
  イベントを持つ小節が1つでもあるか」の簡易版。
- 検知したら `pushHistory()` を呼んだ直後の同じハンドラ内で `totalSystems` を+1するため、
  ノート入力による変更と段の自動追加は**同じ Undo エントリ**にまとまる
  （1回の Undo で両方が戻る）。
- 拡張後の最終段は空になるため、次の入力が新しい最終段に達するまで再トリガーしない
  （無限ループにはならない）。

### 5. 段数のページ超過・複数ページ
- `pages` の計算が `totalSystems` 依存のまま（`Math.ceil(totalSystems / systemsPerPage)`）
  のため、段数がページ容量を超えれば自動的にページが増える。ページ高さの統一
  （`sharedPageHeight` / `ScaledPageWrapper`）のロジックには手を入れていないため、
  既存の複数ページ表示・印刷改ページの挙動はそのまま踏襲される。

## 対象外（次タスク・第2段）
- 小節の途中挿入・削除
- 「末尾の段を削除」時の各パート `measures` 配列自体の厳密な切り詰め

## テスト
- 既存ユニットテスト 862件が全通過（`docker compose run --rm app npx vitest run`）。
- `docker compose run --rm app npx tsc --noEmit` / `npm run build` とも成功。
- ブラウザ確認（Chrome DevTools 経由）:
  - 「段を追加」で 12→13 に増え、最終ページの段数（3→4）が実際に増えることを確認。
  - 「末尾の段を削除」で 12→11、空の段なので確認ダイアログは出ないことを確認。
  - 元に戻す（Undo）で 11→12 に復帰することを確認。
  - ブラウザ保存→リロード→読込で `systems` の値（13）が正しく復元されることを確認。
  - コンソールエラー無し（HMR 起因の古いエラーはサーバー再起動で解消済み）。
