// src/audio/polyphonyLimit.test.ts — Issue #605 同時発音数の上限
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_POLYPHONY, limitPolyphony, maxPolyphony } from './polyphonyLimit';
import { DEV_TUNING_ENTRIES, resetAllDevTuning, setDevTuningOverride } from '../utils/devTuning';

describe('limitPolyphony（Issue #605）', () => {
  afterEach(() => { resetAllDevTuning(); });

  it('上限以内なら何も詰めない（入力順・値ともそのまま）', () => {
    const input = [
      { startTime: 0, endTime: 4 },
      { startTime: 1, endTime: 3 },
      { startTime: 2, endTime: 5 },
    ];
    const result = limitPolyphony(input, 3);
    expect(result.voices).toEqual(input);
    expect(result.peakBefore).toBe(3);
    expect(result.stolen).toBe(0);
    expect(result.dropped).toBe(0);
  });

  it('上限+1音目で最も古く鳴り始めた音が、その音の開始時刻で止まる', () => {
    const result = limitPolyphony([
      { startTime: 0, endTime: 10 },
      { startTime: 1, endTime: 10 },
      { startTime: 2, endTime: 10 },
      { startTime: 3, endTime: 10 },
    ], 3);
    expect(result.voices[0].endTime).toBe(3);
    expect(result.voices[1].endTime).toBe(10);
    expect(result.stolen).toBe(1);
    expect(result.peakBefore).toBe(4);
  });

  it('鳴り終わった音は数えない（ペダル延長で伸びた音だけが積み上がる状況）', () => {
    const result = limitPolyphony([
      { startTime: 0, endTime: 1 },
      { startTime: 1, endTime: 2 },
      { startTime: 2, endTime: 3 },
      { startTime: 3, endTime: 4 },
    ], 1);
    expect(result.stolen).toBe(0);
    expect(result.peakBefore).toBe(1);
  });

  it('同時刻に上限を超える和音は、入力順の早い音から長さ 0（無音化）になる', () => {
    const result = limitPolyphony([
      { startTime: 0, endTime: 2 },
      { startTime: 0, endTime: 2 },
      { startTime: 0, endTime: 2 },
    ], 2);
    expect(result.voices[0].endTime).toBe(0);
    expect(result.voices[1].endTime).toBe(2);
    expect(result.dropped).toBe(1);
  });

  it('入力の順序は右手→左手のような部品順のままでも、開始時刻で正しく数える', () => {
    // 左手（後から積まれる）が先に鳴り始める並び
    const result = limitPolyphony([
      { startTime: 5, endTime: 6 },   // 右手
      { startTime: 0, endTime: 10 },  // 左手（古い）
      { startTime: 1, endTime: 10 },
      { startTime: 2, endTime: 10 },
    ], 3);
    // 5秒時点で 0/1/2 の3音が鳴っており上限。最古の 0 が 5 で止まる
    expect(result.voices[1].endTime).toBe(5);
    expect(result.voices[0].endTime).toBe(6);
  });

  it('既定 48 で、dev 調整パネルの登録値・上書きが実効値に届く', () => {
    expect(MAX_POLYPHONY).toBe(48);
    expect(maxPolyphony()).toBe(48);
    const entry = DEV_TUNING_ENTRIES.find((e) => e.key === 'audio.maxPolyphony');
    expect(entry?.defaultValue).toBe(MAX_POLYPHONY);
    expect(entry?.constName).toBe('MAX_POLYPHONY');
    setDevTuningOverride('audio.maxPolyphony', 16);
    expect(maxPolyphony()).toBe(16);
  });
});
