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

## 追加修正: オーバーレイ描画の重複DOM生成バグ（レビュー中に発見した既存バグ）

### 問題

サイズ調整機能のレビュー中のDOM実測で、カスタム記号（および強弱・アーティキュレーション・
テキスト要素・ペダル・オッターバのすべてのオーバーレイ）が**段数ぶん同一座標に重複描画**
されていることを発見した（9段の譜面で記号1個 = 9つの同一DOM要素）。

- 原因: 各 `〜Entries` 収集配列は `StaffCanvas` の描画エフェクト冒頭（段ループ外）で宣言され
  全段を通して蓄積されるのに、それを描画する `forEach` 群が段ループ（`for (let line = 0; ...)`）の
  **内側**に置かれていたため、段が進むたびに蓄積済みの全エントリを再描画していた
- 同一座標に重なるため見た目は1個で、これまで顕在化していなかった（性能・DOMサイズの問題）
- カスタム記号の初期実装から存在する既存バグで、サイズ調整機能が持ち込んだものではない

### 修正設計

- オーバーレイ描画の `forEach` 群（約230行）を段ループ完了後（`pendingArcs` 描画の直前）へ移動し、
  全段のレンダリング完了後に一度だけ描画する
- 段ローカル変数（`lineNotes` / `carryTie`）を使う行内タイグループ描画はループ内に残す
- 再発防止のため、移動先に「entries はループ全体で蓄積されるためループ内描画は重複になる」旨の
  コメントを残した

### 影響範囲

`src/components/StaffCanvas.tsx` のみ（描画ブロックの移動とコメント追加。ロジック変更なし）。
ブラウザ実測で記号のDOM要素が 9個→1個 になり、スタッカート等の他オーバーレイも重複しないこと、
見た目・トグル動作が変わらないことを確認済み。

## 追加機能: 記号の高さ統一と個別位置調整

ユーザー要望「記号は五線の上・音符の上に、基本全部同じ高さで、後から位置調整できるように」。
現状はアンカーYが**各音符の符頭上端**（音高ごとに上下する）ため、同じ記号でも音符ごとに
高さが変わる（最初の顔記号スクショで2つが別々の高さに浮いていたのがこれ）。これを
「五線の上端でそろえる（音高非依存の統一高さ）＋配置ごとの手動オフセット」に変更する。

### ゴール
- カスタム記号の縦位置は、その段の五線上端を基準にした一定の高さに統一する（音高で上下しない）
- 段が変われば、その段の五線上端に合わせる（段内は統一、段ごとに各五線基準）
- 配置1件ごとに縦・横の微調整オフセットを後から設定できる（サイズ変更と同じインライン入力）

### 非ゴール
- ドラッグでの位置調整（今回はインライン数値入力のみ。矢印キー方式も採らない）
- ピアノ大譜表側の対応（従来どおり単旋律譜のみ）

### データモデル（storage.ts）
`NoteEvent.customSymbols` の要素に `offsetX?` / `offsetY?` を追加（省略可、既定0、単位はSVG論理px）。

```ts
customSymbols?: { symbolId: string; scale?: number; offsetX?: number; offsetY?: number }[];
```

`customSymbolUtils.ts` に上限定数を追加（他の上限定数と同じ場所）。
```ts
export const MIN_SYMBOL_OFFSET = -100;
export const MAX_SYMBOL_OFFSET = 100;
```

### 描画（StaffCanvas.tsx）
- アンカーY統一: `customSymbolEntries.push` の `anchorY` を
  `(bb?.getY?.() ?? stave.getYForLine(0) - 4) - 4`（音符の符頭上端基準）から
  **五線上端基準の固定値** `stave.getYForLine(0) - 10`（マージンはブラウザ確認で微調整可）へ変更。
  これで音高に依存せず同じ段の記号は同じ高さになる
- 収集を `symbols: { symbolId; scale; offsetX; offsetY }[]`（`s.offsetX ?? 0` / `s.offsetY ?? 0`）に拡張
- 描画時に `renderCustomSymbol(def, anchorX + offsetX, anchorY + offsetY, svgRoot, scale)` を渡す
  （`renderCustomSymbol` のシグネチャは変更不要。呼び出し側でオフセットを加算する）

### 操作UI（位置調整モード）
サイズ変更（`customSymbolResize` / `symbolResizeEditState`）と同じパターンを踏襲する。
1. `Tool` 型（Palette.tsx）に `{ mode: 'customSymbolOffset'; symbolId: string }` を追加
2. Palette: 各カスタム記号の「⤢」ボタンの隣に「✥」位置調整ボタンを追加し、
   クリックで `onChange({ mode: 'customSymbolOffset', symbolId: def.id })`
   （title/aria-labelは「◯◯の位置を調整（対象の音符をクリック）」）
3. StaffCanvas: `bpmEditState` 系と同型の `symbolOffsetEditState`
   （`{ measureAbsoluteIndex, eventIndex, symbolId, currentX: string, currentY: string, overlayX, overlayY }`）を追加。
   - `tool.mode === 'customSymbolOffset'` のとき、対象記号が付いた音符クリックでのみオーバーレイを開く
     （付いていなければ何もしない）
   - オーバーレイは「横」「縦」の2つの数値入力（px）。既存 offset を初期値表示。
     `MIN_SYMBOL_OFFSET`〜`MAX_SYMBOL_OFFSET` にクランプ。**縦は＋で下・−で上**（SVG座標系）としてラベルに明記
   - Enterで確定・Escapeでキャンセル・blurで確定（サイズ変更と同じ）
   - 空欄は0として扱う
4. `customSymbolUtils.ts` に `setCustomSymbolOffset(event, symbolId, offsetX, offsetY)` を追加
   （対象 symbolId が存在する場合のみ更新しクランプ。存在しなければ元の event をそのまま返す）
5. StaffCanvas の「休符クリック early-return」「セル外クリック early-return」の
   `customSymbolResizeMode` ガードと同じ場所に `customSymbolOffsetMode` ガードを追加

### バリデーション（storage.ts）
`validateNoteEvent` の `customSymbols` チェックに `offsetX` / `offsetY`
（各省略可・有限数値・`MIN_SYMBOL_OFFSET`〜`MAX_SYMBOL_OFFSET` の範囲）の検査を追加。

### 影響範囲
| ファイル | 変更内容 |
|---|---|
| `src/types/storage.ts` | `customSymbols` 要素に `offsetX?`/`offsetY?` を追加 |
| `src/utils/customSymbolUtils.ts` | `MIN/MAX_SYMBOL_OFFSET` 定数、`setCustomSymbolOffset` 新設 |
| `src/utils/storage.ts` | `customSymbols` の offset バリデーション追加 |
| `src/components/Palette.tsx` | 記号ごとに「✥」位置調整ボタンを追加、`customSymbolOffset` モード |
| `src/components/StaffCanvas.tsx` | アンカーY統一、offset収集・描画、`symbolOffsetEditState` とオーバーレイ |

### 既知のリスクと判断
1. **既存配置の高さが変わる**: 音符追従→五線上端統一に変わるため、既存譜面の記号の見た目高さが変化する。これは要望どおりの意図的変更。offsetは既定0で後方互換
2. **高い音（上加線）での近接**: 統一高さだと高音符と近づくことがあるが、手動オフセットで回避する設計（推奨案の想定内）
3. **縦の符号方向**: SVGは下が＋。ユーザー混乱を避けるため入力欄ラベルに「＋で下・−で上」を明記

### 実装メモ（記号の高さ統一と個別位置調整・実装完了後の追記）

上記設計に沿って実装済み。主な実装ファイルと要点は以下の通り（`customSymbolResize` / `symbolResizeEditState` と同じパターンで実装した「双子」機能）。

- `src/types/storage.ts`: `NoteEvent.customSymbols` の要素に `offsetX?: number` / `offsetY?: number` を追加（省略可、既定0、単位はSVG論理px）
- `src/utils/customSymbolUtils.ts`: `MIN_SYMBOL_OFFSET`(-100) / `MAX_SYMBOL_OFFSET`(100) を他の上限定数と同じ場所に追加。新規 `setCustomSymbolOffset(event, symbolId, offsetX, offsetY)` を追加（`setCustomSymbolScale` と同じ作法で、対象 symbolId が存在する場合のみ offsetX/offsetY を更新しクランプ。存在しなければ元の event をそのまま返す）
- `src/components/StaffCanvas.tsx`:
  - `customSymbolEntries.push` の `anchorY` を `(bb?.getY?.() ?? stave.getYForLine(0) - 4) - 4`（音符の符頭上端基準）から `stave.getYForLine(0) - 10`（五線上端基準の固定値）へ変更し、音高に依存せず同じ段の記号が同じ高さになるようにした
  - 収集を `symbols: { symbolId; scale; offsetX; offsetY }[]`（`s.offsetX ?? 0` / `s.offsetY ?? 0`）に拡張し、描画ループを `renderCustomSymbol(def, anchorX + offsetX, anchorY + offsetY, svgRoot, scale)` に変更（`renderCustomSymbol` のシグネチャは変更なし）
  - `Tool` 型（`Palette.tsx`）に `{ mode: 'customSymbolOffset'; symbolId: string }` を追加
  - `symbolResizeEditState` と同型の `symbolOffsetEditState`（`{ measureAbsoluteIndex, eventIndex, symbolId, currentX, currentY, overlayX, overlayY }`）を追加。対象記号が付いた音符クリックでのみオーバーレイを開く（付いていない場合・休符・セル外クリックは何もしない。`customSymbolResizeMode` ガードがある全箇所に `customSymbolOffsetMode` ガードを追加）
  - オーバーレイは「横」「縦」の2つの数値入力（px）。既存 offsetX/offsetY を初期値表示。MIN_SYMBOL_OFFSET〜MAX_SYMBOL_OFFSET にクランプ。縦は＋で下・−で上とラベルに明記。空欄は0扱い。Enter確定・Escapeキャンセル・blur確定（横・縦それぞれ独立した入力なので、片方を確定する際にもう片方の最新値を参照できるよう `useRef` で相互参照する）
  - 確定時に `handleSymbolOffsetConfirm` から `setCustomSymbolOffset` を `setScore` 経由で適用
