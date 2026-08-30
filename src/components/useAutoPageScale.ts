// src/components/useAutoPageScale.ts
// ─────────────────────────────────────────────────────────────
// 画面幅に合わせて自動で縮尺を決めるフック（ふらつき防止のヒステリシス入り）
// ・監視対象は“外側のレール”だけ
// ・±0.5%未満の差は無視
// ・requestAnimationFrameでスロットリング
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { readPageAreaAvailableWidth } from '../utils/viewZoomUtils';
import { DEFAULT_PAGE_WIDTH_MM } from '../utils/pageSize';

export function useAutoPageScale(
  columns: number,
  gapPx: number = 20,
  // 画面幅のうち fixed 要素（左配置のツールバー等）が占有していて
  // ページを並べられない幅(px)。#483 round3: 幅の測り先（body）は fixed の
  // ツールバーぶんまでは縮まないため、ここで引かないと2列表示が右へはみ出す
  occupiedWidthPx: number = 0,
  // 用紙の幅(mm)。用紙サイズ（A4/B4/A3・Issue #495）を変えると1ページの幅が変わるため、
  // 自動縮尺もその幅に追従させる必要がある。省略時は従来どおり A4（210mm）。
  pageWidthMmValue: number = DEFAULT_PAGE_WIDTH_MM,
) {
  const spreadRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const lastScaleRef = useRef(1);
  const rafRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const spread = spreadRef.current;
    if (!spread) return;

    const rail = spread.parentElement;
    if (!rail) return;

    // mm→px は 3.78px/mm（viewZoomUtils.ts の初期ズーム見積もりと同じ係数を使う）。
    // 用紙の幅は pageSize.ts が正本で、ここでは引数で受け取った mm を px へ直すだけ。
    const pageWidthPx = pageWidthMmValue * 3.78;
    const cols = Math.max(1, columns);
    const totalGap = (cols - 1) * gapPx;

    const need = pageWidthPx * cols + totalGap;
    // ここで rail.clientWidth を読んではいけない（Issue #212）。
    // レールは横スクロール時に中身の幅まで広がるので、測ると自分の結果を測り直す形になる。
    // 詳しい理由は readPageAreaAvailableWidth のコメントを参照。
    const avail = Math.max(0, readPageAreaAvailableWidth(rail) - occupiedWidthPx);

    const next = Math.min(1, Math.max(0.1, (avail * 0.98) / need));

    const prev = lastScaleRef.current;
    const diff = Math.abs(next - prev);
    if (diff < Math.max(0.005, prev * 0.005)) return; // ±0.5%未満は無視

    lastScaleRef.current = next;
    setScale(next);
  }, [columns, gapPx, occupiedWidthPx, pageWidthMmValue]);

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
