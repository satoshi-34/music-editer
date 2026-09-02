# 再生位置の視覚化

## 背景

再生ボタンで譜面を流しても、どの音符を鳴らしているかが画面から分かりにくかった。
特にサンプル譜でリピートや終止括弧を使い始めると、
「いまどこを再生中なのか」を追えないと体験価値が下がる。

## 方針

- 実音のスケジュールは既存の `PlaybackEngine` に任せる
- 画面側では別途「再生位置タイムライン」を作り、同じ時刻で `currentPosition` を進める
- SVG 上の音符ヒット領域へ `data-measure` / `data-note` を付け、
  `PlaybackHighlight` が現在位置を見つけられるようにする

## 実装

- `playbackPositionUtils.ts`
  - 譜面データ、BPM、拍子から `atMs` つきの再生位置配列を作る
  - リピート記号と 1番括弧 / 2番括弧も既存展開ロジックに乗せて反映する
- `ScorePage.tsx`
  - 再生開始時に位置タイムラインを作ってタイマー予約する
  - 一時停止時は経過ミリ秒を保存し、再開時は残りだけ予約し直す
  - 停止、サンプル切替、背景復帰ではタイマーを安全にクリアする
- `StaffCanvas.tsx` / `PianoSystemCanvas.tsx`
  - 音符ヒット矩形へ `data-measure` / `data-note` を付与する
- `PlaybackHighlight.tsx`
  - `vf-note-hit` もハイライト対象として検索する

## セキュリティ / 安定性

- 視覚更新は UI の `setTimeout` に限定し、音声処理そのものには介入しない
- 停止や背景復帰でタイマーを必ず破棄し、古い予約が次の再生へ混ざらないようにする
- 再生位置タイムラインは譜面データから毎回再計算し、外部入力をそのまま DOM セレクタへ流し込まない

## 実装状況の追記（issue #128, 2026-07-30）

上記の方針・実装計画は本 issue まで `playbackPositionUtils.ts`（タイムライン生成・テスト済み）だけが存在し、`ScorePage.tsx` 側の配線が未着手だった。そのため画面の「N小節目 M音符目」表示が再生中もほぼ先頭のまま動かず、シーク（`handleSeek`）も表示 state を書き換えるだけで実音は動かないという「表示と実音の二重管理」状態が残っていた（issue #108 の指摘）。

今回、計画どおり配線した。

- `ScorePage.tsx` に `positionTimelineRef` / `positionTimeoutsRef` / `totalPlaybackMsRef` を追加
- 再生開始時（`handlePlay` の複数パート分岐）: `referenceMeasures`（`parts[0].measures`。他パートの反復展開もこれを基準にしているため位置表示の基準としてもズレにくい）から `buildPlaybackPositionTimeline()` でタイムラインを作り、`schedulePositionTimeline(0)` で `setTimeout` 予約。単一代表音（空譜面時の C4 ビープ）では小節位置が無いためタイムラインは空にする
- 一時停止 → 再開時: `elapsedMs = totalPlaybackMsRef - remainingPlaybackMsRef` を求め、`schedulePositionTimeline(elapsedMs)` でその時点から先だけ再予約する（`atMs < elapsedMs` の項目はスキップ）
- `clearPlaybackTimer()` に位置タイマーのクリアも統合した。停止・一時停止・音声復旧・サンプル切替・背景復帰など、既存で `clearPlaybackTimer()` を呼んでいた箇所はコード変更なしにそのまま位置タイマーも片付く
- `resetPlaybackClock()` は `positionTimelineRef` と `totalPlaybackMsRef` もあわせて初期化する

### 既知の制限（未対応のまま残す点）

- **シーク（`handleSeek`/`onSeek`）は実音を動かさない。** 現時点でこれを呼び出す UI 要素が存在しない（`PlaybackControls.tsx` に `onSeek` は渡されているが呼び出し箇所が無い、コード上の死経路）。実音側のジャンプには `PlaybackEngine.playParts()`（`SimpleAudioEngine.ts` / `SoundFontEngine.ts`）へ開始オフセットを渡す改修が必要で、これは Web Audio の先読みスケジューリング全体に関わるためブラスト半径が大きい。呼び出し口が存在しない状態でこの改修だけ先に入れてもブラウザで検証できないため、本 issue では見送った。クリックでの途中再生（issue #108 の残り4件のうちの1つ）を実装する際に、シークの UI 契機と実音ジャンプを同じタイミングで実装するのが安全と考える