- `src/components/Palette.tsx`: 各カスタム記号の「⤢」ボタンの隣に「✥」位置調整ボタンを追加。クリックで `onChange({ mode: 'customSymbolOffset', symbolId: def.id })`。title/aria-labelは「◯◯の位置を調整（対象の音符をクリック）」。`selectedCustomSymbolOffsetId` を用意してアクティブ表示
- `src/utils/storage.ts`: `validateNoteEvent` の `customSymbols` チェックに `offsetX` / `offsetY`（各省略可・有限数値・MIN_SYMBOL_OFFSET〜MAX_SYMBOL_OFFSET範囲内）の検査を追加
- テスト: `customSymbolUtils.test.ts` に `setCustomSymbolOffset`（更新／存在しないID無変更／クランプ上下限）のテストを追加。`storage.test.ts` に offset込み保存→読込往復・範囲外offset拒否のテストを追加
- ブラウザ確認: 開発サーバー上でカスタム記号を新規作成→音符へ付与→位置調整ツールで該当音符をクリック→オーバーレイに初期値0/0が表示されることを確認→横15・縦30を入力してEnter確定→SVG上の記号座標が実際に (+15, +30) 移動していることを確認→再度同じ音符をクリックすると保存済みの15/30が初期値として表示されることを確認→Escapeキーでオーバーレイがキャンセルされることを確認。コンソールエラーなし

## 追加機能: 位置調整オーバーレイの矢印キー移動（Issue #205）

### 問題

譜面上の位置調整オーバーレイ（`PianoSystemCanvas.tsx` の `symbolOffsetEditState`）は
「横」「縦」の数値入力2つだけで、少し動かして確かめる、をくり返すたびに値を打ち直す必要があった。
一方、カスタム記号エディタ（`SymbolEditor.tsx`）には矢印キーでの微調整が既にあり、
同じ「位置を決める」操作なのに操作語彙が食い違っていた。

### 修正設計

オーバーレイが開いている間、矢印キーで対象記号のオフセットを増減し、譜面の記号がその場で動くようにする。

- **1押し = 1px、Shift+矢印 = 10px**（`src/utils/symbolOffsetNudgeUtils.ts` の
  `SYMBOL_OFFSET_NUDGE_STEP` / `SYMBOL_OFFSET_NUDGE_STEP_LARGE`）
- **左右＝横、上下＝縦**。どちらの入力欄にフォーカスがあっても向きは変わらない。
  縦は画面座標と同じ「＋で下」（オーバーレイの説明文と同じ向き）
- クランプ範囲・空欄や非数値の扱いは `parseSymbolOffsetInput` に委譲し、
  数値入力で作れる値と矢印キーで作れる値が必ず一致するようにした
- 数値入力欄は残す（大きく飛ばす・正確な値を入れる用途）。矢印キーで動かした値は入力欄へ即座に反映する
- Enter または オーバーレイ外クリック（blur）で確定、**Esc で開いた時点の位置へ戻す**

#### Undo 履歴を1件に保つ仕組み（この機能の肝）

`setPartsScore` を呼ぶと親（`ScorePage`）へ通知が飛び、`pushHistory()` で履歴が1件積まれる。
矢印キー1押しごとにこれを呼ぶと、10回動かしたら Undo が10回必要になり使い物にならない。

そこで **確定するまで保存データ（`partsScore`）を一切書き換えない**構造にした。

1. `symbolOffsetEditState` に `draftX` / `draftY`（まだ保存していない下書き）を持たせる。
   `currentX` / `currentY` は「開いた時点の保存済みの値」のまま最後まで変えない
   （Esc の戻り先であり、値を変えずに blur したときの no-op 判定の基準でもあるため）
2. `partsScoreForRender`（`useMemo`）が、下書きがあるときだけ対象イベントのオフセットを
   差し替えたコピーを返す。描画 effect はこちらを読む
3. 確定時にだけ、従来どおり `handleSymbolOffsetConfirm` が `setPartsScore` を1回呼ぶ
4. Esc は `symbolOffsetEditState` を null にするだけ。保存データは一度も変わっていないので、
   それだけで開いた時点の位置へ戻る

再描画のトリガーには `symbolOffsetDraftKey`（下書きを1本の文字列へ畳んだもの）を使い、描画 effect の
依存配列へ入れている。オブジェクトを直接入れると毎レンダー別物と見なされ、無関係な再レンダーのたびに
譜面全体を描き直してしまうため。オーバーレイを開いただけ（下書き＝保存値）ではキーが空文字のままなので、
従来どおり描き直しは起きない。

#### 入力欄フォーカス中の矢印キーをどう扱うか（トリアージが実装時に選ぶよう求めていた点）

**「number 入力の既定動作（スピンボタン・カーソル移動）を `preventDefault` で止めて、自前の移動へ振り替える」**を選んだ。理由は3つ。

1. 既定のスピンには Shift での大きい刻みが無い（10px 移動が作れない）
2. 既定では ArrowLeft/Right が入力欄のカーソル移動になり、「横の入力欄では左右キーで記号が動かない」という
   十字キーとして破綻した操作になる
3. 縦の入力欄にフォーカスがあるときの ArrowUp が「縦の値を＋1」になり、
   画面の上向きと逆に動く（この欄は＋が下のため）

代償として、数値入力欄の中でのカーソル移動が矢印キーでできなくなる。
数値は最大3文字（-100〜100）で、選択して打ち直す・Backspace で消す操作で足りるため許容とした。

キーの横取りは**オーバーレイの入力欄の `onKeyDown` の中だけ**で行い、window のキーハンドラは触っていない。
既存の入力欄が最後に `e.stopPropagation()` を呼んでいるおかげで、音符編集用の window リスナーへは
もともと届かない構造になっているため（この作法をそのまま維持している）。

#### SymbolEditor の刻み（0.5 / 2）と合わせなかった理由

トリアージは「SymbolEditor と同じ加減に揃える（実値を確認して一致させること）」としているが、
`SymbolEditor.tsx` の `NUDGE_STEP` = 0.5 / `NUDGE_STEP_LARGE` = 2 は
**記号エディタのキャンバス内の論理座標**（`LOGICAL_X_MIN..MAX` = -40〜40、`LOGICAL_Y` = -90〜10）の単位で、
譜面上の px とは尺度が違う。さらに位置調整欄の値は `parseSymbolOffsetInput` が `parseInt` で
**整数へ丸める**ため、0.5 刻みは表現できない（押しても値が変わらない）。
そのためトリアージが明示している **1px / 10px** を採った。

### 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/utils/symbolOffsetNudgeUtils.ts` | 新設。キー→移動量の解決と、範囲内へ丸めた加算 |
| `src/utils/symbolOffsetNudgeUtils.test.ts` | 新設。刻み・向き・クランプ・往復一致のテスト |
| `src/components/PianoSystemCanvas.tsx` | `symbolOffsetEditState` に `draftX`/`draftY` 追加、`symbolOffsetDraft` / `symbolOffsetDraftKey` / `partsScoreForRender` / `nudgeSymbolOffset` / `handleSymbolOffsetArrowKey` を追加。描画は `partsScoreForRender` を読む。オーバーレイに操作説明の1行を追加 |

保存データの形（`symbolAdjust` / `customSymbols` の `offsetX`/`offsetY`）は変えていないので、
バリデーション（`storage.ts`）・MusicXML・既存譜面への影響はない。

### 既知のリスクと判断

1. **矢印キー1押しごとに譜面全体が VexFlow で描き直される。** 記号1つだけを動かす軽い更新ではない。
   キーを押しっぱなしにしても追従したため現状は許容とした。重く感じる場合は、
   下書き中だけ対象の SVG 要素へ `transform: translate` を当てる方式へ寄せる余地がある
2. **入力欄でのカーソル移動が矢印キーでできない**（上記のとおり意図的な代償）
3. 下書き中の値は保存データに入らないため、**矢印キーで動かしている最中にオートセーブが走っても
   下書きは保存されない**。確定するまで保存されないのは数値入力のときと同じ挙動

### 実装メモ（実装完了後の追記）

- 矢印キーで動かす基準値は state ではなく**入力欄の DOM の `value`** から読んでいる。
  キーを押しっぱなしにすると再レンダーを待たずに keydown が連続で来るため、
  state を基準にすると同じ位置へ戻り続けてしまう
- 入力欄の `value` の書き換えは `setState` の更新関数の**外**で行っている
  （更新関数は React が2回呼ぶことがあり、中で副作用を起こすと移動量が2倍になる）
- ブラウザ確認（worktree だけを載せた使い捨て dev サーバー・`localhost:5174`）:
  強弱記号 `f` を対象に、→×3 で SVG の `x` が 94.74→97.74（+3px）・入力欄が 3 に追従、
  Shift+↑ で `y` が 126→116（-10px）・入力欄が -10 に追従することを実測。
  10回動かしても「元に戻す」ボタンは無効のまま（履歴が積まれていない）で、
  Enter 確定後に有効化し、Undo 1回で元の位置へ戻ることを確認。
  Esc は座標が完全に元へ戻る（94.73694772431342 まで一致）ことを確認。
  数値直接入力（-20）も従来どおり確定できる。コンソールエラー0件

## 追加修正: 調整オーバーレイが対象の記号を隠す（Issue #230）

### 問題

「記号位置調整」「記号サイズ変更」のオーバーレイは、**クリックした座標にそのまま開く**実装だった
（`left: overlayX, top: overlayY - 10`）。オーバーレイの高さは 60〜80px あるため、
記号のすぐ上に本体が乗り、**調整している記号そのものが隠れる**。
#205 で矢印キーによるリアルタイム移動を入れたことで、
「動かせるのに動いている記号が見えない」という形で実害が表面化した（運用者の実機テストで発見）。

### 修正設計

配置の決め方（トリアージで確定した優先順位）:

1. 既定は対象記号の**上**（記号の実描画範囲から `SYMBOL_OVERLAY_GAP` = 8px 離す）
2. 上に収まらない（画面上端・ツールバーに掛かる）ときは**下へフリップ**
3. 上下どちらにも収まらない（縦の可視範囲が足りない）ときだけ、記号のX範囲を避けて**左右へ逃がす**
4. 横位置は記号の中央にそろえ、可視範囲からはみ出さないようクランプする

**位置は開いた時点で1回だけ決め、調整中は動かさない。** 矢印キーで記号が動くたびに
オーバーレイが追いかけると、連打中に UI が逃げて操作できなくなるため
（`SymbolAdjustOverlay` の `useLayoutEffect` の依存は `anchor` と計測リトライカウンタ
（#392・追補3参照。リトライは position 未確定の間だけ働き、確定後に再配置はしない）。
`anchor` はオーバーレイを開いた時点に作られたオブジェクトで、下書きの更新では差し替わらない）。

