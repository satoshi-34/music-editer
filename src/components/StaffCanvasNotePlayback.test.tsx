// src/components/StaffCanvasNotePlayback.test.tsx
// StaffCanvasの音符クリック再生機能のテスト

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import StaffCanvas from './StaffCanvas';
import type { MeasureData, DurKey } from '../types/storage';
import { NotePlayer } from '../audio/NotePlayer';
import { defaultAudioEngine } from '../audio/AudioEngine';

// NotePlayerのモック
vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

// AudioEngineのモック
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(false),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));

// SoundSourceのモック（loadInstrumentが成功するように）
vi.mock('../audio/SoundSource', () => ({
  // コンポーネントは既定値として InstrumentType.PIANO を参照する。
  // テストでは SoundSource 全体をモックするため、enum 相当の値も一緒に返す必要がある。
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

describe('StaffCanvas 音符クリック再生機能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('NotePlayerの統合', () => {
    it('should initialize NotePlayer on component mount', async () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];

      render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );

      // NotePlayerが初期化されることを確認（async useEffectを待つ）
      await waitFor(() => {
        expect(NotePlayer).toHaveBeenCalledTimes(1);
      });
    });

    it('should dispose NotePlayer on component unmount', async () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];

      const { unmount } = render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );

      // NotePlayerが初期化されるまで待つ
      await waitFor(() => {
        expect(NotePlayer).toHaveBeenCalledTimes(1);
      });

      // コンポーネントをアンマウント
      unmount();

      // disposeが呼ばれることを確認
      const mockInstance = (NotePlayer as any).mock.results[0].value;
      expect(mockInstance.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('音符クリック再生の統合', () => {
    it('should render without errors with note playback functionality', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: false, keys: ['d/4'] },
          { dur: '4', isRest: true, keys: ['b/4'] }
        ]}
      ];
      
      const { container } = render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );
      
      // SVGが正常にレンダリングされることを確認
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      
      // 音符のヒット領域が作成されることを確認
      const noteHitRects = svg?.querySelectorAll('rect.vf-note-hit');
      expect(noteHitRects?.length).toBeGreaterThan(0);
    });

    it('should maintain existing click functionality with playback integration', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];
      
      const { container } = render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );
      
      // SVGとヒット領域が存在することを確認
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      
      const noteHitRects = svg?.querySelectorAll('rect.vf-note-hit');
      expect(noteHitRects?.length).toBeGreaterThan(0);
      
      // クリックイベントリスナーが設定されていることを確認
      // （実際のクリックテストはjsdom環境では制限があるため、要素の存在のみ確認）
      const firstHitRect = noteHitRects?.[0];
      expect(firstHitRect).toBeTruthy();
      expect(firstHitRect?.getAttribute('class')).toBe('vf-note-hit');
    });
  });

  describe('エラーハンドリング', () => {
    it('should handle AudioEngine initialization failure gracefully', () => {
      // AudioEngineの初期化が失敗する場合をモック
      (defaultAudioEngine.initialize as any).mockRejectedValueOnce(new Error('AudioContext not available'));
      
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];
      
      // エラーが発生してもコンポーネントがレンダリングされることを確認
      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            gap={110}
            measuresPerSystem={1}
            tool={testTool}
            scale={1}
            initialScoreData={testMeasures}
          />
        );
      }).not.toThrow();
    });

    it('should handle NotePlayer creation failure gracefully', () => {
      // NotePlayerの作成が失敗する場合をモック
      (NotePlayer as any).mockImplementationOnce(() => {
        throw new Error('NotePlayer creation failed');
      });
      
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];
      
      // エラーが発生してもコンポーネントがレンダリングされることを確認
      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            gap={110}
            measuresPerSystem={1}
            tool={testTool}
            scale={1}
            initialScoreData={testMeasures}
          />
        );
      }).not.toThrow();
    });
  });

  describe('要件の検証', () => {
    it('should integrate note click playback functionality (要件1.1)', async () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];

      const { container } = render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );

      // 音符クリック処理に再生機能が統合されていることを確認
      // （実装により、音符のヒット領域にクリックイベントが設定されている）
      const svg = container.querySelector('svg');
      const noteHitRects = svg?.querySelectorAll('rect.vf-note-hit');
      expect(noteHitRects?.length).toBeGreaterThan(0);

      // NotePlayerが初期化されていることを確認（async useEffectを待つ）
      await waitFor(() => {
        expect(NotePlayer).toHaveBeenCalled();
      });
    });

    it('should manage NotePlayer instance properly (要件1.5)', async () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }
      ];

      const { unmount } = render(
        <StaffCanvas
          systems={1}
          gap={110}
          measuresPerSystem={1}
          tool={testTool}
          scale={1}
          initialScoreData={testMeasures}
        />
      );

      // NotePlayerはuseEffect内で非同期に初期化されるため waitFor で待つ
      await waitFor(() => {
        expect(NotePlayer).toHaveBeenCalledTimes(1);
      });

      // アンマウント時にリソースが解放されることを確認
      unmount();
      const mockInstance = (NotePlayer as any).mock.results[0].value;
      expect(mockInstance.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