## 追記（Issue #268, 2026-08-15）: ハイライトを「符頭の色替え」から「背面の縦帯」へ

### 問題

#128 で位置タイムラインを配線したあとも、`PlaybackHighlight` の見せ方そのものは初期実装のままだった。実機（月光1〜9小節・`docs/qa/regression/moonlight-bars1-9.score.json`）で再生して測ったところ、次の4点が分かった。

1. **選択と見分けが付かない。** ハイライトは `fill: rgba(0, 123, 255, 0.3)` / `stroke: #007bff` の**青**で、選択中の音符の枠（`.vf-note-selected` の `#1d4ed8`）と同系色だった
2. **当たり判定 rect そのものを書き換えていた。** `.vf-note-hit`（本来 `fill="transparent" stroke="none"` の透明矩形）に色を直接書き込み、消すときに元の属性へ戻す方式。消し損ねると譜面に青い矩形が残る作りで、実際 `ScorePage` が `PlaybackHighlight` を**ページの繰り返しの中**に置いていたため、複数ページの譜面では同じ要素を人数ぶん奪い合い、2つ目以降のインスタンスが「青くなった状態」を"元のスタイル"として記録してしまう経路があった
3. **多段譜で1つの符頭しか光らない。** `noteElements[0]` だけを見るので、右手が鳴っていれば左手側には何も出ない
4. **無関係な音符に当たる可能性があった。** 検索セレクタに `g.vf-stavenote:nth-child(N)` が混ざっており、「N番目の子要素」という音楽的に意味のない条件で別の音符を掴めた（`data-measure` / `data-note` を持つ実体が見つからなかったときの保険だが、StaffCanvas が廃止されて描画が `PianoSystemCanvas` に一本化された今は不要）

### 修正設計

**方式**: 符頭の色は一切触らず、**段（system）の `<svg>` の先頭に半透明の `<rect>` を1本差し込む**。

- 差し込み先を「先頭の子」にするのが要点。SVG は後に描いたものが手前に来るので、先頭に置けば五線・符頭・当たり判定より必ず背面になり、音符が帯に隠れない
- **横幅** = いま鳴っている音符の符頭の実描画範囲（`data-note-left` 〜 `data-note-right`）± `DEFAULT_BAND_PADDING_X`（既定 7・SVG 内部座標）。当たり判定 rect の幅は隣の音符との中間点まで広がっているので、そのまま使うと帯が音符1つぶんよりずっと太くなる
- **縦幅** = その段にある `.vf-note-hit` すべての外接範囲。`PianoSystemCanvas` は1つの `<svg>` に**その段の全パート**を描くため、これで帯が段の上から下までを貫く。片方のパートにしか音が無い拍でも帯の高さが変わらない（ちらつかない）ので、Issue の「多段譜では同時刻の全パートを同時に示す（帯方式なら1本で済む）」をそのまま満たす
- **色**: `rgba(245, 158, 11, 0.35)`（琥珀色）。選択の青と色相で分ける。輪郭線は付けない（五線・符頭と競合する線を増やさないため）
- **`pointer-events: none`**（属性と CSS の両方）。再生中でも譜面をクリックして編集できる
- 幾何計算は `src/components/playbackHighlightUtils.ts` に純関数として切り出した。`getBoundingClientRect` ではなく **rect の属性**（`x`/`y`/`width`/`height`/`data-note-*`）から計算するので、レイアウトを持たない jsdom のテストでも実機と同じ数値で固定できる
- 再生位置は `isSelectorSafeIndex()`（非負の整数だけを通す）を経由してから属性セレクタへ入れる。「外部入力をそのまま DOM セレクタへ流し込まない」という本設計書の方針の明文化

**配線**: `ScorePage.tsx` の `<PlaybackHighlight>` を**ページの繰り返しの外**へ移した。このコンポーネントは `return null` で自分では何も描かず、`document` 全体から `.score-area` を探して帯を差し込むため、ページごとに置く意味が無いどころか上記2の消し残しの原因になる。