#### 「対象記号がどこに描かれているか」をどう知るか

すでに記号ごとのクリック判定 rect（`.symbol-hit-region`。演奏記号タブのクリック用）を
描画時に置いてあるので、**その矩形をそのまま回避対象として使う**（記号の bbox ＋3px）。

- 記号そのものをクリックして開く経路: 押した rect の `getBoundingClientRect()` を使う
- 音符をクリックして開く経路（サイズ・位置調整ツール、複数記号の選択リスト）:
  rect に付けた `data-symbol-part` / `-measure` / `-event` / `-target` を手がかりに DOM から引き当てる
- どちらも取れない場合（記号が未描画・jsdom など）はクリック点を「大きさ0の対象」として扱う

#### 座標系（ページ縮小との関係）

ページ（`.print-page`）は `transform: scale` で縮小表示されるが、
`position: absolute` の `left/top` は**縮小前**の座標で解釈される。
`getBoundingClientRect()` は縮小後の実測値を返すため、そのまま使うと縮小表示時だけずれる。
`コンテナの実測幅 ÷ offsetWidth`（offsetWidth は transform の影響を受けない）で縮小率を求め、
実測値を割って座標系をそろえている。従来の `clientX - containerRect.left` にはこの補正が無かったため、
縮小表示中はクリック位置とオーバーレイ位置がずれていた（今回あわせて解消）。

#### 2系統にしない

サイズ変更・位置調整は見た目も配置ルールも同じなので、`SymbolAdjustOverlay` という
**共通の入れ物コンポーネント**にまとめた（枠線・影・padding などの見た目もここへ集約）。
片方だけ直してもう片方が隠したまま、という分岐を作らないため（トリアージの明示要件）。
## 追加修正: ツールを切り替えても調整オーバーレイが残る（Issue #231）

### 問題

運用者の実機テストで発見。レビュアーが手順を特定した。

1. ✥（位置調整）を選び、記号付きの音符をクリック → 位置調整オーバーレイが開く
2. オーバーレイを閉じずに ⤢（サイズ変更）ボタンを押す → **ツールは⤢に切り替わるのに、
   位置調整オーバーレイが開いたまま残る**（「サイズを押したのに位置調整が出ている」と見える）
3. その状態で音符をクリックすると、フォーカスが残った入力欄の後始末にクリックが消費され、
   **1回無反応**になる

原因は、オーバーレイの state（`symbolResizeEditState` / `symbolOffsetEditState` /
`symbolAdjustPickerState`）がツールの変更をまったく見ていなかったこと。
これらは「対象の音符が削除されたとき」（`closeEventEditOverlaysFor`）と
Enter / Esc / blur でしか閉じない作りだった。

ブラウザによって症状の出方が違う点も分かった。**Chrome 系はボタンのクリックでフォーカスが移る**ため
入力欄の `onBlur`（＝確定）が先に走ってオーバーレイは閉じるが、**Safari はボタンのクリックで
フォーカスが移らない**ため閉じるきっかけが無く、上の症状になる。

### 修正設計

トリアージの指示どおり「オーバーレイごとの個別対応ではなく、ツール変更を1箇所で受ける」形にした。

1. **ツールが変わったら調整系オーバーレイを3つとも閉じる**（`PianoSystemCanvas.tsx`）。
   閉じ方は Esc と同じ**キャンセル扱い**（state を捨てるだけ）。矢印キーの移動ぶんは
   下書き（`draftX`/`draftY`）にしか入っておらず保存データには触れていないため、
   捨てれば開いた時点の位置へ戻り、Undo 履歴も汚れない（#205 / #208 の原則を維持）
2. 依存の判定には **ツールの内容を文字列にした識別キー**を使う（`resolveToolIdentityKey`）。
   `Tool` はオブジェクトなので、同じツールでも `setTool` のたびに参照が変わる。
   オブジェクトのまま `useEffect` の依存配列へ入れると、切り替えていないのに
   毎回閉じてしまい**オーバーレイがそもそも開けなくなる**
3. **フォーカスがツールパレットへ移ったときの blur は確定ではなくキャンセルにする**
   （`isToolPaletteElement`）。Chrome 系では 1 の効果が出るより先に blur の確定処理が走り、
   未確定の下書きが保存されて Undo が1件増えてしまうため。譜面の別の場所をクリックしたときの
   blur は従来どおり確定する（この経路は変えていない）

### 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/utils/symbolOverlayPlacementUtils.ts` | 新設。配置計算（上→下→左右、クランプ）と定数。DOM に依存しない純粋関数 |
| `src/utils/symbolOverlayPlacementUtils.test.ts` | 新設。中央・上端・下端・左右端・極端に狭い画面での「重ならないこと」を矩形の交差で検証 |
| `src/components/SymbolAdjustOverlay.tsx` | 新設。計測（縮小率・オーバーレイ実寸・可視範囲）と配置の適用。見た目の枠も担当 |
| `src/components/PianoSystemCanvas.tsx` | `symbolResizeEditState` / `symbolOffsetEditState` の `overlayX`/`overlayY` を `anchor`（対象記号の実描画範囲）へ置換。`.symbol-hit-region` へ `data-symbol-*` 属性を追加。`toContainerRect` / `anchorFromClientPoint` / `findSymbolAnchorRect` を追加。2つのオーバーレイの `div` を `SymbolAdjustOverlay` へ差し替え |
| `src/components/PianoSystemCanvasAdjustOverlayPlacement.test.tsx` | 新設。記号クリック・音符クリックの両経路で「重ならない位置に開く」「矢印キーで動かしてもオーバーレイは動かない」を検証 |

保存データ・MusicXML・記号の描画位置そのものは変えていない（オーバーレイの表示位置だけの変更）。

### 既知のリスクと判断

1. オーバーレイの実寸は初回レンダー時点では測れないため、**暫定位置（代替サイズ 200×80px）で描いてから
   `useLayoutEffect` で確定位置へ差し替える**。差し替えは画面へ出る前に起きるためちらつきは無い。
   `visibility: hidden` で隠してから測る案は、`autoFocus` が効かなくなり
   #205 の矢印キー操作が壊れるため採らなかった
2. 可視範囲の上端はツールバー（`header.toolbar`・`position: fixed`）の下端にしている。
   ツールバーの下へ潜ると見えていても操作できないため
3. 記号が画面外までスクロールされている状態で開いた場合、オーバーレイは可視範囲側へクランプされる。
   このとき記号と重なる可能性は残るが、そもそも記号自体が見えていない状況なので許容とした

### 実装メモ（実装完了後の追記）

- 可視範囲の幅・高さは `window.innerWidth/innerHeight` ではなく
  **`document.documentElement.clientWidth/clientHeight` を優先**する（`||` で innerWidth へフォールバック）。
  innerWidth はスクロールバーのぶんを含むため、右端に置いたオーバーレイがバーに隠れることがある。
  jsdom は clientWidth が 0 になるので、そこだけ innerWidth に落ちる
- ブラウザ確認（worktree だけを載せた使い捨て dev サーバー・`localhost:5174`・強弱記号 `f`/`ff` を対象）:

  | 位置 | 結果（クライアント座標の実測） |
  | --- | --- |
  | 中央・左寄り | オーバーレイ 401〜455 / 記号 461〜476 → 記号の上・重なり無し。左は可視範囲の左端 0 でクランプ |
  | 上端（ツールバー下端 209） | 記号 220〜235 の**下**へフリップ（オーバーレイ 241〜296）。ツールバーに掛からない |
  | 右端（幅700に絞った画面） | オーバーレイ右端が 700 ちょうどでクランプ。はみ出さず、記号とも重ならない |
  | 下端（記号 640〜677・画面高 720） | 記号の上（489〜625）。可視範囲に完全に収まる |
  | 矢印キー↓×5 | 記号は 461→464 へ動き、オーバーレイの left/top は 1px も動かない |
  | サイズ変更（音符クリックで起動） | オーバーレイ 437〜481 / 記号 488〜505 → 記号の上・中央そろえ。記号の描画範囲を DOM から引き当てられている |

  コンソールエラー0件
| `src/utils/toolChangeUtils.ts` | 新設。`resolveToolIdentityKey`（ツールの内容を並び順を固定した文字列にする）と `isToolPaletteElement`（フォーカス移動先がパレット内か） |
| `src/utils/toolChangeUtils.test.ts` | 新設。同内容・順序違い・undefined・入れ子（連符）の同値判定と、パレット内外の判定 |
| `src/components/PianoSystemCanvas.tsx` | ツール識別キーを依存にした `useEffect` で3つのオーバーレイ state を null にする。サイズ・位置の入力欄の `onBlur` に「パレットへのフォーカス移動ならキャンセル」の分岐を追加 |
| `src/components/PianoSystemCanvasToolChangeOverlay.test.tsx` | 新設。順方向・逆方向・音符ツールへの切り替え・同じツールでの再レンダー・下書きの破棄・パレットへの blur の6本 |

保存データの形は変えていないので、譜面データ・MusicXML への影響はない。

### 検証

- 新規テスト6本は**修正前だと5本が落ちる**（残り1本は「同じツールなら閉じない」＝退行防止用）
- ブラウザ実測（worktree だけを載せた使い捨て dev サーバー・`localhost:5174`・強弱記号 `f` を対象）:

  | 受入条件 | 実測 |
  | --- | --- |
  | 1 | ✥で開く → ⤢へ切替した瞬間にオーバーレイが消え、フォーカスも解放（`activeElement` が BODY）。**次の音符クリック1回で**サイズ変更オーバーレイが開いた |
  | 2 | 逆順（⤢で開く → ✥へ切替）も同じく閉じ、次の1クリックで位置調整オーバーレイが開いた |
  | 3 | ↓で下書きを動かしてから切り替えても「元に戻す」は無効のまま。再度開くと 0/0（開いた時点の値）に戻っており、下書きが保存されていない |
  | 退行確認 | 譜面側での blur（パレット外）は従来どおり確定して保存され、「元に戻す」が有効化する。Esc も従来どおり閉じる |

  コンソールエラー0件。

  なお、この確認環境（ブラウザペイン）は `document.hasFocus()` が false でフォーカス系イベントが
  発火しないため、**Safari と同じ「ボタンを押してもフォーカスが移らない」経路の再現になっている**。
  Chrome 系の「blur が先に走る」経路は jsdom のテスト（`fireEvent.blur` に `relatedTarget` を渡す）で固定した。

