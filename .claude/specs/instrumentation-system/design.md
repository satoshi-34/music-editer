# 編成譜・カスタム編成編集

## 背景

将来的にオーケストラスコアへ対応するには、単旋律、ピアノ、弦楽四重奏だけでは足りない。
ユーザーが「室内オーケストラ」「二管編成」「吹奏楽」などの代表編成から始めつつ、
実際の曲に合わせてパートを増減できる必要がある。

ただし、いきなり本格的なパート譜生成、移調譜、打楽器譜表まで作り込むと影響範囲が大きい。
今回は「編成をデータとして保存し、そのパート数ぶん譜表を表示できる」ことを第一段階にした。

## 方針

### 1. 既存の `ScoreType` を拡張する

既存の `single / piano / quartet` に加えて `ensemble` を追加した。

- `single`: 単旋律
- `piano`: ピアノ大譜表
- `quartet`: 弦楽四重奏
- `ensemble`: 編成テンプレートに従う可変パート譜

室内オーケストラや吹奏楽は `ensemble` として扱う。
これにより、プリセットを選んでも単旋律表示へ落ちる問題を避ける。

### 2. 編成定義を譜面データへ保存する

`SavedScoreData.instrumentation` を追加した。
旧データを壊さないため省略可能にしている。

編成は `ScoreInstrumentation` として保存する。

- `presetId`: どのテンプレート由来か
- `name`: 表示名
- `parts`: 楽器パート定義

各パートは `InstrumentPartDefinition` で持つ。

- `id`: 保存データと結びつけるための安定 ID
- `name`: フルネーム
- `abbreviation`: 譜面左側に出す略称
- `family`: 木管、金管、弦などの分類
- `clef`: 音部記号
- `staffCount`: 将来の複数譜表パート用
- `transposition`: 将来の移調楽器用
- `bracketGroup`: 将来の括弧表示用
- `playbackInstrument`: 再生音色の候補
- `order`: 表示順

### 3. プリセットは別ファイルにまとめる

`src/data/instrumentationPresets.ts` に代表編成を置いた。

- 単旋律
- ピアノ
- 弦楽四重奏
- 弦楽合奏
- 室内オーケストラ
- 二管編成オーケストラ
- 大編成オーケストラ
- 吹奏楽

音楽的な細部は今後レビューで調整できるよう、UI や保存形式から独立させている。
プリセットは保存データの土台にもなるため、`instrumentationPresets.test.ts` で次の整合性を守る。

- プリセット ID の重複がない
- 各プリセット内のパート ID が重複しない
- `order` が配列順と一致する
- `playbackInstrument` が既知の `InstrumentType` である
- `getInstrumentationPreset()` が元定義を直接返さず clone を返す

### 4. 可変パート譜は `EnsembleStaff` で描画する

`EnsembleStaff` は編成定義を受け取り、各パートを `PianoSystemCanvas` の `partsConfig` に変換する。
`PianoSystemCanvas` はすでに N 段譜を描けるため、新しい描画エンジンは作らない。

これで既存の入力、再生、調号、拍子の処理をなるべく再利用できる。
先頭システムでは `showInstrumentLabels` を使い、五線左側にパート略称を表示する。
略称用の余白を作ってから五線を配置しないと、`Fl.` などがページ端で切れるため、
`PianoSystemCanvas` 側でラベル幅を加味して描画開始位置をずらす。

### 5. カスタム編成編集では定義と小節データを同時に動かす

パート追加、削除、並び替えでは、次の 2 つを同じ順番で更新する。

- `instrumentation.parts`: パート名や音部記号などの定義
- `ensembleParts`: 実際の小節データ

この 2 つがずれると、見た目のパート名と保存される小節データが入れ替わる。
そのため、`ScorePage` 側で同時に同期する。

