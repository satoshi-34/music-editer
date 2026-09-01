# 設計書: アーティキュレーション（奏法記号）実装

## 概要

スタッカート / アクセント / テヌート / マルカート / フェルマータの 5 種を実装する。
強弱記号（Dynamics）と同じく **音符1つにぶら下がる記号** として扱い、**描画・保存・再生** を同じデータでそろえる。

## 問題点

- 既存の `NoteEvent` には「鳴らし方」の情報が無く、Finale のような基本的な奏法表現ができない
- スタッカート（短く切る）やアクセント（強く）は、見た目だけでなく再生の長さ・音量にも効かせたい
- 編集ツールは音価・タイ・臨時記号・リピート・強弱までで、奏法記号専用の入力経路が無い

## 修正設計

### 1. `NoteEvent` に奏法記号を追加（`types/storage.ts`）

スタッカート＋アクセントのように複数を同時に付けられるため、**文字列の配列**で持つ。

```ts
export type ArticulationMarking = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata';

export interface NoteEvent {
  // ...既存フィールド
  articulations?: ArticulationMarking[];
}
```

- 強弱（`dynamics: DynamicMarking[]`）はオブジェクト配列だが、奏法記号は付帯情報が無いので素の文字列配列で十分。
- 空になったら配列ごと `undefined` にして保存データを軽く保つ。

### 2. ユーティリティ（`utils/articulationMarkingUtils.ts` 新規）

1 か所に「記号一覧・トグル・VexFlow コード変換・再生効果」を集約する。

| 関数 | 役割 |
|---|---|
| `ARTICULATION_VALUES` | パレットの並び順も兼ねた一覧 |
| `isArticulationMarkingValue` | localStorage から読んだ値の検証用 |
| `toggleArticulationOnEvent(event, value)` | 付いていれば外す／無ければ足す。休符には付けない |
| `getArticulationVexflowCode(value)` | VexFlow の `Articulation` 記号コード（`a.` `a>` `a-` `a^` `a@a`）へ変換 |
| `isAboveArticulation(value)` | フェルマータ・マルカートを符頭の上に固定するか |
| `getArticulationPlaybackEffect(event)` | 付いている全記号を「長さ倍率 / 音量倍率」へ畳み込む |

再生効果（複数付いていれば倍率を掛け合わせる）:

| 記号 | 長さ倍率 | 音量倍率 | 意図 |
|---|---|---|---|
| staccato | 0.5 | 1.0 | 短く切る |
| accent | 1.0 | 1.3 | その音だけ強く |
| tenuto | 1.0 | 1.05 | 音価いっぱい保ち、ほんの少し強め |
| marcato | 0.7 | 1.4 | 強く＋やや短く |
| fermata | 1.8 | 1.0 | 長めに伸ばす |

### 3. パレット（`components/Palette.tsx`）

`Tool` 判別共用体に `{ mode: 'articulation'; articulation: ArticulationMarking }` を追加し、
強弱ボタン行の後ろに 5 つのボタンを並べる。選択中の再クリックでツール解除（既存記号と同じ挙動）。

### 4. 描画とクリック付与（`StaffCanvas.tsx` / `PianoSystemCanvas.tsx`）

- **描画**: `makeVFNote` の返却直前に `attachArticulations()` を呼び、VexFlow の `Articulation`
  モディファイアを符頭へ付ける。フェルマータ・マルカートは `setPosition(3)`（ABOVE）で上付きに固定。
  ライブラリ差異で失敗しても譜面全体の描画は止めないよう `try/catch` で包む（臨時記号と同じ方針）。
- **クリック付与**: クリックハンドラで `articulationMode` を取り出し、強弱記号と同じ位置（和音追加や
  新規挿入より先）で `toggleArticulationOnEvent` を適用。休符セルや空白セルでは何もしない（`return`）。

### 5. 再生反映（`ScorePage.tsx` / `PlaybackEngine.ts` / 各エンジン）

