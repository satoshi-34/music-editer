# アウフタクト（弱起・不完全小節）対応 — 設計メモ

対応 Issue: #473「アウフタクト（弱起）の小節に対応する」

> **このメモの状態: 設計 + 実装（PR #538 で段1〜段5をまとめて実装。2026-09-01）。**
> 実装の詳細・設計との差分は §7「実装の記録」を参照。
> Issue 本文に「設計メモ必須（拍数前提の箇所の洗い出しから）」とあるため、
> まず §1 の洗い出しとデータモデルの決定（§2・§3）を確定させてから実装した。
> §4 の段1〜段5 は当初「段ごとに別 PR」の計画だったが、実際は1つの PR にまとめた（§7-1）。
> 各段の受入テストは §4 に列挙してあり、実装後のテストファイルとの対応は §7-1 の表にある。
>
> 仕様の正本は Issue #473 のオーナーコメント（2026-08-31）とする。そこで求められている
> 受入は次の3点:
> 1. アプリ内で新規作成/後付けで弱起を設定できること
> 2. 小節番号が弱起を 0 扱いで数えないこと
> 3. 再生・MusicXML 書き出しの往復で implicit が保存されること

---

## 0. 用語

- **弱起（アウフタクト / pickup / anacrusis）**: 曲頭に置かれる、拍子より短い不完全小節。
- **小節の容量（capacity）**: この設計で導入する言葉。「その小節が本来何拍ぶんか」。
  従来は常に `getMeasureBeats(拍子)` と同じだったが、弱起小節ではそれより短くなる。
- **拍**: このアプリ内では一貫して「4分音符 = 1拍」（`getMeasureBeats` の定義。3/8 は 1.5 拍）。

---

## 1. 現状の洗い出し: 「全小節が拍子どおりの拍数を持つ」前提はどこにあるか

Issue が求めている「拍数前提の箇所の洗い出し」。`getMeasureBeats(拍子)` 由来の値
（画面側は `beatsPerMeasure`、再生側は `measureBeats`）が**小節によらず一定**として
使われている箇所を、役割ごとに整理する。行番号は 2026-09-01 時点の `origin/main`
（`1ac636c`）のもの。

### A. 表示: 足りない拍を休符で埋める（弱起がいちばん壊れる箇所）

| 場所 | 何を仮定しているか |
| --- | --- |
| `src/components/PianoSystemCanvas.tsx:2425` | `const beatsPerMeasure = getMeasureBeats(normalizedTimeSignature)` — 段に描くすべての小節で共通の1つの値 |
| `src/components/PianoSystemCanvas.tsx:1162` | `computeVoiceDisplayPadding(rawSourceEvents, beatsPerMeasure, ...)` で、足りない拍を**表示専用の休符**で埋める |
| `src/utils/voiceMeasureUtils.ts:421` | `computeVoiceDisplayPadding` 本体 |

弱起小節（例: 4/4 の曲頭に4分音符1つ）は、ここで残り3拍ぶんの休符が描かれてしまう。
「先頭を休符で埋めるしかない」という Issue の現状記述は、まさにこの挙動を指している。

### B. 入力: 小節に入る上限と、手前の小節の自動休符補完

| 場所 | 何を仮定しているか |
| --- | --- |
| `src/components/PianoSystemCanvas.tsx:5909` / `:5937` | `currentBeats + addBeats > beatsPerMeasure` で「これ以上入らない」を判定 |
| `src/components/PianoSystemCanvas.tsx:4000` | `beatsLimit = latestRef.current.beatsPerMeasure`（ドラッグ等の上限） |
| `src/components/PianoSystemCanvas.tsx:5920` / `:5956` / `:7340` / `:7395` | `fillPriorMeasureRests(next, absI, beatsPerMeasure, clefHere)` |
| `src/utils/measureRestFillUtils.ts:29` | `fillPriorMeasureRests` 本体。**手前の全小節**を拍子ぶんへ休符で埋める |

弱起では (1) 曲頭小節の上限が弱起の拍数でなければならず、(2) 第2小節以降を編集したときに
`fillPriorMeasureRests` が弱起小節を4拍へ「補完」して壊してしまう。**B は A と並ぶ最重要点**。

