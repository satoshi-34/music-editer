// src/ScorePage.tsx
import { useEffect, useMemo, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import { useAutoPageScale } from '../components/useAutoPageScale';

type PageSpec = { systems: number };

export default function ScorePage() {
  // ツール（音符/休符）状態
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });
  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');

  // 列数をウィンドウ幅に応じて決定（通常は2列）
  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    const onResize = () => {
      setColumns(window.innerWidth < 1200 ? 1 : 2);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // === ページスケール自動計算 ===
  const { spreadRef, scale: baseScale } = useAutoPageScale(columns, 20);
  const scale = baseScale * 0.8; // 基本スケールを80%に調整

  // 総段数と1ページあたりの段数
  const totalSystems = 12;
  const systemsPerPage = 9;  //1ページあたりの段数

  const pages: PageSpec[] = useMemo(() => {
    return Array.from(
      { length: Math.ceil(totalSystems / systemsPerPage) },
      () => ({ systems: systemsPerPage })
    );
  }, [totalSystems, systemsPerPage]);

  // ==== 追加機能 ====
  // 画面に入りきらないときは1枚だけ表示するための状態
  const [visiblePages, setVisiblePages] = useState<PageSpec[]>(pages);
  useEffect(() => {
    const updateVisiblePages = () => {
      const vh = window.innerHeight;
      const pagePixelHeight = 297 * scale * 3.78; // mm → px換算 (1mm ≒ 3.78px)
      if (pagePixelHeight * 2 > vh) {
        // 2ページ並べると画面高さを超えるなら1ページだけ
        setVisiblePages(pages.slice(0, 1));
      } else {
        setVisiblePages(pages);
      }
    };
    updateVisiblePages();
    window.addEventListener('resize', updateVisiblePages);
    return () => window.removeEventListener('resize', updateVisiblePages);
  }, [pages, scale]);

  return (
    <div className="app-root">
      {/* ツールバー */}
      <header className="toolbar">
        <div className="title-group">
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="subtitle-input"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </div>
        <div className="controls">
          <Palette value={tool} onChange={setTool} />
          <button className="ghost" onClick={() => window.print()}>
            印刷
          </button>
        </div>
      </header>

      {/* 譜面プレビュー */}
      <div className="paper-rail">
        <div
          className="spread"
          style={
            {
              '--scale': String(scale),
              '--columns': String(columns),
            } as React.CSSProperties
          }
        >
          {visiblePages.map((p, i) => (
            <div className="page-wrapper" key={i}>
              <section className="print-page">
                <header className="page-head">
                  {i === 0 ? (
                    <>
                      <h1 className="score-title">{title}</h1>
                      <p className="score-subtitle">{subtitle}</p>
                    </>
                  ) : (
                    <p className="page-title">{title}</p>
                  )}
                </header>
                <div className="score-area">
                  <StaffCanvas
                    systems={p.systems}
                    measuresPerSystem={4}
                    tool={tool}
                  />
                </div>
                <footer className="page-foot">
                  <span className="page-number">{i + 1}</span>
                </footer>
              </section>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
