# 設計書: 削除のフィードバックと選択の自動解除（Issue #238）

## 問題

運用者の実機テスト（2026-08-11）で、1小節目の三連符・テンポ表記・運指が**気づかぬうちに消えていた**（Undo で復旧）。

再現の筋道はこうである。

1. 音符をクリックして選択する（青枠が付く）
2. そのまま別の操作へ移る（タブを切り替える／ツールを持ち替える／再生を始める）
3. 入力欄を触っているつもりで Delete / Backspace を押す
4. キーイベントは `window` で受けているため譜面へ届き、**残っていた選択**の音符が消える
5. 画面には何も出ないので、ユーザーは消えたことに気づかない。あとで再生して「勝手に譜面が変わった」と誤認する

問題は2つある。

- **削除が無言である**。何が起きたのか、Undo で戻せるのかが画面から分からない
- **選択が残りすぎる**。解除の手段が Escape キーだけで、モードが変わっても選択が生き続ける

連符を選んでいた場合、消えるのは1音ではなく**グループ全体**（`deleteEventFromMeasures` は連符の一部削除を許さず、同じ長さの休符へ置き換える）なので、被害が大きいわりに気づきにくい。

## 修正設計

### 1. 確認ダイアログは出さない。事後の通知だけにする

削除のたびに確認を挟むと入力のテンポが致命的に落ちる。Undo がある以上、必要なのは「止めること」ではなく「起きたことに気づけること」である。
そこで **`role="status"` の控えめな一時表示**を出し、数秒で自動的に消す。

| 項目 | 決めた値 | 理由 |
| --- | --- | --- |
| 表示位置 | 画面下端の中央（`position: fixed`） | 保存の状態表示（右下・Issue #236）と重ならない位置。譜面の中央には被せない |
| 表示時間 | 4秒（`EDIT_NOTICE_DURATION_MS`） | 保存通知の3秒より少し長い。消えたものを探して譜面へ目を戻す時間を見込む |
| `role` | `status` | 作業に割り込ませない。失敗の警告ではないので `alert` は使わない |
| `pointerEvents` | `none` | 譜面のクリックを一切邪魔しない |
| 印刷 | `@media print` で `display: none` | 画面専用の一時表示。印刷が始まる瞬間に残っていても紙には出さない |
| 連続削除 | 後の通知で上書きし、タイマーを貼り直す | 前のタイマーで早く消えると、最後に消したものが読めない |

文言は必ず「**何を消したか** ＋ **Cmd/Ctrl+Z で元に戻せます**」の形にする。後半が本体で、これが無いと通知が「事故の報告」で終わってしまう。

### 2. 文言は「実際に消えるもの」と一致させる

`utils/scoreEditorNotices.ts` の `describeDeletedNoteEvent` が組み立てる。
分岐は `utils/noteDeletionUtils.ts` の `deleteEventFromMeasures` と**同じ順序**にすること（ずれると、かえって誤解させる）。

| 条件 | 文言 |
| --- | --- |
| 和音のうち1つの符頭を選んでいる（`keys.length > 1` かつ `keyIndex` あり） | 和音の1音を削除しました |
| 連符の中のイベント | N連符グループを削除しました |
| 休符 | 休符を削除しました |
| 和音まるごと | 和音を削除しました |
| それ以外 | 音符を削除しました |

順序が重要なのは**連符の中の和音**である。`deleteEventFromMeasures` は和音の分岐を連符より先に置いている（Issue #223）ため、文言だけ「連符グループ」にすると「グループが消えた」と誤解させる。

弧・松葉・小節範囲もそれぞれ言い分ける（`describeDeletedArc` / `describeDeletedHairpin` / `describeClearedMeasures`）。小節番号は内部インデックス（0始まり）ではなく**画面表記の1始まり**へ直して伝える。

### 3. 選択を解除するイベントの一覧（トリアージの記録要求）

Escape だけでは足りない。**モードが変わる操作**で選択を手放す（#231 の「モード遷移で編集オーバーレイを閉じる」と同じ発想）。

| きっかけ | どこで | 解除するもの |
| --- | --- | --- |
| Escape キー | `PianoSystemCanvas` の keydown（従来から） | 押したときに選ばれていたもの（音符 / 弧 / 松葉のいずれか1つ） |
| **ツールバーのタブ切り替え** | `ScorePage.handleToolbarTabChange` | 音符・弧・松葉のすべて |
| **パレットでのツール変更** | `ScorePage.handleToolChange`（`Palette` の `onChange`） | 同上 |
| **再生開始**（一時停止からの再開を含む） | `ScorePage.handlePlay` の冒頭 | 同上 |
| 他インスタンスが選択を取った | `SELECTION_CLAIMED_EVENT`（従来から） | 同上 |
| 選択中のイベントが外部差し替えで消えた | 描画側の整合処理（Issue #238 と同根、既存） | 音符 |