### C. 拍スライス（範囲選択・コピー・削除・貼り付け）

| 場所 | 何を仮定しているか |
| --- | --- |
| `src/components/PianoSystemCanvas.tsx:5993` / `:6021` / `:6029` / `:6041` / `:6043` / `:6258`–`:6262` | 小節の左右端 ↔ 拍位置の相互変換をすべて `beatsPerMeasure` で行う |
| `src/components/ScorePage.tsx:3326`（`handleBeatRangeSelect`） | 「丸ごと選択」の判定 `sel.endBeat >= beats - 0.0001` |
| `src/components/ScorePage.tsx:3434` / `:3523` / `:3650` | スライスのコピー・削除・貼り付けで `beatsPerMeasureNow` を小節共通で使用 |
| `src/utils/beatSliceUtils.ts:32` / `:40` / `:59` / `:72` / `:206` | 候補境界に必ず `beatsPerMeasure` を含める |

弱起小節では「小節末＝拍子ぶんの拍」ではなくなるため、右端をクリックしても丸ごと選択に
ならない・貼り付け位置がずれる、といった形で表面化する。

### D. 小節番号

| 場所 | 現状 |
| --- | --- |
| `src/components/PianoSystemCanvas.tsx:4875`–`:4881` | 段の先頭小節・最上段にだけ `number: startMeasureIndex + 1` を描く。`startMeasureIndex === 0`（曲頭）は非表示 |

番号は**絶対インデックス+1**で決め打ちなので、弱起を 0 扱いにする余地が無い。
表示の実装は `PianoSystemCanvas` の1か所だけで、全譜種がここを通る
（`.claude/specs/measure-numbers/design.md` §1）ため、直す場所も1か所で済む。

### E. 再生

| 場所 | 何を仮定しているか |
| --- | --- |
| `src/components/ScorePage.tsx:1607` | 各小節へ `measureBeats: getMeasureBeats(scoreTimeSignature)` を**グローバル拍子固定**で載せる |
| `src/components/ScorePage.tsx:1597` | `buildTiePlaybackPlan(..., getMeasureBeats(scoreTimeSignature))`（タイの小節またぎ計算） |
| `src/audio/SimpleAudioEngine.ts:416`・`:423`・`:427`・`:515` | `currentTime = Math.max(maxMeasureEndTime, measureStartTime + measureSeconds)` — 内容が短くても拍子ぶんまで送る |
| `src/audio/SoundFontEngine.ts:178`–`:185`・`:271` | 同じ規則（パートごとに `partTime` を送る） |
| `src/utils/playbackPositionUtils.ts:110` | `measureAdvanceBeats = max(実長, getMeasureBeats(拍子))` — ハイライトの前進も同じ規則 |

つまり**弱起小節も4拍ぶん鳴らした扱いで次へ進む**（無音が3拍入る）。ここを直さないと
「弱起で再生すると曲全体が1小節ぶん遅れる」形になる。

なお `src/audio/ScorePlayer.ts:415`–`:470` は小節内容の実長で進める別実装だが、
現在の再生経路は `ScorePage:1661` の `audioEngine.playParts(...)` であり、
`ScorePlayer.generatePlaybackSchedule` は再生に使われていない（型 `PlaybackPosition` だけ
参照されている）。**修正対象は SimpleAudioEngine / SoundFontEngine の側**。

### F. MusicXML 入出力

| 場所 | 現状 |
| --- | --- |
| `src/utils/musicXmlExport.ts:389` | `<measure number="${measureNum}">` — 常に1始まりの通し番号。`implicit` 属性は出さない |
| `src/utils/musicXmlImport.ts:498`（`buildStaffMeasures`） | `<measure>` の `number` / `implicit` 属性を**一切読んでいない**。要素の並び順だけで小節を作る |

読み込みは「音符の並びどおり」なので、弱起付きファイルでも**見た目は出る**
（Issue のオーナーコメントの K.331 の実測どおり）。ただし弱起の情報は失われるため、
A（表示休符での穴埋め）・B・E の症状がそのまま出る。

### G. レイアウト（小節幅）

