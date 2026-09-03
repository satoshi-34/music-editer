# 設計書: 速度標語（テンポ表記）と再生テンポの連動（Issue #458）

## 出典・背景

弟フィードバック 2回（2026-08-28 対面・2026-08-31 又聞き）:
「入力したテンポで再生されるようにしたい」「調整しなくてもテンポの記号通りに再生してほしい」。

#457 で速度標語（Andante・Allegro 等）はプリセット候補から入力できるようになったが、
**表示専用**で再生には一切影響していなかった。

## 問題

### 1. 標語が再生テンポに効かない（本 Issue の主題）

`tempoMarking` は音符イベント（`NoteEvent.tempoMarking`）に付く文字列で、描画経路
（`PianoSystemCanvas` の `tempoMarkingEntries`）しか読んでいなかった。

### 2. 前提の誤り: 数値の途中テンポ変更も「再生では鳴っていなかった」

Issue 本文は「途中テンポ変更（BPM 数値）は再生に反映済み（ScorePlayer が measure.bpm で切替）」を
前提にしていたが、**実装を確認したところ事実と異なっていた**。

- `ScorePlayer.generatePlaybackSchedule` は確かに `measure.bpm` で BPM を切り替えるが、
  **`ScorePlayer` クラスは再生経路として使われていない**（`PlaybackPosition` 型だけが
  `PlaybackControls` / `PlaybackHighlight` から import されている）
- 実際の再生は `ScorePage` → `createPlaybackEngine()` → `PlaybackEngine.playParts(parts, bpm)` で、
  **BPM は引数1つ＝曲全体で固定**だった（`SoundFontEngine` / `SimpleAudioEngine` とも
  ループ内で引数 `bpm` を直接使う）
- ハイライトの `buildPlaybackPositionTimeline` と終了タイマーの
  `calculateExpandedPlaybackDurationMs` も、単一の `bpm` から `msPerBeat` を1回だけ求めていた
- `measure.bpm` を読んでいたのは実質 **MusicXML 書き出し・MIDI 書き出し・（死んでいる）ScorePlayer** だけ

つまり「♩=XXX を小節に置くと譜面には出るが、再生テンポは変わらない」状態だった。
標語を BPM へ翻訳するだけでは音は1ミリも変わらないため、
**小節ごとのテンポを再生経路へ通す配管まで含めて**本 Issue の修正範囲とする。

## 修正設計

### 1. 標語 → 目安 BPM の対応表は `tempoMarkingPresets.ts` に一本化

トリアージ指示「対応表は #457 のプリセット定義側に持たせ、二重定義しない」に従う。

```ts
export const TEMPO_MARKING_PRESET_ENTRIES = [
  { term: 'Grave', bpm: 40 }, ... { term: 'Prestissimo', bpm: 200 },
] as const;
// 候補リスト（datalist）用の文字列配列は、この表から**導出**する
export const TEMPO_MARKING_PRESETS = TEMPO_MARKING_PRESET_ENTRIES.map((entry) => entry.term);
```

`TEMPO_MARKING_PRESETS` の並び（遅い→速い）と要素は #457 から変えていないので、
入力欄・datalist 側の挙動は不変。BPM 値は慣用的なテンポ範囲の代表値を採用した
（例: Andante ♩=76、Allegro ♩=132）。全値が `tempoRange.ts` の 30〜240 に収まることは
テストで固定する（範囲外の目安値を足すと再生時に無言でクランプされてしまうため）。

### 2. 「小節ごとの実効テンポ」を1つの純粋関数で決める（`tempoPlaybackUtils.ts` 新設）

```ts
resolveMeasureBpms(measures: MeasureData[], globalBpm: number): number[]
```

先頭から走査し、各小節の実効 BPM を決めて配列で返す（**同じ規則を実音・ハイライト・
終了タイマーの3か所が共有する**ための正本。ここを分けると「音は速いのにハイライトは遅い」が起きる）。

優先順位（Issue 本文・トリアージのとおり）:

1. `measure.bpm`（数値の途中テンポ変更）… **最優先**。明示指定が勝つ
2. その小節に置かれた**対応表にある**速度標語 → 目安 BPM
3. どちらも無ければ**直前の小節のテンポを引き継ぐ**（最初は全体テンポ `globalBpm`）

補足仕様:

- 標語の照合は **前後の空白を落とした大文字小文字無視の完全一致**。
  `andante` / ` Andante ` は効き、`Allegro con brio` のような自由入力は**表示のみ**で
  テンポを変えない（トリアージ裁定。#318 の通知は挙動が変わる場面がないため不要）
- 標語は**全声部**を走査して最初の1つを採る。声部2に置いた標語が効かないと
  「同じ機能の2枚目実装」に見える食い違いになるため（#280 の教訓）
- 壊れた保存データ（`bpm: 0` や NaN）は `clampBpm` で弾き、直前のテンポを維持する。
  0 が素通りすると `60 / 0 = Infinity` で再生が停止不能になる
- **`♩=120` のような数値をテンポ表記の文字として書いた場合は対象外**（表示のみ）。
  数値指定には専用 UI（小節の途中テンポ変更＝`measure.bpm`）があり、そちらが正本

### 3. 再生経路へ「小節ごとの BPM」を通す

- `PlaybackEngine` の `PlaybackPart.measures[]` に `bpm?: number` を追加（型として明示）
- `ScorePage` は**リピート展開後・途中再生で切る前の全列**で `resolveMeasureBpms` を解決し、
  各小節オブジェクトへ `bpm` を載せて渡す。強弱（`resolveDynamicVelocities`）と同じ理由で、
  切る前に解決しないと「開始位置より前に置いた標語」が失われる
- `SoundFontEngine` / `SimpleAudioEngine` は小節ループの先頭で
  `const measureBpm = measure.bpm ?? bpm` を求め、その小節の秒換算すべてに使う
  （引数 `bpm` は「小節指定が無いときの既定」として従来どおり機能する＝後方互換）
- `buildPlaybackPositionTimeline`（ハイライト）と `calculateExpandedPlaybackDurationMs`
  （終了タイマー）も同じ規則で小節ごとに `msPerBeat` を求める

### 4. 受入テスト（実装はこれを緑にすることが合格基準）

`src/utils/tempoPlaybackUtils.test.ts`
1. 標語を置いた小節からテンポが切り替わり、以降の小節も引き継ぐ
2. 同じ小節に数値の途中テンポ変更があれば**数値が勝つ**
3. 対応表にない自由入力（`Allegro con brio`）は無視され、直前のテンポが続く
4. 大文字小文字・前後空白の揺れを吸収する（` andante ` → 76）
5. 声部2に置いた標語も効く
6. 異常な `bpm`（0 / NaN）は無視して直前のテンポを維持する
7. プリセットの全 BPM が `MIN_BPM`〜`MAX_BPM` に収まる（二重定義・範囲逸脱の検出）

`src/utils/playbackPositionUtilsTempo.test.ts`
8. 標語で速くなった小節以降は、ハイライト時刻が同じ比率で早まる
9. 終了タイマー（`calculateExpandedPlaybackDurationMs`）も小節ごとの BPM で数える

`src/audio/SoundFontEngine.test.ts`（実装時の変更: 新規ファイルではなく既存ファイルへ追記した。
偽 player を差し込む足場 `setupEngineWithFakePlayer` がタイ再生テストにすでにあり、
2枚目を作るより共用するほうが良いため。足場は両方から使えるようモジュール直下へ引き上げた）
10. `measure.bpm` が付いた小節は、その小節の音の予約時刻・長さがその BPM で決まる
11. `bpm` が付いた小節は、次の小節の開始位置もその速さで進む
12. `bpm` の無い小節は引数の既定 BPM のまま（後方互換）

`src/components/ScorePageTempoMarkingPlayback.test.tsx`（配線）
13. 実経路（作品を復元 → 再生ボタン）で `playParts` へ渡る小節に、標語から解決された
    `bpm` が乗っている（純粋関数だけのテストでは配線の削除を検出できないため）
14. 同じ小節に数値の途中テンポ変更があれば数値が勝つ／対応表にない自由入力では変わらない

### 実装時に設計を直した点

- 設計時は壊れた `bpm` を `clampBpm(measure.bpm, currentBpm)` で弾くつもりだったが、
  受入テスト6（`bpm: 0`）が落ちて誤りが判明した。`clampBpm` は**有限な数をすべて範囲へ寄せる**ため
  `0` は「無視」ではなく `MIN_BPM = 30` になってしまう。
  そこで「採用できる値か（有限かつ正）」を判定する `isUsableBpm` を先に通し、
  弾いた場合は直前のテンポを維持するようにした（設計時の意図どおりの挙動）

