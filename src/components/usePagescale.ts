// src/components/usePageScale.ts
import { useEffect, useRef, useState } from 'react';

type Opt = { pageWidthPx?: number; gapPx?: number; maxScale?: number };

/** 画面幅と列数に応じてページのスケールを算出する */
export function usePageScale(columns: number, opt: Opt = {}) {
  const { pageWidthPx = 794, gapPx = 20, maxScale = 1 } = opt;
  const spreadRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!spreadRef.current) return;
    const el = spreadRef.current;

    const update = () => {
      const container = el.clientWidth;
      const need = columns * pageWidthPx + (columns - 1) * gapPx;
      const s = Math.min(maxScale, container / need);
      setScale(Number.isFinite(s) ? Math.max(0.3, s) : 1);
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();

    return () => ro.disconnect();
  }, [columns, pageWidthPx, gapPx, maxScale]);

  return { spreadRef, scale };
}
