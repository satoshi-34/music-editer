import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import SingleStaff from './SingleStaff';
import type { MeasureData } from '../types/storage';

// 音声まわりは jsdom に AudioContext が無いためモックする
// （PianoSystemCanvasNotePlayback.test.tsx と同じ構成）。
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

// jsdom では getBoundingClientRect() が幅0を返すため、クリック座標は常に
// SVG ローカル座標 (0,0) へ変換される。snapLine(stave, 0) は最上端の
// ライン -4 に丸められ、その音高は treble で g/6 になる。
// そこで音符を g/6 にしておくと「符頭の個別選択」パスへ確実に入り、
// クリック→選択→矢印キー編集の一連の流れを jsdom で決定的に再現できる。
const CLICKED_KEY = 'g/6';

const makeData = (): MeasureData[] => ([
  { events: [{ dur: '4', isRest: false, keys: [CLICKED_KEY] }] },
  { events: [{ dur: '4', isRest: false, keys: [CLICKED_KEY] }] },
]);

// 各段（システム）の SVG から音符クリック用ヒット領域を取り、クリックで選択する
const clickNoteInSystem = (container: HTMLElement, systemIndex: number) => {
  const svgs = container.querySelectorAll('.system-stack svg');
  const hit = svgs[systemIndex]?.querySelector('rect.vf-note-hit');
  expect(hit, `段${systemIndex + 1} の音符ヒット領域`).toBeTruthy();
  fireEvent.click(hit!);
};

describe('SingleStaff 複数段での矢印キー音高編集', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // VexFlow の警告でログが埋まるのを防ぐ
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('別の段で選択した後でも、最後に選択した音符が ArrowUp で変化する', async () => {
    // 不具合の再現条件: 段1・段2それぞれの PianoSystemCanvas が独自の選択状態と
    // window keydown リスナーを持つため、段2の選択が残ったまま段1で矢印キーを
    // 押すと、両方のインスタンスが「楽譜全体のコピー」を onChange で送り、
    // 後から通知した段2のコピー（段1の変更を含まない）が勝ってしまっていた。
    const onChange = vi.fn();
    const { container } = render(
      <SingleStaff
        tool={{ duration: '4', isRest: false }}
        data={makeData()}
        onChange={onChange}
        systemRanges={[
          { start: 0, count: 1, minimumWidths: [200] },
          { start: 1, count: 1, minimumWidths: [200] },
        ]}
      />
    );

    // 段2の音符を選択 → その後、段1の音符を選択（ユーザーが段を移って編集する操作）
    clickNoteInSystem(container, 1);
    clickNoteInSystem(container, 0);

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const finalData = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MeasureData[];
      // 段1（小節0）の音符は g/6 から1つ上（a/6）へ動いていること
      expect(finalData[0].events[0].keys).toEqual(['a/6']);
      // 段2（小節1）の音符は選択解除済みなので動かないこと
      expect(finalData[1].events[0].keys).toEqual([CLICKED_KEY]);
    });
  });

  it('段をまたいで選択しても、選択マーカーは常に1つだけ表示される', async () => {
    const { container } = render(
      <SingleStaff
        tool={{ duration: '4', isRest: false }}
        data={makeData()}
        systemRanges={[
          { start: 0, count: 1, minimumWidths: [200] },
          { start: 1, count: 1, minimumWidths: [200] },
        ]}
      />
    );

    clickNoteInSystem(container, 1);
    await waitFor(() => {
      expect(container.querySelectorAll('.vf-note-selected')).toHaveLength(1);
    });

    clickNoteInSystem(container, 0);
    await waitFor(() => {
      // 段2側の選択が解除され、段1側の1つだけになる
      expect(container.querySelectorAll('.vf-note-selected')).toHaveLength(1);
      const marker = container.querySelector('.vf-note-selected');
      const svgs = container.querySelectorAll('.system-stack svg');
      expect(svgs[0]!.contains(marker!)).toBe(true);
    });
  });
});
