# 設計文書: 臨時記号実装

## 概要

シャープ・フラット・ナチュラルを、既存の `keys: string[]` ベースの譜面データに追加の保存フィールドなしで実装する。  
描画時に小節内の臨時記号状態を追跡し、必要な位置にだけ `# / b / n` を表示する。

## 設計ポイント

### 1. 保存形式は `keys` を維持する

- `f#/4` や `bb/3` は既存どおり `keys` に保持する
- `natural` は保存せず、前の臨時記号を打ち消す必要がある場面でのみ描画時に `n` を出す

### 2. 小節単位の状態管理

各小節の描画時に、`Map<string, '' | '#' | 'b'>` を使って臨時記号の効力を保持する。

- キーは `音名 + オクターブ`
- 同じ状態が続く場合は記号を省略
- 変化が解除された場合は `n` を表示
- 小節が変わるとリセット

### 3. 共通ユーティリティ化

`src/utils/noteKeyUtils.ts` に以下を集約する。

- 音高キー解析
- 臨時記号表示判定
- 保存データのキー形式検証

`StaffCanvas` と `PianoSystemCanvas` で同じロジックを使い、譜面種別ごとの差異をなくす。
VexFlow 5 の `addModifier(modifier, index)` 形式に合わせて臨時記号を追加する。

### 4. パレット操作

`Palette` に `♯ / ♭ / ♮` ボタンを追加し、臨時記号ツールを選択できるようにする。

- ツール選択後に音符をクリックすると適用
- 判定は符頭ぴったりではなく、音符セル内クリックで受け付ける
- 和音はイベント全体へ一括適用
- `Alt + ↑/↓` による半音移動も既存どおり残す
- ピアノ譜・四重奏譜でもクリック再生を維持するため、`PianoSystemCanvas` にも `NotePlayer` を接続する
- 臨時記号適用直後の確認音は現在選択中の楽器で鳴らし、チェックボックスで ON/OFF できるようにする

### 5. 安全性

- 保存前に `keys` の形式を検証する
- 不正な文字列は `saveScoreData()` で拒否する
- 描画では解析失敗時に臨時記号追加をスキップし、例外で全体描画を止めない

## 影響ファイル

- `src/utils/noteKeyUtils.ts`
- `src/components/StaffCanvas.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `src/utils/storage.ts`
- `src/utils/noteKeyUtils.test.ts`
- `src/utils/storage.test.ts`