## 影響範囲

| ファイル | 変更内容 |
| --- | --- |
| `src/utils/tempoMarkingPresets.ts` | 目安 BPM 付きの表を正本化し、既存の文字列配列を導出に変更 |
| `src/utils/tempoPlaybackUtils.ts` | **新規**。小節ごとの実効 BPM を決める純粋関数 |
| `src/audio/PlaybackEngine.ts` | `PlaybackPart.measures[].bpm?: number` を追加 |
| `src/audio/SoundFontEngine.ts` | 小節ごとの BPM で秒換算（既定は引数 `bpm`） |
| `src/audio/SimpleAudioEngine.ts` | 同上 |
| `src/utils/playbackPositionUtils.ts` | ハイライト・終了タイマーを小節ごとの BPM で計算 |
| `src/components/ScorePage.tsx` | 解決した BPM を各小節へ載せて再生エンジンへ渡す |

### 副作用として直るもの

**数値の途中テンポ変更（♩=XXX）が、初めて実際の再生に反映される。**
これは本 Issue の「数値が優先」という仕様を成立させるための前提でもある
（両方が鳴らないと優先順位に意味が無い）。譜面に途中テンポ変更を置いていた既存データは、
今回から**その指定どおりの速さで鳴るようになる**（今までは全体テンポで一定だった）。

### 触っていないもの

- `ScorePlayer`（再生経路として使われていない死んだ実装）は今回も触っていない。
  ここに3枚目のテンポ解決を書くと乖離が増えるだけなので、`resolveMeasureBpms` の
  適用対象からは外した。整理は #244 の構造課題として別途
- MusicXML / MIDI 書き出しは `measure.bpm` のみを見る従来どおりの挙動
  （標語からの目安 BPM を書き出しへ混ぜると、出力ファイルに存在しないテンポ指定が
  紛れ込むため。必要になったら別 Issue で裁定する）

## 追記（round 2/3 対応・2026-08-31）

- **テンポはスコア共通の属性（round1/2 P1・P2）**: 解決は `resolveScoreMeasureBpms` が
  **絞り込み前の全段**（tempoSourceParts: quartet 全段 / ensemble 全段+大譜表2段目 /
  piano 両手 / single）を先頭パートの反復順で展開して1回だけ行い、全パートへ配布する。
  パート譜表示（選択パートのみ再生）でも他段の数値テンポ・標語を引き継ぐ
- **ハイライトとの共有（round2 P1）**: `buildPlaybackPositionTimeline` は
  `sharedMeasureBpms` 引数で実音側と同じ列を受け取る（省略時は従来解決の後方互換）。
  内部で先頭パートから再解決すると、他段だけの標語がハイライトに効かず累積ズレする
- **テンポ変更をまたぐタイ（round1 P2）**: 実時間は `beatSpanToSeconds` が
  小節ごとのテンポ区間で積算する。区間列は `tempoSegmentsFrom`（tempoPlaybackUtils に
  1本化・両エンジンで共用）が作り、bpm 未設定小節は **fallbackBpm=呼び出し時点の
  実効テンポ**から引き継ぐ（固定120だと全体テンポ≠120で常にずれる・round2 P2）
- テスト: 両エンジンの「60→120またぎ=1.5秒」「全体60・省略=2.0秒」、
  ScorePage 配線「左手だけの Allegro が両パートに効く」、共有列優先のタイムライン、
  tempoSegmentsFrom のフォールバック、を追加

## 追記: MusicXML へのテンポ書き出し（Issue #518・2026-09-01）

### 問題

アプリで ♩=126 に設定した作品を MusicXML 書き出し → 読み込みすると 120 で鳴る、という
運用者QA（実ファイルで確定）。書き出したファイルを調べると **`<sound tempo>` / `<metronome>` が
1つも入っていない**ことが原因で、読み込み側は無罪だった。

理由は保存データの構造にある。**全体テンポ（再生パネルの ♩=N）は `SavedScoreData` に無い**
（`TempoManager` の再生設定側にある）ため、`scoreToMusicXml(data)` は全体テンポを知る手段が
そもそも無かった。書き出していたのは `measure.bpm`（小節ごとの数値テンポ変更）だけで、
指定が1つも無い普通の作品は「テンポの記述がまったく無いファイル」になっていた。