**印刷**: 帯は半透明の塗りを持つため、`@media print` / `.print-preview` の「`fill="none"` でない rect は黒く塗る」ルール（Issue #203 で `.symbol-hit-region` が踏んだのと同じ穴）に落ちる。`:not(.vf-playback-band)` を除外条件へ加えたうえで、`display: none` で明示的に印刷から外した。

**停止で必ず消えること**: `isPlaying === false` で自分が作った rect を `remove()` する。一時停止・停止に加えて、背景復帰（`visibilitychange` → `resetAudioAfterBackgrounding` が `setPlaybackState('stopped')`）でも同じ経路を通るため、#128 のタイマー破棄方針にそのまま乗っている。アンマウント時も同じ後始末をする。

### 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/components/playbackHighlightUtils.ts` | 新規（帯の幾何計算・純関数） |
| `src/components/PlaybackHighlight.tsx` | 描画方式を差し替え。`PlaybackPositionIndicator` は無変更 |
| `src/components/ScorePage.tsx` | `<PlaybackHighlight>` をページの繰り返しの外へ1つだけ置く |
| `src/App.css` | `.vf-playback-band` の追加、`.playback-highlight` から青い影を除去、印刷の除外条件2か所 |
| `README.md` | 「音符再生」に帯の説明を追記（ユーザーから見える画面が変わったため） |

`PianoSystemCanvas` と `playbackPositionUtils` は**1行も変えていない**（Issue の「既にある土台を作り直さないこと」に従い、`.vf-note-hit` の `data-measure` / `data-note` と位置タイムラインをそのまま使う）。

### 実機で測った値（月光1〜9小節・Chromium・画面ズーム 160%）

- 帯は1本だけ出る（1ページ・3ページのどちらでも `rect.vf-playback-band` は常に 1 個）
- 帯は段の `<svg>` の `firstChild`。SVG 内部座標で `y=30`・`height=180`（上段の当たり判定の上端〜下段の下端）
- 帯の上に `document.elementsFromPoint` を打つと `rect.vf-note-hit` が返る（帯はクリックを奪っていない）
- 一時停止・停止で `rect.vf-playback-band` は 0 個になり、`.vf-note-hit` 90個の `fill`/`stroke` は `transparent`/`none` のまま（譜面に色が残らない）
- 印刷プレビューでは帯の `display` が `none`（黒い矩形にならない）

### 分かった既存の挙動（本 issue のスコープ外）

- **再生を始めると音符の選択（青枠）は解除される**（Issue #238 で入った仕様。`docs/REGRESSION.md` I 節に手動チェック項目がある）。そのため帯と選択枠が同時に画面に出ることは通常なく、色を分けたのは「操作の途中でどちらの状態か迷わない」ための保険という位置づけになる
- 自動スクロール（`window.scrollTo`）は #128 当時のまま。帯が画面外の段へ移ると窓がスクロールして帯が見える状態になることを実機で確認した

### 既知の制限

- **再生中に譜面が再描画されると、その拍のあいだだけ帯が消える。** `PianoSystemCanvas` は再描画で `<svg>` を作り直す（`innerHTML=''`）ため、差し込んだ帯も一緒に消える。次の音符へ進んだ時点で描き直されるので自己修復するが、レイアウト設定を再生中に動かすと1音ぶんちらつく。帯を React 側で持つ（VexFlow の SVG の外へ重ねる）作りにすれば消えないが、段ごとの座標系を親へ持ち上げる改修になるため本 issue では見送った
- 帯は**符頭の位置**を示すので、和音の中のどの音が鳴っているかまでは区別しない（同時に鳴るので区別する必要が無い）

## 追記（Issue #411, 2026-09-03）: 鳴っている全声部を光らせる

### 問題

#268 で帯方式にしたあとも、帯を置く位置は `.vf-note-hit[data-measure][data-note]`（＝**編集中レイヤーの当たり判定**）からしか求めていなかった。#316 のレイヤー明示選択によって `.vf-note-hit` は「アクティブなパート×声部」の音符にしか作られないため、

- 左手（非アクティブなパート）だけが鳴っている拍では帯が出ない
- 右手の声部2が伸びていても、帯は声部1の音符の位置にしか出ない

という状態になっていた。運用者裁定（2026-09-02）で「再生ハイライトは選択中レイヤーに関係なく、鳴っている全声部の音符に出す」と確定したため、これを直す。

