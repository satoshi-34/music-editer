# 画面表示のズーム調整（view-zoom）

## 背景・問題
- 画面表示の縮尺は `useAutoPageScale`（`src/components/useAutoPageScale.ts`）が画面幅に合わせて自動計算し、`ScaledPageWrapper`（`src/components/ScaledPageWrapper.tsx`）が CSS カスタムプロパティ `--scale` を使った `transform: scale(var(--scale))` で画面表示だけを縮小していた（issue #13 対策: CSS `zoom` は Safari で `getBoundingClientRect` に反映されず音符クリック座標がずれるため、全ブラウザで座標に反映される `transform` を採用）。
- ただしこの自動縮尺はユーザーが調整できず、常に「画面幅いっぱいに収まる最大サイズ（最大100%）」に固定されていた。大きく表示して細部を確認したい／小さく表示して全体を見渡したい、というニーズに応えられなかった。

## 修正設計
- **ユーザー設定の追加**: その他タブに「画面表示のズーム」スライダー（50%〜150%、5%刻み）を追加。値は `ScorePage.tsx` の `viewZoom`（内部は 0.5〜1.5 の倍率）として state 化し、`localStorage`（キー `score-view-zoom`）へ保存・復元する。既存の「小節幅の均等さ」スライダー（`MEASURE_WIDTH_EVENNESS_KEY`）と同じ作り（スライダー＋現在値の%表示、壊れた保存値は範囲へクランプ）に合わせた。
- **既存の自動縮尺との合成**: `useAutoPageScale` が返す `scale`（自動縮尺、レイアウト都合で最大1に制限される）に対し、`effectiveScale = scale * viewZoom` という単純な掛け算で合成する。`--scale` CSS カスタムプロパティと `ScaledPageWrapper` の `scale` prop には、従来の `scale` の代わりにこの `effectiveScale` を渡す。
  - 100%（viewZoom = 1）のときは `effectiveScale === scale` となり、既存の表示挙動を完全に維持する。
  - 自動縮尺の計算ロジック（`useAutoPageScale.ts`）自体は変更していない。ズームは「自動縮尺の結果にさらに倍率を掛ける」後段の処理として実装し、既存のヒステリシス・ResizeObserver 監視ロジックと独立させた。
- **印刷への非干渉**: 印刷は既存の `@media print` ルール（`src/App.css` 1100行目付近）で `.page-wrapper { transform: none !important; width: auto !important; height: auto !important; }` により画面用の縮小を丸ごと解除する設計になっている。この解除ロジックは `--scale` の値を一切参照しないため、ズーム機能を追加しても印刷結果は変わらない（実機検証: `document.styleSheets` から `@media print` の cssRules を読み出し、`.page-wrapper` に対する `transform: none !important` ルールが変更なく存在することを確認済み）。
- **座標系への非干渉**: 音符クリックなどのヒットテスト（`StaffCanvas.tsx` / `PianoSystemCanvas.tsx`）は `closest('.page-wrapper')` から `--scale` を読み取って座標変換している。ズームは `--scale` の値そのものを変えるだけで、読み取り方法や変換式には手を入れていないため、ズーム変更後も座標変換は自動的に追従する。

## 影響範囲
- `src/components/ScorePage.tsx`: `VIEW_ZOOM_KEY` 定数、`viewZoom` state、`effectiveScale` の追加。`--scale` の設定元と `ScaledPageWrapper` への `scale` prop、および関連 `useEffect` の依存配列（段の再計測トリガー）を `scale` から `effectiveScale` へ変更。その他タブに新しいスライダー UI を追加。
- `src/components/useAutoPageScale.ts` / `src/components/ScaledPageWrapper.tsx` / `src/App.css`: 変更なし（既存の `--scale` 機構をそのまま利用）。

## 検証
- `docker compose run --rm app npx tsc --noEmit`: エラーなし
- `docker compose run --rm app npx vitest run`: 69 ファイル・910 テスト全緑（既存テストへの影響なし）
- ブラウザ確認（dev-alt, port 5175）: スライダーを 150%・70%・100% に変えてページ表示サイズが変わること、リロード後も値が保持されること、150%・70% それぞれで音符クリック時に狙った位置（五線の該当ライン）へ正しく音符が配置されることを確認。`@media print` の cssRules を読み出し、ズーム値に関わらず `.page-wrapper` の印刷用リセットルールが変更なく存在することを確認。コンソールエラーなし。

---

# 音符・記号の大きさ調整（notation-size）

## 背景・問題
- 上記「画面表示のズーム」は `--scale`（CSS の `transform: scale()`）を掛けるだけの**画面表示専用**の機能で、印刷結果にはまったく影響しない（`@media print` で解除されるため）。
- しかし実際のユーザー要望は「音符・五線・記号そのものの物理サイズを大きく/小さくしたい（画面でも印刷でも）」というもので、これは `--scale` ではなく `SCORE_LAYOUT_RENDER_SCALE`（`src/utils/measureLayoutUtils.ts`、VexFlow の論理座標→物理SVG座標の倍率、既定 0.44）が担っている。この定数は段組み計画（1段に入る小節数）の見積もりにも使われており、値を変えると印刷結果だけでなく自動改段の結果も変わる。
- `SCORE_LAYOUT_RENDER_SCALE` は定数のままではユーザーが調整できない。かといって定数そのものを書き換えると、ユーザー設定の永続化・UI連動・段組み再計算とのつじつま合わせが難しい。

