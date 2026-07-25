import { describe, expect, it } from 'vitest';

import { InstrumentType } from '../audio/SoundSource';
import type { InstrumentationPresetId, ScoreType } from '../types/storage';
import { totalEnsembleStaffCount } from '../utils/instrumentationPartUtils';
import {
  getDefaultInstrumentationForScoreType,
  getInstrumentationPreset,
  getScoreTypeForInstrumentation,
  INSTRUMENTATION_PRESETS,
} from './instrumentationPresets';

describe('instrumentationPresets', () => {
  it('プリセットIDは重複せず、期待する代表編成をすべて持つ', () => {
    const presetIds = INSTRUMENTATION_PRESETS.map(preset => preset.presetId);
    const expectedPresetIds: InstrumentationPresetId[] = [
      'single',
      'piano',
      'string-quartet',
      'string-orchestra',
      'chamber-orchestra',
      'classical-orchestra',
      'romantic-orchestra',
      'wind-band',
      'vocal-piano',
      'recorder-vocal',
    ];

    expect(new Set(presetIds).size).toBe(presetIds.length);
    expect(presetIds).toEqual(expectedPresetIds);
  });

  it('各プリセットのパートIDと表示順が安定している', () => {
    INSTRUMENTATION_PRESETS.forEach(preset => {
      const partIds = preset.parts.map(part => part.id);

      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.parts.length).toBeGreaterThan(0);
      expect(new Set(partIds).size).toBe(partIds.length);

      preset.parts.forEach((part, index) => {
        // order は保存データと表示配列を同期する目印なので、配列順と一致させる。
        expect(part.order).toBe(index);
        expect(part.name.trim().length).toBeGreaterThan(0);
        expect(part.abbreviation.trim().length).toBeGreaterThan(0);
        expect(part.staffCount).toBeGreaterThanOrEqual(1);
      });
    });
  });

  it('各パートの再生音色は既知の InstrumentType だけを使う', () => {
    const instrumentTypes = new Set(Object.values(InstrumentType));

    INSTRUMENTATION_PRESETS.forEach(preset => {
      preset.parts.forEach(part => {
        expect(instrumentTypes.has(part.playbackInstrument ?? InstrumentType.PIANO)).toBe(true);
      });
    });
  });

  it('取得したプリセットを変更しても元定義へ影響しない', () => {
    const first = getInstrumentationPreset('classical-orchestra');
    first.name = 'Edited Orchestra';
    first.parts[0].name = 'Edited Flute';

    const second = getInstrumentationPreset('classical-orchestra');

    expect(second.name).toBe('二管編成オーケストラ');
    expect(second.parts[0].name).toBe('Flute 1-2');
  });

  it('スコア種別と既定プリセットの対応が保たれている', () => {
    const expectedDefaults: Array<[ScoreType, InstrumentationPresetId]> = [
      ['single', 'single'],
      ['piano', 'piano'],
      ['quartet', 'string-quartet'],
      ['ensemble', 'chamber-orchestra'],
    ];

    expectedDefaults.forEach(([scoreType, presetId]) => {
      expect(getDefaultInstrumentationForScoreType(scoreType).presetId).toBe(presetId);
    });
  });

  it('代表編成プリセットは正しいスコア種別へ分類される', () => {
    expect(getScoreTypeForInstrumentation('single')).toBe('single');
    expect(getScoreTypeForInstrumentation('piano')).toBe('piano');
    expect(getScoreTypeForInstrumentation('string-quartet')).toBe('quartet');

    const ensemblePresetIds: InstrumentationPresetId[] = [
      'string-orchestra',
      'chamber-orchestra',
      'classical-orchestra',
      'romantic-orchestra',
      'wind-band',
      'vocal-piano',
      'recorder-vocal',
      'custom',
    ];
    ensemblePresetIds.forEach(presetId => {
      expect(getScoreTypeForInstrumentation(presetId)).toBe('ensemble');
    });
  });

  it('歌＋ピアノプリセットはピアノパートが大譜表（staffCount:2）で歌パートと合わせて3段になる', () => {
    const preset = getInstrumentationPreset('vocal-piano');
    const voicePart = preset.parts.find(part => part.id === 'voice');
    const pianoPart = preset.parts.find(part => part.id === 'piano');

    expect(voicePart?.staffCount).toBe(1);
    expect(pianoPart?.staffCount).toBe(2);
    expect(totalEnsembleStaffCount(preset.parts)).toBe(3);
  });

  it('リコーダー＋歌プリセットは2つの独立した1段パートで構成される', () => {
    const preset = getInstrumentationPreset('recorder-vocal');

    expect(preset.parts).toHaveLength(2);
    expect(preset.parts.every(part => part.staffCount === 1)).toBe(true);
    expect(totalEnsembleStaffCount(preset.parts)).toBe(2);
  });
});
