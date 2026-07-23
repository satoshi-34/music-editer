# 空の段でページを満たす（Issue #41）

## 問題

新規譜面（あるいは保存済みデータの無い状態）を開いたとき、画面には「内容のある最後の小節が最後」という楽譜の作法（`final-barline` の設計と同じ考え方）に従い、実段が1つだけ上端に表示され、ページの残りは何も無い空白になっていた。市販の五線紙のように、書き始める前から五線がページを満たしている見た目にし、「どこにでも書き始められる」入力の招待にしたい。

## 方針（レビュー済みの設計判断）

- **表示層だけの演出にする。データに空小節を追加しない。** 保存データ・Undo・MusicXML・パート譜抽出への影響を避けるため、既存の「パディング休符」（`voiceMeasureUtils.ts` の `computeVoiceDisplayPadding`、README「拍が足りない小節・声部への表示用休符補完」参照）と同じ「描画時にだけ見た目を足す・保存データは一切書き換えない」パターンを踏襲する。
- 画面: 内容のある段（と「＋小節を追加」で増やした編集用バッファ段）の直後から、**最後に表示しているページ**の残り容量ぶんだけ、薄いグレーの「空の段」を描く。
- クリック（Enter/Spaceキーも可）すると、その段が実体化し、次の描画から通常どおり入力できる段に置き換わる。
- 印刷・印刷プレビューには出さない。

## 実装設計

### 空の段の対象範囲（ScorePage.tsx）

空の段はページ丸ごと新設するのではなく、**既に存在する最後のページの、まだ空いている容量**だけを埋める。

```
lastVisiblePageIndex = visiblePages.length - 1
capacity = min(getPageSystemsCapacity(lastVisiblePageIndex), maxSystemsPerPage)
used = effectiveTotalSystems - getPageSystemOffset(lastVisiblePageIndex)
count = max(0, capacity - used)
lastPageEmptyFillerRanges = plannedRanges.slice(effectiveTotalSystems, effectiveTotalSystems + count)
```

`plannedRanges` は印刷にも使う「段ごとの開始小節・小節数・幅計画」の配列で、内容（`printContentSystems` 個）の後ろには「＋小節を追加」用の編集バッファぶんの計画済みレンジが既に続いている。空の段はこの続きをそのまま再利用することで、**クリックして実体化したときの小節幅・小節数が変わらない**（プレースホルダーから実段への切り替えで見た目が一切動かない）ようにしている。

このバッファの計画レンジ数がページ容量に対して不足しないよう、`plannerMinimumWidths` の先読み量（`editingBufferMeasures`）を、従来の固定「2段ぶん」から `Math.max(2, Math.min(systemsPerPage, maxSystemsPerPage))` 段ぶんに拡張した。

### 段数/ページの実測上限でのクランプ（重要な副作用の防止）

`systemsPerPage` は「その他」タブでユーザーが `maxSystemsPerPage`（実測の上限）を超えて手動指定できる値で、超えている間は「⚠ あふれます」の警告を出しつつ指定どおり描画する仕様が既にある（Issue #38）。

空の段の容量・先読み幅計画のどちらも、この `systemsPerPage` をそのまま使うと、例えば「段数/ページ = 999」を指定した瞬間に999段ぶんの幅計画（数千小節ぶんの配列）と999個弱のプレースホルダー用 `PianoSystemCanvas`（内部で SoundSource/Tone.js の初期化まで走る）を一気に構築しようとし、実際にブラウザが長時間ハングする不具合が実装中の検証で発生した。

対策として、空の段の容量・先読み幅計画の両方を **`maxSystemsPerPage`（実測の上限）でクランプ**した。あふれ状態（`systemsPerPage > maxSystemsPerPage`）のときは、そもそもページが物理的にあふれているため、それ以上グレーのプレースホルダーを重ねて見せる意味も無い。回帰防止のテストを `ScorePageEmptyStaveFiller.test.tsx`（「段数/ページを実測の上限より大きく手動指定しても、空の段の数は暴走せず少数に留まる」）に追加した。

### 空の段のレンダリング（各 `*Staff.tsx`）

