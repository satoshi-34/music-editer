# 設計書: SimpleAudioEngine

## 概要

本設計書は、`src/audio/SimpleAudioEngine.ts` に実装されているシンプルな音声エンジンを文書化します。Tone.js を使わず Web Audio API を直接使用することで、ブラウザの自動再生ポリシーに確実に対応しています。

---

## アーキテクチャ

### 音声処理グラフ

```
OscillatorNode (sine wave)
        ↓
GainNode (エンベロープ制御)
        ↓
AudioContext.destination (スピーカー)
```

### クラス構造

```typescript
class SimpleAudioEngine {
  private context: AudioContext | null = null;    // 遅延初期化
  private isInitialized: boolean = false;
  private oscillators: Map<string, OscillatorNode> = new Map();

  async initialize(): Promise<void>
  async playNote(frequency: number, duration?: number): Promise<void>
  noteToFrequency(note: string): number
  durationToSeconds(duration: string, bpm?: number): number
  getState(): AudioContextState | 'uninitialized'
  isReady(): boolean
  async playScore(scoreData: ..., bpm?: number): Promise<void>
  private async playNoteAtTime(frequency, duration, startTime): Promise<void>
  dispose(): void
}

export const defaultSimpleAudioEngine = new SimpleAudioEngine();
```

### 関係するファイル

| ファイル | 役割 |
|---|---|
| `src/audio/SimpleAudioEngine.ts` | エンジン本体 |
| `src/components/ScorePage.tsx` | `defaultSimpleAudioEngine` の利用・初期化トリガー |
| `src/audio/AudioEngine.ts` | Tone.js 版エンジン（代替実装。現在は SimpleAudioEngine が主に使用） |

---

## コアアルゴリズム

### 1. 遅延初期化 (initialize)

```typescript
async initialize(): Promise<void> {
  if (this.isInitialized && this.context) return; // 二重初期化防止

  this.context = new AudioContext();

  if (this.context.state === 'suspended') {
    await this.context.resume(); // ブラウザの自動再生ポリシー対応
  }

  this.isInitialized = true;
}
```

**自動再生ポリシー対応:**
- コンストラクタでは `AudioContext` を作成しない
- ユーザーのクリック/キー操作後に `initialize()` を呼ぶことで `running` 状態を保証
- `suspended` 状態を `resume()` で解除

---

### 2. 単音再生 (playNote / playNoteAtTime)

```typescript
// エンベロープ設計
gainNode.gain.setValueAtTime(0, t);
gainNode.gain.linearRampToValueAtTime(0.3, t + 0.01);          // アタック 10ms
gainNode.gain.exponentialRampToValueAtTime(0.1, t + dur * 0.3); // ディケイ
gainNode.gain.exponentialRampToValueAtTime(0.01, t + dur);      // リリース
```

| フェーズ | 時刻 | ゲイン |
|---------|------|-------|
| 開始     | t    | 0     |
| アタック終了 | t + 10ms | 0.3 |
| ディケイ終了 | t + dur×30% | 0.1 |
| リリース終了 | t + dur | 0.01 |

---

### 3. 音高変換 (noteToFrequency)

```typescript
// 音名 → ピッチクラスのマッピング
const noteMap: Record<string, number> = {
  'C':0, 'C#':1, 'Db':1, 'D':2, 'D#':3, 'Eb':3, 'E':4,
  'F':5, 'F#':6, 'Gb':6, 'G':7, 'G#':8, 'Ab':8,
  'A':9, 'A#':10, 'Bb':10, 'B':11
};

// A4=440Hz 基準の周波数計算
const semitonesFromA4 = (octave - 4) * 12 + (noteNumber - 9);
const frequency = 440 * Math.pow(2, semitonesFromA4 / 12);
```

**変換パイプライン:**
```
VexFlow形式 "c/4"
    ↓ normalizeNoteFormat()
MIDI形式 "C4"
    ↓ noteMap + octave parse
semitones from A4 = (4-4)*12 + (0-9) = -9
    ↓ 440 * 2^(-9/12)
261.63 Hz
```

**検証:**
- `"c/4"` → `"C4"` → pitch=0, oct=4 → semitones = -9 → 261.63Hz ✓
- `"a/4"` → `"A4"` → pitch=9, oct=4 → semitones = 0 → 440.00Hz ✓
- `"f#/3"` → `"F#3"` → pitch=6, oct=3 → semitones = -27 → 185.00Hz ✓

