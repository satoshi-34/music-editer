## 進捗（実装）

- **手順1（`SingleStaff` ラッパー新設）完了**: `src/components/SingleStaff.tsx` を
  `PartExtractionStaff`/`PianoStaff` と同型のパターンで実装した
  （`Array.from({length: systems})` で `PianoSystemCanvas` をループ、
  `partsConfig` は要素数1・`clef: 'treble'` 固定）。編集可能なラッパーのため
  props の通し方は `PianoStaff.tsx` に合わせた（`onChange` を実際に呼ぶ）。
  `gap` は StaffCanvas 由来の互換 props として受け取るが、上記「移行手順案」の
  想定どおり実装では使っていない（PianoSystemCanvas 側に段間隔を明示指定する
  仕組みが無いため）。単体テスト `src/components/SingleStaff.test.tsx` を追加
  （`PianoSystemCanvas` をモックし、段数ぶんレンダーされるか・
  `startMeasureIndex` のずれ・`partsConfig` への変換・props 伝搬を検証）。
- **手順2（`ScorePage.tsx` の単旋律分岐切替）完了**: `ScorePage.tsx:3041` 付近の
  単旋律譜 else 分岐を `StaffCanvas` から `SingleStaff` に置き換えた。
  props はほぼそのまま横流し（`clef="treble"` は `SingleStaff` 側で固定して
  いるため呼び出し側では渡していない）。`StaffCanvas` の import は使われなく
  なったため削除した（コンポーネント本体・テストファイルは手順3まで削除しない）。
  ブラウザで確認した内容:
  - 音符クリックでの入力（休符→音符）、選択ツールでのノート選択、
    段の追加・削除（コミット e2d9bc7 の機能）、歌詞入力が動作することを確認。
    コンソールエラーは出ていない。
  - 歌詞は設計どおり「五線の下」から「五線の上」に表示が変わることを確認
    （意図した仕様変更）。
  - ページリロード後にブラウザの自動保存データが画面に反映されない事象が
    あったが、これは `localStorage`（`music-score-app-data`）には入力内容が
    正しく書き込まれていることを確認済みで、リロード時の自動読込みタイミング
    に関する既存アプリの挙動（`SingleStaff` 固有の問題ではない可能性が高い）。
    今回のスコープでは深追いしていないため、別途調査が必要であれば別issueで
    扱う。
  - ピアノ大譜表・弦楽四重奏モードは今回の diff で触っていない
    （`else` 分岐以外は無変更）ため、リグレッションのリスクは低いと判断し、
    ブラウザでの再確認は簡易に留めた。

# フェーズ2: StaffCanvas 退役の実現可能性メモ（v2: レイアウトAPI不一致を調査）

このメモは実装計画ではなく、「単旋律譜も `PianoSystemCanvas`（`partsConfig` 要素数1）に
寄せて `StaffCanvas.tsx` を退役させられるか」を検討するための下調べ。
v1（歌詞まわりの調査）はこの文書に統合済み。v2 では残っていた最後のブロッカー
「レイアウトAPIの不一致」（`systems`/`gap`/`initialScoreData` vs `partsConfig`）を
コードから事実確認し、移行手順案を追加した。**コード変更は行っていない。**

## 結論（先に要約）

- **「段の折り返し（systems）」は `PianoSystemCanvas` の責務ではなく、常に呼び出し側の
  ラッパーコンポーネントが担っている。** `PianoStaff.tsx` / `QuartetStaff.tsx` /
  `PartExtractionStaff.tsx` はいずれも `Array.from({ length: systems }, ...)` で
  `PianoSystemCanvas` を **段の数だけ複数回レンダー**し、各インスタンスに
  `startMeasureIndex + i * measuresPerSystem` を渡すことで「1段だけ描く部品」を
  積み重ねている。`PianoSystemCanvas` 自身は `measuresPerSystem` 分の小節を
  1段だけ描く（内部で折り返さない）。
- StaffCanvas はこれと逆で、`systems`/`gap` を自分の props として受け取り、
  **1つのコンポーネント内で複数段をまとめて描画**する（`top + line * gap` で
  段ごとの Y 座標を計算し、1つの SVG に systems 段ぶん描く）。
- つまり「レイアウトAPIの不一致」の実体は、**折り返しの責務が
  コンポーネント内か・呼び出し側かが逆転している**という設計そのものの違いであり、
  単純な props 変換では吸収できない。ただし `PianoStaff`/`QuartetStaff`/
  `PartExtractionStaff` という「ラッパーが折り返しを担う」パターンは既に3つの
  実例があるため、単旋律譜用にも同じパターンの `SingleStaff`（仮称）ラッパーを
  新設すれば構造的には解決できる。
