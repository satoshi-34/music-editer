# 設計書: タイ（Tie）実装

## 概要

楽譜記号の第一弾として、隣接する音符を結ぶ「タイ」を実装した。
ドラッグ操作で直感的に設置でき、小節をまたぐタイにも対応する。

---

## データモデル

### 変更ファイル: `src/types/storage.ts`

`NoteEvent` に `tiedToNext?: boolean` フィールドを追加。

```typescript
export interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  keys: string[];
  tiedToNext?: boolean;  // この音符から次の音符へタイを引く
}
```

- **後方互換**: optional フィールドのため既存セーブデータの読み込みに影響なし
- `validateNoteEvent()` は未知フィールドを許容する構造なので変更不要
- `StaffCanvas.tsx` / `PianoSystemCanvas.tsx` のローカル `NoteEvent` 型も同様に更新

---

## UI / ツール

### 変更ファイル: `src/components/Palette.tsx`

`Tool` 型を判別共用体に拡張:

```typescript
export type Tool =
  | { duration: DurKey; isRest?: boolean }  // 既存
  | { mode: 'tie' };                        // 追加
```

パレット下部にタイボタンを追加（弧形 SVG アイコン）。
アクティブ時は青枠＋薄青背景で強調表示。

---

## ドラッグ操作

### 操作フロー

1. パレットのタイボタンを選択
2. 開始音符の note hit rect で `mousedown` → `tieStartRef` に開始情報を記録
3. ドラッグ中: SVG `mousemove` でプレビュー弧（青い点線）をリアルタイム描画
4. 終了音符の note hit rect で `mouseup` → `applyTies()` で範囲内音符に `tiedToNext: true` を付与
5. SVG 上でリリースした場合（音符外）はキャンセル

### プレビュー弧

```svg
<path stroke="#3b82f6" stroke-dasharray="5 3" opacity="0.8" />
<!-- 二次ベジェ曲線: M sx sy Q midX arcY mx my -->
```

`arcY = max(sy, my) + 18` で常に音符の下を通るよう設定。

### `applyTies(m1, n1, m2, n2)`

範囲内の音符に `tiedToNext: true` を付与するロジック:

- 始点 > 終点の場合は自動的に正規化（逆ドラッグ対応）
- 同一音符でのリリースはキャンセル
- 休符には付与しない
- **設置範囲**: events[m1][n1] 〜 events[m2][n2-1]（終点音符自体には付与しない）

---

## 描画

### 同一小節内タイ

`voice.draw()` 直後、`beams.forEach()` の後に挿入:

```typescript
for (let j = 0; j < safeEvents.length - 1; j++) {
  if (safeEvents[j].tiedToNext && !safeEvents[j].isRest) {
    new StaveTie({
      firstNote: vfNotes[j], lastNote: vfNotes[j + 1],
      firstIndexes: [0], lastIndexes: [0],
    }).setContext(ctx).draw();
  }
}
```

### 小節をまたぐタイ

外側ループ（システム行ループ）の前に `carryTie` を宣言:

```typescript
let carryTie: { note: StaveNote } | null = null;
```

各小節の `voice.draw()` 後:
1. `carryTie` があれば現在小節の先頭音符と接続して描画
2. 現在小節末尾の `tiedToNext` 音符があれば `carryTie` に記録

### PianoSystemCanvas での対応

パート（段）ごとに独立したタイが必要なため、`carryTies` を配列で管理:

```typescript
const carryTies: Array<{ note: StaveNote } | null> = parts.map(() => null);
```

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/types/storage.ts` | `NoteEvent.tiedToNext?: boolean` を追加 |
| `src/components/Palette.tsx` | `Tool` 型を判別共用体に拡張、タイボタン UI 追加 |
| `src/components/StaffCanvas.tsx` | `tieStartRef`・`applyTies`・ドラッグハンドラ・StaveTie 描画追加 |
| `src/components/PianoSystemCanvas.tsx` | 同上（`carryTies` 配列でパートごとに管理） |

---

## 今後の拡張

- **タイ削除**: タイモードで同じ音符を再クリック or 別途消しゴムツール
- **スラー**: `MeasureData` に `slurs?: SlurSpan[]` を追加し `Curve` クラスで描画（Phase 2）
