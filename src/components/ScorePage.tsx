// src/ScorePage.tsx
import { useEffect, useMemo, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import { useAutoPageScale } from '../components/useAutoPageScale';

type PageSpec = { systems: number };

export default function ScorePage() {
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });

  // タイトル・サブタイトル
  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');

  // 作詞作曲編曲
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  // 列数制御
  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    const onResize = () => {
      setColumns(window.innerWidth < 1200 ? 1 : 2);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ページスケール
  const { spreadRef, scale: baseScale } = useAutoPageScale(columns, 20);
  const scale = baseScale * 1;//クリックした位置と描画位置のずれの原因？
  console.log('baseScale:', baseScale);
  console.log('scale:', scale);

  // ページ分割
  const totalSystems = 12;
  const systemsPerPage = 9;
  const pages: PageSpec[] = useMemo(() => {
    return Array.from(
      { length: Math.ceil(totalSystems / systemsPerPage) },
      () => ({ systems: systemsPerPage })
    );
  }, [totalSystems, systemsPerPage]);

  // 横幅判定
  const [visiblePages, setVisiblePages] = useState<PageSpec[]>(pages);
  useEffect(() => {
    const updateVisiblePages = () => {
      const vw = window.innerWidth;
      const pagePixelWidth = 210 * scale * 3.78;
      if (pagePixelWidth * 2 > vw) {
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
                {/* ページ上部 */}
                <header className="page-head" style={{ position: 'relative' }}>
                  {i === 0 ? (
                    <>
                      {/* 中央タイトル */}
                      <h1
                        className="score-title"
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => setTitle(e.currentTarget.innerText)}
                      >
                        {title}
                      </h1>
                      <p
                        className="score-subtitle"
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => setSubtitle(e.currentTarget.innerText)}
                      >
                        {subtitle}
                      </p>

                      {/* 右上 作詞作曲編曲 */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          textAlign: 'right',
                          fontSize: '14px',
                          color: '#555',
                          lineHeight: 1.4,
                        }}
                      >
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => setLyricist(e.currentTarget.innerText)}
                        >
                          {lyricist}
                        </div>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => setComposer(e.currentTarget.innerText)}
                        >
                          {composer}
                        </div>
                        <div
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => setArranger(e.currentTarget.innerText)}
                        >
                          {arranger}
                        </div>
                      </div>
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
                    scale={scale}
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
