# カスタム記号エディタ（フリーハンド描画対応）設計書

## 背景・問題

カスタム記号機能はコミット `46ed922` で部分的に cherry-pick されたが、以下が欠けており実際には動作しない。

1. **図形エディタ本体が存在しない** — Palette の「＋」ボタンの `onOpenSymbolEditor` を渡す呼び出し元がない
2. **ScorePage の配線がない** — `customSymbolDefs` / `onOpenSymbolEditor` が Palette / StaffCanvas に渡されていない
3. **永続化パスがない** — `SavedScoreData.customSymbolDefs` 型は定義済みだが、保存・読込・バリデーションのどこにも組み込まれていない

今回、これらを完成させると同時に、ユーザー要望により**フリーハンド描画（自由な線）**を図形プリミティブに追加して自由度を上げる。

## ゴール / 非ゴール

### ゴール
- 図形エディタモーダルで ○・●・直線・弧・**フリーハンド線** を組み合わせてカスタム記号を作成できる
- 作成した記号がパレット「演奏記号」タブに表示され、音符へトグル付与できる
- 記号ライブラリの削除（管理）ができる
- 記号定義が自動保存・ファイル保存・読込で往復する
- 悪意あるファイル読込に対して安全（XSS・データ破壊を防ぐ）

### 非ゴール（今回のスコープ外・将来拡張）
- ピアノ大譜表（PianoSystemCanvas）でのカスタム記号の表示・付与（単旋律譜 = StaffCanvas 系のみ対応。README に制限として明記する）
- 既存記号の再編集（エディタは新規作成のみ。`SymbolEditor` の props 設計は将来 `initialDef` を受け取れる形にしておく）
- MusicXML エクスポートへのカスタム記号の出力
- 記号ライブラリ操作の Undo/Redo 統合

## データモデル

`src/types/storage.ts` の `ShapePrimitive` union にフリーハンド用の `path` を追加する。

```ts
export type ShapePrimitive =
  | { kind: 'circle'; cx: number; cy: number; r: number; filled: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; strokeWidth?: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; sweepAngle: number }
  // フリーハンドの1ストローク。points は逐次記録した頂点列（アンカー基準の論理座標）
  | { kind: 'path'; points: { x: number; y: number }[]; strokeWidth?: number };
```

- 座標系は既存と同じ「(0,0) = アンカー点（音符 BBox 上端中央）、y マイナスで上方向」
- 描画時は折れ線をそのまま出さず、**中点 Quadratic Bézier スムージング**で滑らかに描く
  （`M p0 → L mid(p0,p1) → Q p1 mid(p1,p2) → … → L pN`。点が2個以下なら単純な line）
- 記録時に**最小距離 ε=2（論理px）で間引き**し、点数を抑える

### 上限値（バリデーションと共有する定数）

| 定数 | 値 | 理由 |
|---|---|---|
| `MAX_SYMBOL_DEFS` | 64 | localStorage 容量・パレット UI の破綻防止 |
| `MAX_SHAPES_PER_SYMBOL` | 64 | 描画コスト上限 |
| `MAX_PATH_POINTS` | 600 | 1ストロークの容量上限（間引き後で十分な精度） |
| 座標値の範囲 | -200〜200 | 楽譜レイアウトを壊す巨大図形の防止 |
| `name` の長さ | 1〜30文字 | パレット tooltip 用 |

定数は `customSymbolUtils.ts` に置き、エディタとバリデーションの両方から参照する（二重定義しない）。

## コンポーネント設計

### SymbolEditor（新規: `src/components/SymbolEditor.tsx`）

モーダルダイアログ。記号の**新規作成**と**ライブラリ管理（削除）**を1画面で担う。

- **描画キャンバス**: SVG 要素。論理座標 x∈[-40,40], y∈[-90,10] を 3 倍ズームで表示（240×300px）。
  アンカー位置に十字マーカーと、スケール感の基準として符頭のゴースト（薄いグレーの楕円）を表示する
- **ツール**: フリーハンド（デフォルト）/ 直線 / 円（白・黒）/ 弧 / 図形消し（クリックした図形を削除）
- **線の太さ**: 1 / 1.5 / 2.5 から選択（line と path の strokeWidth に反映）
- **操作**: 元に戻す（shapes 配列のスタック undo）・全消去
- **入力座標の変換**: PointerEvent の clientX/Y → `getBoundingClientRect()` で論理座標へ変換し、
  論理範囲へクランプする。`setPointerCapture` でドラッグ中のポインタを追跡する
  （モーダルは `.page-wrapper` のスケール外に置くため、ページズームの補正は不要）
