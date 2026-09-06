// src/components/PianoSystemCanvasPickup.test.tsx
// アウフタクト（弱起）の描画テスト（Issue #473 段2）。
// 設計メモ .claude/specs/anacrusis-pickup-measure/design.md §4「段2」の受入テストに対応する。
// ここで固定したいのは:
//   1. 弱起があるとき、小節番号が慣例どおり1つずつ繰り下がる（弱起＝0小節目）
//   2. 弱起の小節に「表示用の補完休符」が足されない（弱起に見えなくなるため）
//   3. 弱起なしのときの描画は従来どおり（退行なし）
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

// 音声系はこのテストの対象外なので、描画だけ通るように丸ごとモックする。
vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function () {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function () {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 弱起の小節（4分音符1つ）。弱起であることは小節データ自身が持つ（案B） */
const PICKUP: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['g/4'] }], pickupBeats: 1 };
/** 中身は同じだが弱起の指定が無い小節（＝拍が足りないだけの完全小節） */
const SHORT: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['g/4'] }] };
/** 4分音符4つの完全小節 */
const FULL: MeasureData = {
  events: [
    { dur: '4', isRest: false, keys: ['c/5'] },
    { dur: '4', isRest: false, keys: ['d/5'] },
    { dur: '4', isRest: false, keys: ['e/5'] },
    { dur: '4', isRest: false, keys: ['f/5'] },
  ],
};

function renderSystem(options: { startMeasureIndex: number; data: MeasureData[]; onChange?: (next: MeasureData[]) => void }) {
  return render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      startMeasureIndex={options.startMeasureIndex}
      tool={{ duration: '4', isRest: false }}
      scale={1}
      timeSignature={[4, 4]}
      partsConfig={[{ clef: 'treble', data: options.data, onChange: options.onChange ?? (() => {}) }]}
    />
  );
}

const textsOf = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '');

describe('PianoSystemCanvas の弱起（アウフタクト・Issue #473）', () => {
  it('弱起があるとき、段の先頭小節の番号が1つ繰り下がる（3小節目 → 「2」）', () => {
    const { container } = renderSystem({
      startMeasureIndex: 2,
      data: [PICKUP, FULL, FULL],
    });
    expect(textsOf(container)).toContain('2');
    expect(textsOf(container)).not.toContain('3');
  });

  it('弱起が無いときは従来どおりの通し番号（3小節目 → 「3」）', () => {
    const { container } = renderSystem({
      startMeasureIndex: 2,
      data: [FULL, FULL, FULL],
    });
    expect(textsOf(container)).toContain('3');
  });

  it('弱起の小節には表示用の補完休符を足さない（音符1つだけ描く）', () => {
    const { container } = renderSystem({ startMeasureIndex: 0, data: [PICKUP, FULL] });
    expect(container.querySelectorAll('.vf-stavenote').length).toBe(1);
  });

  it('弱起の指定が無ければ、同じ中身の小節は従来どおり残りの拍を休符で埋めて描く', () => {
    const { container } = renderSystem({ startMeasureIndex: 0, data: [SHORT, FULL] });
    expect(container.querySelectorAll('.vf-stavenote').length).toBeGreaterThan(1);
  });

  it('弱起の小節には容量を超える音符が入らない（入力上限が効く）', () => {
    // 1拍の弱起に4分音符1つが入っている＝もう満杯。小節の背景を押しても増えない
    const onChange = vi.fn();
    const { container } = renderSystem({ startMeasureIndex: 0, data: [PICKUP, FULL], onChange });
    const background = container.querySelector('rect.vf-hit') as SVGRectElement;
    expect(background).toBeTruthy();
    fireEvent.click(background, { clientX: 10, clientY: 10 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('弱起の指定が無ければ、同じ中身の小節にはまだ音符が入る（上限の比較対象）', () => {
    const onChange = vi.fn();
    const { container } = renderSystem({ startMeasureIndex: 0, data: [SHORT, FULL], onChange });
    const background = container.querySelector('rect.vf-hit') as SVGRectElement;
    fireEvent.click(background, { clientX: 10, clientY: 10 });
    expect(onChange).toHaveBeenCalled();
  });

  it('弱起の次の小節は従来どおり拍子ぶんで扱う（補完休符が出る）', () => {
    const { container } = renderSystem({ startMeasureIndex: 1, data: [PICKUP, SHORT] });
    expect(container.querySelectorAll('.vf-stavenote').length).toBeGreaterThan(1);
  });
});