- `src/utils/measureLayoutUtils.ts:689` と `src/components/PianoSystemCanvas.tsx:1319`–`:1325` は
  VexFlow の `Voice` を拍子で作るが、いずれも `voice.setMode(Voice.Mode.SOFT)` を呼んでいるため
  **拍の合計が拍子と一致しなくてもエラーにならない**。幅は内容から見積もる実装なので、
  弱起小節は自然に狭く描かれる（浄書の慣習どおり）。
- **結論: G は弱起対応で変更不要**。段割り（`.claude/specs/layout-pipeline/design.md` の第一原理）にも
  抵触しない。弱起で幅が変わることによる段割りの変化は「結果」であって、上書きしない。

---

## 2. データモデル

### 2-1. 選択肢

| 案 | 内容 | 評価 |
| --- | --- | --- |
| A | `SavedScoreData.pickupBeats?: number`（曲全体で1つ、曲頭専用） | 最小。ただし MusicXML の implicit は曲中にも現れる（新しい節の頭など）ので、読み込みで落ちる情報が残る |
| B | `MeasureData.pickupBeats?: number`（小節ごと） | 曲頭も曲中も同じ規則で扱える。解決関数が「小節インデックス→容量」の1本で済む |
| C | `implicit?: boolean` と `actualBeats?: number` の2フィールド | MusicXML と1対1だが、「implicit なのに拍子ぶんの長さ」など矛盾する組み合わせを作れてしまう |

**採用は B**。理由:
- 1フィールドで「番号を数えない」と「容量が短い」の両方を表すので、矛盾する状態を作れない（C の欠点を回避）。
- 曲中の implicit 小節も同じ道具で表現できるため、読み込みで情報を落とさない（A の欠点を回避）。
- 既存の小節単位メタ（`timeSignature` / `bpm` / `keySignature` / `clef` / `rehearsalMark`）と
  **同じ場所・同じ書き方**に揃うので、保存・検証・オーバーレイ UI の既存経路をそのまま共用できる（§4 段5）。

```ts
// src/types/storage.ts の MeasureData へ追加
/**
 * この小節を「不完全小節（弱起・アウフタクト）」として扱い、その実拍数を持つ。
 * 4分音符 = 1拍（timeSignatureUtils の getMeasureBeats と同じ単位）。
 * 省略時は「拍子どおりの完全小節」。MusicXML の <measure implicit="yes"> に対応する。
 */
pickupBeats?: number;
```

### 2-2. 不変条件

1. `pickupBeats` は有限の正の数で、その小節に有効な拍子の拍数**未満**。
   （拍子と同じかそれ以上なら不完全小節ではないので、正規化で `undefined` に落とす）
2. 正本は**パート0の小節**。`timeSignature` / `keySignature` と同じ扱い
   （`PianoSystemCanvas.tsx:6154`・`:6164` の読み取り規約に合わせる）。
   書き込みは既存の「全パートへ同じ値を書く」経路に合わせ、パートごとに違う値を持たせない。
3. 旧データ（`pickupBeats` なし）は従来どおりの完全小節。**保存形式のバージョンは上げない**
   （省略時の意味が現行と一致するため。`pageSize` / `notationSizeMultiplier` と同じ考え方）。

### 2-3. 保存・検証

- `src/utils/storage.ts:397` の `validateMeasureData` に
  `(measure.pickupBeats === undefined || (typeof measure.pickupBeats === 'number' && Number.isFinite(...) && > 0))` を追加する。
  壊れた値を通すと容量が `NaN` になり、休符補完・拍スライスが黙って壊れる（既存フィールドと同じ方針で「弾く」）。
- 既定値（＝完全小節）のときはフィールドごと書き出さない。

---

## 3. 解決ユーティリティ（新規 `src/utils/measureCapacityUtils.ts`）

前提の置き換えを1か所に集約する。**呼び出し側が `getMeasureBeats(拍子)` を直に使うのをやめ、
この関数を通す**のがこの設計の中心。

