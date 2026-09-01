# アウフタクト（弱起）の小節に対応する — 設計メモ

対象 Issue: #473「アウフタクト（弱起）の小節に対応する」
この文書は **実装前の設計メモ**（Issue 本文の「設計メモ必須（拍数前提の箇所の洗い出しから）」に対応）。
コードはまだ 1 行も変えていない。実装は §5 の段（フェーズ）ごとに別 PR で進める。

## 0. 用語

- **アウフタクト（弱起・pickup measure）**: 曲頭の「拍が足りない小節」。
  4/4 の曲が 4 分音符 1 つだけの小節から始まる、といった書き方。クラシックでは頻出。
- **小節の容量（capacity）**: この文書で導入する言葉。「その小節が本来何拍ぶん入るか」。
  今のコードは容量＝拍子の拍数（`getMeasureBeats`）で固定されており、そこが弱起と噛み合わない。
- 拍数の単位はこのアプリの既存の約束どおり **4 分音符 = 1 拍**（`getMeasureBeats` のコメント参照）。
  3/8 は 1.5 拍、6/8 は 3 拍になる。

## 1. 目的・背景

現状は「すべての小節が拍子ぶんの長さで埋まる」前提で作られているため、弱起の曲は
先頭を休符で埋めるしかない。小節番号（慣例では弱起を 0 と数え、次の完全小節が 1 小節目）や
MusicXML の `<measure implicit="yes" number="0">` とも食い違う。

Issue #473 のトリアージ相当コメント（2026-08-31・オーナー投稿）で、受入に含めてほしい点が
3 つ挙がっている。本設計はこの 3 点を満たすことをゴールにする。

1. アプリ内で新規作成／後付けで弱起を設定できること
2. 小節番号が弱起を 0 扱いで数えること（弱起の次が 1 小節目）
3. 再生・MusicXML 書き出しの往復で implicit が保存されること

なお同コメントのとおり、**弱起付き MusicXML を読み込むと「表示だけ」は既にできている**
（トルコ行進曲 K.331 冒頭で確認済み）。これは描画側の VexFlow Voice が
`Voice.Mode.SOFT`（拍が足りなくてもエラーにしない）で作られているため
（`src/components/PianoSystemCanvas.tsx:1324`）。つまり「描けるが、アプリとしては
弱起だと理解していない」状態であり、番号・再生・編集・書き出しがすべて完全小節前提のまま。

## 2. 現状（As-Is）— 「拍数前提」の洗い出し

拍数の出どころは 1 か所しかない。

```ts
// src/utils/timeSignatureUtils.ts:36
export function getMeasureBeats(timeSignature: TimeSignature): number {
  const [numerator, denominator] = normalizeTimeSignature(timeSignature);
  return numerator * (4 / denominator);
}
```

ここから先が「小節の容量」として使われている箇所の全リスト。**弱起で壊れる／壊れないの別**まで
書く（壊れないものは、実装時に触らなくてよい根拠になる）。

### 2-1. 描画

| 箇所 | いまの前提 | 弱起でどうなるか |
| --- | --- | --- |
| `PianoSystemCanvas.tsx:2430` `beatsPerMeasure = getMeasureBeats(...)` | 段の中の全小節で共通の 1 値 | **要修正**。ここが「小節ごとの容量」に変わるのが今回の中心 |
| `PianoSystemCanvas.tsx:1167` `computeVoiceDisplayPadding(..., beatsPerMeasure, ...)` | 足りない拍は表示用の休符で埋める | **壊れる**。弱起小節に「見えない残り拍ぶんの休符」が描かれ、弱起に見えない |
| `PianoSystemCanvas.tsx:1324` `new Voice({time:{num_beats, beat_value}})` + `SOFT` モード | 拍が足りなくても描ける | 壊れない（弱起がいま「表示だけはできる」理由） |
| `PianoSystemCanvas.tsx:4898` 小節番号 `number: startMeasureIndex + 1` | 先頭小節＝1 小節目 | **壊れる**（受入 2）。弱起があるときは番号を 1 つ減らし、弱起自身には番号を出さない |
| `measureLayoutUtils.ts` の小節幅見積り | 中身の音価から幅を決める（拍子は見ない） | 壊れない。弱起小節は中身が少ないぶん自然に狭くなる |