## 追補（2026-08-23・Issue #385 裁定C: 矢印キー調整中のオーバーレイ半透明化）

**問題**: 位置調整オーバーレイ（#230 の配置回避は「調整対象の記号そのもの」だけが対象）が、
位置合わせの**参照物**（周辺の音符。月光 m5 では三連符）を隠す。五線間の狭い場所の記号で
顕在化した。

**裁定（2026-08-23）**: 比較（A: 回避対象の拡大 / B: ドラッグ退避 / C: 半透明化 / D: 組合せ、
Issue #385）から **C を採用**。「矢印キーを押したら透ける（opacity 0.25）・
止まったら 800ms で戻る・カーソルが乗ったら即戻る」。

**実装**: SymbolAdjustOverlay に translucent / onTranslucentCancel props を追加
（CSS クラス切替・prefers-reduced-motion では transition なし）。状態とタイマーは
PianoSystemCanvas 側（handleSymbolOffsetArrowKey で点灯・800ms タイマーと
mouseenter で消灯・オーバーレイを閉じたら必ず破棄）。対象は位置調整オーバーレイのみ
（サイズ変更オーバーレイには矢印ナッジが無い）。#230 の配置ロジック自体は不変。

**テスト**: PianoSystemCanvasAdjustOverlayPlacement.test.tsx（点灯・800ms 消灯・
mouseenter 消灯）。

## 追補2（2026-08-23・Issue #385 続報の裁定: 記号クリックのツール別ルーティングと削除ボタン）

**問題**: 記号字面のクリックが常に ✥（位置調整）へ吸われ（stopPropagation で専有）、
①強弱を「選択→Delete」で消せない（選択状態が存在しない・青ハイライトは hover 表示）
②同種ツールでの再クリック解除が効かない ③⤢ 選択中に記号をクリックしてもサイズ調整に
届かない、の3つの詰みがあった（月光 m5 清書で発覚）。

**裁定（2026-08-23・短期分）**:
- **ルーティング（C拡張）**: 記号クリックの行き先を選択中のツールで振り分ける。
  ⤢ → サイズ調整オーバーレイ / 同種の記号ツール（強弱↔dynamics・
  アーティキュレーション↔articulations）→ 音符クリックと同じトグル（付いているものを
  クリックで外す）/ それ以外 → ✥（従来どおり）
- **削除ボタン（B）**: ✥ オーバーレイに「この記号を削除」。粒度は ✥/⤢ と同じ
  **種類（kind）単位**（dynamics は併記の pp+cresc が両方消える）。
  削除は removeAdjustableSymbol（記号本体+その種類の symbolAdjust を除去）。
  カスタム記号は既存トグル（applyCustomSymbolToEvent）で外す。
  ボタンは onMouseDown preventDefault で入力欄 blur（確定して閉じる）より先に成立させる
- **中期（別Issue）**: 「選択できる記号は Delete で消せる」への統一（弧・松葉と同型の
  選択状態）。オーバーレイを開くタイミングの選択肢比較・⤢ の動線込みで仕様化し夜間へ

**当時「トグルのみ」だった意図の記録**: 強弱・アーティキュレーションは「ツールで付け外し」
という音符属性の統一編集モデルで、選択状態の管理が不要という単純さを採っていた。
「選択→Delete」は音符クリックのトグルが成立しないスパン（弧・松葉）だけの代替だった。
その後 #230/#260 で記号クリックの意味が「調整」に専有され、「消す」動線が
どこにも割り当てられないまま残った——という積み重ねの帰結。

## 追補3（2026-08-24・Issue #392: 暫定位置の見切れへの防御）

**問題**: 譜面左端の記号で ✥ を開くと、ダイアログが左に見切れて「横」入力欄が画面外に
出る報告（月光清書・開いた直後・横スクロールなし）。確定位置の経路
（computeSymbolOverlayPlacement）は全分岐で可視範囲へクランプ済みで実ブラウザでも健全。
見切れ幅が**計測前の暫定位置**（記号中央−100px の概算・クランプなし）の誤差と一致した
ことから、「実寸計測による確定位置への差し替えが走らないまま暫定位置が残る未知の経路」を
最有力と診断した（発火条件は未特定・#392 はオープン維持で再発観察中）。

**防御（PR #394）**:
- 暫定位置に `Math.max(SYMBOL_OVERLAY_GAP, …)` の下限クランプ（left/top）。差し替え前の
  一瞬（または計測が走らない経路）でも入力欄がコンテナ左上の外へ出ない
- 計測の useLayoutEffect が早期 return する場合（container/overlay の ref 未設定）は
  requestAnimationFrame で最大10回リトライ（measureRetry を依存に追加。
  「開いた直後に1回だけ確定し、以後は記号を追いかけない」という #230 の要件は不変——
  リトライは position 未確定の間だけ働く）

## 追補4（2026-08-24・Issue #392 の真因: クリップする祖先を範囲に入れていなかった）

追補3の防御（暫定位置クランプ+計測リトライ）を入れても運用者環境で再現したため、
実ブラウザで祖先の overflow を実測して**真因を特定**した。

**真因**: オーバーレイは `position: absolute` で譜面コンテナに属するため、
**overflow が visible でない祖先に視覚的に切り取られる**。A4ページ `.print-page` は
紙面をはみ出す描画を切るため `overflow: hidden` を持つ。一方 `resolveBounds` は
「ビューポート」だけを可視範囲としていたため、譜面左端の記号では
**「ビューポート内だが `.print-page` の外」**（実測: overlay left=0 / page left=32）に
置かれ、左側 32px が切られて「横」入力欄が見えなくなっていた。
確定位置の計算（`computeSymbolOverlayPlacement`）自体は正しく、
**渡していた bounds が間違っていた**（前回調査で「left=0 なら画面内なので健全」と
判断したのが誤り。クリップ祖先の存在を確認していなかった）。

**修正**: `resolveBounds` が、コンテナ自身から body までの祖先のうち overflow が
visible でないものの矩形を**すべて交差**してから返す（大きさを測れない環境の 0 矩形は
無視）。実ブラウザで切り取られ幅 32px → 0px を確認。

**構造的な教訓**: #382（強弱記号が隣の五線を知らない）と同型で、
「配置計算が“自分の外側の制約”を知らない」クラスのバグ。position:absolute の
オーバーレイを足すときは、可視範囲＝ビューポート ∩ クリップ祖先で考えること。

## 追補5（2026-08-24・記号クリックの意味を「常に選択」へ統一）

**問題（実機フィードバック2件）**:
1. 「pp を選択できない」— 演奏記号タブで pp ツールを持ったまま pp を押すと、
   追補（#385続報・裁定C拡張）のトグル解除が働いて**記号が消える**。pp を置いた直後の
   自然な状態のまま位置調整に入れず、触ると壊れる
2. 「記号を押しても音符が挿入される」— 音符・休符タブでは symbolsClickable=false で
   記号の判定が `pointer-events: none` になり、クリックが**下の音符セルへ抜けて音符が入る**

原因は同じで、**記号クリックの意味がタブ×ツールで4通りに割れていた**こと
（音符タブ=素通し／同種ツール=削除／⤢=サイズ／その他=位置調整）。#385続報の裁定は
「⤢に届かない」「同種ツールで解除できない」を解くためだったが、選択の道を塞ぐ副作用を
見落としていた。

**統一（2026-08-24）**:
- 記号字面のクリックは**常に「その記号を選ぶ」**（✥ 位置調整パネル）。タブ・ツールで
  意味が変わらない。⤢（サイズ変更ツール）中だけサイズ調整パネル（#385続報の成果は維持）
- `symbolsClickable` は ScorePage から常に true を渡す（タブ依存を撤廃）。編集不可
  （disabled: 大譜表パートのパート譜・再生中・印刷プレビュー）では従来どおり無効
- 削除は ✥ パネルの「この記号を削除」ボタン＋**音符**を同種ツールでクリックする
  従来のトグルの2経路（記号を押して消える経路は無くす）
- 選択状態そのものと Delete キーへの統一は #389（統合パネル）で扱う

**残るトレードオフ**: 記号の判定域（実測 31×18px）が常にクリックを受けるため、
記号の真下へ音符を置きたいときは記号を避けてクリックする必要がある。記号は五線の外・
五線間に描かれ音符の入力位置と通常ずれるため実害は小さいと判断した（#389 で再検討）。

## 追補6（2026-08-24・タブ区切りは残す＝主要ソフトの標準に合わせる）

追補5で「記号クリックは常に選択」へ統一した際、**タブ依存（演奏記号タブのときだけ
クリック可能）も併せて外した**が、これは行き過ぎだったので戻した。

**根拠（運用者の指摘で調査）**: 主要ソフトはいずれも「クリックの意味はモード（ツール）で
決まり、カーソル下の物では決まらない」設計で、**音符入力中に記号がクリックを奪うことは
ない**。
- Finale: ツールモーダル。Simple Entry 中は記号を選択できず（クリックすれば普通に音符が
  入る）、Expression ツールへ持ち替えると記号にハンドルが出る。汎用 Selection tool では
  記号も音符も選べるが、そのモードでは音符入力が起きない
- Sibelius / MuseScore / Dorico: 選択モードと音符入力モードの分離。入力モードでは
  記号があっても構わず音符が置かれる

常時クリック可能にすると「記号のあるところへ音符を置けない」（記号を消すか避けるしかない）
という、どのソフトにもない不便が生まれる。よって **symbolsClickable のタブ依存は復活**。
追補5のうち**「記号クリックで記号が消えない（＝選択になる）」だけを維持**する
（これは Finale でも記号クリックで消えることはなく、標準側の修正）。

**将来（#389）**: Finale の Selection tool / Sibelius の選択モードに相当する
**選択ツール（矢印）の新設**によるモード分離を、統合パネルと合わせて検討する。
そこまで行けば「タブで区切る」ではなく「モードで区切る」形に整理できる。

## 追補7（2026-08-24・他レイヤーの記号もクリックできるようにする）

**問題**: 記号のクリック判定は「アクティブなレイヤー（手×声部）の音符に付いた記号」に
しか作られていなかった（他レイヤーは「見た目だけ」の描画で `partIndex` 等を渡さないため
判定領域が作られない）。月光のように**同じ小節の声部1と声部2の両方に pp がある**譜面では、
画面上どちらの声部の記号かは見分けられず、押しても無反応＝壊れているように見える。
Finale では Expression ツールでどのレイヤーの記号にもハンドルが出るため、うちの方が厳しい。

