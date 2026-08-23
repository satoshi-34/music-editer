// 記号の「選択→Delete」統一（Issue #389）。
// 弧・松葉だけだった「クリックで選択 → Delete で削除」を、強弱・アーティキュレーション・
// カスタム記号などの調整可能記号へ広げる:
//   1. 調整ツール（✥/⤢）を持っていないときの記号クリック = 選択のみ（青枠・通知）
//   2. 選択中の Delete / Backspace で削除（種類単位・通知つき）
//   3. 入力欄にフォーカスがあるときの Delete は文字編集を優先（削除しない）
//   4. Esc・背景クリックで選択解除。音符の選択とは排他
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return { playNoteEvent: vi.fn().mockResolvedValue(undefined), setSoundSource: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: { isInitializedState: vi.fn().mockReturnValue(false), initialize: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return { getCurrentInstrument: vi.fn().mockReturnValue('piano'), setCurrentInstrument: vi.fn(), loadInstrument: vi.fn().mockResolvedValue(undefined), reconnectAllSynths: vi.fn(), dispose: vi.fn() };
  })
}));

const WIDTH = 700;

// 音符ツール（＝調整ツールを持っていない状態）で描く。この状態の記号クリックが
// Issue #389 で「選択」に変わった経路
const NOTE_TOOL = { duration: '4', isRest: false };

/** jsdom は SVG のレイアウト値を持たないので、音符クリックの座標計算に要る分だけ埋める
    （PartExtractionStaffSymbols.test.tsx と同じやり方） */
function mockSvgLayout(svg: SVGSVGElement) {
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: WIDTH, bottom: height, width: WIDTH, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: WIDTH } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

function renderCanvas(events: MeasureData['events'], tool: unknown = NOTE_TOOL) {
  const onChange = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={tool as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data: [{ events }], onChange }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      symbolsClickable={true}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  if (svg) mockSvgLayout(svg);
  return { container, onChange };
}

const PP_EVENT: MeasureData['events'][number] = {
  dur: '1', isRest: false, keys: ['b/4'],
  dynamics: [{ value: 'pp' }],
  // 調整値も持たせて、削除で symbolAdjust ごと片付くことまで見る
  symbolAdjust: { dynamics: { offsetY: -20 } },
};

function clickSymbol(container: HTMLElement) {
  const region = container.querySelector('.symbol-hit-region') as SVGRectElement;
  expect(region).toBeTruthy();
  fireEvent.click(region, { clientX: 10, clientY: 10 });
}

function collectNotices(): { notices: string[]; stop: () => void } {
  const notices: string[] = [];
  const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
  window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
  return { notices, stop: () => window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice) };
}

describe('記号の選択→Delete（Issue #389）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
    (SVGElement.prototype as unknown as { getBBox: () => { x: number; y: number; width: number; height: number } }).getBBox =
      () => ({ x: 0, y: 0, width: 10, height: 10 });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  });

  it('記号クリックで選択（青枠）になり、オーバーレイは開かない', () => {
    const { notices, stop } = collectNotices();
    try {
      const { container, onChange } = renderCanvas([PP_EVENT]);
      clickSymbol(container);
      const selected = container.querySelector('.symbol-hit-region--selected') as SVGRectElement;
      expect(selected).toBeTruthy();
      expect(selected.getAttribute('stroke')).toBe('#2563eb');
      expect(container.querySelector('.symbol-adjust-overlay')).toBeNull();
      // 選択しただけなので譜面は変わらない
      expect(onChange).not.toHaveBeenCalled();
      expect(notices.join(' ')).toContain('強弱記号を選択しました');
    } finally { stop(); }
  });

  it('選択中の Delete で記号が消える（調整値も一緒に消え、通知が出る）', () => {
    const { notices, stop } = collectNotices();
    try {
      const { container, onChange } = renderCanvas([PP_EVENT]);
      clickSymbol(container);
      fireEvent.keyDown(window, { key: 'Delete' });
      const saved = onChange.mock.calls.at(-1)![0][0].events[0];
      expect(saved.dynamics).toBeUndefined();
      expect(saved.symbolAdjust?.dynamics).toBeUndefined();
      expect(notices.join(' ')).toContain('強弱記号を削除しました');
      // 消えた記号の選択は残さない
      expect(container.querySelector('.symbol-hit-region--selected')).toBeNull();
    } finally { stop(); }
  });

  it('Backspace でも削除できる', () => {
    const { container, onChange } = renderCanvas([PP_EVENT]);
    clickSymbol(container);
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onChange.mock.calls.at(-1)![0][0].events[0].dynamics).toBeUndefined();
  });

  it('アーティキュレーションも同じ動線で消せる', () => {
    const { container, onChange } = renderCanvas(
      [{ dur: '1', isRest: false, keys: ['b/4'], articulations: ['staccato'] }],
    );
    clickSymbol(container);
    expect(container.querySelector('.symbol-hit-region--selected')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onChange.mock.calls.at(-1)![0][0].events[0].articulations).toBeUndefined();
  });

  it('入力欄にフォーカスがあるときの Delete は文字編集を優先し、記号を消さない（受入条件3）', () => {
    const { container, onChange } = renderCanvas([PP_EVENT]);
    clickSymbol(container);
    // 実アプリの「歌詞・記号調整の入力欄にフォーカスがある」状態を、入力欄からの
    // keydown（e.target が input）で再現する
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      fireEvent.keyDown(input, { key: 'Delete' });
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('.symbol-hit-region--selected')).toBeTruthy();
    } finally { document.body.removeChild(input); }
  });

  it('Esc で選択が外れ、その後の Delete では消えない', () => {
    const { container, onChange } = renderCanvas([PP_EVENT]);
    clickSymbol(container);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.symbol-hit-region--selected')).toBeNull();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('同じ記号をもう一度クリックすると ✥（位置調整）が開く（2段階）', () => {
    const { container } = renderCanvas([PP_EVENT]);
    clickSymbol(container);
    clickSymbol(container);
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('記号位置調整');
  });

  // 受入条件2（Delete の対象は常に1つ）は、選択の入れ物が「音符・弧・松葉・記号」で
  // 1つしか持てない union（editorLocalReducer の SelectionUnion）であることで型の上から
  // 保証している。ここでは画面から確かめられる側面として「譜面の空白クリックで外れる」を固定する
  it('譜面の空白（SVG 背景）クリックで選択が外れる', () => {
    const { container, onChange } = renderCanvas([PP_EVENT]);
    clickSymbol(container);
    expect(container.querySelector('.symbol-hit-region--selected')).toBeTruthy();
    fireEvent.click(container.querySelector('svg') as SVGSVGElement);
    expect(container.querySelector('.symbol-hit-region--selected')).toBeNull();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('⤢（サイズ変更ツール）選択中は従来どおり1クリックでサイズ調整が開く（選択は挟まない）', () => {
    const { container } = renderCanvas([PP_EVENT], { mode: 'symbolAdjustResize' });
    clickSymbol(container);
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('記号サイズ変更');
    expect(container.querySelector('.symbol-hit-region--selected')).toBeNull();
  });
});
