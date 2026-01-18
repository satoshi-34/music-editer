// src/components/StaffCanvasNotePlayback.test.tsx
// StaffCanvasの音符クリック再生機能のテスト

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import StaffCanvas from './StaffCanvas';
import type { MeasureData, DurKey } from '../types/storage';

// NotePlayerのモック
vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(() => ({
    playNoteEvent: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn()
  }))
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

describe('StaffCanvas 音符クリック再生機能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('NotePlayerの統合', () => {
    it('should initialize NotePlayer on component mount', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
      
      // NotePlayerが初期化されることを確認
      const { NotePlayer } = require('../audio/NotePlayer');
      expect(NotePlayer).toHaveBeenCalledTimes(1);
    });

    it('should dispose NotePlayer on component unmount', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
      
      // コンポーネントをアンマウント
      unmount();
      
      // disposeが呼ばれることを確認
      const { NotePlayer } = require('../audio/NotePlayer');
      const mockInstance = NotePlayer.mock.results[0].value;
      expect(mockInstance.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('音符クリック再生の統合', () => {
    it('should render without errors with note playback functionality', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [
          { dur: '4', isRest: false, key: 'c/4' },
          { dur: '4', isRest: false, key: 'd/4' },
          { dur: '4', isRest: true, key: 'b/4' }
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
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
      const { defaultAudioEngine } = require('../audio/AudioEngine');
      defaultAudioEngine.initialize.mockRejectedValueOnce(new Error('AudioContext not available'));
      
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
      const { NotePlayer } = require('../audio/NotePlayer');
      NotePlayer.mockImplementationOnce(() => {
        throw new Error('NotePlayer creation failed');
      });
      
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
    it('should integrate note click playback functionality (要件1.1)', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
      
      // NotePlayerが初期化されていることを確認
      const { NotePlayer } = require('../audio/NotePlayer');
      expect(NotePlayer).toHaveBeenCalled();
    });

    it('should manage NotePlayer instance properly (要件1.5)', () => {
      const testTool = { duration: '4' as DurKey, isRest: false };
      const testMeasures: MeasureData[] = [
        { events: [{ dur: '4', isRest: false, key: 'c/4' }] }
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
      
      // NotePlayerインスタンスが作成されることを確認
      const { NotePlayer } = require('../audio/NotePlayer');
      expect(NotePlayer).toHaveBeenCalledTimes(1);
      
      // アンマウント時にリソースが解放されることを確認
      unmount();
      const mockInstance = NotePlayer.mock.results[0].value;
      expect(mockInstance.dispose).toHaveBeenCalledTimes(1);
    });
  });
});