**修正（運用者裁定A）**: 「見た目だけ」ループでも記号のクリック判定を作り、
**別レイヤーの記号をクリックしたらそのレイヤーへ自動切替してから小窓を開く**
（#316 の音符クリックと同じ型・切り替えは必ず通知する）。

**実装上の要点（誤爆防止）**: 記号エントリに `voiceIndex` を追加し、
`appendSymbolHitRegion` にも `symbolVoiceIndex` を渡すようにした。従来はオーバーレイを
開くとき声部を `activeVoiceIndex` で決め打ちしていたため、他声部の記号を触れるように
しただけでは**調整値が別の声部へ書かれる**（負のテストで検出できることを確認済み）。

**声部3以降のガード（Codex round 2 P2）**: 編集 UI（声部トグル）は2声までで、ScorePage は
声部3以降への切替要求を無視する。全声部の記号を押せるようにしたことで、通知だけ出して
小窓が開き「切り替えたと言われたのに実状態は変わらないまま編集できる」食い違いが生じたため、
音符クリックと同じガード（`describeVoiceSwitchUnavailable` を通知して return）を入れた。

**歌詞の配線漏れ（Codex round 2 P2 → round 3 で切り離し・#399）**: README/DEVELOPMENT は
歌詞もクリック対象に挙げていたが、`lyricsEntries` にパート・声部・イベントのメタデータが無く、
`drawLyricsEntry` の戻り値へ判定を付ける配線も無かった（アクティブ側でも押せなかった）。
一度この PR で配線したが、(1) 歌詞（`staveTopY - 26`）とコード記号・テンポ表記・発想標語
（ほぼ同じ `-24`）でクリックの取り合いが起きる (2) 休符に付けた歌詞は
`setSymbolAdjustOffset/Scale` が休符を除外するため小窓が開いても無言の no-op になる、
という別課題が出たため**本 PR からは外し #399 へ切り出した**（この PR の本題は
レイヤー跨ぎのクリックであり、歌詞は独立の課題）。暫定として文書側を実態に合わせ、
歌詞は直接クリック非対象と明記した。

**テスト**: PianoSystemCanvasSymbolCrossLayer.test.tsx（非アクティブ声部・レイヤーにも
判定がある／左手の記号クリックで切替+通知+小窓／同一レイヤーでは切替が起きない／
声部3は切替も小窓も出さず理由を通知／調整値が記号の属する声部へ書かれる）。ScorePagePartSymbolsWiring.test.tsx に実経路の配線テスト
（左手の記号クリック → ScorePage のレイヤーボタンが左手へ → 再描画後も小窓が開いたまま）。
実ブラウザでも「左手の記号クリック → 『左手・声部1に切り替えました』→ 小窓」を確認。

## 追補8（2026-08-24・休符に付いた記号の調整が無言で効かない問題）

**問題（#398 Codex round 4 P2）**: テキスト系（歌詞・コード記号・テンポ表記・発想標語）と
オッターバは**休符にも付けられる**が、調整の確定処理が使う
`listPresentAdjustableSymbolKinds` は `event.isRest` で**一律に空配列**を返していたため、
`setSymbolAdjustOffset` / `setSymbolAdjustScale` が no-op になっていた。
小窓は開くのに値を変えても記号が動かず、通知も出ない＝#318「行き止まりは喋る」違反。
記号クリックを他レイヤーへ広げた（追補7）ことで到達しやすくなり顕在化した。

**修正**: 音符にしか付かない記号（運指・強弱・アーティキュレーション）は従来どおり
休符では対象外にしつつ、**テキスト系とオッターバは休符でも調整対象**にした。
これは「休符にも付けられる記号は、付けられる以上は調整もできる」という素直な整合。

**テスト**: symbolAdjustUtils.test.ts（休符でのテキスト系・オッターバの列挙／
休符のコード記号へ offset・scale が保存される／音符専用記号は休符では従来どおり no-op）、
PianoSystemCanvasSymbolCrossLayer.test.tsx（非アクティブレイヤーの休符に付いた
コード記号をクリック→小窓→値が保存される）。

### 追補9: 汎用⤢/✥ツールでの休符の扱い（#398 Codex round5 P2）

追補8で `listPresentAdjustableSymbolKinds` が休符でもテキスト系・オッターバを返すようにしたが、
呼び出し側の PianoSystemCanvas が **列挙より手前で休符を一律に拒否** していたため、UI からは
依然として到達できなかった（歌詞は直接クリック非対応なので、休符上の歌詞には調整経路が皆無だった）。

改訂: 汎用⤢/✥では休符でもまず対象を列挙し、**結果が空のときだけ** 拒否する。拒否理由は休符なら
`'rest'`（休符には付けられない記号があることまで言う）、音符なら従来どおり `'noAdjustableSymbol'`。
これにより「休符には付かない記号（運指・強弱・アーティキュレーション）は従来どおり拒否」を保ちつつ、
「付いているのに触れない」行き止まり（#318違反）を解消した。

強弱ツール・カスタム記号ツールなど「記号を付ける」側の休符拒否は変更していない。

### 追補10: 対象ゼロの休符での通知文言（#398 Codex round6 P2）

追補9で休符も列挙対象にしたが、対象ゼロのときに既存の `'rest'` 通知（「休符には◯◯を使えません（音符をクリックしてください）」）を
流用していた。休符にもテキスト系・オッターバは付けられるようになったため、この文言は事実に反し、
本当の理由（＝まだ何も付いていない）とも食い違う。

`describeSymbolToolUnavailable` に `'noAdjustableSymbolOnRest'` を追加し、
「この休符には調整できる記号がありません（休符には歌詞・コード記号・テンポ表記・発想標語・オッターバを付けられます）」と
代替手順まで案内する。音符側の `'noAdjustableSymbol'`、および「記号を付ける」ツールの `'rest'` 拒否は変更していない。

### 追補11: 休符への運指入力を断る（#398 Codex round7 P2）

`textElement` ツールは全種類を休符でも受け付けて保存していたが、**運指だけは休符に描画されない**
（符頭の上に出す記号のため、描画側が `isRest` を除外している）。結果、入力欄が開いて確定もできるのに
何も表示されない、という無言の行き止まりになっていた（#318違反）。追補9で「運指は音符専用」と
整理した以上、入力の入口でも同じ線を引くべき。

入力欄を開く前に `'rest'` 通知で断る（「休符には運指（指番号）を付けられません（音符をクリックしてください）」）。
歌詞・コード記号・テンポ表記・発想標語は休符でも描画されるので従来どおり受け付ける。
`SymbolTool` に `{ type: 'fingering' }` を追加し、動詞は「付けられません」側に寄せた。

配線テストは `ScorePageFingeringRestNotice.test.tsx`（ツールバーで運指を選ぶ→休符をクリック→
通知が画面に出て入力欄は開かない、を実経路で固定）。

## 追補12（2026-08-24・Issue #389 の設計: 統合パネルと「選択→Delete」の段取り）

**この追補の位置づけ**: #389 は運用者裁定で論点1（パネルを開くタイミング）・論点2（⤢の動線
＝統合パネルと ⤢/✥ ボタンの廃止可否）・論点3（選択ツールによるモード分離）の**比較そのものが
要件**になっている。追補5・6・7 で記号クリックの意味が変わった（＝比較の前提が変わった）ため、
**現在の main を正本として3論点を比較し直し**、実装段の分割と各段の受入テストのケース一覧を
ここに置く。この追補にコードの挙動変更は含まない（実装は次段）。

**破棄した先行実装**: PR #393 は「1クリック目＝選択のみ／2クリック目＝✥パネル」という2段階案
（論点1の案b）だった。追補5（記号クリックは常に選択＝パネルを開く）が明示的に撤回した方向で、
追補6の「クリックの意味はモードで決まる」という原則とも合わない。**採用しない**。
ただし後述のとおり、案b を選ばざるを得なかった**理由の方は実装の都合であって、原理的な制約では
なかった**（下の論点1）。

### 現状（追補5・6・7 の帰結）の確認

| 事実 | 位置 |
| --- | --- |
| 記号字面のクリックは常に ✥（位置調整パネル）を開く。⤢ ツール中だけサイズ調整パネル | `appendSymbolHitRegion` の click ハンドラ |
| 記号がクリックできるのは演奏記号タブのときだけ（`symbolsClickable`） | ScorePage → PianoSystemCanvas |
| ✥ パネルは開いた直後に**「横」入力欄へ autoFocus** する（#205 の矢印キー移動が入力欄の onKeyDown にあるため） | `symbolOffsetXInputRef` の `<input autoFocus>` |
| ⤢ パネルも % 入力欄へ autoFocus する | 同上（resize 側） |
| キー操作は `window` の keydown で受ける。弧・松葉の Delete は `isTextInputTarget` 判定より**前**、音符の Delete は**後** | `onKey` の優先0〜2 |
| 記号の削除は ✥ パネルの「この記号を削除」ボタン（種類単位）と、**音符**を同種ツールでクリックするトグルの2経路 | `handleSymbolDeleteFromOverlay` |
| ツールを切り替えるとパネルは閉じる（#231）。これは blur ではなく `TOOL_CHANGED` の effect が担う | `toolIdentityKey` の useEffect |
| 小さい記号・重なった記号は、**音符**を ⤢/✥ ツールでクリックして出る選択リスト（`symbolPicker`）から選ぶ | `symbolAdjustPickerState` |

### 論点1: パネルを開くタイミング → **案A（パネル本体へフォーカスする）を採用**

| 案 | 判定 | 理由 |
| --- | --- | --- |
| **A. クリック＝選択＋パネル、フォーカスはパネル本体** | **採用** | 追補5・6と整合（1クリックで選択）。Delete がパネルへ届き、入力欄に入っている間だけ文字編集が優先される＝受入条件1と3が同時に成立する |
| a'. クリック＝選択＋パネル、フォーカスは入力欄（現状のまま） | 不成立 | Delete が必ず文字編集に吸われ、受入条件1が成立しない |
| b. 2段階（1クリック＝選択のみ） | 不採用 | 追補5が撤回した方向。調整に1クリック増える |
| c. 遅延して開く | 不採用 | a' と同じ問題が時間差で起きるだけ |

