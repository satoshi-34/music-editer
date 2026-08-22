// #244 段5-5: 声部3・4 を含む小節の描画テスト（§2-5 完了条件の「描画は壊れず全声部が出る」水準）。
// nVoiceSupport.test.ts はユーティリティ・出力のテストなので、VexFlow 描画が例外なく完了し、
// 声部3・4 の音符も DOM へ出ることはこちらで固定する（浄書品質の最適化は将来課題）。
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, NoteEvent } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn()
    };
  })
}));

const note = (key: string, dur: NoteEvent['dur'] = '4'): NoteEvent => ({ dur, isRest: false, keys: [key] });

function fourVoiceMeasure(): MeasureData {
  const primary = [note('c/5'), note('d/5'), note('e/5'), note('f/5')];
  return {
    events: primary,
    voices: [
      { id: 'voice-1', events: primary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
      { id: 'voice-2', events: [note('a/4'), note('b/4'), note('c/5'), note('d/5')], stemDirection: 'down' },
      { id: 'voice-3', events: [note('e/4'), note('f/4'), note('g/4'), note('a/4')] },
      { id: 'voice-4', events: [note('c/4', '2'), note('d/4', '2')] },
    ],
  };
}

describe('PianoSystemCanvas 声部3・4 の描画（#244 段5-5）', () => {
  it('4声の小節が例外なく描画され、全声部の符頭が DOM に出る', () => {
    const data: MeasureData[] = [fourVoiceMeasure()];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    // 符頭の数 = 4 + 4 + 4 + 2 = 14（全声部が描かれている）
    const noteheads = svg.querySelectorAll('.vf-notehead');
    expect(noteheads.length).toBe(14);
  });

  it('声部3のデータがあっても2声の小節と同じく編集用ヒット領域が生成される（クラッシュしない）', () => {
    const data: MeasureData[] = [fourVoiceMeasure()];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={0}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    // アクティブ声部（声部1）の4イベントぶんの編集ヒット領域が存在する
    expect(svg.querySelectorAll('.vf-note-hit').length).toBeGreaterThanOrEqual(4);
  });
});
