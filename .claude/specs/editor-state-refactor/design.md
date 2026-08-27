# 設計書: 編集状態の責務分離（Issue #244 段0）

対象: `src/components/PianoSystemCanvas.tsx`（2026-08-21 時点で 7,416 行）とその周辺。
実装主体はレビュアー（セッション内・1段=1PR）、コードレビューは外部AI（Codex）、マージ判断は運用者。

## 0. なぜ今やるか

- 2026-08-20、同一ファイルを触る4本のPR（#326〜#329）が連鎖衝突し、1本マージするたびに手動解消が必要だった。「編集の入口が1ファイルに集中している」構造税が、開発速度そのものを削り始めている
- 実機テスト起因のバグ群（#231 オーバーレイ掃除漏れ・#238 無言Delete・#313/#315/#319 段またぎ初期不良の連鎖）は個別修正で潰したが、**同型のバグを構造的に再発させる土壌**（状態の持ち主の分散・分岐の二重実装・暗黙の描画順序契約）は残っている
- 安全網は張り終えている: 月光回帰 fixture（#243）、段またぎ回帰（REGRESSION.md K〜Q）、通知系テスト群

## 1. 現状の実測（2026-08-21 調査。詳細な表は本節末尾の付録参照）

- **状態**: useState 14・useRef 32（うち9本は props/state の単純ミラーで、同期用 useEffect が9個並ぶ）・モジュール可変変数2（`selectionOwnerSeq` / 連符クリップボード）・window CustomEvent 4種
- **オーバーレイ9種のライフサイクルが不揃い**: `symbolResize/Offset/AdjustPicker` はツール切替で閉じるが、`timeSig/keySig/clef/bpm/rehearsal/text` は閉じない。削除連動を持つのは `text` だけ
- **同一分岐の二重実装**: `measureTempo/TimeSig/Clef/KeySig/Rehearsal`・`repeat`・`ending`・`tie|hairpin` の8モードは、小節背景（.vf-hit）と音符（.vf-note-hit）のハンドラにほぼ同一コードが2本ずつある
- **分岐スタイルの断絶**: 音符 click は 5136 行目を境に「早期 return 連鎖」から「15個のフラグ変数」へ切り替わる
- **無言 return が27箇所**（#318 の棚卸しで判明。通知対応済みはうち一部）
- **描画 effect（2408-6610）に cleanup が無い**: リスナー解放は `innerHTML=''` に暗黙依存。`arcDragContextRef` はアンマウント後も古い SVG を保持
- **Pass 1 は `partsScoreForRender`（下書き込み）、Pass 3 のハンドラは `partsScore` を読む**: 表示と編集対象が別配列
- **`measure.events` 直読みが 109 件**: 読みは `getVoiceEvents` へ寄ったが、レイアウト計算・再生・MIDI/MusicXML出力・空判定は**声部1固定**のまま。`noteDeletionUtils` と `fillPriorMeasureRests` には破壊的書き込みが残る

## 2. 目標形（4つのモジュール + データモデル統一）

```
src/editor/
  editorState.ts      … 編集状態の reducer（selection/overlay/drag を1か所に。tool は ScorePage 所有のまま参照のみ）
  editorActions.ts    … 遷移関数（アクション）と掃除規則
  hitResolution.ts    … クリック→(パート, 声部, 拍, 対象)の純関数解決 + モード分岐テーブル
  renderPipeline.ts   … Pass 1/2/3 と台帳を関数化した描画ビルダー
src/utils/voiceMeasureUtils.ts … scoreModel（voices[] 統一の正規経路）を拡充
```

### 2-1. editorState（reducer）と所有境界（Codexレビュー指摘3への回答）

**reducer は Canvas 1インスタンスにつき1つ（システム段ローカル）**。ページ全体で1つにはしない。

| 所有者 | 状態 | 理由 |
| --- | --- | --- |
| ScorePage（現状のまま） | `tool` / `activeVoiceIndex` / `selectedMeasures` | 既に親所有の controlled state で、小節コピペ・挿入削除・移調が親の機能。**段1〜4 では所有を動かさない** |
| Canvas ローカル reducer | `selection`（note/arc/hairpin）/ `overlay` / `drag` | オーバーレイ座標・ドラッグセッションは各段の SVG/コンテナ座標系に閉じており、段をまたがない |

- `selection` union は `{kind:'note'|'arc'|'hairpin'|'none'}` とする。**`measures` は reducer に入れない**（親所有のまま。表示・分岐で両方を見る場所には `resolveSelectionView(local, selectedMeasuresProp)` の読み取りヘルパーを置く）。#333 の `beatRange` も小節選択と同じく**親所有側**に置く想定（全パート縦スライスのため）
- 段間の排他（`SELECTION_CLAIMED_EVENT`）は**段1〜4 では現行のまま維持**する。ページ所有へ引き上げてバックチャネル自体を消す案は、段5 以降の任意課題として別途裁定（reducer をページへ移すと overlay/drag に Canvas 識別子を持たせる再設計になり、機械的移動の範囲を超える）
- `overlay`: 段1では**9個の nullable を1つの record**（`{timeSig: ... | null, keySig: ... | null, ...}`）へ機械的に集約するだけ。**排他 union 化は段2**（指摘1参照）
- `drag`: 弧CP/端点・小節範囲・タイ/松葉の3セッションを1 record へ（同じく段1は機械移動のみ）

### 2-2. 遷移関数と掃除の一元化（#231/#238 の恒久化）

掃除を「イベントに応じた reducer の遷移」として宣言的に書く:

| イベント | 掃除される状態 |
| --- | --- |
| `TOOL_CHANGED` | overlay 全種・drag 全種・（選択は #238 どおり維持/解除の既存仕様に従う） |
| `SCORE_REPLACED`（外部差し替え） | selection の整合チェック・overlay のうち対象消失分 |
| `EVENT_DELETED` | 対象を指す overlay・selection |
| `SELECTION_CLAIMED`（他段が選択） | 自段の selection |
| `PLAYBACK_STARTED` | selection・overlay・drag |
| `GLOBAL_POINTER_UP` / `POINTER_CANCEL`（window レベル） | drag 全種（**既知の「SVG外 mouseup で tieStartRef が残る」残留はこの行の実装＝段2で直す**。段0.5 では現状の残留挙動を characterization として固定しておき、段2 で期待値を差分表つきで更新する） |

これにより「オーバーレイ9種のライフサイクル不揃い」は**表の1行を足すだけ**の問題になる。

### 2-3. hitResolution（純関数 + 分岐テーブル）

