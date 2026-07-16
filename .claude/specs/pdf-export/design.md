# 楽譜のPDFエクスポート 設計書

## 背景・課題

README ロードマップに初期から残っていた項目「楽譜のエクスポート（PDF）」を実装する。
既存実装では `@media print` により A4 用の印刷整形は済んでいるが、ワンクリックで
PDF を書き出す導線が「その他」タブの MusicXML書出・MIDI書出の隣に無かった。

## 案の比較検討

### 案A: `window.print()` 呼び出しボタン
- 実装コストがほぼゼロで、既存の `@media print` 整形（A4サイズ・改ページ・当たり判定除外など）をそのまま流用できる。
- ブラウザの印刷ダイアログで「PDFとして保存」を選べば実質PDFエクスポートになる（Chrome/Edge/Safari はいずれも印刷ダイアログの送信先に「PDFに保存」を持つ）。
- デメリット: 「ボタン1つでファイルが降ってくる」体験ではなく、印刷ダイアログでの追加操作（送信先の選択）が要る。

### 案B: クライアントサイド PDF 生成（jsPDF + svg2pdf.js 等）
- ワンクリックでPDFファイルが直接ダウンロードされる体験は良い。
- ただし新規依存の追加が必要（CLAUDE.md の依存追加ルールに従い `--ignore-scripts` での安全な追加が要る）。
- 最大のリスクは、VexFlowが描く音楽記号（Bravuraフォントを使ったSVG `<path>` ベースのグリフ）を `svg2pdf.js` が正しく変換できるかどうか。多声部・強弱記号・カスタム記号・微分音記号など、この譜面エディタは通常の五線譜より複雑なSVG構造（`<text>`・`<circle>`・当たり判定用の透明 `<rect>`/`<path>` を多数含む）を持つため、変換品質の検証コストが高い。

### 採用結果
**案Aを採用**。理由:
1. 既存の `@media print` は本タスク以前から十分に作り込まれており（A4整形・非表示要素の除外など）、それを流用するだけで実用十分な PDF が得られる。
2. 案Bは新規依存追加＋SVG→PDF変換品質の検証という大きな作業になり、「無理に完成させようとして時間を溶かさない」という方針に反する。
3. 案Bの小さな検証（別譜面パターンでの svg2pdf.js 変換テスト）は行わず、案Aで確実に動作させることを優先した。将来的に「ワンクリックでファイル直接保存」が本当に必要になった時点で、改めて案Bのプロトタイプを検証する方が費用対効果が良いと判断。

## 実装内容

### 1. ボタンの追加（実質は既存ボタンの整備）
「その他」タブには元々 `window.print()` を呼ぶ「印刷」ボタンが既に存在していた
（`src/components/ScorePage.tsx` の `activeToolbarTab === 'other'` ブロック内）。
今回は重複ボタンを増やさず、この既存ボタンをそのまま「PDF書出」導線として整備する方針にした:

- ラベルを「印刷」→「PDF書出 / 印刷」に変更し、印刷ダイアログで「PDFとして保存」を選べば
  PDF書出になることが伝わるようにした。
- `title` 属性に操作手順（「ブラウザの印刷ダイアログを開き、『PDFとして保存』を選ぶと楽譜をPDF書出できます」）を追加。
- ハンドラを `handleExportPdf`（中身は `window.print()` のまま）という名前の `useCallback` に切り出し、
  `handleExportMusicXml` / `handleExportMidi` と同じ命名パターンに揃えた。

### 2. 印刷CSSの品質確認と修正（`src/App.css` の `@media print`）

既存の @media print ルールを精読した結果、以下の問題が見つかったため修正した。

#### 問題1: クリック判定用の透明パスが印刷で黒い太線として出てしまう
既存ルール `.print-page svg path, svg line { stroke:#000; fill:#000 }` は、
線を薄くしないための「黒で強制」ルールだが、これは **見た目の線を持つ `<path>` だけでなく、
クリック判定専用の透明な `<path>`（`stroke="transparent"`, 太さ10pxの当たり判定領域）にも
無差別にかかってしまう**。具体的には:

