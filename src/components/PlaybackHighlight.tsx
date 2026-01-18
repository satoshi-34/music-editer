// src/components/PlaybackHighlight.tsx
// 再生位置表示コンポーネント
// 現在再生中の音符のハイライト表示、小節境界を越える際のハイライト更新、停止時のハイライト解除を提供

import { useEffect, useRef, useCallback } from 'react';
import type { PlaybackPosition } from '../audio/ScorePlayer';

/**
 * ハイライト要素の情報
 */
interface HighlightElement {
  /** ハイライト対象のSVG要素 */
  element: SVGElement;
  /** 小節インデックス */
  measureIndex: number;
  /** 音符インデックス */
  noteIndex: number;
  /** 元のスタイル（復元用） */
  originalStyle: {
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
  };
}

/**
 * PlaybackHighlightコンポーネントのプロパティ
 */
export interface PlaybackHighlightProps {
  /** 現在の再生位置 */
  currentPosition: PlaybackPosition;
  /** 再生状態 */
  isPlaying: boolean;
  /** ハイライト対象のコンテナ要素のセレクタ */
  containerSelector?: string;
  /** ハイライトスタイルのカスタマイズ */
  highlightStyle?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
  };
  /** ページスクロールを有効にするか */
  enablePageScroll?: boolean;
  /** スクロール時のオフセット */
  scrollOffset?: number;
}

/**
 * デフォルトのハイライトスタイル
 */
const DEFAULT_HIGHLIGHT_STYLE = {
  fill: 'rgba(0, 123, 255, 0.3)',
  stroke: '#007bff',
  strokeWidth: '2',
  opacity: '0.8'
};

/**
 * 再生位置表示コンポーネント
 * 要件7.1, 7.2, 7.4に対応：現在再生中の音符のハイライト表示
 */