### 2-2. 編集

| 箇所 | いまの前提 | 弱起でどうなるか |
| --- | --- | --- |
| `PianoSystemCanvas.tsx:5934` / `:5962` 入力上限 `currentBeats + addBeats > beatsPerMeasure` | 拍子ぶんまで入れられる | **壊れる**。弱起小節に拍子ぶん入ってしまう |
| `measureRestFillUtils.ts:30` `fillPriorMeasureRests(..., beatsPerMeasure, ...)`（呼び出しは `PianoSystemCanvas.tsx:5945` / `:5981` / `:7365` / `:7420`） | 手前の小節を拍子ぶんの休符で「実データとして」埋める | **壊れる・かつ実害が大きい**。2 小節目に音符を置いた瞬間、弱起小節が休符で完全小節に書き換えられて保存される |
| `beatColumnUtils.ts:113` 列クリックの可否判定 | 同上 | **壊れる**（同じ理由） |
| `beatSliceUtils.ts:32,40,59,70,206,325` 拍スライス選択・貼り付け先計算 | 候補拍は `0 〜 beatsPerMeasure` | **壊れる**。弱起小節で存在しない拍が候補に出る／貼り付けがはみ出す |
| `ScorePage.tsx:3331` `handleBeatRangeSelect` / `:3439` `:3528` `:3655` `beatsPerMeasureNow` | 「丸ごと選択」の判定を拍子ぶんで見る | **壊れる**。弱起小節を丸ごと選んでも「一部選択」と判定される |

### 2-3. 再生

| 箇所 | いまの前提 | 弱起でどうなるか |
| --- | --- | --- |
| `ScorePage.tsx:1612` 各小節へ `measureBeats: getMeasureBeats(scoreTimeSignature)` を渡す | 小節は最低でも拍子ぶん進む | **壊れる**。弱起の直後に「足りない拍ぶんの無音」が挟まる |
| `SimpleAudioEngine.ts:416,423` `measureBeats ?? 4` → `measureSeconds` | 同上 | 上流（渡す値）を直せば追随する |
| `playbackPositionUtils.ts:105-110` `measureAdvanceBeats = max(実長, 拍子長)` | 再生位置ハイライトの前進量 | **壊れる**（同じ理由。実音と帯の位置を合わせるために両者は同じ規則である必要がある） |
| `tiePlaybackUtils.ts:113-140` `measureBeatsFloor` | タイの伸ばし計算の下限 | 上流（`ScorePage.tsx:1602`）を直せば追随する |
| `tempoPlaybackUtils.ts:154-162` `measureBeats ?? 4` | 小節ごとの所要時間 | 同上 |
| `midiExport.ts:162-164` `measureStartTick += maxVoiceTicks` | **実際の音価だけで進む** | 壊れない（padding していないため弱起がそのまま正しく出る） |

### 2-4. 入出力

| 箇所 | いまの前提 | 弱起でどうなるか |
| --- | --- | --- |
| `musicXmlExport.ts:606` `measureToXml(m, mi + 1, ...)` → `:529` `<measure number="...">` | 先頭が `number="1"`、`implicit` は書かない | **壊れる**（受入 3）。弱起でも 1 から数え、implicit が落ちる |
| `musicXmlImport.ts:981` `Array.from(partEl.querySelectorAll('measure'))` | 位置だけで読む。`implicit` / `number` 属性は**まったく見ていない**（リポジトリ全体を `implicit` で検索しても 0 件） | **壊れる**（受入 3）。読み込んだ瞬間に弱起の情報が消える |
| `storage.ts:642,733,901,1837` 保存データの検証・正規化 | 拍子は持つが弱起の概念が無い | 追加が必要（§3） |

## 3. データモデルの設計

### 3-1. 採用案: 作品（スコア）単位の `pickupBeats`

`SavedScoreData` に省略可能な項目を 1 つ足す。

