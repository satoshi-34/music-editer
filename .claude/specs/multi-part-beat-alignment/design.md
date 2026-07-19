# 複数パートの拍の縦揃え（2026-07-18）

## 問題

ピアノ大譜表（右手＋左手）・弦楽四重奏・編成譜（`PianoSystemCanvas`）で、
同じ小節内の右手と左手（あるいは各パート）の音符が、同じ拍位置にあっても
横方向にずれて描画されることがあった。例えば右手が8分音符6個、左手が
4分音符4個の小節では、本来「1拍目・2拍目・3拍目・4拍目」に来る音符同士が
縦一直線に並ぶべきだが、実際にはパートごとに独立してずれていた。

## 原因

`PianoSystemCanvas.tsx` の小節描画ループ（`parts.forEach`）の中で、
パートごとに個別の `new Formatter().joinVoices(...).formatToStave(...)` を
呼んでいた。VexFlow の `Formatter` は「与えられた Voice 群を同じ
`TickContext`（拍ごとの位置グループ）にまとめて、小節幅にジャスティファイ
（伸縮配置）する」ことで拍の位置を揃える仕組みだが、これはあくまで
「1回の `joinVoices`/`format` に渡された Voice 同士」の話であり、右手と
左手を別々の `Formatter` で処理していたため、それぞれが独立した密度で
ジャスティファイされ、同じ拍でも x 座標が食い違っていた。

小節の左右境界（`measLeft`/`measRight`）自体は全パート共通のため、
「小節の頭とお尻」は揃っていたが、小節の中身（各拍の相対位置）は
パートごとにバラバラだった。

## 修正設計

VexFlow の標準的なマルチスタッフ整列手法（複数 stave にまたがる複数
Voice を1つの `Formatter` に `joinVoices` してから、共通の
`TickContext` を使って各 Voice を対応する stave へ `draw()` する）に
合わせて、小節ごとの描画を3パスに分割した。

- **Pass 1**（`parts.forEach` 1周目）: 各パート・各声部の `StaveNote` と
  `Voice`（VexFlow のタイミング管理オブジェクト、まだ整形前）を生成する。
  結果は `partVoiceCache[pi]` に保存し、全声部の `Voice` を
  `allVoicesForFormatting` に集める。
- **Pass 2**: `allVoicesForFormatting` を1回の
  `Formatter().joinVoices(...).formatToStave(..., alignRests:true)` で
  まとめて整形する。全パートの stave は同じ小節幅で作られているため、
  幅の計算には代表として最初のパートの stave（`staveSets[0][i]`）を渡せば
  足りる（stave 固有の Y 座標などは使われない）。
- **Pass 3**（`parts.forEach` 2周目）: Pass 1 でキャッシュした
  `renderedVoiceEntries` を使って実際の描画（`voice.draw()`・ビーム・
  連符・タイ収集・クリック判定などの既存ロジック）を行う。Formatter は
  再度呼ばない。

キャッシュ型 `RenderedVoiceEntry` を新設し、`partVoiceCache` の要素型
（`clefHere` / `data` / `safeEvs` / `partKeyForAccidental` /
`isMultiVoiceMeasure` / `renderedVoiceEntries` / `primaryRenderedVoice` /
`vfNotes`）として、Pass 3 で必要な最小限のデータだけを引き継いだ。
`accidentalState` や `thisPrevMeasState`（courtesy accidental 判定用）
など Pass 1 内でしか使われない変数はキャッシュに含めていない。
`score` / `setScore` / `l2k` / `k2l` は軽量なクロージャ／純粋関数のため
Pass 3 側で再定義している。

## 影響範囲

- `src/components/PianoSystemCanvas.tsx` のみ。小節描画ループの内部構造を
  変えただけで、公開 Props・保存データ形式・クリックハンドラのロジック
  自体は変更していない。
- 単旋律譜（`StaffCanvas.tsx`）は元々1パートしか描かないため対象外
  （変更なし）。

