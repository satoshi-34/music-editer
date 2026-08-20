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
  editorState.ts      … 編集状態の reducer（tool/selection/overlay/drag を1か所に）
  editorActions.ts    … 遷移関数（アクション）と掃除規則
  hitResolution.ts    … クリック→(パート, 声部, 拍, 対象)の純関数解決 + モード分岐テーブル
  renderPipeline.ts   … Pass 1/2/3 と台帳を関数化した描画ビルダー
src/utils/voiceMeasureUtils.ts … scoreModel（voices[] 統一の正規経路）を拡充
```

### 2-1. editorState（reducer）

1つの reducer に載せる状態と、union へ畳む対象:

- `tool`（ScorePage から移すのではなく、**参照を一元化**する。所有は当面 ScorePage のまま）
- `selection`: `{kind:'note'|'arc'|'hairpin'|'measures'|'none', ...}` の**判別 union 1つ**へ（現在は4つの独立 state。#333 の `'beatRange'` の席をここに予約する）
- `overlay`: 9種を `{kind:'timeSig'|'keySig'|'clef'|'bpm'|'rehearsal'|'text'|'symbolResize'|'symbolOffset'|'symbolPicker', ...} | null` の**1つの union**へ
- `drag`: 弧CP/端点・小節範囲・タイ/松葉の3セッションを union 1つへ

### 2-2. 遷移関数と掃除の一元化（#231/#238 の恒久化）

掃除を「イベントに応じた reducer の遷移」として宣言的に書く:

| イベント | 掃除される状態 |
| --- | --- |
| `TOOL_CHANGED` | overlay 全種・drag 全種・（選択は #238 どおり維持/解除の既存仕様に従う） |
| `SCORE_REPLACED`（外部差し替え） | selection の整合チェック・overlay のうち対象消失分 |
| `EVENT_DELETED` | 対象を指す overlay・selection |
| `SELECTION_CLAIMED`（他段が選択） | 自段の selection |
| `PLAYBACK_STARTED` | selection・overlay・drag |

これにより「オーバーレイ9種のライフサイクル不揃い」は**表の1行を足すだけ**の問題になる。

### 2-3. hitResolution（純関数 + 分岐テーブル）

- `resolveHit(click) → {partIndex, voiceIndex, measure, eventIndex?, keyIndex?, beat?, zone}` を純関数に。#219 の帯域クリップ・#320 の符頭縮小・#327 の拍台帳をここへ集約
- モード分岐を**テーブル駆動**へ: `(tool.mode, 対象種別[小節背景|音符|休符|placeholder|非アクティブ]) → アクション` の表を1枚にし、現在の「二重実装8モード」「無言 return 27箇所」を表の網羅性チェックで機械的に検出できる形にする（#318 の原則をレビュー可能な構造で担保）
- **#316（レイヤー明示選択）はこのテーブルの「対象の解決規則」を差し替えるだけ**で載る形に切る。#333（拍範囲スライス）は `resolveHit` の拍解決（#327 台帳）をそのまま使う

### 2-4. renderPipeline（描画ビルダー）

- Pass 1（パート別 preFormat）/ Pass 2（合同 Formatter）/ Pass 3（描画+ヒット領域）を入出力明示の関数へ。12本の記号 Entries と4つの台帳 Map は**ビルダーの戻り値**にし、`let` の寄せ集めをやめる
- effect に cleanup を追加（リスナー解放・`arcDragContextRef` の破棄）
- Pass 1 と Pass 3 の**状態源を `partsScoreForRender` に統一**（食い違いの解消。挙動差が出るのは矢印キー下書き中のクリックのみで、その場合は下書き値基準が正しい）
- cross-staff 段2（またぎ連桁）は、このビルダー化で「ビーム構築が1関数」になってから着手する

### 2-5. voices[] 統一（データモデル。運用者承認済みの検討項目）

- 方向: `measure.events` を「voices[0] のミラー」から**読み取り専用のレガシー窓**へ格下げし、最終的に廃止。読み書きは `getVoiceEvents` / `withVoiceEventsUpdated` に一本化
- **「2」を焼き込まない**: `activeVoiceIndex: 0|1` の型は当面残すが、scoreModel の関数群は `voiceIndex: number` で切る（3声対応時に UI 追加だけで済む形）
- 破壊的書き込みの根絶: `fillPriorMeasureRests`（PSC:497-500）・`noteDeletionUtils.ts:102,289,299` をイミュータブル正規経路へ
- 読み側の声部1固定（実害順）: ①空判定/内容判定（ScorePage:332,358 — 声部2しか無い小節を空扱いしうる）②レイアウト幅計算 ③再生/再生位置 ④MIDI/MusicXML出力（**声部2が MIDI に出ていない**のは既知バグとして別Issue化してよい）
- 保存形式: 読込互換は維持（旧形式→正規化は #305 系の既存直列に追加）。保存の新形式化は最終段

## 3. 段割り（1段 = 1PR。各段とも「挙動ゼロ差」または「差分を明記」）

| 段 | 内容 | 挙動差 | 主な検証 |
| --- | --- | --- | --- |
| 段1 | 散在 state の機械的移動: ミラー ref 9本→最新値 ref 1本、selection 4 state→union、overlay 9 state→union、drag 3 ref→union。reducer 導入（遷移は現行と同一） | ゼロ | 全テスト・月光回帰・実機スモーク（選択/オーバーレイ/ドラッグ/コピペ） |
| 段2 | 遷移関数化と掃除の一元化（§2-2 の表を実装）。オーバーレイ9種のライフサイクル統一 | **あり（明記）**: 小節メタ系オーバーレイもツール切替で閉じるようになる等。差分は表で列挙し運用者承認 | 掃除タイミングのテーブルテスト |
| 段3 | hitResolution 純関数化 + モード分岐テーブル化（二重実装8モードの一本化・無言 return の表化） | ゼロ（#318 通知は既存のまま移設） | クリック系テスト全部・#320/#327 の回帰 |
| 段4 | renderPipeline ビルダー化 + cleanup + 状態源統一 | ほぼゼロ（状態源統一のみ差分明記） | 月光回帰レンダー・段またぎ回帰・目視 |
| 段5 | voices[] 統一（read 側→write 側→保存形式の3サブ段。§2-5 の順） | サブ段ごとに明記（声部2の再生/出力はバグ修正として差分が出る） | 往復（保存→読込）等価テスト・再生/出力の声部2テスト |

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
