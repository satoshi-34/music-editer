// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ・ツールバー（Palette）と五線（StaffCanvas / PianoStaff）をまとめる"印刷レイアウト"側
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import PianoStaff from './PianoStaff';
import SaveLoadButtons from './SaveLoadButtons';
import PlaybackControls, { type PlaybackState } from './PlaybackControls';
import PlaybackHighlight from './PlaybackHighlight';
import { useAutoPageScale } from './useAutoPageScale';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { useTempoStorage } from '../hooks/useTempoStorage';
import { defaultSimpleAudioEngine } from '../audio/SimpleAudioEngine';
import { InstrumentType } from '../audio/SoundSource';
import type { MeasureData, PartData, ScoreType } from '../types/storage';

type PageSpec = { systems: number };

const BEATS_PER_MEASURE = 4;

function calculateScoreDuration(scoreData: MeasureData[], bpm: number): number {
  let totalDuration = 0;
  for (const measure of scoreData) {
    if (!measure || !measure.events || measure.events.length === 0) {
      totalDuration += (60 / bpm) * BEATS_PER_MEASURE;
    } else {
      for (const event of measure.events) {
        const durMap: Record<string, number> = {
          '1': 4, '2': 2, '4': 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625
        };
        totalDuration += (durMap[event.dur] || 1) * (60 / bpm);
      }
    }
  }
  return totalDuration;
}