**PR #393 の結論を覆す根拠**: #393 は「✥ は開いた直後に入力欄へ autoFocus **する**」を動かせない
前提として案a を不成立と判定した。しかし autoFocus は #205（矢印キー移動）の実装が
**入力欄の onKeyDown に置かれている**ことの帰結であり、仕様上の要請ではない。矢印キーの受け口を
パネル本体（`role="dialog"` / `tabIndex={-1}` の div）へ移せば、

- 矢印キー移動（#205）は**入力欄に入らなくても効く**ようになる（むしろ操作が短くなる）
- Delete / Backspace はパネル本体で受けられる（`e.target` が input ではないので
  `isTextInputTarget` が false）
- 数値を直接打ちたいときは Tab またはクリックで入力欄へ入る。**その間の Delete は文字編集**
  （受入条件3）

つまり論点1の対立は「原理的な二律背反」ではなく**フォーカス先の設計判断**だった。

**フォーカス移設で気をつける点（既存挙動の維持）**:

1. **#231（ツール切替でパネルが閉じる）は blur 依存ではない**（`TOOL_CHANGED` の effect）ので
   移設の影響を受けない。ただし入力欄の `onBlur` にある「ツールパレットへ移ったときは確定しない」
   （`shouldCancelOverlayOnBlur`）は入力欄に入ったときだけの経路として**残す**
2. **確定のタイミング**: 現状は Enter か入力欄の blur で確定する。パネル本体にフォーカスがある
   ときの「譜面の別の場所をクリックして閉じる」は、矢印キーの下書き（`symbolOffsetDraft`）を
   **確定して閉じる**（Esc は従来どおり元へ戻す）。下書きを黙って捨てない
3. **#385（矢印キー中の半透明化）**は矢印キーのハンドラに紐づくので、移設先でも同じ関数を呼ぶ
4. **Safari 差異**: `<div tabIndex={-1}>` への `.focus()` は Safari でも効くが、
   ボタンのクリックでフォーカスが移らない（Safari は button をフォーカスしない）ため、
   削除ボタンを押した後にパネルが閉じる経路は現状の `onMouseDown preventDefault` を維持する

### 論点2: ⤢ の動線 → **統合パネル（位置＋サイズ＋削除）を採用。⤢/✥ ツールボタンは残す**

**統合パネルを採る理由**: #230 のトリアージが明記した「2系統にしないこと」と整合し、
「サイズだけ変えたいのに ✥ を閉じて ⤢ へ持ち替える」往復が消える。追補5 で残った
「⤢ ツール中だけ別のパネル」という分岐も畳める。

**⤢/✥ ツールボタンを廃止**する案は、**現時点では採らない**。理由は1つだけで、

- 小さい記号（運指）や重なった記号を選ぶ唯一の確実な入口が「**音符**を ⤢/✥ ツールでクリック
  →選択リスト（`symbolPicker`）」であり、ボタンを消すとこの入口も消える

廃止の可否は論点3（選択ツール）が入ってから再検討する。選択ツール中の音符クリックが
「その音符に付いた記号の選択リスト」を出せるなら、⤢/✥ ボタンは役目を終える。

**統合後のパネルの構成**（上から）:

1. 見出し（対象の記号名。例「pp の調整」）
2. 位置: 横・縦の数値入力（現状のまま）＋「矢印キーで移動」の説明
3. サイズ: % の数値入力（25〜400%、空欄で等倍。現状の ⤢ パネルの中身）
4. 「この記号を削除」ボタン（現状のまま・種類単位）

`SymbolAdjustOverlay`（配置ロジック）は共通のまま使う。`minWidth` は統合ぶん広げる。

### 論点3: 選択ツール（矢印）によるモード分離 → **段3で扱う。現時点はタブ区切りを維持**

追補6のとおり、主要ソフトは「クリックの意味はモードで決まる」。本アプリはタブで近似しており、
**動いている**。選択ツールの新設は次の3つを同時に動かす必要があり、統合パネル（段2）より
明らかに大きい:

1. 中立モード（音符を入れない）の新設。既存の「小節選択ツール」を発展させる案と比較する
2. `symbolsClickable` のタブ依存の撤去（prop 自体の整理）
3. 選択中の視覚表現（Finale のハンドル相当）を統合パネルと揃える

段1・段2 は選択ツールが入っても**そのまま活きる**（クリック＝選択という意味は変わらず、
入口が増えるだけ）ので、先に段1・段2 を出して段3 を別Issueへ切り出すのが安全。

### 実装段の分割と受入テストのケース一覧

各段は「そのテストが緑になること」を合格基準とする。テストは既存の慣習どおり
`src/components/*.test.tsx`（統合テストは ScorePage 実経路）へ置く。

#### 段1: 選択→Delete の統一（受入条件1〜4・6）

対象: フォーカス移設＋記号の選択状態＋Delete。パネルの中身（位置のみ）は現状維持。

| # | ケース | 期待 |
| --- | --- | --- |
| 1-1 | 演奏記号タブで pp をクリック | ✥ パネルが開き、**フォーカスはパネル本体**（`document.activeElement` が入力欄でない） |
| 1-2 | 1-1 の直後に Delete | pp が消える・通知が出る・パネルが閉じる |
| 1-3 | 1-1 の直後に Backspace | 同上 |
| 1-4 | アーティキュレーション（スタッカート）で 1-2 と同じ | 消える |
| 1-5 | カスタム記号で 1-2 と同じ | 消える（既存トグル `applyCustomSymbolToEvent` 経由） |
| 1-6 | テキスト系（発想標語）で 1-2 と同じ | 消える |
| 1-7 | 「横」入力欄をクリックしてから Delete | **記号は消えず**、入力欄の文字が編集される（受入条件3） |
| 1-8 | パネル本体にフォーカスがある状態で ← / → / ↑ / ↓ | 記号が動く（#205 が入力欄なしで効く）・#385 の半透明化も起きる |
| 1-9 | パネルを開いた状態で Esc | 下書きを戻してパネルが閉じる・選択も解除 |
| 1-10 | パネルを開いた状態で譜面の空白をクリック | 下書きを**確定**してパネルが閉じる |
| 1-11 | 記号を選択した状態で音符をクリック | 記号の選択が外れ、音符の選択だけになる（受入条件2・排他） |
| 1-12 | 弧／松葉を選択した状態で記号をクリック | 弧／松葉の選択が外れる（同上） |
| 1-13 | 記号を選択 → 声部を切り替え | 選択が解除される（既存の掃除規則と同型） |
| 1-14 | 記号を選択 → ツールを切り替え | パネルが閉じる（#231 の維持） |
| 1-15 | ✥ パネルの「この記号を削除」ボタン | 従来どおり消える（受入条件4・ボタンは残置） |
| 1-16 | 他声部（声部2）の記号をクリック → Delete | **声部2の**記号が消える（追補7。アクティブ声部で決め打ちしない） |
| 1-17 | ScorePage 実経路: 演奏記号タブ→記号クリック→Delete | 画面から記号が消える（統合テスト） |
| 1-18 | 印刷プレビュー中／再生中（disabled） | 記号クリックが無効のまま（既存の `symbolsInteractive`） |

**関連する既存テストの更新**: `PianoSystemCanvasAdjustOverlayPlacement.test.tsx` ほか、
✥ パネルを開いた直後に入力欄へ値を入れているテストは、**明示的に入力欄をフォーカスしてから**
値を入れる形へ直す（autoFocus 前提の記述を実態へ合わせる）。設計時の期待と変わった点は
PR 本文に理由を書く。

#### 段2: 統合パネル（論点2）

| # | ケース | 期待 |
| --- | --- | --- |
| 2-1 | 記号をクリック | 1枚のパネルに位置（横・縦）・サイズ（%）・削除がそろって出る |
| 2-2 | ⤢ ツール中に記号をクリック | **同じ**パネルが出る（分岐が消える） |
| 2-3 | サイズ欄に 200 を入れて Enter | 記号が2倍になる（既存の resize 経路と同じ保存先） |
| 2-4 | サイズ欄にフォーカスがある状態で Delete | 文字編集（受入条件3が統合後も成立） |
| 2-5 | パネル本体にフォーカスがある状態で Delete | 記号が消える |
| 2-6 | 音符を ⤢/✥ ツールでクリック（選択リスト経由） | 従来どおりリストが出て、選ぶと統合パネルが開く |
| 2-7 | 配置 | 統合で背が高くなったパネルが対象記号に重ならない（#230 の配置テストを統合パネルの寸法で） |

#### 段3: 選択ツール（論点3・別Issueへ切り出す想定）

| # | ケース | 期待 |
| --- | --- | --- |
| 3-1 | 選択ツール中に譜面の空白をクリック | 音符が入らない（中立モード） |
| 3-2 | 選択ツール中に記号をクリック | 選択＋統合パネル |
| 3-3 | 選択ツール中に音符／弧／松葉をクリック | それぞれ選択（分け隔てなく選べる） |
| 3-4 | 音符タブで記号をクリック | 記号は取らず音符が入る（追補6の維持） |

### 影響範囲

- `PianoSystemCanvas.tsx`: 選択 union へ `symbol` スロット追加／`onKey` に記号の Delete 分岐
  （**`isTextInputTarget` 判定より後**に置く。弧・松葉は前だが、記号の選択は数値入力欄と
  同時に成立しうるため）／パネル本体への `tabIndex` と `focus()`／矢印キー受け口の移設
- `SymbolAdjustOverlay.tsx`: フォーカス先になる本体へ `role="dialog"` `tabIndex={-1}`
- `App.css`: 選択中の記号の視覚表現（`.symbol-hit-region--selected` 相当）。印刷・印刷プレビューへ
  出さない（既存の打ち消しルールと同じ詳細度で）
- `docs/REGRESSION.md` の「H. 記号の調整オーバーレイ」へ、パネルのフォーカス先と Delete の項目を追加
- README・`helpContent.ts` の「記号の消し方」を段1で更新

### 未決（運用者の裁定が要る点）

1. 段1の採用可否（案A＝フォーカスをパネル本体へ移す）。移すと「開いてすぐ数値を打つ」操作は
   Tab が1つ増える
2. 段2の統合パネルで ⤢/✥ ツールボタンを**残す**方針の可否（上記のとおり選択リストの入口として
   残す提案）
3. 段3を #389 の中でやるか、別Issueへ切り出すか

## 追補13（2026-09-01・Issue #522: 記号をドラッグで動かす）

### 問題

