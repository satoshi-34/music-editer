// src/components/UiContextBar.test.tsx
// Issue #405（段2）: A1 文脈バーの見た目（DOM）を固定する。
// 中身の言葉は utils/uiContextBar.test.ts が担当し、ここでは
// 「区画がどう並ぶか」「区切りが余計に出ないか」を確かめる。

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import UiContextBar from './UiContextBar';

describe('UiContextBar', () => {
  it('ピアノ譜ではレイヤー・タブ・ツールの3区画を出す', () => {
    render(
      <UiContextBar
        scoreType="piano"
        activeLayerPart={1}
        activeVoice={1}
        activeToolbarTab="symbols"
        tool={{ mode: 'dynamic', dynamic: 'pp' }}
      />
    );
    expect(screen.getByTestId('ui-context-bar-layer')).toHaveTextContent('左手・声部2');
    expect(screen.getByTestId('ui-context-bar-tab')).toHaveTextContent('演奏記号');
    expect(screen.getByTestId('ui-context-bar-tool')).toHaveTextContent('pp');
    // 見出し語が読めること（詰まった原因を「レイヤーが違った」と言い表せるように）
    expect(screen.getByTestId('ui-context-bar')).toHaveTextContent('レイヤー');
  });

  it('区切りは区画のあいだにだけ入る（先頭には出さない）', () => {
    render(
      <UiContextBar
        scoreType="piano"
        activeLayerPart={0}
        activeVoice={0}
        activeToolbarTab="notes"
        tool={{ duration: '4' }}
      />
    );
    expect(document.querySelectorAll('.ui-context-bar-separator')).toHaveLength(2);
    expect(screen.getByTestId('ui-context-bar').textContent?.startsWith('/')).toBe(false);
  });

  it('レイヤーの無い譜種では区画も区切りも減る', () => {
    render(
      <UiContextBar
        scoreType="single"
        activeLayerPart={0}
        activeVoice={0}
        activeToolbarTab="playback"
        tool={{ mode: 'select' }}
      />
    );
    expect(screen.queryByTestId('ui-context-bar-layer')).toBeNull();
    expect(document.querySelectorAll('.ui-context-bar-separator')).toHaveLength(1);
    expect(screen.getByTestId('ui-context-bar-tool')).toHaveTextContent('小節選択');
  });
});
