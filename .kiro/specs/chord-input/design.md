# 設計文書: 和音入力機能（chord-input）

## 概要

音楽エディターアプリケーションに和音（コード）機能を追加する。現在の `NoteEvent` は `key: string`（単音）しか持てない構造だが、`keys: string[]`（複数音高）に拡張することで、和音の入力・表示・再生・保存を実現する。

既存のアーキテクチャ（VexFlow による描画、Tone.js による再生、localStorage による永続化）を最大限に活用し、後方互換性を維持しながら段階的に拡張する。

## アーキテクチャ

### 全体構成

```mermaid
graph TB
    subgraph "UI Layer"
        SC[StaffCanvas]
        PSC[PianoSystemCanvas]
        SP[ScorePage]
    end

    subgraph "Data Model"
        NE[NoteEvent\nkeys: string[]]
        MD[MeasureData]
        SD[SavedScoreData]
    end

    subgraph "Audio Layer"
        NP[NotePlayer\n和音対応]
        SPL[ScorePlayer\n和音対応]
        SAE[SimpleAudioEngine]
    end

    subgraph "Storage Layer"
        ST[storage.ts\nマイグレーション対応]
        LS[localStorage]
    end

    subgraph "External Libraries"
        VF[VexFlow\nStaveNote multi-keys]
        TJ[Tone.js / Web Audio API]
    end

    SC --> NE
    PSC --> NE
    NE --> MD --> SD
    SC --> NP
    SP --> SPL
    NP --> SAE --> TJ
    SPL --> SAE
    SD --> ST --> LS
    SC --> VF
    PSC --> VF
```

### 変更の影響範囲

| レイヤー | 変更対象 | 変更内容 |
|---|---|---|
| データモデル | `src/types/storage.ts` | `NoteEvent.key` → `NoteEvent.keys` |
| ストレージ | `src/utils/storage.ts` | 旧形式マイグレーション、バリデーション更新 |
| 描画 | `src/components/StaffCanvas.tsx` | 和音入力・表示ロジック |
| 描画 | `src/components/PianoSystemCanvas.tsx` | 和音入力・表示ロジック |
| 再生 | `src/audio/SimpleAudioEngine.ts` | 複数音高の同時再生 |
| 再生 | `src/audio/NotePlayer.ts` | `playChord` メソッド追加 |
| 再生 | `src/audio/ScorePlayer.ts` | 和音スケジューリング対応 |

## コンポーネントとインターフェース

### データモデルの拡張（NoteEvent）

```typescript
// 変更前
interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  key: string;  // 単音のみ
}

// 変更後
interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  keys: string[];  // 単音: ["c/4"]、和音: ["c/4", "e/4", "g/4"]
}
```

`key` フィールドは削除し、`keys` 配列に統一する。後方互換性は Storage 層のマイグレーション関数で対応する。

### Storage 層の変更

#### バリデーション関数の更新

```typescript
// 旧形式（key: string）の判定
function isLegacyNoteEvent(event: any): boolean {
  return (
    event &&
    typeof event === 'object' &&
    typeof event.key === 'string' &&
    !Array.isArray(event.keys)
  );
}

// 旧形式から新形式へのマイグレーション
function migrateNoteEvent(event: any): NoteEvent {
  if (isLegacyNoteEvent(event)) {
    return {
      dur: event.dur,
      isRest: event.isRest,
      keys: [event.key],  // key → keys: [key]
    };
  }
  return event as NoteEvent;
}

// 新形式の NoteEvent バリデーション
function validateNoteEvent(event: any): event is NoteEvent {
  return (
    event &&
    typeof event === 'object' &&
    isValidDurKey(event.dur) &&
    typeof event.isRest === 'boolean' &&
    Array.isArray(event.keys) &&
    event.keys.length >= 1 &&
    event.keys.every((k: any) => typeof k === 'string' && k.length > 0)
  );
}
```

### StaffCanvas の変更

#### 和音ゾーン検出（実装詳細）

音符の上をクリックしたときに「和音追加」か「新規挿入」かを判定するために、各音符に対して **和音ゾーン** を定義する。