## 検証

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 全65ファイル872件成功。
- ブラウザで48小節の複雑テスト楽譜（`test-data/complex-test-score.json`）
  を読み込み、DOM から `.vf-stavenote` の bbox を取得して右手・左手の
  拍ごとの x 座標を比較。1拍目〜4拍目で誤差1px以内の一致を確認
  （前打音を含む音符は装飾音符ぶんの幅が bbox に含まれるため見かけ上
  ずれるが、主音符自体の位置は揃っている）。全12段を目視でも確認。
- 新規作成した空のピアノ譜で、右手・左手それぞれに1拍目の4分音符を
  クリック入力し、両パートの x 座標が一致すること（新規入力後の
  フォーマットも壊れていないこと）を確認。
- Undo/Redo・保存・読込は本変更の対象外（`ScorePage.tsx` 側の別ロジック）
  だが、上記のブラウザ確認・vitest 実行を通じて既存動作に影響がないこと
  を確認した。

## 追補: 合同フォーマットに伴う小節幅見積もりの修正（2026-07-18）

拍の縦揃え（合同フォーマット）導入後、開始拍が重ならない密な小節
（例: M3 = 右手3連符×2＋4分×2 / 左手8分×8、M9 = 2声部）で音符が
小節幅に収まらず、隣の小節へはみ出して重なる症状が出た
（Formatter は minTotalWidth を下回る幅へは圧縮できないため溢れる）。

原因は小節の最低幅見積もり（`minWs`）が「各パート単体の幅の最大値」の
ままだったこと。合同フォーマットでは「同じ開始拍の音符は同じ列を共有し、
異なる開始拍はそれぞれ独立した列になる」ため、必要幅は全パート・全声部の
**開始拍の和集合**で決まる（M3 は単体では各8列だが合同では13列）。

`measureLayoutUtils.ts` に `combinedMeasureMinimumContentWidth()` を追加し、
同じ小節位置の全パート（＋ voices[1] 以降の追加声部）のイベントを
開始拍（付点・連符込みで計算、1/960拍単位に丸め）ごとの列へ集約し、
列ごとの最大イベント幅の合計を最低幅とするようにした。
`PianoSystemCanvas` の `minWs` 計算をこの関数へ置き換え。
単旋律譜用の `measureMinimumContentWidth()`（StaffCanvas が使用）は変更なし。

検証: 複雑テスト楽譜で全システムの音符 bbox が小節境界内に収まること、
拍の縦揃え（M1 の共通拍 x 座標が右手・左手で1px以内に一致）が維持される
ことを DOM 計測で確認。64分音符ラン小節には自動的に広い幅（約310px）が
配分され、同システムの他の小節が相応に狭くなる。tsc / vitest 872件成功。

## 追補2: 合同フォーマット時の五線取り違えによる間隔の歪みを修正（2026-07-19）

拍の縦揃え導入後、「表示が全体的に崩れた」（音符が左に寄り、小節後半の
間隔が前半の約2倍に広がって左右非対称になる）との報告があった。

### 原因

Pass 2 で `formatToStave(全Voice, staveSets[0][i])` と、代表として
**最上段（ト音記号）の五線**を渡していた。VexFlow の `formatToStave` は
内部で `format(..., {stave})` を呼び、`preFormat` の中で
`voices.forEach(v => v.setStave(stave).preFormat())` として
**渡した1つの五線を全 Voice の全音符へ強制設定**する。
その結果、左手の低音（g3 など）まで最上段のト音記号五線に載った状態で
幅・位置が計算され、間隔配分（tick context の X 座標）が歪んでいた。
実測では左右の手の同一拍の符頭が約7pxずれ、小節後半の8分間隔が
前半の約2倍（51/49px vs 24/30px）に広がっていた。

### 修正

VexFlow の `Voice.preFormat()` は「stave 未設定の音符にだけ」自分の
stave を伝播し、`preFormatted` フラグで再実行を防ぐ仕様。これを利用して:

