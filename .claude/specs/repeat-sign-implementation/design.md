# 設計書: 音楽記号のリピート実装

## 概要

ユーザーが求めているのは、再生を自動ループさせるチェックボックスではなく、譜面上に置く **開始リピート `||:` / 終了リピート `:||`** の記号である。  
そのため、再生制御 UI に機能を足すのではなく、**小節データ・パレット・描画・保存・再生解釈** の 5 か所をそろえて実装する。

## 問題点

既存実装には次の制約があった。

- パレットにリピート記号の入力モードがない
- 小節線に関する追加メタデータを `MeasureData` が持っていない
- `StaffCanvas.tsx` / `PianoSystemCanvas.tsx` では小節を `events` だけで複製する箇所が多く、新しい小節属性を足すと編集時に消えやすい

このまま単純に boolean を追加すると、表示はできても音符編集時にリピート記号が消える不具合が起こりやすい。

## 修正設計

### 1. `MeasureData` に repeatStart / repeatEnd を追加

リピート記号は小節線に結びつくため、`NoteEvent` ではなく `MeasureData` に保存する。

```ts
interface MeasureData {
  events: NoteEvent[];
  repeatStart?: boolean;
  repeatEnd?: boolean;
}
```

### 2. パレットに専用モードを追加

`Tool` 型へ `mode: 'repeat'` を追加し、`||:` と `:||` の 2 ボタンを表示する。  
ボタン選択中に小節背景または音符セルをクリックすると、その小節の開始/終了リピートをトグルする。

### 3. VexFlow の barline を使って描画する

自前 SVG ではなく、既存の `Stave` API を使う。

- 開始リピート: `setBegBarType(Barline.type.REPEAT_BEGIN)`
- 終了リピート: `setEndBarType(Barline.type.REPEAT_END)`

この方法なら、調号・拍子記号・複数段の整列と自然に共存しやすい。

### 4. 小節複製を共通ユーティリティへ寄せる

`repeatMarkerUtils.ts` に以下を切り出す。

- `cloneMeasureData()`
- `createEmptyMeasure()`
- `toggleMeasureRepeatMarker()`

これにより、音符削除・臨時記号適用・和音追加など既存の編集経路でも、小節のリピート属性を失わずに済む。

### 5. `ScorePage` から `PlaybackEngine` へ渡す前に再生順へ反映する

見た目だけで終わると、ユーザーは「譜面では `||:` / `:||` が見えているのに、再生では素通りする」と感じる。  
このアプリの再生ボタンは `ScorePlayer` ではなく `ScorePage` から `PlaybackEngine.playParts()` を直接呼んでいるため、
そこで小節順をいったん展開してから各音源実装へ渡す。

- `repeatStart` から `repeatEnd` までを **1 回だけ** 繰り返す
- 開始リピートが無い `:||` は、譜面先頭へ戻る
- 同じ終了リピートで何度も戻らないよう、通過済みの `repeatEnd` を記録する
- 想定外データでも止まり続けないよう、展開回数へ安全上限を設ける

高度な記法（1 番括弧、D.S.、Coda など）は今回の対象外とし、基本的なリピート記号の再生に絞る。

## 影響範囲

- `src/types/storage.ts`
- `src/utils/storage.ts`
- `src/utils/repeatMarkerUtils.ts`
- `src/audio/repeatPlaybackUtils.ts`
- `src/components/ScorePage.tsx`
- `src/components/Palette.tsx`
- `src/components/StaffCanvas.tsx`
- `src/components/PianoSystemCanvas.tsx`
- `README.md`

## セキュリティ配慮

- 保存データの `repeatStart / repeatEnd` は boolean のみ受け入れる
- 小節複製ユーティリティを通して、編集操作によるメタデータ消失を防ぐ
- 再生順展開は「終了リピートごとに 1 回まで」に制限し、無限ループを防ぐ
