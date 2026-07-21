// src/components/PianoSystemCanvasGroupBarline.test.tsx
// Issue #28: 編成譜の小節線を「楽器グループ内だけ」縦に接続し、グループ間では
// 切るようにする浄書慣習対応のリグレッションテスト。
//
// VexFlow の StaveConnector.draw() は「どの Stave から どの Stave まで」を
// 線で繋ぐかを topStave/bottomStave として保持している。ここでは実際に SVG へ
// 描画される直前の StaveConnector.draw() をフックし、どの段からどの段までが
// 接続されたかを Stave インスタンスの同一性で検証する（ピクセル座標を直接
// 読むより VexFlow のバージョン差異に強い）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Stave, StaveConnector } from 'vexflow';

import PianoSystemCanvas, { type PartConfig } from './PianoSystemCanvas';
import { getInstrumentationPreset } from '../data/instrumentationPresets';

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

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function () {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

const tool = { duration: '4', isRest: false } as const;
const emptyMeasure = () => ([{ events: [{ dur: '4' as const, isRest: true, keys: ['b/4'] }] }]);

/**
 * partsConfig を描画し、右端小節線（StaveConnector.SINGLE_RIGHT/BOLD_DOUBLE_RIGHT）が
 * どの段（Stave インスタンス）とどの段を接続したかを返す。
 * 段の並び順は partsConfig と同じ（= 各段の Stave 生成順）であることを、
 * setContext() のフックで別途記録して保証する。
 */
function renderAndCaptureRightEdgeConnectors(partsConfig: PartConfig[]) {
  const stavesInOrder: Stave[] = [];
  // 段の生成順（= partsConfig と同じ順）を記録する。setContext() は
  // PianoSystemCanvas が各 Stave の描画準備の最後に必ず1回だけ呼ぶため、
  // これをフックすれば段の生成順を安全に観測できる。
  const originalSetContext = Stave.prototype.setContext;
  vi.spyOn(Stave.prototype, 'setContext').mockImplementation(function (
    this: Stave,
    ...args: Parameters<typeof originalSetContext>
  ) {
    stavesInOrder.push(this);
    return originalSetContext.apply(this, args);
  });

  const rightEdgeConnectors: Array<{ type: number; topStave: Stave; bottomStave: Stave }> = [];
  const originalDraw = StaveConnector.prototype.draw;
  vi.spyOn(StaveConnector.prototype, 'draw').mockImplementation(function (this: StaveConnector) {
    const type = this.getType();
    if (type === StaveConnector.type.SINGLE_RIGHT || type === StaveConnector.type.BOLD_DOUBLE_RIGHT) {
      rightEdgeConnectors.push({
        type,
        topStave: this.topStave,
        bottomStave: this.bottomStave,
      });
    }
    return originalDraw.call(this);
  });

  render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={tool}
      scale={1}
      partsConfig={partsConfig}
    />
  );

  vi.restoreAllMocks();

  return { stavesInOrder, rightEdgeConnectors };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('編成譜の小節線グループ接続（Issue #28）', () => {
  it('二管編成オーケストラで、木管グループ内（Fl.〜Bsn.）は小節線が連続し、木管末尾（Bsn.）→金管先頭（Hn.）はまたがない', () => {
    const preset = getInstrumentationPreset('classical-orchestra');
    // Fl,Ob,Cl,Bsn(woodwinds) / Hn,Tpt(brass),Timp(percussion) / Vln1,Vln2,Vla,Vc,Cb(strings)
    const partsConfig: PartConfig[] = preset.parts.map((part) => ({
      clef: part.clef,
      label: part.abbreviation,
      bracketGroup: part.bracketGroup,
      subBracketGroup: part.subBracketGroup,
      data: emptyMeasure(),
      onChange: () => {},
    }));

    const flIndex = preset.parts.findIndex((p) => p.id === 'flute-1-2');
    const bsnIndex = preset.parts.findIndex((p) => p.id === 'bassoon-1-2');
    const hnIndex = preset.parts.findIndex((p) => p.id === 'horn-1-2');
    expect(flIndex).toBeGreaterThanOrEqual(0);
    expect(bsnIndex).toBe(flIndex + 3); // Fl,Ob,Cl,Bsn の4段連続を前提にした並び
    expect(hnIndex).toBe(bsnIndex + 1); // Bsn の直後が Hn（木管→金管の境目）

    const { stavesInOrder, rightEdgeConnectors } = renderAndCaptureRightEdgeConnectors(partsConfig);
    const staveOf = (index: number) => stavesInOrder[index];

    // グループ内（Fl.〜Bsn.）は1本の StaveConnector で接続されている
    const woodwindConnector = rightEdgeConnectors.find(
      (c) => c.topStave === staveOf(flIndex) && c.bottomStave === staveOf(bsnIndex)
    );
    expect(woodwindConnector).toBeDefined();

    // Bsn.（木管末尾）→ Hn.（金管先頭）をまたぐ接続は存在しない
    const crossesGroupBoundary = rightEdgeConnectors.some((c) => {
      const topIdx = stavesInOrder.indexOf(c.topStave);
      const botIdx = stavesInOrder.indexOf(c.bottomStave);
      return topIdx <= bsnIndex && botIdx >= hnIndex;
    });
    expect(crossesGroupBoundary).toBe(false);

    // 旧実装のバグ（全段を1本でまたぐ）が復活していないことも確認する
    const spansEverything = rightEdgeConnectors.some(
      (c) => c.topStave === staveOf(0) && c.bottomStave === staveOf(stavesInOrder.length - 1)
    );
    expect(spansEverything).toBe(false);
  });

  it('弦楽四重奏（既存の単一グループ）は従来通り全段が1本で接続される', () => {
    const preset = getInstrumentationPreset('string-quartet');
    const partsConfig: PartConfig[] = preset.parts.map((part) => ({
      clef: part.clef,
      label: part.abbreviation,
      bracketGroup: part.bracketGroup,
      subBracketGroup: part.subBracketGroup,
      data: emptyMeasure(),
      onChange: () => {},
    }));

    const { stavesInOrder, rightEdgeConnectors } = renderAndCaptureRightEdgeConnectors(partsConfig);

    expect(rightEdgeConnectors.length).toBe(1);
    expect(rightEdgeConnectors[0].topStave).toBe(stavesInOrder[0]);
    expect(rightEdgeConnectors[0].bottomStave).toBe(stavesInOrder[stavesInOrder.length - 1]);
  });

  it('ピアノ大譜表（bracketGroup未指定の後方互換2段）も従来通り全段が1本で接続される', () => {
    const { stavesInOrder, rightEdgeConnectors } = renderAndCaptureRightEdgeConnectors([
      { clef: 'treble', data: emptyMeasure(), onChange: () => {} },
      { clef: 'bass', data: emptyMeasure(), onChange: () => {} },
    ]);

    expect(rightEdgeConnectors.length).toBe(1);
    expect(rightEdgeConnectors[0].topStave).toBe(stavesInOrder[0]);
    expect(rightEdgeConnectors[0].bottomStave).toBe(stavesInOrder[stavesInOrder.length - 1]);
  });
});