- `resolveHit(click, policy) → {partIndex, voiceIndex, measure, eventIndex?, keyIndex?, beat?, zone}` を純関数に。#219 の帯域クリップ・#320 の符頭縮小・#327 の拍台帳をここへ集約
- **resolver の入力に「解決ポリシー」を明示する**（Codexレビュー指摘への対応）: `policy = {attribution: 'band' | 'explicitLayer', activeLayer?: {partIndex, voiceIndex}}`。現行は `'band'`（帯域推測+アクティブ声部）固定。**#316 はこの policy に `'explicitLayer'` を実装して差し替える**（未決の空白クリック方針=#316 論点②は、その実装時に policy の分岐として裁定を受ける。「差し替えるだけ」で済むのは入力をここまで明示した場合に限る）
- モード分岐を**テーブル駆動**へ: `(tool.mode, 対象種別[小節背景|音符|休符|placeholder|非アクティブ]) → 結果` の表を1枚に。結果は生のコールバックではなく
  `handled(action) | rejected(reason, guidance) | passThrough` の**3値の判別 union** とする（Codexレビュー提案の採用）。`rejected` は #318 の通知（理由+次の一手）へ機械的に接続され、**「無言 no-op」は型の上で書けなくなる**。意図的に黙る場合だけ `passThrough(コメント必須)` を使う
- #333（拍範囲スライス）は `resolveHit` の拍解決（#327 台帳）をそのまま使う

### 2-4. renderPipeline（描画ビルダー）

- Pass 1（パート別 preFormat）/ Pass 2（合同 Formatter）/ Pass 3（描画+ヒット領域）を入出力明示の関数へ。12本の記号 Entries と4つの台帳 Map は**ビルダーの戻り値**にし、`let` の寄せ集めをやめる
- effect に cleanup を追加（リスナー解放・`arcDragContextRef` の破棄）
- Pass 1 と Pass 3 の**状態源を `partsScoreForRender` に統一**（食い違いの解消。挙動差が出るのは矢印キー下書き中のクリックのみで、その場合は下書き値基準が正しい）
- cross-staff 段2（またぎ連桁）は、このビルダー化で「ビーム構築が1関数」になってから着手する

### 2-5. voices[] 統一（データモデル。運用者承認済みの検討項目）

- 方向: `measure.events` を「voices[0] のミラー」から**読み取り専用のレガシー窓**へ格下げし、最終的に廃止。読み書きは `getVoiceEvents` / `withVoiceEventsUpdated` に一本化
- **順序は write → 不変条件 → read → 保存形式**（Codexレビュー指摘2で当初案の read 先行から反転。現在の正本は `measure.events` — `getVoiceEvents(...,0)` は events を返し、`withVoiceEventsUpdated(...,0)` は events のみ更新、voices[0] は保存時同期（storage.ts:813-816）— であり、read を先に voices[0] へ向けると**旧 write 経路の編集後にレイアウト・再生・出力が古い voices[0] を読む回帰**が起きるため）:
  1. **write の正規化**: 全書き込みを正規 API へ寄せ、正規 API を **dual-write**（events と voices[0] を常に同時更新）へ。破壊的書き込み（`fillPriorMeasureRests` PSC:497-500・`noteDeletionUtils.ts:102,289,299`）もここで根絶
  2. **不変条件の確立**: 「編集後は常に events ≡ voices[0]」を assert するテストで固定（往復含む）
  3. **read の切り替え**（この中の順は実害順: 空判定/内容判定 ScorePage:332,358 → レイアウト幅計算 → 再生/再生位置 → MIDI/MusicXML出力。**声部2が MIDI に出ていない**のは既知バグとして別Issue化してよい）
     - **移行境界（Codex再レビュー指摘への対応）**: 現行では**単声部小節は `voices` を持たないのが正規状態**であり（`getMeasureVoices` が events から仮想 voice1 を合成: voiceMeasureUtils.ts:69-73、保存時同期も voices が無ければ追加しない: 同:89-92）、dual-write が voices[0] を作るのは**編集された小節だけ**。そのため read 切替は「voices[0] を直接読む」形にせず、**移行期間中の正規 read API を `voices[0]?.events ?? events` のフォールバック付き**で実装する（events-only の未編集小節から音符が消える回帰を構造的に防ぐ。全流入境界の正規化を狩り集める方式より、アクセサ1か所のフォールバックのほうが漏れが出ない）。フォールバックの除去は 4. の保存形式移行（全小節が voices を持つことが保証されて）以後
     - このサブ段のテストは **events-only / voices あり / 両形式が混在 / 一部小節だけ編集済み** の4形を必ず含める
  4. **保存形式**: 読込互換は維持（旧形式→正規化は #305 系の既存直列に追加し、**読込時に全小節へ voices を実体化**する）。保存の新形式化とフォールバック除去は最後
- **「2」を焼き込まない（正確な射程。Codex 3巡目の指摘で表現を修正）**: **データモデルと正規 API は N 声対応とし、3・4声追加時に保存形式の再設計を不要にする**。ただし「UI 追加だけで済む」わけではない — 実際の 3・4声対応では UI（声部セレクタは現状 `useState<0|1>`+ボタン2個固定）・符幹/衝突回避（現状「voice0=上・残り全部=下」の固定式: voiceMeasureUtils.ts:256-277。**声部ごとの表示ポリシーへ分離**が必要）・再生・MIDI/MusicXML 出力（現状 `voices[1]` を明示参照: musicXmlExport.ts:326-347）を**別途 N 声化**する。段5 の仕事は「その日が来ても器とコアを触らずに済む」ところまで
- **段5 の完了条件（N 声観点）**:
  - コア処理（scoreModel・レイアウト・再生・出力）に `voices[1]` の直接参照が残っていない（全声部ループへ置換。UI の2声制約は UI 境界にのみ残る）
  - `activeVoiceIndex` はコア API では `number`（`0|1` の型は ScorePage/Palette の境界のみ）
  - 符幹方向の決定が固定式ではなく声部ごとの表示ポリシー関数に分離されている（3声のときの中声の扱いはポリシーの追加で済む形。実装は不要）
  - 声部3・4 のデータについて **保存往復・編集・削除・描画・再生・MIDI・MusicXML** のテストがある（描画/再生は「壊れず全声部が出る」水準でよく、浄書品質は将来課題）

## 3. 段割り（1段 = 1PR。各段とも「挙動ゼロ差」または「差分を明記」）