**X 方向の判定**

当初は `n.getAbsoluteX()` をX基準にしていたが、`getAbsoluteX()` は VexFlow のスロット（tick）の左端を返すため、符頭の実際の描画位置より 15〜25px 程度左になる。そのため `getBoundingBox()` の `getX()` と `getX() + getW()` を使って符頭の実際の描画X範囲を取得する。

```typescript
const bb = n.getBoundingBox?.();
const noteVisualLeft = bb?.getX?.() ?? anchors[j];
const noteVisualRight = bb ? ((bb.getX?.() ?? anchors[j]) + (bb.getW?.() ?? 12)) : anchors[j] + 12;
// 和音ゾーン X 判定: [noteVisualLeft - CHORD_HIT_PAD, noteVisualRight + CHORD_HIT_PAD]
```

**Y 方向の判定**

音符のY位置ではなく、五線 ± 3加線の固定範囲を使う。これにより音符の高さに関係なく一定の判定範囲になる。

```typescript
const CHORD_LEDGER_TOP = -3; // 上方向の加線数
const CHORD_LEDGER_BOT = 7;  // 下方向（line 4 が五線の最下線、7 = 3本下）
const chordTopY = stave.getYForLine(CHORD_LEDGER_TOP);
const chordBotY = stave.getYForLine(CHORD_LEDGER_BOT);
```

**vf-note-hit rect のサイズ**

`vf-note-hit` rect は和音ゾーン全体（`chordTopY`〜`chordBotY`）をカバーするように設定する。音符のY中心だけをカバーすると、加線域をクリックしたとき rect の外になり `insertRect`（新規挿入）に落ちてしまうため。

```typescript
// rect は和音ゾーン全体をカバー
const yHit = chordTopY;
const safeH = chordBotY - chordTopY;
```

**休符のクリック処理**

`vf-note-hit` rect が大きくなったことで、休符のクリックも rect が捕まえるようになる。休符の場合は選択ではなく `doInsertAt` を呼び出して新規音符を挿入する（rect が大きくなる前は insertRect に届いていたため選択のみでよかった）。

```typescript
} else if (safeEvents[j]?.isRest) {
  // 休符クリック → 音符を挿入（rect が大きくなり insertRect に届かないため）
  doInsertAt(lx, ly, measureIndex);
}
```

**和音入力のトリガー**

Shift キー不要。音符の描画X範囲内（`± CHORD_HIT_PAD`）かつ固定Y範囲内をクリックすると和音追加になる。セル内でも X 範囲外のクリックは新規音符挿入になる。

#### 和音入力ロジック

同じXゾーン内のクリックで新しい音高を `keys` 配列に追加する。

```typescript
// 和音入力の判定と処理
const handleChordInput = (
  selectedEvent: NoteEvent,
  newKey: string
): NoteEvent => {
  // 重複チェック
  if (selectedEvent.keys.includes(newKey)) {
    return selectedEvent;  // 変更なし
  }
  // 上限チェック（8音まで）
  if (selectedEvent.keys.length >= 8) {
    console.warn('[StaffCanvas] 和音の音高数が上限（8）に達しています');
    return selectedEvent;  // 変更なし
  }
  return {
    ...selectedEvent,
    keys: [...selectedEvent.keys, newKey],
  };
};

// 既存音高の削除（最後の1音は削除しない）
const removeKeyFromChord = (
  event: NoteEvent,
  keyToRemove: string
): NoteEvent => {
  if (event.keys.length <= 1) {
    return event;  // 最後の1音は削除しない
  }
  return {
    ...event,
    keys: event.keys.filter(k => k !== keyToRemove),
  };
};
```

#### キーボード操作の変更

