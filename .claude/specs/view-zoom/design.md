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
