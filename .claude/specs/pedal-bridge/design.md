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
  自動でY位置をずらす衝突回避は本対応の範囲外とする）。
  **音符・加線との重なりは #604 で対応済み**（下の追補を参照）。松葉・強弱記号は依然として
  障害物にしていない（強弱の押し出し結果を Ped が避けるようにすると、強弱の有無で Ped の
  高さが変わり「低音の無い譜面で 1px も動かさない」と両立しないため。#416 の積み順一元化で扱う）
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
  1本の走査で組み立てている既存の関数）へペダルの取り込みを足した。**走査を2本目に増やさない**
  （#552 で確立した方針。同じ歩き方の2枚目を作ると片方だけ直る事故になる）。
  1つの音符が持てるペダル記号は1つなので、待ち行列（配列）ではなく最後の1つを覚える。
  待ち状態は関数ローカルではなく、**呼び出し側の `PedalCarry`（声部ごと・小節ループの外）**に
  持つ（round1 P1: MusicXML の direction は「同じ声部で後続する最初の音符」に付くため、
  小節最後の音符の後に置かれた `<pedal type="stop"/>` は次小節の先頭音符へ持ち越す必要がある）
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
| `src/utils/musicXmlImport.ts` | `attachDirectionMarksToVoiceEvents` へペダル取り込みを追加（待ち状態は呼び出し側の `PedalCarry` で小節間を持ち越し） |
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

## 追補: Ped/✱ と五線下の低音の衝突回避（Issue #604・2026-09-05）

**現象**: 月光検聴版の左手（c#2 のオクターブ＝深い加線）に Ped が重なる。縦位置が
`pedalTextY = botY + 25` の固定オフセットで、音符・加線との衝突回避が元から無かった。

**設計**:
- `resolvePedalBaselineY({ baseY, spanX1, spanX2, obstacles })`（`pedalBridgeUtils.ts`）:
  従来位置の字面の箱（baseline − 10 〜 + 3）に**実際に食い込む**障害物があれば、その下端 + 余白
  4px を字面の上端にする高さまで下げる。食い込まなければ `baseY` をそのまま返す
  （通常音域の下向き符幹が字面の上端をかすめる程度では動かさない＝低音の無い譜面で 1px も
  変わらない、が受入条件）。強弱記号のような step 探索ではなく一発のクランプにしたのは、
  ペダルは段の最下段にしか付かず（#382 の「下の五線」境界が無い）、答えが一意だから
- 障害物は強弱記号の回避（#340/#382）と同じ `noteObstacles`（符頭＋符幹の BoundingBox）。
  `pedalMarkEntries` に `partIndex` を持たせ、**同じパートの音符だけ**を渡す（右手の低い音で
  左手の Ped が動かない）
- **ペアは区間全体で1つの高さ**（仕様2）: Ped の左端〜✱ の右端を1つの箱として求めるので、
  ✱ の下に低音が無くても Ped と同じ高さに下がり、破線が斜めにならない
- **段またぎ**（仕様3）: 前段は Ped〜段の右端、次段は段の左端〜✱ をそれぞれの範囲で求める
  （段が違えば高さが違ってよい）
- 単独の Ped/✱ は自分の字面の幅だけを見る

**テスト**: `pedalBridgeUtils.test.ts`（クランプの計算 6件）／
`PianoSystemCanvasPedalClearance.test.tsx`（実マウント配線 3件: 低音なしで従来位置のまま・
深い加線の和音でそろって下がる・別パートの低音では動かない）

**対象外**: StaffCanvas（単旋律の旧描画）は同名処理を持つが、単旋律譜のペダルは実運用が無く
今回は触っていない。#416（記号の積み順の一元化）で両キャンバスをまとめて扱う

### Codex round 1 対応（2026-09-05）

- **P1 段の下余白の予約**: 描画後のクランプで Ped を下げても段の高さ（`computeLayout` の sysH）が
  固定では SVG の外へはみ出す（印刷は `overflow: hidden`）。段の高さは描画前に決まるので、
  `estimatePedalBottomExtensionPx(parts)` で**譜面データから**必要量（最下パートの最低音の深さ
  ＋段またぎ below の音符）を先に見積もり、`computeLayout(n, partSpacingOffsetPx, bottomExtensionPx)`
  の下余白へ足す。ScorePage 側のページ段数の見積もり（`measuredSystemHeightPx` /
  `recommendedSystemHeightPx`）も同じ純関数・同じ入力で同じ値を足すので、段の実高さと一致する。
  ペダルの無い譜面では 0（段の高さは従来どおり）。全段で同じ値（ページ計算が「段の高さは一定」前提）
- **P1 加線の張り出し**: 加線は符頭の BoundingBox に入らないので、横だけ `PEDAL_LEDGER_OVERHANG_PX`
  ぶん余裕を見る（縦は食い込み判定のまま）
- **P1 段またぎの帰属**: ペダルの五線・パートを `resolveRenderStave(ev)` / `resolveRenderPartIndexFor(ev)`
  でそろえ、描画先の低音を避ける
- **P2 テスト**: `ScorePagePedalClearanceWiring.test.tsx`（ScorePage 実マウント・低音あり/なしの差分と
  SVG 高さ）、canvas テストに SVG 高さ・段またぎの2件、純関数に見積もりの5件を追加