```typescript
// 和音全体の音高移動（↑/↓キー）
const moveChordKeys = (
  event: NoteEvent,
  direction: 'up' | 'down',
  mode: 'step' | 'octave' | 'semitone',
  clef: ClefType
): NoteEvent => {
  const diff = mode === 'octave'
    ? (direction === 'up' ? -3.5 : 3.5)
    : (direction === 'up' ? -0.5 : 0.5);

  if (mode === 'semitone') {
    // 半音移動（Alt+↑/↓）
    return {
      ...event,
      keys: event.keys.map(key => {
        const midi = keyToMidi(key);
        if (midi == null) return key;
        return midiToKey(midi + (direction === 'up' ? 1 : -1), direction === 'up');
      }),
    };
  }

  // 線/間移動（↑/↓）またはオクターブ移動（Shift+↑/↓）
  return {
    ...event,
    keys: event.keys.map(key => lineToKeyForClef(clef, keyToLineForClef(clef, key) + diff)),
  };
};
```

#### VexFlow 描画の変更

```typescript
// 和音対応の StaveNote 生成
function makeVFNote(ev: NoteEvent, clef: ClefType): StaveNote {
  const vd = toVFDur(ev.dur);

  if (ev.isRest) {
    return new StaveNote({
      clef,
      keys: [restKeyForClef(clef)],
      duration: vd + 'r',
    });
  }

  // keys 配列が空の場合はスキップ（無効な NoteEvent）
  if (!ev.keys || ev.keys.length === 0) {
    // フォールバック: 全休符として描画
    return new StaveNote({
      clef,
      keys: [restKeyForClef(clef)],
      duration: vd + 'r',
    });
  }

  // 和音: 複数の keys を StaveNote に渡す
  const n = new StaveNote({ clef, keys: ev.keys, duration: vd });

  // 各音高に臨時記号を付与
  ev.keys.forEach((key, idx) => {
    const acc = key.match(/^[a-g]([#b]?)/i)?.[1] || '';
    if (acc) {
      try {
        (n as any).addModifier?.(idx, new Accidental(acc));
        (n as any).addAccidental?.(idx, new Accidental(acc));
      } catch { /* VexFlow バージョン差異を吸収 */ }
    }
  });

  return n;
}
```

### NotePlayer の変更

```typescript
// 和音再生メソッドの追加
async playChord(keys: string[], options: NotePlaybackOptions = {}): Promise<void> {
  const synth = this._getCurrentSynth();
  if (!synth || !this.audioEngine.isReady()) return;

  try {
    const toneKeys = keys.map(k => this._convertKeyToToneFormat(k));
    const velocity = Math.max(0, Math.min(1, options.velocity || 0.5));
    const duration = options.duration ?? this._durToSeconds('4');
    const time = options.time || '+0';

    // 前の音符を停止
    this.stopAllNotes();

    // すべての音高を同一時刻でスケジュール
    toneKeys.forEach(toneKey => {
      synth.triggerAttackRelease(toneKey, duration, time, velocity);
      this.currentNotes.add(toneKey);
    });

    // 再生完了後にセットから削除
    if (typeof duration === 'number') {
      setTimeout(() => {
        toneKeys.forEach(k => this.currentNotes.delete(k));
      }, duration * 1000);
    }
  } catch (error) {
    AudioErrorHandler.logError(
      AudioErrorFactory.createPlaybackError(
        `和音の再生に失敗しました: ${keys.join(', ')}`,
        error instanceof Error ? error : new Error(String(error))
      )
    );
    throw error;
  }
}

// NoteEvent から和音再生
async playNoteEvent(noteEvent: NoteEvent, options: NotePlaybackOptions = {}): Promise<void> {
  if (noteEvent.isRest) return;
  if (!noteEvent.keys || noteEvent.keys.length === 0) return;

  if (options.duration === undefined) {
    options.duration = this._durToSeconds(noteEvent.dur);
  }

  if (noteEvent.keys.length === 1) {
    return this.playNote(noteEvent.keys[0], options);
  }
  return this.playChord(noteEvent.keys, options);
}
```

### SimpleAudioEngine の変更