export default function ScorePage() {
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });
  const [scoreType, setScoreType] = useState<ScoreType>('single');
  const [showOffsetPanel, setShowOffsetPanel] = useState(false);

  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  const { saveScore, loadScore, hasStoredData, error, isLoading, isSaving } = useScoreStorage();
  const { tempoSettings, setBPM } = useTempoStorage();

  const [yOffset, setYOffset] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('yOffset') ?? '0');
    return Number.isFinite(v) ? v : 0;
  });
  const handleYOffsetChange = (v: number) => {
    setYOffset(v);
    localStorage.setItem('yOffset', String(v));
  };

  // パートごとのデータ
  const [rightHandData, setRightHandData] = useState<MeasureData[] | undefined>(undefined);
  const [leftHandData, setLeftHandData] = useState<MeasureData[] | undefined>(undefined);

  const [audioEngine] = useState(() => defaultSimpleAudioEngine);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [currentPosition, setCurrentPosition] = useState<{ measureIndex: number; beatPosition: number; noteIndex: number }>({
    measureIndex: 0, beatPosition: 0, noteIndex: 0
  });
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>(InstrumentType.PIANO);

  useEffect(() => {
    console.log('[ScorePage] SimpleAudioEngineが準備されました');
  }, [audioEngine]);

  // スコアタイプ切り替え時に左手データを初期化
  const handleScoreTypeChange = useCallback((newType: ScoreType) => {
    setScoreType(newType);
    if (newType === 'piano' && !leftHandData) {
      setLeftHandData(undefined); // PianoStaff側で空小節として扱われる
    }
  }, [leftHandData]);

  const handlePlay = useCallback(async () => {
    try {
      await audioEngine.initialize();

      const parts: MeasureData[][] = [];
      if (scoreType === 'piano') {
        if (rightHandData && rightHandData.length > 0) parts.push(rightHandData);
        if (leftHandData && leftHandData.length > 0) parts.push(leftHandData);
      } else {
        if (rightHandData && rightHandData.length > 0) parts.push(rightHandData);
      }

      if (parts.length > 0) {
        const partObjs = parts.map(measures => ({ measures }));
        await audioEngine.playParts(partObjs, tempoSettings.bpm);

        const totalDuration = calculateScoreDuration(parts[0], tempoSettings.bpm);
        setPlaybackState('playing');
        setTimeout(() => setPlaybackState('stopped'), totalDuration * 1000);
      } else {
        const frequency = audioEngine.noteToFrequency('C4');
        const duration = audioEngine.durationToSeconds('4', tempoSettings.bpm);
        await audioEngine.playNote(frequency, duration);
        setPlaybackState('playing');
        setTimeout(() => setPlaybackState('stopped'), duration * 1000);
      }
    } catch (error) {
      console.error('[ScorePage] 再生開始に失敗:', error);
      if (error instanceof Error) {
        if (error.message.includes('user gesture') || error.message.includes('not allowed to start') ||
            error.message.includes('user activation') || error.message.includes('ユーザーの操作が必要')) {
          alert('音声を再生するには、再生ボタンをクリックしてください。\nブラウザのセキュリティポリシーにより、ユーザーの操作が必要です。');
        } else {
          alert(`再生エラー: ${error.message}`);
        }
      } else {
        alert('音声の再生に失敗しました。ページを再読み込みしてお試しください。');
      }
    }
  }, [audioEngine, tempoSettings.bpm, rightHandData, leftHandData, scoreType]);

  const handlePause = useCallback(() => {
    setPlaybackState('paused');
  }, []);

  const handleStop = useCallback(() => {
    setPlaybackState('stopped');
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
  }, []);

  const handleSeek = useCallback((position: { measureIndex: number; beatPosition: number; noteIndex: number }) => {
    setCurrentPosition(position);
  }, []);

  const handleTempoChange = useCallback((bpm: number) => {
    setBPM(bpm);
  }, [setBPM]);

  const handleInstrumentChange = useCallback(async (instrumentType: InstrumentType) => {
    setCurrentInstrument(instrumentType);
  }, []);

  const handleInstrumentPreview = useCallback(async () => {
    try {
      await audioEngine.initialize();
      const frequency = audioEngine.noteToFrequency('C4');
      await audioEngine.playNote(frequency, 0.5);
    } catch (error) {
      console.error('[ScorePage] 音色プレビューに失敗:', error);
    }
  }, [audioEngine]);

  const isEditingDisabled = playbackState === 'playing';

  const handleRightHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setRightHandData(prev => {
      if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
      return data;
    });
  }, [isEditingDisabled]);

  const handleLeftHandChange = useCallback((data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setLeftHandData(prev => {
      if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
      return data;
    });
  }, [isEditingDisabled]);

  // 単旋律モード用（後方互換）
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    handleRightHandChange(data);
  }, [handleRightHandChange]);

  const handleSave = async () => {
    const metadata = { title, subtitle, lyricist, composer, arranger };

    const parts: PartData[] = scoreType === 'piano'
      ? [
          { partId: 'right-hand', clef: 'treble', measures: rightHandData ?? [{ events: [] }] },
          { partId: 'left-hand',  clef: 'bass',   measures: leftHandData  ?? [{ events: [] }] },
        ]
      : [
          { partId: 'melody', clef: 'treble', measures: rightHandData ?? [{ events: [] }] },
        ];

    await saveScore(metadata, parts, totalSystems, 4, scoreType);
  };

  const handleLoad = async () => {
    const loadedData = await loadScore();
    if (loadedData) {
      setTitle(loadedData.metadata.title);
      setSubtitle(loadedData.metadata.subtitle);
      setLyricist(loadedData.metadata.lyricist);
      setComposer(loadedData.metadata.composer);
      setArranger(loadedData.metadata.arranger);

      setScoreType(loadedData.scoreType ?? 'single');

      const rightPart = loadedData.parts.find(p => p.clef === 'treble') ?? loadedData.parts[0];
      const leftPart  = loadedData.parts.find(p => p.clef === 'bass');

      setRightHandData(rightPart?.measures ?? []);
      setLeftHandData(leftPart?.measures);
    }
  };

  const [columns, setColumns] = useState(window.innerWidth < 1200 ? 1 : 2);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setColumns(window.innerWidth < 1200 ? 1 : 2), 150);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(timer); };
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

  useEffect(() => {
    return () => { audioEngine.dispose(); };
  }, [audioEngine]);

  return (
    <div className="app-root">
      <header className="toolbar">
        <div className="controls">
          <Palette value={tool} onChange={setTool} />

          {/* スコアタイプ切り替え */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '0 8px' }}>
            <button
              className={scoreType === 'single' ? 'ghost' : 'ghost'}
              onClick={() => handleScoreTypeChange('single')}
              style={{
                border: scoreType === 'single' ? '2px solid #3b82f6' : '1px solid #ccc',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: scoreType === 'single' ? '#eff6ff' : '#fff',
              }}
              title="単旋律譜"
            >
              単旋律
            </button>
            <button
              className="ghost"
              onClick={() => handleScoreTypeChange('piano')}
              style={{
                border: scoreType === 'piano' ? '2px solid #3b82f6' : '1px solid #ccc',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: scoreType === 'piano' ? '#eff6ff' : '#fff',
              }}
              title="ピアノ大譜表（右手＋左手）"
            >
              ピアノ
            </button>
          </div>

          <PlaybackControls
            playbackState={playbackState}
            currentPosition={currentPosition}
            currentTempo={tempoSettings.bpm}
            currentInstrument={currentInstrument}
            availableInstruments={Object.values(InstrumentType)}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onSeek={handleSeek}
            onTempoChange={handleTempoChange}
            onInstrumentChange={handleInstrumentChange}
            onInstrumentPreview={handleInstrumentPreview}
          />
          <SaveLoadButtons
            onSave={handleSave}
            onLoad={handleLoad}
            isSaving={isSaving}
            isLoading={isLoading}
            hasStoredData={hasStoredData()}
            error={error}
          />
          <button className="ghost" onClick={() => window.print()}>印刷</button>
          <div className="coord-correction-wrap">
            <button
              type="button"
              className="ghost"
              onClick={() => setShowOffsetPanel(v => !v)}
              title="音符配置位置の座標補正"
            >
              Y補正{yOffset !== 0 ? ` (${yOffset})` : ''}
            </button>
            {showOffsetPanel && (
              <>
                <div className="dropdown-overlay" onClick={() => setShowOffsetPanel(false)} />
                <div className="coord-panel">
                  <p className="coord-panel-note">高音方向はマイナス、低音方向はプラス</p>
                  <div className="coord-panel-row">
                    <button type="button" className="ghost y-offset-btn" onClick={() => handleYOffsetChange(yOffset - 1)}>↑</button>
                    <input
                      id="y-offset-input"
                      type="number"
                      value={yOffset}
                      onChange={e => handleYOffsetChange(Number(e.target.value))}
                      aria-label="座標補正値（↓で低音方向）"
                      onKeyDown={e => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); handleYOffsetChange(yOffset + 1); }
                        if (e.key === 'ArrowUp')   { e.preventDefault(); handleYOffsetChange(yOffset - 1); }
                      }}
                      autoFocus
                    />
                    <button type="button" className="ghost y-offset-btn" onClick={() => handleYOffsetChange(yOffset + 1)}>↓</button>
                    {yOffset !== 0 && (
                      <button type="button" className="ghost y-offset-reset" onClick={() => handleYOffsetChange(0)}>リセット</button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="paper-rail">
        <div
          className="spread"
          ref={spreadRef}
          style={{ '--scale': String(scale), '--columns': String(columns) } as React.CSSProperties}
        >
          {visiblePages.map((p, i) => (
            <div className="page-wrapper" key={i}>
              <section className="print-page">
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
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setLyricist(e.currentTarget.innerText)}>{lyricist}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setComposer(e.currentTarget.innerText)}>{composer}</div>
                        <div contentEditable suppressContentEditableWarning onBlur={(e) => setArranger(e.currentTarget.innerText)}>{arranger}</div>
                      </div>
                    </>
                  ) : (
                    <p className="page-title">{title}</p>
                  )}
                </header>

                <div className="score-area">
                  {scoreType === 'piano' ? (
                    <PianoStaff
                      systems={p.systems}
                      gap={110}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      rightHandData={rightHandData}
                      leftHandData={leftHandData}
                      onRightHandChange={handleRightHandChange}
                      onLeftHandChange={handleLeftHandChange}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                    />
                  ) : (
                    <StaffCanvas
                      systems={p.systems}
                      gap={110}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      clef="treble"
                      initialScoreData={rightHandData}
                      onScoreDataChange={handleScoreDataChange}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                    />
                  )}

                  <PlaybackHighlight
                    currentPosition={currentPosition}
                    isPlaying={playbackState === 'playing'}
                    containerSelector=".score-area"
                    enablePageScroll={true}
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
