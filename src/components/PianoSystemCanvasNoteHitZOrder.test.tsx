// src/components/PianoSystemCanvasNoteHitZOrder.test.tsx
// 音符の当たり判定（.vf-note-hit）が小節背景（.vf-hit）より前面（=DOM順で後）に
// あることのリグレッションテスト。
//
// 実機テスト（2026-08-12）で、多段譜の上段・声部2の深い符頭（段間にはみ出す低音）を
// クリックすると下段（左手）へ帰属してしまう不具合が発覚した。原因は描画順:
// 小節背景は段間クリック帰属（Issue #219）のため隣段側の帯まで覆っており、
// 「後に描いたパートが上」のままだと下段の背景が上段の音符の当たり判定を覆い隠す。
// 修正は全パート描画後に .vf-note-hit を前面（svgRoot の末尾）へ移すこと。
//
// jsdom はピクセル単位のヒットテストを持たないため、ここでは
// 「すべての .vf-note-hit が、すべての .vf-hit より DOM 順で後ろにある」
// （SVG は後勝ちなので = 前面にある）ことを機械的に固定する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

const TEST_CONTAINER_WIDTH = 700;

describe('PianoSystemCanvas 当たり判定のZ順（DOM順）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('大譜表で、すべての音符ヒット領域が小節背景より DOM 順で後ろ（=前面）にある', () => {
    // 上段（ト音）に段間へはみ出す低音を含むデータ。下段（ヘ音）は普通の音符。
    const trebleData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['e/3'] }, // 五線のはるか下＝段間へはみ出す
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const bassData: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['d/3'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: trebleData, onChange: vi.fn() },
          { clef: 'bass', data: bassData, onChange: vi.fn() },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const noteHits = Array.from(container.querySelectorAll('.vf-note-hit'));
    const backgrounds = Array.from(container.querySelectorAll('.vf-hit'));
    expect(noteHits.length).toBeGreaterThan(0);
    expect(backgrounds.length).toBeGreaterThan(0);

    // SVG に z-index は無く「後に書いた要素が前面」なので、
    // 全 note-hit が全背景の後ろ（DOCUMENT_POSITION_FOLLOWING）にあれば前面が保証される。
    for (const bg of backgrounds) {
      for (const nh of noteHits) {
        const pos = bg.compareDocumentPosition(nh);
        expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
  });
});
