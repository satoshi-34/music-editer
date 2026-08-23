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
  SYMBOL_OVERLAY_GAP,
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
 * オーバーレイを置いてよい範囲（＝いま実際に見えている範囲）をコンテナ座標で求める。
 * 上端はツールバー（position: fixed で画面上部に居座る）の下端にする。
 * ツールバーの下へ潜り込むと、見えていても操作できないため。
 *
 * 「見えている範囲」はビューポートだけでは足りない（Issue #392）。オーバーレイは
 * position: absolute で譜面のコンテナに属するため、**overflow が visible でない祖先**
 * （A4ページの `.print-page` は紙面をはみ出す描画を切るため overflow: hidden）に
 * 視覚的に切り取られる。ビューポート内に収めただけでは、譜面左端の記号で
 * 「画面内だが .print-page の外」に置かれ、入力欄の左側が見切れていた。
 * そこで、クリップする祖先すべての矩形との**共通部分**まで範囲を狭める。
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
  let left = 0;
  let top = Math.max(0, toolbarBottom);
  let right = viewportWidth;
  let bottom = viewportHeight;
  // コンテナ自身から body までの祖先で、描画を切る（overflow が visible でない）ものを交差する。
  // 大きさを測れない環境（jsdom）の 0 矩形は、範囲を潰してしまうので無視する
  for (let el: HTMLElement | null = container; el && el !== document.body; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const clipRect = el.getBoundingClientRect();
    if (!clipRect.width && !clipRect.height) continue;
    left = Math.max(left, clipRect.left);
    top = Math.max(top, clipRect.top);
    right = Math.min(right, clipRect.right);
    bottom = Math.min(bottom, clipRect.bottom);
  }
  return {
    left: (left - rect.left) / scale,
    top: (top - rect.top) / scale,
    right: (right - rect.left) / scale,
    bottom: (bottom - rect.top) / scale,
  };
}

export default function SymbolAdjustOverlay({ anchor, containerRef, minWidth, translucent, onTranslucentCancel, children }: SymbolAdjustOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  // null の間は「まだ測っていない」。暫定位置で描いてから、下の useLayoutEffect で確定位置へ差し替える。
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // 計測が空振りしたとき（ref がまだ無い等）のリトライ用カウンタ（#392 防御）。
  // 依存に入れることで、rAF 後にもう一度 useLayoutEffect を走らせる
  const [measureRetry, setMeasureRetry] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) {
      // ここで諦めると暫定位置（クランプの弱い概算）のまま表示され続け、
      // 譜面左端の記号では画面外へ見切れる（#392 で報告された形）。
      // ref が揃うまで数フレームだけリトライする
      if (measureRetry < 10) {
        const raf = requestAnimationFrame(() => setMeasureRetry((n) => n + 1));
        return () => cancelAnimationFrame(raf);
      }
      return;
    }
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
    // 依存は anchor（+リトライカウンタ）。anchor は「オーバーレイを開いた時点」に作られた
    // 1個のオブジェクトで、矢印キーで記号を動かしても差し替わらない。つまりここは開いた
    // 直後に1回だけ走り、調整中にオーバーレイが記号を追いかけて逃げることがない（#230 の要件）。
  }, [anchor, containerRef, measureRetry]);

  // 暫定位置にも最低限のクランプを掛ける（#392 防御）。確定位置は
  // computeSymbolOverlayPlacement が可視範囲へクランプ済みだが、暫定は記号中央基準の
  // 概算のため、譜面左端・上端の記号では負座標（コンテナ外＝ほぼ画面外）になり得る。
  // コンテナ左上より内側（余白ぶん）を下限にしておけば、計測前の一瞬（または計測が
  // 走らない未知の経路）でも入力欄が画面外へ出ない
  const estimated = estimateSymbolOverlayPosition(anchor);
  const { left, top } = position ?? {
    left: Math.max(SYMBOL_OVERLAY_GAP, estimated.left),
    top: Math.max(SYMBOL_OVERLAY_GAP, estimated.top),
  };

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