1. Pass 1 で各 Voice に**自分のパートの五線**を設定（`voice.setStave(stave)`）。
2. Pass 2 の formatToStave の直前に各 Voice を `preFormat()` して、
   音符へ正しい五線を先に伝播させる（`preFormatted=true` になる）。

こうすると後続の formatToStave が内部で呼ぶ
`v.setStave(topStave).preFormat()` は、`preFormatted` ガードで早期 return
するため音符の五線を上書きしない（voice.stave は最上段に変わるが、
幅・位置計算に使う音符側の stave は各パート正しいまま）。

### 検証

- 印刷テスト用小品 M1（右手5音 / 左手8分×8）で、左右同一拍の符頭ずれが
  約7px → 約1px に改善。小節内の8分間隔が 24/30/24/30/51/49/24 →
  30/30/30/29/40/40/31 とほぼ均等化（残る 40 は両手に音符がある拍の
  自然な差で、以前のような2倍の歪みは解消）。
- complex-test-score（3連符 vs 8分、2声部など）で音符の小節外はみ出しは
  前打音 bbox 由来の既知1件のみ。全段を目視で崩れなしを確認。
- tsc / vitest 872件成功、コンソールエラーなし。

## 追補3: 付点・連符の tick と実測小節幅を合同フォーマットへ反映（2026-07-19）

### 問題

拍の縦揃えを導入した後、付点音符・連符・臨時記号・複数声部を混ぜた密な
ピアノ譜で、符頭同士、臨時記号、または小節線へ音符が重なった。

`Dot.buildAndAttach()` は付点を描く Modifier を追加するだけで、音符の tick を
伸ばさない。一方アプリ側の拍数計算は付点を1.5倍/1.75倍としていたため、
「アプリ上の開始拍」と「VexFlow Formatter の開始拍」がずれていた。また、
`Tuplet` を Pass 3（Formatter 後）に生成していたため、連符の tick 倍率も合同
Formatter へ届いていなかった。

### 修正

1. `makeVFNote` で `StaveNote` / `GhostNote` の `dots` オプションへ付点数を渡し、
   既存の `Dot.buildAndAttach()` は視覚的な点の描画として維持した。
2. `createVexFlowTuplets()` を新設し、同じ `tuplet.id` の連続音符から `Tuplet` を
   **Voice へ追加する前**に生成した。Tuplet のコンストラクタが tick 倍率を適用する
   ため、Pass 2 の全パート合同 Formatter が正しい拍位置を使える。生成した Tuplet
   は Pass 3 では再生成せず、ブラケットだけを描画する。声部2にも同じ処理を適用する。
3. `vexFlowCombinedMeasureMinimumContentWidth()` を追加し、各小節の全パート・全声部を
   仮 Voice として合同 Formatter の `preCalculateMinTotalWidth()` へ渡す。従来の
   開始拍ベース推定値と実測値の大きい方を最低幅にし、編集中の壊れた/不完全なデータで
   実測に失敗した場合だけ従来の推定値へフォールバックする。
4. 既存の「最低幅に比例して余剰幅を配る」変更は保持した。これにより実測で広いと
   判定された64分音符・臨時記号の多い小節は、余った段幅も相対的に多く受け取る。

### 再レビュー追補: 調号状態・全体改段・印刷倍率（2026-07-19）

- VexFlow 幅計測は本描画と同じく `joinVoices(voices)` を先に呼び、共有した
  TickContext で `preCalculateMinTotalWidth()` を実行する。これによりパート単独の
  幅ではなく、拍を揃えた合同列として測定する。