```typescript
// 複数音高の同時再生
async playChord(
  frequencies: number[],
  duration: number,
  startTime?: number
): Promise<void> {
  if (!this.context) throw new Error('AudioContextが初期化されていません');

  const t = startTime ?? this.context.currentTime;
  // すべての音高を同一時刻でスケジュール
  frequencies.forEach(frequency => {
    this.playNoteAtTime(frequency, duration, t);
  });
}

// playScore の和音対応
async playScore(
  scoreData: Array<{ events: Array<{ dur: string; isRest: boolean; keys: string[] }> }>,
  bpm: number = 120
): Promise<void> {
  // ...
  for (const event of measure.events) {
    const duration = this.durationToSeconds(event.dur, bpm);
    if (!event.isRest && event.keys && event.keys.length > 0) {
      const frequencies = event.keys.map(k => this.noteToFrequency(k));
      await this.playChordAtTime(frequencies, duration, currentTime);
    }
    currentTime += duration;
  }
}
```

### ScorePlayer の変更

```typescript
// 再生スケジュール生成の和音対応
private generatePlaybackSchedule(measures: MeasureData[]): ScheduledNote[] {
  const schedule: ScheduledNote[] = [];
  // ...
  for (const event of measure.events) {
    const duration = this.durToSeconds(event.dur, tempoSettings.bpm);
    if (!event.isRest && event.keys && event.keys.length > 0) {
      // 和音: 各音高を同一 time でスケジュール
      event.keys.forEach(key => {
        schedule.push({
          note: this.convertKeyToToneFormat(key),
          velocity: 0.5,
          duration,
          time: currentTime + measureTime,
          measureIndex,
          noteIndex,
          originalEvent: event,
        });
      });
    }
    measureTime += duration;
  }
  // ...
}
```

## データモデル

### NoteEvent（更新後）

```typescript
export interface NoteEvent {
  /** 音価 */
  dur: DurKey;
  /** 休符かどうか */
  isRest: boolean;
  /**
   * 音高キーの配列（VexFlow 形式: "c/4", "f#/3" など）
   * 単音: 1要素、和音: 2要素以上
   * isRest が true の場合は空配列または任意の値（無視される）
   */
  keys: string[];
}
```

### マイグレーション戦略

```mermaid
flowchart TD
    A[localStorage からデータ読み込み] --> B{v1 形式?\nkey: string}
    B -- Yes --> C[migrateV1toV2\nkey → keys: key]
    B -- No --> D{旧 NoteEvent 形式?\nkey: string}
    D -- Yes --> E[migrateNoteEvent\nkey → keys: key]
    D -- No --> F[validateNoteEvent\nkeys: string[]]
    C --> F
    E --> F
    F -- 有効 --> G[SavedScoreData として使用]
    F -- 無効 --> H[エラーログ + デフォルト休符]
```

### SavedScoreData（変更なし）

`SavedScoreData` 自体の構造は変更しない。`NoteEvent` の `keys` フィールドが JSON にシリアライズされるため、既存の保存・読み込みフローで自動的に対応される。

## 正確性プロパティ

*プロパティとは、システムのすべての有効な実行において真であるべき特性や動作のことです。これらは人間が読める仕様と機械で検証可能な正確性保証の橋渡しとなります。*

### プロパティ1: NoteEvent シリアライズのラウンドトリップ

*任意の* 有効な NoteEvent（単音・和音を問わず）に対して、JSON シリアライズしてデシリアライズした結果は元のデータと深く等価でなければならない

**検証対象: 要件1.5**

### プロパティ2: 旧形式データのマイグレーション正確性

*任意の* `key: string` 形式の旧 NoteEvent データに対して、マイグレーション関数は `keys: [key]` 形式に正確に変換しなければならない

**検証対象: 要件1.2, 6.3**

### プロパティ3: 和音への音高追加の不変条件

*任意の* 有効な NoteEvent と新しい音高キーに対して、addKeyToChord 関数は以下の不変条件を満たさなければならない:
- 重複しない音高の追加後、keys の長さが1増える
- 既存の音高を追加しても keys は変化しない
- keys の長さが8の場合、追加しても keys は変化しない

**検証対象: 要件2.1, 2.2, 2.3**

### プロパティ4: 和音からの音高削除の不変条件

*任意の* 2要素以上の keys を持つ NoteEvent から音高を削除した場合、keys の長さが1減り、削除した音高が含まれない。1要素の場合は削除しても keys は変化しない