### 修正設計

1. **全体テンポを呼び出し側から渡す**: `scoreToMusicXml(data, { globalBpm })` /
   `downloadMusicXml(data, filename, { globalBpm })` の任意オプションを追加し、
   `ScorePage` の書き出しハンドラが `tempoSettings.bpm` を渡す。
   保存データ（`SavedScoreData`）にテンポを生やす案は採らなかった: 保存形式の意味が
   変わる（＝作品の属性なのか再生設定なのかの裁定が要る）うえ、書き出しの問題を直すのに
   保存形式を変える必要が無いため。
2. **先頭小節にだけ全体テンポを出す**: 出力条件を
   `measure.bpm ?? (先頭小節なら globalBpm)` に変えた。小節ごとの数値テンポ変更がある小節は
   従来どおりそれを出すので、**その小節では全体テンポより measure.bpm が優先**される
   （画面・再生の優先順位と同じ）。
3. **速度標語も書き出す**: `<direction-type><words>Andante</words></direction-type>` に加えて、
   対応表（`tempoMarkingPresets`）で引ける語には目安 BPM を `<sound tempo="76"/>` として併記する。
   対応表に無い自由入力（`Allegro con brio` など）は `<words>` だけを出す
   （画面の扱い＝「表示だけ・速さは変えない」と同じ規則）。
4. **読み込み側**: `<words>` を小節内で全部走査し、**対応表にある最初の語だけ** `tempoMarking`
   として取り込む（発想標語 dolce の後に Andante があっても拾える）。付ける音符の位置は、
   その direction より手前の主声部音符数（`<chord/>`・`<grace>` 除外）から復元する
   （五線分割された大譜表は合成休符でインデックスがずれるため先頭固定のまま）。
   標語の direction に併記した `<sound>` は「標語の目安 BPM」なので `measure.bpm` へは入れない
   （入れると数値優先の規則により、以後標語を書き替えても再生が変わらなくなる）。
   リハーサルマークと同じ理由で、五線で分けた譜では1番目の五線ぶんだけ拾う（両手への二重付与を防ぐ）。
5. **全体テンポの往復（#518 round3 で確定した方式）**: 「全体テンポ」と「先頭小節の数値テンポ変更」
   は小節側の XML 要素構成が同一で区別できないため、**正本をアプリ固有メタ**
   `<miscellaneous-field name="music-editer.global-bpm">`（#422 の time-signature-style と同じ置き場）
   に記録する。読み込みは:
   - メタあり: メタを `MusicXmlImportResult.globalBpm` として返し、ScorePage が再生パネル
     （`setBPM`）へ反映。先頭小節の `<sound>` 由来 bpm は、由来メタ
     `music-editer.first-measure-bpm-explicit` で「明示」と記録されて**いない**パートの
     メタ一致値だけ取り除く。値の一致だけで消すと「全体120+明示120+標語」で明示側が消え、
     実効テンポが標語へ反転する（round4 P1）。
     - 由来メタの値は「明示の数値変更を持つパートの番号リスト」（0始まり・カンマ区切り・
       **part-list 順**。`<part>` 本体の文書順ではない・round6 P2）。読み込みは `<part id>` を
       part-list の `score-part` 順で引いて照合し、五線分割（大譜表）で1つの `<part>` から
       2つの PartData ができる場合は両方へ同じ番号を割り当てる。
     - 旧形式の値 `true`（全パート一律の保持）も後方互換で受理する。
     - 番号リストの不正トークンの扱い: 値全体が `true` のときだけ旧形式。それ以外は
       カンマ区切りの各トークンのうち**完全な数値だけ**を採用し、非数値トークンは無視する
       （リストが部分的に壊れていても、読める番号ぶんの明示保持は生かす）。パート数の範囲外の
       番号はどのパートとも照合されず無害。part-list と本文の `<part id>` が完全対応
       （**件数一致・両側それぞれの id 一意性・双方向の集合一致**）しない不正ファイル
       （余分な score-part・重複 id・引けない id 等）では、番号の混在を避けるため
       **全パートを文書順**で番号付けする。
     - メタが不正値（数値でない・0以下・400超）のときは外部ファイル扱いへ落とさず
       読み替え自体を行わない（round4 P2）。
   - メタなし（外部ファイル）: 全パートで値が一致し、かつ対応表の標語より**前**（文書順）に
     書かれた先頭小節の単独 `<sound>` を全体テンポとみなす。標語より後の `<sound>` は
     外部プレーヤーで標語を上書きして鳴るため、数値変更として保持する。
   並び順で符号化する案（数値を標語の直後に出す）は、標語が小節途中にあると数値の発火位置まで
   遅れて動くため round3 で棄却した。