原因はもう1つあり、タイムライン（`buildPlaybackPositionTimeline`）自体が**基準パートの主声部のイベントだけ**を節目にしていた。主声部が休んでいる拍で他声部が鳴っても、そもそも画面を更新する時刻が存在しなかった。

### 修正設計

**1. どこに何が描かれているかの手がかり（DOM 属性）**

`PianoSystemCanvas` の当たり判定 rect へ属性を足した（描画・クリック判定は 1px も変えていない）。

| クラス | 足した属性 | 理由 |
| --- | --- | --- |
| `.vf-note-hit`（アクティブ声部） | `data-part` / `data-voice` | 大譜表の右手と左手はどちらも声部0・同じ音符番号になり得るので、小節・音符番号だけでは区別できない |
| `.vf-inactive-voice-note-hit`（それ以外・#258 で既存） | `data-part` / `data-note-left` / `data-note-right` | 帯の幅は「符頭の実描画X範囲」を基準に引くため。アクティブ声部と同じ属性名・同じ意味でそろえる |

非アクティブ声部の当たり判定そのものは #258 で既に全声部ぶん作られていたので、**新しい台帳は作っていない**（#411 本文が想定していた「#409 の台帳の型を流用」は不要だった）。

**2. タイムライン（`playbackPositionUtils.ts`）**

`buildPlaybackPositionTimeline` に第7引数 `highlightParts`（`{ partIndex, measures }[]`・**展開前**の小節列）を足した。渡されたときは:

- 各パートを基準パートと同じ反復順へそろえる（実音と同じ `expandMeasuresForPlaybackWithReference`。別々に展開すると2周目でパートごとにズレる）
- 「パート×声部」を1レーンとして、各レーンの音符を `{開始拍, 終了拍, 音符番号}` に展開する。スウィング判定は**グローバル拍子一律**（round1 P2: 実音エンジンは isCompoundMeter をグローバル拍子から全小節一律で受け取るため、表示も同じ規則にそろえる。表示は実音に合わせるのが正）
- **どれかのレーンで音が始まる拍と終わる拍**をすべて節目にする（round1 P1: 開始拍だけだと「四分音符+休符3拍」で帯が小節末まで残る。主声部が休んでいる拍でも画面が動く）
- 各節目で「開始 ≤ その拍 < 終了」のレーンを集め、`PlaybackTimelineItem.targets` に載せる。伸ばしている音は鳴り終わるまで光り続け、鳴り終わりの節目では `targets: []`（=全帯を消す指示）になる
- **小節終端ちょうどの消灯節目も残す**（round2 P1: 次小節が休符で始まる場合、次小節頭に節目が無く、削ると前小節の帯が次の発音まで残る）。次小節頭に発音があるときは同じ atMs に2項目並ぶが、タイムラインは配列順に適用され**後の項目が最終状態**になる（後勝ち規則）ため上書き問題は起きない。回帰テスト: 「全音符→次小節1拍休符始まり」（playbackPositionUtils.test.ts）
- 節目×レーンの突き合わせは、節目をソートしレーンごとの読み位置カーソルを前進させる走査で **O(N log N)**（round1 P2: 総当たりだと最悪二乗で、密な長い譜面ではタイムライン計算の遅延がそのままハイライトの遅れになる）。同じ理由で、タイムライン構築は `playParts` の **await 前**に行う（実音の予約後に同期計算すると計算時間ぶん 0ms 起点が遅れる）

`highlightParts` を渡さない従来の呼び出しでは `targets` を付けず、終了拍の節目も足さない（既存の呼び出し元・テストのタイムラインの形は変わらない）。`targets` の3値: `undefined`=従来互換（位置から1件探す）/ `[]`=全帯を消す / 1件以上=その音符へ帯。位置表示（`N小節目 M音符目`）は従来どおり基準パートの主声部で数え、その拍で主声部が鳴っていなければ直前の番号を保つ（他声部だけの拍で番号が 0 へ飛ばないようにするため）。

`partIndex` は**描画側の段の番号**（`layoutParts` の並び）で、DOM の `data-part` と一致する。再生対象の `parts` から段番号を引くのは「小節配列の同一性（`===`）」で行う。`layoutParts` と再生の `parts` は同じ配列（`rightHandData` など）を指しているので、譜種ごとの並べ替え規則をここへ書き写さずに対応が取れる（引けなかったパートは対象から外す。別の段の音符を光らせるより光らない方が誤解が少ない）。

