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
import PlaybackControls, { type PlaybackState } from './PlaybackControls';
import PlaybackHighlight from './PlaybackHighlight';
import { useAutoPageScale } from './useAutoPageScale';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { useTempoStorage } from '../hooks/useTempoStorage';
import { defaultSimpleAudioEngine } from '../audio/SimpleAudioEngine';
import { InstrumentType } from '../audio/SoundSource';
import type { MeasureData } from '../types/storage';

type PageSpec = { systems: number };

// 譜面の総再生時間を計算するヘルパー関数
function calculateScoreDuration(scoreData: MeasureData[], bpm: number): number {
  let totalDuration = 0;
  
  for (const measure of scoreData) {
    if (!measure || !measure.events || measure.events.length === 0) {
      // 空の小節は全休符として扱う（4拍）
      totalDuration += (60 / bpm) * 4;
    } else {
      // 各音符の時間を合計
      for (const event of measure.events) {
        const durMap: Record<string, number> = {
          '1': 4,     // 全音符
          '2': 2,     // 2分音符
          '4': 1,     // 4分音符
          '8': 0.5,   // 8分音符
          '16': 0.25, // 16分音符
          '32': 0.125,// 32分音符
          '64': 0.0625// 64分音符
        };
        const beats = durMap[event.dur] || 1;
        const secondsPerBeat = 60 / bpm;
        totalDuration += beats * secondsPerBeat;
      }
    }
  }
  
  return totalDuration;
}