- 幅計測は `noteKeyUtils.createMeasureAccidentalState()` /
  `resolveDisplayAccidentalsForKeys()` / `snapshotAccidentalState()` を本描画と共用する。
  そのため有効調号、パートの clef、前小節の最終状態、同小節内の自然記号、courtesy
  accidental を仮 `StaveNote` に同じ順で付けられる。微分音と前打音も仮ノートへ追加する。
  VexFlow 5 の事前幅が臨時記号列を小さく返す環境差だけは、「実際に表示すると確定した」
  記号ごとに22pxの安全幅を加える（キー文字列中の #/b を数える旧方式は廃止）。
- 現在の `PianoStaff` / `QuartetStaff` / `EnsembleStaff` / `ScorePage` は、すべて
  `startMeasureIndex + systemIndex * measuresPerSystem` と固定幅の添字でページ・印刷・
  小節番号・タイ/スラー参照を作る。この前提を保ったまま `ScorePage` に
  `planEffectiveMeasuresPerSystem()` を置き、全パート・全小節の連続グループを評価して
  保存された `measuresPerSystem` を上限とする共通値（4→3→2→1）を選ぶ。これを
  `startMeasureIndex`、ページ数、`printContentSystems`、各ラッパーへ一貫して渡すため、
  小節の重複・欠落がない。保存値はユーザー希望の上限のまま保持し、effective値は表示・
  印刷専用である。`allocateCombinedMeasureWidths()` は確定後の余白配分だけを担い、
  無制限の縮小fallbackを持たない。
- `useAutoPageScale()` の viewport scale は `ScaledPageWrapper` のCSS transformだけへ渡す。
  VexFlow の `scale` は固定等倍で、印刷時にも画面幅由来の内部SVG倍率が混入しない。
  transform/座標補正の Safari 対応は従来どおり `ScaledPageWrapper` と座標変換側に残す。
- 幅の単位は `minLogical`（VexFlow論理幅）と `contentPhysical`（SVG物理幅）を分ける。
  共通の `allocateCombinedMeasureWidths()` は `contentPhysical = minLogical * renderScale + extra`
  を返し、Canvas は `Stave(..., contentPhysical / renderScale)` と `ctx.scale(renderScale)` を
  組み合わせる。現在の renderScale は等倍であり、将来変更しても Planner と Canvas が
  同じ値・同じ本文予算（A4幅−左右余白−ラベル幅、TARGET_FILL、先頭clef余白控除後）を使う。
- 1小節/段でもこの予算を超える入力は縮小で隠さず `hasUnavoidableOverflow` として画面に
  警告する。編集中の空枠は `ceil(12 * 保存measuresPerSystem / effectiveMeasuresPerSystem)`
  段以上を確保し、印刷だけは内容末尾で引き続きトリミングする。

### 回帰テスト

### 可変system range追補（2026-07-19）

全曲共通のeffective小節数では通常小節まで1小節/段になり得るため、`planSystemMeasureRanges()`へ変更した。全小節の安全幅を一度だけ計測し、各段で希望値以下の最大countを貪欲に選んだ `{ start, count, minimumWidths }` をページ単位で渡す。Piano/Quartet/Ensemble/PartExtractionはこの絶対startを使うため、ページ境界で小節の重複・欠落を起こさない。

- `vexFlowTimingUtils.test.ts`: 付点の tick が1.5/1.75倍になること、3連符の tick が
  2/3倍になること、不完全な連符グループでは安全に通常音符へフォールバックすること。
- `measureLayoutUtils.test.ts`: 付点・多声部・3/5連符・臨時記号、および64分音符を
  含む小節で VexFlow 実測幅を取得できること。調号由来のnatural、courtesy、三和音の
  臨時記号が約110px以上の幅を確保すること、全体共通のeffective小節数へ下げることも確認する。

## 追補4: 自動小節幅・改段のレイアウト破綻を修正（2026-07-19）

### 症状

実曲風の24小節ピアノ譜（`test-data/print-test-score.json`、段あたり
小節数=4）を読み込むと8ページ・30段へ膨張し、1小節だけが全幅に
引き伸ばされる段が24本・4小節の段が6本になった。48小節の複雑テスト譜
（`test-data/complex-test-score.json`）でも10ページ・38段＋
「最小の1小節/段でも紙幅を超える」誤警告が出た。