- **名前入力 + 保存**: `onSave(def: CustomSymbolDef)` を呼ぶ。ID は既存の `generateSymbolId()` を使用
- **既存記号リスト**: プレビュー（`symbolDefToPreviewSvg`）と削除ボタンを表示。`onDelete(symbolId)` を呼ぶ
- props: `{ existingDefs, onSave, onDelete, onClose }`。将来の再編集用に `initialDef?` を追加できる形を保つ

### 削除時の参照整合性

記号を削除しても、音符側の `customSymbols: [{symbolId}]` は掃除しない（宙ぶらりん参照を許容）。
StaffCanvas の描画は `customSymbolDefs.find()` が `undefined` の場合スキップするため安全であり、
掃除すると全パート・全 voice を走査する破壊的変更になるため行わない。この方針をコードコメントに残す。

### ScorePage の配線

- state 追加: `customSymbolDefs: CustomSymbolDef[]`、`showSymbolEditor: boolean`
- `<Palette section="symbols">` に `customSymbolDefs` と `onOpenSymbolEditor` を渡す
- **すべての** `<StaffCanvas>` 使用箇所に `customSymbolDefs` を渡す（単旋律・四重奏・編成譜でインスタンスが複数ある）
- モーダルは toolbar の外・`app-root` 直下に描画する（`position: fixed` オーバーレイ）

## 永続化

- `buildScoreData` → `saveScore`（useScoreStorage）→ `createSavedScoreData` の各シグネチャ末尾に
  省略可能引数 `customSymbolDefs?: CustomSymbolDef[]` を追加（呼び出し3経路: 手動保存・自動保存・ファイル書出）
- 読込（localStorage / ファイル読込の両方）で `data.customSymbolDefs ?? []` を state へ復元する
- **`CURRENT_VERSION`（3.5.0）は上げない**。新フィールドは省略可能で前方・後方互換であり、
  `migrateData` が未知バージョンに `null` を返す実装のため、バージョンを上げると既存譜面の読込が壊れるリスクがある

## セキュリティ設計（最重要）

Palette は `symbolDefToPreviewSvg()` の戻り値を `dangerouslySetInnerHTML` で注入している。
記号定義は**ファイル読込（`importScoreFromFile`）で外部から入ってくる**ため、
数値フィールドに文字列（例: `"><script>...`）が入ったまま SVG 文字列へ補間されると XSS になる。

対策（多層防御）:

1. **入口で厳格バリデーション**: `storage.ts` に `validateCustomSymbolDef()` を追加し、
   `validateSavedScoreData()` から呼ぶ（localStorage 読込・ファイル読込の両方がここを通る）。
   - `id` / `name` は string、長さ上限を強制
   - `shapes` の各要素は kind ごとに全数値フィールドを `Number.isFinite()` で検査
   - `path.points` は配列で各要素の x/y が有限数、点数・図形数・記号数・座標範囲の上限を強制
   - 不正な `customSymbolDefs` はフィールドごと破棄せず**データ全体を invalid** とする（既存バリデータの方針に合わせる）
   - `validateNoteEvent` にも `customSymbols`（省略可、`{symbolId: string}` の配列）の検査を追加
2. **出口で数値強制**: `symbolDefToPreviewSvg` / `renderCustomSymbol` 内で座標を `Number()` に通し、
   非有限値なら図形をスキップする（バリデータをすり抜けた場合の保険）
3. `name` は React のテキスト経路（`title` / `aria-label` 属性）でのみ表示し、SVG 文字列へは補間しない

## 描画ユーティリティの変更（customSymbolUtils.ts）

- `pathPointsToD(points): string` を新設し、スムージング済み `d` 文字列を生成
  （`renderCustomSymbol` / `symbolDefToPreviewSvg` / エディタプレビューの3箇所で共用）
- `renderCustomSymbol` に `case 'path'` を追加（stroke-linejoin: round、fill: none）
- `symbolDefToPreviewSvg` は固定アンカー前提をやめ、**全図形のバウンディングボックスを計算して
  viewBox をフィット**させる（フリーハンドはアンカー近傍に収まる保証がないため）
- `simplifyPoints(points, epsilon): points` を新設（最小距離間引き。エディタの記録時に使用）

## テスト

- `customSymbolUtils.test.ts`（新規）: トグル付与/除去、`pathPointsToD` の形状（点0/1/2/多数）、
  `simplifyPoints` の間引き、プレビュー SVG に `NaN` が含まれないこと