| 段 | 内容 | 挙動差 | 主な検証 |
| --- | --- | --- | --- |
| 段0.5 | **characterization テスト**を先に張る（Codexレビュー提案の採用）: 複数オーバーレイの同時開き・複数Canvas間の選択移譲（SELECTION_CLAIMED）・外部 score 差し替え時の整合・SVG外 mouseup のドラッグ残留・再生開始時の掃除、の現行挙動を「仕様としてではなく現状として」固定 | ゼロ（テスト追加のみ） | 追加テスト自体が緑 |
| 段1 | 散在 state の機械的移動: ミラー ref 9本→最新値 ref 1本、selection 3 state→**record**（union 化は段2。オーバーレイと同じ判断: 現行の排他はハンドラの明示クリアで実現されており union は挙動変更）、**overlay 9 state→1つの nullable record（排他 union にはしない）**、drag 6 ref→1 record | ゼロ（record 化なら同時開き等の現行挙動も保存される。**union 排他化は段2へ**） | 全テスト+段0.5・月光回帰・実機スモーク（選択/オーバーレイ/ドラッグ/コピペ） |
| 段2 | **reducer 導入**（段1 実装時の判断で段1から移動: 遷移を集約しない段階で reducer を入れても「中身のない箱」を段2で書き直すことになるため、遷移関数化と同時に導入する）+ 遷移関数化と掃除の一元化（§2-2 の表を実装）。**overlay / selection の排他 union 化**とライフサイクル統一はここ | **あり（明記）**: 小節メタ系オーバーレイもツール切替で閉じる・別オーバーレイを開くと前のは閉じる等。差分は表で列挙し運用者承認 | 掃除タイミングのテーブルテスト・段0.5 の期待値更新（変更点=差分表と一致することを確認） |
| 段3 | hitResolution 純関数化 + モード分岐テーブル化（二重実装8モードの一本化・`handled/rejected/passThrough` の3値型で無言 no-op を型から排除） | ゼロ（#318 通知は既存のまま移設） | クリック系テスト全部・#320/#327 の回帰 |
| 段4 | renderPipeline ビルダー化 + cleanup + 状態源統一 | ほぼゼロ（状態源統一のみ差分明記） | 月光回帰レンダー・段またぎ回帰・目視 |
| 段5 | voices[] 統一（**§2-5 の順: write 正規化+dual-write → 不変条件 → read 切替 → 保存形式**の4サブ段） | サブ段ごとに明記（声部2の再生/出力はバグ修正として差分が出る） | events≡voices[0] 不変条件テスト・往復（保存→読込）等価テスト・再生/出力の声部2テスト |

順序の根拠: 段1-2 が「状態」、段3 が「入力」、段4 が「出力」、段5 が「データ」。#316/#333 は段3 の後、cross-staff 段2 は段4 の後に着手可能になる。

## 4. 進め方の約束

- コード着手は **#330/#331 のマージ後**（同一ファイルのため）。以後、段割り完了まで PianoSystemCanvas を触る ai-ready は新規起票しない
- 各PRは: フルテスト + lint:ratchet 基準値 + 実機スモーク（⇵/コピペ/通知/選択）を本文に記録。Codex がレビューし、運用者がマージ
- **撤退条件**: ある段で挙動差の回帰が出て2日で収束しない場合、その段のPRを revert して段割りを見直す
- main は常に出荷可能に保つ（#285 の清書・弟ハンズオンと並行できる）

## 5. スコープ外（この構想でやらないこと）

- 機能追加（#316/#333/cross-staff 段2 の実装そのもの。土台を作るだけ）
- 見た目・浄書品質の変更
- StaffCanvas（単旋律）との共通化（`staffcanvas-pianosystemcanvas-shared-logic` 構想は別線。ただし段3/4 のモジュールは共用できる形で切る）

## 付録: 実測の詳細

調査ログ（状態32本の持ち主一覧・クリック分岐の全行番号・events直読み109件の内訳・描画パスの台帳一覧）は Issue #244 のコメントに全文を添付する。本書では設計判断に必要な要約のみを本文へ残した。

## 6. 段0.5 の実装記録（2026-08-21）

`src/components/PianoSystemCanvasCharacterization.test.tsx`（5件）として実装。期待値はすべて**実行して観測した現状**を固定したもので、仕様ではない。

### 観測による設計メモの訂正

- **「別種のオーバーレイを開くと同時に2つ存在できる」は誤りだった**。実際は、新しいオーバーレイの autoFocus が先の入力からフォーカスを奪い、blur の確定処理が走って先のものが閉じる — つまり**偶発的な排他**が既に存在する。段2の排他 union 化は「偶発的な排他を明示の遷移へ置き換える」ことになり、目に見える挙動差は「ツール切替でも閉じるようになる」（調整系3種との非対称の解消）に実質限定される。段2の差分表はこの理解で作る
- タイの SVG外 mouseup 残留は観測どおり: 開始点が残り、**新しい mousedown なしに別の音符上の mouseup だけでタイが確定**する（テスト4で固定。段2の GLOBAL_POINTER_UP で修正予定）
- SELECTION_CLAIMED による段間の選択一意・外部差し替え時の選択解除・SCORE_SELECTION_CLEAR_EVENT の掃除は調査どおりに動作

### テストを書く際の道具（段1以降でも使う）

- SVG は選択・編集のたびに `innerHTML=''` から作り直されるため、**参照を持ち回らず `currentSvg(container)` で毎回掴み直す**（既存 ClickCycle テストの作法）
- 小節背景クリックは rect 自身の x/y 属性から座標を作る（TupletHideNumber テストの作法）

## 7. 段2 の実装記録（2026-08-21）

運用者承認済みの差分表（5行）どおりに実装した。PR は段2a（reducer+排他union・挙動差ゼロ）と段2b（承認済み挙動変更）の2コミット構成。

### 実装

- **reducer**: `editorLocalReducer`（selection union + overlay union の2フィールド）。アクションは
  `SELECTION_SET` / `OVERLAY_SET`（従来 setter 相当・同値 bailout 維持）+ 掃除の3遷移
  `TOOL_CHANGED`（オーバーレイ全種キャンセル）/ `CLEAR_ALL`（選択+オーバーレイ）/ `SELECTION_CLAIMED_BY_OTHER`
- **§2-2 の表との対応**: TOOL_CHANGED=toolIdentityKey effect / CLEAR_ALL=SCORE_SELECTION_CLEAR_EVENT
  リスナー（タブ切替・ツール変更・再生開始）/ SELECTION_CLAIMED=専用リスナー /
  GLOBAL_POINTER_UP・POINTER_CANCEL=window リスナー（掃除対象は tieStart のみ。
  arcCp/arcEp/measureAnchor は既存の window 掃除があり、arcMoved/measureMoved は
  「直後の click を読み飛ばす」ため mouseup 後も意図的に生存させる）
- **EVENT_DELETED / SCORE_REPLACED** の掃除は従来実装（2158-2161 / 整合 effect）をそのまま維持
 （reducer 遷移への移設は必要になったときでよい。動いているものの置き換えは目的ではない）

### 検証と観測

- 段2b 適用時、**割れたテストは characterization の 1 と 4 だけ**＝変更は差分表の予告どおりで
  他への波及なし（段0.5 の狙いがそのまま機能した）
- テスト4 は「残留しない」+「正規のドラッグ確定は従来どおり」の両方を固定する形へ更新
- 二クリック式のタイ（Aをクリック→Bをクリック）はもともと存在しない
 （SVG 内 mouseup/click が従来から tieStart を掃除している）ため、window 掃除の追加で
  失われた操作は無い

## 8. 段2 レビュー指摘の反映記録（2026-08-21〜22・PR #339）

段2 の差分表（§2-2）は「TOOL_CHANGED / CLEAR_ALL は掃除の遷移」と書いていたが、初回実装は
reducer の中（selection / overlay）しか掃除しておらず、**進行中のドラッグ（`dragSessionsRef`）が
残る**経路が残っていた。レビューで4点指摘され、順に反映した。

### 問題（指摘された経路）

1. **ツール切替 / CLEAR_ALL でドラッグが残る**: 数字キー・R キーのツール切替は ScorePage の
   window keydown から `setTool` を直接呼ぶため、**弧のハンドルを押したまま**ツールを替えられる。
   旧実装では `arcCp`/`arcEp` が残り、切替後の mousemove/mouseup が新ツールの下で弧編集を継続・確定していた
