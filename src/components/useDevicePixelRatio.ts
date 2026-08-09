// src/components/useDevicePixelRatio.ts
// ─────────────────────────────────────────────────────────────
// 画面の devicePixelRatio（1 CSS px が何個の物理ドットで描かれるか）を返すフック。
// Retina の Mac なら 2、ふつうの外部モニタなら 1 になる。
//
// 線の細さの下限（Issue #210）は「1デバイスピクセルを塗り切れるか」で決めるため、
// この値が要る。ウィンドウを別のモニタへ移すと dpr は変わるが、そのとき
// resize イベントが必ず飛ぶとは限らない（同じサイズのままの移動では飛ばない）。
// そこで「いまの dpr ちょうどの解像度か」を問う media query を張り、
// 一致しなくなった＝dpr が変わった、として読み直す（この用途の定石）。
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

/** SSR やテスト環境（window が無い/古い jsdom）でも安全に読む */
function readDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(readDevicePixelRatio);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    // 監視対象は「いまの dpr」なので、変化するたびに張り直す必要がある。
    // dpr が変わると下の mql は matches:false になり、change が飛ぶ。
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(readDevicePixelRatio());
    // addEventListener を持たない古い実装（jsdom のモック等）では何もしない
    if (typeof mql.addEventListener !== 'function') return;
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [dpr]);

  return dpr;
}