- `storage.test.ts`（追記）: `customSymbolDefs` 込みの保存→読込往復、
  不正定義（数値でない座標・上限超過・型違い）の拒否

## 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/types/storage.ts` | `ShapePrimitive` に `path` 追加 |
| `src/utils/customSymbolUtils.ts` | `path` 描画・スムージング・間引き・bbox フィット・上限定数 |
| `src/utils/storage.ts` | バリデーション追加、`createSavedScoreData` 引数追加 |
| `src/hooks/useScoreStorage.ts` | `saveScore` 引数追加 |
| `src/components/SymbolEditor.tsx` | **新規**（エディタモーダル） |
| `src/components/ScorePage.tsx` | state・配線・保存/読込への組み込み |
| `src/components/Palette.tsx` | 変更なしの見込み（props は実装済み） |
| `src/components/StaffCanvas.tsx` | 変更なしの見込み（props・描画は実装済み） |
| `README.md` | 機能説明の実態合わせ（フリーハンド追記・ピアノ譜非対応の明記） |

## 既知のリスクと判断

1. **XSS（ファイル読込→プレビュー注入）** → 上記セキュリティ設計で対処
2. **localStorage 容量圧迫**（フリーハンドの点数） → 間引き + 上限値で対処
3. **バージョン移行での既存データ破壊** → バージョンを上げないことで回避
4. **ピアノ譜で記号が見えない** → 非ゴールとして明記（データは保持されるので表示側の将来対応で解消）
5. **記号削除後の宙ぶらりん参照** → 描画側のスキップで無害。掃除はしない（設計判断として記録）

## 実装メモ（実装完了後の追記）

上記設計に沿って実装済み。主な実装ファイルと要点は以下の通り。

- `src/types/storage.ts`: `ShapePrimitive` に `path` バリアントを追加
- `src/utils/customSymbolUtils.ts`: 上限定数（`MAX_SYMBOL_DEFS` / `MAX_SHAPES_PER_SYMBOL` / `MAX_PATH_POINTS` / 座標範囲 / 名前長）、`pathPointsToD`（中点 Quadratic スムージング。点0/1/2/多数の場合分け）、`simplifyPoints`（最小距離間引き）、`renderCustomSymbol` の `case 'path'` 追加、`symbolDefToPreviewSvg` の全図形bboxフィット化（非有限値の図形はスキップ）を実装
- `src/utils/storage.ts`: `validateShapePrimitive` / `validateCustomSymbolDef` / `validateCustomSymbolDefs` を追加し `validateSavedScoreData` から呼び出し。`validateNoteEvent` に `customSymbols`（省略可、`{symbolId: string}[]`）の検査を追加。`createSavedScoreData` の末尾に省略可能引数 `customSymbolDefs?` を追加（`CURRENT_VERSION` は変更なし）
- `src/hooks/useScoreStorage.ts`: `saveScore` の末尾に省略可能引数 `customSymbolDefs?` を追加
- `src/components/SymbolEditor.tsx`: 新規。設計どおりのモーダル（SVGキャンバス 240×300px、ズーム3倍、フリーハンド/直線/円(白黒)/弧/図形消し、線の太さ1/1.5/2.5、undo・全消去、既存記号一覧＋削除）
- `src/components/ScorePage.tsx`: `customSymbolDefs` / `showSymbolEditor` state を追加し、`Palette section="symbols"` と単旋律の `StaffCanvas` へ配線。保存3経路（手動保存・自動保存・ファイル書出）と読込2経路（localStorage・ファイル読込）に組み込み。モーダルは `position: fixed` オーバーレイとして `app-root` 直下（`</header>` の直後）に描画
- `src/components/Palette.tsx` / `src/components/StaffCanvas.tsx`: 設計どおり変更なし（props・描画は実装済みのものをそのまま利用）

### 設計からの差分

- `EnsembleStaff.tsx` / `QuartetStaff.tsx` / `PianoStaff.tsx` は内部でいずれも `PianoSystemCanvas` を描画しており、`StaffCanvas` を直接使っているのは単旋律譜（`ScorePage.tsx` 内の1箇所）のみだった。設計書は「複数箇所ある `StaffCanvas` すべてに配線する」としていたが、実際に `<StaffCanvas>` を使っているのはその1箇所のみであることを確認した上で、そこにのみ `customSymbolDefs` を渡した（`PianoSystemCanvas` にカスタム記号 props が無いことも確認済みで、これは設計の非ゴール「ピアノ大譜表でのカスタム記号表示」と整合する）

## 追加機能: 個別記号サイズ調整（配置ごと）

