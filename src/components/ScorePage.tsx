// src/components/ScorePage.tsx
// ─────────────────────────────────────────────────────────────
// ・ツールバー（Palette）と五線（StaffCanvas / PianoStaff）をまとめる"印刷レイアウト"側
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Palette, { type Tool } from './Palette';
import StaffCanvas from './StaffCanvas';
import PianoStaff from './PianoStaff';
import QuartetStaff from './QuartetStaff';
import SaveLoadButtons from './SaveLoadButtons';
import PlaybackControls, { type PlaybackState } from './PlaybackControls';
import PlaybackHighlight from './PlaybackHighlight';
import { useAutoPageScale } from './useAutoPageScale';
import { useScoreStorage } from '../hooks/useScoreStorage';
import { useTempoStorage } from '../hooks/useTempoStorage';
import { SimpleAudioEngine } from '../audio/SimpleAudioEngine';
import { InstrumentType } from '../audio/SoundSource';
import type { MeasureData, PartData, ScoreType } from '../types/storage';

type PageSpec = { systems: number };

const BEATS_PER_MEASURE = 4;

function calculateScoreDuration(scoreData: MeasureData[], bpm: number): number {
  // 末尾の空小節は実際には再生対象がないため、終了タイマーには含めない。
  // 途中の空小節は「全休符の小節」として長さを保持する。
  let lastUsedMeasureIndex = -1;
  for (let i = scoreData.length - 1; i >= 0; i--) {
    const measure = scoreData[i];
    if (measure?.events && measure.events.length > 0) {
      lastUsedMeasureIndex = i;
      break;
    }
  }

  if (lastUsedMeasureIndex === -1) {
    return 0;
  }

  let totalDuration = 0;
  for (let i = 0; i <= lastUsedMeasureIndex; i++) {
    const measure = scoreData[i];
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
  const [quartetParts, setQuartetParts] = useState<MeasureData[][]>(
    () => Array.from({ length: 4 }, () => [])
  );

  const audioEngineRef = useRef<SimpleAudioEngine>(new SimpleAudioEngine());
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [currentPosition, setCurrentPosition] = useState<{ measureIndex: number; beatPosition: number; noteIndex: number }>({
    measureIndex: 0, beatPosition: 0, noteIndex: 0
  });
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>(InstrumentType.PIANO);
  // soundRuntimeSettings は「どの音源方式で、どんなキャラの音にするか」の保存用状態。
  // いきなりシンセの専門用語を見せず、まずはエンドユーザーが触りやすい値にしている。
  const [soundRuntimeSettings, setSoundRuntimeSettings] = useState<PlaybackSoundRuntimeSettings>(() => {
    try {
      const stored = localStorage.getItem('playback-sound-runtime-settings');
      if (!stored) {
        return DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS;
      }

      const parsed = JSON.parse(stored) as Partial<PlaybackSoundRuntimeSettings>;
      return {
        engineMode: parsed.engineMode ?? DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.engineMode,
        pluginName: parsed.pluginName ?? DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.pluginName,
        profile: {
          ...DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS.profile,
          ...(parsed.profile ?? {})
        }
      };
    } catch {
      return DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS;
    }
  });
  // playbackTimerRef は「再生が終わったら stopped に戻す予約」を保持する。
  // 再生し直しや停止時に clearTimeout できるよう、ref で持っている。
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 一時停止から再開するため、「いつ再生を始めたか」を覚えておく。
  const playbackStartedAtRef = useRef<number | null>(null);
  // 一時停止時点で「あと何ミリ秒残っているか」を覚えておく。
  const remainingPlaybackMsRef = useRef<number>(0);

  useEffect(() => {
    console.log('[ScorePage] SimpleAudioEngineが準備されました');
  }, []);

  const getAudioEngine = useCallback(() => {
    return audioEngineRef.current;
  }, []);

  const recreateAudioEngine = useCallback(() => {
    // Safari では同じインスタンスを使い回すより、
    // 新しい音声エンジンへ差し替えたほうが安定することがある。
    audioEngineRef.current.dispose();
    audioEngineRef.current = new SimpleAudioEngine();
    audioEngineRef.current.setInstrument(currentInstrument);
    audioEngineRef.current.setSoundProfile(soundRuntimeSettings.profile);
    return audioEngineRef.current;
  }, [currentInstrument, soundRuntimeSettings.profile]);

  useEffect(() => {
    // UI で動かした音のキャラ設定を保存しつつ、今のエンジンにも即反映する。
    // こうしておくと、次回起動時も同じ音色傾向から作業を再開できる。
    localStorage.setItem('playback-sound-runtime-settings', JSON.stringify(soundRuntimeSettings));
    getAudioEngine().setSoundProfile(soundRuntimeSettings.profile);
  }, [getAudioEngine, soundRuntimeSettings]);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const resetPlaybackClock = useCallback(() => {
    playbackStartedAtRef.current = null;
    remainingPlaybackMsRef.current = 0;
  }, []);

  const armPlaybackCompletionTimer = useCallback((durationMs: number) => {
    // 毎回タイマーを張り直す前に、古い予約を消して二重実行を防ぐ。
    clearPlaybackTimer();
    remainingPlaybackMsRef.current = Math.max(0, durationMs);
    playbackStartedAtRef.current = Date.now();
    playbackTimerRef.current = setTimeout(() => {
      setPlaybackState('stopped');
      setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
      playbackTimerRef.current = null;
      resetPlaybackClock();
    }, durationMs);
  }, [clearPlaybackTimer, resetPlaybackClock]);

  // スコアタイプ切り替え時に左手データを初期化
  const handleScoreTypeChange = useCallback((newType: ScoreType) => {
    setScoreType(newType);
    if (newType === 'piano' && !leftHandData) {
      setLeftHandData(undefined);
    }
    if (newType === 'quartet') {
      setQuartetParts(prev => prev.every(p => p.length === 0)
        ? Array.from({ length: 4 }, () => [])
        : prev
      );
    }
  }, [leftHandData]);

  const handlePlay = useCallback(async () => {
    try {
      if (playbackState === 'paused') {
        // paused からの再生は「最初から」ではなく AudioContext の resume。
        await getAudioEngine().resume();
        setPlaybackState('playing');
        armPlaybackCompletionTimer(remainingPlaybackMsRef.current);
        return;
      }

      // 連続再生時に前回の停止予約が残ると UI だけ先に stopped に戻るため、先に解除する
      clearPlaybackTimer();
      resetPlaybackClock();
      // Safari では見かけ上 running の古い AudioContext が無音になることがある。
      // ユーザー操作で始まる再生は毎回まったく新しいエンジンへ差し替える。
      const audioEngine = recreateAudioEngine();
      await audioEngine.initialize();

      const parts: MeasureData[][] = [];
      if (scoreType === 'quartet') {
        quartetParts.forEach(part => { if (part && part.length > 0) parts.push(part); });
      } else if (scoreType === 'piano') {
        if (rightHandData && rightHandData.length > 0) parts.push(rightHandData);
        if (leftHandData && leftHandData.length > 0) parts.push(leftHandData);
      } else {
        if (rightHandData && rightHandData.length > 0) parts.push(rightHandData);
      }

      if (parts.length > 0) {
        const partObjs = parts.map(measures => ({ measures }));
        await audioEngine.playParts(partObjs, tempoSettings.bpm);

        // 複数パートでは、一番長いパートが終わるまで再生状態を保つ必要がある。
        const totalDuration = Math.max(...parts.map(part => calculateScoreDuration(part, tempoSettings.bpm)));
        setPlaybackState('playing');
        armPlaybackCompletionTimer(totalDuration * 1000);
      } else {
        const frequency = audioEngine.noteToFrequency('C4');
        const duration = audioEngine.durationToSeconds('4', tempoSettings.bpm);
        await audioEngine.playNote(frequency, duration);
        setPlaybackState('playing');
        armPlaybackCompletionTimer(duration * 1000);
      }
    } catch (error: unknown) {
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
  }, [armPlaybackCompletionTimer, clearPlaybackTimer, getAudioEngine, playbackState, recreateAudioEngine, resetPlaybackClock, tempoSettings.bpm, rightHandData, leftHandData, quartetParts, scoreType]);

  const handlePause = useCallback(async () => {
    if (playbackState !== 'playing') {
      return;
    }

    const startedAt = playbackStartedAtRef.current;
    if (startedAt !== null) {
      // 一時停止は「残り時間の保存」が大事。
      // ここで経過時間を引いておくと、再開時に最後までの残りだけ待てる。
      const elapsedMs = Date.now() - startedAt;
      remainingPlaybackMsRef.current = Math.max(0, remainingPlaybackMsRef.current - elapsedMs);
    }

    clearPlaybackTimer();
    playbackStartedAtRef.current = null;
    await getAudioEngine().suspend();
    setPlaybackState('paused');
  }, [clearPlaybackTimer, getAudioEngine, playbackState]);

  const handleStop = useCallback(() => {
    clearPlaybackTimer();
    getAudioEngine().stopAll();
    setPlaybackState('stopped');
    setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    resetPlaybackClock();
  }, [clearPlaybackTimer, getAudioEngine, resetPlaybackClock]);

  const handleSeek = useCallback((position: { measureIndex: number; beatPosition: number; noteIndex: number }) => {
    setCurrentPosition(position);
  }, []);

  const handleTempoChange = useCallback((bpm: number) => {
    setBPM(bpm);
  }, [setBPM]);

  const handleInstrumentChange = useCallback(async (instrumentType: InstrumentType) => {
    setCurrentInstrument(instrumentType);
    // UI の表示だけ変えても音は変わらないため、音声エンジン側にも同じ値を渡す。
    getAudioEngine().setInstrument(instrumentType);
  }, [getAudioEngine]);

  const handleInstrumentPreview = useCallback(async () => {
    try {
      // 音色プレビューも毎回新しい音声エンジンへ差し替えて、
      // Safari の「古い context だけ無音」を避ける。
      const audioEngine = recreateAudioEngine();
      await audioEngine.initialize();
      const frequency = audioEngine.noteToFrequency('C4');
      await audioEngine.playNote(frequency, 0.5);
    } catch (error) {
      console.error('[ScorePage] 音色プレビューに失敗:', error);
    }
  }, [recreateAudioEngine]);

  const handleSoundEngineModeChange = useCallback((mode: SoundEngineMode) => {
    setSoundRuntimeSettings(prev => ({ ...prev, engineMode: mode }));
  }, []);

  const handlePluginNameChange = useCallback((pluginName: string) => {
    setSoundRuntimeSettings(prev => ({ ...prev, pluginName }));
  }, []);

  const handleSoundProfileChange = useCallback((profile: PlaybackSoundRuntimeSettings['profile']) => {
    setSoundRuntimeSettings(prev => ({ ...prev, profile }));
  }, []);

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

  const handleQuartetPartChange = useCallback((partIndex: number) => (data: MeasureData[]) => {
    if (isEditingDisabled) return;
    setQuartetParts(prev => {
      const next = [...prev];
      if (JSON.stringify(next[partIndex]) === JSON.stringify(data)) return prev;
      next[partIndex] = data;
      return next;
    });
  }, [isEditingDisabled]);

  const handleSave = async () => {
    const metadata = { title, subtitle, lyricist, composer, arranger };

    const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'] as const;
    const QUARTET_CLEFS: PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
    const parts: PartData[] = scoreType === 'quartet'
      ? QUARTET_IDS.map((id, i) => ({
          partId: id,
          clef: QUARTET_CLEFS[i],
          measures: quartetParts[i] ?? [{ events: [] }],
        }))
      : scoreType === 'piano'
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

      const loadedType = loadedData.scoreType ?? 'single';
      setScoreType(loadedType);

      if (loadedType === 'quartet') {
        const QUARTET_IDS = ['violin-1', 'violin-2', 'viola', 'cello'];
        setQuartetParts(QUARTET_IDS.map(id =>
          loadedData.parts.find(p => p.partId === id)?.measures ?? []
        ));
      } else {
        const rightPart = loadedData.parts.find(p => p.clef === 'treble') ?? loadedData.parts[0];
        const leftPart  = loadedData.parts.find(p => p.clef === 'bass');
        setRightHandData(rightPart?.measures ?? []);
        setLeftHandData(leftPart?.measures);
      }
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
    return () => {
      clearPlaybackTimer();
      resetPlaybackClock();
      getAudioEngine().dispose();
    };
  }, [clearPlaybackTimer, getAudioEngine, resetPlaybackClock]);

  useEffect(() => {
    const resetAudioAfterBackgrounding = () => {
      // Safari では、長時間放置や別タブ復帰後に AudioContext が
      // 見かけ上生きていても無音になることがある。
      // ここで新しい音声エンジンへ差し替えておくと、次のユーザー操作時に
      // 必ず新しい context から始められる。
      clearPlaybackTimer();
      resetPlaybackClock();
      recreateAudioEngine();
      setPlaybackState('stopped');
      setCurrentPosition({ measureIndex: 0, beatPosition: 0, noteIndex: 0 });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetAudioAfterBackgrounding();
      }
    };

    const handlePageShow = () => {
      resetAudioAfterBackgrounding();
    };

    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearPlaybackTimer, recreateAudioEngine, resetPlaybackClock]);

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
            <button
              className="ghost"
              onClick={() => handleScoreTypeChange('quartet')}
              style={{
                border: scoreType === 'quartet' ? '2px solid #3b82f6' : '1px solid #ccc',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: scoreType === 'quartet' ? '#eff6ff' : '#fff',
              }}
              title="弦楽四重奏（Vn. I / Vn. II / Va. / Vc.）"
            >
              弦楽四重奏
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
            soundRuntimeSettings={soundRuntimeSettings}
            onSoundEngineModeChange={handleSoundEngineModeChange}
            onPluginNameChange={handlePluginNameChange}
            onSoundProfileChange={handleSoundProfileChange}
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
                  {scoreType === 'quartet' ? (
                    <QuartetStaff
                      systems={p.systems}
                      measuresPerSystem={4}
                      tool={tool}
                      scale={scale}
                      partsData={quartetParts}
                      onPartChange={[0, 1, 2, 3].map(pi => handleQuartetPartChange(pi))}
                      startMeasureIndex={i * systemsPerPage * 4}
                      disabled={isEditingDisabled}
                      yOffset={yOffset}
                    />
                  ) : scoreType === 'piano' ? (
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
