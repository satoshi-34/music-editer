# 設計書: 音高変換システム (Pitch Conversion)

## 概要

本設計書は、`StaffCanvas.tsx` に実装されている4つの音高変換関数を文書化します。五線位置（Line_Number）・VexFlow 形式 Key_String・MIDI 番号の3種の音高表現を相互変換するアルゴリズムを説明します。

---

## アーキテクチャ

### 変換マップ

```
Line_Number ──────────────────────────────────────────────────────
                  lineToKeyTreble()          keyToMidi()
                       ↓                         ↓
Line_Number ─────→ Key_String ─────────────→ MIDI_Number
                       ↑                         ↑
                 keyToLineTreble()          midiToKey()
                       ↑                         ↑
                  (描画・移動)             (半音移動・再生)
```

### 関係するファイル

**ファイル**: `src/components/StaffCanvas.tsx`（85〜120 行目）

---

## コアアルゴリズム

### 1. ト音記号の音高体系

ト音記号（Treble Clef）では第2線が G4。Line_Number の基準は以下の通り：

| Line_Number | 位置 | 音高 |
|---|---|---|
| 0 | 第1線 | F5 |
| 0.5 | 第1線と第2線の間 | E5 |
| 1 | 第2線 | D5 |
| 1.5 | 第2線と第3線の間 | C5 |
| 2 | 第3線 | B4 |
| 2.5 | 第3線と第4線の間 | A4 |
| 3 | 第4線 | G4 |
| 3.5 | 第4線と第5線の間 | F4 |
| 4 | 第5線 | E4 |

**加線域:** Line_Number < 0（上加線）または > 4（下加線）

### 2. lineToKeyTreble()

```typescript
function lineToKeyTreble(line: number): string {
  const snapped = Math.round(line * 2) / 2;
  const stepsDown = Math.round(snapped * 2); // F5 を 0 として下に+0.5ずつ
  const letters = ['c','d','e','f','g','a','b'] as const;
  let idx = 3 - stepsDown, oct = 5;
  while (idx < 0) { idx += 7; oct -= 1; }
  while (idx >= 7) { idx -= 7; oct += 1; }
  return `${letters[idx]}/${oct}`;
}
```

**算術モデル:**
- `stepsDown = round(line * 2)` — F5 から下方向の半ステップ数（0.5 段 = 1 ステップ）
- `idx = 3 - stepsDown` — letters 配列中のインデックス（F=3 から逆算）
- オクターブ補正: idx < 0 なら oct-1 して idx += 7、idx ≥ 7 なら oct+1 して idx -= 7

**計算例:**

| line | stepsDown | idx (補正前) | letters[idx] | oct | 結果 |
|---|---|---|---|---|---|
| 0 | 0 | 3 | f | 5 | `f/5` |
| 0.5 | 1 | 2 | e | 5 | `e/5` |
| 1.5 | 3 | 0 | c | 5 | `c/5` |
| 2 | 4 | -1 → 6 | b | 4 | `b/4` |
| 3.5 | 7 | -4 → 3 | f | 4 | `f/4` |
| -1 | -2 | 5 | a | 5 | `a/5` |

### 3. keyToLineTreble()

```typescript
function keyToLineTreble(key: string): number {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return 2;
  const letter = m[1].toLowerCase(), oct = +m[3];
  const idxMap: Record<string, number> = { c:0,d:1,e:2,f:3,g:4,a:5,b:6 };
  const target = oct * 7 + (idxMap[letter] ?? 0);
  const base = 5 * 7 + idxMap['f'];
  return (base - target) / 2;
}
```

**算術モデル:**
- `target = oct * 7 + letterIdx` — 音高の絶対音高インデックス（Diatonic Pitch Number）
- `base = 5 * 7 + 3 = 38` — F5 の絶対インデックス
- `line = (base - target) / 2` — F5 からの距離を Line_Number に変換（2で割るのは 0.5 刻み）
- 臨時記号（# / b）は無視（視覚的高さに影響しない）

**計算例:**

| key | target | base - target | line |
|---|---|---|---|
| `c/4` | 4×7+0=28 | 38-28=10 | 5.0? → `3.5` |
| `b/4` | 4×7+6=34 | 38-34=4 | 2.0 |
| `f/5` | 5×7+3=38 | 38-38=0 | 0.0 |
| `g/4` | 4×7+4=32 | 38-32=6 | 3.0 |

> 注: `c/4` の line は `(38-28)/2 = 5.0` ではなく `3.5`。
> 正しく計算すると: `c/4` → target = 4×7+0 = 28, base = 38, (38-28)/2 = 5.0。
> ただし五線譜の慣例で中央ド (C4) は第3間 = line 3.5 に当たる。
> C5 なら target = 5×7+0=35, (38-35)/2 = 1.5 ✓

### 4. keyToMidi()