ユーザーから「記号の大きさを後から変えられるようにしたい」との要望。確認の結果、**記号定義（ライブラリ）全体ではなく、音符への配置1件ごとに個別のサイズ**を持たせる方式を採用する（同じ記号を複数の音符に付けても、それぞれ別々の大きさにできる）。

### データモデル

`NoteEvent.customSymbols` の要素に `scale` を追加する（省略可、省略時は等倍 1.0 として扱う。後方互換）。

```ts
customSymbols?: { symbolId: string; scale?: number }[];
```

上限定数を `customSymbolUtils.ts` に追加する（他の上限定数と同じ場所に置き、エディタ側UIとバリデーションで共有）。

```ts
export const MIN_SYMBOL_SCALE = 0.25;
export const MAX_SYMBOL_SCALE = 4;
```

### 描画（`customSymbolUtils.ts`）

- `renderCustomSymbol(def, anchorX, anchorY, svgRoot, scale = 1)` に第5引数 `scale` を追加する。各図形の座標（cx/cy/r、x1/y1/x2/y2、points の x/y）と `strokeWidth` を `scale` 倍してからアンカー座標を加算する（見た目の太さも含めて比例拡大・縮小することで自然な拡大縮小になる）
- `symbolDefToPreviewSvg`（パレットのアイコン用プレビュー）は記号定義そのものの固定プレビューであり、配置ごとの scale とは無関係なので変更しない
- 新規関数 `setCustomSymbolScale(event: NoteEvent, symbolId: string, scale: number): NoteEvent` を追加。指定 symbolId が `event.customSymbols` に **すでに存在する場合のみ** その要素の `scale` を更新する（存在しない場合は何もせず元の event をそのまま返す。サイズ変更は「すでに付いている記号」に対してのみ意味を持つため）。scale は `MIN_SYMBOL_SCALE`〜`MAX_SYMBOL_SCALE` にクランプする

### StaffCanvas への組み込み

- `StaffCanvas.tsx:2598-2604` の `customSymbolEntries` 収集部分を、`symbolIds: string[]` から `symbols: { symbolId: string; scale: number }[]`（`s.scale ?? 1`）に変更する
- `StaffCanvas.tsx:2770-2773` の描画ループを `symbols.forEach(({ symbolId, scale }) => { const def = ...; if (def) renderCustomSymbol(def, anchorX, anchorY, svgRoot, scale); })` に変更する

### 操作UI（サイズ変更モード）

既存の「途中テンポ変更」（`bpmEditState`、`StaffCanvas.tsx:776`）と同じ「小節/音符をクリック→インライン数値入力オーバーレイ→Enterで確定・Escapeでキャンセル」のパターンを再利用する。

1. **Tool 型に追加**: `{ mode: 'customSymbolResize'; symbolId: string }`
2. **Palette.tsx**: 各カスタム記号ボタンの隣に小さな「サイズ変更」ボタン（例: 「⤢」または「サイズ」の文字、`title="◯◯のサイズを変更（対象の音符をクリック）"`）を追加し、クリックで `onChange({ mode: 'customSymbolResize', symbolId: def.id })` を呼ぶ
3. **StaffCanvas.tsx**: `bpmEditState` と同じ形の state `symbolResizeEditState`（`{ measureAbsoluteIndex, eventIndex, symbolId, currentValue: string, overlayX, overlayY }`）を追加。
   - `tool.mode === 'customSymbolResize'` のとき、音符クリックで **その音符の customSymbols に対象 symbolId が含まれる場合のみ** オーバーレイを開く（含まれない場合は何もしない。付いていない記号のサイズは変更できない）
   - 入力値は「%」表記（例: 現在値 `scale=1.2` なら初期表示 `120`）。確定時に `/100` して `setCustomSymbolScale` を適用し、`MIN_SYMBOL_SCALE`〜`MAX_SYMBOL_SCALE`（25〜400）にクランプする
   - 空欄で確定した場合は等倍（scale=1、表示100）にリセットする

### バリデーション（`storage.ts`）

`validateNoteEvent` の `customSymbols` チェックに `scale`（省略可、有限数値、`MIN_SYMBOL_SCALE`〜`MAX_SYMBOL_SCALE` の範囲）の検査を追加する。

### 影響範囲（追加分）

