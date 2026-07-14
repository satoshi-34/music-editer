# Undo / Redo 実装（設計書）

## 問題

譜面編集（音符配置・削除・コピペなど）に対する取り消し・やり直し操作が、キーボード
ショートカット（`Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` / `Cmd/Ctrl+Y`）としては
`src/components/ScorePage.tsx` にすでに実装済みだったが、以下が不足していた。

1. 常設のツールバーボタン（「元に戻す」「やり直す」）がなく、キーボード操作に慣れて
   いないユーザーが Undo/Redo の存在に気づけない。
2. 履歴スタック（`historyStack` / `futureStack`）は `useRef` で保持しているため、
   push/undo/redo の中身が変わってもボタンの活性・非活性を再レンダーで反映する仕組みが
   なかった。
3. 履歴スタックの push/undo/redo/上限切り捨て/redo 破棄ロジックが `ScorePage.tsx`
   内にインライン実装されており、ユニットテストで検証しづらかった。

## 状態の持ち主（調査結果）

- 譜面データの実体は `src/components/ScorePage.tsx` の `useState` 群が保持している。
  - `rightHandData` / `leftHandData`: 単旋律・ピアノ譜のパートデータ
  - `quartetParts`: 弦楽四重奏の4パート
  - `ensembleParts`: 編成譜の各パート
- 上記4つをまとめた `ScoreSnapshot` 型がすでに定義されており、`structuredClone` 相当の
  スプレッド（`{ ...currentScoreRef.current }`）でスナップショットを作っている。
  トップレベルのオブジェクト自体は毎回新規に作るが、内部の配列は setState 時にすでに
  イミュータブルに更新されている（`[...prev]` などで複製してから書き換える運用）ため、
  参照コピーで実用上問題は出ていない。
- 編集操作の入口:
  - `handleRightHandChange` / `handleLeftHandChange` / `handleQuartetPartChange` /
    `handleEnsemblePartChange`（各パートの `MeasureData[]` を子コンポーネントから
    受け取るコールバック）
  - 選択小節の Delete/Backspace（`clearRange`）
  - `Cmd/Ctrl+V` によるペースト
  - いずれも編集直前に `pushHistory()` を呼んでから setState している。

## 対象範囲（スコープ）

- **Undo 対象**: 音符・休符・和音・アーティキュレーション・タイ/スラー・強弱記号など、
  `MeasureData[]`（= `rightHandData` / `leftHandData` / `quartetParts` /
  `ensembleParts`）に含まれる編集全般。既存実装がすでにこれをカバーしている。
- **Undo 対象外（今回のスコープ外とした理由）**:
  - タイトル・作詞者などのメタデータ（`title` / `subtitle` / …）: `<input>` の
    `onChange` は1文字ごとに発火するため、そのまま履歴に積むと1文字単位でしか
    戻せず実用にならない。スナップショット粒度を「フォーカスが外れた時」などに
    変えるには入力コンポーネント側の設計変更が必要になり、侵襲が大きいため今回は
    見送った。
  - 調号・段あたり小節数・カスタム記号定義: 変更頻度が低く、誤操作時の影響も
    限定的なため、既存の自動保存・手動保存で十分カバーできると判断し対象外とした。
  - 音色・音量・Y補正などの環境設定: 要件どおり対象外。

  上記は将来的に必要になった場合、`ScoreSnapshot` 型へフィールドを追加し、
  該当する setState 呼び出しの直前に `pushHistory()` を挟むだけで拡張できる。

## 修正設計

### 1. 履歴スタック操作の純粋関数化（`src/utils/scoreHistoryStack.ts`）

push/undo/redo/上限切り捨て/redo 破棄のロジックを、React から独立した純粋関数として
切り出した。

- `pushHistorySnapshot(history, future, snapshot, maxSize)`: 履歴に積み、上限
  （既定 `MAX_SCORE_HISTORY = 50`）を超えた古いものを切り捨て、redo 用スタックを
  空にする。