- `ScorePage` の `playParts` 用イベント生成で、強弱由来のベロシティへ `velocityScale` を掛けて 0..1 に収める。
- 長さ倍率は `PlaybackMeasureEvent.durationScale`（新規 optional）として両エンジンへ渡す。
- `SoundFontEngine` / `SimpleAudioEngine` は `soundDuration = duration * (durationScale ?? 1)` を発音長に使い、
  **次の音までの間隔（`partTime` / `currentTime` の進み）は元の `duration` のまま据え置く**。
  これでスタッカートは「音が短く切れるがテンポは変わらない」正しい挙動になる。

## 検証

- 単体テスト 10 件（`articulationMarkingUtils.test.ts`）: トグル・休符除外・倍率の畳み込み・コード定義・検証関数。
- パレットのボタン数テスト（`BackwardCompatibility.test.tsx`）を 30 → 35 へ更新。
- 全テスト 582 件パス、`tsc -b && vite build` 成功。

## やってはいけないこと

- 休符に奏法記号を付けない（鳴らし方の指示なので意味を持たない）。
- `durationScale` で「次の音までの間隔」を縮めない（スタッカートでテンポが速くなってしまう）。
- VexFlow の `Articulation` 生成失敗で譜面描画全体を止めない（`try/catch` で握りつぶす）。

## 影響範囲

- `src/types/storage.ts` — 型追加（後方互換、optional）
- `src/utils/articulationMarkingUtils.ts` / `.test.ts` — 新規
- `src/utils/storage.ts` — 保存データ検証に `articulations` を追加
- `src/utils/voiceMeasureUtils.ts` — `cloneNoteEvent` で `articulations` を複製
- `src/components/Palette.tsx` — ツール追加・ボタン行・ラベル
- `src/components/StaffCanvas.tsx` / `PianoSystemCanvas.tsx` — 描画と付与
- `src/components/ScorePage.tsx` — 再生時の長さ・音量へ反映
- `src/audio/PlaybackEngine.ts` — `PlaybackMeasureEvent.durationScale` 追加
- `src/audio/SoundFontEngine.ts` / `SimpleAudioEngine.ts` — 発音長へ `durationScale` を適用

## 追記（バグ修正）: PianoSystemCanvas でフェルマータ・途中テンポ変更（tempoMarking）が描画されていなかった

上の「描画とクリック付与」の節は StaffCanvas/PianoSystemCanvas 両方に描画があると書いていたが、
実際には **`PianoSystemCanvas.tsx`（ピアノ2段譜・弦楽四重奏などの複数段編成）には
`articulations` / `tempoMarking` を描く経路が一切無かった**。クリックで `articulations` 配列自体は
保存データへ正しく付与されるが、画面に何も表示されないまま気付きにくいサイレント欠落になっていた
（複雑テスト楽譜の低音部 `c/2,g/2,c/3`・`fermata` 付き全音符などで再現）。

### 原因

- `PianoSystemCanvas.tsx` のローカル `NoteEvent` 型（ファイル冒頭）に `articulations` / `tempoMarking`
  フィールドが定義されておらず、`dynamics` や `fingering` と違って描画情報を集める配列
  （`dynamicTextEntries` 相当）自体が存在しなかった。
- なお VexFlow の `StaveNote` 自体は正しく全音符の符頭（3和音なら3個）を構築・描画しており、
  「符頭が欠ける」という現象は本調査では再現しなかった（一時的なレイアウト再計算前の
  古い DOM を見ていた可能性が高い）。

### 修正

`StaffCanvas.tsx` の実装（VexFlow の `Articulation` モディファイアではなく、**素の SVG 要素を
音符の位置情報から計算して自前描画する方式**）をそのまま `PianoSystemCanvas.tsx` へ移植した。

- `NoteEvent` 型に `articulations?: ArticulationMarking[]` と `tempoMarking?: string` を追加
- `articulationEntries` / `tempoMarkingEntries` 収集配列を追加し、アクティブ声部・非アクティブ声部の
  両方のイベント走査ループで push する（`fingeringEntries` と同じ位置・同じ方針）