| ファイル | 変更内容 |
|---|---|
| `src/types/storage.ts` | `customSymbols` 要素に `scale?: number` を追加 |
| `src/utils/customSymbolUtils.ts` | `MIN_SYMBOL_SCALE`/`MAX_SYMBOL_SCALE` 定数、`renderCustomSymbol` に `scale` 引数、`setCustomSymbolScale` 新設 |
| `src/utils/storage.ts` | `customSymbols` の `scale` バリデーション追加 |
| `src/components/Palette.tsx` | カスタム記号ごとに「サイズ変更」ボタンを追加 |
| `src/components/StaffCanvas.tsx` | `customSymbolResize` ツールモード追加、`symbolResizeEditState` とインラインオーバーレイ、`customSymbolEntries` の scale 対応 |

### 既知のリスクと判断（追加分）

1. **既存データ互換**: `scale` は省略可能フィールドなので、旧データ（scale なし）は全て等倍として描画され続ける。バージョン番号は変更しない
2. **記号が付いていない音符でのサイズ変更操作**: 何もしない（トグル付与のような新規作成はしない）。ユーザーが誤って別ツール操作をしても記号が生えることはない
3. **極端な拡大縮小**: `MIN_SYMBOL_SCALE`(0.25)〜`MAX_SYMBOL_SCALE`(4) でクランプし、楽譜レイアウトが壊れるほどの拡大や見えなくなるほどの縮小を防ぐ

### 実装メモ（個別記号サイズ調整・実装完了後の追記）

上記設計に沿って実装済み。主な実装ファイルと要点は以下の通り。

- `src/types/storage.ts`: `NoteEvent.customSymbols` の要素に `scale?: number` を追加（省略時は等倍1.0）
- `src/utils/customSymbolUtils.ts`: `MIN_SYMBOL_SCALE`(0.25) / `MAX_SYMBOL_SCALE`(4) を他の上限定数と同じ場所に追加。`renderCustomSymbol` に第5引数 `scale = 1` を追加し、各図形の座標（cx/cy/r、x1/y1/x2/y2、path の points）と strokeWidth を scale 倍してからアンカー座標を加算するよう変更（`symbolDefToPreviewSvg` は設計どおり変更なし）。新規 `setCustomSymbolScale(event, symbolId, scale)` を追加（対象 symbolId が存在する場合のみ更新し、MIN〜MAXにクランプ。存在しなければ元の event をそのまま返す）
- `src/components/StaffCanvas.tsx`: `customSymbolEntries` の収集を `symbolIds: string[]` から `symbols: { symbolId; scale }[]`（`s.scale ?? 1`）に変更し、描画ループも `renderCustomSymbol(def, anchorX, anchorY, svgRoot, scale)` を渡すよう対応。`Tool` 型（`Palette.tsx`）に `{ mode: 'customSymbolResize'; symbolId }` を追加。`bpmEditState` と同型の `symbolResizeEditState`（`{ measureAbsoluteIndex, eventIndex, symbolId, currentValue, overlayX, overlayY }`）を追加し、同じ「クリックで開く→インライン入力→Enter確定/Escapeキャンセル/blurで確定」パターンで実装。`customSymbolResize` モード中の音符クリックは、対象 symbolId が customSymbols に存在する場合のみオーバーレイを開く（存在しない場合・休符の場合は何もしない）。表示は%表記（scale=1.2→"120"）、確定時に /100 して `MIN_SYMBOL_SCALE`〜`MAX_SYMBOL_SCALE`（25〜400）にクランプ、空欄確定は等倍（scale=1）にリセット
- `src/components/Palette.tsx`: 各カスタム記号ボタンの右隣に「⤢」ボタンを追加。クリックで `onChange({ mode: 'customSymbolResize', symbolId: def.id })`。title/aria-labelは「◯◯のサイズを変更（対象の音符をクリック）」
- `src/utils/storage.ts`: `validateNoteEvent` の `customSymbols` チェックに `scale`（省略可・有限数値・`MIN_SYMBOL_SCALE`〜`MAX_SYMBOL_SCALE` 範囲内）の検査を追加
- テスト: `customSymbolUtils.test.ts` に `setCustomSymbolScale`（更新・存在しないID・クランプ上下限）と `renderCustomSymbol` の scale 反映（circle/line/path の座標・strokeWidthがscale倍されること）を追加。`storage.test.ts` に scale 込み保存→読込往復・省略時後方互換・範囲外拒否・非数値拒否のテストを追加
- ブラウザ確認: 開発サーバー上でカスタム記号を作成→音符へ付与→サイズ変更ツールで該当音符をクリック→オーバーレイに初期値100が表示されることを確認→250を入力してEnter確定→記号が視覚的に2.5倍程度に拡大表示され、SVG上のcircleのr属性が実際に比例して増加していることを確認。コンソールエラーなし
