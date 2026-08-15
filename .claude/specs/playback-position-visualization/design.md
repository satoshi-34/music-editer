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