---

### 4. 音高文字列の正規化 (normalizeNoteFormat)

```typescript
private normalizeNoteFormat(note: string): string {
  // MIDI形式（C4, F#3）はそのまま返す
  if (/^[A-G][#b]?\d+$/.test(note)) return note;

  // VexFlow形式（c/4, f#/3）をMIDI形式に変換
  const vexflowMatch = note.match(/^([a-g])([#b]?)[\/\s](\d+)$/);
  if (vexflowMatch) {
    const letter = vexflowMatch[1].toUpperCase();
    const accidental = vexflowMatch[2] || '';
    const octave = vexflowMatch[3];
    return `${letter}${accidental}${octave}`;
  }

  return note; // 認識不可能な場合はそのまま返す
}
```

---

### 5. 楽譜全体の再生 (playScore)

```typescript
async playScore(scoreData, bpm = 120): Promise<void> {
  let currentTime = this.context.currentTime;

  for (const measure of scoreData) {
    if (!measure || !measure.events?.length) {
      // 空小節: 全音符分の時間を進める
      currentTime += this.durationToSeconds('1', bpm);
      continue;
    }

    for (const event of measure.events) {
      const duration = this.durationToSeconds(event.dur, bpm);
      if (!event.isRest) {
        const frequency = this.noteToFrequency(event.key);
        await this.playNoteAtTime(frequency, duration, currentTime);
      }
      currentTime += duration; // 休符も時間は進める
    }
  }
}
```

**設計の意図:** `playNoteAtTime` で将来の時刻にスケジュールするため、`await` が完了してもオーディオは続いて再生される。JS スレッドのブロッキングなしに全スケジュールが完了する。

---

### 6. 音価変換テーブル (durationToSeconds)

```typescript
const durMap: Record<string, number> = {
  '1': 4,      // 全音符
  '2': 2,      // 二分音符
  '4': 1,      // 四分音符（基準）
  '8': 0.5,    // 八分音符
  '16': 0.25,  // 十六分音符
  '32': 0.125, // 三十二分音符
  '64': 0.0625 // 六十四分音符
};

const beats = durMap[duration] || 1; // 未知は四分音符扱い
const seconds = beats * (60 / bpm);
```

---

## データモデル

### 再生入力の型

```typescript
// playScore に渡すデータ
type ScorePlaybackData = Array<{
  events: Array<{
    dur: string;     // 音価キー ('1'|'2'|'4'|'8'|'16'|'32'|'64')
    isRest: boolean; // 休符フラグ
    key: string;     // 音高 VexFlow形式 ("c/4" 等)
  }>;
}>;
```

---

## 正確性プロパティ

**プロパティ1: 遅延初期化の保証**
`new SimpleAudioEngine()` 直後は `context === null` かつ `isInitialized === false` である。

**プロパティ2: A440 基準**
`noteToFrequency("a/4") === 440`（IEEE 浮動小数点の精度範囲内）。

**プロパティ3: 二重初期化なし**
`isInitialized && context` が真の場合、`initialize()` は即座にリターンし `AudioContext` を再作成しない。

**プロパティ4: 休符スキップ**
`event.isRest === true` の場合、`playNoteAtTime` は呼び出されない。`currentTime` は音価分だけ進む。

**プロパティ5: 単調時間進行**
`playScore` 内の `currentTime` は常に単調増加する（音符・休符ともに `+= duration`）。

**プロパティ6: エンベロープの終端**
リリース終了時のゲイン値は `0.01`（0 に指数的に漸近。`exponentialRampToValueAtTime` は 0 を指定できないため）。

---

## エラーハンドリング

| シナリオ | 対応 |
|---|---|
| `initialize()` 前の `playNote()` | `if (!this.context) throw new Error(...)` |
| 無効な音高名 | `noteToFrequency` がデフォルト 440Hz を返す |
| 未知の音価キー | `durMap[duration] || 1` で四分音符扱い |
| `dispose()` 中のエラー | `try/catch` でログ記録し例外を外部に伝播しない |
| AudioContext が `suspended` | `initialize()` 内で `resume()` を呼び出す |