- 全音符描画後に一括で SVG を組み立てる描画ループを追加（フェルマータ＝弧＋点、
  スタッカート＝符頭上の小さい丸、アクセント＝楔形、テヌート＝水平線。`marcato` は
  StaffCanvas 側も未実装のため今回も未対応のまま）
- `tempoMarking` はコード記号と同じ位置（五線上端より24px上）にイタリック体で表示

### 検証

- `docker compose run --rm app npx tsc --noEmit` / `npx vitest run`（925件）とも green（既存の
  回帰テストのみ。新規の描画ロジックは SVG 要素の手組み立てで、既存の `fingeringEntries` 等と
  同型のためユニットテストは追加していない）
- ブラウザ DOM 実測: 複雑テスト楽譜 measure index 23（左手 `c/2,g/2,c/3` + フェルマータ、右手
  `c/5,e/5,g/5,c/6` + フェルマータ + `tempoMarking:"Fine"`）で、修正前は `svg.querySelector('[class*=fermata]')`
  が無く `text` 要素にも `"Fine"` が見つからなかったが、修正後は両方の五線に半円弧＋点のフェルマータが
  描画され、`svg` 内の `text` 一覧に `"Fine"` が含まれることを確認した。符頭数は修正前後とも
  左手3個・右手4個で変化なし（符頭欠けは本修正の対象ではなかった）。

## 追記（機能追加）: アーティキュレーションを⤢/✥の記号調整ツールの対象に追加、marcato描画も実装

上の「原因」節で触れた通り、articulations の描画は VexFlow の `Articulation` モディファイアではなく
StaffCanvas.tsx / PianoSystemCanvas.tsx 両方で手組みの SVG（円・パス・線）に統一されていた。
それにも関わらず `extended-notation-features/design.md` 時点の `symbolAdjustUtils.ts` は
articulations を「VexFlowのグリフ構造上、安全な描画反映を作り込めなかった」という理由で
⤢/✥ツールの対象から除外したままだった。手組みSVGなら他の標準記号（運指・強弱記号など）と
全く同じ「座標にoffsetXY・図形サイズにscaleを掛ける」方式で反映できるため、この除外を解消した。

### きっかけ

複雑テスト楽譜の小節24で、右手の全音符和音の真上にフェルマータと `tempoMarking`（"Fine"）が
重なって窮屈だった。フェルマータを位置調整できるようにしたいというユーザーの要望。

### 修正内容

- `src/utils/symbolAdjustUtils.ts`: `listPresentAdjustableSymbolKinds` に
  `if (event.articulations && event.articulations.length > 0) kinds.push('articulations');` を追加
  （休符は従来どおり除外）。除外コメントを ornament のみに限定する内容へ書き換え。
- `src/components/StaffCanvas.tsx` / `PianoSystemCanvas.tsx`: `articulationEntries` に
  `adjust: getSymbolAdjust(event, 'articulations')` を追加し、描画ループで
  `ax = anchorX + adjust.offsetX` / `s = adjust.scale` を使って各図形（フェルマータの弧・点、
  スタッカートの点、アクセント・マルカートの山形、テヌートの線）の座標・半径・線幅・積み上げ間隔を
  スケーリングするよう変更。1音符に複数のアーティキュレーションが付いていても、まとめて同じ
  `adjust` 値を適用する（個別記号ごとの調整はできない）。
- **marcato の描画漏れも合わせて解消**: 上の「追記（バグ修正）」節に記載の通り、PianoSystemCanvas
  移植時点では marcato が StaffCanvas 側も含めて未実装（クリックで付与はできるが画面に何も
  出ない）だった。今回、塗りつぶした山形（アクセントのストロークのみの山形と区別するため）を
  両ファイルに追加し、StaffCanvas/PianoSystemCanvas とも `staccato`/`accent`/`tenuto`/`fermata`/
  `marcato` の5種類すべてが描画されるようにした。
- `src/utils/storage.ts` の `ADJUSTABLE_SYMBOL_KINDS` は元々 `'articulations'` を含んでいたため、
  保存データのバリデーション側の変更は不要だった。
- ornament（装飾記号）は VexFlow の `Ornament` モディファイアのままなので、今回も対象外のまま
  とした（無理に対応させない）。

