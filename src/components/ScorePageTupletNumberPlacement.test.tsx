// 連符数字の配置の ScorePage 統合テスト（Issue #471 round1 P2）。
// 弟の実使用報告（Debussy 四重奏・1小節目の16分3連+ビーム）の再現JSONを
// 作品として復元し、実描画で「数字が自分の音符の近くに置かれる」ことを固定する。
// 修正前は、符幹が内側を向くケースで数字だけが五線をまたいで反対側へ取り残され、
// 四重奏では下の段のビームへ重なっていた。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import type { MeasureData } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** Issue #471 の再現JSON（1小節目・Violin I 相当）を四重奏の先頭パートへ仕込む */
function seedReproWork() {
  const tupletId = 'tuplet-repro-471';
  const events = [
    { dur: '4' as const, isRest: false, keys: ['g/4'] },
    { dur: '4' as const, isRest: false, keys: ['f/4'] },
    { dur: '8' as const, isRest: false, keys: ['f/4'] },
    { dur: '8' as const, isRest: false, keys: ['d/4'] },
    { dur: '8' as const, isRest: false, keys: ['f/4'] },
    { dur: '16' as const, isRest: false, keys: ['ab/4'], tuplet: { id: tupletId, numNotes: 3, notesOccupied: 2 } },
    { dur: '16' as const, isRest: false, keys: ['bb/4'], tuplet: { id: tupletId, numNotes: 3, notesOccupied: 2 } },
    { dur: '16' as const, isRest: false, keys: ['ab/4'], tuplet: { id: tupletId, numNotes: 3, notesOccupied: 2 } },
  ];
  const reproMeasure: MeasureData = { events, voices: [{ id: 'voice-1', events }] } as never;
  const restEvents = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const restMeasure: MeasureData = { events: restEvents, voices: [{ id: 'voice-1', events: restEvents }] } as never;

  const data = createSavedScoreData(
    { title: '連符数字再現', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'violin-1', clef: 'treble', measures: [reproMeasure] },
      { partId: 'violin-2', clef: 'treble', measures: [restMeasure] },
      { partId: 'viola', clef: 'alto', measures: [restMeasure] },
      { partId: 'cello', clef: 'bass', measures: [restMeasure] },
    ],
    1, 1, 'quartet'
  );
  const created = createWork('連符数字再現');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('連符数字の配置（#471 再現JSON）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('16分3連の数字が、自分の音符の近く（同じ側）に描かれる', async () => {
    seedReproWork();
    render(<ScorePage />);
    await waitFor(() => {
      // 連符（vf-tuplet）が描かれるまで待つ
      expect(document.querySelector('.vf-tuplet text, g.vf-tuplet text')).toBeTruthy();
    }, { timeout: 15000 });

    const numberText = document.querySelector('.vf-tuplet text, g.vf-tuplet text') as SVGTextElement;
    const numberY = parseFloat(numberText.getAttribute('y') ?? 'NaN');
    expect(Number.isFinite(numberY)).toBe(true);

    // 連符自身（Violin I の data-note 5〜7）の当たり判定から x 範囲を取り、
    // その範囲にかかるビームの上端と数字の位置関係を固定する。
    // （data-measure だけで絞ると他パートの当たり判定まで拾ってしまう）
    const tupletHits = [5, 6, 7].map(noteIndex =>
      document.querySelector(`rect.vf-note-hit[data-measure="0"][data-note="${noteIndex}"]`) as SVGRectElement);
    expect(tupletHits.every(Boolean)).toBe(true);
    const xMin = Math.min(...tupletHits.map(hit => parseFloat(hit.getAttribute('x')!)));
    const xMax = Math.max(...tupletHits.map(hit =>
      parseFloat(hit.getAttribute('x')!) + parseFloat(hit.getAttribute('width')!)));

    // 連符の x 範囲にかかるビームのパスから y 値を集める
    const svg = numberText.ownerSVGElement!;
    const beamYs: number[] = [];
    // ビームの path に限定する（round2 P2: path 全部だと五線・符幹の y が混ざり、
    // 最小値が別要素になって「ビームの近く」判定が誤って通る）
    for (const path of svg.querySelectorAll('g.vf-beam > path, g.vf-beam path')) {
      const d = path.getAttribute('d') ?? '';
      const points = [...d.matchAll(/([ML])\s*([\d.]+)\s+([\d.]+)/g)]
        .map(match => ({ x: parseFloat(match[2]), y: parseFloat(match[3]) }));
      if (points.length >= 2 && points.some(pt => pt.x >= xMin && pt.x <= xMax)) {
        beamYs.push(...points.map(pt => pt.y));
      }
    }
    expect(beamYs.length).toBeGreaterThan(0);
    const beamTopY = Math.min(...beamYs);

    // 数字は自分のビームの上（重ならない）かつ、その近く（60px 以内）にいること。
    // 修正前は五線をまたいだ反対側（ビームから5間超・下の段側）に取り残されていた
    expect(numberY).toBeLessThan(beamTopY);
    expect(beamTopY - numberY).toBeLessThan(60);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
