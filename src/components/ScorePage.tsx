// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ツールバー（Palette）＋五線（StaffCanvas）を「印刷レイアウト」で表示。
// ✅ 追加ポイント：ヘッダーの実高さを測って CSS 変数 --toolbar-h に反映。
//    → 本文側（.app-root）に余白がつき、ヘッダーが譜面に重ならなくなる。
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import { useAutoPageScale } from './useAutoPageScale';

type PageSpec = { systems: number };

export default function ScorePage() {
  // どの音符ツールを選択しているか（Palette の選択状態）
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });

  // タイトル等（1ページ目のみ大きめ表示）
  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  // 2ページ並べるか1ページにするか（画面幅で切り替え）
  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    const onResize = () => setColumns(window.innerWidth < 1200 ? 1 : 2);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A4見開きの自動スケール
  const { spreadRef, scale } = useAutoPageScale(columns, 20);

  // ページ分割（仮：1ページに9段表示）
  const totalSystems = 12;
  const systemsPerPage = 9;
  const pages: PageSpec[] = useMemo(
    () => Array.from({ length: Math.ceil(totalSystems / systemsPerPage) }, () => ({ systems: systemsPerPage })),
    [totalSystems, systemsPerPage]
  );

  // 画面幅に応じて片面/見開きを出し分け
  const [visiblePages, setVisiblePages] = useState<PageSpec[]>(pages);
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const pagePixelWidth = 210 * 3.78 * scale; // 210mm ≒ 3.78px/mm
      setVisiblePages(pagePixelWidth * 2 > vw ? pages.slice(0, 1) : pages);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pages, scale]);

  // ─────────────────────────────────────────────────────────
  // ✅ 追加：ヘッダー実高さを測ってCSS変数に入れる
  //   - ヘッダーは position: fixed なので、本文側でその高さ分の
  //     余白（padding-top）を付けないと「重なり」が起きます。
  //   - --toolbar-h を documentElement にセット → CSS 側で利用。
  // ─────────────────────────────────────────────────────────
  const toolbarRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const applyToolbarHeight = () => {
      const h = toolbarRef.current?.offsetHeight ?? 72; // デフォルト72px
      document.documentElement.style.setProperty('--toolbar-h', `${h}px`);
    };
    applyToolbarHeight();
    window.addEventListener('resize', applyToolbarHeight);
    return () => window.removeEventListener('resize', applyToolbarHeight);
  }, []);

  return (
    <div className="app-root">
      {/* ツールバー（ヘッダー） */}
      <header className="toolbar" ref={toolbarRef as any}>
        <div className="controls">
          {/* 楽譜用のツールパレット（音符/休符アイコン） */}
          <Palette value={tool} onChange={setTool} />
          <button className="ghost" onClick={() => window.print()}>印刷</button>
        </div>
      </header>

      {/* 譜面プレビュー（固定ヘッダーの下に来る） */}
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
                  <StaffCanvas systems={p.systems} gap={110} tool={tool} scale={scale} />
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
