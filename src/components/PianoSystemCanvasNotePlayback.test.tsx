import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import { NotePlayer } from '../audio/NotePlayer';
import { defaultAudioEngine } from '../audio/AudioEngine';

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
  // コンポーネントは既定値として InstrumentType.PIANO を参照する。
  // SoundSource を丸ごとモックするテストでは、enum 相当の値も明示しておく。
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

describe('PianoSystemCanvas 音符クリック再生機能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('マウント時に NotePlayer を初期化する', async () => {
    render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        trebleData={[{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }]}
        bassData={[{ events: [{ dur: '4', isRest: false, keys: ['c/3'] }] }]}
      />
    );

    await waitFor(() => {
      expect(NotePlayer).toHaveBeenCalledTimes(1);
    });
  });

  it('AudioEngine 初期化失敗でも描画を継続する', () => {
    (defaultAudioEngine.initialize as any).mockRejectedValueOnce(new Error('AudioContext not available'));

    expect(() => {
      render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false }}
          scale={1}
          trebleData={[{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }]}
          bassData={[{ events: [{ dur: '4', isRest: false, keys: ['c/3'] }] }]}
        />
      );
    }).not.toThrow();
  });
});
