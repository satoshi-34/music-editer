// src/components/useAutoPageScale.ts
// ─────────────────────────────────────────────────────────────
// 画面幅に合わせて自動で縮尺を決めるフック（ふらつき防止のヒステリシス入り）
// ・監視対象は“外側のレール”だけ
// ・±0.5%未満の差は無視
// ・requestAnimationFrameでスロットリング
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoPageScale(columns: number, gapPx: number = 20) {
  const spreadRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const lastScaleRef = useRef(1);
  const rafRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const spread = spreadRef.current;
    if (!spread) return;

    const rail = spread.parentElement;
    if (!rail) return;

    const pageWidthPx = 210 * 3.78; // A4 210mm ≒ 3.78px/mm
    const cols = Math.max(1, columns);
    const totalGap = (cols - 1) * gapPx;

    const need = pageWidthPx * cols + totalGap;
    const avail = rail.clientWidth;

    const next = Math.min(1, Math.max(0.1, (avail * 0.98) / need));

    const prev = lastScaleRef.current;
    const diff = Math.abs(next - prev);
    if (diff < Math.max(0.005, prev * 0.005)) return; // ±0.5%未満は無視

    lastScaleRef.current = next;
    setScale(next);
  }, [columns, gapPx]);

  useEffect(() => {
    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        recompute();
      });
    };

    schedule(); // 初回

    const spread = spreadRef.current;
    const rail = spread?.parentElement;
    if (!rail) return;

    const ro = new ResizeObserver(() => schedule());
    ro.observe(rail);

    const onWin = () => schedule();
    window.addEventListener('resize', onWin);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWin);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [recompute]);

  return { spreadRef, scale };
}