### 原因A: 末尾の空小節ぶんまで段を生成していた

`ScorePage.tsx` の `plannerMinimumWidths` は、旧実装の固定12段グリッド
（`totalSystems(12) × measuresPerSystem`）をそのまま「編集用の空き枠」と
みなし、常に48小節ぶんのスロットを `planSystemMeasureRanges()` へ渡して
いた。内容が24小節しかなくても残り24小節ぶんの空段が生成され、画面へ
描画されてしまう（印刷は print-hidden で隠れるが画面には残る）。

`plannerMinimumWidths` の長さを `contentMeasureCount + editingBufferMeasures`
（`editingBufferMeasures = max(effectiveMeasuresPerSystem, measuresPerSystem) * 2`、
だいたい2段ぶん）に変更し、内容量に応じた小さな編集用余白だけを残すように
した。あわせて `effectiveTotalSystems` の `Math.max(plannedRanges.length, totalSystems(12))`
という下駄（常に12段以上を確保）も廃止し、`plannedRanges.length` にそのまま
従うようにした。

### 原因B: 小節の最低幅見積もりが実際の描画より約2〜2.5倍過大だった

2点の要因が重なっていた。

1. `measurePlannerSafetyPadding()` が、Ensemble の移調後に臨時記号が増える
   最悪ケース（和音の全キーが臨時記号になる想定で `keys.length * 10px`）を
   **全ての楽譜種別で無条件に**加算していた。ピアノ・四重奏は移調をしない
   ため実際に表示されない臨時記号ぶんまで幅を確保しており不要。さらに
   microtones・grace notes ぶんの安全幅も、`vexFlowCombinedMeasureMinimumContentWidth`
   側の `modifierSafetyWidth` で既に実測込みのため二重加算になっていた。
   → `measurePlannerSafetyPadding()` に `includeTranspositionAccidentalWorstCase`
   オプションを追加し、Ensemble（`scoreType === 'ensemble'`）のときだけ
   臨時記号の最悪ケースを加える。microtones・grace notes の重複加算は削除。
2. より支配的だったのは `SCORE_LAYOUT_RENDER_SCALE`（VexFlow の論理座標→
   物理SVG座標の倍率）が `1`（等倍）だったこと。VexFlow の `StaveNote` /
   `Formatter` はデフォルトで五線の高さ約40論理単位を前提にした比較的
   大きな符頭・符尾サイズで最低幅を計算する。これを等倍のまま物理ページ幅
   （182mm ≒ 688px）へ当てはめると、五線の高さが実測で約10.6mm相当になり、
   一般的な印刷譜（六〜七分＝約6〜7mm）の1.5〜1.8倍のサイズになっていた。
   実測では右手5音・左手8分×8程度の軽い1小節でも合同フォーマットの最低幅が
   約300〜330論理pxに達し、段あたり予算（約550px）に1〜2小節しか入らなかった
   （jsdomのテスト環境ではCanvasのテキスト計測が空文字幅を返すため、この
   過大な実測値はブラウザで確認するまで気づけなかった）。
   → `SCORE_LAYOUT_RENDER_SCALE` を `1` から `0.4` へ変更。実測（print-test-score
   の代表的な1小節=約330論理px）から、段あたり4小節という一般的な組版密度に
   収まる実寸相当のスケールとして選んだ。

さらに、この変更に伴い `ScorePage.tsx` の `plannedRanges`（`planSystemMeasureRanges()`
呼び出し）が **VexFlow論理単位のまま**の `plannerMinimumWidths` と、
**物理px単位**の `worstCaseSystemContentBudget()` を単位を揃えずに比較していた
潜在バグも顕在化した（renderScale=1のときは論理px=物理pxで偶然一致していたが、
0.4に変更すると常に「1小節でも予算超過」と誤判定される）。budget側を
`worstCaseSystemContentBudget() / SCORE_LAYOUT_RENDER_SCALE` で論理単位へ
逆変換して揃えるよう修正した。