### 検証

- `docker compose run --rm app npx tsc --noEmit` green。
- `docker compose run --rm app npx vitest run` 927件 green
  （`symbolAdjustUtils.test.ts` に「アーティキュレーションは手組みSVG描画のため列挙する」
  「休符に付いたアーティキュレーションは列挙しない」の2件を追加）。
- ブラウザ実測（複雑テスト楽譜 小節24、右手 `ff` 全音符和音 + フェルマータ + `tempoMarking:"Fine"`）:
  ✥ツールで音符をクリックすると「テスト記号／強弱記号／アーティキュレーション／テンポ表記」の
  選択リストが出ることを確認（articulations が選択肢に追加されたことの実証）。
  「アーティキュレーション」を選び offsetX=25/offsetY=-30 を設定すると、フェルマータの弧の
  `path` の `d` 属性が `M 76.36 40.53 ...` → `M 101.36 10.53 ...`（+25/-30が正確に反映）へ変化。
  保存 → リロード → 読込しても同じオフセットが復元されることを確認。⤢ツールでも
  scale=180% にすると弧の半径が `11`→`19.8`（×1.8）、`stroke-width` が `1.6`→`2.88`（×1.8）へ
  変化することを確認。元に戻す（Undo）でスケール・オフセットとも元の値に戻ることを確認。
  最終的にオフセットを横+38pxのみに調整し、"Fine" とフェルマータの重なりが解消された見た目を確認。
  コンソールエラーなし。StaffCanvas 側は PianoSystemCanvas と全く同じロジックのコード変更を
  行っており、コードレビューで同等の反映を確認した（複雑テスト楽譜はピアノ譜のため、単旋律譜
  （StaffCanvas）でのブラウザ実機確認はできていない）。

## 回帰修復の記録（2026-08-22）: 適用ケースの移植漏れ

**原因**: StaffCanvas 廃止（PianoSystemCanvas 一本化）の際、音符クリックの
ツール振り分け（音符セルの switch）へ `case 'articulation'` が移植されなかった。
パレットのボタン・描画・再生効果・位置/サイズ調整・MusicXML 入出力は残っていたため、
「ツールを選んで音符を押しても何も付かない」だけが静かに欠けていた
（Issue #279 のコード記号描画の移植漏れと同型）。#173（パート譜の記号編集）の
調査で PSC 分岐と Palette の Tool union を突き合わせて発見。

**復旧内容**: PSC の音符セル分岐へ `case 'articulation'` を追加。強弱記号（dynamic）と
同じ形 — `toggleArticulationOnEvent` によるトグル付け外し・選択と再生プレビューの更新・
休符クリックは `describeSymbolToolUnavailable({type:'articulation'}, 'rest')` で理由通知（#318）。
SymbolTool union へ articulation を追加。

**影響範囲**: PSC の当該 switch 1ケース + scoreEditorNotices の union/文言のみ。

**回帰テスト**: PianoSystemCanvasArticulationTool.test.tsx 3件
（付与＝修正前は赤・再クリックでトグル解除・休符は拒否+通知）。

## 追補（2026-09-01・Issue #527）: フェルマータの弧を彫版標準の塗り形状にした

### 問題

フェルマータを「太さ一定の細い楕円弧（`stroke-width: 1.6`）＋弧の内側の上寄りの点」で描いていたため、
針金のように見えて彫版標準と違っていた（発案者ユーザーからの指摘「フェルマータの記号の見た目がおかしい」）。
彫版標準（SMuFL の `fermataAbove` など）のフェルマータは、**頂点がいちばん太く両端へ向かって細くなる
塗りつぶしの弧**と、**弧の開口部（下側）の中央・ベースライン寄りに置く点**で構成される。
点の位置も `baseY - 4` と弧の内側の上寄りにあり、標準からずれていた。

### 修正設計

弧を「外側の楕円弧 → 右端で内側へ折り返し → 内側の楕円弧で戻る → 閉じる」1本の塗りパスにした。

