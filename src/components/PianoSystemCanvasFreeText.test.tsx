// src/components/PianoSystemCanvasFreeText.test.tsx
// Issue #421: 音符に紐づかない自由注釈テキストを、小節アンカー＋オフセットで置けることのテスト。
//
// PianoSystemCanvas は「1回の呼び出しで1段だけ描く」設計で、呼び出し側が
// startMeasureIndex を渡す。段割り（段あたり小節数）を変えたときの追従は、
// 「同じ絶対小節が別の段・別の x に描かれる」ことで確認する。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
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
const measure = (): MeasureData => ({ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] });
const measures = (count: number): MeasureData[] => Array.from({ length: count }, measure);

/** 指定した小節に自由注釈を付けた小節配列を作る */
const withFreeText = (
  count: number,
  index: number,
  freeText: NonNullable<MeasureData['freeText']>,
): MeasureData[] => {
  const list = measures(count);
  list[index] = { ...list[index], freeText };
  return list;
};

const freeTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGTextElement>('text.vf-free-text'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PianoSystemCanvas の自由注釈テキスト（Issue #421）', () => {
  it('自由注釈の無い譜面には注釈テキストを1つも描かない（回帰防止）', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={4}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{ clef: 'treble', data: measures(4), onChange: () => {} }]}
      />
    );
    expect(freeTexts(container)).toHaveLength(0);
  });

  it('1小節目に置いた注釈を、五線の上へイタリックのセリフ体で描く', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={4}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{
          clef: 'treble',
          data: withFreeText(4, 0, { text: 'senza sordini' }),
          onChange: () => {},
        }]}
      />
    );

    const texts = freeTexts(container);
    expect(texts).toHaveLength(1);
    expect(texts[0].textContent).toBe('senza sordini');
    // 発想標語と同じイタリック・同じ基準サイズ（トリアージの「既定の見た目は発想標語と同じ」）
    expect(texts[0].getAttribute('font-style')).toBe('italic');
    expect(Number(texts[0].getAttribute('font-size'))).toBeCloseTo(ENGRAVING_TEXT_UNITS.expressiveText);
    expect(texts[0].getAttribute('font-family')).toMatch(/serif/);

    // 位置は「その小節の左端」を基準にする（絶対値は段の幅に依存するため、
    // 具体的な x の検証は段割り変更のテストで相対比較する）
    expect(Number.isFinite(Number(texts[0].getAttribute('x')))).toBe(true);
    // 表示専用。譜面のクリック（音符入力・小節選択）を横取りしない
    expect(texts[0].getAttribute('pointer-events')).toBe('none');
  });

  it('大譜表の下段に置いた注釈は、上段に置いた場合より下（＝下段の五線の上）に描かれる', () => {
    const { container: onTop } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        trebleData={withFreeText(2, 0, { text: 'delicatissimamente' })}
        bassData={measures(2)}
      />
    );
    const topY = Number(freeTexts(onTop)[0].getAttribute('y'));
    cleanup();

    const { container: onBottom } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        trebleData={measures(2)}
        bassData={withFreeText(2, 0, { text: 'sempre pianissimo' })}
      />
    );
    const bottomTexts = freeTexts(onBottom);

    expect(bottomTexts).toHaveLength(1);
    expect(bottomTexts[0].textContent).toBe('sempre pianissimo');
    // 下段（左手）の五線は上段より下にあるので、その上に置いた注釈の y も大きくなる
    expect(Number(bottomTexts[0].getAttribute('y'))).toBeGreaterThan(topY);
  });

  it('上段・下段の両方に置くと、それぞれの五線の上に1つずつ描かれる（月光冒頭の2つの指示文）', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        trebleData={withFreeText(2, 0, { text: 'delicatissimamente' })}
        bassData={withFreeText(2, 0, { text: 'sempre pianissimo' })}
      />
    );
    const texts = freeTexts(container);
    expect(texts.map((t) => t.textContent)).toEqual(['delicatissimamente', 'sempre pianissimo']);
    expect(Number(texts[1].getAttribute('y'))).toBeGreaterThan(Number(texts[0].getAttribute('y')));
  });

  it('段あたり小節数を変えても、注釈は同じ小節に付いてくる（段の3小節目→次の段の先頭へ）', () => {
    // 4小節/段: 絶対小節2は段の3つめ＝段の左端よりかなり右
    const { container: wide } = render(
      <PianoSystemCanvas
        measuresPerSystem={4}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{ clef: 'treble', data: withFreeText(4, 2, { text: 'ritenuto' }), onChange: () => {} }]}
      />
    );
    const wideX = Number(freeTexts(wide)[0].getAttribute('x'));
    cleanup();

    // 2小節/段に変えると、絶対小節2は「2段目の先頭」になる。
    // 同じ注釈が、その段の左端（＝小さい x）へ移動して描かれる
    const { container: narrow } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={2}
        partsConfig={[{ clef: 'treble', data: withFreeText(4, 2, { text: 'ritenuto' }), onChange: () => {} }]}
      />
    );
    const narrowTexts = freeTexts(narrow);
    expect(narrowTexts).toHaveLength(1);
    expect(narrowTexts[0].textContent).toBe('ritenuto');
    expect(Number(narrowTexts[0].getAttribute('x'))).toBeLessThan(wideX);
  });

  it('注釈のある小節が今回の段の範囲外なら描かない（別の段に描かれる）', () => {
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{ clef: 'treble', data: withFreeText(4, 2, { text: 'ritenuto' }), onChange: () => {} }]}
      />
    );
    expect(freeTexts(container)).toHaveLength(0);
  });

  it('サイズ・位置の調整が font-size と x/y に効く', () => {
    const { container: plain } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{ clef: 'treble', data: withFreeText(2, 0, { text: 'dolce' }), onChange: () => {} }]}
      />
    );
    const plainText = freeTexts(plain)[0];
    const baseX = Number(plainText.getAttribute('x'));
    const baseY = Number(plainText.getAttribute('y'));
    const baseSize = Number(plainText.getAttribute('font-size'));
    cleanup();

    const { container: adjusted } = render(
      <PianoSystemCanvas
        measuresPerSystem={2}
        tool={tool}
        scale={1}
        startMeasureIndex={0}
        partsConfig={[{
          clef: 'treble',
          data: withFreeText(2, 0, { text: 'dolce', scale: 1.5, offsetX: 20, offsetY: -8 }),
          onChange: () => {},
        }]}
      />
    );
    const adjustedText = freeTexts(adjusted)[0];

    expect(Number(adjustedText.getAttribute('font-size'))).toBeCloseTo(baseSize * 1.5);
    expect(Number(adjustedText.getAttribute('x'))).toBeCloseTo(baseX + 20);
    // 縦は「＋で下・−で上」（記号位置調整と同じ向き）
    expect(Number(adjustedText.getAttribute('y'))).toBeCloseTo(baseY - 8);
  });
});