### 影響範囲

- `src/utils/measureLayoutUtils.ts`: `SCORE_LAYOUT_RENDER_SCALE` の値、
  `measurePlannerSafetyPadding()` のオプション追加、`planEffectiveMeasuresPerSystem()`
  への `safetyOptions` パラメータ追加。
- `src/components/ScorePage.tsx`: `plannerMinimumWidths` の長さ計算、
  `effectiveTotalSystems` の下駄廃止、`plannedRanges` の単位変換、
  `planEffectiveMeasuresPerSystem()` 呼び出しへ ensemble 判定を追加。

### 検証

- `docker compose run --rm app npx tsc --noEmit`: エラーなし。
- `docker compose run --rm app npx vitest run`: 68ファイル890件成功
  （既知の flaky である `SaveLoadButtons.test.tsx` のローディング状態テストも
  今回は成功）。
- ブラウザ（`.claude/launch.json` の `dev-alt`、port 5175）で
  `test-data/print-test-score.json`（24小節・段あたり4小節）を読込:
  修正前は8ページ・30段（1小節/段が24本・4小節/段が6本）だったのが、
  修正後は **2ページ・8段（すべて4小節/段、末尾は編集用の空小節）** になった。
  DOM の `[data-measure]` 属性で各段が実際に4つの異なる小節を描画している
  ことを確認。コンソールエラーなし。
- `test-data/complex-test-score.json`（48小節）を読込: 修正前は10ページ・
  38段＋「最小の1小節/段でも紙幅を超えます」の赤い警告バナーが出ていたが、
  修正後は **4ページ・15段**（大半が4小節/段、密な小節を含む段だけ2小節/段）
  になり、警告バナーは表示されなくなった（`hasUnavoidableOverflow: false`）。
  64分音符16連符を含む密な小節はスクリーンショットで確認した限り、隣の
  小節へめり込まず自分の小節幅に収まっている。段またぎのスラーも接続を
  維持している。コンソールエラーなし。

## 追補5: 余剰幅の配分を比例から均等へ戻す（2026-07-19）

### 症状・要望

追補4で改段数は適正化されたが、密な小節（32分トレモロ・64分16連など）が
段幅の大半（約6割）を占め、同じ段の他の小節が窮屈になるとの指摘。
トークン制限前（比例配分導入前）の、より均等な幅が好みとのこと。

### 原因

`allocateCombinedMeasureWidths()`（`measureLayoutUtils.ts`）が余剰幅
（`extra = 段予算 - 最低幅合計`）を各小節の最低幅に**比例**して配っていた
（`width + extra * (width / sumMin)`）。密な小節は最低幅が大きいぶん余剰も
多く受け取り、幅の差が増幅されていた。比例配分は各小節を同一係数
`(1 + extra/sumMin)` で拡大するため、最低幅の比がそのまま最終幅の比になる。

### 修正（A案採用）

余剰を全小節へ**均等**配分（`width + extra / n`）に変更した。最低幅の差
（密な小節が元々必要とする幅）は下限として残るが、余剰による差の増幅が
なくなり段内の幅がより均等に見える。均等配分でも `contentWidth ≥ 最低幅`
は常に成り立つため、VexFlow の衝突しない最低幅を下回らず、はみ出し・
符頭の重なりは起きない（`doesFit` と最低幅の下限は不変）。

B案（均等と比例のブレンド）は密な小節へ余剰を多く配る方向のため、今回の
「密な小節が段を独占する」症状には逆効果。A案で符頭の窮屈・重なりが
出ないことを確認したため B案は採用しない。

### 検証

- `tsc --noEmit` エラーなし。`vitest run` 68ファイル891件成功
  （均等配分を固定するテストを1件追加）。
