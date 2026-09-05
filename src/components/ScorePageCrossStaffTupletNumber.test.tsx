// Issue #574 round1 P2: 段またぎ連符の数字の配置を ScorePage の実マウントで固定する。
//
// PianoSystemCanvas への直接注入（PianoSystemCanvasCrossStaffTupletNumber.test.tsx）だけだと、
// 保存データの renderStaff / tuplet.hideNumber が「作品の復元 → 描画」の経路を通って
// 実際に届いているかが分からない。ここでは月光7〜8小節目と同じ形（右手の3連符の一部が
// 下の五線へ食い込む）をピアノ譜の作品として復元し、描かれた数字の位置を実測する。
//
// マウントが重いので、このファイルはテスト1件だけにしている
// （ScorePage を1ファイルで何度もマウントすると終わらなくなる実害があったため）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import type { MeasureData, NoteEvent } from '../types/storage';

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

/** 右手の8分3連。crossFrom 以降の音符を下の五線へ出す（renderStaff: 'below'） */
function rightHandCrossingTriplet(id: string, hideNumber: boolean): MeasureData {
  const tuplet = { id, numNotes: 3, notesOccupied: 2, ...(hideNumber ? { hideNumber: true } : {}) };
  const events: NoteEvent[] = [
    { dur: '8', isRest: false, keys: ['e/4'], tuplet },
    { dur: '8', isRest: false, keys: ['c#/4'], tuplet, renderStaff: 'below' },
    { dur: '8', isRest: false, keys: ['g#/3'], tuplet, renderStaff: 'below' },
    { dur: '4', isRest: true, keys: ['b/4'] },
    { dur: '4', isRest: true, keys: ['b/4'] },
    { dur: '4', isRest: true, keys: ['b/4'] },
  ];
  return { events, voices: [{ id: 'voice-1', events }] } as never;
}

/** 左手: 4分音符4つ（1拍目が右手の3連符の頭と同じ拍に来る） */
function leftHandMeasure(): MeasureData {
  const events: NoteEvent[] = (['c/3', 'c/3', 'c/3', 'c/3'] as const).map((key) => ({
    dur: '4' as const, isRest: false, keys: [key],
  }));
  return { events, voices: [{ id: 'voice-1', events }] } as never;
}

/**
 * 1小節目＝数字を出す段またぎ3連符、2小節目＝数字を隠す指定（#269）の段またぎ3連符。
 * 「renderStaff と hideNumber が保存経路から描画へ届いているか」を1回のマウントで見る。
 */
function seedCrossStaffWork() {
  const data = createSavedScoreData(
    { title: '段またぎ連符の数字', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [rightHandCrossingTriplet('m1', false), rightHandCrossingTriplet('m2', true)] },
      { partId: 'left-hand', clef: 'bass', measures: [leftHandMeasure(), leftHandMeasure()] },
    ],
    1, 2, 'piano'
  );
  const created = createWork('段またぎ連符の数字');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/** 五線の第1線の y と線間隔を、当たり判定 rect の実測値から集める */
function allStaveGeometries(): { line0Y: number; spacing: number }[] {
  const seen = new Map<number, number>();
  document.querySelectorAll('rect.vf-note-hit').forEach((rect) => {
    const line0Y = parseFloat(rect.getAttribute('data-line0-y') ?? '');
    const spacing = parseFloat(rect.getAttribute('data-line-spacing') ?? '');
    if (Number.isFinite(line0Y) && Number.isFinite(spacing)) seen.set(line0Y, spacing);
  });
  return [...seen.entries()].map(([line0Y, spacing]) => ({ line0Y, spacing })).sort((a, b) => a.line0Y - b.line0Y);
}

describe('段またぎ連符の数字（ScorePage 実マウント・#574）', () => {
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

  it('保存データの renderStaff / hideNumber が描画まで届き、数字は梁の側＝下の五線の下に出る', async () => {
    seedCrossStaffWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('g.vf-tuplet text')).toBeTruthy();
    }, { timeout: 15000 });

    // hideNumber を付けた2小節目の連符は表示一式が描かれない（#269 と共存）
    const tupletTexts = [...document.querySelectorAll('g.vf-tuplet text')];
    expect(tupletTexts.length, '描かれる連符の数字は1小節目の1つだけ').toBe(1);

    const numberY = parseFloat(tupletTexts[0].getAttribute('y') ?? '');
    expect(Number.isFinite(numberY)).toBe(true);

    const staves = allStaveGeometries();
    expect(staves.length, '大譜表の2つの五線').toBe(2);
    // どちらの五線の中にも入っていない（修正前は下の五線のど真ん中に描かれていた）
    staves.forEach(({ line0Y, spacing }) => {
      const insideStave = numberY > line0Y - spacing * 0.5 && numberY < line0Y + spacing * 4.5;
      expect(insideStave, `数字 y=${numberY} が五線（第1線 y=${line0Y}）の中に入っていない`).toBe(false);
    });
    // 梁は下段へ渡っているので、数字も下側（下の五線の第5線より下）へ出る
    const lower = staves[1];
    expect(numberY).toBeGreaterThan(lower.line0Y + 4 * lower.spacing);

    // 左手の符頭とも重ならない（描かれている符頭の一番下より下にいる）
    const noteheadYs = [...document.querySelectorAll('g.vf-notehead text')]
      .map((text) => parseFloat(text.getAttribute('y') ?? ''))
      .filter((y) => Number.isFinite(y));
    expect(noteheadYs.length).toBeGreaterThan(0);
    expect(numberY, '一番低い符頭より下').toBeGreaterThan(Math.max(...noteheadYs));
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