`SingleStaff` / `PianoStaff` / `QuartetStaff` / `EnsembleStaff` それぞれの `.system-stack` 内、既存の（`systemRanges` ぶんの）実段のループの直後に、新しい prop `emptyFillerRanges: SystemMeasureRange[]` をもとにプレースホルダーを追加で描画する。

- 描画自体は既存の `PianoSystemCanvas` をそのまま再利用する（音部記号・調号・ピアノの括弧（brace）・四重奏や編成譜の楽器グループの括弧（bracket）まで、実段と完全に同じ見た目になる）。
- `data` にはローカルで生成した空小節（`voiceMeasureUtils.ts` の新関数 `createEmptyMeasures(count)`。呼び出しごとに新しい配列を作るだけの薄いラッパーで、`親のstate（rightHandData等）とは無関係`）を渡し、`onChange` は no-op にする。
- `PianoSystemCanvas` には「親の実データが `startMeasureIndex + measuresPerSystem` に満たないとき、パディングして `onChange` で書き戻す」という既存の同期処理があるが（"＋小節を追加" バッファ段が実体化した瞬間に空小節がデータへ入るのもこの経路）、空の段はローカルのダミー配列の長さを常に `measuresPerSystem` と一致させて渡すため、この同期処理が発火する条件（`data.length < req`）に一度も当たらない。これにより保存データには一切触れない。
- ラッパー `<div className="empty-stave-filler" role="button" tabIndex={0} onClick={...} onKeyDown={...}>` でクリック・キーボード操作を受け付ける。CSSクラスの命名は既存の `vf-padding-rest` と同様、印刷除外の目印としても使う。

### クリックでの実体化（ScorePage.tsx）

```
handleEmptyFillerClick(index) {
  additional = sum(lastPageEmptyFillerRanges[0..index].count)
  setExtraEditingMeasures(prev => prev + additional)
}
```

`extraEditingMeasures` は既存の「＋小節を追加」ボタンと全く同じ state で、増やすと `bufferRanges` の構築ロジック（`ScorePage.tsx` 内、既存コード）が自動的に「内容の直後から、この小節数ぶんだけ実段として描画する」よう解決する。空の段のクリックはこの既存の仕組みに合流するだけなので、実体化した段の描画・保存データへの反映（パディング）は「＋小節を追加」ボタンと完全に同じ経路・同じ挙動になる。

`index` より手前の空の段の小節数も合算しているため、途中の段だけを飛び越して実体化することはない（五線紙の上から順に書き進める自然な挙動）。

「＋小節を追加」ボタンと同じ方針で、この操作自体は `pushHistory` を呼ばない（Undo履歴を汚さない）。`ScorePageEmptyStaveFiller.test.tsx` の「空の段をクリックしても『元に戻す』は有効化されない」で確認している。

### 印刷・印刷プレビューでの除外

- `App.css` の `@media print { .empty-stave-filler { display: none !important; } }`
- `App.css` の `.print-preview .empty-stave-filler { display: none !important; }`

既存の `.vf-padding-rest` / `.add-measures-ghost-button` と同じ「画面専用の演出は2箇所（実際の印刷用メディアクエリと、印刷プレビュー用のクラスセレクタ）で個別に非表示にする」方式に揃えている。

## 影響範囲

- `src/components/ScorePage.tsx`: `lastPageEmptyFillerRanges` / `handleEmptyFillerClick` の追加、`plannerMinimumWidths` の先読み量の拡張（`maxSystemsPerPage` でクランプ）、4つの `*Staff` 呼び出しへの新規props配線。
- `src/components/SingleStaff.tsx` / `PianoStaff.tsx` / `QuartetStaff.tsx` / `EnsembleStaff.tsx`: `emptyFillerRanges` / `onEmptyFillerClick` props の追加とプレースホルダー描画。
- `src/utils/voiceMeasureUtils.ts`: `createEmptyMeasures(count)` を追加。
- `src/App.css`: `.empty-stave-filler` のスタイルと印刷・印刷プレビューでの非表示ルールを追加。
- データモデル（`MeasureData` / 保存フォーマット / MusicXML / MIDI 書出）への変更は無し。
