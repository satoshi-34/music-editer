// src/ScorePage.tsx
import { useEffect, useMemo, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import { useAutoPageScale } from '../components/useAutoPageScale';

// 1ページに必要な情報の型
type PageSpec = { systems: number };

export default function ScorePage() {
  // ツール（音符/休符）状態
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });
  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');

  // 列数（カラム数）をウィンドウ幅に応じて決定
  // 通常は 2列（見開き）、幅が狭ければ 1列
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
  // 基本スケールを少し小さめ（80%）にする
  const scale = baseScale * 0.8;

  // 総段数と1ページあたりの段数
  const totalSystems = 12;
  const systemsPerPage = 9;  // 1ページあたりの段数

  // ページの配列を生成
  const pages: PageSpec[] = useMemo(() => {
    return Array.from(
      { length: Math.ceil(totalSystems / systemsPerPage) },
      () => ({ systems: systemsPerPage })
    );
  }, [totalSystems, systemsPerPage]);

  // ==== 表示するページを決める ====
  // （ここを「高さ判定」→「幅判定」に修正！）
  const [visiblePages, setVisiblePages] = useState<PageSpec[]>(pages);
  useEffect(() => {
    const updateVisiblePages = () => {
      const vw = window.innerWidth;                       // ウィンドウ幅
      const pagePixelWidth = 210 * scale * 3.78;          // A4 横(mm) → px換算
      if (pagePixelWidth * 2 > vw) {
        // 横に2枚並べると入らない場合 → 1ページだけ表示
        setVisiblePages(pages.slice(0, 1));
      } else {
        // 入るなら見開き表示
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

      {/* 譜面プレビュー部分 */}
      <div className="paper-rail">
        <div
          className="spread"
          ref={spreadRef}
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
                {/* ページ上部のタイトル */}
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

                {/* 五線譜エリア */}
                <div className="score-area">
                  <StaffCanvas
                    systems={p.systems}
                    measuresPerSystem={4}
                    tool={tool}
                  />
                </div>

                {/* ページ番号 */}
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