**検証対象: 要件2.4**

### プロパティ5: 和音の音高移動の一様性

*任意の* 複数音高を持つ NoteEvent に対して、moveChordKeys 関数はすべての音高を同じ方向・同じ量だけ移動させなければならない（ステップ移動・オクターブ移動・半音移動のいずれも）

**検証対象: 要件5.1, 5.2, 5.3**

### プロパティ6: 和音の同時再生スケジューリング

*任意の* 複数音高を持つ NoteEvent に対して、generatePlaybackSchedule は和音を構成するすべての音高を同一の time 値でスケジュールしなければならない

**検証対象: 要件4.2, 4.3**

### プロパティ7: パート独立性

*任意の* 複数パート構成（ピアノ大譜表・弦楽四重奏）において、あるパートへの和音追加・変更は他のパートのデータに影響を与えてはならない

**検証対象: 要件7.2, 7.3**

### プロパティ8: SavedScoreData のラウンドトリップ

*任意の* 有効な SavedScoreData（和音を含む複数パートを含む）に対して、saveScoreData → loadScoreData の結果は元のデータと等価でなければならない

**検証対象: 要件6.1, 6.2, 6.5, 7.5**

## エラーハンドリング

### エラー分類と対応

| エラー種別 | 発生箇所 | 対応方針 |
|---|---|---|
| 無効な音高文字列 | StaffCanvas / makeVFNote | 無効な音高をスキップし、残りの有効な音高のみで描画 |
| VexFlow 描画失敗 | makeVFNote | エラーをログに記録し、単音フォールバック描画を試みる |
| 和音再生エラー | NotePlayer.playChord | エラーをログに記録し、再生を安全に停止 |
| デシリアライズ失敗 | storage.ts | エラーをログに記録し、該当 NoteEvent を空の休符として扱う |
| 音声コンテキスト中断 | NotePlayer | attemptRecovery を呼び出し、ユーザーに通知 |

### フォールバック戦略

```typescript
// makeVFNote のエラーハンドリング
function makeVFNote(ev: NoteEvent, clef: ClefType): StaveNote {
  try {
    if (!ev.keys || ev.keys.length === 0) {
      // 空の keys → 全休符にフォールバック
      return new StaveNote({ clef, keys: [restKeyForClef(clef)], duration: toVFDur(ev.dur) + 'r' });
    }

    // 有効な音高のみをフィルタリング
    const validKeys = ev.keys.filter(k => /^[a-g][#b]?\/[0-9]+$/i.test(k));
    if (validKeys.length === 0) {
      console.warn('[makeVFNote] 有効な音高がありません。休符にフォールバックします。');
      return new StaveNote({ clef, keys: [restKeyForClef(clef)], duration: toVFDur(ev.dur) + 'r' });
    }

    const n = new StaveNote({ clef, keys: validKeys, duration: toVFDur(ev.dur) });
    // 臨時記号の付与...
    return n;
  } catch (error) {
    console.error('[makeVFNote] VexFlow 描画エラー:', error);
    // 単音フォールバック
    try {
      return new StaveNote({ clef, keys: [ev.keys[0] || restKeyForClef(clef)], duration: toVFDur(ev.dur) });
    } catch {
      return new StaveNote({ clef, keys: [restKeyForClef(clef)], duration: toVFDur(ev.dur) + 'r' });
    }
  }
}
```

## テスト戦略

### 二重テストアプローチ

**ユニットテスト**: 特定の例、エッジケース、エラー条件を検証  
**プロパティテスト**: すべての入力にわたる普遍的プロパティを検証  
両方のテストは相補的で包括的なカバレッジに必要です。

### プロパティベーステスト設定

- **ライブラリ**: fast-check（既存依存関係）
- **反復回数**: 最小100回
- **タグ形式**: `Feature: chord-input, Property {number}: {property_text}`
- 各正確性プロパティは単一のプロパティベーステストで実装

### テスト対象ファイル

