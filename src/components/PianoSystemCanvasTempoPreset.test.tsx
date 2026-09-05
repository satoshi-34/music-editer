// src/components/PianoSystemCanvasTempoPreset.test.tsx
// Issue #457: テンポ表記の入力欄に定番の速度標語（Andante・Allegro 等）を候補として出す。
//
// ここで固定するのは次の4点（Issue の受入条件に対応）:
//   - テンポ表記の入力欄が候補リスト（datalist）に紐づき、定番12語がすべて候補に出る
//   - 候補を選んで確定すると、保存データには従来どおり tempoMarking の文字列として入る
//   - 候補に無い語の自由入力が従来どおり通る（候補は補助であって制約ではない）
//   - 他の種別（発想標語など）には候補を出さない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { TEMPO_MARKING_PRESETS, TEMPO_MARKING_DATALIST_ID } from '../utils/tempoMarkingPresets';

// 音声系はこのテストの対象外なので、描画だけ通るように丸ごとモックする。
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

const TEST_CONTAINER_WIDTH = 700;

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする
// （こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」となり、狙った位置を素直に指定できる）。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/** 音符4つの1小節 */
function fourNoteMeasure(): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
      { dur: '4', isRest: false, keys: ['e/5'] },
      { dur: '4', isRest: false, keys: ['f/5'] },
    ],
  }];
}

describe('PianoSystemCanvas テンポ表記の定番候補（Issue #457）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  /** 指定のテキスト種別のツールで描画し、1つ目の音符をクリックして入力欄を開く */
  function openTextEditor(kind: 'tempoMarking' | 'expressionMarking') {
    const data = fourNoteMeasure();
    const onChange = vi.fn();
    const view = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ mode: 'textElement', textKind: kind } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );
    const svg = view.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);

    const hit = svg.querySelector(
      'rect.vf-note-hit[data-measure="0"][data-note="0"]'
    ) as SVGRectElement;
    expect(hit).toBeTruthy();
    fireEvent.click(hit, {
      clientX: (Number(hit.getAttribute('data-note-left')) + Number(hit.getAttribute('data-note-right'))) / 2,
      clientY: Number(hit.getAttribute('y')) + 10,
    });

    const input = view.container.querySelector('input') as HTMLInputElement;
    expect(input, '入力欄が開くこと').toBeTruthy();
    return { ...view, input, onChange };
  }

  it('受入1: テンポ表記の入力欄が候補リストに紐づき、定番12語がすべて候補に出る', () => {
    const { container, input } = openTextEditor('tempoMarking');

    // input と datalist は id 参照で結ばれている（この配線が切れると候補が一切出なくなる）
    expect(input.getAttribute('list')).toBe(TEMPO_MARKING_DATALIST_ID);
    const datalist = container.querySelector(`datalist#${TEMPO_MARKING_DATALIST_ID}`);
    expect(datalist, '候補リストが描画されていること').toBeTruthy();

    const options = Array.from(datalist!.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual([...TEMPO_MARKING_PRESETS]);
    // ユーザーフィードバックで名指しされた2語は必ず入っている
    expect(options).toContain('Andante');
    expect(options).toContain('Allegro');
  });

  it('受入2: 候補を選んで確定すると tempoMarking の文字列として保存される', () => {
    const { input, onChange } = openTextEditor('tempoMarking');

    // 候補の選択はブラウザが入力欄へ値を入れる操作なので、値の変更として再現する
    fireEvent.change(input, { target: { value: 'Andante' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
    // 保存形式は従来と同じ（イベント直下の tempoMarking に文字列が入るだけ）
    expect(saved[0].events[0].tempoMarking).toBe('Andante');
  });

  it('受入3: 候補に無い語の自由入力も従来どおり保存される（候補は制約ではない）', () => {
    const { input, onChange } = openTextEditor('tempoMarking');

    fireEvent.change(input, { target: { value: 'Adagio sostenuto' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const saved = onChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(saved[0].events[0].tempoMarking).toBe('Adagio sostenuto');
  });

  it('受入4: 発想標語の入力欄には候補を出さない', () => {
    const { container, input } = openTextEditor('expressionMarking');

    expect(input.getAttribute('list')).toBeNull();
    expect(container.querySelector('datalist')).toBeNull();
  });
});