**3. 帯の描画（`PlaybackHighlight.tsx` / `playbackHighlightUtils.ts`）**

- 探すセレクタに `.vf-inactive-voice-note-hit` を加え、`data-part` / `data-voice` まで指定して1音ずつ引く
- 帯は **1音ごとではなく「横位置のかたまり」ごと**に引く（`computePlaybackBandBoxes`）。和音や縦にそろった拍は従来どおり1本にまとまり、右手と左手が別の拍を弾いているときだけ帯が増える。重なったまま2本引くと半透明が二重になり、そこだけ色が濃く見えてしまうため
- 縦（`y` / `height`）の規則は #268 から変えていない（段の当たり判定すべての外接範囲＝段の上から下までを貫く）。ただし外接範囲の計算対象に `.vf-inactive-voice-note-hit` も含めたので、非アクティブなパートしか音符が無い段でも高さが痩せない
- 既存の `computePlaybackBandBox`（1本ぶん）は `computePlaybackBandBoxes` へ委譲するだけにした（同じ幾何計算を2か所に書かないため）
- 再描画の判定に「対象の一覧」も加えた。同じ音符番号のままでも顔ぶれが変わる拍（右手が伸ばしているあいだに左手だけが動く）で帯が更新されないのを防ぐ

**4. 配線（`ScorePage.tsx`）**

`currentPosition` state に `targets` を持たせ、位置と一緒に**必ず同時に**更新する（別々の state にすると、片方だけ先に反映された瞬間に別の拍の音符が光る）。位置を 0 に戻す既存の経路は `targets` を付けないので、停止時に光ったままにはならない。

`layoutParts` の定義は `handlePlay` より後ろにあるため、依存配列へ直接書くと初期化前参照になる。`layoutPartsRef`（レンダー中に最新値を入れる箱・`onLibraryReadyRef` と同じ手口）で渡している。

### 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/utils/playbackPositionUtils.ts` | `PlaybackHighlightTarget` / `PlaybackHighlightPartSource` を追加。タイムラインをレーン方式へ（節目＝全声部の音の開始） |
| `src/components/playbackHighlightUtils.ts` | `computePlaybackBandBoxes` を追加。`computePlaybackBandBox` は委譲へ |
| `src/components/PlaybackHighlight.tsx` | `highlightTargets` プロパティを追加。非アクティブ声部の当たり判定も探し、帯を複数本引く |
| `src/components/PianoSystemCanvas.tsx` | 当たり判定 rect へ `data-part` / `data-voice` / `data-note-left` / `data-note-right` を追加（属性だけ） |
| `src/components/ScorePage.tsx` | `highlightParts` を組み立ててタイムラインへ渡し、`targets` を `PlaybackHighlight` まで運ぶ |

### 受入テスト

- `src/utils/playbackPositionUtils.test.ts`: 2声＋左手で「伸びている音が鳴り続けているあいだ光る」「主声部が休んでいる拍でも節目になる」「`highlightParts` なしでは `targets` を付けない（後方互換）」
- `src/components/playbackHighlightUtils.test.ts`: 横位置が離れた音符は帯を分け、重なる音符は1本にまとめる
- `src/components/ScorePageMultiVoicePlaybackHighlight.test.tsx`: 実マウントの配線テスト（運用者裁定の受入条件）。2声のピアノ譜を再生し、右手声部1の2拍目の音・伸びている右手声部2・左手のすべてが帯に覆われることを確認する

### 声部3以上について

`targets` は `getMeasureVoices()` が返す声部を素直に全部たどるので、声部数の決め打ちは無い（`voiceIndex` は number のまま）。ただし**声部3以上を画面へ入力する UI は #417 待ち**で、本 issue の実測は2声までで行った。#417 のマージ後に3声で一巡確認すること。

### 既知の制限

- #268 から引き継ぎ: 再生中に譜面が再描画されると、その拍のあいだだけ帯が消える（`<svg>` が作り直されるため。次の音符で自己修復する）
- 帯の縦は段全体を貫いたままなので、「どの段の音か」は帯の横位置で読む形になる（パートごとに高さを分けるかは、多声UI（#417）が入って画面の見え方が固まってから判断するのが安全と考え、本 issue では #268 の規則を変えなかった）