| テストファイル | テスト対象 | テスト種別 |
|---|---|---|
| `src/utils/storage.test.ts` | NoteEvent マイグレーション、ラウンドトリップ | プロパティ、例 |
| `src/audio/NotePlayer.test.ts` | playChord、同時再生スケジューリング | プロパティ、例 |
| `src/audio/ScorePlayer.test.ts` | 和音スケジューリング | プロパティ |
| `src/components/StaffCanvas.test.tsx` | 和音入力・削除・移動ロジック | プロパティ、例 |
| `src/components/PianoSystemCanvas.test.tsx` | パート独立性 | プロパティ |

### プロパティテスト実装例

```typescript
// プロパティ1: NoteEvent シリアライズのラウンドトリップ
// Feature: chord-input, Property 1: 任意の有効な NoteEvent に対して、JSON シリアライズ→デシリアライズが恒等変換である
it('Property 1: NoteEvent シリアライズのラウンドトリップ', () => {
  fc.assert(
    fc.property(
      fc.record({
        dur: fc.constantFrom('1', '2', '4', '8', '16', '32', '64'),
        isRest: fc.boolean(),
        keys: fc.array(
          fc.tuple(
            fc.constantFrom('c', 'd', 'e', 'f', 'g', 'a', 'b'),
            fc.constantFrom('', '#', 'b'),
            fc.integer({ min: 2, max: 6 })
          ).map(([note, acc, oct]) => `${note}${acc}/${oct}`),
          { minLength: 1, maxLength: 4 }
        ),
      }),
      (noteEvent) => {
        const serialized = JSON.stringify(noteEvent);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(noteEvent);
      }
    ),
    { numRuns: 100 }
  );
});

// プロパティ3: 和音への音高追加の不変条件
// Feature: chord-input, Property 3: 任意の NoteEvent と音高に対して、addKeyToChord の不変条件が成立する
it('Property 3: 和音への音高追加の不変条件', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.tuple(
          fc.constantFrom('c', 'd', 'e', 'f', 'g', 'a', 'b'),
          fc.integer({ min: 2, max: 6 })
        ).map(([note, oct]) => `${note}/${oct}`),
        { minLength: 1, maxLength: 7 }
      ),
      fc.tuple(
        fc.constantFrom('c', 'd', 'e', 'f', 'g', 'a', 'b'),
        fc.integer({ min: 2, max: 6 })
      ).map(([note, oct]) => `${note}/${oct}`),
      (existingKeys, newKey) => {
        const event: NoteEvent = { dur: '4', isRest: false, keys: existingKeys };
        const result = addKeyToChord(event, newKey);

        if (existingKeys.includes(newKey)) {
          // 重複: 変化なし
          expect(result.keys).toEqual(existingKeys);
        } else if (existingKeys.length >= 8) {
          // 上限: 変化なし
          expect(result.keys).toEqual(existingKeys);
        } else {
          // 追加: 長さが1増える
          expect(result.keys.length).toBe(existingKeys.length + 1);
          expect(result.keys).toContain(newKey);
        }
      }
    ),
    { numRuns: 100 }
  );
});

// プロパティ8: SavedScoreData のラウンドトリップ
// Feature: chord-input, Property 8: 任意の有効な SavedScoreData に対して、保存→読み込みが恒等変換である
it('Property 8: SavedScoreData のラウンドトリップ', () => {
  fc.assert(
    fc.property(
      arbitrarySavedScoreData(), // 和音を含む任意の SavedScoreData を生成するアービトラリ
      (scoreData) => {
        // localStorage をモック
        const storage: Record<string, string> = {};
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { storage[k] = v; });
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(k => storage[k] ?? null);

        saveScoreData(scoreData);
        const result = loadScoreData();

        expect(result.success).toBe(true);
        expect(result.data).toEqual(scoreData);
      }
    ),
    { numRuns: 100 }
  );
});
```

### ユニットテストの焦点

- 空の `keys` 配列に対するフォールバック動作
- 無効な音高文字列のフィルタリング
- 旧形式データ（`key: string`）のマイグレーション
- 和音再生中の停止操作
- VexFlow 描画エラー時のフォールバック
- 音声コンテキスト中断時の復旧試行
