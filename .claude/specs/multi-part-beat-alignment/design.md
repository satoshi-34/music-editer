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