export default function PlaybackHighlight({
  currentPosition,
  isPlaying,
  containerSelector = '.score-area',
  highlightStyle = DEFAULT_HIGHLIGHT_STYLE,
  enablePageScroll = true,
  scrollOffset = 100
}: PlaybackHighlightProps) {
  // 現在ハイライト中の要素を追跡
  const highlightedElementsRef = useRef<HighlightElement[]>([]);
  const lastPositionRef = useRef<PlaybackPosition | null>(null);

  /**
   * 指定した音符要素を検索する
   */
  const findNoteElement = useCallback((measureIndex: number, noteIndex: number): SVGElement | null => {
    const containers = document.querySelectorAll(containerSelector);
    
    for (const container of containers) {
      // 音符要素を検索（VexFlowの音符要素のセレクタ）
      const noteElements = container.querySelectorAll(
        `.vf-stavenote[data-measure="${measureIndex}"][data-note="${noteIndex}"], ` +
        `.vf-note[data-measure="${measureIndex}"][data-note="${noteIndex}"], ` +
        `g.vf-stavenote:nth-child(${noteIndex + 1})`
      );

      if (noteElements.length > 0) {
        return noteElements[0] as SVGElement;
      }

      // フォールバック：小節内のn番目の音符要素を検索
      const measureElements = container.querySelectorAll(
        `g[data-measure="${measureIndex}"] .vf-stavenote, ` +
        `g.vf-measure:nth-child(${measureIndex + 1}) .vf-stavenote`
      );

      if (measureElements.length > noteIndex) {
        return measureElements[noteIndex] as SVGElement;
      }
    }

    // 音符要素が見つからない場合は警告を出さない（譜面が空の場合は正常）
    return null;
  }, [containerSelector]);

  /**
   * 要素にハイライトを適用する
   */
  const applyHighlight = useCallback((element: SVGElement, measureIndex: number, noteIndex: number) => {
    // 元のスタイルを保存
    const originalStyle = {
      fill: element.getAttribute('fill') || '',
      stroke: element.getAttribute('stroke') || '',
      strokeWidth: element.getAttribute('stroke-width') || '',
      opacity: element.getAttribute('opacity') || ''
    };

    // ハイライトスタイルを適用
    if (highlightStyle.fill) {
      element.setAttribute('fill', highlightStyle.fill);
    }
    if (highlightStyle.stroke) {
      element.setAttribute('stroke', highlightStyle.stroke);
    }
    if (highlightStyle.strokeWidth) {
      element.setAttribute('stroke-width', highlightStyle.strokeWidth);
    }
    if (highlightStyle.opacity) {
      element.setAttribute('opacity', highlightStyle.opacity);
    }

    // ハイライト要素として記録
    const highlightElement: HighlightElement = {
      element,
      measureIndex,
      noteIndex,
      originalStyle
    };

    highlightedElementsRef.current.push(highlightElement);

    // アニメーション効果を追加
    element.style.transition = 'all 0.2s ease';
    element.classList.add('playback-highlight');

  }, [highlightStyle]);

  /**
   * 要素からハイライトを除去する
   */
  const removeHighlight = useCallback((highlightElement: HighlightElement) => {
    const { element, originalStyle } = highlightElement;

    // 元のスタイルを復元
    if (originalStyle.fill !== undefined) {
      if (originalStyle.fill) {
        element.setAttribute('fill', originalStyle.fill);
      } else {
        element.removeAttribute('fill');
      }
    }
    if (originalStyle.stroke !== undefined) {
      if (originalStyle.stroke) {
        element.setAttribute('stroke', originalStyle.stroke);
      } else {
        element.removeAttribute('stroke');
      }
    }
    if (originalStyle.strokeWidth !== undefined) {
      if (originalStyle.strokeWidth) {
        element.setAttribute('stroke-width', originalStyle.strokeWidth);
      } else {
        element.removeAttribute('stroke-width');
      }
    }
    if (originalStyle.opacity !== undefined) {
      if (originalStyle.opacity) {
        element.setAttribute('opacity', originalStyle.opacity);
      } else {
        element.removeAttribute('opacity');
      }
    }

    // クラスを除去
    element.classList.remove('playback-highlight');
    element.style.transition = '';

  }, []);

  /**
   * すべてのハイライトを除去する
   */
  const clearAllHighlights = useCallback(() => {
    highlightedElementsRef.current.forEach(highlightElement => {
      try {
        removeHighlight(highlightElement);
      } catch (error) {
        console.warn('[PlaybackHighlight] ハイライト除去中にエラー:', error);
      }
    });
    highlightedElementsRef.current = [];
  }, [removeHighlight]);

  /**
   * 指定した位置の音符をハイライトする
   */
  const highlightPosition = useCallback((position: PlaybackPosition) => {
    // 前のハイライトをクリア
    clearAllHighlights();

    // 音符要素を検索
    const noteElement = findNoteElement(position.measureIndex, position.noteIndex);
    
    if (noteElement) {
      applyHighlight(noteElement, position.measureIndex, position.noteIndex);

      // ページスクロールが有効な場合、要素が見える位置にスクロール
      if (enablePageScroll) {
        scrollToElement(noteElement);
      }
    }
    // 音符要素が見つからない場合は何もしない（譜面が空の場合は正常）
  }, [clearAllHighlights, findNoteElement, applyHighlight, enablePageScroll]);

  /**
   * 要素が見える位置にスクロールする
   */
  const scrollToElement = useCallback((element: SVGElement) => {
    try {
      const rect = element.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // 要素が画面外にある場合のみスクロール
      if (rect.top < scrollOffset || rect.bottom > windowHeight - scrollOffset) {
        const elementTop = rect.top + window.pageYOffset;
        const scrollTop = elementTop - windowHeight / 2;
        
        window.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'smooth'
        });
      }
    } catch (error) {
      console.warn('[PlaybackHighlight] スクロール中にエラー:', error);
    }
  }, [scrollOffset]);

  /**
   * 再生位置の変更を処理する
   */
  useEffect(() => {
    if (!isPlaying) {
      // 停止時はすべてのハイライトを解除
      clearAllHighlights();
      lastPositionRef.current = null;
      return;
    }

    // 位置が変更された場合のみハイライトを更新
    const lastPosition = lastPositionRef.current;
    if (!lastPosition || 
        lastPosition.measureIndex !== currentPosition.measureIndex ||
        lastPosition.noteIndex !== currentPosition.noteIndex) {
      
      highlightPosition(currentPosition);
      lastPositionRef.current = { ...currentPosition };
    }
  }, [currentPosition, isPlaying, clearAllHighlights, highlightPosition]);

  /**
   * コンポーネントのアンマウント時にハイライトをクリア
   */
  useEffect(() => {
    return () => {
      clearAllHighlights();
    };
  }, [clearAllHighlights]);

  // このコンポーネントは視覚的な要素をレンダリングしない
  return null;
}

/**
 * 再生位置インジケーターコンポーネント
 * 現在の再生位置を文字で表示する
 */
export interface PlaybackPositionIndicatorProps {
  /** 現在の再生位置 */
  currentPosition: PlaybackPosition;
  /** 再生状態 */
  isPlaying: boolean;
  /** 総小節数 */
  totalMeasures?: number;
  /** コンパクト表示フラグ */
  compact?: boolean;
  /** カスタムクラス名 */
  className?: string;
}

export function PlaybackPositionIndicator({
  currentPosition,
  isPlaying,
  totalMeasures,
  compact = false,
  className = ''
}: PlaybackPositionIndicatorProps) {
  const formatPosition = () => {
    if (compact) {
      return `${currentPosition.measureIndex + 1}:${currentPosition.noteIndex + 1}`;
    }
    
    const measureText = totalMeasures 
      ? `${currentPosition.measureIndex + 1}/${totalMeasures}小節目`
      : `${currentPosition.measureIndex + 1}小節目`;
    
    return `${measureText} ${currentPosition.noteIndex + 1}音符目`;
  };

  const formatBeatPosition = () => {
    if (currentPosition.beatPosition > 0) {
      return ` (${currentPosition.beatPosition.toFixed(1)}拍)`;
    }
    return '';
  };

  return (
    <div className={`playback-position-indicator ${className} ${isPlaying ? 'playing' : 'stopped'}`}>
      <span className="position-text">
        {formatPosition()}
        {!compact && formatBeatPosition()}
      </span>
      {isPlaying && (
        <span className="playing-indicator" aria-label="再生中">
          ♪
        </span>
      )}
    </div>
  );
}