記号の位置調整は「✥ ＋ 矢印キー（1px / Shift で10px）」と数値入力の2通りしかなく、
大きく動かしたいときに何十回もキーを叩くことになっていた。弟フィードバック（#450）の
「強弱記号等もドラッグ＆ドロップで動かしたい」がそのまま子Issue #522 になっている。
弧（タイ/スラー）には既にドラッグがあり、同じ「位置を決める」操作で語彙が食い違っていた。

### 修正設計

**位置調整（✥）オーバーレイを開いている記号だけ**、その記号の当たり判定 rect
（`.symbol-hit-region`）を掴んでドラッグできるようにする。

- 掴める条件を「調整中の1件」に絞ったのは、通常のクリック（＝記号を選ぶ・追補5）や
  音符の入力・選択と衝突させないため（Issue #522 の仕様3）。掴める記号にカーソルを
  乗せると `grab`（弧のドラッグと同じ）に変わる
- 3px（画面px）動かすまでは「クリック」のまま。押した指の震えで記号が動いて
  Undo 履歴が1件増えるのを防ぐ（`SYMBOL_DRAG_START_THRESHOLD_PX`）
- 押した瞬間に `preventDefault()` して入力欄のフォーカスを保つ。しないと blur が
  「確定して閉じる」を先に走らせてしまい、掴む対象が消える（削除ボタンと同じ手当て・追補2）
- 移動量は毎回 **「掴んだ時の値 ＋ 掴んだ点からの総移動量」** で決める。1回ごとの差分を
  足し込む方式だと、上下限（±100px）で丸められたぶんが失われ、戻すときに指と記号がずれる
- 座標変換は弧のドラッグと同じ `clientToGroup`。画面px→SVG内部座標（＝オフセット値の単位）
  に直すので、ページのズーム倍率が変わっても指と記号が1:1で動く

#### 既存実装の共用（新しい経路を作らない）

値の反映・確定は**矢印キーとまったく同じ経路**を通す。ドラッグ専用のプレビューや
保存処理は作っていない。

| 役割 | 共用している実装 |
| --- | --- |
| 動かした値の計算・クランプ | `applySymbolOffsetNudge`（矢印キーと同じ規則。ドラッグは総移動量を `nudge` として渡す） |
| 画面の追従（下書き） | `applySymbolOffsetDraft`（`nudgeSymbolOffset` から切り出した共通の出口）→ `partsScoreForRender` |
| 確定 | `handleSymbolOffsetConfirm`（Enter と同じ。値が変わっていなければ no-op で履歴も増えない） |
| 半透明化 | `markOffsetOverlayKeyAdjust`（#385 裁定C。動かしている間だけ透ける） |
| 直後の click の読み飛ばし | 弧の `arcMoved` と同じ仕組み（`symbolOffsetMoved`）。SVG の capture 側で1回だけ消費 |

「同じロジックの2枚目」を作らない方針（#223 の修正が別実装へ届かず #280 が起きた反省）に
沿って、下書きの更新点は `applySymbolOffsetDraft` の1か所だけにしてある。

#### ドラッグ中に SVG が作り直される問題

1px 動くたびに下書きが変わり、描画 effect が SVG を丸ごと作り直す（＝掴んだ rect は
途中で消える）。そのため `mousemove` / `mouseup` は要素ではなく **window** で受ける
（弧のドラッグが #235 で同じ結論に至っている）。座標変換に使う SVG も、要素を握らず
毎描画で差し替わる `arcDragContextRef` から取る。

ドラッグの終わりの click は、記号を選び直す操作ではないので1回だけ読み飛ばす。
rect 側と SVG の capture 側の両方に受け口を置いてあるのは、SVG が作り直された後は
click が rect ではなく背景へ届くことがあるため。

ツール切替・`pointercancel` では確定せず、掴む前の値へ戻す（`cancelActiveDragSessions`。
弧と同じ「中断は確定ではない」の扱い・REGRESSION.md の S）。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`
  - `DragSessions` に `symbolOffset` / `symbolOffsetMoved` を追加
  - `nudgeSymbolOffset` から `applySymbolOffsetDraft` を切り出し
  - 記号の当たり判定 rect に `mousedown`（ドラッグ開始）とカーソル切替を追加、`click` に読み飛ばし
  - ドラッグ中の `mousemove` / `mouseup` を window で受ける effect を追加
  - 位置調整オーバーレイの説明文に「ドラッグでも動かせる」を1行追加
- `src/components/PianoSystemCanvasSymbolDrag.test.tsx`（新規・4件）
- `README.md`（操作の説明を1行追加）・`docs/REGRESSION.md`（H の確認項目）

### 受け入れ条件との対応

| 受入 | 対応 |
| --- | --- |
| 1. ドラッグで移動でき、保存・再読込・印刷に反映される | 確定は `handleSymbolOffsetConfirm` ＝ 従来の保存経路（`symbolAdjust` / `customSymbols` のオフセット）。実ブラウザで autosave に `offsetX: 42 / offsetY: -42` が入ることを確認 |
| 2. ✥＋矢印キーの既存操作に回帰がない | 下書き・確定の経路を共用。矢印キーのテスト（既存＋新規1件）が緑 |
| 3. 通常の音符入力・選択操作に干渉しない | 掴めるのは「調整中の記号」だけ・3px のしきい値・ドラッグ直後の click は1回読み飛ばし |
| 4. Undo 単位が1操作 | ドラッグ中は `partsScore` を書き換えない（下書きのみ）。`setPartsScore` は離した時の1回だけ |

### 実機確認（2026-09-01・worktree の一時エントリ経由）

単旋律を新規作成 → 4分音符を置く → 演奏記号タブで f を付ける → f をクリックして ✥ を開く →
f を右上へドラッグ（画面上32px）。

- 記号が指について動き、離した時点で確定（`symbolAdjust.dynamics = { offsetX: 42, offsetY: -42 }`）
- 記号の実描画位置は画面上でちょうど 32.04px 右・32.04px 上へ移動（＝カーソルと1:1）
- 「元に戻す」1回で元の座標（誤差なし）と元のデータへ復帰
- そのあと矢印キー（↑×5 → Enter）で `offsetY: -5` が保存され、既存操作に回帰なし
- 音符ツールに戻して譜面をクリック → 従来どおり音符が入る／コンソールエラーなし

## 追補14（2026-09-03・Issue #553: 記号を選択なしで直接ドラッグする）

### 問題

追補13（#522）は誤爆防止のため「位置調整（✥）オーバーレイを開いている記号だけ掴める」
設計にした。その結果、記号を動かすたびに **記号クリック → ✥ が開く → ドラッグ** の3手が
必要になり、運用者QA（2026-09-01・#522 マージ後の実使用）で
「新規で置いてドラッグアンドドロップしたけど、一回選択（✥を開く）を挟むのが不便」と
指摘された。掴めるのが1件だけであることは画面から分かりにくく、「押しても動かない記号」が
既定の状態になってしまっていた。

### 修正設計

演奏記号タブ（`symbolsInteractive`）では、**未選択の記号も押してそのまま動かせる**ようにする。
判定は追補13で入れた 3px（画面px）のしきい値をそのまま使い、

- **3px 未満で離した** → 従来どおり click が走り「その記号を選ぶ（✥ が開く）」だけ。位置は不変
- **3px 以上動かした** → その時点で ✥ を開き、以降は追補13とまったく同じドラッグになる

という「押してから決まる」形にした。押した瞬間に ✥ を開かないのがポイントで、開いてしまうと
「選ぶつもりの1クリック」でもオーバーレイが開き直り、受入条件2（3px 未満は位置が変わらない）を
素直に満たせない。

#### 新しいドラッグ経路を作らない（既存実装の共用）

追補13の機構をそのまま使い、変更点は「掴める条件」と「いつ ✥ を開くか」の2点だけに絞った。

| 役割 | 共用している実装 |
| --- | --- |
| ドラッグの状態・しきい値・座標変換・確定 | `dragSessionsRef.current.symbolOffset` と window の `pointermove`/`pointerup`（追補13のまま） |
| 記号を選んで ✥ を開く | `selectSymbolForAdjust`（click ハンドラから切り出した共通関数）。レイヤー切り替え・声部ガード・オーバーレイの回避位置まで含めて1か所 |
| つかんだ時の値の読み出し | `currentSymbolOffset`（`openSymbolAdjustEditor` と同じ「記号の種類で置き場所が違う」読み方） |

`selectSymbolForAdjust` の切り出しは「同じロジックの2枚目を作らない」方針（#223 の修正が
別実装へ届かず #280 が起きた反省）に沿ったもの。クリック経路とドラッグ開始経路で
レイヤー切り替えの挙動がずれる余地を残さない。

#### 掴める条件（どこまで広げるか）

- 演奏記号タブ以外（音符・休符タブ）は従来どおり当たり判定ごと素通し（`pointerEvents: 'none'`）。
  音符の入力・小節の範囲選択と衝突させないため（#553 仕様4）
- **⤢（サイズ変更ツール）中だけは直接ドラッグしない**。その場のクリックは「大きさ」パネルを
  開く操作であり、位置のドラッグと意味が混ざるため（すでに ✥ を開いている記号は従来どおり掴める）
- カーソルは、掴める記号なら選択の有無によらず `grab`（#553 仕様5）

#### `preventDefault` を未選択の記号では呼ばない

追補13は「押した瞬間の blur で ✥ が閉じるのを止める」ために `pointerdown` で
`preventDefault()` していた。未選択の記号にはまだ守るべき入力欄が無く、逆にここで既定動作を
止めると、ブラウザによっては続く click が出ず「3px 未満で離したら選択」（受入2）が壊れうる。
そのため **すでに調整中の記号のときだけ** `preventDefault()` する形に分けた。

#### 入力欄の初期値を `current` から `draft` へ

ドラッグの途中で ✥ が開くと、開いた時点で下書き（`draftX/draftY`）はすでに1回ぶん進んでいる。
入力欄の `defaultValue` が `currentX/currentY`（＝移動前の値）のままだと、離した時点の確定が
**入力欄の値を読む**ため、その移動が取り消されてしまう。通常の経路では開いた時点で
`current` と `draft` は同じ値なので、`draft` に変えても従来の見え方は変わらない。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`
  - `DragSessions.symbolOffset` に `beginAdjust`（しきい値通過時に ✥ を開く処理）を追加
  - click ハンドラから `selectSymbolForAdjust` を切り出し、pointerdown 側と共用
  - `currentSymbolOffset` / `overlayKindForTool` / `canDirectDrag` を追加、カーソルを `grab` に
  - 位置調整オーバーレイの入力欄の `defaultValue` を `current` → `draft` へ
  - オーバーレイの説明文を「選択なしで直接つかんでもOK」に更新
