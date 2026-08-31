// 速度標語と途中テンポ変更から「小節ごとの再生テンポ」を決める規則のテスト（Issue #458）。
//
// 実音・ハイライト・終了タイマーの3か所がこの関数の答えを共有するため、
// ここが仕様の正本になる。
import { describe, it, expect } from 'vitest';
import type { MeasureData } from '../types/storage';
import { resolveMeasureBpms } from './tempoPlaybackUtils';
import { TEMPO_MARKING_PRESET_ENTRIES, getTempoMarkingBpm } from './tempoMarkingPresets';
import { MIN_BPM, MAX_BPM } from '../audio/tempoRange';

/** 4分音符1つだけの小節を作る補助。tempoMarking は先頭の音符へ付ける */
function measureWith(options: {
  tempoMarking?: string;
  bpm?: number;
  voice2TempoMarking?: string;
} = {}): MeasureData {
  const events = [
    { dur: '4' as const, isRest: false, keys: ['c/4'], tempoMarking: options.tempoMarking },
  ];
  const measure: MeasureData = {
    events,
    voices: [{ id: 'voice-1', events }],
  };
  if (options.bpm !== undefined) measure.bpm = options.bpm;
  if (options.voice2TempoMarking) {
    measure.voices = [
      { id: 'voice-1', events },
      {
        id: 'voice-2',
        events: [{ dur: '4' as const, isRest: false, keys: ['e/3'], tempoMarking: options.voice2TempoMarking }],
      },
    ];
  }
  return measure;
}

describe('resolveMeasureBpms: 小節ごとの再生テンポ（Issue #458）', () => {
  it('標語を置いた小節からテンポが切り替わり、以降の小節も引き継ぐ', () => {
    const measures = [
      measureWith(),
      measureWith({ tempoMarking: 'Andante' }),
      measureWith(),
    ];

    // 1小節目は全体テンポのまま、2小節目から Andante(76)、3小節目もそのまま引き継ぐ
    expect(resolveMeasureBpms(measures, 120)).toEqual([120, 76, 76]);
  });

  it('同じ小節に数値の途中テンポ変更があれば数値が勝つ', () => {
    // 明示的な指定（♩=XXX）のほうが意図がはっきりしているため優先する（本文仕様）
    const measures = [measureWith({ tempoMarking: 'Presto', bpm: 90 })];

    expect(resolveMeasureBpms(measures, 120)).toEqual([90]);
  });

  it('対応表にない自由入力の標語は無視され、直前のテンポが続く', () => {
    const measures = [
      measureWith({ tempoMarking: 'Allegro' }),
      measureWith({ tempoMarking: 'Allegro con brio' }),
      measureWith({ tempoMarking: '軽やかに' }),
    ];

    // 表示はされるが再生テンポは変えない（トリアージ裁定）
    expect(resolveMeasureBpms(measures, 120)).toEqual([132, 132, 132]);
  });

  it('大文字小文字・前後の空白の揺れを吸収する', () => {
    const measures = [
      measureWith({ tempoMarking: ' andante ' }),
      measureWith({ tempoMarking: 'ALLEGRO' }),
    ];

    expect(resolveMeasureBpms(measures, 120)).toEqual([76, 132]);
  });

  it('声部2に置いた標語も効く', () => {
    // 声部1側だけを見る実装だと、同じ操作なのに片方だけ効かない食い違いになる
    const measures = [measureWith({ voice2TempoMarking: 'Largo' })];

    expect(resolveMeasureBpms(measures, 120)).toEqual([50]);
  });

  it('壊れたテンポ値（0 / NaN）は無視して直前のテンポを維持する', () => {
    // 0 を素通しすると 60 / 0 = Infinity になり、再生が進まなくなる
    const measures = [
      measureWith({ tempoMarking: 'Allegro' }),
      measureWith({ bpm: 0 }),
      measureWith({ bpm: Number.NaN }),
    ];

    expect(resolveMeasureBpms(measures, 120)).toEqual([132, 132, 132]);
  });

  it('範囲外の途中テンポ変更は有効範囲へ収める', () => {
    const measures = [measureWith({ bpm: 1000 }), measureWith({ bpm: 1 })];

    expect(resolveMeasureBpms(measures, 120)).toEqual([MAX_BPM, MIN_BPM]);
  });

  it('標語もテンポ指定も無ければ全体テンポのまま', () => {
    expect(resolveMeasureBpms([measureWith(), measureWith()], 100)).toEqual([100, 100]);
  });
});

describe('速度標語プリセットの目安 BPM', () => {
  it('すべての目安 BPM が再生テンポの有効範囲に収まっている', () => {
    // 範囲外の値を足すと、再生時に無言でクランプされて標語と実際の速さが食い違う
    TEMPO_MARKING_PRESET_ENTRIES.forEach((entry) => {
      expect(entry.bpm).toBeGreaterThanOrEqual(MIN_BPM);
      expect(entry.bpm).toBeLessThanOrEqual(MAX_BPM);
    });
  });

  it('遅い順に並んでいる（候補リストの並びと目安 BPM が矛盾しない）', () => {
    const bpms = TEMPO_MARKING_PRESET_ENTRIES.map((entry) => entry.bpm);
    const sorted = [...bpms].sort((a, b) => a - b);
    expect(bpms).toEqual(sorted);
  });

  it('候補として出るすべての標語が再生テンポへ翻訳できる', () => {
    // 候補に出るのにテンポが変わらない語があると、利用者から見て挙動が不揃いになる
    TEMPO_MARKING_PRESET_ENTRIES.forEach((entry) => {
      expect(getTempoMarkingBpm(entry.term)).toBe(entry.bpm);
    });
    expect(getTempoMarkingBpm('存在しない標語')).toBeNull();
    expect(getTempoMarkingBpm(undefined)).toBeNull();
    expect(getTempoMarkingBpm('')).toBeNull();
  });
});
