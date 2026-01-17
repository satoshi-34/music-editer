// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ・ツールバー（Palette）と五線（StaffCanvas）をまとめる“印刷レイアウト”側
// ・App からは ScorePage だけをレンダリング（重複描画を防ぐ）
// ・scale は CSS 変数として見た目にだけ使う（StaffCanvas は親幅で描く）
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import SaveLoadButtons from './SaveLoadButtons';
import { useAutoPageScale } from './useAutoPageScale';
import { useScoreStorage } from '../hooks/useScoreStorage';
import type { MeasureData } from '../types/storage';

type PageSpec = { systems: number };

export default function ScorePage() {
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });

  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  // Initialize storage hook
  const {
    saveScore,
    loadScore,
    hasStoredData,
    error,
    isLoading,
    isSaving
  } = useScoreStorage();

  // State for managing score data from StaffCanvas
  const [scoreData, setScoreData] = useState<MeasureData[] | undefined>(undefined);

  // Memoize the callback to prevent infinite loops
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    setScoreData(prevData => {
      // データが同じ場合は更新しない（深い比較）
      if (prevData && JSON.stringify(prevData) === JSON.stringify(data)) {
        return prevData;
      }
      return data;
    });
  }, []);

  // Handle save operation
  const handleSave = async () => {
    const metadata = {
      title,
      subtitle,
      lyricist,
      composer,
      arranger
    };

    // Use actual score data from StaffCanvas if available, otherwise use empty measures
    const measures = scoreData && scoreData.length > 0 ? scoreData : [{ events: [] }];
    const systems = totalSystems;
    const measuresPerSystem = 4;

    await saveScore(metadata, measures, systems, measuresPerSystem);
  };

  // Handle load operation
  const handleLoad = async () => {
    const loadedData = await loadScore();
    if (loadedData) {
      // Restore metadata to UI state
      setTitle(loadedData.metadata.title);
      setSubtitle(loadedData.metadata.subtitle);
      setLyricist(loadedData.metadata.lyricist);
      setComposer(loadedData.metadata.composer);
      setArranger(loadedData.metadata.arranger);
      
      // Restore measure data to score state
      setScoreData(loadedData.measures);
    }
  };

  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    const onResize = () => setColumns(window.innerWidth < 1200 ? 1 : 2);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const { spreadRef, scale } = useAutoPageScale(columns, 20);

  const totalSystems = 12;
  const systemsPerPage = 9;
  const pages: PageSpec[] = useMemo(
    () => Array.from({ length: Math.ceil(totalSystems / systemsPerPage) }, () => ({ systems: systemsPerPage })),
    [totalSystems, systemsPerPage]
  );

  const [visiblePages, setVisiblePages] = useState<PageSpec[]>(pages);
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const pagePixelWidth = 210 * 3.78 * scale;
      setVisiblePages(pagePixelWidth * 2 > vw ? pages.slice(0, 1) : pages);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pages, scale]);

  return (
    <div className="app-root">
      {/* ツールバー */}
      <header className="toolbar">
        <div className="controls">
          <Palette value={tool} onChange={setTool} />
          <SaveLoadButtons
            onSave={handleSave}
            onLoad={handleLoad}
            isSaving={isSaving}
            isLoading={isLoading}
            hasStoredData={hasStoredData()}
            error={error}
          />
          <button className="ghost" onClick={() => window.print()}>印刷</button>
        </div>
      </header>

      {/* 譜面プレビュー */}
      <div className="paper-rail">
        <div
          className="spread"
          ref={spreadRef}
          style={{ '--scale': String(scale), '--columns': String(columns) } as React.CSSProperties}
        >
          {visiblePages.map((p, i) => (
            <div className="page-wrapper" key={i}>
              <section className="print-page">
                {/* タイトル等（1ページ目だけ大きめ） */}
                <header className="page-head" style={{ position: 'relative' }}>
                  {i === 0 ? (
                    <>
                      <h1
                        className="score-title"
                        contentEditable suppressContentEditableWarning
                        onBlur={(e) => setTitle(e.currentTarget.innerText)}
                      >
                        {title}
                      </h1>
                      <p
                        className="score-subtitle"
                        contentEditable suppressContentEditableWarning
                        onBlur={(e) => setSubtitle(e.currentTarget.innerText)}
                      >
                        {subtitle}
                      </p>
                      <div style={{ position: 'absolute', top: 0, right: 0, textAlign: 'right', fontSize: 14, color: '#555' }}>
                        <div contentEditable suppressContentEditableWarning onBlur={(e)=>setLyricist(e.currentTarget.innerText)}>{lyricist}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e)=>setComposer(e.currentTarget.innerText)}>{composer}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e)=>setArranger(e.currentTarget.innerText)}>{arranger}</div>
                      </div>
                    </>
                  ) : (
                    <p className="page-title">{title}</p>
                  )}
                </header>

                {/* 五線エリア */}
                <div className="score-area">
                  <StaffCanvas 
                    systems={p.systems} 
                    gap={110}
                    measuresPerSystem={4}
                    tool={tool} 
                    scale={scale}
                    initialScoreData={scoreData}
                    onScoreDataChange={handleScoreDataChange}
                    startMeasureIndex={i * systemsPerPage * 4}
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