### 上の「触っていないもの」からの方針変更（記録）

このファイルの #458 の節には「MusicXML / MIDI 書き出しは `measure.bpm` のみを見る従来どおりの挙動
（標語からの目安 BPM を書き出しへ混ぜると、出力ファイルに存在しないテンポ指定が紛れ込むため。
**必要になったら別 Issue で裁定する**）」と書いてあった。#518 がその「別 Issue」にあたり、
仕様として「速度標語は `<words>` ＋対応表の目安 BPM を `sound tempo` で併記」と明記されたため、
**この方針は #518 で置き換わった**（黙って上書きしたのではなく、予告どおりの裁定である）。

### 影響範囲

- `src/utils/musicXmlExport.ts`: `MusicXmlExportOptions` 追加、テンポ direction の出力条件、
  `tempoMarkingDirectionXml` 追加
- `src/utils/musicXmlImport.ts`: `<words>` → `tempoMarking` の取り込み
- `src/components/ScorePage.tsx`: 書き出しへ `globalBpm` を渡す
- MIDI 書き出し（`midiExport.ts`）は今回も対象外（`data.timeSignature` と `measure.bpm` を見る従来のまま）

### 残っている食い違い（解消済みの記録）

当初「読み込み直後、再生は 126 になるがパネル表示は既定値のまま」という食い違いを残していたが、
round1〜3 のレビューで上記 §5 の方式（メタを正本に globalBpm を別枠で返し、ScorePage が
`setBPM` へ反映）に発展し、パネル表示まで含めて往復するようになった。

## 追記: 全体テンポを作品ごとの属性にする（Issue #543・2026-09-02）

### 問題

運用者QA（2026-09-01）: ♩=112 で作った作品（トルコ行進曲）を開き直したら、テンポ欄に
無関係な 40（過去にアプリ全体へ設定した値）が出た。

原因は保存の置き場である。全体テンポ（再生パネルの ♩=N）は `TempoManager` が
localStorage の **`music-app-tempo-settings` にアプリ全体で1つだけ**持っており、作品を
切り替えても引き継がれる。#518 で MusicXML の**新規取り込み**時はファイルのテンポが
反映されるようになったが、「保存済み作品を開く」経路には作品のテンポという概念自体が無かった。

### #518 の方針変更（正式な更新・Issue 仕様 5）

上の #518 の節には「保存データ（`SavedScoreData`）にテンポを生やす案は採らなかった:
保存形式の意味が変わる（＝作品の属性なのか再生設定なのかの裁定が要る）うえ、書き出しの
問題を直すのに保存形式を変える必要が無いため」と書いてある。その**裁定が本 Issue で
「作品の属性である」と下りた**ため、この方針は #543 で置き換わる（黙って上書きしたのでは
なく、#518 が保留した論点の決着である）。#518 の書き出し方式（呼び出し側から `globalBpm`
を渡す）は変えていない。

### 修正設計

1. **`SavedScoreData.globalBpm?: number`**（作品ごとの全体テンポ）を追加する。位置づけは
   用紙サイズ（#495）・音符の大きさ（#477）と同じ「作品の属性」。旧データ互換のため省略可。
2. **正規化は1関数に集約**: `src/audio/tempoRange.ts` の `normalizeSavedGlobalBpm(value)`。
   数値でない・NaN・0 以下は `undefined`（＝テンポ未保存）を返し、有限な数は `clampBpm` で
   30〜240 へ寄せる。0 を素通しすると `60 / 0 = Infinity` で再生が進まなくなるため、
   clamp の前に弾く必要がある（`tempoPlaybackUtils` の `isUsableBpm` と同じ理由）。