export default function ScorePage() {
  const [tool, setTool] = useState<Tool>({ duration: '4', isRest: false });

  const [title, setTitle] = useState('タイトル');
  const [subtitle, setSubtitle] = useState('サブタイトル');
  const [lyricist, setLyricist] = useState('作詞者');
  const [composer, setComposer] = useState('作曲者');
  const [arranger, setArranger] = useState('編曲者');

  // Initialize storage hooks
  const {
    saveScore,
    loadScore,
    hasStoredData,
    error,
    isLoading,
    isSaving
  } = useScoreStorage();

  const { tempoSettings, setBPM } = useTempoStorage();

  // State for managing score data from StaffCanvas
  const [scoreData, setScoreData] = useState<MeasureData[] | undefined>(undefined);

  // 音声エンジンの初期化
  const [audioEngine] = useState(() => defaultSimpleAudioEngine);

  // 再生状態の管理
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [currentPosition, setCurrentPosition] = useState<{ measureIndex: number; beatPosition: number; noteIndex: number }>({
    measureIndex: 0,
    beatPosition: 0,
    noteIndex: 0
  });
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>(InstrumentType.PIANO);

  // 音声エンジンの初期化
  useEffect(() => {
    console.log('[ScorePage] SimpleAudioEngineが準備されました（AudioContextはユーザーインタラクション時に作成）');
  }, [audioEngine]);

  // PlaybackControlsのイベントハンドラー
  const handlePlay = useCallback(async () => {
    try {
      console.log('[ScorePage] 再生開始処理');
      
      // AudioContextをユーザーインタラクション時に初期化
      console.log('[ScorePage] AudioContextを初期化中...');
      await audioEngine.initialize();
      console.log('[ScorePage] AudioContext初期化完了');

      // 実際の譜面データがある場合はそれを再生、なければテスト音符を再生
      if (scoreData && scoreData.length > 0) {
        console.log('[ScorePage] 譜面データを再生中...', scoreData.length, '小節');
        await audioEngine.playScore(scoreData, tempoSettings.bpm);
        console.log('[ScorePage] 譜面再生完了');
        
        // 再生時間を計算して状態を管理
        const totalDuration = calculateScoreDuration(scoreData, tempoSettings.bpm);
        setPlaybackState('playing');
        
        // 再生完了後に停止状態に戻す
        setTimeout(() => {
          setPlaybackState('stopped');
          console.log('[ScorePage] 再生完了');
        }, totalDuration * 1000);
        
      } else {
        // 譜面データがない場合はテスト音符を再生
        console.log('[ScorePage] テスト音符を再生中...');
        const frequency = audioEngine.noteToFrequency('C4');
        const duration = audioEngine.durationToSeconds('4', tempoSettings.bpm);
        
        await audioEngine.playNote(frequency, duration);
        console.log('[ScorePage] テスト音符再生完了');
        
        setPlaybackState('playing');
        
        // 簡単な再生完了シミュレーション
        setTimeout(() => {
          setPlaybackState('stopped');
          console.log('[ScorePage] 再生完了');
        }, duration * 1000);
      }
      
    } catch (error) {
      console.error('[ScorePage] 再生開始に失敗:', error);
      
      // ユーザーに分かりやすいエラーメッセージを表示
      if (error instanceof Error) {
        if (error.message.includes('user gesture') || 
            error.message.includes('not allowed to start') ||
            error.message.includes('user activation') ||
            error.message.includes('ユーザーの操作が必要')) {
          alert('音声を再生するには、再生ボタンをクリックしてください。\nブラウザのセキュリティポリシーにより、ユーザーの操作が必要です。');
        } else {
          alert(`再生エラー: ${error.message}`);
        }
      } else {
        alert('音声の再生に失敗しました。ページを再読み込みしてお試しください。');
      }
    }
  }, [audioEngine, tempoSettings.bpm, scoreData]);

  const handlePause = useCallback(() => {
    setPlaybackState('paused');
    console.log('[ScorePage] 再生を一時停止しました');
  }, []);

  const handleStop = useCallback(() => {
    setPlaybackState('stopped');
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    console.log('[ScorePage] 再生を停止しました');
  }, []);

  const handleSeek = useCallback((position: { measureIndex: number; beatPosition: number; noteIndex: number }) => {
    setCurrentPosition(position);
    console.log('[ScorePage] 再生位置を変更しました:', position);
  }, []);

  const handleTempoChange = useCallback((bpm: number) => {
    setBPM(bpm);
    console.log('[ScorePage] テンポを変更しました:', bpm);
  }, [setBPM]);

  const handleInstrumentChange = useCallback(async (instrumentType: InstrumentType) => {
    setCurrentInstrument(instrumentType);
    console.log('[ScorePage] 楽器を変更しました:', instrumentType);
  }, []);

  const handleInstrumentPreview = useCallback(async () => {
    try {
      console.log('[ScorePage] 音色プレビューを開始');
      
      // AudioContextをユーザーインタラクション時に初期化
      console.log('[ScorePage] AudioContextを初期化中...');
      await audioEngine.initialize();
      console.log('[ScorePage] AudioContext初期化完了');
      
      // 譜面データから最初の音符を取得してプレビュー、なければC4を使用
      let previewNote = 'C4';
      if (scoreData && scoreData.length > 0) {
        for (const measure of scoreData) {
          if (measure && measure.events && measure.events.length > 0) {
            const firstNote = measure.events.find(event => !event.isRest);
            if (firstNote) {
              previewNote = firstNote.key;
              break;
            }
          }
        }
      }
      
      const frequency = audioEngine.noteToFrequency(previewNote);
      const duration = 0.5; // 0.5秒
      
      console.log('[ScorePage] プレビュー音符を再生中:', previewNote);
      await audioEngine.playNote(frequency, duration);
      console.log('[ScorePage] 音色プレビュー完了');
      
    } catch (error) {
      console.error('[ScorePage] 音色プレビューに失敗:', error);
      
      // ユーザーに分かりやすいエラーメッセージを表示
      if (error instanceof Error) {
        if (error.message.includes('user gesture') || 
            error.message.includes('not allowed to start') ||
            error.message.includes('user activation') ||
            error.message.includes('ユーザーの操作が必要')) {
          alert('音声を再生するには、スピーカーボタンをクリックしてください。\nブラウザのセキュリティポリシーにより、ユーザーの操作が必要です。');
        } else {
          alert(`音色プレビューエラー: ${error.message}`);
        }
      } else {
        alert('音色プレビューに失敗しました。ページを再読み込みしてお試しください。');
      }
    }
  }, [audioEngine, scoreData]);

  // 再生中の譜面編集制限
  const isEditingDisabled = playbackState === 'playing';
  // Memoize the callback to prevent infinite loops
  const handleScoreDataChange = useCallback((data: MeasureData[]) => {
    // 再生中は譜面編集を制限
    if (isEditingDisabled) {
      console.warn('[ScorePage] 再生中は譜面編集できません');
      return;
    }

    setScoreData(prevData => {
      // データが同じ場合は更新しない（深い比較）
      if (prevData && JSON.stringify(prevData) === JSON.stringify(data)) {
        return prevData;
      }
      return data;
    });
  }, [isEditingDisabled]);

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

  // コンポーネントのクリーンアップ
  useEffect(() => {
    return () => {
      // コンポーネントがアンマウントされる際にリソースを解放
      audioEngine.dispose();
    };
  }, [audioEngine]);

  return (
    <div className="app-root">
      {/* ツールバー */}
      <header className="toolbar">
        <div className="controls">
          <Palette value={tool} onChange={setTool} />
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
                    disabled={isEditingDisabled}
                  />
                  
                  {/* 再生位置ハイライト */}
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