```ts
/**
 * その小節が本来何拍ぶんか（4分音符=1拍）。
 * 弱起（pickupBeats 指定）ならその値、それ以外はその小節時点で有効な拍子ぶん。
 * 「その小節時点で有効な拍子」は、手前の小節の timeSignature を引き継ぐ既存規則
 * （ScorePlayer / musicXmlExport と同じ）で解決する。
 */
export function resolveMeasureCapacityBeats(
  measures: MeasureData[],
  measureIndex: number,
  globalTimeSignature: TimeSignature,
): number;

/**
 * 表示用の小節番号。弱起小節は 0、その次の完全小節が 1 になる（浄書の慣習）。
 * 返り値 0 の小節は番号を描かない（曲頭を描かない既存ルールと同じ扱い）。
 */
export function getDisplayedMeasureNumber(
  measures: MeasureData[],
  measureIndex: number,
): number;
```

- **既存実装の共用**: 「小節時点で有効な拍子」を引き継ぐループは
  `src/audio/ScorePlayer.ts:424`・`src/utils/musicXmlExport.ts:472`・
  `src/utils/playbackPositionUtils.ts:63` に3回書かれている。今回は同じ規則の4枚目を書かず、
  この util の内部ヘルパー（`resolveTimeSignatureAtMeasure`）へ集約し、
  段3・段4で既存3か所もこれを使う形へ寄せる。
  （「同じロジックの2枚目」を作らない方針: #223 → #280 の再発防止）
- **`PianoSystemCanvas` は段（システム）単位で描く**ため、段の先頭の絶対インデックス
  `startMeasureIndex` と段内オフセット `i` から絶対インデックスを作って渡す。
  段の途中で容量が変わり得るので、`beatsPerMeasure` を**コンポーネント先頭で1つ**作る
  現行の形（`:2425`）はやめ、小節ごとに解決した値を使う。

---

## 4. 実装計画（段分け）と受入テスト草案

各段は独立した PR にする。**実装段の合格基準は、その段の受入テストが緑になること**。
設計時に書いたテストの期待値を実装時に変える場合は、「なぜ設計時の期待と違ったか」を
その PR 本文に書く。

### 段1: データ土台（型・検証・解決ユーティリティ）

やること: §2 の型追加・`storage.ts` の検証・§3 の `measureCapacityUtils.ts` 新設。画面の挙動は変えない。

受入テスト `src/utils/measureCapacityUtils.test.ts`:
- `pickupBeats` の無い小節の容量は、グローバル拍子ぶん（4/4 → 4、3/8 → 1.5）になる
- `pickupBeats: 1` の小節の容量は 1 になる
- 途中拍子変更（`timeSignature: [3,4]`）のある小節以降の容量は 3 になり、その手前は 4 のまま
- 弱起が曲頭にある譜面の表示番号は `[0, 1, 2, ...]`
- 弱起の無い譜面の表示番号は `[1, 2, 3, ...]`（現行と同じ）
- 曲中に弱起がある譜面でも、弱起は 0 ではなく**その手前までの通し番号を進めない**
  （＝弱起の次の小節が、弱起の手前の小節の番号 +1 になる。慣習に合わせる）

受入テスト `src/utils/storage.test.ts` への追加:
- `pickupBeats: 1` を含む保存データが読み込める / 書き出しで往復する
- `pickupBeats: 0` / 負値 / 文字列 / `NaN` を含むデータは無効として弾かれる
- `pickupBeats` の無い旧データが従来どおり読める（後方互換）

### 段2: 表示と入力（弱起小節が「短いまま」描け、編集で壊れない）

やること: §1 A・B・C・D を `resolveMeasureCapacityBeats` / `getDisplayedMeasureNumber` へ置換。
`fillPriorMeasureRests` は「その小節の容量まで」埋めるようシグネチャを
`beatsPerMeasure: number` → `capacityOf: (measureIndex: number) => number` へ変える。

受入テスト:
- `src/components/PianoSystemCanvasPickupMeasure.test.tsx`（新規）
  - 4/4・`pickupBeats: 1`・4分音符1つの曲頭小節を描くと、**補完休符が描かれない**
    （既存 `PianoSystemCanvasPaddingRest.test.tsx` と同じ観測方法＝描画された休符の数で見る）
  - 同じ小節に4分音符をもう1つ入れようとしても入らない（容量1拍の上限が効く）
  - 第2小節へ音符を入れても、曲頭の弱起小節に休符が足されない（`fillPriorMeasureRests` の回帰）
