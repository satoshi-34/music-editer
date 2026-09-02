# ペダル記号の破線ブリッジ表示

## 問題

`NoteEvent.pedalMark?: 'down' | 'up'` によって、ペダル↓（"Ped"）とペダル↑（"✱"）を
五線下端（`botY + 25`）に SVG テキストとして独立に描画していた（StaffCanvas.tsx / PianoSystemCanvas.tsx）。

実際のピアノ譜では、Ped から ✱ まで破線でつないで「どこまでペダルを踏み続けているか」を
視覚的に示すのが標準的な記譜法である。この破線ブリッジ表示に対応する。

## 修正設計

### データモデルは変えない

`pedalMark: 'down' | 'up'` という単発マークのデータ構造はそのまま維持する。理由:

- Undo/Redo・保存/読込など、既存のデータフローを変更せずに済む（MusicXML 入出力は #568 で pedalMark をそのまま direction/pedal へ対応付け）
- 「ペダル区間」というオブジェクトを新設すると、区間の分割・結合・部分削除などのUI/データ操作が
  一気に複雑化する（松葉やタイと違い、ペダルは1音符に1マークを付け外しするシンプルな操作にしたい）

代わりに、**描画するタイミングで時系列順に並んだ down/up のマーク列をペアリングする**。

### ペアリングロジック（`src/utils/pedalBridgeUtils.ts`）

`pairPedalMarks<T extends { mark: 'down' | 'up' }>(entries: T[]): PedalPairResult<T>[]`

- 呼び出し側は、各パート（多段譜では該当パートのみ）の小節を先頭から順に走査し、
  `pedalMark` を持つイベントを時系列順（小節→イベント順）に並べた配列を渡す
- ルール:
  - `down` の次に来た `up` とペアにする（`{ kind: 'bridge', down, up }`）
  - `down` が連続した場合、前の `down` は対応する `up` が無いまま確定させ
    （`{ kind: 'down', down }`）、新しい `down` を待ち受け直す
  - 待ち受け中の `down` が無い状態で `up` が来たら単独扱い（`{ kind: 'up', up }`）
  - 列の終端まで `down` が残っていれば単独扱い（`{ kind: 'down', down }`）
- 対応が取れない単独の `down`／`up` は、後方互換（既存データ）・入力途中の状態を考慮し、
  従来どおり単独表示のままにする（バグではなく仕様）
- 純粋関数としてユニットテスト（`pedalBridgeUtils.test.ts`）を用意:
  基本の down→up、down 連続、up 単独、複数区間、小節をまたぐ場合、末尾に up の無い down が
  残る場合、空配列

### 描画（StaffCanvas.tsx / PianoSystemCanvas.tsx 共通）

- 各パートの `pedalMarkEntries`（`{ anchorX, botY, mark, stave }`）を `pairPedalMarks` に通す
- `bridge` の場合:
  1. 従来どおり `Ped`（イタリック13px）と `✱`（14px）のテキストを描く
  2. その間を `drawPedalBridgeLine`（`pedalBridgeUtils.ts`）で SVG `<line>`
     （`stroke-dasharray: 3,3`）を引いて破線でつなぐ
  3. テキストと線が重ならないよう、`Ped` の半角幅（12px）・`✱` の半角幅（6px）ぶん
     線の始点・終点を内側にオフセットする（`PED_TEXT_HALF_WIDTH` / `AST_TEXT_HALF_WIDTH`）
  4. 高さは既存のペダルテキストと同じ帯（`botY + 25`）上、テキストのベースラインより
     少し上（`-4`）に線を通し、視覚的にテキストの中央あたりを通るようにする
- `down` / `up` 単独の場合は従来どおりテキストのみ表示

### 段またぎの扱い

松葉（`hairpinRenderUtils.ts` と同様のロジックをこの機能でも踏襲）・タイと同じ基準
（`Math.abs(stave1.getYForLine(2) - stave2.getYForLine(2)) > 30`、または終点Xが始点Xより
左にある＝改段されている）で「段またぎ」を判定する。

段またぎの場合は分割せず両端のみ表示、という単純化も検討したが、実装コストが小さく
視覚的にも自然なため、以下のように2本の破線に分割して描画する:

- 前段側: `Ped` の右から、その段の五線の右端（`stave.getX() + stave.getWidth()`）まで
- 次段側: 次の段の五線の左端（`stave.getX()`）から `✱` の左まで

### 既知の制限（意図的に対応を見送った範囲）

- **松葉（強弱記号）との重なり**: ペダル記号と松葉はどちらも五線下の帯（`botY + 22`〜`+25`
  付近）に描かれるため、同じ音符位置に両方を重ねて付けた場合に視覚的に重なる可能性がある。
  現状は「重なりうる」既知の制限として許容する（実際の楽譜でも稀なケースであり、
  自動でY位置をずらす衝突回避は本対応の範囲外とする）