```ts
export interface SavedScoreData {
  // ...
  /**
   * 曲頭の弱起（アウフタクト）小節の拍数。4 分音符 = 1 拍の換算で、
   * 「先頭小節（絶対インデックス 0）だけは拍子ぶんではなくこの拍数で数える」ことを表す。
   * 省略時・0・拍子ぶん以上の値は「弱起なし」（＝従来どおり）として扱う。
   */
  pickupBeats?: number;
}
```

**なぜ小節ではなく作品に持たせるか。**
`MeasureData` は**パートごと**に配列を持っている（`PartData.measures`）。小節側に容量を持たせると、
右手だけ弱起で左手は完全小節、という食い違いを型の上で許してしまう。弱起は全パートで同時に成立する
性質のものなので、**構造的にズレようがない置き場所**（作品単位）を選ぶ。
拍子（`timeSignature`）が作品単位とパート小節単位の二段構えになっているのは「曲の途中で変わる」ためで、
弱起にはその必要がない（慣例として曲頭にしか現れない）。

**正規化のルール**（`normalizePickupBeats`）:

- 数値でない・0 以下 → `undefined`（弱起なし）
- 拍子ぶん以上 → `undefined`（それは完全小節であって弱起ではない）
- それ以外は 0.25（16 分音符）刻みへ丸める。表現できない拍数は音価の並びに落とせないため

### 3-2. 唯一の解決関数

容量を求める窓口を 1 つに絞る。既存の `getMeasureBeats` は残し、その上に薄く重ねる
（「同じ目的の実装を 2 枚作らない」＝ AGENTS.md / 運用者方針）。

```ts
// src/utils/pickupMeasureUtils.ts（新設）
export function getMeasureCapacityBeats(
  measureIndex: number,          // 絶対小節インデックス（0 始まり）
  timeSignature: TimeSignature,
  pickupBeats?: number,
): number {
  const normalized = normalizePickupBeats(pickupBeats, timeSignature);
  return measureIndex === 0 && normalized != null ? normalized : getMeasureBeats(timeSignature);
}

/** 画面に出す小節番号。弱起があるとき 1 つずつ繰り下がり、弱起自身は番号なし（null） */
export function getDisplayMeasureNumber(measureIndex: number, hasPickup: boolean): number | null {
  if (!hasPickup) return measureIndex + 1;
  return measureIndex === 0 ? null : measureIndex;
}
```

§2 の表で「壊れる」と書いた箇所は、すべて `beatsPerMeasure` を
`getMeasureCapacityBeats(絶対小節インデックス, ...)` に差し替えることで直る。

### 3-3. 却下した案

| 案 | 却下理由 |
| --- | --- |
| `MeasureData.actualBeats?: number`（小節ごとの容量） | パートごとに小節配列があるため、パート間で値がズレうる。曲中の implicit にも将来対応できる利点はあるが、いま必要な範囲に対して壊れ方が重い |
| 弱起を「拍子の途中変更」で表現（1 小節目だけ 1/4 拍子） | 拍子記号が譜面に描かれてしまう。弱起は拍子を変えずに拍だけ足りない書き方なので意味が違う |
| 弱起小節を「頭を休符で埋めた完全小節」のまま扱い、表示だけ隠す | 小節番号・再生・書き出しのすべてで嘘をつくことになる。現状の回避策そのもの |

## 4. 各領域の修正設計

### 4-1. UI（受入 1）

- 置き場所: ツールバー「楽譜設定」タブの**拍子セレクトの隣**（`ScorePage.tsx:5854` 付近）。
  ここは「楽譜の種類・編成・拍子・調号」＝曲の骨格を決める項目だけを置くタブと決まっており、弱起はその仲間。
- 見た目: `弱起（アウフタクト）` セレクト。選択肢は拍子から算出し、
  `なし` / `♪（0.5拍）` / `♩（1拍）` / `♩.（1.5拍）` / `♩♩（2拍）` … と**拍子ぶん未満まで**。