- `src/components/PianoSystemCanvasMeasureNumber.test.tsx`（既存へ追加）
  - 弱起のある譜面では、2小節目の段頭に描かれる番号が `1` になる（現行は `2`）
  - 弱起の無い譜面では現行どおり（回帰）
- `src/utils/measureRestFillUtils.test.ts`（新規または既存へ追加）
  - `pickupBeats: 1` の小節は1拍ぶんで「充填済み」と見なされ、休符が足されない

### 段3: 再生（弱起小節を実拍数で送る）

やること: `ScorePage.tsx:1607` の `measureBeats` を小節ごとの容量へ。
`playbackPositionUtils.ts:110` の `measureAdvanceBeats` も同じ規則へ。
エンジン側（`SimpleAudioEngine` / `SoundFontEngine`）は `measureBeats` を受け取る作りなので**変更不要**。

受入テスト:
- `src/utils/playbackPositionUtils.test.ts`（既存へ追加）
  - 弱起1拍＋4/4 の譜面で、2小節目の先頭のタイムライン時刻が「1拍ぶん」後になる（現行は4拍ぶん）
- `src/components/ScorePagePickupPlayback.test.tsx`（新規）
  - `playParts` へ渡る `measures[0].measureBeats` が 1 になる（既存の再生系テストと同じくエンジンをスパイして観測）
- 副産物として、途中拍子変更（3/8 など）でも `measureBeats` が小節ごとに正しくなる。
  **これは弱起とは別の既存不具合の修正**なので、段3の PR 本文に明記する（§6）。

### 段4: MusicXML 往復

やること:
- 書き出し: `pickupBeats` のある小節へ `implicit="yes"` を付け、`number` を §3 の表示番号
  （弱起=0）で出す。
- 読み込み: `<measure implicit="yes">`（または `number="0"`）の小節を弱起として取り込み、
  `pickupBeats` にその小節の実長（`duration` 合計 / `divisions`）を入れる。
  `implicit` 属性が無くても `number="0"` があれば弱起として扱う（書き出し側の実装差の吸収）。

受入テスト `src/utils/musicXmlPickup.test.ts`（新規）:
- 弱起1拍の譜面を書き出すと、先頭が `<measure number="0" implicit="yes">`、次が `number="1"`
- `implicit="yes"` を持つ MusicXML を読み込むと `measures[0].pickupBeats === 1`
- 書き出し→読み込みの往復で `pickupBeats` が保存される（Issue の受入3）
- 弱起の無い譜面の書き出しは現行と1文字も変わらない（回帰）

### 段5: UI（弱起を設定する操作）

やること: 既存の「小節メタのオーバーレイ」経路を**そのまま共用**する。
`PianoSystemCanvas.tsx:6144`–`:6160` の `measureTempo` / `measureTimeSig` と同じ形で
ツール種別 `measurePickup` を足し、入力のパースは `src/utils/measureMetaInputUtils.ts` に
`parsePickupBeatsInput` を追加する（既存の `parseBpmInput` / `parseTimeSignatureInput` と同じ書き方）。
値の書き込みは既存の「全パートへ書く」経路を使う。

- 入力は「弱起の長さ」を音価（4分・8分・付点4分 …）で選ばせる形にする。
  拍数の生入力（`1.5` など）は、初学者向けという本リポジトリの方針に合わないため採らない。
- 空欄／解除で `pickupBeats` を消す（＝通常の小節へ戻す）。既存オーバーレイの「解除」と同じ。
- Issue 本文は「小節追加まわりの UI に置くのが自然か」としているが、
  **後付けで曲頭小節を弱起にできること**がオーナーコメントの受入1に含まれるため、
  小節メタのオーバーレイ（既に「この小節の拍子/テンポ/調号を変える」が並んでいる場所）を主とする。

受入テスト:
- `src/utils/measureMetaInputUtils.test.ts`（既存へ追加）: 音価文字列 → 拍数のパース、無効値は `undefined`
- `src/components/ScorePagePickupTool.test.tsx`（新規）: ツールで曲頭小節をクリック→音価を選ぶと、
  パート全部の `measures[0].pickupBeats` が同じ値になる