3. **保存は「渡されたら常に明示」**（#477 round1 P1 と同じ判断）。既定値（120）と同じときに
   項目を省略すると、読込側の既定（＝アプリ全体設定に従う）と食い違い、「全体設定が 40 の
   環境で 120 の作品を開くと 40 になる」穴がそのまま残る。
4. **読込は3経路とも同じヘルパを通す**: `ScorePage` の `applySavedGlobalBpm(data)` を
   起動時の復元・作品一覧からの切替（`applyLoadedScoreData`）・ファイル読み込み
   （`handleImportFile`）から呼ぶ。1つでも当て忘れると「その作品だけ前のテンポで鳴る」
   食い違いになるため、声部1/声部2の二重実装と同じ轍を踏まないよう関数を共用する。
   **テンポ未保存（旧データ）のときは何もしない**のが正しい後方互換で、従来どおり
   アプリ全体設定（無ければ 120）のまま開く（Issue 仕様 4）。
5. **自動保存の依存配列に `tempoSettings.bpm` を足す**。これが無いと、再生パネルで
   テンポだけ変えて閉じたときに作品側へ保存されず、開き直すと元へ戻る（Issue #107・#117 と
   同じ「依存漏れ＝編集内容の消失」）。
6. **MusicXML 取り込みの `globalBpm`（#518）は追加配線なしでこの作品テンポに入る**
   （Issue 仕様 3）: 取り込みハンドラは従来どおり `setBPM(importedGlobalBpm)` を呼び、
   その後の自動保存が `tempoSettings.bpm` を作品へ書く。

### 判断メモ: アプリ全体設定（`music-app-tempo-settings`）は残す

Issue 仕様 2 は「アプリ全体設定は『新規作成時の既定値』としてのみ残す」。本実装では
`TempoManager.setBPM` が従来どおり localStorage へも書く（＝全体設定は「最後に使ったテンポ」に
なる）。役割は**新規作成した作品とテンポ未保存の旧作品の初期値**に縮んでおり、Issue の訴え
（保存済み作品を開くと無関係な値が出る）は解消する。`setBPM` から永続化を外す案は、
`TempoManager` の意味（再生設定の永続化クラス）と既存テスト一式を作り替える必要があり、
受入条件のどれにも必要ないため採らなかった。

なお、テンポ未保存の旧作品は「開いた時点で画面に出ているテンポ」がそのまま自動保存で
`globalBpm` として書き込まれ、以後はその作品のテンポになる（＝初回編集時に移行する）。

### 影響範囲

- `src/types/storage.ts`: `SavedScoreData.globalBpm` 追加
- `src/audio/tempoRange.ts`: `normalizeSavedGlobalBpm` / `DEFAULT_GLOBAL_BPM` 追加
- `src/utils/storage.ts`: `createSavedScoreData` の末尾引数 `globalBpm`、
  `validateSavedScoreData` の型チェック（他の省略可能項目と同じ方針で型違いのみ弾く）
- `src/components/ScorePage.tsx`: 保存4経路への引き渡し、`applySavedGlobalBpm`、自動保存の依存配列
- テスト: `src/audio/tempoRange.test.ts`（正規化）、`src/utils/storage.test.ts`（保存往復・互換）、
  `src/components/ScorePagePerScoreTempo.test.tsx`（作品を交互に開く実操作。受入1・3）
- MIDI 書き出し（`midiExport.ts`）・MusicXML 書き出しの方式は変更なし（受入2の回帰は
  `musicXmlTempo.test.ts` と `ScorePageTempoExportWiring.test.tsx` が担保）

## 追記: 再生パネルの BPM 欄を「再生速度（%）」中心へ転換する（Issue #544・2026-09-02）

### 問題

#516 / #458 で譜面のテンポ指定（♩=N・速度標語）が再生に効くようになり、#543 で全体テンポが
作品ごとの属性になった結果、再生パネルの「テンポ ♩=N」欄の役割は
**「譜面に指定が無い部分の基準値」**まで縮んだ。にもかかわらず表示は「テンポ」のままで、
譜面に書いたテンポと二重管理に見える（#543 の「無関係の数字」事案の再発しやすい形）。

一方で「速いパッセージをゆっくり聴いて確かめたい」という需要はテンポ欄では満たせない。
テンポ欄を下げると譜面のテンポが変わり、**書き出したファイルの曲そのものが遅くなる**ためである。

### 修正設計