## 修正設計
- **ユーザー設定の追加**: その他タブに「音符の大きさ」スライダー（80%〜130%、5%刻み）を追加。値は `ScorePage.tsx` の `notationSizeMultiplier`（内部は 0.8〜1.3 の倍率）として state 化し、`localStorage`（キー `score-notation-size`）へ保存・復元する。「画面表示のズーム」スライダーと隣接配置し、ラベルの `title` 属性で「印刷にも影響する」ことを明記して区別する。
- **定数を直接書き換えない**: `SCORE_LAYOUT_RENDER_SCALE` 自体は変更せず、`effectiveRenderScale = SCORE_LAYOUT_RENDER_SCALE * notationSizeMultiplier` という導出値を `ScorePage.tsx` に追加し、実際のレイアウト計算・描画にはすべてこの `effectiveRenderScale` を使う。100%（notationSizeMultiplier = 1）のときは `effectiveRenderScale === SCORE_LAYOUT_RENDER_SCALE` となり、既存の表示・印刷結果を完全に維持する。
- **参照箇所をすべて置き換え**（`grep -rn "SCORE_LAYOUT_RENDER_SCALE" src` で洗い出し）:
  - `src/components/ScorePage.tsx`
    - `planEffectiveMeasuresPerSystem(...)` の `renderScale` 引数（旧 `SCORE_LAYOUT_RENDER_SCALE` → `effectiveRenderScale`）。この関数は段あたりの実効小節数（`effectiveMeasuresPerSystem`）を決めるため、ここを直さないと「音符を大きくしたのに段組みが変わらず後ではみ出す」不具合になる。
    - `plannedRanges` を計算する `worstCaseSystemContentBudget() / SCORE_LAYOUT_RENDER_SCALE`（物理ページ幅→VexFlow論理幅への逆変換）→ `/ effectiveRenderScale`。ここを直さないと、実効スケールを上げたときに論理幅の見積もりが実際より小さく出て「1小節でも予算超過」と誤判定し、段が過剰に分割される。
    - 各 Canvas コンポーネント（`EnsembleStaff` / `PartExtractionStaff` / `QuartetStaff` / `PianoStaff` / `StaffCanvas`、計6箇所）へ渡す `scale` prop（旧 `SCORE_LAYOUT_RENDER_SCALE` 固定 → `effectiveRenderScale`）。
    - 上記を使う `useMemo` の依存配列（`effectiveMeasurePlan` と `plannedRanges`）に `effectiveRenderScale` を追加し、スライダー変更時に確実に再計算（自動改段）がかかるようにした。
  - `src/components/PianoSystemCanvas.tsx`
    - 実描画・幅計算で使う `requestedScale` が、以前は `scale` prop を無視して `SCORE_LAYOUT_RENDER_SCALE` を直接ハードコードしていた（`scale` prop は再計算トリガーの依存配列にしか使われておらず、実際の計算には反映されない不具合があった）。`requestedScale = scale ?? SCORE_LAYOUT_RENDER_SCALE` に変更し、親（`ScorePage.tsx`）から渡される `effectiveRenderScale` が実際の幅計算・`ctx.scale()` に反映されるようにした。`scale` 未指定時（一部のテストなど）だけ従来どおり `SCORE_LAYOUT_RENDER_SCALE` にフォールバックする。
  - `src/utils/measureLayoutUtils.ts` は変更なし。`allocateCombinedMeasureWidths` / `planEffectiveMeasuresPerSystem` はもともと `renderScale` を引数で受け取り、既定値としてのみ `SCORE_LAYOUT_RENDER_SCALE` を参照する設計になっていたため、呼び出し側（`ScorePage.tsx`）が `effectiveRenderScale` を明示的に渡すだけで対応できた。
- **自動改段への反映**: `effectiveRenderScale` は `effectiveMeasurePlan`（`planEffectiveMeasuresPerSystem` の結果）と `plannedRanges`（`planSystemMeasureRanges` の結果）の両方の依存に含まれるため、スライダー操作のたびに「1段に入る小節数」と「段の区切り位置」が再計算される。ScorePage 側で段組みを常に定数ではなく都度計算している既存の設計（`useMemo`）にそのまま乗せる形で実現しており、追加のイベントハンドラや強制リロードは不要。

## 影響範囲
- `src/components/ScorePage.tsx`: `NOTATION_SIZE_KEY` 定数、`notationSizeMultiplier` state、`effectiveRenderScale` の追加。`effectiveMeasurePlan` / `plannedRanges` の計算と依存配列、各 Canvas への `scale` prop（6箇所）を `SCORE_LAYOUT_RENDER_SCALE` から `effectiveRenderScale` へ変更。その他タブに新しいスライダー UI を追加。
- `src/components/PianoSystemCanvas.tsx`: `requestedScale` の算出を `SCORE_LAYOUT_RENDER_SCALE` 直書きから `scale` prop 優先（未指定時のみ定数へフォールバック）に変更。
- `src/utils/measureLayoutUtils.ts`: 変更なし（既存の `renderScale` 引数をそのまま利用）。

## 検証
- `docker compose run --rm app npx tsc --noEmit`: エラーなし
- `docker compose run --rm app npx vitest run`: 69 ファイル・910 テスト全緑（既存テストへの影響なし）
- ブラウザ確認（dev-alt, port 5175、`test-data/complex-test-score.json` を読み込んだ状態）: スライダーを 80%・100%・130% に変えて、どの値でも `svg[data-layout-overflow="true"]` が0件であること、`.print-page` 要素で `scrollHeight <= clientHeight`（クリッピングなし）であること、音符クリックによる選択（`.vf-note-selected`）が実際のヒット領域の座標どおりに機能すること、コンソールエラーが出ないことを確認。130% では自動改段によりページ数が3→5へ増え、段組みがスライダーに追従することを確認。最終的にスライダーを100%へ戻し、コンソールエラーなし。