音符だけでなく**弧（スラー/タイ）と松葉も同時に解除する**。どれも Delete の対象なので、1つだけ残せば同じ事故が形を変えて起きる。

タブ切り替えは「同じタブを押し直したとき」は何もしない（`handleToolbarTabChange` の先頭で早期 return するため）。無意味な解除で選択が飛ぶのを避ける。

**採らなかった案**: 「入力欄にフォーカスがあるときは譜面へ Delete を届けない」。`ScorePage` の小節削除には同種のガード（`tagName` が input/textarea なら無視）が既にあるが、事故の実例は「フォーカスがどこにも無い状態」で起きており、これだけでは塞げない。選択そのものを短命にするほうが根本的である。

### 4. 通知の配線に window の CustomEvent を使った理由

削除を実行するのは `PianoSystemCanvas`（1段 = 1インスタンス）だが、通知を出すのは画面全体を持つ `ScorePage` である。両者のあいだには `SingleStaff` / `PianoStaff` / `QuartetStaff` / `EnsembleStaff` / `PartExtractionStaff` の5つのラッパーが挟まっており、コールバックを props で通すと5ファイルを機械的に書き換えることになる。

`PianoSystemCanvas` には既に「選択はいつも1つだけ」を保証する window イベント（`SELECTION_CLAIMED_EVENT`）の前例があるため、同じ作法にそろえた。イベント名と文言の組み立ては `utils/scoreEditorNotices.ts` に集約している。

- `SCORE_EDIT_NOTICE_EVENT`（`music-editer-score-edit-notice`）… 譜面 → `ScorePage`。`detail.message` を表示する
- `SCORE_SELECTION_CLEAR_EVENT`（`music-editer-score-selection-clear`）… `ScorePage` → 譜面。選択を手放させる

### 5. 通知文は「消す前」に組み立てる

`setPartsScore(prev => ...)` の updater の中で通知を出してはいけない。React は updater を複数回呼ぶことがある（開発時の StrictMode など）ため、通知が二重に出る。

そのため keydown ハンドラ側で、書き換える前の譜面から文言を作ってから `setPartsScore` を呼ぶ。keydown の `useEffect` は `deps: []` で1回だけ登録するので、そのままでは初回レンダーの `partsScore` しか見えない。`selRef` と同じ要領で **読み取り専用の鏡 `partsScoreRef`** を持たせて解決した（書き換えは従来どおり updater 経由）。

## 影響範囲

- `src/utils/scoreEditorNotices.ts`（新規）: イベント名・通知ヘルパー・文言の組み立て
- `src/components/PianoSystemCanvas.tsx`:
  - `partsScoreRef`（読み取り専用の鏡）を追加
  - Delete の4経路（弧 / 松葉 / 声部2の音符 / 声部1の音符）で `notifyScoreEdit` を呼ぶ
  - `SCORE_SELECTION_CLEAR_EVENT` を受けて `selected` / `selectedArc` / `selectedHairpin` を解除する `useEffect` を追加
  - 削除そのもののロジック（`deleteEventFromMeasures` / `deleteVoiceEventFromMeasures`）は**変更なし**
- `src/components/ScorePage.tsx`:
  - `editNotice` state と通知の受け口（`SCORE_EDIT_NOTICE_EVENT` のリスナー）、画面下端中央の表示を追加
  - `handleToolbarTabChange` / 新設の `handleToolChange` / `handlePlay` で `requestScoreSelectionClear()` を呼ぶ
  - 小節範囲の Delete でも `notifyScoreEdit(describeClearedMeasures(...))` を出す
  - `Palette` の `onChange` を `setTool` から `handleToolChange` へ差し替え（「音符・休符」「演奏記号」の2箇所）
- `src/App.css`: `@media print` に `.edit-notice { display: none !important; }` を追加（他の画面専用UIと同じ扱い）
- テスト（新規3件）: `src/utils/scoreEditorNotices.test.ts` / `src/components/PianoSystemCanvasDeleteNotice.test.tsx` / `src/components/ScorePageDeleteFeedback.test.tsx`
- 保存データの形式・削除の結果・描画は一切変えていない（表示と選択の寿命だけの変更）

## 実装中に気づいた、本Issueのスコープ外の点

- **`SaveLoadButtons` の保存インジケータ（画面右下）とは表示枠を分けた。** トリアージには「#236 の保存表示と同じ status 系に乗せる」とあるが、#236 の実装（PR #273）は本ブランチの分岐元 `main` に未マージである。同じ枠を共用すると PR の競合になるうえ、「保存の成否」と「編集で何が起きたか」は意味が違うため、同じ `role="status"` の作法だけそろえて場所を分けた。両方が同時に出ても重ならない（右下と下端中央）。
- **Delete 以外の破壊的操作（ペースト・小節削除ボタン・移調など）は無言のまま**である。同じ通知の仕組みに乗せられるが、本Issueの受入条件の外なので手を付けていない。