- ペアリングは「時系列順に並べた配列」に対する純粋なロジックであり、小節番号やパート情報を
  一切持たない。呼び出し側（StaffCanvas/PianoSystemCanvas）が正しい順序で配列を構築する
  責務を持つ

## 影響範囲

- `src/utils/pedalBridgeUtils.ts`（新規）: ペアリングロジック + 破線描画ヘルパー
- `src/utils/pedalBridgeUtils.test.ts`（新規）: ペアリングロジックのユニットテスト
- `src/components/StaffCanvas.tsx`: ペダル描画箇所を `pairPedalMarks` を使う形に変更
- `src/components/PianoSystemCanvas.tsx`: 同上（ピアノ大譜表側）
- `NoteEvent.pedalMark` のデータ構造・保存形式（JSON）は変更なし。MusicXML は #568 で入出力対応（本書末尾の追補）
- 印刷CSS（`App.css` の `@media print`）は `svg line` を無条件で黒表示する既存ルールに
  乗るため、破線用に追加のクラス指定は不要（`vf-hairpin-hit` のような除外クラスも付与していない）

## 追加対応: MusicXML の書き出し・読み込み（Issue #568）

### 問題

ペダル記号（`NoteEvent.pedalMark`）は描画（本設計書の範囲）と再生（#560）に対応済みだが、
MusicXML の書き出し・読み込みのどちらにも実装が無く、**MusicXML で受け渡すと往復で消えていた**。
検聴素材づくり（2026-09-02）で判明。

### 対応方針: 既存の「音符の直前の direction」規則へ相乗りする

MusicXML でのペダルは `<direction><direction-type><pedal type="start|stop"/></direction-type></direction>`
であり、強弱記号（`<dynamics>`）や松葉（`<wedge>`）とまったく同じ「対象音符の直前に direction を置く」
規則で表せる。したがって**新しい仕組みは足さず、既存の経路にフィールドを1つ増やす形**で実装した。

- **書き出し**（`musicXmlExport.ts`）: `pedalDirectionXml(ev, staff)` を追加し、
  `dynamicsDirectionXml` を出している場所（主声部・追加声部の両方）の直後に並べる。
  `pedalMark: 'down'` → `type="start"`、`'up'` → `type="stop"`。
  `line="no"` は「横線ではなく Ped. ‥ ✱ の記号で表す」指定で、このアプリの描画と一致する。
  `<staff>` を付けるのは他の direction と同じ（大譜表で置いた段を保つため）
- **読み込み**（`musicXmlImport.ts`）: `attachDirectionMarksToVoiceEvents`（松葉と文字強弱を
  1本の走査で組み立てている既存の関数）に `pendingPedal` を足した。**走査を2本目に増やさない**
  （#552 で確立した方針。同じ歩き方の2枚目を作ると片方だけ直る事故になる）。
  1つの音符が持てるペダル記号は1つなので、待ち行列（配列）ではなく最後の1つを覚える形にした
- 大譜表の段の振り分けは既存の direction フィルタ（`staffNumberOf(el) === staffNumber`）が
  そのまま効くため、追加の実装は不要だった

### 外部ファイルの `type="change"`（踏み替え）の扱い

他ソフトは「離してすぐ踏む」を `type="change"` の1つで書くことがあるが、このアプリの
データモデル（`pedalMark = 'down' | 'up'` の単発マーク）では1つの音符に両方を持てない。
v1 では **`change` は「踏む」として取り込む**（音は踏み替え前の響きが少し残るが、
ペダルが完全に消えるよりは実害が小さい）。このアプリ自身の書き出しは `change` を出さない。

### 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/utils/musicXmlExport.ts` | `pedalDirectionXml` 新設・主声部/追加声部の両方で出力 |
| `src/utils/musicXmlImport.ts` | `attachDirectionMarksToVoiceEvents` に `pendingPedal` を追加 |
| `src/utils/musicXmlPedal.test.ts` | **新規**（往復テスト一式） |
| `README.md` | MusicXML でペダルが受け渡せる旨を追記 |

データモデル（`NoteEvent.pedalMark`）・描画・再生・保存形式（.score.json）は変更なし。MusicXML の入出力は #568 で対応済み（追補参照）。

### 受入テスト（Issue #568 の仕様との対応）

| 仕様 | テスト（`musicXmlPedal.test.ts`） |
|---|---|
| 1. 書き出し（対象音符の直前の direction） | `<pedal type="start" line="no"/>` / `stop` が出力されること |
| 2. 読み込み（change は start 扱い・大譜表は staff 指定に従う） | `type="change"` を 'down' として取り込む／大譜表で下段のペダルが上段へ漏れない |
| 3. 往復テスト（踏み替え＝連続 start・単独 start を含む） | 同一小節・小節またぎ・連続 down・down のみ・声部2 の5ケース |
| 4. 記号の無い譜面の出力は不変（回帰） | ペダルの無い譜面の出力に `<pedal` が現れない |
