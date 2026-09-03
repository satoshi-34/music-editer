// src/audio/scheduleLead.test.ts
// Issue #610: 再生の先読みリードは両エンジン共通の定数で、dev の調整パネル（#596）に登録されている
import { describe, expect, it } from 'vitest';
import { SCHEDULE_LEAD_SECONDS, scheduleLeadSeconds } from './scheduleLead';
import { DEV_TUNING_ENTRIES } from '../utils/devTuning';

describe('scheduleLead（Issue #610）', () => {
  it('既定は 0.1 秒で、上書きが無ければ定数そのものを返す', () => {
    expect(SCHEDULE_LEAD_SECONDS).toBe(0.1);
    expect(scheduleLeadSeconds()).toBe(SCHEDULE_LEAD_SECONDS);
  });

  it('dev 調整パネルの登録値は定数と一致している（二重管理の食い違い防止）', () => {
    const entry = DEV_TUNING_ENTRIES.find((e) => e.key === 'audio.scheduleLead');
    expect(entry).toBeDefined();
    expect(entry?.defaultValue).toBe(SCHEDULE_LEAD_SECONDS);
    expect(entry?.constName).toBe('SCHEDULE_LEAD_SECONDS');
    expect(entry?.min).toBe(0);
  });
});