2. **pointercancel の掃除が `tieStart` だけ**: 弧・小節アンカーが残留し、中断後の mousemove/mouseup で
   古いドラッグが再開・確定しうる
3. **SVG 外 mouseup で破線プレビューが残る**: プレビューは SVG 内 mousemove で `display:block` になるが、
   body→window の mouseup では SVG 側の非表示処理も state 更新も走らないため画面に残る
4. **キャンセル直後の click の扱い**: 弧を動かしてから中断した場合、指を離したときの click が
   新ツールの編集・選択解除として走ってしまう（＝1回読み飛ばす必要がある）。
   ただし **pointercancel はそのポインタ列の mouseup も click も発生させない**ため、
   ここで読み飛ばしフラグを立てると解除役が居らず、**中断後の最初の普通のクリックが無言で捨てられる**

### 修正設計

- `cancelActiveDragSessions(options?)` を新設し、TOOL_CHANGED（`toolIdentityKey` effect）・
  CLEAR 要求・pointercancel の3経路から呼ぶ。弧は **`cancelArcDrag` 経由で開始形へ復元してから**
  参照をクリアする（**確定しない** — ツール切替も OS 中断も利用者の確定意図ではないため）
- 破線プレビュー要素は `tiePreviewPathRef` で持ち回り、掃除側から `display:none` にできるようにした
  （描画 effect が SVG ごとに作り直すため、ref で最新の要素を指す。テスト用に `vf-tie-preview` クラスも付与）
- **click 読み飛ばし（`arcMoved`）の生存期間は経路ごとに分ける**（指摘4の結論）
  - ツール切替・CLEAR: マウスはまだ押されている → 立てる（解除は window mouseup の `setTimeout(0)`）
  - pointercancel: mouseup も click も来ない → **立てない**（`suppressNextClick: false`）
- 読み飛ばしの消費先は SVG 背景 click だけでなく、**小節背景・音符・非アクティブ声部の click ハンドラ先頭**にも置く
  （ハンドル要素はツール切替の再描画で消えるため、合成 click はこれらの要素へ届く）
- §2-2 の表の「POINTER_CANCEL の掃除対象は tieStart のみ」という記述は、この修正で
  **全 session（弧・tie・小節アンカー）へ拡大**された。一方 `GLOBAL_POINTER_UP`（mouseup）側が
  tie のみなのは従来どおり（弧の「SVG 外で離しても1回だけ確定」= Issue #235 の window mouseup
  ハンドラを壊さないため）

### 影響範囲と検証

- 影響は `PianoSystemCanvas` のドラッグ掃除経路のみ。譜面データの構造・レイアウト計算には触れていない
- `PianoSystemCanvasDragCancel.test.tsx`（6件）で各経路を固定。いずれも**修正前のコードで落ちること**を
  確認してから修正を適用した（1/1b＝ツール切替、2a/2b＝pointercancel の弧・小節、
  2c＝pointercancel 後に mouseup が無くても次の click が1回目から処理される、3＝プレビュー非表示）

## 8. 段3 の実装記録（2026-08-22・前半 = 段3a+3b）

段3 は差分を審査可能な大きさに保つため 3分割し、PR も分ける:

- **段3a（本PR）**: 小節単位ツール8モード（tie/hairpin スキップ・repeat・ending・小節メタ5種）の
  二重実装を `handleMeasureScopedTool` 1か所へ集約。'handled' | 'passThrough' の2値は §2-3 の
  3値型の先行形（この集合に rejected は存在しない）。モードは排他のため評価順の入替に挙動差なし
- **段3b（本PR）**: `src/editor/hitResolution.ts` を新設し、純粋層を物理移設:
  - 座標変換（getAccumulatedCSSZoom / getSvgVisualMetrics / getRawPerScreenPx(+Safe) / clientToGroup）
  - ヒット定数（CELL_PAD / CHORD_LEDGER_* / KEY_SELECT_* / EXTRA_* / OUTER・INNER_KEY_SELECT_MAX_LINES）
  - 選択判定の純関数（snapLine / noteKeyLineExtent / findKeyIndexAtLine / findNearestKeyIndexWithinLines / keySelectXPad）
  - **resolveNoteHitGeometry**（旧 buildNoteHitGeometry）: 閉包で握っていた文脈を
    `NoteHitGeometryContext` として明示化。`HitAttributionPolicy` は Codex レビューの指摘で
    **'band' 限定の型に絞った** — 帰属の実処理（パート=帯 / 声部=activeVoiceIndex / 空白）は
    この純関数の外にあり、幾何計算に policy を渡すだけでは #316 の差し込み口にならないため。
    'explicitLayer' の union 拡張は、段3c 以降で**帰属解決の入口関数**をこのモジュールへ
    作るときに行う（§2-3 の該当記述もこの理解で読み替える）
- **段3c（次PR）**: 音符クリックの残りのモード分岐（フラグ15種+既定の音符/休符/placeholder 分岐）を
  `handled(action) | rejected(reason, guidance) | passThrough` の3値テーブルへ。
  rejected は #318 通知へ機械的に接続し、無言 no-op を型から排除する

## 9. 段3c の実装記録（2026-08-22・音符クリックの3値テーブル化）

- **NoteClickOutcome**（hitResolution.ts に定義）: `handled | rejected(notice) | passThrough`。
  クリックハンドラ末尾で `rejected` の notice を機械的に notifyScoreEdit へ渡す（#318）。
  テーブル本体は通知手段を知らない
- **構造**: フラグ系15モードの if 連鎖 → `flagToolOutcome()` の switch 1枚（モードは排他のため
  評価順の畳み込みに挙動差なし。段3a と同じ論拠）。passThrough は対象種別の既定処理
  `noteDefaultOutcome()` / `restDefaultOutcome()` へ続く
- **セルの移設（挙動ゼロ差）**: 旧休符分岐にあった (記号系6ツール×休符)=rejected 通知
  （activeSymbolTool 集約変数は廃止し各セルがリテラルで組む）と (臨時記号×休符)=調号領域判定を、
  それぞれのツールの case へ移した。通知文面・発火条件は同一
- **rejected にしなかった既存挙動（型の原則との折り合い。いずれも挙動ゼロ差優先）**:
  - 連符数字トグの「連符ではない」通知は**通知後も選択移動する**現行挙動のため、
    rejected（通知して終わり）ではなく handled 内の inline 通知のまま
  - 無言でクリックを消費する3セルは handled + 理由コメントで保存
    （臨時記号×休符の調号領域外 / 拡張ヒット領域の外れ選択 / 貼り付け不成立の理由不明時）。
    通知を足すべきかは #318 系の別Issueで扱う（このPRでは足さない）
- **到達不能コードの削除**: 旧 `else`（音符でも休符でもない）分岐は `!isRest / isRest` で
  全域が尽きるため到達不能だった。削除（挙動差なし）
