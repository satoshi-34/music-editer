// src/components/PianoSystemCanvasFingeringSize.test.tsx
// Issue #232: 運指（指番号）の既定フォントサイズを 10 u → 18 u（従来の180%）へ拡大する。
//
// このテストが見張るのは次の2つ。
//   1. 個別調整をしていない運指が「既定サイズ（engravingDefaults の値）」で描かれること
//      ＝ 描画側に 10 のようなハードコードが戻ってこないこと
//   2. symbolAdjust.fingering.scale が「既定に対する倍率」のままであること
//      （例: 50% を掛けたら 18 u × 0.5 = 9 u。既定を変えても相対倍率の意味は変えない）
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import { ENGRAVING_TEXT_UNITS } from '../utils/engravingDefaults';

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

/** 運指テキストは「数字1文字」なので、拍子記号などと混ざらないよう専用の目印で探す */
const FINGERING_TEXT = '3';

/** 描画された SVG から運指の <text> を1件だけ取り出す */
function findFingeringText(container: HTMLElement): SVGTextElement {
  const texts = Array.from(container.querySelectorAll('text')).filter(
    // アプリが自分で描く文字だけが SVG 直下に出る（VexFlow の文字は g.vf-* の中）。
    // 拍子記号の「3」を拾わないよう、親が SVG 要素そのものであることも条件にする。
    (t) => t.textContent === FINGERING_TEXT && t.parentElement?.tagName.toLowerCase() === 'svg'
  );
  expect(texts.length, '運指の <text> が1件だけ描かれていること').toBe(1);
  return texts[0] as unknown as SVGTextElement;
}

const measureWithFingering = (symbolAdjust?: Record<string, { scale?: number }>) => ({
  events: [
    {
      dur: '4' as const,
      isRest: false,
      keys: ['c/4'],
      fingering: FINGERING_TEXT,
      ...(symbolAdjust ? { symbolAdjust } : {}),
    },
  ],
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('運指の既定フォントサイズ（Issue #232）', () => {
  it('個別調整なしの運指は既定サイズ（18 u = 従来の180%）で描かれる', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{ clef: 'treble', data: [measureWithFingering()], onChange: () => {} }]}
      />
    );

    const el = findFingeringText(container);
    expect(Number(el.getAttribute('font-size'))).toBeCloseTo(ENGRAVING_TEXT_UNITS.fingering, 10);
    // 変更前のハードコード値（10 u）に戻っていないことを、値そのものでも固定しておく
    expect(Number(el.getAttribute('font-size'))).toBeCloseTo(18, 10);
  });

  it('個別調整 50% を掛けると既定サイズの半分になる（倍率の意味は「既定に対する比」のまま）', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[
          {
            clef: 'treble',
            data: [measureWithFingering({ fingering: { scale: 0.5 } })],
            onChange: () => {},
          },
        ]}
      />
    );

    const el = findFingeringText(container);
    expect(Number(el.getAttribute('font-size'))).toBeCloseTo(
      ENGRAVING_TEXT_UNITS.fingering * 0.5,
      10
    );
    expect(Number(el.getAttribute('font-size'))).toBeCloseTo(9, 10);
  });

  it('運指は五線に近い側の位置が変わらない（大きくなるぶんは上へ伸びる）', () => {
    // ベースライン（y）を基準に上へ字が伸びる描き方なので、既定を大きくしても
    // 五線・符頭との間隔は変わらない。ここでは y が scale に依存しないことを確認する。
    const renderWith = (scale?: number) =>
      render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={tool}
          scale={1}
          startMeasureIndex={0}
          partsConfig={[
            {
              clef: 'treble',
              data: [measureWithFingering(scale === undefined ? undefined : { fingering: { scale } })],
              onChange: () => {},
            },
          ]}
        />
      );

    const a = renderWith();
    const yDefault = findFingeringText(a.container).getAttribute('y');
    cleanup();
    const b = renderWith(0.5);
    const yHalf = findFingeringText(b.container).getAttribute('y');
    expect(yHalf).toBe(yDefault);
  });
});
