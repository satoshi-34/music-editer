// src/components/ScaledPageWrapper.tsx
// ページ（.print-page）を transform: scale で縮小表示するためのラッパー。
//
// 背景（issue #13）:
// 以前は .page-wrapper に CSS zoom を使っていたが、Safari では zoom が
// getBoundingClientRect に反映されず、クリック座標と音符配置位置がずれる
// バグが繰り返し発生した。transform: scale は全ブラウザで
// getBoundingClientRect に反映されるため、座標変換を安定させられる。
//
// ただし transform はレイアウト上の占有サイズを変えない（見た目だけ縮む）。
// そのままだと縮小前の高さでグリッドに居座り、ページ間に大きな余白ができる。
// ページ高さは内容により A4 を超えることがある（大編成の総譜など）ので、
// ここで実際の高さを測り「実測高さ × scale」をラッパーの高さとして設定する。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface ScaledPageWrapperProps {
  /** ページの表示倍率（useAutoPageScale が算出した値） */
  scale: number;
  /** 同じ譜面内で共有するページ高さ（未指定時は各ページを個別に測る） */
  pageHeight?: number | null;
  /** ページ本体（.print-page を直下に1つ置く想定） */
  children: ReactNode;
}

export default function ScaledPageWrapper({ scale, pageHeight = null, children }: ScaledPageWrapperProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // 計測前は null のまま CSS のフォールバック高さ（A4 × scale）に任せる
  const [measuredPageHeight, setMeasuredPageHeight] = useState<number | null>(null);

  useEffect(() => {
    // 直下の .print-page を計測対象にする。
    // offsetHeight は transform の影響を受けない「レイアウト上の高さ」を返すので、
    // 縮小後の見た目高さは offsetHeight × scale で求められる。
    const page = wrapperRef.current?.firstElementChild as HTMLElement | null;
    if (!page) return;

    const measure = () => {
      const next = page.offsetHeight;
      // jsdom（テスト環境）ではレイアウトされず 0 になるため、
      // その場合は CSS フォールバックを使い続ける
      setMeasuredPageHeight(next > 0 ? next : null);
    };

    measure();
    // 譜面の段数変更などでページ高さが変わったら追従する
    const ro = new ResizeObserver(measure);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  const measuredHeight = pageHeight ?? measuredPageHeight;

  return (
    <div
      className="page-wrapper"
      ref={wrapperRef}
      style={measuredHeight != null ? {
        height: measuredHeight * scale,
        '--page-height': `${measuredHeight}px`,
      } as CSSProperties : undefined}
    >
      {children}
    </div>
  );
}
