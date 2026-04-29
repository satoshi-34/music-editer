import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import StaffCanvas from './StaffCanvas';
import type { Tool } from './Palette';

// テスト用のツール設定
const mockTool: Tool = {
  duration: '4',
  isRest: true,
};

// MeasureDataの型定義
type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; keys: string[] };
type MeasureData = { events: NoteEvent[] };

describe('休符重なり修正の統合テスト', () => {
  beforeEach(() => {
    // コンソール警告をモック（Vexflowの警告を抑制）
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('複数休符の配置テスト', () => {
    it('複数の休符が含まれる楽譜が正常に描画される', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: true, keys: ['b/4'] },
            { dur: '4', isRest: true, keys: ['b/4'] },
            { dur: '4', isRest: true, keys: ['b/4'] },
            { dur: '4', isRest: true, keys: ['b/4'] },
          ]
        }
      ];

      // コンポーネントが正常にレンダリングされることを確認
      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });

    it('音符と休符の混在楽譜が正常に描画される', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'] }, // 音符
            { dur: '4', isRest: true, keys: ['b/4'] },  // 休符
            { dur: '4', isRest: false, keys: ['d/4'] }, // 音符
            { dur: '4', isRest: true, keys: ['b/4'] },  // 休符
          ]
        }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });

    it('異なる長さの休符が混在する楽譜が正常に描画される', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: '2', isRest: true, keys: ['b/4'] },  // 2分休符
            { dur: '4', isRest: true, keys: ['b/4'] },  // 4分休符
            { dur: '4', isRest: true, keys: ['b/4'] },  // 4分休符
          ]
        }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });
  });

  describe('複数小節のテスト', () => {
    it('複数小節にわたる休符配置が正常に動作する', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: true, keys: ['b/4'] },
            { dur: '4', isRest: true, keys: ['b/4'] },
          ]
        },
        {
          events: [
            { dur: '2', isRest: true, keys: ['b/4'] },
            { dur: '2', isRest: true, keys: ['b/4'] },
          ]
        }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={2}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });
  });

  describe('既存機能への影響確認', () => {
    it('音符のみの楽譜が正常に描画される（回帰テスト）', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: false, keys: ['c/4'] },
            { dur: '4', isRest: false, keys: ['d/4'] },
            { dur: '4', isRest: false, keys: ['e/4'] },
            { dur: '4', isRest: false, keys: ['f/4'] },
          ]
        }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });

    it('空の小節が正常に描画される（回帰テスト）', () => {
      const scoreData: MeasureData[] = [
        { events: [] }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });

    it('複数システム（行）の描画が正常に動作する', () => {
      const scoreData: MeasureData[] = [
        { events: [{ dur: '4', isRest: true, keys: ['b/4'] }] },
        { events: [{ dur: '4', isRest: true, keys: ['b/4'] }] },
        { events: [{ dur: '4', isRest: true, keys: ['b/4'] }] },
        { events: [{ dur: '4', isRest: true, keys: ['b/4'] }] },
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={2}
            measuresPerSystem={2}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });
  });

  describe('エラー条件のテスト', () => {
    it('無効なdurationを含む楽譜でもクラッシュしない', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: 'invalid' as DurKey, isRest: true, keys: ['b/4'] },
            { dur: '4', isRest: true, keys: ['b/4'] },
          ]
        }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });

    it('不正なkeyを含む楽譜でもクラッシュしない', () => {
      const scoreData: MeasureData[] = [
        {
          events: [
            { dur: '4', isRest: true, keys: ['invalid'] },
            { dur: '4', isRest: true, keys: ['b/4'] },
          ]
        }
      ];

      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={1}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();
    });
  });

  describe('パフォーマンステスト', () => {
    it('大量の休符を含む楽譜でも合理的な時間で描画される', () => {
      // 20個の休符を含む楽譜
      const events: NoteEvent[] = Array.from({ length: 20 }, () => ({
        dur: '16' as DurKey,
        isRest: true,
        key: 'b/4'
      }));

      const scoreData: MeasureData[] = [
        { events: events.slice(0, 16) }, // 1小節目（16個の16分休符）
        { events: events.slice(16) },    // 2小節目（残り）
      ];

      const startTime = performance.now();
      
      expect(() => {
        render(
          <StaffCanvas
            systems={1}
            measuresPerSystem={2}
            tool={mockTool}
            initialScoreData={scoreData}
          />
        );
      }).not.toThrow();

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // 1秒以内で描画が完了することを確認
      expect(renderTime).toBeLessThan(1000);
    });
  });
});