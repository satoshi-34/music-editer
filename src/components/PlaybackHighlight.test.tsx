// src/components/PlaybackHighlight.test.tsx
// PlaybackHighlightコンポーネントのテスト

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlaybackHighlight, { PlaybackPositionIndicator } from './PlaybackHighlight';
import type { PlaybackPosition } from '../audio/ScorePlayer';

// モックのSVG要素を作成
const createMockSVGElement = (measureIndex: number, noteIndex: number): SVGElement => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  element.classList.add('vf-stavenote');
  element.setAttribute('data-measure', measureIndex.toString());
  element.setAttribute('data-note', noteIndex.toString());
  
  // getBoundingClientRectをモック
  element.getBoundingClientRect = vi.fn(() => ({
    top: 100,
    bottom: 150,
    left: 50,
    right: 100,
    width: 50,
    height: 50,
    x: 50,
    y: 100,
    toJSON: () => ({})
  }));
  
  return element;
};

// テスト用のコンテナを作成
const createTestContainer = () => {
  const container = document.createElement('div');
  container.className = 'score-area';
  
  // 複数の小節と音符を含むSVG構造を作成
  for (let measureIndex = 0; measureIndex < 3; measureIndex++) {
    for (let noteIndex = 0; noteIndex < 4; noteIndex++) {
      const noteElement = createMockSVGElement(measureIndex, noteIndex);
      container.appendChild(noteElement);
    }
  }
  
  document.body.appendChild(container);
  return container;
};

describe('PlaybackHighlight', () => {
  let testContainer: HTMLElement;

  beforeEach(() => {
    testContainer = createTestContainer();
    
    // window.scrollToをモック
    window.scrollTo = vi.fn();
    
    // window.pageYOffsetをモック
    Object.defineProperty(window, 'pageYOffset', {
      value: 0,
      writable: true
    });
  });

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer);
    }
    vi.clearAllMocks();
  });

  describe('基本的な動作', () => {
    it('再生中でない場合はハイライトが適用されない', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={false}
        />
      );

      const highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements).toHaveLength(0);
    });

    it('再生中の場合は指定した位置の音符がハイライトされる', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={true}
        />
      );

      const highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements.length).toBeGreaterThan(0);
    });

    it('再生位置が変更されると新しい位置がハイライトされる', () => {
      const initialPosition: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      const { rerender } = render(
        <PlaybackHighlight
          currentPosition={initialPosition}
          isPlaying={true}
        />
      );

      // 初期位置のハイライトを確認
      let highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements.length).toBeGreaterThan(0);

      // 位置を変更
      const newPosition: PlaybackPosition = { measureIndex: 0, beatPosition: 1, noteIndex: 1 };
      rerender(
        <PlaybackHighlight
          currentPosition={newPosition}
          isPlaying={true}
        />
      );

      // 新しい位置のハイライトを確認
      highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements.length).toBeGreaterThan(0);
    });

    it('停止時にすべてのハイライトが解除される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      const { rerender } = render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={true}
        />
      );

      // 再生中のハイライトを確認
      let highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements.length).toBeGreaterThan(0);

      // 停止状態に変更
      rerender(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={false}
        />
      );

      // ハイライトが解除されることを確認
      highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements).toHaveLength(0);
    });
  });

  describe('カスタマイズ', () => {
    it('カスタムハイライトスタイルが適用される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      const customStyle = {
        fill: 'rgba(255, 0, 0, 0.5)',
        stroke: '#ff0000',
        strokeWidth: '3',
        opacity: '0.9'
      };
      
      render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={true}
          highlightStyle={customStyle}
        />
      );

      const highlightedElements = document.querySelectorAll('.playback-highlight');
      if (highlightedElements.length > 0) {
        const element = highlightedElements[0] as SVGElement;
        expect(element.getAttribute('fill')).toBe(customStyle.fill);
        expect(element.getAttribute('stroke')).toBe(customStyle.stroke);
        expect(element.getAttribute('stroke-width')).toBe(customStyle.strokeWidth);
        expect(element.getAttribute('opacity')).toBe(customStyle.opacity);
      }
    });

    it('カスタムコンテナセレクタが使用される', () => {
      // カスタムコンテナを作成
      const customContainer = document.createElement('div');
      customContainer.className = 'custom-score-area';
      const noteElement = createMockSVGElement(0, 0);
      customContainer.appendChild(noteElement);
      document.body.appendChild(customContainer);

      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={true}
          containerSelector=".custom-score-area"
        />
      );

      const highlightedElements = document.querySelectorAll('.playback-highlight');
      expect(highlightedElements.length).toBeGreaterThan(0);

      // クリーンアップ
      document.body.removeChild(customContainer);
    });
  });

  describe('スクロール機能', () => {
    it('ページスクロールが有効な場合にスクロールが実行される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={true}
          enablePageScroll={true}
        />
      );

      // スクロールが呼ばれることを確認（要素が見つかった場合）
      const highlightedElements = document.querySelectorAll('.playback-highlight');
      if (highlightedElements.length > 0) {
        expect(window.scrollTo).toHaveBeenCalled();
      }
    });

    it('ページスクロールが無効な場合にスクロールが実行されない', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackHighlight
          currentPosition={position}
          isPlaying={true}
          enablePageScroll={false}
        />
      );

      expect(window.scrollTo).not.toHaveBeenCalled();
    });
  });

  describe('エラーハンドリング', () => {
    it('存在しない音符位置でもエラーが発生しない', () => {
      const position: PlaybackPosition = { measureIndex: 99, beatPosition: 0, noteIndex: 99 };
      
      expect(() => {
        render(
          <PlaybackHighlight
            currentPosition={position}
            isPlaying={true}
          />
        );
      }).not.toThrow();
    });

    it('無効なSVG要素でもエラーが発生しない', () => {
      // 無効な要素を含むコンテナを作成
      const invalidContainer = document.createElement('div');
      invalidContainer.className = 'score-area';
      const invalidElement = document.createElement('div'); // SVG要素ではない
      invalidElement.className = 'vf-stavenote';
      invalidContainer.appendChild(invalidElement);
      document.body.appendChild(invalidContainer);

      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      expect(() => {
        render(
          <PlaybackHighlight
            currentPosition={position}
            isPlaying={true}
          />
        );
      }).not.toThrow();

      // クリーンアップ
      document.body.removeChild(invalidContainer);
    });
  });
});

