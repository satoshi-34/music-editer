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

## 追補: 小節単位ツールの Undo が画面に反映されない不具合の修正（2026-07-18）

### 問題

途中テンポ変更（`MeasureData.bpm`）などの小節単位ツールを Undo すると、
履歴スタックは消費されるのに ♩=XXX の表示が画面に残り、直後にキャンバスからの
`onScoreDataChange` 通知でデータまで元（変更後）の状態に書き戻ってしまっていた。

### 原因

1. **`currentScoreRef` の更新が `useEffect`（レンダー後）のみだった**。
   複数ページの `StaffCanvas` / `PianoSystemCanvas` が同じレンダーサイクル内で
   連続して `onScoreDataChange` を呼ぶと、2回目以降の `pushHistory` が
   古い ref（初回は `undefined`）のまま実行され、壊れたスナップショット
   （`rightHandData: undefined` や1つ前の状態）が履歴に積まれる。
2. **`undefined` スナップショットは復元されない**。キャンバス側の同期 effect は
   `if (initialScoreData)` ガードで `undefined` を無視するため、Undo しても
   再描画されず、その後キャンバスが変更後のデータを親へ再通知して Undo が実質
   キャンセルされる。
3. **末尾パディング差だけでも履歴が積まれていた**。キャンバスは自分の描画範囲まで
   末尾に空小節を補って通知するため、ページごとに配列長が異なり（例: 36 vs 72）、
   単純な JSON 比較では「変更あり」と誤判定して無意味な Undo 段数が生まれていた。

### 修正設計

- `src/utils/scoreDataEquality.ts`（新規）: `isEmptyMeasure` / `trimTrailingEmptyMeasures` /
  `isSameScoreIgnoringPadding` を追加。空小節は `{ events: [] }` のみで、`bpm` などの
  小節プロパティが付いていれば空とみなさない（テンポ変更が確実に「編集」と判定される）。
- `ScorePage.tsx` の各 `handleXXXChange`: 変更判定を `isSameScoreIgnoringPadding` に変更。
  パディング差だけの通知は履歴に積まず、ref と state だけ最新に揃える。
  実変更時は `pushHistory` の直後に `currentScoreRef` を**同期的に**更新する。
- `applySnapshot`: 復元時も `currentScoreRef` を同期的に更新し、`undefined` の
  スナップショットは空配列（＝譜面を空にする指示）に正規化して復元する。

### 影響範囲

- `src/utils/scoreDataEquality.ts` / `src/utils/scoreDataEquality.test.ts`（新規）
- `src/components/ScorePage.tsx`: `applySnapshot` / `handleRightHandChange` /
  `handleLeftHandChange` / `handleQuartetPartChange` / `handleEnsemblePartChange`

### 動作確認（ブラウザ）

1. 途中テンポ変更で ♩=180 を設定 → Cmd+Z / ツールバーの「元に戻す」で
   表示・自動保存データの両方から bpm が消える。
2. 「やり直す」で ♩=180 が表示・データとも復元される。
3. まっさらな譜面への最初の編集（音符配置）も Undo で表示・データとも戻る。
4. 起動直後のパディング通知では「元に戻す」が有効化されない。
5. コンソールエラーなし。`docker compose run --rm app npx vitest run` 全件パス。

## Undo 後の残存選択で描画がクラッシュする問題の修正（2026-08-12）

### 問題

音符を追加 → Cmd+Z → 譜面をクリック、の手順で画面全体が真っ黒になり操作不能になった
（実機テスト中に発見。React の描画 useEffect 内の未捕捉例外なのでアプリ全体が落ちる）。

原因は、キャンバス内部の選択状態（`PianoSystemCanvas` の `selected`）が
Undo によるデータ差し替えに追随しないこと。2つの経路で実害になる:

1. `selected.keyIndex` が差し替え後の和音の構成音数より大きいまま描画に渡ると、
   VexFlow の `setKeyStyle(keyIndex)` が `noteHeads[keyIndex]`（undefined）を触って
   `TypeError: Cannot read properties of undefined (reading 'setStyle')` になる。
2. 選択が指すイベント自体が消えても選択が残り、次の Delete が存在しない
   （あるいは別の）音符へ届く（#238 と同根の「残存選択」）。

### 修正設計

二段構え（どちらか片方では不十分。1 は最後の防波堤、2 が本質的な整合性の回復）:

- **描画ガード**（`PianoSystemCanvas.tsx` 音符スタイル適用部）:
  `setKeyStyle` を呼ぶ条件に `selected.keyIndex < ev.keys.length` を追加。
  範囲外のときは音符全体の選択表示（`setStyle`）へ降格し、どんな経路でも落ちない。
- **選択の整合性 effect**（`PianoSystemCanvas.tsx` 親データ同期の直後）:
  `partsScore` が変わるたびに選択を検証する。
  - 選択が指す小節・イベントが解決できなければ選択解除（`setSelected(null)`）
  - イベントは存在するが `keyIndex` が範囲外（または休符化）なら、
    `keyIndex` を外して音符全体の選択へ降格（選択自体は保つ）

### 影響範囲

- `src/components/PianoSystemCanvas.tsx`（上記2箇所）
- `src/components/PianoSystemCanvasStaleSelectionAfterUndo.test.tsx`（新規・回帰テスト2本。
  修正前はテスト1が本番と同一の TypeError で失敗することを確認済み）

### 動作確認（ブラウザ）

1. 音符を追加 → Cmd+Z → 譜面クリック → 落ちない・普通に選択できる。
2. 和音の2音目を選択したまま Undo で1音に戻す → 音符全体の選択に降格して表示が残る。
3. コンソールエラーなし。`docker compose run --rm app npx vitest run` 全 1558 件パス。

### 追補（2026-08-13・Codex レビュー指摘）: index 詰まりによる選択の乗り移り

初版の整合 effect は「同じ index にイベントが存在するか」しか見ていなかったため、
[C, E, G] の E（index=1）選択中に中間の E が消えると、選択が index=1 に来た別の音符 G へ
乗り移り、次の Delete がユーザーの選んでいない G を消すデータ破壊になり得た。

修正: 直前の partsScore のスナップショット（ref）と突き合わせ、「選択していた実体」を追跡する。
- イベント配列の長さが変わったら、選択していたイベントを内容（JSON 比較）で探し直す。
  見つかれば index を追随（例: C 選択中に E が消えても C に付いたまま）、消えていれば選択解除
- 和音の構成音数が変わったら、選択していた key を値で探し直す。消えていれば選択解除
  （音符全体への降格は、直後の Delete がイベントごと消す危険があるため採らない方針へ変更）
- 長さが変わらない在位置編集（矢印キーの音高変更など）は従来どおり選択を保つ
- 同一内容のイベントが複数あるときは元の位置に最も近いものへ（連続同音では実害なし）

回帰テスト3本を追加（中間イベント削除の乗り移り・追随・和音構成音の中間削除）。
既存テスト1本は「降格して選択維持」から「選択解除＋Delete 無効」の契約へ更新。
