// src/utils/playbackPanelSections.test.ts
// 折りたたみの開閉状態の記憶（Issue #562）のテスト。
// 壊れた保存値でアプリが落ちない・既定へ戻ることを固定する。

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PLAYBACK_PANEL_SECTION_KEYS,
  DEFAULT_PLAYBACK_PANEL_SECTION_OPEN,
  loadPlaybackPanelSectionOpen,
  savePlaybackPanelSectionOpen,
} from './playbackPanelSections';

beforeEach(() => {
  localStorage.clear();
});

describe('playbackPanelSections', () => {
  it('保存値が無いときは既定（音色詳細=閉じる / 中の2見出し=開く）を返す', () => {
    expect(loadPlaybackPanelSectionOpen('soundDetail')).toBe(false);
    expect(loadPlaybackPanelSectionOpen('soundSource')).toBe(true);
    expect(loadPlaybackPanelSectionOpen('soundDesign')).toBe(true);
    expect(DEFAULT_PLAYBACK_PANEL_SECTION_OPEN.soundDetail).toBe(false);
  });

  it('保存した値をそのまま読み戻せる', () => {
    savePlaybackPanelSectionOpen('soundDetail', true);
    savePlaybackPanelSectionOpen('soundDesign', false);

    expect(localStorage.getItem(PLAYBACK_PANEL_SECTION_KEYS.soundDetail)).toBe('true');
    expect(loadPlaybackPanelSectionOpen('soundDetail')).toBe(true);
    expect(loadPlaybackPanelSectionOpen('soundDesign')).toBe(false);
  });

  it('true / false 以外の壊れた値は既定として扱う', () => {
    localStorage.setItem(PLAYBACK_PANEL_SECTION_KEYS.soundDetail, '{"open":1}');
    localStorage.setItem(PLAYBACK_PANEL_SECTION_KEYS.soundSource, '');

    expect(loadPlaybackPanelSectionOpen('soundDetail')).toBe(false);
    expect(loadPlaybackPanelSectionOpen('soundSource')).toBe(true);
  });
});