- ブラウザ確認（AGENTS.md のブラウザテストルール）: 新規作成→曲頭を弱起1拍→音符を1つ入れる→
  補完休符が出ないこと・2小節目の番号が 1 になること・再生が詰まらないことをスクリーンショットで確認

---

## 5. 影響範囲と非スコープ

**影響範囲（段2以降で触るファイル）**
- `src/types/storage.ts` / `src/utils/storage.ts`（型・検証）
- `src/utils/measureCapacityUtils.ts`（新規）/ `src/utils/measureRestFillUtils.ts` / `src/utils/beatSliceUtils.ts`
- `src/components/PianoSystemCanvas.tsx`（表示・入力・番号・スライス）
- `src/components/ScorePage.tsx`（スライス操作・再生へ渡す値）
- `src/utils/playbackPositionUtils.ts` / `src/utils/musicXmlImport.ts` / `src/utils/musicXmlExport.ts`
- `src/utils/measureMetaInputUtils.ts`（段5）

**非スコープ（この Issue では触らない）**
- 段割り・ページ配分（§1 G のとおり変更不要。`layout-pipeline` の第一原理を上書きしない）
- 繰り返しの「弱起へ戻る」記譜（1番括弧の途中で終わる形など、いわゆる開いた反復）
- 曲末の不完全小節（弱起と合わせて1小節にする慣習）。データ上は同じ `pickupBeats` で表せるが、
  番号の数え方が別ルールになるため、必要になったら別 Issue で扱う
- MIDI 書き出し（`src/utils/midiExport.ts:198`）。弱起の扱いは段3 の後で別途確認する

---

## 6. 弱起とは別に見つかった既存の食い違い（記録）

1. **途中拍子変更が実音の小節長へ反映されない**
   `src/components/ScorePage.tsx:1607` は `measureBeats` にグローバル拍子の値を固定で渡すため、
   `MeasureData.timeSignature` で 4/4 → 3/4 と変えても、内容が拍子より短い小節は
   4拍ぶん待ってから次へ進む。段3で `resolveMeasureCapacityBeats` に置き換えると同時に解消する。
2. **同じ「有効な拍子の引き継ぎ」ループが3か所にある**
   `ScorePlayer.ts:424` / `musicXmlExport.ts:472` / `playbackPositionUtils.ts:63`。
   §3 のとおり段3・段4 で集約する。集約前にどれか1つだけ直すと、片方に修正が届かない
   （#223 → #280 と同じ事故の形）。
3. **`src/audio/ScorePlayer.ts` は再生に使われていない**
   `generatePlaybackSchedule` は現在どこからも呼ばれておらず（型 `PlaybackPosition` だけが参照されている）、
   小節の送り方も現行エンジン（`max(実長, 拍子ぶん)`）と違う（実長のみ）。
   弱起対応では触らないが、放置すると「直したつもりで直っていない」の温床になるため、
   撤去または現行規則への追従を #244（構造的な歪みの記録先）へ回す。


---

## 7. 実装の記録（PR #538・2026-09-01）

### 7-1. 実装の範囲と段分けの扱い

§4 は段1〜段5をそれぞれ別 PR にする計画だったが、実際は **1つの PR で段1〜段5をまとめて**
実装した。理由: 段1（データ土台）だけでは画面の挙動が何も変わらず、レビューで
「弱起が使えるか」を確かめられないため。受入テストは §4 の段ごとの草案をそのまま
ファイル単位で対応させてある（下表）。

| 段 | 受入テスト（実装後のファイル名） |
| --- | --- |
| 段1 | `src/utils/measureCapacityUtils.test.ts` / `src/utils/pickupMeasureStorage.test.ts` |
| 段2 | `src/components/PianoSystemCanvasPickup.test.tsx` / `src/utils/measureRestFillPickup.test.ts` |
| 段3 | `src/utils/pickupPlayback.test.ts` |
| 段4 | `src/utils/musicXmlPickup.test.ts` |
| 段5 | `src/components/ScorePagePickupWiring.test.tsx`（実マウントの配線テスト） |