```
M (cx-Rx) baseY  A Rx Ry 0 0 1 (cx+Rx) baseY  L (cx+rx) baseY  A rx ry 0 0 0 (cx-rx) baseY  Z
```

- 外側 `Rx × Ry = 11 × 9`（**従来の弧と同じ大きさ**）、内側 `rx × ry = 9.6 × 5.2`。
  横はほぼ同じ・縦だけ浅い内側の弧を重ねることで、頂点 `9 - 5.2 = 3.8`／両端 `11 - 9.6 = 1.4` と
  約 2.7 倍の太さの差が生まれる（＝頂点が太く両端が細い）。
- 外側の大きさを変えていないので、**記号が占める大きさと位置は従来と同じ**。位置調整済みの
  保存データ（`symbolAdjust.articulations` の `offsetX` / `offsetY` / `scale`）の見え方も変わらない
  （受入条件3）。`scale` は各寸法への倍率、`offset` は座標への加算という既存の掛け方のまま。
- 内側の弧の掃引方向（sweep フラグ）は外側と逆にする。同じ向きにすると帯にならず、
  8の字のようにねじれた形になる。
- 点は `baseY - 2.8`（半径 1.9）へ下げた。開口部の高さ（内側の弧の頂点 = 5.2）のほぼ中央で、
  上端 `2.8 + 1.9 = 4.7 < 5.2` なので内側の弧とぶつからない。
- 寸法は `FERMATA_ARC_OUTER_RX` などの定数として `PianoSystemCanvas.tsx` の先頭にまとめ、
  「なぜその値か（太さの差の作り方）」をコメントで残した。

### 二重実装について（Issue の修正方針4）

Issue には「StaffCanvas 側に同型の描画があれば同時に揃える」とあるが、**フェルマータの描画は
`PianoSystemCanvas.tsx` の1か所にしかない**（単旋律譜の `SingleStaff` も内部で `PianoSystemCanvas`
を描画する）。そのため受入条件2（単旋律とピアノ大譜表で見た目が一致）は構造的に保証されている。
実ブラウザでも、単旋律とピアノ大譜表で同じパス（`11 × 9` / `9.6 × 5.2`）が出ることを確認した。

### クリック判定（Issue の修正方針5）

描画される要素の構成は「path（弧）＋ circle（点）」のままで、`drawnElements` へ積む順序・件数も
変わっていないため、`appendSymbolHitRegion` の当たり判定はそのまま追随する（変更不要）。

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`: フェルマータの弧を塗りパスへ変更、点の位置・半径を調整、
  寸法の定数を追加。
- 追加: `src/components/PianoSystemCanvasFermataGlyph.test.tsx`（4件・パス構造／太さの変化／点の位置／
  `offsetX`・`offsetY`・`scale` の互換／旧実装の残存が無いこと）。
- `docs/REGRESSION.md`: セクションF に確認項目を2件追加。
- README は更新していない（操作方法・画面の使い方は変わらず、記号の見た目だけの修正のため。
  README は「ユーザーから見える操作・画面が変わった場合のみ」更新する規約）。

### 検証結果

- vitest（変更に関係するファイル）: 新規4件＋既存のアーティキュレーション／記号調整まわり
  （AccentGlyph・ArticulationTool・SymbolClickRouting・PartExtractionStaffSymbols・
  symbolAdjustUtils・articulationMarkingUtils）の**49件すべて緑**。
- `npx tsc --noEmit` エラーなし / `npm run lint:ratchet -- --check` 基準値ちょうど（324件）/ `npm run build` 成功。
- ブラウザ実測（worktree の一時エントリ経由）:
  - 単旋律で音符→フェルマータを付与 → `M 83.7 36 A 11 9 0 0 1 105.7 36 L 104.3 36 A 9.6 5.2 0 0 0 85.1 36 Z`
    ＋点（`cy = baseY - 2.8`・`r = 1.9`）が描かれる。SVG を viewBox で拡大して目視し、
    頂点が太く両端が細い塗り形状・開口部中央の点になっていることを確認。
  - ピアノ大譜表でも**同じ寸法のパス**が出る（受入条件2）。
  - コンソールエラーなし。