- `undoHistory(history, future, current)`: 履歴の末尾を取り出し、現在値を redo
  スタックへ積む。履歴が空なら `snapshot: null` を返して何もしない。
- `redoHistory(history, future, current)`: redo スタックの末尾を取り出し、現在値を
  履歴へ戻す。redo スタックが空なら `snapshot: null` を返して何もしない。

`ScorePage.tsx` 側は、これらの関数を呼んで `historyStack.current` /
`futureStack.current`（ref）を更新するだけになった。ロジック自体は
`src/utils/scoreHistoryStack.test.ts` で push/undo/redo/上限/redo 破棄を
個別にテストしている。

### 2. ボタンの活性状態を再レンダーへ反映

`historyVersion`（`useState<number>`）を追加し、push/undo/redo のたびに
インクリメントすることで、`historyStack.current.length > 0`（`canUndo`）・
`futureStack.current.length > 0`（`canRedo`）を再計算し、ボタンの `disabled` に
反映する。履歴データ自体は従来どおり ref で持ち、大きなスナップショット配列の
更新のたびに毎回 re-render が走らないようにしている。

### 3. `handleUndo` / `handleRedo` の共通化

従来キーボードハンドラ内にインラインで書かれていた undo/redo 処理を
`handleUndo` / `handleRedo` という `useCallback` に切り出し、キーボード
ショートカット（`Cmd/Ctrl+Z` 等）とツールバーボタンの両方から同じ関数を呼ぶように
した。処理の実体が1箇所になったことで、ボタンとショートカットの挙動が常に一致する。

### 4. UI（ツールバーボタン）

`src/components/ScorePage.tsx` の `<header className="toolbar">` 内、タブ切り替え
（`toolbar-tabs`）の直後に `toolbar-history-controls` を常設で追加した。
タブの選択状態に関係なく常に表示・操作できる。

```tsx
<div className="toolbar-history-controls" role="group" aria-label="元に戻す・やり直す">
  <button onClick={handleUndo} disabled={!canUndo} title="元に戻す (Cmd/Ctrl+Z)">↶ 元に戻す</button>
  <button onClick={handleRedo} disabled={!canRedo} title="やり直す (Cmd/Ctrl+Shift+Z)">↷ やり直す</button>
</div>
```

スタイルは `src/App.css` に `.toolbar-history-controls` / `.toolbar-history-button`
を追加。無効時の見た目は既存の `button.ghost:disabled` をそのまま流用している。

## 影響範囲

- `src/utils/scoreHistoryStack.ts`（新規）: 履歴スタックの純粋関数
- `src/utils/scoreHistoryStack.test.ts`（新規）: 上記のユニットテスト
- `src/components/ScorePage.tsx`: `pushHistory` / `applySnapshot` の実装を純粋関数
  呼び出しに置き換え、`handleUndo` / `handleRedo` を追加し、キーボードハンドラと
  ツールバーボタンの双方から利用するよう変更。`historyVersion` state を追加。
- `src/App.css`: ツールバーの Undo/Redo ボタン用スタイルを追加。
- `README.md`: 機能一覧・最小チェックに Undo/Redo を追記。

既存の音符編集・削除・コピペ・保存・自動保存のロジックには変更を加えていない。
Undo 後の状態変更も通常の `setState` と同様に自動保存の対象になる（特別扱いしない）。

## 動作確認（ブラウザ）

dev サーバー（`npm run dev`）で以下を目視確認した。

1. 音符を複数配置 → ツールバーの「元に戻す」を連打すると1操作ずつ取り消され、
   履歴が尽きるとボタンが自動的にグレーアウトする。
2. 「やり直す」で取り消した内容が正しく復元される。
3. Undo 後に新しい音符を配置すると「やり直す」ボタンが再びグレーアウトする
   （redo 履歴が破棄されている）。
4. コンソールエラーは発生しない。