- **resolveHitAttribution 新設**（段3b レビューで約束した帰属解決の入口関数）:
  クリックテーブルは操作対象のパート・声部を必ず `resolveHitAttribution(policy, {帯のパート,
  アクティブ声部})` の返り値（hitPi / hitVoice）から取る。'band' は入力をそのまま返す（ゼロ差）。
  **#316 実装時の残作業も明記**: クリック候補列（activeEvs）の生成と updateActiveEvent の
  書き込み先は描画時にアクティブ声部で束縛されており、'explicitLayer' はこの2点の差し替えも要る
- 検証: フルテスト 199ファイル/2132件 緑・lint:ratchet 326（基準値ちょうど）・build 成功・
  実機スモーク（連符数字×非連符=rejected 通知 / 段またぎ往復=handled+成功通知+原状復帰 /
  符頭クリック=選択）
- **Codex 1巡目（P2: 帰属の単一入口が score 書き込み経路に未接続）への対応**:
  - `setScoreFor(targetPi)` を導入し（従来の `setScore` は `setScoreFor(pi)` の別名）、
    クリックテーブル内の score 書き込み4か所は `setHitScore = setScoreFor(hitPi)` 経由に
  - `updateActiveEvent` に attribution 引数（既定 = 帯のパート+アクティブ声部）を追加し、
    テーブル内の9呼び出しは `updateHitEvent`（hitPi/hitVoice 固定）経由に。'band' では既定値と
    同値のため挙動ゼロ差
  - **doInsert はあえて帰属引数を持たせない（裁定）**: 挿入は計画（at 位置・空き拍・詰め物・音高）
    まで描画時の束縛（activeEvs/activeVfNotes/clefHere）から導かれ、書き込み先だけ hitPi へ
    向けると計画と書き込みが食い違う偽の継ぎ目になる（段3b P1 と同型）。#316 では挿入
    コンテキストごと選択レイヤー由来へ再導出する。この判断は doInsert 冒頭コメントにも明記

## 10. 段4 の分割方針（2026-08-22 着手時に決定）

描画 useEffect は 2465〜6623 行（約4,160行）の一枚岩で、段3 と同じく1PRでは審査不能。
§2-4 の内容を3つに割る（1段 = 1PR の原則は維持）:

- **段4a（状態源統一 + cleanup）**: 描画 effect 内の `partsScore` 直読み（レイアウト前段の
  調号/クレフ解決・Pass 3 の `score`・小節メタオーバーレイの現在値）を `partsScoreForRender` へ
  統一する。両者の差は**記号オフセットの矢印キー下書き中、その1イベントの offset のみ**
  （partsScoreForRender の useMemo 実装参照）なので、拍・音高・クレフ・調号を読む経路では
  厳密に同値＝実質ゼロ差。差が出る唯一の面（下書き中の offset 読み）は「下書き値基準が正しい」
  （§2-4 の承認済み差分）。あわせて effect に cleanup を追加し、描画済み SVG を指す ref
  （arcDragContextRef・tiePreviewPathRef）をアンマウント時に破棄する
- **段4b（記号 Entries と台帳の戻り値化）**: 13本の entry 配列と台帳 Map を「収集器」オブジェクト
  にまとめ、Pass 3 が受け取り最終描画段が消費する形へ（`let`/配列の寄せ集め解消。ゼロ差）
- **段4c（Pass 1/2/3 の関数化）**: Voice 構築（Pass 1）・合同フォーマット（Pass 2）・
  描画+ヒット領域（Pass 3）を入出力明示の関数へ物理分割。cross-staff 段2（またぎ連桁）は
  この後に着手可能になる
- **段4c の再分割（実装時判断）**: Pass 3（描画+ヒット領域+クリックハンドラ・約2,300行）は
  クリックテーブル（段3c）と多数の setter/reducer を閉包で参照しており、1PRでの関数化は
  審査不能。次の2本に割る:
  - **段4c-1**: Pass 1（buildPartVoicesForMeasure）と Pass 2（formatSystemColumnVoices）を
    module スコープの入出力明示関数へ物理移設。**ビーム構築（Beam.generateBeams /
    generateCrossStaffBeams）が buildPartVoicesForMeasure の中に閉じた**ので、
    cross-staff 段2（またぎ連桁）の着手条件はこの段で満たされる。臨時記号状態の
    小節間引き継ぎは prevMeasureState 入力 → nextPrevMeasureState 戻り値で明示化
  - **段4c-2**: Pass 3 のうち描画専用の部分（声部・ビーム・連符の draw ループ、
    エントリ消費の最終描画段）の関数化。ハンドラ設定部は段3 で既にテーブル化済みのため、
    無理に閉包から引き剥がさない（引数化で偽の継ぎ目を作らない・段3c doInsert と同じ裁定）

## 11. 段5-1 の実装記録（2026-08-22・write 正規化 + dual-write）

- **dual-write**: `withVoiceEventsUpdated(voiceIndex 0)` が、voices を持つ小節では正本 events と
  鏡 voices[0]（cloneNoteEvent で別参照）を同時更新する。**voices を持たない単声部小節には
  器を作らない** — events-only が現行の正規状態（§2-5 移行境界）で、保存形式を段5-4 より前に
  変えないため。§2-5 本文の「常に同時更新」はこの読みで実装（Codex 1巡目が移行境界として妥当と判定）。
  これに伴い段5-2 の不変条件は「**voices を持つ小節では**編集後常に events ≡ voices[0]」と読む
- **破壊的書き込みの根絶**（§2-5 名指しの3か所）: fillPriorMeasureRests（PSC）の events.push /
  noteDeletionUtils の remapAllMeasuresAfterRemoval・chordKey置換+purgeArcsToRemovedKey・splice を
  すべて `withVoiceEventsUpdated(m, 0, ...)` 経由へ。声部2以降の arcs を触らない既存の約束
  （弧の声部ローカル索引の保護）は voiceIndex 0 指定でそのまま維持
- **記譜音表示ブリッジの対称化**（Codex 1巡目 P1・2巡目 P2 の対応。バグ修正として挙動差あり）:
  - 問題: `transposeMeasuresForDisplay` が表示用 events の keys/arcs だけを移調しており、
    (a) dual-write が記譜音の events を voices[0] へ複製→逆変換が events しか戻さず鏡に記譜音が残る
    (b) 記譜音モードの声部2編集が voices[1] に記譜音のまま保存され実音へ戻らない（潜在バグ）
    (c) 前打音（graceNotes[].keys）が両方向とも未変換で、表示は実音のまま・新規追加は記譜音のまま
    保存され主音との音程関係が崩れる（潜在バグ）
  - 修正設計: shiftEvent（keys・arcs・graceNotes）を **events と全 voices[*].events へ両方向で適用**
    し、表示⇄保存の往復を対称にする。voices を持たない小節にはキーを作らない（保存形式不変）
  - 影響範囲: 移調楽器（semitones≠0）×記譜音モードのみ。声部2の表示が記譜音になる・
    声部2/前打音の保存音高が実音に正しく戻る、の2点がバグ修正としての挙動差
  - データ構造: 変更なし（MeasureData/NoteEvent の形はそのまま）
  - 経緯: PR #350 の Codex レビュー1〜2巡目。テスト: dual-write 4件 + 往復3件を追加

## 12. 段5-2 の実装記録（2026-08-22・events ≡ voices[0] 不変条件テスト）

