// src/components/PlaybackHighlight.tsx
// 再生位置表示コンポーネント
// 現在再生中の音符を譜面上で「淡色の縦帯」として示し、小節境界を越えるたびに帯を出し直し、
// 停止・一時停止・タブ切替（背景復帰）では必ず帯を消す。

import { useEffect, useRef, useCallback } from 'react';
import type { PlaybackPosition } from '../audio/ScorePlayer';
import type { PlaybackHighlightTarget } from '../utils/playbackPositionUtils';
import {
  computePlaybackBandBoxes,
  isSelectorSafeIndex,
} from './playbackHighlightUtils';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 帯に付けるクラス。
 * - `vf-playback-band`: 帯そのものを指す（CSS と印刷の除外条件で使う）
 * - `playback-highlight`: 「再生中の目印」を表す従来からのクラス（明滅アニメーション）
 */
export const PLAYBACK_BAND_CLASS = 'vf-playback-band vf-screen-only';
const PLAYBACK_HIGHLIGHT_CLASS = 'playback-highlight';

/**
 * PlaybackHighlightコンポーネントのプロパティ
 */
export interface PlaybackHighlightProps {
  /** 現在の再生位置 */
  currentPosition: PlaybackPosition;
  /**
   * いま鳴っている音符（全パート・全声部）。Issue #411 で追加。
   * 渡されたときはこの一覧ぜんぶに帯を出す。渡されない・空のときは
   * 従来どおり `currentPosition` の小節・音符番号だけで探す（後方互換）。
   */
  highlightTargets?: PlaybackHighlightTarget[];
  /** 再生状態 */
  isPlaying: boolean;
  /** ハイライト対象のコンテナ要素のセレクタ */
  containerSelector?: string;
  /** 帯のスタイルのカスタマイズ */
  highlightStyle?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
  };
  /** 符頭の左右に足す帯の余白（SVG 内部座標） */
  bandPaddingX?: number;
  /** ページスクロールを有効にするか */
  enablePageScroll?: boolean;
  /** スクロール時のオフセット */
  scrollOffset?: number;
}

/**
 * デフォルトの帯のスタイル。
 *
 * 選択中の音符の枠は青（`.vf-note-selected` の `#1d4ed8`）なので、
 * 再生位置は琥珀色にして「選択」と「再生位置」を色で見分けられるようにしている（Issue #268）。
 * 塗りだけで輪郭を持たせないのは、五線・符頭と競合する線を増やさないため。
 */
const DEFAULT_HIGHLIGHT_STYLE = {
  fill: 'rgba(245, 158, 11, 0.35)',
  stroke: 'none',
  strokeWidth: '0',
  opacity: ''
};

/**
 * 符頭の左右に足す余白の既定値（SVG 内部座標。五線1間隔がおよそ 10）。
 * 符頭の幅は 12 前後しかないので、これを足して「1音ぶんの帯」に見える太さにする。
 */
const DEFAULT_BAND_PADDING_X = 7;

/**
 * 対象の一覧を「同じかどうか」を比べるための短い文字列にする。
 * 配列の中身が同じでも毎回新しい配列が来るため、参照の比較では描き直しが止まらない。
 */
function describeTargets(targets?: PlaybackHighlightTarget[]): string {
  if (!targets || targets.length === 0) return '';
  return targets
    .map(t => `${t.partIndex}:${t.voiceIndex}:${t.measureIndex}:${t.noteIndex}`)
    .join('|');
}

/**
 * 再生位置表示コンポーネント
 * 要件7.1, 7.2, 7.4に対応：現在再生中の音符を縦帯で示す
 */
