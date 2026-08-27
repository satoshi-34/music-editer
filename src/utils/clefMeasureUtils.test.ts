import { describe, expect, it } from 'vitest';
import {
  collectMidMeasureClefChanges,
  hasMidMeasureClefChange,
  resolveClefAtBeat,
  resolveEventClef,
  resolveEventClefsInMeasure,
  resolveMeasureClef,
} from './clefMeasureUtils';
import type { ClefType } from '../components/clefUtils';
import type { MeasureData } from '../types/storage';

function measure(clef?: MeasureData['clef']): MeasureData {
  return { events: [], clef };
}

describe('resolveMeasureClef', () => {
  it('どの小節にも指定がなければパートの既定クレフをそのまま返す', () => {
    const measures = [measure(), measure(), measure()];
    expect(resolveMeasureClef(measures, 0, 'bass')).toBe('bass');
    expect(resolveMeasureClef(measures, 2, 'bass')).toBe('bass');
  });

  it('途中の小節で指定したクレフを、それ以降の小節へ継続する', () => {
    const measures = [measure(), measure(), measure('tenor'), measure(), measure()];
    expect(resolveMeasureClef(measures, 0, 'bass')).toBe('bass');
    expect(resolveMeasureClef(measures, 1, 'bass')).toBe('bass');
    expect(resolveMeasureClef(measures, 2, 'bass')).toBe('tenor');
    expect(resolveMeasureClef(measures, 3, 'bass')).toBe('tenor');
    expect(resolveMeasureClef(measures, 4, 'bass')).toBe('tenor');
  });

  it('複数回の変更でも、最後に有効なクレフを返す', () => {
    const measures = [measure(), measure('treble'), measure(), measure('alto'), measure()];
    expect(resolveMeasureClef(measures, 1, 'bass')).toBe('treble');
    expect(resolveMeasureClef(measures, 2, 'bass')).toBe('treble');
    expect(resolveMeasureClef(measures, 3, 'bass')).toBe('alto');
    expect(resolveMeasureClef(measures, 4, 'bass')).toBe('alto');
  });

  it('index が -1（それより前の小節がない）ときはパートの既定クレフを返す', () => {
    const measures = [measure('tenor')];
    expect(resolveMeasureClef(measures, -1, 'treble')).toBe('treble');
  });
});

// ===== 小節途中のクレフ変更（Issue #424） =====
describe('小節途中のクレフ変更（NoteEvent.clefChange）', () => {
  /** テスト用に「音符4つの小節」を作る。clefChanges で指定した位置にだけ途中変更を付ける */
  const makeMeasure = (clefChanges: Record<number, ClefType> = {}, measureClef?: ClefType): MeasureData => ({
    events: [0, 1, 2, 3].map((i) => ({
      dur: '4' as const,
      isRest: false,
      keys: ['c/4'],
      ...(clefChanges[i] ? { clefChange: clefChanges[i] } : {}),
    })),
    ...(measureClef ? { clef: measureClef } : {}),
  });

  it('変更を置いたイベント自身から新しいクレフが有効になる', () => {
    const measures = [makeMeasure({ 2: 'bass' })];
    expect(resolveEventClef(measures, 0, 0, 'treble')).toBe('treble');
    expect(resolveEventClef(measures, 0, 1, 'treble')).toBe('treble');
    expect(resolveEventClef(measures, 0, 2, 'treble')).toBe('bass');
    expect(resolveEventClef(measures, 0, 3, 'treble')).toBe('bass');
  });

  it('途中変更は次の小節へも持続する（実譜の慣習どおり）', () => {
    const measures = [makeMeasure({ 2: 'bass' }), makeMeasure()];
    expect(resolveMeasureClef(measures, 1, 'treble')).toBe('bass');
    expect(resolveEventClef(measures, 1, 0, 'treble')).toBe('bass');
  });

  it('対象小節自身の途中変更は「小節の先頭時点」には含めない', () => {
    const measures = [makeMeasure({ 1: 'bass' })];
    expect(resolveMeasureClef(measures, 0, 'treble')).toBe('treble');
  });

  it('小節単位の clef は、前の小節から持ち越した途中変更より優先される', () => {
    const measures = [makeMeasure({ 0: 'bass' }), makeMeasure({}, 'treble')];
    expect(resolveMeasureClef(measures, 1, 'treble')).toBe('treble');
  });

  it('途中変更が無いデータでは従来どおりの解決結果になる（リグレッション防止）', () => {
    const measures = [makeMeasure(), makeMeasure({}, 'bass'), makeMeasure()];
    expect(resolveMeasureClef(measures, 0, 'treble')).toBe('treble');
    expect(resolveMeasureClef(measures, 2, 'treble')).toBe('bass');
    expect(resolveEventClef(measures, 2, 3, 'treble')).toBe('bass');
  });

  it('resolveEventClefsInMeasure はイベントごとの実効クレフを並べて返す', () => {
    const measure = makeMeasure({ 2: 'bass' });
    expect(resolveEventClefsInMeasure(measure.events, 'treble')).toEqual([
      'treble', 'treble', 'bass', 'bass',
    ]);
  });

  it('hasMidMeasureClefChange は途中変更の有無を返す', () => {
    expect(hasMidMeasureClefChange(makeMeasure().events)).toBe(false);
    expect(hasMidMeasureClefChange(makeMeasure({ 1: 'bass' }).events)).toBe(true);
  });

  it('collectMidMeasureClefChanges は変更位置を拍で返し、拍位置で解決できる', () => {
    // 4分音符4つの小節で、3つ目（= 2拍目）からヘ音記号に変わる
    const changes = collectMidMeasureClefChanges(makeMeasure({ 2: 'bass' }).events);
    expect(changes).toEqual([{ beat: 2, clef: 'bass' }]);
    // 追加声部の音符は拍位置で同じクレフに揃う（8分音符4つ = 0, 0.5, 1, 1.5 拍）
    expect(resolveClefAtBeat('treble', changes, 1.5)).toBe('treble');
    expect(resolveClefAtBeat('treble', changes, 2)).toBe('bass');
    expect(resolveClefAtBeat('treble', changes, 2.5)).toBe('bass');
  });
});