- primaryVoiceMirrorInvariant.test.ts（11件）を追加。主張は「**voices を持つ小節では**、
  編集後常に events ≡ voices[0].events」（§11 の移行境界どおりの限定。段5-4 で全小節が
  voices を持つようになったら限定は外れる）
- 固定した経路: 正規 API（声部1/声部2）・イベント削除（声部1・和音1音+弧掃除・声部2）・
  音高変更（両声部）・小節挿入/削除・記譜音表示の往復（表示→編集→逆変換）・保存時同期の冪等・
  連続編集・単声部小節の events-only 維持（vacuous 成立の確認）
- テストのみの追加＝挙動ゼロ差。全11件が初回から緑で、段5-1 の dual-write と書き込み正規化が
  不変条件を実際に満たしていることの検証になった
- **Codex 1巡目（P2×3: カバレッジの穴）への対応**: 指摘どおり「初回全緑」は検出力の証明に
  ならなかったため、次の3経路を追加（計15件）:
  - 自動休符補完 `fillPriorMeasureRests` を voices を持つ拍不足の小節で実際に発火
    （このために同関数と buildRestEventsForBeats を PSC から measureRestFillUtils.ts へ物理移設）
  - 別小節から張られた弧の掃除（purgeArcsToRemovedKey）と索引繰り上げ
    （remapEventRefsAfterRemoval）を実際に発火させ、**非対象小節の鏡**の更新を検証
  - 選択範囲の移調 `transposeMeasureRange`（events と voices を別々に再構築する経路）
- **レッドチェック実施**: fillPriorMeasureRests を破壊的 push へ・remap を events 直接代入へ
  一時的に戻し、それぞれ対応するテストが 1 件だけ落ちることを確認（検出力の実証）
- **Codex 2巡目（P2×2）への対応（計17件へ）**:
  - 小節挿入/削除の弧参照（toMeasureIndex）が実際に繰り上がるフィクスチャを追加
    （レッドチェック: voices 側の remap を外すと検出される）
  - 実 API（saveScoreData/loadScoreData）を通した往復テストを追加。同期済み入力に加えて
    **非同期入力（レガシー書き込み相当）**のケースも用意 — 同期済み入力だけでは保存時同期の
    除去を検出できないことがレッドチェックで判明したため（dual-write が肩代わりする）。
    非同期入力ケースは保存時同期を外すと検出される

## 13. 段5-3 の実装記録（2026-08-22・フォールバック付き read 切替）

- **正規 read アクセサ `getPrimaryVoiceEvents(measure)`**（voiceMeasureUtils）:
  `voices[0]?.events ?? events ?? []`。不変条件（§12）下で従来の events 読みと同値
- **切替した読み**（§2-5 の実害順）: getVoiceEvents(voice 0)・getMeasureVoices の主声部・
  getMeasureDurationBeats・flattenMeasureForPlayback（以上 voiceMeasureUtils）／
  ScorePage の空判定・演奏時間見積り／measureLayoutUtils の幅計算・臨時記号走査・声部リスト構築／
  ScorePlayer の再生列挙・再生位置計算・位置検証／musicXmlExport・midiExport の主声部読み／
  PSC の描画ソース（safeEvs）／measureRestFillUtils の埋まり拍計算
- **境界の正規化（read 切替の安全網）**: read が鏡を優先するため、鏡が古いデータが
  読み込まれた場合に古い内容が表示・出力に出てしまう。これを防ぐため、**データの出入口で
  正本（events）から鏡を同期**する: (1) localStorage 読込（parseAndNormalizeStoredScore・
  primary/backup 両スロット） (2) ファイル読込（fileStorage.importScoreFromFile の後始末④）
  (3) MusicXML/MIDI 書き出し入口（呼び出し側から鏡が古いデータが来ても正本から同期。
  アプリ内の通常経路では dual-write 済みで no-op）。MusicXML import は元から鏡同期の形で生成
- **テスト**: getPrimaryVoiceEvents のユニット3件（voices 優先・フォールバック・空）。
  旧規約（鏡が空）の手組みフィクスチャで書かれていた musicXmlVoice2.test.ts は、
  export 境界の正規化により**無修正で緑**（＝境界正規化の検出テストを兼ねる）
- 挙動差: 不変条件下でゼロ差。鏡が古い異常データに対してのみ「正本＝events が勝つ」ことが
  境界で保証されるようになった（従来は読み手ごとにまちまちだった）
- 既知バグの別Issue化: **声部2が MIDI に出ていない**（§2-5 で予告済み）は本段では触らず、
  段5-4 完了後に起票する
- **Codex 1巡目（P2×2: 読み残し）への対応**: measurePlannerSafetyPadding（記譜音表示用の
  安全幅）・resolveDynamicVelocities（再生の強弱割り当て）・playbackPositionUtils（画面の
  再生位置タイムライン）の3読みを正規アクセサへ追加切替。いずれも ScorePlayer 内部入口の
  ように境界正規化を通らない純関数直呼びのため、鏡と正本の食い違いで別音符へ強弱が付く・
  ハイライト時刻がずれる余地があった
- **Codex 2巡目（P2）への対応**: カスタムピアノサンプル（loadCustomPianoDemoScore・
  独自の localStorage キー）も永続化データの流入経路だった。読込時に rightHand/leftHand を
  正本から鏡同期する安全網を追加（他の読込境界と同じ扱い）

## 14. 段5-4 の実装記録（2026-08-22・保存形式の移行）

- **方針**: 「読込・保存の両境界で全小節へ voices[0] を実体化」する。§2-5 の
  「読込時に全小節へ voices を実体化」を、保存側にも対称に適用した
- **#305（空声部の畳み込み）との両立**: collapseEmptyTrailingVoices が voices キーごと
  削除するのは「2声以上→1声へ畳んだとき」だけで、voices:[voice-1] 1本の小節は
  そもそも畳まれない（多声判定は length>1）。よって実体化済みの単声部小節は読込正規化を
  生き残り、衝突しない。畳み込み後に events-only へ戻る経路（声部2全削除）は残るが、
  次の保存/読込で再実体化され収束する
- **write 側の解禁**: withVoiceEventsUpdated(声部1) が voices の無い小節にも鏡を作るように
  （§11 の「器を作らない」暫定措置を解除）。境界実体化により形式の一貫性が保たれるため
- **フォールバック除去は後続課題**: getPrimaryVoiceEvents の `?? events` を外すには、
  セッション内の小節生成（createEmptyMeasure・PSC の表示用 `{events:[]}` プレースホルダー・
  畳み込み後）も実体化する必要がある。#244 では境界保証まで、除去は焼き込み期間を置いて
  別Issueで行う（急がば回れ: フォールバックは安価で、外すことによる利得は小さい）
- **挙動差（明記）**: 保存 JSON の全小節が voices を持つようになる（サイズ微増・読込互換維持）。
  「書き込みで voices を作らない」系テスト4件と #305 の「畳むと voices キー削除」2件の
  期待値を新形式へ更新。描画・操作はゼロ差（実機で main と同一の描画数を確認）
