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
