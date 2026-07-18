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
