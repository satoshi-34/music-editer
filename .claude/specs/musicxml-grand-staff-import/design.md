# MusicXML 読込: 1パート複数五線（ピアノ大譜表）の振り分け

対象 Issue: #419
対象ファイル: `src/utils/musicXmlImport.ts` / テスト `src/utils/musicXmlGrandStaff.test.ts`

## 問題

MusicXML のピアノ譜は、慣習として **1つの `<part>` に `<staves>2</staves>` を宣言し、
各音符が `<staff>1</staff>` / `<staff>2</staff>` で上下どちらの五線かを名乗る**形で書かれる。
Finale・MuseScore の書き出しも、OMR ツール（oemer 等）の出力もこの形になる。

一方 `parseMusicXml` には `<staves>` / `<staff>` の処理が一切なく、
1つの `<part>` = 1つの `PartData` として全音符を1本の五線へ平坦化していた。
結果、ピアノ譜を読み込むと**左手の低音が右手の五線に混ざり、加線だらけの単旋律譜**になる。

Finale ユーザーの既存曲の移行経路（Finale → MusicXML → 本アプリ）が
ピアノ曲で実質使えない状態だったため、見た目の不具合より優先度が高いと判断した。

## 修正設計

### 1. `<part>` を五線ごとに分割する

`readStaffCount(partEl)` が `<attributes><staves>` を読む。

- `staves` が無い（＝従来の「1パート1五線」）→ `staffNumber = null` で**これまでとまったく同じ経路**を通す
- `staves >= 2` → 五線1..N それぞれについて `PartData` を1つ作る（上限 `MAX_STAVES_PER_PART = 4`）

「従来形式は分岐に入らない」構造にしてあるので、既存の
「パートごとに `<part>` を分ける」形式（このアプリ自身の書き出し）は回帰しない。

### 2. 五線ごとの小節組み立て（`buildStaffMeasures`）

もとは `parseMusicXml` 内のインラインだった小節組み立てを関数へ切り出し、
`staffNumber` を受け取れるようにした。`staffNumber` が指定されたときの差分は3点だけ:

1. **要素のふるい分け**: `<measure>` 直下の `note` / `direction` のうち、
   その五線に属さないものを落とす（`staffNumberOf`。`<staff>` 省略時は五線1）。
   `<backup>`（時間の巻き戻し）や `<attributes>` は五線に属さないので残す
   → `<backup>` による区間分割はそのまま機能する
2. **空区間の除去**: ふるい分けの結果、音符が1つも残らなかった区間（＝別の五線ぶんの区間）を捨てる。
   残すと空の声部が増えてしまう
3. **声部番号の振り直し**: MusicXML の `<voice>` は五線をまたいだ通し番号になる慣習があり、
   ピアノ譜では右手が 1・2、**左手が 5・6** になる。五線ごとに小さい順で 1 から振り直して、
   アプリの「声部1・声部2…」に対応させる

### 3. 音部記号（`clefForStaff`）

複数五線の `<attributes>` は `<clef number="1">`（ト音）・`<clef number="2">`（ヘ音）のように
`number` 属性で五線を指す。該当する `<clef>` を選び、無ければ最初の `<clef>` を使う。
読込側（`ScorePage` の読込ハンドラ）は piano/single の譜面を **clef で右手/左手に振り分ける**ため、
ここが正しく treble/bass になることが「右手・左手に分かれて見える」ための実質的な条件になる。

### 4. partId（`staffPartId`）

- 単独パートの大譜表（＝ピアノ譜）→ `'right-hand'` / `'left-hand'`（保存データの慣習に合わせる）
- 編成譜のパート内2段目 → 既存の `ensembleSecondStaffPartId()` を再利用して `${partId}::2`
  （同じ目的の実装を2枚に増やさないため、utils をそのまま使う）
- 3段目以降 → `${partId}::N`

### 5. 練習番号の二重付与を防ぐ

`rehearsalMark` / repeat / テンポ / 拍子・調号変更は `<measure>` 単位の情報で、
`measureEl.querySelector(...)` で直接引いている（ふるい分け後の子要素リストではない）。
このうち**練習番号だけは段に1つ**なので、五線で分けたときは1番目の五線ぶんだけ拾う。
repeat・テンポ・拍子・調号は、このアプリがピアノ譜を保存するときも両手に同じ値を持つため、
両方の五線に入れるのが保存データと整合する。

## 影響範囲

- `parseMusicXml` の戻り値の形は変わらない（`PartData[]` が増えるだけ）
- `scoreType` の推定（`parts.length === 2 → 'piano'`）は既存のまま。
  1part×2staves を分割すると結果が2パートになるので、自動的に `'piano'` になる
- 既存の MusicXML テスト（clef / dots / hairpin / key / microtone / ornament / rehearsal /
  tuplet / voice2 / symphonyRoundtrip / moonlightRegressionLoad）はすべて緑のまま

## 受入テスト（`src/utils/musicXmlGrandStaff.test.ts`）

| ケース | 期待 |
| --- | --- |
| `<staves>2` の part | パートが2つ・`right-hand` / `left-hand`・treble / bass・`scoreType: 'piano'` |
| `<staff>` ごとの振り分け | 左手の低音が右手側に混ざらない |
| 左手の `<voice>` が 5・6 | 五線ごとに 1・2 へ振り直され `voice-1` / `voice-2` になる |
| 練習番号 | 1番目の五線だけに付く（両手に二重に付かない） |
| `<voice>` タグが無い出力（OMR 由来） | 五線だけで正しく振り分けられる |
| 従来の part 分離形式 | これまでどおり読める（回帰防止） |

## 積み残し（このIssueの受入条件の外）

- **`<backup>` / `<forward>` の時間計算**: 現行パーサーは音符を「出現順のイベント列」として読み、
  時間軸で配置し直してはいない。そのため `<forward>`（休符を書かずに時間を進める書き方）で
  空白を表現した XML では、その空白ぶんが詰まる。今回の五線振り分けはこの前提を変えていない
- **編成譜（複数パート＋そのうち1つが大譜表）**: 五線の振り分け自体は行うが、
  `parseMusicXml` は `instrumentation` を作らないため、編成譜としての読込経路には載らない
- **逆方向（`musicXmlExport`）**: いまも右手/左手を別 `<part>` として書き出している。
  1part×2staves 形式へ寄せると他ソフトとの相互運用が上がるが、別Issueとする
