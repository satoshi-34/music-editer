# 設計書: 小節幅の自動割り付け (Measure Width Auto-Layout)

## 概要

本設計書は、`StaffCanvas.tsx` に実装されている小節幅の自動割り付けアルゴリズムを文書化します。音価に基づく相対幅計算と、ページ幅への均等充填の仕組みを説明します。

---

## アーキテクチャ

### 計算フロー

```
ScoreData (MeasureData[])
        ↓
  minContentWidth(measure)    ← 各小節の最小必要幅を計算
        ↓
  candidates = [4, 3, 2, 1]  ← 1行あたりの小節数を試行
        ↓
  収まる最大の小節数を決定
        ↓
  残余幅を各小節に均等配分   ← TARGET_FILL 分を充填
        ↓
  VexFlow Formatter へ渡す
        ↓
  SVG 描画
```

### 関係するファイルと定数

**ファイル**: `src/components/StaffCanvas.tsx`

```typescript
// レイアウト定数
const TARGET_FILL = 0.99;           // ページ幅の充填率
const PAGE_LEFT = 4, PAGE_RIGHT = 4; // ページ余白（px）
const MIN_MEASURE_W = 52;           // 最小小節幅（px）
const LONG_HALF_MIN = 80;           // 二分音符含む場合の最小幅
const LONG_WHOLE_MIN = 92;          // 全音符含む場合の最小幅
const BASE_PAD = 14;                // 小節ベースパディング（px）
const UNIT_WIDTH = 9;               // 1単位あたりのピクセル数
const FLAG_EXTRA_PX = 4;           // 32/64分のフラグ余白（px）
const EMPTY_MEASURE_UNITS = 0.6;    // 空小節のデフォルト単位数
const BEATS_PER_MEASURE = 4;        // 4/4拍子の拍数
const CLEF_PAD_FIRST = 50;          // 第1段の音部記号幅（px）
const CLEF_PAD_OTHER = 28;          // 第2段以降の音部記号幅（px）
```

---

## コアアルゴリズム

### 1. 音価変換テーブル

```typescript
// DurKey → VFDur（VexFlow 形式）
const toVFDur = (d: DurKey): VFDur =>
  d==='1'?'w':d==='2'?'h':d==='4'?'q':d==='8'?'8'
  :d==='16'?'16':d==='32'?'32':d==='64'?'64':'q';

// VFDur → 拍数（4分音符=1拍）
const beatsFromVF = (vf: VFDur) =>
  vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4
  : vf==='8'?1/2 : vf==='q'?1 : vf==='h'?2 : 4;

// VFDur → 分母数値（全音符=1, 四分音符=4 等）
const vfToDenom = (vf: VFDur) =>
  vf==='64'?64 : vf==='32'?32 : vf==='16'?16
  : vf==='8'?8 : vf==='q'?4 : vf==='h'?2 : 1;
```

### 2. Duration_Unit テーブル（UNIT_BY_DENOM）

```typescript
const UNIT_BY_DENOM: Record<number, number> = {
  1:  1.45,  // 全音符    — 広め（符頭が大きい）
  2:  1.25,  // 二分音符  — やや広め
  4:  1.00,  // 四分音符  — 基準
  8:  0.60,  // 八分音符  — 狭め
  16: 0.50,  // 十六分音符 — より狭め
  32: 2.20,  // 三十二分音符 — フラグ対応で広め
  64: 2.60   // 六十四分音符 — フラグ対応でさらに広め
};
```

**設計の意図:**
- 32分/64分が 1.0 より大幅に大きいのは、符尾（フラグ）が複数本あり描画領域が広いため
- 8分/16分が小さいのは連符でまとまる場合が多く、視覚的密度が高いため

### 3. イベント単位計算（unitsForEvent）

```typescript
function unitsForEvent(ev: NoteEvent): number {
  const d = vfToDenom(toVFDur(ev.dur));
  const flagExtra = d >= 16 ? (FLAG_EXTRA_PX / UNIT_WIDTH) : 0;
  return (UNIT_BY_DENOM[d] ?? 1) * (ev.isRest ? 0.85 : 1) + flagExtra;
}
```

**休符の係数（0.85）:** 休符は音符より視覚的幅が小さいため、幅重みを 15% 削減

### 4. 最小必要幅の計算（minContentWidth）