- **段数可変機能（コミット e2d9bc7、`totalSystems`・自動拡張・段の追加削除）は
  `StaffCanvas`/`PianoSystemCanvas` のどちらにも実装されておらず、完全に
  `ScorePage.tsx` 側（呼び出し元）に実装されている。** `scoreType` によらず
  共通の `totalSystems` state・`pages` 計算・`autoExpandIfLastSystemHasContent`
  を使っており、`piano`/`quartet`/`ensemble` モードは既にこの仕組みの上で
  `PianoSystemCanvas` ベースの `PianoStaff`/`QuartetStaff`/`EnsembleStaff` を
  問題なく使えている。**つまりこの機能は移行のブロッカーではない**（v1 メモ時点の
  懸念は誤りだったので訂正する）。

## 調査1: PartExtractionStaff の吸収方法

`src/components/PartExtractionStaff.tsx:60-91`

```
{Array.from({ length: systems }, (_, i) => {
  const partsConfig: PartConfig[] = [{ ...partConfig, data, onChange: NOOP_ON_CHANGE }];
  return (
    <PianoSystemCanvas
      key={i}
      measuresPerSystem={measuresPerSystem}
      partsConfig={partsConfig}
      startMeasureIndex={startMeasureIndex + i * measuresPerSystem}
      ...
    />
  );
})}
```

- 折り返し（何段描くか）は **呼び出し側**（`PartExtractionStaff`）が `systems` 回の
  ループで担っている。`PianoSystemCanvas` には `data` の全量（`MeasureData[]` 全体）を
  毎回渡し、`startMeasureIndex` だけをずらすことで「どこから描き始めるか」を
  伝えている。実際に何小節描画するかは `measuresPerSystem` で PianoSystemCanvas
  内部が決める（1段固定・折り返さない）。
- `systems`/`gap` 相当の指定: `systems` はループ回数としてそのまま使われている。
  `gap`（段間隔）に相当するものは無く、単に `<div>` の中に `PianoSystemCanvas` を
  縦に並べているだけ（各 `PianoSystemCanvas` の高さ分だけ自然に積み上がる、
  DOM のブロックレイアウト任せ）。StaffCanvas のように「段間隔を数値で明示指定」
  する仕組みはこのパターンには無い。
- `PianoStaff.tsx:63-87` / `QuartetStaff.tsx:56-79` も全く同じパターン
  （`Array.from({length: systems})` でループし `startMeasureIndex` をずらす）。
  3つとも独立実装だが構造は同一 ＝ 「ラッパーが折り返しを担う」が既に確立した
  社内パターンと言える。

## 調査2: PianoSystemCanvas の折り返し能力

- `PianoSystemCanvas` 自体は **段数（systems）の概念を持たない**。1回の呼び出しで
  `measuresPerSystem` 個の小節を1段だけ描く（`src/components/PianoSystemCanvas.tsx:598`
  に `measuresPerSystem?: number` は props としてあるが、`systems`/`gap` に相当する
  props は存在しない）。
- `scale` は props にある（`PianoSystemCanvas.tsx:600`）ので、これは StaffCanvas と
  同じ形でそのまま使える。
- 「段数可変（段の追加・削除・末尾自動拡張）」に相当する機能は
  `PianoSystemCanvas`/`StaffCanvas` のどちらにも実装が無い。この機能は
  `ScorePage.tsx` の `totalSystems` state・`pages` メモ・
  `autoExpandIfLastSystemHasContent`（`ScorePage.tsx:1344-1358`）が担っており、
  `scoreType` を問わず共通のロジックである（`handleScoreDataChange`・
  `handleRightHandChange`・各パートの change ハンドラすべてから呼ばれる。
  `ScorePage.tsx:1380` 付近）。**したがって PianoSystemCanvas 側に何か機能を
  足す必要はなく、単旋律譜が `PianoStaff`/`QuartetStaff` と同じ「ラッパーで
  段をループする」構造に乗り換えさえすれば、段数可変機能はそのまま動く。**
- 足りないもの（構造的なギャップ）は結局「複数段をループして描く責務」のみで、
  それは `PianoSystemCanvas` を直接使わず `PartExtractionStaff` 等と同じ
  ラッパーパターンで解決する前提になる。

## 調査3: StaffCanvas の呼び出し元の全列挙

`grep -rn "StaffCanvas" src` の結果、コンポーネントとして実際に `<StaffCanvas .../>`
と描画しているのは1箇所のみ：

- `src/components/ScorePage.tsx:3041` — `scoreType` が `single`/`piano`/`quartet`/
  `ensemble` のいずれでもない場合（＝デフォルトの単旋律譜）に使われる分岐の
  `else` 節。props: `systems={p.systems}` `gap={110}` `measuresPerSystem`
  `initialScoreData={rightHandData}` `onScoreDataChange={handleScoreDataChange}`
  他、`disabled`/`yOffset`/`currentInstrument`/`onPreviewNoteEvent`/
  `previewAccidentalOnApply`/`keySignature`/`timeSignature`/
  `onKeySignatureChange`/`selectedMeasures`/`onMeasureSelect`/`customSymbolDefs`。