**役割を「テンポは譜面・速度は聴き方」で分ける。**

1. **再生速度（%）を新設**（25〜200%・既定 100%）。パネルではテンポ欄の**上**に置き、
   速さを変えたいときにまず触る場所が「聴き方」の側になるようにした。
2. **作品の基準テンポは同じパネルに残す**（Issue 仕様 2 の「同パネル内の別欄」）。
   ラベルを「テンポ」→「**作品の基準テンポ**」に変え、「作品ごとに保存される」「譜面に
   ♩=N や速度標語を書いた小節はそちらが優先される」という位置づけを欄の下に添えた。
   欄そのものを楽譜設定側へ移す案は、#543 で作品属性になったばかりの値の編集場所を
   もう一度動かすことになり、受入条件のどれにも必要ないため採らなかった。
3. **倍率は「共有テンポ列へ1回だけ掛ける」**（Issue 仕様 4）。`ScorePage.handlePlay` で
   `resolveScoreMeasureBpms` が解決した列（＝譜面本来のテンポ列）に
   `applyPlaybackSpeedToBpms` を通し、以降の実音・ハイライト・終了タイマー・タイの実時間は
   すべてこの倍率込みの列と実効テンポ（`effectiveGlobalBpm`）だけを見る。
   全小節へ同じ倍率が掛かるので、標語が作る小節間の相対関係（120 : 132）は保たれる。
   掛ける場所を分けると「音は半分の速さなのにハイライトは元の速さ」が起きる（#458 と同じ轍）。
4. **100% は完全な等倍**にする。`applyPlaybackSpeedToBpm` は 100% のとき掛け算を通さず
   元の値をそのまま返す。掛け算を通すと 132 が `132.00000000000003` になり得て、
   「速度を触っていないのに従来と少し違う再生になる」回帰を生むため（受入3）。
5. **保存先はアプリ全体設定**（Issue 仕様 3）。`PlaybackSoundRuntimeSettings.playbackSpeedPercent`
   として `playback-sound-runtime-settings` に持つ。作品側（`SavedScoreData`）には保存しない
   ＝**書き出し・拍計算には一切影響しない**。書き出しは従来どおり `tempoSettings.bpm` を渡す
   経路のままで、再生速度はその経路に触れていない（受入2）。

### 判断メモ: タイの実時間だけ `clampBpm` では足りない

`beatSpanToSeconds`（タイの秒数積算）は壊れた値対策に `clampBpm`（30〜240）を通していた。
これは**譜面に書けるテンポ**の範囲なので、再生速度を掛けたあとの実効テンポには狭すぎる
（♩=40 を 50% で聴くと 20 → 30 に丸められ、タイだけ元の速さで数えられてしまう）。
`src/audio/playbackSpeed.ts` に `clampEffectiveBpm`（倍率込みの範囲＝7.5〜480）を置き、
`beatSpanToSeconds` の2か所をこちらへ差し替えた。100% では解決済みテンポ列が必ず
30〜240 に収まっているため、この差し替えによる既存挙動の変化は無い。

### 影響範囲

- `src/audio/playbackSpeed.ts`（新設）: 範囲定数・`clampPlaybackSpeedPercent` /
  `normalizeSavedPlaybackSpeedPercent` / `applyPlaybackSpeedToBpm(s)` / `clampEffectiveBpm`
- `src/audio/playbackSettings.ts`: `playbackSpeedPercent` の追加と正規化
- `src/utils/tempoPlaybackUtils.ts`: `beatSpanToSeconds` の clamp を `clampEffectiveBpm` へ
- `src/components/PlaybackControls.tsx` / `src/App.css`: 再生速度スライダー・等倍に戻すボタン、
  テンポ欄のラベル変更と説明文
- `src/components/ScorePage.tsx`: `playbackSpeedPercent` の保持、`handlePlay` の倍率適用（4か所）、
  `handlePlaybackSpeedPercentChange`
- テスト: `src/audio/playbackSpeed.test.ts`（純粋関数）、
  `src/components/ScorePagePlaybackSpeed.test.tsx`（受入1〜4の実操作配線）

## 追記: 再生速度（%）の取り下げ（Issue #588・2026-09-03）

### 経緯

#544 で入れた再生速度（%）は、**一度もリリースされないまま撤去**した。
運用者裁定（2026-09-03）は「テンポのみでいいや。再生速度変えるニーズなさそう」で、
昇格前に外せば利用者には露出しないため、機能として畳む判断になった。

