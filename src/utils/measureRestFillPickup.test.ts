// 弱起（アウフタクト）があるときの自動休符補完のテスト（Issue #473 段2）。
// 設計メモ .claude/specs/anacrusis-pickup-measure/design.md §4「段2」の受入テストに対応する。
//
// fillPriorMeasureRests は「2小節目に音符を置いたら、手前の小節を休符で埋める」処理。
// ここが拍子ぶんで埋めると、弱起の小節が**実データとして**完全小節へ書き換わってしまう
// （見た目だけの補完と違い、保存にも残る）。小節ごとの容量で埋めることを固定する。
import { describe, it, expect } from 'vitest';
import { fillPriorMeasureRests } from './measureRestFillUtils';
import { getMeasureDurationBeats } from './voiceMeasureUtils';
import { resolveMeasureCapacityBeats } from './measureCapacityUtils';
import type { MeasureData } from '../types/storage';

const quarter = (key: string) => ({ dur: '4' as const, isRest: false, keys: [key] });

describe('弱起があるときの自動休符補完（Issue #473）', () => {
  it('弱起の小節は弱起の拍数までしか埋めない', () => {
    const measures: MeasureData[] = [
      { events: [quarter('g/4')], pickupBeats: 1 },   // 弱起（1拍・すでに満杯）
      { events: [quarter('c/5')] },                   // ここに入力した想定
    ];
    fillPriorMeasureRests(
      measures,
      1,
      (measureIndex) => resolveMeasureCapacityBeats(measures, measureIndex, [4, 4]),
      'treble',
    );
    // 休符が足されず、弱起の小節は1拍のまま
    expect(getMeasureDurationBeats(measures[0])).toBe(1);
  });

  it('弱起の次以降の小節は従来どおり拍子ぶんまで埋める', () => {
    const measures: MeasureData[] = [
      { events: [quarter('g/4')], pickupBeats: 1 },   // 弱起（1拍）
      { events: [quarter('c/5')] },                   // 1拍しか入っていない完全小節
      { events: [quarter('d/5')] },                   // ここに入力した想定
    ];
    fillPriorMeasureRests(
      measures,
      2,
      (measureIndex) => resolveMeasureCapacityBeats(measures, measureIndex, [4, 4]),
      'treble',
    );
    expect(getMeasureDurationBeats(measures[0])).toBe(1);
    expect(getMeasureDurationBeats(measures[1])).toBe(4);
  });

  it('数値を渡す従来の呼び出しは今までどおり動く（後方互換）', () => {
    const measures: MeasureData[] = [
      { events: [quarter('g/4')] },
      { events: [quarter('c/5')] },
    ];
    fillPriorMeasureRests(measures, 1, 4, 'treble');
    expect(getMeasureDurationBeats(measures[0])).toBe(4);
  });
});
