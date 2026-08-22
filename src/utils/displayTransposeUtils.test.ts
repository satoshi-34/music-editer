import { describe, expect, it, vi } from 'vitest';
import type { MeasureData } from '../types/storage';
import { createDisplayTransposeBridge, transposeMeasuresForDisplay } from './displayTransposeUtils';
import { keyToMidi } from './noteMidiUtils';
import { TRANSPOSITION_WRITTEN_OFFSET_SEMITONES } from './noteKeyUtils';

describe('transposeMeasuresForDisplay', () => {
  it('アークの両端も音符と同じ表示音へ移調し、元データは変更しない', () => {
    const measures: MeasureData[] = [{
      events: [{
        dur: '4',
        isRest: false,
        keys: ['c/4'],
        arcs: [{ kind: 'slur', fromKey: 'c/4', toKey: 'e/4', toMeasureIndex: 1, toEventIndex: 0 }],
      }],
    }];

    const displayed = transposeMeasuresForDisplay(measures, 2);

    expect(displayed[0].events[0].keys).toEqual(['d/4']);
    expect(displayed[0].events[0].arcs?.[0]).toMatchObject({ fromKey: 'd/4', toKey: 'f#/4' });
    expect(measures[0].events[0].keys).toEqual(['c/4']);
    expect(measures[0].events[0].arcs?.[0]).toMatchObject({ fromKey: 'c/4', toKey: 'e/4' });
  });
});

// Issue #111: パート譜からの編集でも「保存データの正本は常に実音」を保つための往復テスト。
// 移調のずれは画面上は正しく見えたまま再生・印刷まで気づけないため、機械的に固定する。
describe('createDisplayTransposeBridge（記譜音表示の往復）', () => {
  const quarter = (key: string): MeasureData[] => ([{ events: [{ dur: '4', isRest: false, keys: [key] }] }]);

  it('B♭管: 実音は記譜音で長2度上に見え、記譜音で入力した音は実音へ戻して保存される', () => {
    const bbSemitones = TRANSPOSITION_WRITTEN_OFFSET_SEMITONES.Bb;
    const onChange = vi.fn();
    // 保存されている実音は B♭3（= 記譜音の「ド」）
    const { displayMeasures, handleDisplayChange } = createDisplayTransposeBridge(
      quarter('bb/3'),
      onChange,
      bbSemitones,
    );

    // 表示は記譜音 C4（ド）になる
    expect(keyToMidi(displayMeasures[0].events[0].keys[0])).toBe(keyToMidi('c/4'));

    // その画面上で記譜音の「ド（C4）」を入力すると、保存される実音は B♭3 になる
    handleDisplayChange(quarter('c/4'));
    const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
    // 異名同音（a#/3 と bb/3）で綴りが変わりうるので、音高そのもの（MIDI番号）で比較する
    expect(keyToMidi(saved[0].events[0].keys[0])).toBe(keyToMidi('bb/3'));
  });

  it('実音モード（semitones=0）では表示も保存も素通しで、配列や関数を作り直さない', () => {
    const measures = quarter('c/4');
    const onChange = vi.fn();
    const { displayMeasures, handleDisplayChange } = createDisplayTransposeBridge(measures, onChange, 0);

    // 参照がそのままであること（無駄な再描画を増やさないための挙動）
    expect(displayMeasures).toBe(measures);
    expect(handleDisplayChange).toBe(onChange);

    handleDisplayChange(quarter('e/4'));
    const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(keyToMidi(saved[0].events[0].keys[0])).toBe(keyToMidi('e/4'));
  });

  it('E♭管・F管でも、表示 → 入力 → 保存の往復で元の実音に戻る', () => {
    for (const transposition of ['Eb', 'F'] as const) {
      const semitones = TRANSPOSITION_WRITTEN_OFFSET_SEMITONES[transposition];
      const onChange = vi.fn();
      const { displayMeasures, handleDisplayChange } = createDisplayTransposeBridge(
        quarter('c/4'),
        onChange,
        semitones,
      );
      // 画面に出ている記譜音をそのまま入力し直した場合、保存値は元の実音に戻る
      handleDisplayChange(displayMeasures);
      const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
      expect(keyToMidi(saved[0].events[0].keys[0])).toBe(keyToMidi('c/4'));
    }
  });


  it('voices（声部2と voices[0] の鏡）も events と同じく往復変換される（#244 段5-1・Codex P1）', () => {
    const semitones = 2; // B♭管相当
    const measures: MeasureData[] = [{
      events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
      voices: [
        { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
        { id: 'voice-2', events: [{ dur: '4', isRest: false, keys: ['e/3'] }], stemDirection: 'down' },
      ],
    }];
    const displayed = transposeMeasuresForDisplay(measures, semitones);
    // 表示: 全声部が記譜音（+2半音）になる
    expect(keyToMidi(displayed[0].voices![0].events[0].keys[0])).toBe(keyToMidi('c/4') + semitones);
    expect(keyToMidi(displayed[0].voices![1].events[0].keys[0])).toBe(keyToMidi('e/3') + semitones);
    // 保存: 逆変換で全声部が実音へ戻る（events だけ戻して voices に記譜音が残らない）
    const roundTripped = transposeMeasuresForDisplay(displayed, -semitones);
    expect(keyToMidi(roundTripped[0].events[0].keys[0])).toBe(keyToMidi('c/4'));
    expect(keyToMidi(roundTripped[0].voices![0].events[0].keys[0])).toBe(keyToMidi('c/4'));
    expect(keyToMidi(roundTripped[0].voices![1].events[0].keys[0])).toBe(keyToMidi('e/3'));
  });

  it('voices を持たない小節では voices キーを勝手に作らない', () => {
    const measures: MeasureData[] = [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }];
    const displayed = transposeMeasuresForDisplay(measures, 2);
    expect(displayed[0].voices).toBeUndefined();
  });
});