```typescript
function minContentWidth(m?: MeasureData): number {
  if (!m || !m.events?.length) {
    // 空小節: EMPTY_MEASURE_UNITS 分の幅
    return Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * EMPTY_MEASURE_UNITS);
  }

  let hasHalf = false, hasWhole = false;
  const units = m.events.reduce((sum, ev) => {
    const denom = vfToDenom(toVFDur(ev.dur));
    if (denom === 2) hasHalf = true;
    if (denom === 1) hasWhole = true;
    return sum + unitsForEvent(ev);
  }, 0);

  const raw = Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * units);

  // 長い音価への最小幅保証
  if (hasWhole) return Math.max(raw, LONG_WHOLE_MIN);  // 92px
  if (hasHalf)  return Math.max(raw, LONG_HALF_MIN);   // 80px
  return raw;
}
```

**計算例:**
| 小節内容 | units | raw(px) | 下限 | 最終幅 |
|---|---|---|---|---|
| 空 | 0.6 | max(52, 14+5.4)=52 | — | 52px |
| 四分音符×4 | 4.0 | max(52, 14+36)=52 | — | 52px |
| 全音符×1 | 1.45+0 | max(52, 14+13)=52 | 92 | **92px** |
| 二分音符×2 | 2.5 | max(52, 14+22.5)=52 | 80 | **80px** |
| 八分音符×8 | 4.8 | max(52, 14+43.2)=57.2 | — | 57.2px |

### 5. 段あたりの小節数の決定

```typescript
const candidates = [measuresPerSystem, 3, 2, 1]
  .filter((v, i, a) => a.indexOf(v) === i); // 重複除去

let chosen = 1, widths: number[] = [];

for (const n of candidates) {
  const measures = score.slice(start, start + n);
  const minWidths = measures.map(minContentWidth);
  const sumMin = minWidths.reduce((s, w) => s + w, 0);
  
  // ト音記号・拍子記号のパディング
  const clefPad = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;
  
  if (clefPad + sumMin <= innerW * TARGET_FILL) {
    // 収まる場合: 残余幅を比例配分
    const extra = innerW * TARGET_FILL - clefPad - sumMin;
    const totalMin = sumMin;
    widths = minWidths.map(w => w + extra * (w / totalMin));
    chosen = n;
    break;
  }
}
```

---

## データモデル

### 型定義

```typescript
type DurKey = '1' | '2' | '4' | '8' | '16' | '32' | '64';
type VFDur  = 'w' | 'h' | 'q' | '8' | '16' | '32' | '64';

type NoteEvent = {
  dur:    DurKey;   // アプリ内音価表現
  isRest: boolean;  // 休符フラグ
  key:    string;   // 音高 ("c/4" 等)
};

type MeasureData = {
  events: NoteEvent[];
};
```

---

## 正確性プロパティ

**プロパティ1: 最小幅保証**
任意の MeasureData に対して、`minContentWidth()` の戻り値は常に `MIN_MEASURE_W`（52px）以上である。

**プロパティ2: 全音符・二分音符の下限**
全音符を含む小節の幅は `LONG_WHOLE_MIN`（92px）以上。二分音符を含む場合は `LONG_HALF_MIN`（80px）以上。

**プロパティ3: 充填率の遵守**
配置された全小節の合計幅（+ 音部記号幅）は `innerW * TARGET_FILL` を超えない。

**プロパティ4: 拍数制限**
`beatsFromVF` の合計が `BEATS_PER_MEASURE`（4）を超える音符の追加は拒否される。

**プロパティ5: 単調性**
`UNIT_BY_DENOM` において、隣接する音価（1倍音価は1/2の音価より多いか等しい幅単位）の関係は常に成立する。ただし 32/64分は例外（フラグ対応）。

---

## エラーハンドリング

| シナリオ | 対応 |
|---|---|
| `UNIT_BY_DENOM[denom]` が未定義 | `?? 1` でデフォルト 1 単位を使用 |
| 空の小節配列 | `EMPTY_MEASURE_UNITS` による最小幅を返す |
| ページ幅に1小節も入らない | `candidates` の最後の `1` にフォールバック |
| `minContentWidth` の合計がページ幅超過 | VexFlow Formatter が圧縮して描画（一部重なる可能性あり） |