- 実機検証の記録: スモーク中に描画数の差（163→169）を検知したが、main へ一時切替して
  同一データで数え直した結果 main も 169 ＝ 差はコードではなく検証用ブラウザ内データの
  ドリフト由来と確認（このベースライン比較の手順は再利用価値あり）
- **Codex 1巡目（P2×2: 境界の漏れ）への対応**: (1) ファイル書き出し exportScoreToFile と
  カスタムサンプル保存 saveCustomPianoDemoScore（localStorage 保存とは別の JSON 書き込み
  境界）にも同期+実体化を適用 (2) MusicXML 読込 parseMusicXml の小節組み立てにも実体化を
  適用（単声部は voices: undefined で生成されていた）。声部2なし往復テストの期待を
  「voices が付かない」→「voice-1 のみ＝多声化しない」へ更新（回帰防止の本旨は維持）
- **Codex 2巡目（P2）への対応**: フィードバック JSON（クリップボード出力・「ファイルを開く」で
  読込可能な楽譜 JSON）も書き出し境界だった。正規化を normalizeMeasuresForPersistence
  （鏡同期+実体化）として共通関数化し、全境界（localStorage 保存/読込・ファイル書き出し/読込・
  フィードバック JSON・カスタムサンプル保存/読込）をこの1関数へ寄せた
- **Codex 3巡目（P1）への対応**: 実体化された「空の primary mirror（voice-1 だけ・0件）」を、
  isEmptyMeasure / isPrintTrimmableMeasure が「voices プロパティあり＝内容あり」と誤判定し、
  末尾の空小節がトリムされず空の段・ページが残り、パディング差が Undo 対象になる回帰。
  両判定で空の鏡だけの voices を無視するよう修正（声部2があれば空でも従来どおり内容あり
  — 空の voices[1] は #305 の畳み込みの担当）。回帰テスト3件を追加
- **Codex 4巡目（P2）への対応**: no-op 更新（updater が同一参照を返す）では鏡を実体化せず
  元の measure をそのまま返すガードを追加。参照変更なしの全小節走査
  （remapAllMeasuresAfterRemoval 等）が未編集小節まで JSON 差分にし、
  findFirstDifferingMeasureIndex の段割り安定化（#67）が全再計画になる回帰を防ぐ。
  「変化が無ければ引数をそのまま返す」（#245）の約束の再確認。テスト1件追加

## 15. 段5-5 の実装記録（2026-08-22・N 声観点の完了条件 = §2-5 末尾の4条件）

- **コアの voices[1] 直接参照を根絶**: musicXmlExport の声部2ブロックを全声部ループへ一般化
  （<backup> 連鎖・voice 番号 N。2声のときの出力は従来と同一。松葉マップは現行 UI が
  2声までなので声部2にのみ適用）。残る voices[1] の文字列はコメントのみ
- **声部2以降が MIDI に出ないバグを修正**（§2-5 予告分・挙動差として明記）:
  buildNoteTrack を「全声部を同じ小節開始ティックから並行に書く」形へ。小節の進みは
  最長声部に合わせる（単声部の譜面は従来と同一）
- **activeVoiceIndex の number 化**: PSC の prop・latestRef・requestActiveVoiceChange・
  describeActiveVoiceSwitched・ScoreActiveVoiceChangeDetail を number へ。0|1 の制約は
  ScorePage のイベントリスナー（0/1 以外を無視するガード）とパレット UI にのみ残る
- **符幹方向ポリシーの分離**: voiceStemDirectionFor(voiceIndex, voiceCount) を新設し、
  resolveVoiceStemDirections は声部数によらないループに。3声の中声はポリシー追加で済む形
- **声部3・4 テスト**（nVoiceSupport.test.ts・7件）: 正規 API 読み書き（器の自動生成）・
  声部3削除の独立性・保存往復・再生フラット化（開始拍つき14イベント）・MusicXML 往復
  （voice 3/4 タグ）・MIDI 全声部（Note-On 14個）・符幹ポリシー
- **Codex 1巡目（P1+P2×2）への対応**:
  - [P1] parseMusicXml が最初の <backup> だけで2分割しており、3声以上の自己往復で
    声部3以降が声部2へ連結される（4声→2声へ潰れる）データ破壊 → <backup> ごとの
    区切りで全声部を復元する形へ一般化。往復テストを「4声すべて音高まで一致」へ強化
  - [P2] 声部3・4 の符頭クリック（切替要求）を ScorePage が黙って無視し、選択と実状態が
    食い違う → PSC 側で「声部Nの音符です（表示・再生・書き出しのみ対応）」と通知して
    終えるガードを追加（describeVoiceSwitchUnavailable・#318）
  - [P2] 描画の完了条件が未検証 → PianoSystemCanvasNVoiceRender.test.tsx（4声の描画で
    例外なし+符頭14個が DOM に出る+ヒット領域生成）を追加
  - [2巡目 P1] 疎な声部（声部2空・声部3のみ）の往復で声部番号がずれる → 区間の順番ではなく
    各 note の <voice> タグで声部を復元する形へ（<backup> は時間の巻き戻しであって声部番号では
    ない。タグの無い XML は従来どおり区間順）。疎な往復テストを追加
- これで §2-5 の完了条件4項目がすべて満たされ、**#244 の段0〜段5 が完了**。
  後続課題（別Issue化）: フォールバック（voices[0]?.events ?? events）の除去（焼き込み後）

## 追記: 小節コピペでの小節インデックス参照の付け替え（2026-08-24 実機報告）

**症状**: 月光の清書中、1小節目を2小節目へコピペしたらスラーが壊れた。2小節目の声部2のスラー4本すべてが
`toMeasureIndex: 0`（＝1小節目）を指したまま残り、小節をまたぐ長い弧として描画された。

**原因**: タイ/スラーの終点（`arcs[].toMeasureIndex`）とヘアピンの終点（`hairpins[].endMeasure`）は
**絶対小節インデックス**（types/storage.ts）。しかし貼り付け処理は素の代入だった:

```ts
measures.forEach((m, i) => { copy[dest + i] = m; });  // 参照を付け替えていない
```

小節の**挿入・削除**では同じ問題を `measureInsertDeleteUtils.ts` の `remapMeasureIndex` で既に解いていたが、
**コピペ**では解かれていなかった。「位置がずれる操作」という括りで見れば同型なのに、挿入・削除だけを
個別の問題として解いたための取りこぼし。

**修正**: `measurePasteUtils.ts` の `rebaseMeasureArcsForPaste(measures, srcStart, destStart)` を新設し、
貼り付け時に通す。クリップボードは `{ sourceStart, parts }` に変更してコピー元の位置を保持する
（従来は位置を持っておらず、付け替えの基準が計算できなかった）。

**範囲外を指す弧の扱い**: 落として本数を通知する（運用者裁定）。終点の音符が貼り付け先にも同じ形で
存在する保証がないため。絶対値のまま残すと無関係な音符へ弧が伸び、相対距離で伸ばすと終点が別物になりうる。
どちらも壊れた譜面を作るので、落として `describeArcsDroppedOnPaste` で伝える方を選んだ（#318 の系譜）。