- 新規作成時: 既定は `なし`（従来どおり）。設定は作品の属性なので保存され、開き直しても保たれる。
- **後付けで弱起にしたとき、先頭小節の中身は勝手に消さない**。容量を超える音符が残る場合は
  「弱起の拍数を超える音符が先頭小節に残っています」と通知するだけにする（削除は行わない）。
  黙って音符を捨てるのは Issue #238 の「無言で消える」事故と同じ形になるため。
  はみ出しぶんは利用者が消す。取り消しは通常どおり Cmd/Ctrl+Z で戻せる。

### 4-2. 小節番号（受入 2）

`PianoSystemCanvas.tsx:4898` の表示条件を `getDisplayMeasureNumber` に置き換える。
弱起があるとき: 弱起小節（index 0）は番号なし、index 1 が「1」。
弱起が無いとき: 従来どおり index 1 が「2」（曲頭は出さない）。
`pickupBeats` は新しい prop として `ScorePage` → 5 つの譜種ラッパー
（`SingleStaff` / `PianoStaff` / `QuartetStaff` / `EnsembleStaff` / `PartExtractionStaff`）→
`PianoSystemCanvas` へ通す。既存の `timeSignature` prop とまったく同じ経路なので、
渡し先は `timeSignature` を grep すれば漏れなく拾える。

### 4-3. MusicXML（受入 3）

**書き出し**（`musicXmlExport.ts`）:

- 弱起ありのとき、小節番号は `mi`（0 始まりのまま）で書く → 先頭が `number="0"`、次が `"1"`。
- 先頭小節にだけ `implicit="yes"` を付ける: `<measure number="0" implicit="yes">`。
- 弱起なしのときの出力は 1 文字も変えない（従来の書き出しとの差分ゼロ）。

**読み込み**（`musicXmlImport.ts`）:

- 先頭 `<measure>` が `implicit="yes"`（または `number="0"`）なら弱起と判定し、
  `pickupBeats` = その小節の**実際の音価合計**（4 分音符 = 1 拍換算）とする。
  MusicXML には「弱起は何拍ぶん」を書く欄が無いので、中身から測るのが唯一の手。
- 2 小節目以降の implicit（volta の途中分割などで現れる）は、**今回は無視**して従来どおり読む。
  §3-1 のデータモデルが曲頭だけを表現するため。§7 に引き継ぐ。

### 4-4. 再生

`ScorePage.tsx:1612` の `measureBeats` を、展開後の小節が**元の何小節目か**
（`item.sourceMeasureIndex`）に応じて `getMeasureCapacityBeats` で決める。
リピート展開後も「元の小節 0」＝弱起なので、`sourceMeasureIndex === 0` で判定できる。
`playbackPositionUtils.ts:110` の `measureAdvanceBeats` も同じ規則へそろえる
（実音と再生位置ハイライトが同じ規則であることは #268 以来の不変条件）。

## 5. 段階的な実装計画と受入テスト草案

各段は独立した PR にする。**その段の受入テストが緑になることが合格基準**。
テストは実装より先に（または同時に）書く。ここに書いたケース一覧が期待値の正本であり、
実装時に期待値を変える場合は「なぜ設計時の期待と違ったか」を PR 本文に書く（黙って書き換えない）。

### 段1: データモデルと解決関数（振る舞い変更なし）

- `pickupMeasureUtils.ts` 新設（`normalizePickupBeats` / `getMeasureCapacityBeats` / `getDisplayMeasureNumber`）
- `SavedScoreData.pickupBeats` 追加、`storage.ts` の検証・正規化・保存の往復

受入テスト草案 `src/utils/pickupMeasureUtils.test.ts`:

1. `normalizePickupBeats(1, [4,4])` → `1`
2. `normalizePickupBeats(4, [4,4])` → `undefined`（拍子ぶんは弱起ではない）
3. `normalizePickupBeats(0, [4,4])` / `(-1, [4,4])` / `('1' as unknown, [4,4])` → `undefined`
4. `normalizePickupBeats(1.3, [4,4])` → `1.25`（0.25 刻みへ丸める）
5. `normalizePickupBeats(1.5, [3,8])` → `undefined`（3/8 = 1.5 拍ちょうどなので弱起にならない）
6. `getMeasureCapacityBeats(0, [4,4], 1)` → `1` / `getMeasureCapacityBeats(1, [4,4], 1)` → `4`
7. `getMeasureCapacityBeats(0, [4,4], undefined)` → `4`（弱起なしは従来どおり）
8. `getDisplayMeasureNumber(0, true)` → `null`、`(1, true)` → `1`、`(1, false)` → `2`

