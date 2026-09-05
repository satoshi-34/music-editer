// src/components/InstantTooltip.tsx
// 即時ツールチップ（Issue #633 の運用者要望「カーソルを置いた瞬間に出す」）。
//
// ブラウザ標準の title は約1秒待たないと出ず、埋め込みブラウザでは出ないこともある。
// また CSS の ::after で吹き出しを作っても、ツールバーの各段（.toolbar-panel）が
// 横スクロール用に overflow:auto なので外へ出られず切れる。
// そこでプルダウン（ToolVariantButton・#613）と同じく **画面座標で固定表示**する。
//
// 使い方: 出したい要素に `data-tip="文言"` を付けるだけ（title の代わり）。
// この部品はアプリに1つだけ置き、document 全体のホバー／フォーカスを委譲で拾う。
// 各ボタンに部品を足さないので、ボタンが増えても仕組みは1か所のまま。
// aria-label は別に持つ（支援技術・テストの手がかりは変えない）。
import { useEffect, useState } from 'react';
import { clampDropdownMenuLeft } from '../utils/toolbarPlacement';

/** 吹き出しの最大幅（px）。長い説明文はこの幅で折り返す */
export const INSTANT_TOOLTIP_MAX_WIDTH_PX = 320;
/** 要素の下端から吹き出しまでの隙間（px） */
const GAP_PX = 6;

type TipState = { text: string; left: number; top: number; above: boolean } | null;

/** data-tip を持つ最も近い祖先（自身を含む）。無ければ null */
function findTipElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-tip]');
  return el instanceof HTMLElement ? el : null;
}

export default function InstantTooltip() {
  const [tip, setTip] = useState<TipState>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      const text = el.getAttribute('data-tip') ?? '';
      if (!text) return;
      current = el;
      const rect = el.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      // 横: 要素の左に合わせ、右端ではみ出すぶんは左へ寄せる（プルダウンと同じクランプ）
      const left = clampDropdownMenuLeft({
        anchorLeft: rect.left, menuWidthPx: INSTANT_TOOLTIP_MAX_WIDTH_PX, viewportWidth,
      });
      // 縦: 基本は要素の下。画面の下寄り（残りが 120px 未満）なら上へ出す
      const above = viewportHeight - rect.bottom < 120;
      const top = above ? rect.top - GAP_PX : rect.bottom + GAP_PX;
      setTip({ text, left, top, above });
    };
    const hide = () => { current = null; setTip(null); };
    const onOver = (e: Event) => {
      const el = findTipElement(e.target);
      if (!el) { if (current) hide(); return; }
      if (el !== current) show(el);
    };
    const onOut = (e: MouseEvent) => {
      if (!current) return;
      // 同じ要素の中での移動（子要素間）では消さない
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = findTipElement(e.target);
      if (el) show(el);
    };
    const onFocusOut = () => { if (current) hide(); };
    // 押した・スクロールした・キーを打った瞬間は消す（操作の邪魔をしない）
    const onHideEvent = () => { if (current) hide(); };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onHideEvent, true);
    document.addEventListener('keydown', onHideEvent, true);
    window.addEventListener('scroll', onHideEvent, true);
    window.addEventListener('resize', onHideEvent);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onHideEvent, true);
      document.removeEventListener('keydown', onHideEvent, true);
      window.removeEventListener('scroll', onHideEvent, true);
      window.removeEventListener('resize', onHideEvent);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className="instant-tooltip"
      role="tooltip"
      data-testid="instant-tooltip"
      style={{
        left: tip.left,
        top: tip.top,
        maxWidth: INSTANT_TOOLTIP_MAX_WIDTH_PX,
        // 上に出すときは要素の上端を吹き出しの下端にそろえる
        transform: tip.above ? 'translateY(-100%)' : undefined,
      }}
    >
      {tip.text}
    </div>
  );
}