**同型の未解決**: 「位置を持つ参照を、位置が変わる操作で付け替え忘れる」型のバグ。今回で挿入・削除・
コピペは揃ったが、今後この種の参照（絶対インデックスを持つフィールド）を増やすときは3経路すべてを見ること。

### 追記2: レビューで見つかった2点（#401 Codex round1）

1. **同位置への貼り付けを素通ししていた**: `srcStart === destStart` で早期 return していたが、
   コピー後に終点の音符を消して元位置へ貼り戻すと、クリップボード内の「もう届かない弧」が復活する。
   同位置でも範囲判定は行う。
2. **通知の件数を setter の updater 内で数えていた**: `setQuartetParts(prev => ...)` の中で
   カウンタを増やし、直後に通知していた。updater は遅延・再実行され得る（StrictMode では意図的に2回）ため、
   件数が倍になったり通知が出なかったりする。**付け替えと集計は setter を呼ぶ前に純粋計算で済ませる**。
   あわせて、数える対象は「実際に貼られるパート」だけに限定した（クリップボードに貼り先の無い
   partId が残りうるため）。四重奏経路で通知が1回・正しい件数で出ることを統合テストで固定。

## #376: 記号エントリ収集の一元化と描画先パートの型区別（2026-08-26）

### 収集の一元化

記号エントリ（強弱・カスタム記号・ペダル・運指・アーティキュレーション・テンポ・発想標語・
コード・歌詞・オッターバ）の push を、**renderedVoiceEntries を1回走査する統一ループだけ**に
集約した。従来の「編集用ループ＋見た目だけループ（補集合）」の2箇所体制は、補集合である
保証がどこにもなく、#316 のレイヤー導入時に隙間ができて非選択の手の記号が消えた。

- 編集用ループからは記号 push を全削除（音符の hit rect・クリックハンドラはそのまま）
- 走査順はアクティブ声部を先にし、旧実装の描画順と pendingOttava（共有状態機械）の並びを保存
- 「編集可能か」はエントリのメタデータ（partIndex 等）の有無として表現され、
  描画側 appendSymbolHitRegion が判断する＝ループの分岐から分離済み（#398 の型のまま）

### 描画先パートのブランド型（RenderedPartIndex）

`crossStaffUtils.ts` に `RenderedPartIndex`（unique symbol ブランド）を導入し、
`resolveRenderPartIndex(es)` の戻り値とした。適用先は今週バグを生んだ2箇所:

- A2淡色のグループ判定（noteRenderedPartByNote / renderedPartsOfGroup / groupInactive）
- 弧の描画先台帳（arcRenderedPartByKey / partIndexOfStave）

**負の型テストで実証**: #409 で実際にやった間違い（台帳へ所属パート `partIndex` を入れる）は
TS2345 で止まる。所属パートは素の number のままにして、混入方向だけを型で塞ぐ
（number への代入は許す＝配列添字などの読み出しは自由）。

### 検証にまつわる重要な発覚

ルート tsconfig は `files: []` の参照構成のため、**素の `npx tsc --noEmit` は何も検査しない**
（常に成功する）。型検査の実体は `npm run build` の `tsc -b`。本リファクタの負の型テストで発覚。
単発の型検査は `npx tsc -b` を使うこと。

## 付録B: 旧実装の標本集（2026-08-27 採取・運用者発案）

削除された「悪いコード」の実物は git 履歴（`git show d297b79^:src/components/PianoSystemCanvas.tsx`）
を掘らないと見えないため、代表的な標本をここへ転記して残す。後から読み返すと
「大工事の前がどうだったか」「なぜ表・型で縛る設計にしたか」の一次資料になる。
（採取元コミット: d297b79 の親。段3c 直前 = 2026-08-22 時点）

### 標本1: フラグ変数15本 + if 連鎖（音符クリックハンドラ冒頭）

```typescript
const accidentalMode = 'mode' in tool && tool.mode === 'accidental' ? tool.accidental : null;
const microtoneMode = 'mode' in tool && tool.mode === 'microtone' ? tool.type : null;
const dynamicMode = 'mode' in tool && tool.mode === 'dynamic' ? tool.dynamic : null;
// …同型が計15本続き、その後に
if (tupletNumberToggleMode) { /* … */ return; }
if (crossStaffToggleMode)   { /* … */ return; }
if (accidentalMode && !activeEvs[j]?.isRest) { /* … */ return; }
// …15モードを14個の if+return で処理（symbolAdjustResize/Offset は1つの if に統合）
```

**何が悪いか**: (1) ガード条件（`&& !isRest` 等）をすり抜けたクリックは黙って下へ落ち、
既定処理か「何も起きない」に着地する — 無言経路が当時27箇所。(2) 通知は各分岐の自由裁量で、
書き忘れてもエラーにならない。(3) フラグ宣言と if 分岐が離れており、新モード追加は
「宣言を1本+ifを1個」の2箇所への追記になる（モード自体は排他なので順序依存はないが、
素通り経路が1本増えるリスクは追加のたびにあった）。
→ 段3c の `NoteClickOutcome`（handled / rejected(notice必須) / passThrough）が保証するのは
**rejected の通知必須化**と「素通りは明示的な passThrough としてしか書けない」こと。
なお `(tool as any)`（ornament/pedal/ottava の3箇所）は段3c では解消しておらず現存する
（旧実装の悪さではなく残課題として記す）。

### 標本2: インデント13段（前打音トグルの音名計算）

```typescript
if (graceNoteMode && !activeEvs[j]?.isRest) {
  updateActiveEvent(j, (targetEv) => {
    // …
    const nextKey=m
      ? (()=>{
          const idx=noteNames.indexOf(m[1].toLowerCase());
          return idx===noteNames.length-1
            ? `c/${parseInt(m[2],10)+1}`          // ← ここがインデント13段目
            : `${noteNames[idx+1]}/${m[2]}`;
        })()
      : graceKey;
```

到達経路: コンポーネント → 描画useEffect（当時4,200行）→ 小節ループ → parts.forEach →
声部ループ → notes.forEach → クリックリスナー → if連鎖 → updateActiveEvent コールバック →
三項 → 即時実行関数 → 三項 → 三項。「主音符の1音上の音名を求める」だけの音楽理論計算が
クリックハンドラの三項演算子内に直書きされていた（本来は3行のユーティリティ関数）。

### 標本の教訓（なぜ増殖したか）

フラグ15本も最初は2本だった。3本目を足す実装者は前例に倣っただけで、各1行はその場では
合理的。つまり悪い構造は**前例の複製**で増える。対策も同じ理屈で効く: 前例側を
表+型に変えれば、以後の追加は自動的に安全な型に倣う（段3c 以降の新モードが実証）。
なお、深いネスト自体（描画effect内の 小節→パート→音符→ハンドラ の入れ子）は現存する。
これは §2-4 の未完ではない: 段4c は §10 の裁定（ハンドラを無理に分離しない）どおり完了しており、
描画部の独立ファイル化は**当初案から意図的に外した別課題**である。着手するなら新しい
Issue として起票し、閉包共有（stave 参照等）の受け渡し設計から検討する。
