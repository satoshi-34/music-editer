import { useEffect, useRef, useState } from "react";

/** 見開き(列数)に応じて .print-page を縮小して収める */
export function useAutoPageScale(columns: number, gapPx = 20) {
  const spreadRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = spreadRef.current;
    if (!el) return;

    const update = () => {
      // 1枚目の実寸を採用（mm指定でも最終的なCSS pxを取得）
      const firstPage = el.querySelector<HTMLElement>(".print-page");
      if (!firstPage) return;

      const pageW = firstPage.offsetWidth;   // px
      const need = columns * pageW + (columns - 1) * gapPx;
      const container = el.clientWidth;      // px
      const s = Math.min(1, container / need);
      setScale(Number.isFinite(s) ? Math.max(0.3, s) : 1);
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    update();

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [columns, gapPx]);

  return { spreadRef, scale };
}