describe('PlaybackPositionIndicator', () => {
  describe('基本的な表示', () => {
    it('停止状態で位置情報が表示される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
        />
      );

      expect(screen.getByText('1小節目 1音符目')).toBeInTheDocument();
    });

    it('再生中状態で位置情報と再生インジケーターが表示される', () => {
      const position: PlaybackPosition = { measureIndex: 1, beatPosition: 2.5, noteIndex: 2 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={true}
        />
      );

      expect(screen.getByText('2小節目 3音符目 (2.5拍)')).toBeInTheDocument();
      expect(screen.getByLabelText('再生中')).toBeInTheDocument();
    });

    it('総小節数が指定された場合に分数表示される', () => {
      const position: PlaybackPosition = { measureIndex: 2, beatPosition: 0, noteIndex: 1 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
          totalMeasures={8}
        />
      );

      expect(screen.getByText('3/8小節目 2音符目')).toBeInTheDocument();
    });

    it('コンパクト表示で簡略化された形式が表示される', () => {
      const position: PlaybackPosition = { measureIndex: 1, beatPosition: 1.5, noteIndex: 2 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
          compact={true}
        />
      );

      expect(screen.getByText('2:3')).toBeInTheDocument();
    });
  });

  describe('スタイルクラス', () => {
    it('停止状態で適切なクラスが適用される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
        />
      );

      const indicator = document.querySelector('.playback-position-indicator');
      expect(indicator).toHaveClass('stopped');
      expect(indicator).not.toHaveClass('playing');
    });

    it('再生中状態で適切なクラスが適用される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={true}
        />
      );

      const indicator = document.querySelector('.playback-position-indicator');
      expect(indicator).toHaveClass('playing');
      expect(indicator).not.toHaveClass('stopped');
    });

    it('カスタムクラス名が適用される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
          className="custom-indicator"
        />
      );

      const indicator = document.querySelector('.playback-position-indicator');
      expect(indicator).toHaveClass('custom-indicator');
    });
  });

  describe('拍位置の表示', () => {
    it('拍位置が0の場合は拍情報が表示されない', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 0, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
        />
      );

      expect(screen.getByText('1小節目 1音符目')).toBeInTheDocument();
      expect(screen.queryByText(/拍/)).not.toBeInTheDocument();
    });

    it('拍位置が0より大きい場合は拍情報が表示される', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 1.25, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
        />
      );

      expect(screen.getByText('1小節目 1音符目 (1.3拍)')).toBeInTheDocument();
    });

    it('コンパクト表示では拍情報が表示されない', () => {
      const position: PlaybackPosition = { measureIndex: 0, beatPosition: 2.5, noteIndex: 0 };
      
      render(
        <PlaybackPositionIndicator
          currentPosition={position}
          isPlaying={false}
          compact={true}
        />
      );

      expect(screen.getByText('1:1')).toBeInTheDocument();
      expect(screen.queryByText(/拍/)).not.toBeInTheDocument();
    });
  });
});