- タイ／スラーの当たり判定パス（`src/components/StaffCanvas.tsx` および
  `src/components/PianoSystemCanvas.tsx` の `drawArcPathP` 内、`hitPath`）
- 松葉（ヘアピン）の当たり判定パス（`src/utils/hairpinRenderUtils.ts` の `drawHairpinSegment` 内、`hit`）

これらは元々 `rect` の当たり判定（`.vf-hit` 等）と同様に印刷から除外されるべきだったが、
`<rect>` 用の除外クラスしか用意されておらず、`<path>` 側は対象外だった。
印刷結果では、タイ・スラー・松葉のたびに幅10pxの黒い帯が出てしまうバグになっていた。

**修正**:
- 上記3箇所の当たり判定パスに `class="vf-arc-hit"` / `class="vf-hairpin-hit"` を付与。
- `@media print` 側で `path.vf-arc-hit`, `path.vf-hairpin-hit` を `stroke:none; fill:none` に上書きし、
  通常の `path` 強制黒ルールから除外。

#### 問題2: カスタム記号のテキスト・輪郭円が印刷で薄いグレーのまま
運指番号・強弱記号・リハーサルマーク・ペダル記号・オッターバなどは `<text>` 要素で描かれており、
色は `#111827` / `#1f2937` / `#1e293b` / `#374151` など、視認性のためにやや薄めのダークグレーが
使われている（画面表示用の配色）。印刷では純粋な黒で出したいため、
`.print-page svg text { fill: #000 !important; }` を追加した。

カスタム記号（ユーザー定義の奏法記号）は `<circle>` 要素も使う
（`src/utils/customSymbolUtils.ts`）。ここは `fill="none"`（輪郭だけの記号）のケースがあるため、
`path`/`line` と同じ「一律 fill:#000」にすると輪郭記号が塗りつぶし記号に化けてしまう。
そのため `circle` は `stroke:#000` のみ一律で強制し、`fill` は
`:not([fill="none"])` の場合だけ `#000` を強制するようにした。

#### 問題3（確認のみ、修正不要）: 2声部の淡色表示
非アクティブ声部の淡色（`INACTIVE_VOICE_COLOR = '#9ca3af'`）は VexFlow の `setStyle` 経由で
ノートヘッド等の `<path>`/`<rect>` に適用されるため、既存の
`.print-page svg path { fill:#000 !important }` によって印刷時は黒に強制される
（`src/components/PianoSystemCanvas.tsx` 冒頭のコメントの通り）。ブラウザ確認でも
淡色ノートが印刷プレビューでは黒く出ることを確認した。修正不要。

## 影響範囲
- `src/components/ScorePage.tsx`: 既存「印刷」ボタンのラベル・title・ハンドラ名変更のみ（機能自体は不変）。
- `src/App.css`: `@media print` ブロックのみ変更。画面表示（非印刷時）のスタイルには影響しない。
- `src/utils/hairpinRenderUtils.ts`, `src/components/StaffCanvas.tsx`,
  `src/components/PianoSystemCanvas.tsx`: 当たり判定パスに `class` 属性を追加しただけで、
  クリック判定ロジック・描画座標には影響しない。

## テスト
- `docker compose run --rm app npx vitest run`: 全 63 ファイル 855 件成功（既存テストに影響なし。
  当たり判定パスへの `class` 追加は既存のクエリ条件（`data-arc-key-hit` 等）に影響しないため）。
- `docker compose run --rm app npm run build`: 成功。

## ブラウザ確認
- 音符・松葉・練習番号・運指・強弱記号・2声部を含む譜面を用意し、印刷メディアエミュレーションを
  適用して確認。詳細は作業報告（コミットメッセージ・レポート）に記載。
