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

## 今後の課題

- 異名同音の楽典的綴り選択（D♭ vs C# など）を保ったままの移調
- 打楽器の専用記譜
- divisi、solo、a2、tutti などの表記
- パート譜表示と総譜表示の切り替え