- `src/components/PianoSystemCanvasSymbolDrag.test.tsx`（#522 の「未選択は動かない」テストを
  #553 の仕様へ作り直し＋直接ドラッグ／しきい値未満／⤢中／カーソルの4件を追加）
- `src/components/ScorePageSymbolDragWiring.test.tsx`（同じ1テスト内に直接ドラッグの配線を追加。
  ScorePage を2回マウントすると終わらないため `it` は増やさない）
- `README.md`・`docs/REGRESSION.md`（H の確認項目）

### 受け入れ条件との対応

| 受入 | 対応 |
| --- | --- |
| 1. 未選択の記号を 3px 以上動かすと移動し、離した1回だけ保存・Undo 1回で復帰 | 確定は追補13と同じ `handleSymbolOffsetConfirm`。単体テスト＋ScorePage 配線テストで固定 |
| 2. 3px 未満で離すと従来どおり選択（✥ が開く）・位置は不変 | しきい値を超えるまで `beginAdjust` を呼ばず、click 経路に任せる。テストで固定 |
| 3. #522 の既存テストに回帰なし | 「未選択は動かない」1件のみ**仕様変更として意図的に**作り直し（下記）。他は無改変で緑 |
| 4. ScorePage 配線テスト | `ScorePageSymbolDragWiring.test.tsx` に「選択なしの直接ドラッグでも同じ保存値になる」を追加 |

**意図的に変更した既存テスト**: `PianoSystemCanvasSymbolDrag.test.tsx` の
「位置調整を開いていない記号は、つかんでも動かない」は、本Issueが正面から覆す仕様
（＝掴めるようにするのが目的）なので、同じ操作で「移動して保存される」を確かめる
テストへ置き換えた。他の #522 テスト（しきい値未満・右クリック・中断の安全弁・矢印キー）は
無改変のまま緑。

### 判断メモ（レビュアー向け）

- 仕様2の「終了後の微調整も矢印キーで続けられる」について、**離した時点で ✥ が閉じる
  追補13の挙動をそのまま維持**した（＝矢印キーで続けるには開き直しが要る）。受入条件1〜4は
  これで満たせる一方、確定後もオーバーレイを開いたまま残す変更は `currentX/currentY` の
  更新まで踏み込む必要があり、#522 の確定経路（`handleSymbolOffsetConfirm`）の意味を
  変えてしまうため、別Issue相当と判断した

## 追加機能: フリーハンドの手ぶれ補正（Issue #529 段階1）

### 問題

カスタム記号はフリーハンドで描くため、指やマウスの細かい震え（ジッター）がそのまま線に残り、
ギザギザに見える。発案者ユーザーから「いい感じに補正する」機能の要望が出た（#89 の具体化第一弾）。

一方で現代音楽の記号は「震え自体が意図」の場合があるため、補正が意図を壊したときの
逃げ道（オフに戻す手段）を必ず残す必要がある。

### ゴール / 非ゴール

- ゴール（Issue の段階1）: ストロークの平滑化と、記号ごとの補正オン/オフ
- 非ゴール（Issue の段階2・別PR）: 基本図形スナップ（ほぼ直線→直線、ほぼ円→正円 などの置換候補の提示）

### 採用した方式: 「補正結果を保存しない」

補正済みの点列を保存して元ストロークを別フィールド（rawPoints 等）へ退避する案も考えたが、
**元の points はそのまま保存し、補正は描画のたびに計算する**方式を採った。理由:

- 「元ストロークも保持する」という要件が、フィールドを増やさずに満たせる（同じ線が2箇所に
  重複して保存されない＝どちらが正本か分からなくなる事故が起きない）
- オン/オフの切り替えが完全に可逆になる（補正結果を保存すると、オフに戻したときに
  戻せるかどうかが保存時点の実装に依存してしまう）
- 既存データ（`smoothing` を持たない記号）は補正なしで描かれるため、見た目が一切変わらない

### データモデル

`CustomSymbolDef` に `smoothing?: boolean` を追加する（省略時 false ＝ 補正なし）。

```ts
export interface CustomSymbolDef {
  id: string;
  name: string;
  shapes: ShapePrimitive[];
  smoothing?: boolean;
}
```

- `ShapePrimitive` の `path.points` は**これまでどおり記録したままの頂点列**（＝元ストローク）
- 既定を false にしているのは、この機能より前に保存された記号の見た目を変えないため
  （エディタで新規作成する記号は既定でオン。ユーザーがチェックを外せば false で保存される）
- `CURRENT_VERSION` は上げない（省略可能フィールドで前方・後方互換のため。既存の判断と同じ）

### 補正アルゴリズム（`src/utils/strokeSmoothing.ts`・新規）

2段構え。順番が逆だと「震えの頂点」が特徴点として残ってしまうため、平滑化が先。

1. **移動平均で震えをならす**（`SMOOTHING_PASSES = 2` 回）
   各点を前後の点との重み付き平均（0.25 / 0.5 / 0.25）で置き換える。1点ごとに上下する
   ジッターはこの平均でほぼ打ち消し合う。**始点・終点は動かさない**（描き始め・描き終わりが
   縮むと線がつながらなく見えるため）
2. **Ramer–Douglas–Peucker 法で間引く**（`DEFAULT_SMOOTHING_TOLERANCE = 1.2` 論理px）
   「両端を結んだ線から最も遠い点」が許容誤差以下なら間の点をすべて捨てる。形を保ったまま
   点数を減らせる定番の方法。長いストローク（最大600点）で再帰が深くならないよう、
   再帰ではなくスタックで実装している

パラメータ（2回・1.2px）は「ジグザグは直線になるが、意図して描いた円弧は半径1px以内の
ズレしか出ない」ことをテストで確認して決めた既定値。手触りの最終調整はライブ検証で行う。

### 描画への組み込み（`customSymbolUtils.ts`）

- `resolveStrokePoints(points, smoothing)` を新設。`smoothing` が真のときだけ補正結果を返し、
  それ以外は元の配列をそのまま返す（＝旧データは1行も変わらない経路を通る）
- 結果は `points` 配列をキーにした `WeakMap` にキャッシュする。譜面は音符を1つ動かすたびに
  全体を描き直すため、同じストロークの補正計算が何度も走るのを避ける。記号が捨てられれば
  キャッシュも一緒に破棄される
- `renderCustomSymbol`（楽譜への描画）・`symbolDefToPreviewSvg`（パレットのアイコン）・
  `getShapeBBox`（プレビューの viewBox フィット）の3箇所を、この関数経由に変更
- `PianoSystemCanvas` / `StaffCanvas` 側は無変更（`customSymbolRenderUtils` 経由で
  `def` ごと渡っているため、フラグは自動的に伝わる）

### 操作UI（`SymbolEditor.tsx` / `ScorePage.tsx`）

- ツールパネルに「手ぶれ補正」チェックボックス（既定オン）。確定済みストロークの
  キャンバス表示にも反映するため、チェックを外すと描いたままの線に戻る様子がその場で見える
  （**描画中のドラッグ線は補正しない**。補正は Issue の仕様どおり「描画確定時」に効く）
- 保存時、そのときのチェック状態を `def.smoothing` として記号定義に入れる
- 既存記号の一覧には「補正オン／補正オフ」ボタンを置き、保存済みの記号も後から切り替えられる
  （エディタは新規作成のみで再編集に対応していないため、切替の置き場所として一覧を使う）。
  フリーハンド線を含まない記号（○・直線・弧だけ）には意味がないのでボタンを出さない
- `ScorePage` は `onToggleSmoothing` で `customSymbolDefs` の該当定義のフラグだけ差し替える

### バリデーション（`storage.ts`）

`validateCustomSymbolDef` に `smoothing`（省略可・真偽値）の検査を追加。
外部ファイル読込で真偽値以外が入っていればデータ全体を invalid にする（既存方針と同じ）。

### 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/utils/strokeSmoothing.ts` | **新規**（移動平均＋RDP の補正本体） |
| `src/types/storage.ts` | `CustomSymbolDef` に `smoothing?` を追加 |
| `src/utils/customSymbolUtils.ts` | `resolveStrokePoints` 新設・描画3経路をそれ経由に変更 |
| `src/utils/storage.ts` | `smoothing` のバリデーション追加 |
| `src/components/SymbolEditor.tsx` | 補正チェックボックス、一覧の補正オン/オフボタン、プレビューへの反映 |
| `src/components/ScorePage.tsx` | `onToggleSmoothing` の配線 |
| `README.md` | 使い方（手ぶれ補正の説明）を追記 |

### 受入テスト（Issue #529 段階1の受入条件との対応）

| 受入条件 | テスト |
|---|---|
| 1. ジグザグが滑らかな曲線として表示される（点数削減とパスの連続性） | `strokeSmoothing.test.ts`（点数が半分未満・内部の振れ幅1px未満・円弧の形は保つ）、`customSymbolUtils.test.ts`（描画した d の Q コマンド数が減る・M は1つ・NaN を含まない）、`SymbolEditorSmoothing.test.tsx`（実マウントで描いた直後の d） |
| 2. 補正オフでオリジナルのストロークに戻せる | `customSymbolUtils.test.ts`（`smoothing: false` の d が元の折れ線と一致・shapes は不変）、`SymbolEditorSmoothing.test.tsx`（チェックを外すと元の d に戻る／一覧のボタンで切り替わる） |
| 3. 既存の保存データが従来どおり表示される | `customSymbolUtils.test.ts`（`smoothing` 省略時の d が従来と同一）、`storage.test.ts`（`smoothing` なしの往復・`smoothing` 込みの往復・真偽値以外の拒否） |

### 既知のリスクと判断

1. **補正の強さが好みに合わない可能性** → パラメータは定数1箇所（`strokeSmoothing.ts`）に集約。
   手触りの調整はライブ検証で行う前提（トリアージコメントの指示どおり既定パラメータで一巡）
2. **描画のたびに計算するコスト** → 1ストローク最大600点・WeakMap キャッシュありで実用上問題なし。
   実測でも譜面描画に体感差はなかった
3. **角（かど）のある記号が丸まる** → 移動平均を2回に抑え、それでも意図を壊す場合は補正オフで回避できる
