// src/components/QuartetStaffPartLabels.test.tsx
// Issue #448: 弦楽四重奏でもユーザーが書き換えた楽器名・略称を五線の左に出す。
// 「1段目=正式名・2段目以降=略称」という既存ルール（Issue #60）が、
// 名前を差し替えたあとも保たれることを EnsembleFullPartName.test.tsx と同じ手法で確かめる。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import QuartetStaff from './QuartetStaff';
import type { MeasureData } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function () {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  },
}));

const tool = { duration: '4', isRest: false } as const;
const emptyMeasure = (): MeasureData[] => ([{ events: [{ dur: '4' as const, isRest: true, keys: ['b/4'] }] }]);

/** 描画された SVG のテキストを段（system）ごとにまとめて返す */
function renderQuartet(options: {
  isFirstPage: boolean;
  partLabels?: ReadonlyArray<{ label?: string; fullLabel?: string }>;
}) {
  const { container } = render(
    <QuartetStaff
      tool={tool}
      scale={1}
      systems={2}
      measuresPerSystem={1}
      partsData={[0, 1, 2, 3].map(() => emptyMeasure())}
      onPartChange={[0, 1, 2, 3].map(() => () => {})}
      isFirstPage={options.isFirstPage}
      partLabels={options.partLabels}
    />
  );
  const systemNodes = Array.from(container.querySelectorAll('.system-stack > div'));
  return systemNodes.map((node) =>
    Array.from(node.querySelectorAll('text')).map((text) => text.textContent ?? '')
  );
}

const EDITED_LABELS = [
  { label: 'Vl. 1', fullLabel: 'Violino primo' },
  { label: 'Vl. 2', fullLabel: 'Violino secondo' },
  { label: 'Vla.', fullLabel: 'Viola' },
  { label: 'Vc.', fullLabel: 'Violoncello' },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('弦楽四重奏のパート名差し替え（Issue #448）', () => {
  it('partLabels 未指定なら従来どおり既定名（Violin I / Vn. I）で描く', () => {
    expect(renderQuartet({ isFirstPage: true })[0]).toContain('Violin I');
    expect(renderQuartet({ isFirstPage: false })[0]).toContain('Vn. I');
  });

  it('1ページ目の1段目は、書き換えた正式名で描く', () => {
    const labelsPerSystem = renderQuartet({ isFirstPage: true, partLabels: EDITED_LABELS });

    expect(labelsPerSystem[0]).toContain('Violino primo');
    expect(labelsPerSystem[0]).not.toContain('Violin I');
    // 既定の略称も残らない（差し替えは略称・フル名の両方に効く）
    expect(labelsPerSystem[0]).not.toContain('Vn. I');
  });

  it('2ページ目以降の先頭段は、書き換えた略称で描く', () => {
    const labelsPerSystem = renderQuartet({ isFirstPage: false, partLabels: EDITED_LABELS });

    expect(labelsPerSystem[0]).toContain('Vl. 1');
    expect(labelsPerSystem[0]).not.toContain('Violino primo');
  });

  it('名前を空にしたパートはラベルを描かない（空欄をそのまま尊重する）', () => {
    const labelsPerSystem = renderQuartet({
      isFirstPage: true,
      partLabels: [{ label: undefined, fullLabel: undefined }, ...EDITED_LABELS.slice(1)],
    });

    expect(labelsPerSystem[0]).not.toContain('Violin I');
    expect(labelsPerSystem[0]).toContain('Violino secondo');
  });
});