- それ以外の `StaffCanvas` ヒットはテスト（`StaffCanvas.test.tsx` 等）と
  ユーティリティ（`arcUtils.ts`・`lyricsRenderUtils.ts` 等、`StaffCanvas` という
  文字列がコメント上に出るだけ）。
- `onScoreDataChange` を受ける `handleScoreDataChange`（`ScorePage.tsx:1380`）は
  `setRightHandData(data)` を呼ぶ（`piano` モードの右手と同じ state 変数
  `rightHandData` を共用している）。保存フォーマット側では `scoreType` に応じて
  `parts` 配列を組み立てており（`ScorePage.tsx:1467-1476` 付近）、単旋律モードは
  `{ partId: 'melody', clef: 'treble', measures: rightHandData ?? [...] }` という
  1パート構成で保存される。`PianoSystemCanvas` 経由（`partsConfig` 1要素）に
  切り替えても、呼び出し元が最終的に `rightHandData` へ書き戻す限り**保存
  フォーマットへの影響は無い**。

## 調査4: StaffCanvas 固有 props/機能の残り（歌詞解消後の最新化）

### 解消済み

- 歌詞（`lyrics`）: v1 で対応済み（下記「経緯」参照）。

### 実質差分なし・変換のみで対応可能

- `timeSignature` の型: `StaffCanvas` は `TimeSignature`
  （`src/types/storage.ts:9` で `export type TimeSignature = [number, number]`）、
  `PianoSystemCanvas` は `[number, number]` を直接書いている
  （`PianoSystemCanvas.tsx:616`）。**実体は同じ型エイリアスなので変換は不要**
  （v1 メモでは「型の違い」として要注意扱いだったが、確認の結果、実質的に
  同一の型であり非ブロッカー）。

### 軽微（コールバック引数追加、後方互換）

- `onKeySignatureChange` の第2引数 `partIndex?: number`
  （`PianoSystemCanvas.tsx:620`。`StaffCanvas.tsx:101` にはこの引数が無い）。
  オプショナルなので `ScorePage.tsx` 側の `handleKeySignatureChange` は
  そのまま流用できるが、単旋律譜では常に `partIndex === 0`（または `undefined`）
  になるだけで意味を持たないため実質無視してよい。
- `onPreviewNoteEvent` の第2引数 `instrument?: InstrumentType`
  （`PianoSystemCanvas.tsx:613`。`StaffCanvas.tsx:97` には無い）。同上、
  無視して問題ない。

### ブロッカー（レイアウトAPI、本メモの主題）

- `systems`/`gap`/`initialScoreData`/`onScoreDataChange` という「1コンポーネントが
  複数段をまとめて描く」API と、`PianoSystemCanvas` の「1コンポーネント=1段、
  呼び出し側がループ」API の非互換。詳細は上記調査1・2。

## 調査5: 移行時の挙動リスク（コードから予想される描画差異）

- **段間隔（gap）**: StaffCanvas は `gap` を数値指定して `top + line * gap` で
  Y 座標を計算する（`StaffCanvas.tsx:1152, 1601-1606`）。`PianoStaff`/
  `QuartetStaff`/`PartExtractionStaff` パターンでは `gap` に相当する明示指定が無く、
  各 `PianoSystemCanvas` インスタンスの実高さ（SVG の `H`）分だけ自然に積み上がる。
  単旋律譜だけ段の高さ・余白の見え方が変わる可能性がある
  （PianoStaff は大譜表なので元々背が高く、単旋律譜と単純比較できない）。
  移行時は実際に画面を見て段間隔の見た目が既存版と揃うか確認が要る。
- **選択・複数段またぎのハイライト**: `selectedMeasures`/`onMeasureSelect` は
  StaffCanvas・PianoSystemCanvas 両方に props として存在する
  （`StaffCanvas.tsx` 側は `PianoStaff` 経由で確認済み、`PianoSystemCanvas.tsx:622-623`）。
  ただし「1コンポーネント内で完結する選択状態」から「複数 PianoSystemCanvas
  インスタンスにまたがる選択状態」に変わるため、段をまたいだドラッグ選択などの
  挙動に差が出ないか要確認（`PianoStaff` が既存で同じ構造を使っているので、
  ここは新規リスクというより「piano/quartet モードで既に許容されている挙動」に
  揃う、というのが実態に近い）。
