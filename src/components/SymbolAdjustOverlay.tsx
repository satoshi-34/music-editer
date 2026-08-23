// src/components/SymbolAdjustOverlay.tsx
// 「記号サイズ変更」「記号位置調整」の2つのオーバーレイが共通で使う入れ物（Issue #230）。
//
// 何をするコンポーネントか:
//   調整対象の記号に**重ならない場所**へ自分自身を置く。位置の決め方（上→下→左右）は
//   symbolOverlayPlacementUtils.ts の純粋関数に任せ、ここは DOM の計測だけを担当する。
//
// なぜ共通化したか:
//   2つのオーバーレイは見た目も配置ルールも同じなので、別々に持つと片方だけ直して
//   もう片方が対象を隠したままになる（Issue #230 のトリアージでも「2系統にしないこと」と明記）。

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import {
  computeSymbolOverlayPlacement,
  estimateSymbolOverlayPosition,
  SYMBOL_OVERLAY_FALLBACK_HEIGHT,
  SYMBOL_OVERLAY_FALLBACK_WIDTH,
  type OverlayRectLike,
} from '../utils/symbolOverlayPlacementUtils';

interface SymbolAdjustOverlayProps {
  /**
   * 調整対象の記号の実描画範囲（コンテナ左上が原点・ページ縮小率を戻した座標）。
   * オーバーレイを開いた時点の値を親が state に持ち、開いている間は差し替えない
   * （矢印キーで記号が動いてもオーバーレイが逃げないようにするため）。
   */
  anchor: OverlayRectLike;
  /** オーバーレイを載せているコンテナ（position: relative の div） */
  containerRef: RefObject<HTMLDivElement | null>;
  /** オーバーレイの最小幅（オーバーレイごとに入力欄の数が違うため親から渡す） */
  minWidth: number;
  /**
   * 矢印キーで調整中の半透明化（Issue #385・裁定C）。true の間はオーバーレイを
   * 透かして、位置合わせの参照物（周辺の音符）を見えるようにする。
   * 不透明へ戻す条件（キー入力が止まった・カーソルが乗った）は親が管理する。
   */
  translucent?: boolean;
  /** オーバーレイにカーソルが乗ったら不透明へ戻すための通知（translucent 管理者へ） */
  onTranslucentCancel?: () => void;
  children: ReactNode;
}

/**
 * ページは `.print-page` に transform: scale が掛かっている（Issue #13 の座標対策）。
 * getBoundingClientRect は縮小後の見た目サイズを返すのに対し、
 * `position: absolute` の left/top は縮小前の座標で解釈される。
 * そのため「実測 px ÷ 縮小率」で座標系をそろえる必要がある。
 * offsetWidth は transform の影響を受けない値なので、両者の比が縮小率になる。
 */
function resolvePageScale(container: HTMLElement): number {
  const rect = container.getBoundingClientRect();
  const layoutWidth = container.offsetWidth;
  if (!rect.width || !layoutWidth) return 1;  // jsdom など計測できない環境では等倍として扱う
  return rect.width / layoutWidth;
}

/**
 * オーバーレイを置いてよい範囲（＝いま画面に見えている範囲）をコンテナ座標で求める。
 * 上端はツールバー（position: fixed で画面上部に居座る）の下端にする。
 * ツールバーの下へ潜り込むと、見えていても操作できないため。
 */
function resolveBounds(container: HTMLElement, scale: number) {
  const rect = container.getBoundingClientRect();
  const toolbar = document.querySelector('header.toolbar');
  const toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom : 0;
  // clientWidth/Height を優先するのは、スクロールバーのぶんを除いた「実際に見えている幅」だから。
  // window.innerWidth はスクロールバーを含むので、右端に置いたオーバーレイがバーに隠れることがある。
  // jsdom（テスト環境）は clientWidth が 0 なので、その場合だけ innerWidth へ落とす。
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
  return {
    left: (0 - rect.left) / scale,
    top: (Math.max(0, toolbarBottom) - rect.top) / scale,
    right: (viewportWidth - rect.left) / scale,
    bottom: (viewportHeight - rect.top) / scale,
  };
}

export default function SymbolAdjustOverlay({ anchor, containerRef, minWidth, translucent, onTranslucentCancel, children }: SymbolAdjustOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  // null の間は「まだ測っていない」。暫定位置で描いてから、下の useLayoutEffect で確定位置へ差し替える。
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;
    const scale = resolvePageScale(container);
    const overlayRect = overlay.getBoundingClientRect();
    // jsdom はレイアウトしないので幅・高さが 0 になる。0 のまま計算すると
    // 「高さ0の箱」を記号の上に置くことになるため、代替値へ落とす。
    const size = {
      width: overlayRect.width ? overlayRect.width / scale : SYMBOL_OVERLAY_FALLBACK_WIDTH,
      height: overlayRect.height ? overlayRect.height / scale : SYMBOL_OVERLAY_FALLBACK_HEIGHT,
    };
    const next = computeSymbolOverlayPlacement({
      anchor,
      overlay: size,
      bounds: resolveBounds(container, scale),
    });
    setPosition({ left: next.left, top: next.top });
    // 依存は anchor だけ。anchor は「オーバーレイを開いた時点」に作られた1個のオブジェクトで、
    // 矢印キーで記号を動かしても差し替わらない。つまりここは開いた直後に1回だけ走り、
    // 調整中にオーバーレイが記号を追いかけて逃げることがない（Issue #230 の要件）。
  }, [anchor, containerRef]);

  const { left, top } = position ?? estimateSymbolOverlayPosition(anchor);

  return (
    <div
      ref={overlayRef}
      className={`symbol-adjust-overlay${translucent ? ' symbol-adjust-overlay-translucent' : ''}`}
      data-placed={position ? 'true' : 'false'}
      onMouseEnter={onTranslucentCancel}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 200,
        background: '#fff',
        border: '1.5px solid #0891b2',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        padding: '4px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth,
      }}
    >
      {children}
    </div>
  );
}