### 何を消して、何を残したか

| | 扱い | 理由 |
| --- | --- | --- |
| 再生速度スライダー・「等倍に戻す」ボタン・説明文（`PlaybackControls`） | **撤去** | 操作口を残すと「消したはずの設定」が画面に生き残る |
| `PlaybackControls` の `onPlaybackSpeedPercentChange` prop と2つのハンドラ | **撤去** | 上と対 |
| `PlaybackSoundRuntimeSettings.playbackSpeedPercent` と正規化 | **撤去** | 設定として持たない。古い保存データに残っていても `sanitizePlaybackRuntimeSettings` が「知っている項目だけを詰め直す」形なので自動的に捨てられる |
| `ScorePage` の `handlePlaybackSpeedPercentChange` | **撤去** | 変更する口が無くなったため |
| `src/audio/playbackSpeed.ts`（`applyPlaybackSpeedToBpm(s)` / `clampEffectiveBpm` ほか） | **残す** | Issue 仕様3。#544 round1 で直した終了タイマー・タイ・ペダルの整合はそれ自体が正しく、将来の復活の土台にもなる |
| `resolveEffectiveMeasureBpms` / `beatSpanToSeconds` の実効テンポ系 | **残す** | 同上。`clampEffectiveBpm` は今も再生経路で使われている |

`ScorePage` 側は**入口1か所を等倍に固定する最小差分**にした
（`const playbackSpeedPercent = DEFAULT_PLAYBACK_SPEED_PERCENT;`）。
`handlePlay` の4か所の呼び出しはそのままなので、倍率を掛ける経路の形は保たれ、
実際に流れる値は #544 以前と完全に同じ（`applyPlaybackSpeedToBpm` は 100% のとき
掛け算を通さず元の値を返すため、浮動小数の誤差も入らない）。

### `normalizeSavedPlaybackSpeedPercent` について

localStorage 用の正規化関数だけは、設定項目が無くなったことで**呼び出し元が無くなった**。
`playbackSpeed.ts` を「復活の土台」として丸ごと残す方針（Issue 仕様3）に合わせてこれも残し、
`playbackSpeed.test.ts` の該当テストもそのままにしてある。
消す場合は速度の復活が無いと確定してからにしたい。

### テストの引き継ぎ

`ScorePagePlaybackSpeed.test.tsx` は**ファイル名を変えずに書き換えた**（#544 の配線テストが
どう変わったかを履歴で追えるようにするため）。5件 → 2件になり、観点は次のように移した:

| #544 のケース | #588 での扱い |
| --- | --- |
| 既定（100%）では従来と同一のテンポで鳴る | **残す**（速度 UI が無い状態で 120 / 132 / 基準120 を固定） |
| 50% で半分・標語の相対関係を保つ | 撤去（操作口が無い） |
| 実効テンポが 30BPM を割っても丸め直されない | 撤去。同じ観点は `playbackPositionUtils.test.ts` の実効テンポ非丸めテストと `playbackSpeed.test.ts` が単体で持っている |
| 速度は再読込後も保持・作品の保存データへ混入しない | **形を変えて残す**（旧 `playbackSpeedPercent` を仕込んだ localStorage から起動しても 120 のまま鳴り、保存し直した設定に旧フィールドが残らない） |
| 速度は書き出した MusicXML に影響しない | 撤去（速度が無いので混入元が無い。書き出しのテンポは `ScorePageTempoExportWiring.test.tsx` が担保） |

### 影響範囲

- `src/components/PlaybackControls.tsx` / `src/App.css`: 速度 UI と専用スタイルの撤去
- `src/components/ScorePage.tsx`: 等倍固定・ハンドラと prop 受け渡しの撤去
- `src/audio/playbackSettings.ts`: `playbackSpeedPercent` の撤去（旧データは無視される）
- `src/audio/playbackSpeed.ts`: 冒頭に「現状は常に等倍」の但し書き
- テスト: `src/components/ScorePagePlaybackSpeed.test.tsx`（上表）
- 文書: `docs/REGRESSION.md` X 節、`README.md`、
  `.claude/specs/toolbar-organization/design.md`（§3(c) の並びから速度欄を除去・Issue 仕様5）