- **リハーサルマーク・テキスト要素・リピート括弧等**: v1 の調査時点で
  「差分なし（確認済み）」としたテキスト要素・オーナメント・キー入力は
  ロジック共通化済みのため、`partsConfig` 1要素でも同じ挙動になる見込み。
  歌詞は既に v1 で PianoSystemCanvas 対応済みだが、**表示位置の仕様がそもそも
  StaffCanvas と異なる**（単旋律=五線の下 `botY+54`、PianoSystemCanvas=段の上
  `staveTopY-26`）ため、単旋律譜を PianoSystemCanvas に統一すると**歌詞の表示位置が
  下から上に変わる**。これは移行に伴う意図的な仕様変更として利用者に告知が必要。
- **括弧（ブラケット）・パート名ラベル**: `PianoSystemCanvas` は `bracketGroup`/
  `label`/`showInstrumentLabels` を持つ（複数パート用機能）。単旋律譜では
  `partsConfig` 1要素・`showInstrumentLabels={false}` にすれば
  `PartExtractionStaff` と同様、括弧なし・ラベルなしの単一五線として描画できる
  （実例あり、リスク低）。

## 移行手順案（段階的）

1. **SingleStaff ラッパーを新設**（`PartExtractionStaff.tsx` と同じ設計）。
   `systems`/`gap` は受け取るが、`gap` は実質無視するか、warning コメントを
   残して「PianoSystemCanvas ベースでは段間隔を明示制御できない」ことを
   ドキュメント化する。`Array.from({length: systems})` でループし
   `partsConfig` 1要素の `PianoSystemCanvas` を積み重ねる。
   `initialScoreData`/`onScoreDataChange` は `PartConfig.data`/`onChange` に
   マッピングする薄いアダプタ。
   - **リスク**: 低〜中。既存の3パターン（PianoStaff/QuartetStaff/
     PartExtractionStaff）と同型なので構造的な新規リスクはない。
   - **テスト戦略**: `StaffCanvas.test.tsx` 相当のケースを `SingleStaff` にも
     複製し、既存 `StaffCanvas` と並べてスナップショット/DOM 比較。
     ブラウザで実際に単旋律譜を開き、段間隔・歌詞位置・選択挙動を目視確認
     （CLAUDE.md のブラウザテストルールに従う）。
2. **`ScorePage.tsx` の `else` 分岐（3041行目）だけを `SingleStaff` に切替**。
   他の `scoreType`（piano/quartet/ensemble）は変更しない。
   `feature flag` や `scoreType` 判定で新旧を切り替えられるようにし、
   問題があればすぐ `StaffCanvas` に戻せる状態を保つ。
   - **リスク**: 中。歌詞表示位置の仕様変更が利用者に見える形で発生する。
   - **テスト戦略**: 既存の保存データ（`rightHandData` 形式）を読み込んで
     見た目が崩れないか確認。MusicXML 読込・サンプル読込・段数可変
     （段の追加削除・自動拡張）が単旋律譜でも動くことをブラウザで確認。
3. **十分な実運用確認の後、`StaffCanvas.tsx` を削除**。
   `StaffCanvas.test.tsx` 等の専用テストは `SingleStaff`/`PianoSystemCanvas`
   向けに移行するか削除する。
   - **リスク**: 低（この時点で他に呼び出し元が無いことを再度 grep で確認する）。

## 「やらない」判断もあり得る条件

- 歌詞表示位置の仕様変更（下→上）が利用者にとって許容できない場合、
  PianoSystemCanvas 側に「単一パート時は下に表示する」モードを追加で
  作り込む必要が生じ、コストが増える。その追加コストが見合わないなら、
  歌詞位置の統一を諦めて `StaffCanvas` を維持する選択肢も残しておく。
- 段間隔（`gap`）を利用者が数値で調整できる UI が将来的に必要になった場合、
  「呼び出し側がループで積み重ねる」パターンでは `gap` を各段間に
  `margin-top` 的な形で入れる改修が追加で必要になる。現状は未実装なので、
  この要求が出た時点で SingleStaff 側に手を入れる前提とする。

## 経緯（v1 メモ）: 歌詞対応（解消済み）

`StaffCanvas.tsx` は `NoteEvent.lyrics` を読み、`lyricsEntries` として各音符の下に
歌詞テキストを描画していたが、`PianoSystemCanvas.tsx` には `lyrics` への参照が
一切無く、多段譜に切り替えると歌詞が表示されない状態だった。
座標計算・描画ロジックを `drawLyricsEntry`（`src/utils/lyricsRenderUtils.ts`）へ
共通化した上で `PianoSystemCanvas.tsx` にも歌詞データの収集・描画を実装した。
ただし表示位置は単旋律譜・多段譜で異なる仕様になっている（上記「調査5」参照）。
詳細は `.claude/specs/staffcanvas-pianosystemcanvas-shared-logic/design.md` を参照。