### 7-2. 設計時の期待と変えたところ（理由つき）

1. **`normalizePickupBeats` は値を丸めない**
   最初の実装（案A・差し戻し版）は 0.25 拍刻みへ丸めていたが、連符（1/3 拍・0.125 拍など）を
   含む譜面の弱起を読み込みだけで壊す。#534 が保証した連符の厳密性を守るため、
   「正の有限数・その小節の拍子未満」だけを条件にし、値はそのまま保つ。
2. **検証（`validateSavedScoreData`）で不変条件1を弾く**
   §2-3 は「型が違うものを弾く」までとしていたが、0・負数・拍子ぶん以上も**無効なデータとして弾く**
   （`validateMeasureData` で正の有限数、`hasValidPickupBeats` でその小節の拍子未満）。
   容量が壊れた値のまま通ると、休符補完・拍スライスが黙って壊れるため。
   これに伴い、**拍子を変えて成り立たなくなった弱起は ScorePage の effect が小節データから外す**
   （残すと保存データが検証で弾かれ、次に開けなくなる）。
3. **`getDisplayedMeasureNumber` は 0 を「番号を出さない小節」として返す**
   §3 の予定どおり。呼び出し側（`PianoSystemCanvas`）は 0 のときだけ描画を省く。
4. **UI（段5）はツール種別 `measurePickup` のオーバーレイ**
   §4 段5 の予定どおり、小節メタのオーバーレイ（途中拍子変更・途中テンポ変更と同じ場所）へ
   `measurePickup` を追加した。入力は音価の呼び名つきセレクト（`buildPickupBeatOptions`）で、
   「（解除）」で普通の小節へ戻せる。値の書き込みは既存の「全パートへ同じ値を書く」経路
   （`handleTimeSigConfirm` と同じ形）を共用する。
   なお `measureMetaInputUtils.parsePickupBeatsInput` は作らなかった: 入力がセレクト（数値の文字列）で、
   パースは `normalizePickupBeats` 1本で足りるため（同じ判定の2枚目を作らない方針）。

### 7-3. 実装した窓口（§3 の集約結果）

`src/utils/measureCapacityUtils.ts`:

| 関数 | 役割 |
| --- | --- |
| `resolveTimeSignatureAtMeasure` | その小節で有効な拍子（途中拍子変更の引き継ぎ）。§3 の「3か所に散っていたループ」の集約先 |
| `normalizePickupBeats` | 弱起の拍数の正規化（不変条件1。丸めない） |
| `resolveMeasureCapacityBeats` | その小節の容量（弱起ならその拍数、それ以外は拍子ぶん） |
| `getPickupBeats` / `isPickupMeasure` | その小節が弱起か・何拍か |
| `getDisplayedMeasureNumber` | 表示・書き出し用の小節番号（弱起は 0） |
| `buildPickupBeatOptions` | UI の選択肢（0.5 拍刻み・拍子未満） |

置き換えた呼び出し側:
- `PianoSystemCanvas`: 段に1つだった `beatsPerMeasure` を `capacityBeatsAt(絶対小節インデックス)` へ。
  表示用の補完休符・入力上限・自動休符補完・拍スライスの端・小節番号がすべてここを通る。
- `ScorePage`: 拍スライス（コピー/削除/貼り付け）と再生へ渡す `measureBeats`・タイの小節送り。
- `playbackPositionUtils`: ハイライトの前進。副産物として **途中拍子変更が実音の小節長へ
  反映されない既存不具合（§6-1）も解消**した（`pickupPlayback.test.ts` に回帰テストあり）。
- `musicXmlExport` / `musicXmlImport`: `implicit="yes"` の読み書き（曲頭・曲中とも）。
- `measureRestFillUtils.fillPriorMeasureRests`: 第3引数が `number | (measureIndex) => number` になった
  （数値を渡す従来の呼び出しは挙動そのまま）。

### 7-4. 残っている非スコープ

§5 の非スコープはそのまま。加えて:
- `src/audio/ScorePlayer.ts` の未使用実装（§6-3）は今回も触っていない。#244 へ回す。
- MIDI 書き出し（`src/utils/midiExport.ts`）は弱起を見ていない。別 Issue。