- ブラウザ（port 5175）で `complex-test-score.json` を読込。全段で
  最大/最小小節幅の比が比例配分より縮小することを、モジュールを直接
  呼んで修正前後で比較確認（例: M1-4 段 5.18→2.81、M5-8 段 2.95→1.57、
  末尾の密な2小節段 3.58→1.41、M23-24 段 3.39→2.01）。段またぎスラー・
  拍の縦揃えは不変、`layoutOverflow`/警告バナーなし、コンソールエラーなし。
  64分ランを含む段のみ最低幅由来で比が高いまま（9.44→7.28）だが、これは
  その小節が本来必要とする幅であり余剰の増幅ではない。
- `print-test-score.json`（24小節）は引き続き2ページ・全段4小節/段。
  幅比は 1.3〜2.7（2.7 は全音符・2分音符を含む小節の正当な最低幅差）。

## 追補6: 小節幅の「均し具合」定数の導入（2026-07-19）

### 要望

追補5で余剰を均等配分にしても、密な小節（64分16連 M22 など）は「最低幅
そのもの」が大きいため差が残り、complex の64分段で1小節が段幅の約57%を
占めていた。この差を「1つの値で調節できるように」してほしいとの要望。

### 実装

`measureLayoutUtils.ts` に調節用定数 `MEASURE_WIDTH_EVENNESS`（0〜1、既定
`0.5`）を追加し、`allocateCombinedMeasureWidths()` で各小節の配分幅を
「最低幅ベースの均等余剰配分（base = 最低幅 + extra/n）」と「段内の等分幅
（equalShare = 使用可能幅 / 小節数）」の間で線形ブレンドするようにした。

```
contentWidth = base + EVENNESS * (equalShare - base)
```

- `EVENNESS = 0`: base のまま（従来の均等余剰配分。密な小節の最低幅差が残る）
- `EVENNESS = 1`: 全小節が equalShare（完全等幅）
- `EVENNESS = 0.5`: base と equalShare のちょうど中間（差を約半分に縮める）

`Σ base = Σ equalShare = usableWidth` なので、ブレンド後も総和は
`usableWidth` に保たれる（総和保存＝段幅を余さず使い切る）。EVENNESS を
上げると密な小節は base より狭くなり、最低幅を下回って符頭が詰まりうるが、
これは「詰めてでも均等に」という意図した挙動。

定数は関数の省略可能引数 `evenness = MEASURE_WIDTH_EVENNESS` としても
受け取れるようにし、テストで 0/1/0.5 の各挙動を固定できるようにした
（通常は定数の既定値がそのまま使われる）。

### overflow 時はブレンドしない

段に収まらない（`sumMin > usableWidth`、余剰なし）ときに equalShare へ
寄せると、密な小節が最低幅すら下回るまで圧縮され、はみ出し（衝突）を
隠してしまう。この場合はブレンドせず最低幅どおり（base = 最低幅）で返し、
`doesFit = false` と overflow を正直に出す。`doesFit` の判定式
（`sumMin <= usableWidth`）は従来どおり。

### 検証

- `tsc --noEmit` エラーなし。`vitest run` 68ファイル893件成功
  （EVENNESS=0/0.5/1 の配分と総和保存を固定するテストを追加。overflow 時に
  ブレンドせず最低幅を維持する既存テストも通ることを確認）。
- ブラウザ（port 5175）で complex-test-score を読込。64分ランを含む
  4小節段（M21-24 相当）の最大小節の占有率が **57% → 40%** に低下し、
  他の3小節が広がった。符頭の過度な重なりはなく、`layoutOverflow`/警告
  バナーなし、コンソールエラーなし。両方が密な2小節段（約53〜54%）は
  2小節でほぼ等分のため妥当。
- print-test-score（24小節）は2ページ・全段4小節/段のまま。全音符・2分
  音符を含む段の幅比が 2.7 → 1.8 に縮み、より均等に見える。