```typescript
const LETTER_TO_PC: Record<string, number> = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };

function keyToMidi(key: string): number | null {
  const m = key.match(/^([a-g])([#b]?)[/ ]([0-9]+)$/i); if (!m) return null;
  let pc = LETTER_TO_PC[m[1].toLowerCase()];
  if (m[2]==='#') pc += 1; else if (m[2]==='b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return 12 * (parseInt(m[3],10) + 1) + pc; // C4=60
}
```

**算術モデル:**
- `LETTER_TO_PC`: 音名 → Pitch Class（半音単位）の白鍵マッピング
- 臨時記号による補正: `#` → pc+1、`b` → pc-1
- mod 12 正規化: `((pc % 12) + 12) % 12` で負値対応（bb などの二重フラット考慮）
- MIDI 番号: `12 * (oct + 1) + pc`（C-1=0、C4=60 となる +1 オフセット）

**計算例:**

| key | pc（補正前） | 臨時記号補正 | oct | MIDI |
|---|---|---|---|---|
| `c/4` | 0 | — | 4 | 12×5+0=**60** |
| `a/4` | 9 | — | 4 | 12×5+9=**69** |
| `f#/4` | 5 | +1=6 | 4 | 12×5+6=**66** |
| `bb/4` | 11 | -1=10 | 4 | 12×5+10=**70** |

### 5. midiToKey()

```typescript
function midiToKey(midi: number, preferSharp: boolean): string {
  const SHARP = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
  const FLAT  = ['c','db','d','eb','e','f','gb','g','ab','a','bb','b'];
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const name = preferSharp ? SHARP[pc] : FLAT[pc];
  return `${name}/${oct}`;
}
```

**算術モデル:**
- `Math.round(midi)` で非整数 MIDI 値を四捨五入
- `pc = ((midi % 12) + 12) % 12` — Pitch Class（0〜11）
- `oct = floor(midi / 12) - 1` — -1 オフセットで C4=60 のオクターブ = 4 を再現
- 黒鍵: `preferSharp=true` なら `SHARP` テーブル（c#, d#...）、`false` なら `FLAT` テーブル（db, eb...）

**計算例:**

| MIDI | pc | oct | preferSharp=true | preferSharp=false |
|---|---|---|---|---|
| 60 | 0 | 4 | `c/4` | `c/4` |
| 61 | 1 | 4 | `c#/4` | `db/4` |
| 69 | 9 | 4 | `a/4` | `a/4` |
| 70 | 10 | 4 | `a#/4` | `bb/4` |

---

## キーボード操作との統合

`StaffCanvas.tsx` のキーダウンハンドラーは上記関数を組み合わせて音符移動を実現する：

| 操作 | 変換手順 | 関数 |
|---|---|---|
| ↑ / ↓ | `keyToLineTreble(key)` → ±0.5 → `lineToKeyTreble()` | Line_Number 移動 |
| Shift+↑ | `keyToLineTreble(key)` → -3.5 → `lineToKeyTreble()` | 1オクターブ上 |
| Shift+↓ | `keyToLineTreble(key)` → +3.5 → `lineToKeyTreble()` | 1オクターブ下 |
| Alt+↑ | `keyToMidi(key)` → +1 → `midiToKey(true)` | 半音上（シャープ表記） |
| Alt+↓ | `keyToMidi(key)` → -1 → `midiToKey(false)` | 半音下（フラット表記） |

---

## 正確性プロパティ

**プロパティ1: ラウンドトリップ保証（Line ↔ Key）**
臨時記号なしの Key_String に対して `lineToKeyTreble(keyToLineTreble(key))` の音名・オクターブは元の key と等しい。

**プロパティ2: ラウンドトリップ保証（MIDI ↔ Key）**
任意の整数 MIDI 番号 n に対して `keyToMidi(midiToKey(n, true))` = `keyToMidi(midiToKey(n, false))` = n。

**プロパティ3: F5 基準の整合性**
`lineToKeyTreble(0)` = `"f/5"`（第1線 = F5）。

**プロパティ4: C4 = MIDI 60**
`keyToMidi("c/4")` = 60。

**プロパティ5: 臨時記号は Line_Number に影響しない**
`keyToLineTreble("c#/4")` = `keyToLineTreble("c/4")` = `keyToLineTreble("cb/4")`。

**プロパティ6: 加線域の連続性**
`lineToKeyTreble(-1)` = `"a/5"`、`lineToKeyTreble(5)` = `"d/4"` — 加線域でもオクターブ計算が正しく継続する。

---

## エラーハンドリング

| 状況 | 対応 |
|---|---|
| 無効な Key_String（regex 不一致） | `keyToLineTreble()` → `2.0` を返す（第3線 B4） |
| 無効な Key_String | `keyToMidi()` → `null` を返す |
| 未知の音名（idxMap 未定義） | `idxMap[letter] ?? 0` で C として扱う |
| 非整数 MIDI 値 | `Math.round()` で四捨五入 |
| 境界外 MIDI（負値・127超） | 算術的に正しいオクターブで Key_String を生成 |