export default function PlaybackHighlight({
  currentPosition,
  highlightTargets,
  isPlaying,
  containerSelector = '.score-area',
  highlightStyle = DEFAULT_HIGHLIGHT_STYLE,
  bandPaddingX = DEFAULT_BAND_PADDING_X,
  enablePageScroll = true,
  scrollOffset = 100
}: PlaybackHighlightProps) {
  // いま画面に出している帯（自分で作った要素だけを覚える）
  const bandsRef = useRef<SVGRectElement[]>([]);
  const lastPositionRef = useRef<PlaybackPosition | null>(null);
  // 直前に光らせた対象の一覧（同じ内容なら描き直さないための目印）
  const lastTargetsKeyRef = useRef<string | null>(null);

  /**
   * いま鳴っている音符の当たり判定を、段（SVG）ごとにまとめて返す。
   *
   * 返す形は「段 → 音符ごとの当たり判定の配列」。音符1つが複数枚の rect に
   * 分かれている（#246 の固定範囲＋拡張部）ため、内側がさらに配列になっている。
   *
   * 探す対象は2種類:
   *  - `.vf-note-hit`: 編集中レイヤー（アクティブ声部）の当たり判定
   *  - `.vf-inactive-voice-note-hit`: それ以外の声部・パートの当たり判定（#258 で追加済み）
   *
   * 後者まで見るのが Issue #411 の本体。以前は前者しか見ていなかったため、
   * 選択中のレイヤー以外は音が鳴っていても譜面が反応しなかった。
   */
  const collectNoteElementsBySystem = useCallback((
    targets: PlaybackHighlightTarget[]
  ): Map<SVGSVGElement, SVGElement[][]> => {
    const bySystem = new Map<SVGSVGElement, SVGElement[][]>();
    const containers = document.querySelectorAll(containerSelector);

    for (const target of targets) {
      // 再生位置は譜面データ由来だが、念のため整数だけをセレクタへ入れる
      if (!isSelectorSafeIndex(target.measureIndex) || !isSelectorSafeIndex(target.noteIndex)) continue;
      const position = `[data-measure="${target.measureIndex}"][data-note="${target.noteIndex}"]`;
      // パート・声部が分かっているときだけ絞り込む。分からない（従来互換の呼び出し）
      // ときは位置だけで探すので、これまでと同じ結果になる
      const part = isSelectorSafeIndex(target.partIndex) ? `[data-part="${target.partIndex}"]` : '';
      const voice = isSelectorSafeIndex(target.voiceIndex) ? `[data-voice="${target.voiceIndex}"]` : '';
      const selector = `.vf-note-hit${position}${part}${voice}, .vf-inactive-voice-note-hit${position}${part}${voice}`;

      // 1つの音符ぶんの rect を段ごとに仕分ける（段をまたぐことは無いが、
      // ページが複数あるときは同じ小節番号が別の段に出ることがある）
      const perSystem = new Map<SVGSVGElement, SVGElement[]>();
      for (const container of containers) {
        container.querySelectorAll(selector).forEach(node => {
          const el = node as SVGElement;
          // 段の SVG が親に居ないもの（描画途中・別実装）は帯を置く先が決まらないので飛ばす
          const svg = el.ownerSVGElement;
          if (!svg) return;
          const list = perSystem.get(svg);
          if (list) list.push(el);
          else perSystem.set(svg, [el]);
        });
      }
      perSystem.forEach((els, svg) => {
        const groups = bySystem.get(svg);
        if (groups) groups.push(els);
        else bySystem.set(svg, [els]);
      });
    }

    return bySystem;
  }, [containerSelector]);

  /**
   * 段の SVG へ帯を差し込む。
   *
   * `insertBefore(..., svg.firstChild)` で**先頭の子**として入れるのがポイント。
   * SVG は後から描いたものが手前に来るので、先頭に置けば五線・符頭より必ず背面になり、
   * 音符が帯に隠れない（符頭の色を変える方式をやめた理由でもある）。
   *
   * 横位置が重なる音符は1本にまとまるので、和音や縦にそろった拍では帯は1本のまま。
   * 右手と左手が別の拍を弾いているときだけ帯が増える（Issue #411）。
   */
  const drawBands = useCallback((
    svg: SVGSVGElement,
    noteElGroups: SVGElement[][],
    measureIndex: number,
    noteIndex: number
  ): SVGRectElement[] => {
    const systemEls = Array.from(svg.querySelectorAll('.vf-note-hit, .vf-inactive-voice-note-hit'));
    const boxes = computePlaybackBandBoxes(noteElGroups, systemEls, bandPaddingX);
    const bands: SVGRectElement[] = [];

    for (const box of boxes) {
      const band = document.createElementNS(SVG_NS, 'rect');
      band.setAttribute('class', `${PLAYBACK_BAND_CLASS} ${PLAYBACK_HIGHLIGHT_CLASS}`);
      // どの位置の帯かをテスト・デバッグから見分けられるようにする（表示には影響しない）
      band.setAttribute('data-measure', String(measureIndex));
      band.setAttribute('data-note', String(noteIndex));
      band.setAttribute('x', String(box.x));
      band.setAttribute('y', String(box.y));
      band.setAttribute('width', String(box.width));
      band.setAttribute('height', String(box.height));
      band.setAttribute('rx', '3');
      // 帯がクリックを奪うと音符を選べなくなるので、当たり判定から必ず外す
      band.setAttribute('pointer-events', 'none');

      if (highlightStyle.fill) band.setAttribute('fill', highlightStyle.fill);
      if (highlightStyle.stroke) band.setAttribute('stroke', highlightStyle.stroke);
      if (highlightStyle.strokeWidth) band.setAttribute('stroke-width', highlightStyle.strokeWidth);
      if (highlightStyle.opacity) band.setAttribute('opacity', highlightStyle.opacity);

      svg.insertBefore(band, svg.firstChild);
      bands.push(band);
    }
    return bands;
  }, [bandPaddingX, highlightStyle]);

  /**
   * すべての帯を消す
   */
  const clearAllHighlights = useCallback(() => {
    bandsRef.current.forEach(band => {
      try {
        band.remove();
      } catch (error) {
        console.warn('[PlaybackHighlight] ハイライト除去中にエラー:', error);
      }
    });
    bandsRef.current = [];
  }, []);

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
   * 指定した位置に帯を出す
   */
  const highlightPosition = useCallback((
    position: PlaybackPosition,
    targets: PlaybackHighlightTarget[] | undefined
  ) => {
    // 前の帯を先に消す（位置が進むたびに、いま鳴っている音符ぶんだけが残る状態にする）
    clearAllHighlights();

    // 鳴っている音符の一覧が渡されていればそれを使う。無い場合は従来どおり
    // 「再生位置の小節・音符番号」1件だけを探す（パート・声部は絞らない）
    const resolvedTargets: PlaybackHighlightTarget[] = targets && targets.length > 0
      ? targets
      : [{
          partIndex: -1,
          voiceIndex: -1,
          measureIndex: position.measureIndex,
          noteIndex: position.noteIndex,
        }];

    const bySystem = collectNoteElementsBySystem(resolvedTargets);
    let scrollTarget: SVGElement | null = null;

    bySystem.forEach((noteElGroups, svg) => {
      const bands = drawBands(svg, noteElGroups, position.measureIndex, position.noteIndex);
      bands.forEach(band => bandsRef.current.push(band));
      if (!scrollTarget) {
        const firstGroup = noteElGroups.find(group => group.length > 0);
        if (firstGroup) scrollTarget = firstGroup[0];
      }
    });

    // 音符要素が見つからない場合は何もしない（譜面が空の場合は正常）
    if (enablePageScroll && scrollTarget) {
      scrollToElement(scrollTarget);
    }
  }, [clearAllHighlights, collectNoteElementsBySystem, drawBands, enablePageScroll, scrollToElement]);

  /**
   * 再生位置の変更を処理する
   */
  useEffect(() => {
    if (!isPlaying) {
      // 停止・一時停止・背景復帰（ScorePage が playbackState を stopped に戻す）で必ず消える
      clearAllHighlights();
      lastPositionRef.current = null;
      lastTargetsKeyRef.current = null;
      return;
    }

    // 位置が変更された場合のみハイライトを更新。
    // 同じ音符番号でも「鳴っている音符の顔ぶれ」が変わることがある（右手が伸ばしている
    // あいだに左手だけが動く拍）ので、対象の一覧も見比べる（Issue #411）
    const lastPosition = lastPositionRef.current;
    const targetsKey = describeTargets(highlightTargets);
    if (!lastPosition ||
        lastPosition.measureIndex !== currentPosition.measureIndex ||
        lastPosition.noteIndex !== currentPosition.noteIndex ||
        lastTargetsKeyRef.current !== targetsKey) {

      highlightPosition(currentPosition, highlightTargets);
      lastPositionRef.current = { ...currentPosition };
      lastTargetsKeyRef.current = targetsKey;
    }
  }, [currentPosition, highlightTargets, isPlaying, clearAllHighlights, highlightPosition]);

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
