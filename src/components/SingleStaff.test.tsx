// src/components/SingleStaff.test.tsx
// SingleStaff は「PianoSystemCanvas を systems 段ぶんループで積み重ねる」だけの
// 薄いラッパーなので、PianoSystemCanvas 自体の描画ロジックはモックして
// 「段数ぶん呼ばれるか」「props が正しく変換されて渡るか」だけを検証する。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import SingleStaff from './SingleStaff';
import type { MeasureData } from '../types/storage';

// PianoSystemCanvas をモックして、受け取った props を data-* 属性として書き出す。
// 実際の VexFlow 描画は別コンポーネントのテストで担保済みのため、ここでは不要。
vi.mock('./PianoSystemCanvas', () => ({
  default: (props: any) => (
    <div
      data-testid="piano-system-canvas"
      data-start-measure-index={props.startMeasureIndex}
      data-measures-per-system={props.measuresPerSystem}
      data-disabled={String(props.disabled)}
      data-parts-count={props.partsConfig?.length}
      data-parts-clef={props.partsConfig?.[0]?.clef}
      data-key-signature={props.keySignature}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sampleData: MeasureData[] = [
  { events: [] },
];

describe('SingleStaff', () => {
  it('systems の数だけ PianoSystemCanvas をレンダーする', () => {
    render(
      <SingleStaff
        tool="select"
        systems={4}
        measuresPerSystem={3}
        initialScoreData={sampleData}
      />
    );

    const canvases = screen.getAllByTestId('piano-system-canvas');
    expect(canvases).toHaveLength(4);
  });

  it('段ごとに startMeasureIndex を measuresPerSystem 分ずらす', () => {
    render(
      <SingleStaff
        tool="select"
        systems={3}
        measuresPerSystem={2}
        startMeasureIndex={10}
        initialScoreData={sampleData}
      />
    );

    const canvases = screen.getAllByTestId('piano-system-canvas');
    expect(canvases.map((c) => c.getAttribute('data-start-measure-index'))).toEqual([
      '10',
      '12',
      '14',
    ]);
  });

  it('initialScoreData/clef を partsConfig 要素数1に変換して渡す', () => {
    render(
      <SingleStaff tool="select" systems={1} initialScoreData={sampleData} />
    );

    const canvas = screen.getByTestId('piano-system-canvas');
    expect(canvas.getAttribute('data-parts-count')).toBe('1');
    expect(canvas.getAttribute('data-parts-clef')).toBe('treble');
  });

  it('disabled・keySignature などの props をそのまま伝搬する', () => {
    render(
      <SingleStaff
        tool="select"
        systems={1}
        disabled
        keySignature="G"
        initialScoreData={sampleData}
      />
    );

    const canvas = screen.getByTestId('piano-system-canvas');
    expect(canvas.getAttribute('data-disabled')).toBe('true');
    expect(canvas.getAttribute('data-key-signature')).toBe('G');
  });

  it('initialScoreData/systems 省略時もデフォルト値でレンダーできる', () => {
    render(<SingleStaff tool="select" />);
    const canvases = screen.getAllByTestId('piano-system-canvas');
    expect(canvases).toHaveLength(9); // デフォルト systems=9
  });
});
