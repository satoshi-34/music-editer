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
| 段1 | 散在 state の機械的移動: ミラー ref 9本→最新値 ref 1本、selection 3 state→union（note/arc/hairpin。measures は親所有のまま）、**overlay 9 state→1つの nullable record（排他 union にはしない）**、drag 3 ref→1 record。reducer 導入（遷移は現行と同一） | ゼロ（record 化なら同時開き等の現行挙動も保存される。**union 排他化は段2へ**） | 全テスト+段0.5・月光回帰・実機スモーク（選択/オーバーレイ/ドラッグ/コピペ） |
| 段2 | 遷移関数化と掃除の一元化（§2-2 の表を実装）。**overlay の排他 union 化**とライフサイクル統一はここ | **あり（明記）**: 小節メタ系オーバーレイもツール切替で閉じる・別オーバーレイを開くと前のは閉じる等。差分は表で列挙し運用者承認 | 掃除タイミングのテーブルテスト・段0.5 の期待値更新（変更点=差分表と一致することを確認） |
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