プリセット切り替えでは配列位置ではなくパート ID で小節データを引き継ぐ。
室内オーケストラから二管編成へ切り替えると、3 番目のパートが `horn` から
`clarinet-1-2` に変わるため、位置だけで引き継ぐと Horn の譜面が Clarinet に
移ってしまう。`alignMeasuresToInstrumentationParts()` は ID が一致するパートだけを
引き継ぎ、新しく増えたパートは空小節データとして始める。
同じ helper をカスタム編成の追加・削除・並び替えにも使い、個別の `setEnsembleParts`
処理を増やさない。同期ルールが複数あると、中間パート削除時に「一度 ID で合わせたあと、
もう一度 index で削る」のような二重更新が起きるため。
カスタムパート追加時の ID は `createUniqueInstrumentationPartId()` で既存 ID を見て採番する。
保存検証でも `instrumentation.parts[].id` の重複を拒否し、ID ベース同期の前提を守る。
さらに編成譜の保存時は、`SavedScoreData.parts[].partId` と `instrumentation.parts[].id` の
集合が一致することを検証する。これにより、表示されない余剰パートや、譜面データを持たない
編成パートを保存データへ残さない。

### 6. パート別音色を再生へ渡す

編成譜では、各パートが `playbackInstrument` を持つ。
`ScorePage` は譜面再生用の `PlaybackPart` を作るときに、この値を `instrument` として渡す。

内蔵音源では、パートごとに一時的に楽器設定を切り替えながら、同じ `AudioContext.currentTime` を開始時刻として予約する。
これにより、パートごとに音色を変えても発音タイミングはそろう。

SoundFont では、パートごとの `instrument` から対応する SoundFont プレイヤーを取得してから、同じ開始時刻へ予約する。
先にプレイヤーを読み込んでから開始時刻を決めることで、読み込み待ちのせいで発音時刻が過去になる問題を避ける。

クラリネットは `InstrumentType.CLARINET` として独立した音色にしている。
二管編成オーケストラの `clarinet-1-2` と吹奏楽の `clarinet` は、どちらも
`playbackInstrument: InstrumentType.CLARINET` と `transposition: 'Bb'` を持つ。
再生 UI の木管グループ、内蔵音源、SoundFont 名変換にも同じ enum を通すことで、
「譜面上は Clarinet だが音は汎用 Woodwind」というずれを避ける。
保存データの検証でも `playbackInstrument` は `InstrumentType` に実在する値だけを許可し、
壊れた JSON や手編集された JSON から未知の音色名が再生経路へ入らないようにする。
読み込み時は主データとバックアップの両方で同じ解析・マイグレーション・検証を行い、
主データが壊れていてもバックアップが有効なら譜面を復旧する。
復旧に成功した場合はバックアップ内容を主データへ書き戻し、次回読み込みで同じ壊れた
主データを踏み続けないようにする。
この配線は `SoundSource.test.ts`、`SoundFontEngine.test.ts`、`PlaybackControls.test.tsx`、
`storage.test.ts` で確認する。

### 7. 入力確認音もパート音色へそろえる

編成譜では、音符を置いた直後の確認音も `playbackInstrument` を使う。
`PianoSystemCanvas` はクリックされた `PartConfig` の `playbackInstrument` を `onPreviewNoteEvent` へ渡し、
`ScorePage` は確認音の再生中だけ音声エンジンの楽器を一時的に切り替える。

UI 上の「現在の音色」まで変更すると、ユーザーが再生パネルで選んだ設定が勝手に動いて見える。
そのため確認音の後は必ず元の `currentInstrument` へ戻す。

## 変更対象