受入テスト草案 `src/utils/storage.test.ts` への追加:

9. `pickupBeats: 1` を持つ保存データを保存 → 読込で `1` が保たれる
10. `pickupBeats` を持たない旧データを読んでも例外にならず `undefined` のまま（後方互換）
11. 不正値（`-1` / `'x'` / `999`）を持つデータを読むと `undefined` に丸められる

### 段2: MusicXML の往復（受入 3）

受入テスト草案 `src/utils/musicXmlPickup.test.ts`:

1. `pickupBeats: 1` の譜面を書き出すと、先頭が `<measure number="0" implicit="yes">` になる
2. 同じ書き出しで 2 小節目が `number="1"` になる
3. 弱起なしの譜面の書き出しに `implicit` が現れない（従来出力と同一）
4. `implicit="yes" number="0"` の小節を持つ MusicXML を読むと `pickupBeats` が中身の拍数で入る
5. 書き出し → 読み込みの往復で `pickupBeats` が保たれる（1 拍・1.5 拍・0.5 拍）
6. 2 小節目以降の implicit は無視され、小節数・中身が従来と変わらない

### 段3: 表示（受入 2）

受入テスト草案 `src/components/PianoSystemCanvasPickupNumber.test.tsx`:

1. 弱起ありの譜面で、2 段目の先頭小節（絶対 index が段あたり小節数ぶん）に出る番号が 1 つ小さい
2. 弱起小節には番号が描かれない
3. 弱起なしのときの番号表示が従来と同じ（退行なし）
4. 弱起小節に「表示用の補完休符」が描かれない（`computeVoiceDisplayPadding` が弱起の容量で呼ばれる）

### 段4: 編集

受入テスト草案 `src/components/PianoSystemCanvasPickupEditing.test.tsx` ほか:

1. 弱起 1 拍の小節に 4 分音符を 1 つ置ける
2. 続けてもう 1 つ置こうとすると入らず、「小節がいっぱい」の通知が出る（黙って無視しない）
3. 2 小節目に音符を置いても、弱起小節が休符で完全小節に埋められない（`fillPriorMeasureRests`）
4. 弱起小節を丸ごと選択すると「一部選択」ではなく「丸ごと選択」に正規化される
5. 完全小節をコピーして弱起小節へ貼ろうとすると、はみ出す貼り付けは拒否され理由が出る

### 段5: 再生

受入テスト草案 `src/utils/pickupPlayback.test.ts`:

1. 弱起 1 拍・4/4 の譜面で、1 小節目の頭が「1 拍後」に鳴る（3 拍ぶんの無音が入らない）
2. 再生位置ハイライトのタイムライン（`buildPlaybackTimeline`）が実音と同じ時刻で進む
3. 弱起をまたぐタイが正しい長さで鳴る
4. 弱起なしの譜面の再生時刻が従来と 1 ms も変わらない（退行なし）

### 段6: UI（受入 1）

受入テスト草案 `src/components/ScorePagePickupControl.test.tsx`:

1. 「楽譜設定」タブに「弱起（アウフタクト）」セレクトがあり、既定が「なし」
2. 4/4 のとき選択肢が 0.5 〜 3.5 拍（拍子ぶん未満）に収まる
3. 選ぶと `pickupBeats` が保存され、再読込後も保たれる
4. 中身のある先頭小節を弱起にすると、通知が出て**音符は消えない**
5. 拍子を弱起の拍数以下へ変えると弱起が自動で解除される（不整合を残さない）

## 6. 影響範囲

**新規**: `src/utils/pickupMeasureUtils.ts`（＋テスト）

**変更（段ごと）**:

- 段1: `src/types/storage.ts`、`src/utils/storage.ts`
- 段2: `src/utils/musicXmlExport.ts`、`src/utils/musicXmlImport.ts`
- 段3: `src/components/PianoSystemCanvas.tsx`、5 つの譜種ラッパー（prop を通すだけ）
- 段4: `src/components/PianoSystemCanvas.tsx`、`src/utils/measureRestFillUtils.ts`、
  `src/utils/beatColumnUtils.ts`、`src/utils/beatSliceUtils.ts`、`src/components/ScorePage.tsx`
- 段5: `src/components/ScorePage.tsx`、`src/utils/playbackPositionUtils.ts`
- 段6: `src/components/ScorePage.tsx`、`src/utils/scoreEditorNotices.ts`（通知文言）

**触らない**: `src/utils/midiExport.ts`（実音価で進むため弱起でも正しい）、
`src/utils/measureLayoutUtils.ts`（小節幅は中身から決まるため）。

**後方互換**: `pickupBeats` は省略可能で、既定は「弱起なし」。既存の保存データ・MusicXML の
読み書き結果は 1 バイトも変わらない（段2 のテスト 3、段5 のテスト 4 で固定する）。

## 7. 未解決点・引き継ぎ

- **曲中の implicit 小節**（volta の途中分割など）は今回のデータモデルでは表現できない。
  読み込み時は無視して従来どおり読む（§4-3）。必要になったら §3-3 の
  `MeasureData.actualBeats` 案を再検討する。
- **リピートと弱起の慣習**: 反復記号で戻るとき、弱起へ戻るのか 1 小節目へ戻るのかは楽譜次第。
  今回は「展開は従来どおり（弱起は 1 回だけ鳴る先頭小節）」とし、慣習対応は別 Issue とする。
- **弱起小節の幅**: 中身が少ないぶん自動で狭くなるが、浄書慣習として「弱起は狭く」で十分かは
  実際の譜面で見て判断する（`.claude/specs/layout-pipeline/design.md` の第一原理に反する
  特別扱いはしない）。
- **段割り**: 弱起は 1 段目の先頭に置かれる前提。段あたり小節数の数え方は変えない。

## 8. 検証（実装時のブラウザ確認手順）

段3 以降の各段で、コミット前に次を実機で確認する（AGENTS.md のブラウザテストルール）。

1. 新規作成 →「楽譜設定」で弱起 1 拍を選ぶ → 先頭小節が狭く、補完休符が出ない
2. 先頭小節に 4 分音符 1 つ、2 小節目に 4 つ入れる → 弱起小節が休符で埋まらない
3. 2 段目の先頭の小節番号が、弱起なしのときより 1 小さい
4. 再生 → 弱起の直後に無音が挟まらない（再生位置の帯が音とそろって進む）
5. MusicXML 書き出し → 読み込み → 弱起のまま戻る
6. コンソールにエラーが出ていない

## 9. 実装記録（2026-09-01・段1〜段6を1つのPRで実装）

§5 の段1〜段6 をまとめて実装した。設計から**変えた点**と、その理由を残す
（設計時の期待を黙って書き換えないための記録）。

### 9-1. 実装したもの

| 段 | 実装 | テスト |
| --- | --- | --- |
| 1 | `src/utils/pickupMeasureUtils.ts`（`normalizePickupBeats` / `hasPickupMeasure` / `getMeasureCapacityBeats` / `getDisplayMeasureNumber` / `buildPickupBeatOptions`）、`SavedScoreData.pickupBeats`、`storage.ts` の検証・正規化・保存 | `pickupMeasureUtils.test.ts` / `pickupMeasureStorage.test.ts` |
| 2 | MusicXML 書き出しの `<measure number="0" implicit="yes">`、読み込みの implicit 判定 | `musicXmlPickup.test.ts` |
| 3 | 小節番号の 0 起点（`getDisplayMeasureNumber`）、表示用補完休符を小節ごとの容量で計算 | `PianoSystemCanvasPickup.test.tsx` |
| 4 | 音符入力の上限・`fillPriorMeasureRests`・拍スライスの選択/コピー/削除/貼り付けを小節ごとの容量へ | `pickupMeasureEditing.test.ts` ＋ 既存のキャンバス試験群 |
| 5 | 再生の `measureBeats`・再生位置タイムライン・タイの小節送りを小節ごとの容量へ | `pickupPlayback.test.ts` |
| 6 | 「楽譜設定」タブの「弱起」セレクト、はみ出し通知、拍子変更時の自動解除 | `pickupMeasureUtils.test.ts`（選択肢）・手動確認 |

中心になったのは「**段に1つの拍数（`beatsPerMeasure`）をやめ、小節ごとの容量
（`capacityBeatsAt(絶対小節インデックス)`）にする**」という置き換えで、
`PianoSystemCanvas` 内の 15 か所がこれに乗り換えた。弱起が無いときは
`getMeasureBeats(拍子)` と同じ値を返すため、既存の譜面の見た目・再生は変わらない。

### 9-2. 設計から変えた点

1. **読み込みは implicit だけでは弱起と決めない**（§4-3 の追加）。
   `implicit="yes"` や `number="0"` が付いていても、中身が拍子ぶん埋まっていれば
   弱起にしない（`normalizePickupBeats` が undefined を返す）。他ソフトが
   「番号0の完全小節」を書いてくる場合の誤検知を避けるため。テストも1件足した。
2. **残り時間の計算（`calculateExpandedPlaybackDurationMs`）には弱起を渡さない**。
   この関数へ渡るのは「実音エンジンへ渡すのと同じ小節オブジェクト」で、
   すでに `measureBeats`（小節ごとの容量）が載っている。引数を増やすより、
   載っている値を読むほうが実音との食い違いが起きない（載っていない旧経路・
   単体テストは従来どおり拍子ぶんで数える）。
3. **`fillPriorMeasureRests` の第3引数は「数値または関数」**にした。
   関数だけにすると既存の呼び出し（テストを含む）が壊れるため、union で受ける。
4. **段4 のクリック経路の受入テストは、純粋関数の単体テストと既存試験群で代替した**。
   `PianoSystemCanvas` のクリック経路は jsdom 上で VexFlow の実座標を要するため、
   入力上限そのものを狙い撃ちする試験は書かず、容量解決（`getMeasureCapacityBeats`）と
   休符補完（`fillPriorMeasureRests`）の単体テスト＋既存キャンバス試験 77 ファイルの
   緑で担保している。**弱起小節での入力上限の実操作確認はレビュー時に見てほしい**。
5. **拍子変更時の自動解除は `useEffect`** で行う（§5 段6 テスト5）。保存・書き出し・
   描画はすべて正規化を通すので表示上は既に弱起なしになるが、状態に古い値が残ると
   拍子を戻したときだけ弱起が復活して分かりにくいため。

### 9-3. この実装で触っていないもの（§7 の引き継ぎのまま）

- 曲中の implicit 小節（volta の途中分割など）
- リピートで弱起へ戻る／1小節目へ戻るの書き分け
- 弱起小節の幅の特別扱い（中身が少ないぶん自動で狭くなるのみ）

### 9-4. ブラウザでの確認結果（2026-09-01・夜間worktree版のプレビュー経由）

単旋律の新規譜面で §8 の手順を実施し、次を確認した（コンソールエラーなし）。

- 「楽譜設定」タブに「弱起」セレクトが出て、4/4 では 0.5〜3.5 拍が並ぶ。選ぶと
  「弱起を1拍にしました（先頭小節は1拍まで入り、小節番号は次の小節から1になります）」と出る
- 弱起1拍の先頭小節に 4分音符を1つ置くと、**余りの拍を埋める表示用の休符が出ない**
  （弱起なしに戻すと従来どおり休符が出る＝退行なし）
- そこへもう1つ置こうとすると入らず、「この小節は拍がいっぱいで置けません」と出る
- 2小節目に音符を置いても、**先頭小節は保存データ上も4分音符1つのまま**
  （`fillPriorMeasureRests` が弱起を完全小節へ書き換えない）
- 小節番号は、弱起の段には出ず、次の段が「1」・その次が「2」
- 自動保存データに `pickupBeats: 1` が入り、読み直しでも保たれる

なお「先頭の段が1小節だけになる」のは弱起とは無関係の既存挙動（内容のある最後の小節で
段を打ち切る `breakAt`）で、弱起なしでも同じになることを確認済み。