- `src/types/storage.ts`
- `src/data/instrumentationPresets.ts`
- `src/components/EnsembleStaff.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `src/components/ScorePage.tsx`
- `src/hooks/useScoreStorage.ts`
- `src/audio/PlaybackEngine.ts`
- `src/audio/SimpleAudioEngine.ts`
- `src/audio/SoundFontEngine.ts`
- `src/utils/storage.ts`
- `src/utils/storage.test.ts`
- `src/App.css`
- `README.md`

## 影響範囲

- 保存形式に `instrumentation` が増える
- 旧データでは `instrumentation` がなくても読み込める
- `ensemble` の再生は、各パートの小節データを既存の `playParts` へ渡す
- `PlaybackPart.instrument` は省略可能なので、既存の単旋律・ピアノ・弦楽四重奏の再生呼び出しも維持できる
- 大編成では 1 ページあたりのシステム数を減らし、譜表が詰まりすぎないようにする
- 表示ページ数は `scoreType` と画面幅から毎回計算する。`visiblePages` を state として保持すると、編成譜の 2 段ページ仕様が単旋律へ切り替えた直後に残り、一ページ目が二行だけに見えることがあるため。

### 8. グループ括弧で楽器グループをまとめる

オーケストラ譜では、木管・金管・弦などの楽器グループを 1 本の括弧でくくり、
ひとまとまりに見せるのが慣習。`InstrumentPartDefinition.bracketGroup` をそのまま
描画側へ渡し、`PianoSystemCanvas` が「連続する同じ `bracketGroup` のパート」を
1 グループとみなして `StaveConnector` を 1 本描く。

- 鍵盤グループ (`keyboard`) は伝統に従って `BRACE`
- それ以外（`woodwinds` / `brass` / `strings` / `percussion` / `voices`）は `BRACKET`
- グループに属するパートが 1 段しかない場合は括弧を描かない（見た目がうるさくなるため）
- システム全体の左端は常に 1 本の縦線 (`SINGLE_LEFT`) で貫き、システム範囲を視覚的に保つ
- `solo` は「単独で括弧なし」の指定として扱い、連続していてもグループ括弧にしない
- カスタム編成などでどのパートも描画対象の `bracketGroup` を持たないときは、従来通り全体を 1 つの括弧でまとめる
  ただし全パートが `solo` の場合は、ユーザーが明示的に括弧なしを選んでいるためフォールバック括弧も描かない

これにより、大編成オーケストラでも木管・金管・弦が視覚的に区切れる。
グループ並びはユーザーがカスタム編成編集で組み替えると変わるため、
括弧は「順序に従って」毎回計算する（静的な定義ではない）。

#### 追補: 小節線もグループ単位で接続する（Issue #28, 浄書慣習対応）

**問題**: グループ括弧（上記）は導入済みだったが、各小節の右端縦線（小節線、
`StaveConnector.SINGLE_RIGHT` / `BOLD_DOUBLE_RIGHT`）は常に「第1段 ↔ 最終段」を
1 本でまたいで描いていた。そのため、木管グループ末尾（例: Bsn.）と金管グループ
先頭（例: Hn.）の間の空白部分にも小節線が繋がって見え、浄書慣習（小節線は
楽器グループ内だけを縦に接続し、グループ間では切る）に反していた。

**修正**: グループ括弧の計算に使っていた「連続する同じ `bracketGroup` の区間」
（`bracketGroupRanges`）を小節ループの前に引き上げ、括弧描画と小節線の右端接続の
両方で共有するようにした。

- グループ定義が1つ以上ある場合、小節の右端縦線は `bracketGroupRanges` の各区間
  （`start`〜`end`）ごとに個別の `StaveConnector` を描く。1段だけのグループ
  （`solo` 指定や単独楽器）は、各段の `Stave` が自分の右端に既に小節線を描いて
  いるため、ここでは追加の接続線を描かない（＝隣のグループとの間の空白には
  線を引かない）。
- グループ定義が1つも無い場合（`bracketGroup` 未指定の後方互換2段ピアノ譜など）は
  従来通り全段を1本で接続する（フォールバック括弧のロジックと対称にしてある）。
- システム左端を貫く `SINGLE_LEFT` の縦線（システム全体の開始位置を示す線）は
  今回の変更の対象外で、従来どおり全パートを貫通する。

**影響範囲**: `bracketGroup` が全パートで同一の弦楽四重奏・ピアノ大譜表は、
グループが1つにまとまるため見た目は変わらない（グループ内の接続がそのまま
全段接続になるだけ）。差が出るのは、複数の異なる `bracketGroup` が混在する
編成譜（オーケストラ・吹奏楽テンプレートなど）のみ。

検証は `src/components/PianoSystemCanvasGroupBarline.test.tsx` で、
`StaveConnector.prototype.draw` をフックして「どの `Stave` からどの `Stave` まで」
を接続したかを Stave インスタンスの同一性で確認する方式にした（SVG のピクセル
座標を直接読むより VexFlow のバージョン差異に強い）。

### 9. 移調楽器の「実音 / 記譜音」表示切替

オーケストラ譜では「実音（concert pitch）」で全パートを書く流派と、
「記譜音（written pitch）」で各楽器が読む通りに書く流派がある。
ここではデータの正本を常に実音とし、表示モードだけを切り替える方針にした。

- `SavedScoreData.notationMode`: `'concert' | 'written'`（既定 `concert`、旧データ互換のため省略可）
- `EnsembleStaff` は `notationMode='written'` のとき、各パートの音符を
  `TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[part.transposition]` の半音差ぶんシフトして
  「奏者が読む譜面」を出す。
- 記譜音表示中は編集をオフにする（`disabled` を強制 true）。
  これは「画面に見える D に置いたら保存は C」のような逆変換ロジックを
  既存の編集パスに混ぜると複雑度が大きく増えるため、まずは表示専用に限定する判断。
- 再生は常に実音データを使うので、表示モードを切り替えてもサウンドは変わらない。

半音差テーブル（実音 → 記譜音の加算）:

| 記載 | 例 | 半音 |
| --- | --- | --- |
| `Bb` | B♭クラリネット、トランペット | +2 |
| `Eb` | アルトサックス | +9 |
| `F`  | ホルン、イングリッシュホルン | +7 |
| `G`  | アルトフルート | +5 |
| `octave-down` | コントラバス | +12 |
| `C` / `none` | 移調なし | 0 |

`transposeKeyBySemitones` は VexFlow キー（例 `c/4`）を半音単位で動かす純粋関数。
異名同音は深追いせずシャープ系で復元しているため、フラット系の調号と
組み合わせると見た目が C# になることがある（楽典的な綴りは今後の課題）。

### 10. 記譜音表示での調号シフト

音符だけシフトして調号は実音のままだと、奏者にとっては「ナチュラルや臨時記号だらけ」に
見える。`shiftKeySignatureByFifths(base, fifths)` で「実音側の調号に五度圏オフセットを
加算した記譜音側の調号」を求め、`PartConfig.keySignature` としてパート単位に渡す。

五度圏オフセットは `TRANSPOSITION_WRITTEN_OFFSET_FIFTHS` に定数で持つ。

- `Bb`: +2 (例: 実音 C → 記譜 D ♯2)
- `Eb`: +3 (例: 実音 C → 記譜 A ♯3)
- `F`:  +1 (例: 実音 C → 記譜 G ♯1)
- `G`:  -1 (例: 実音 C → 記譜 F ♭1)
- `octave-down` / `C` / `none`: 0

`PianoSystemCanvas` には `PartConfig.keySignature` 任意フィールドを追加し、
五線への調号描画と「臨時記号判定用の `accidentalState` 初期化」の両方で
パート固有の調号があればそれを優先する。これで「調号と音符の見た目」が
パートごとに一致する。範囲外（±7 を超える）はそのまま 12 引いて
異名同音の調号に巻き戻す（例: ♯8 → ♭4）。

### 11. 記譜音モードでの編集と実音への逆変換

記譜音表示中でも音符を編集できるようにした。実装の要点は次の通り。

- `EnsembleStaff` は表示用に `+semitones` でシフトした `MeasureData[]` を canvas へ渡す。
- canvas が編集後に返してくる `onChange(newDisplayedMeasures)` は記譜音側のデータ。
  これを `-semitones` で逆方向にシフトしてから `ScorePage` の onPartChange に渡し、
  保存データは常に実音であるという正本を維持する。
- `PianoSystemCanvas` の音符配置パスで使う `applyKeySignatureToNaturalKey` は、
  `keySignatureRef`（システム共通）ではなく `partKeyForAccidental`（パート固有）を参照する。
  これで「記譜音 D メジャー上の F 線をクリックしたら自動的に F♯ が入る」のように、
  画面の調号と入力結果が一致する。
- 調号クリックもパート固有の調号を基準にシフトし、`partIndex` を添えて返すように
  canvas を拡張した（§12 参照）。EnsembleStaff 側で「クリックされたパートの五度圏
  オフセット」を逆方向に適用し、実音調号へ戻してから ScorePage に渡す。

#### 既知の制限

- 記譜音表示中に「シフトされたパート」のどこかを編集すると、そのパート全体の
  小節データが `+semitones → -semitones` の往復を通る。`transposeKeyBySemitones`
  はシャープ系で書き戻すため、実音 B♭ が A♯ などに異名同音化することがある。
  響きは同じだが楽典的綴りが変わるので、綴りを保ちたい場合は実音モードで編集する。
### 12. パート固有調号の編集（記譜音モードでの調号クリック）

記譜音モードで段ごとに違う調号が表示されているとき、ユーザーは画面で
見えている調号に対して操作したい。canvas を以下のように拡張した。

- `PartConfig.keySignature?: KeySignature`: パート固有の調号を渡す。
- `PianoSystemCanvas` の調号クリック処理では `partKeyForAccidental`（= パート固有
  調号 ?? システム共通調号）を基準に `shiftKeySignatureByAccidental` する。
- `onKeySignatureChange(nextKey, partIndex)` に変更し、どの段の調号が動いたかを返す。

`EnsembleStaff` は次のように扱う。

- `partIndex` から「クリックされたパートの五度圏オフセット」を引き、
  記譜音側の新しい調号を `shiftKeySignatureByFifths(newKey, -fifths)` で
  実音側へ戻してから上に伝える。
- 実音モードや移調なしのパートでは `fifths === 0` なので何も変換しないで通す。

これで「記譜音表示中の B♭管で `+♯` を押すと、B♭管は D→A（♯3）、実音は C→G に
切り替わり、他のパートの調号も五度圏オフセットに従って一斉に再計算される」と
いう挙動になる。

### 13. 弦サブグループの細い括弧

オーケストラ譜では、メインの BRACKET の内側にもう一段細い括弧を出して
「ヴァイオリン群」「低弦群」などのサブグループを示す慣習がある。
`InstrumentPartDefinition.subBracketGroup`（任意・文字列）を追加し、
プリセットでは Vln I/II に `'violins'` を割り当てた。

`PianoSystemCanvas` 側の実装方針:

- メイン括弧と同じく「連続する同じ subBracketGroup のパート」をひとまとめにする。
- プリセットでは Vln I/II を `violins`、弦楽合奏以上の Vc/Cb を `low-strings` にする。
  弦楽四重奏の Cello だけではサブ括弧を出さず、Contrabass が加わる編成で低弦をまとめる。
- VexFlow の `StaveConnector` はメイン括弧位置に固定で、X 方向のオフセットを
  公式 API では渡せない。サブ括弧用に内側へずらしたいので、ここは
  `<path>` で角括弧を直接 SVG に描く。
- 位置はメイン括弧と五線の間（`stave.getX() - 7`）、フック幅 4px、線幅 1px。
- 1 パートだけのサブグループは描かない（うるさくならないように）。

サブ括弧は表示専用で、音符データや再生には影響しない。
カスタム編成編集では `subBracketGroup` も直接編集できる。
同じ値を連続する複数パートに入れると、その範囲が細い括弧でまとまる。

### 14. カスタム編成編集で移調と括弧を触れるようにする

自由編成を作るには、パート名や音部記号だけでなく、移調と括弧グループも
ユーザーが調整できる必要がある。`ScorePage` のパート編集行では次を編集できる。

- `family`: 集計や将来のフィルタ用の楽器族
- `transposition`: 記譜音表示時の音高・調号シフト
- `bracketGroup`: メイン括弧のまとまり。鍵盤はブレース、その他は角括弧で描く。`solo` は括弧なし。
- `subBracketGroup`: 連続する同じ値を細い括弧でまとめる任意の識別子

空の `subBracketGroup` は `undefined` として保存する。
空文字のまま残すと「何も入力していないパート同士」が同じグループ扱いに
なってしまうため。

`storage.test.ts` では、`notationMode='written'` と `subBracketGroup` を含む
編成定義を保存して読み戻すテストを置く。
移調表示やサブ括弧は見た目の機能に見えるが、保存値が欠けると再読込後に
表示モードや括弧が変わるため、保存互換の対象として扱う。

### 15. 編成切替時は空譜面でも再描画する

`PianoSystemCanvas` の描画 effect は、音符データだけでなくパート構成も依存関係に含める。
空譜面では `partsScore` が変わらないため、プリセットを切り替えても略称ラベルや括弧だけが
古い編成のまま残ることがある。

そのため `partsLayoutSignature` として、`clef`、`label`、`bracketGroup`、`subBracketGroup`、
パート固有調号、再生音色をまとめた署名を作り、描画 effect の依存に入れる。
これで音符がまだ無い状態でも、室内オケから弦楽合奏へ切り替えた瞬間に
`Fl. / Ob. / Hn.` ではなく `Vln. I / Vln. II / Vla. / Vc. / Cb.` へ描き直される。

### 16. パート数に応じてパート間隔を詰める（紙面効率）

二管編成（12パート）を選ぶと、従来はパート間隔が全パート共通で80ネイティブ単位固定
だったため、A4相当1ページに1システムしか入らないうえ余白が過大で、市販オーケストラ
スコアに比べて紙面効率が低かった（Issue #29）。

`PianoSystemCanvas.tsx` の `computeLayout(n)` を変更し、パート数に応じて間隔を
切り替えるようにした。

- 単旋律・ピアノ・弦楽四重奏（4パート以下）: 従来どおり80（見た目を変えない）
- 編成譜（5パート以上）: 60に詰める

60という値は、VexFlowの五線本体（line0〜line4）の高さ40ネイティブ単位に対し、
隣接パートとの間に20単位（加線2本ぶん）の余白を残せる下限を目安にしている。
どちらの間隔も全パート共通（パートごとに変えない）なので、隣接する段のY座標差は
常に一定になる。この値は五線間隔クリック判定（`partGapY`）にも使われるため、
`computeLayout` の戻り値に `staveSpacing` を追加し、ハードコードされた定数を
参照していた箇所（クリック当たり判定の中間点計算）も含めて統一した。

`ScorePage.tsx` の `BASE_SYSTEM_HEIGHT_PX.ensembleLarge/ensembleSmall`
（段数/ページの上限を安全側に見積もるための実測値）は今回変更していない。
間隔を詰めたことで実際のシステム高さは下がっているため、将来的にこれらの値も
再実測して下げれば、編成譜で2システム/ページに収まるケースが増える可能性がある。

### 17. 編成譜で大譜表（2段）パートを混在させる（Issue #57・スタックPR 1/2）

「ピアノ＋歌」のような伴奏付きの譜面を作れるようにする要望（Issue #57）に対し、
まず「編成譜のデータ構造・描画・レイアウトが大譜表パートを扱える」ことを第一段階にした。
編成プリセットの新規追加（歌＋ピアノ等）とカスタム編成編集UIの見た目調整は次PRへ分ける。

**既存の仕組みの再利用**: `InstrumentPartDefinition.staffCount` は既に存在したが、
ピアノ専用プリセット（`scoreType: 'piano'`）でしか使われておらず、編成譜
（`EnsembleStaff`）側は無視していた。`PianoSystemCanvas.tsx` 自体は
`bracketGroup === 'keyboard'` のとき隣接2段をブレースで結ぶ処理を既に持っていた
（ピアノ専用プリセットのための実装）ため、描画エンジン本体には変更を加えず、
「1パート定義→1段」だったマッピングを「`staffCount:2`のパートは2段」に
展開するだけで済んだ。

**データの持ち方**: 「1パート=1つの `MeasureData[]` スロット」という前提が
`ScorePage.tsx` の保存/読込/再生/クリップボード/パート抽出など10箇所以上に
染み込んでいたため、既存の `ensembleParts: MeasureData[][]`（1段目）はそのままに、
2段目だけを同じ添字で対応する並行配列 `ensembleSecondStaffParts: MeasureData[][]`
として追加した（新しい入れ子構造は導入しない）。各箇所は
「`instrumentation.parts[i].staffCount === 2` のときだけ2段目も見る」という
if 分岐を追加するだけで済み、既存の1段パートのコードパスは一切変更していない。

**保存データの後方互換**: 2段目は `PartData.partId` を `` `${part.id}::2` ``
（`ensembleSecondStaffPartId`）として1段目とは別の `PartData` に保存する。
旧データにはこの partId が存在しないため、読込時は必ず空配列にフォールバックする。
そもそも編成譜で `staffCount:2` を選べるUIがこのPR以前には存在しなかった
（プリセット `piano` は `scoreType:'piano'` 専用）ため、既存の編成譜保存データが
`staffCount:2` のパートを持つことは無く、後方互換は実質的に自明である。

**ブレースの描画**: 大譜表パートの2段は、パート定義自身の `bracketGroup`
（隣の楽器とのグループ分けに使う値）に関わらず、常に `bracketGroup: 'keyboard'`
を強制してブレースを描く。理由は、`bracketGroup` は「このパートと隣のパートを
グループとして括るか」を表す値であり、新規追加パートの既定値 `'solo'`
（「グループ化しない」の意味）のままでは、2段自身の間にすらブレースが
描かれなくなってしまうため。実際の楽譜浄書でもピアノ等の大譜表は常に
自分の2段だけでブレースを組み、他パートとまとめて1つのブレース/ブラケットに
なることはないため、この上書きは慣習にも合っている。既知の制約として、
大譜表パートを2つ隣接させた場合（例: 連弾）は現状1本の大きなブレースに
まとまってしまう（`bracketGroup` が同じ文字列のため）。ピアノ2台等の
対応が必要になった時点で、大譜表パートごとに一意なグループキーへ変更する。

**レイアウト高さ計算**: `partCountForSystemLayout` /
`estimateEnsembleSystemHeightPx` / `computeEnsembleAutoFitMultiplier` は
いずれも「編成のパート数」を渡していたが、これは `PianoSystemCanvas` が
実際に描く「段数」と一致している前提の値だった。大譜表パートが混在すると
パート数と段数が食い違うため、`totalEnsembleStaffCount`（`staffCount`の
合計）に置き換えた。`staffCount:1` のみの既存編成ではパート数と総段数が
一致するため、この変更による見た目の変化は無い。

**動作確認**: `npx vitest --run src` / lint / build は成功（詳細はPR本文）。
新規追加した `EnsembleGrandStaffPart.test.tsx` は、実際に描画される
VexFlow の `StaveConnector`（ブレース/ブラケット）を検証し、大譜表パートの
2段だけがブレースで結ばれること・隣接する1段パートを巻き込まないこと・
`bracketGroup` が `'solo'` でもブレースが強制されることを確認している。
ブラウザでの対話確認は、編成譜の「パート編集」が別ウィンドウ（`window.open`）
のため、夜間無人実行のサンドボックスではポップアップがブロックされ実施できず、
既存編成（室内オーケストラ等）の描画・再生に新規コンソールエラーが
無いことのみ確認した（人間による「段数を2に変更→ブレース表示」の
実地確認を推奨）。

## 今後の課題

- 異名同音の楽典的綴り選択（D♭ vs C# など）を保ったままの移調
- 打楽器の専用記譜
- divisi、solo、a2、tutti などの表記
- パート譜表示と総譜表示の切り替え
- （Issue #57 続き）編成プリセットへの「歌＋ピアノ」「リコーダー＋歌」追加、
  カスタム編成編集UIの段数選択の見た目調整、MusicXML書き出しでの大譜表対応
  （現状ピアノ専用プリセット同様、2段が別パートとして書き出される）
