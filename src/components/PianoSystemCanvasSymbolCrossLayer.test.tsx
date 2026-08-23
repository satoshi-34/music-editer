// 他のレイヤー（手×声部）の記号をクリックしたときの挙動（2026-08-24 運用者裁定A）。
// 画面上どの記号がどの声部のものかは見分けられないため、レイヤーを合わせないと
// 触れない仕様では「押しても無反応＝壊れている」ように見える。#316 の音符クリックと
// 同じ型で、そのレイヤーへ切り替えてから調整の小窓を開く（切り替えは必ず通知する）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import {
  SCORE_ACTIVE_VOICE_CHANGE_EVENT,
  SCORE_EDIT_NOTICE_EVENT,
  type ScoreActiveVoiceChangeDetail,
} from '../utils/scoreEditorNotices';

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

const WIDTH = 900;

/**
 * 月光 m5 型: 右手の声部1（メロディ）と声部2（三連符）の**両方**に pp が付いている。
 * 画面では同じ字形で並ぶので、どちらがどの声部のものかは見分けられない。
 */
const RIGHT_HAND: MeasureData[] = [{
  events: [{ dur: '2', isRest: false, keys: ['a/4'], dynamics: [{ value: 'pp' }] }],
  voices: [
    { id: 'voice-1', events: [{ dur: '2', isRest: false, keys: ['a/4'], dynamics: [{ value: 'pp' }] }] },
    { id: 'voice-2', events: [{ dur: '2', isRest: false, keys: ['e/3'], dynamics: [{ value: 'f' }] }] },
  ],
}];
const LEFT_HAND: MeasureData[] = [{ events: [{ dur: '1', isRest: false, keys: ['c/3'], dynamics: [{ value: 'mf' }] }] }];

function renderPiano(activeVoiceIndex: number, activeLayerPartIndex: number) {
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[
        { clef: 'treble', data: RIGHT_HAND, onChange: vi.fn(), label: '右手' },
        { clef: 'bass', data: LEFT_HAND, onChange: vi.fn(), label: '左手' },
      ]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      symbolsClickable={true}
      activeVoiceIndex={activeVoiceIndex}
      activeLayerPartIndex={activeLayerPartIndex}
    />
  );
  return container;
}

/** 指定した記号種の判定領域（data-symbol-* から声部・パートも読める） */
function regionsOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.symbol-hit-region')).map((r) => ({
    el: r as SVGRectElement,
    part: Number(r.getAttribute('data-symbol-part')),
    measure: Number(r.getAttribute('data-symbol-measure')),
    event: Number(r.getAttribute('data-symbol-event')),
  }));
}

describe('他レイヤーの記号クリック（2026-08-24 裁定A）', () => {
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

  it('非アクティブな声部・レイヤーの記号にもクリック判定が作られる', () => {
    // 右手・声部1 がアクティブ。右手声部2 の f と左手の mf にも判定がある
    const container = renderPiano(0, 0);
    const regions = regionsOf(container);
    expect(regions.length).toBeGreaterThanOrEqual(3);
    expect(regions.some((r) => r.part === 1)).toBe(true); // 左手（非アクティブレイヤー）
  });

  it('左手（非アクティブレイヤー）の記号をクリックすると、そのレイヤーへ切り替えて通知する', () => {
    const container = renderPiano(0, 0);
    const events: ScoreActiveVoiceChangeDetail[] = [];
    const notices: string[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail);
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      const leftRegion = regionsOf(container).find((r) => r.part === 1)!;
      fireEvent.click(leftRegion.el, { clientX: 5, clientY: 5 });
      // 左手へレイヤー切替が要求され、切り替えたことが通知される
      const switched = events.find((d) => d.partIndex === 1);
      expect(switched).toBeTruthy();
      expect(notices.join(' ')).toContain('左手');
      // そのうえで調整の小窓が開く（押しても無反応にはならない）
      expect(container.querySelector('.symbol-adjust-overlay')).toBeTruthy();
    } finally {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });

  it('同じレイヤー・同じ声部の記号クリックでは切替は起きない（通知も出ない）', () => {
    const container = renderPiano(0, 0);
    const events: ScoreActiveVoiceChangeDetail[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail);
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    try {
      // 右手（part 0）の記号のうち、アクティブ声部（voice 1）のもの
      const rightRegion = regionsOf(container).find((r) => r.part === 0)!;
      fireEvent.click(rightRegion.el, { clientX: 5, clientY: 5 });
      expect(events).toHaveLength(0);
      expect(container.querySelector('.symbol-adjust-overlay')).toBeTruthy();
    } finally {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    }
  });

  it('声部3以降の記号は、編集UIが対応していないことを伝えて終わる（切替も小窓も出さない）', () => {
    // 編集 UI（声部トグル）は2声まで。ScorePage が切替要求を無視するため、
    // 通知だけ出して調整画面を開くと「切り替えたと言われたのに実状態は変わらない」
    // 食い違いになる（音符クリックと同じガード・Codex最終ゲート P2）
    const threeVoices: MeasureData[] = [{
      events: [{ dur: '1', isRest: false, keys: ['a/4'] }],
      voices: [
        { id: 'voice-1', events: [{ dur: '1', isRest: false, keys: ['a/4'] }] },
        { id: 'voice-2', events: [{ dur: '1', isRest: false, keys: ['e/4'] }] },
        { id: 'voice-3', events: [{ dur: '1', isRest: false, keys: ['c/4'], dynamics: [{ value: 'ff' }] }] },
      ],
    }];
    const events: ScoreActiveVoiceChangeDetail[] = [];
    const notices: string[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail);
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: threeVoices, onChange: vi.fn(), label: '右手' }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          symbolsClickable={true}
          activeVoiceIndex={0}
        />
      );
      const region = container.querySelector('.symbol-hit-region') as SVGRectElement;
      expect(region).toBeTruthy();
      fireEvent.click(region, { clientX: 5, clientY: 5 });
      // 切替イベントも小窓も出さず、理由だけ伝える
      expect(events).toHaveLength(0);
      expect(container.querySelector('.symbol-adjust-overlay')).toBeNull();
      expect(notices.join(' ')).toContain('声部3');
    } finally {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });

  it('非アクティブレイヤーの休符に付いたコード記号も、クリックして調整値を保存できる', () => {
    // テキスト系・オッターバは休符にも付けられる。以前は symbolAdjust 側が休符を
    // 一律で除外していたため、小窓は開くのに保存されない無言の no-op だった
    // （#398 Codex round4 P2）
    const onRightChange = vi.fn();
    const withRestChord: MeasureData[] = [{
      events: [{ dur: '1', isRest: false, keys: ['a/4'] }],
      voices: [
        { id: 'voice-1', events: [{ dur: '1', isRest: false, keys: ['a/4'] }] },
        { id: 'voice-2', events: [{ dur: '1', isRest: true, keys: ['b/4'], chordSymbol: 'Am' }] },
      ],
    }];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data: withRestChord, onChange: onRightChange, label: '右手' }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        symbolsClickable={true}
        activeVoiceIndex={0}
      />
    );
    const region = Array.from(container.querySelectorAll('.symbol-hit-region'))
      .find((r) => (r.getAttribute('data-symbol-target') ?? '').includes('chordSymbol')) as SVGRectElement;
    expect(region).toBeTruthy();
    fireEvent.click(region, { clientX: 5, clientY: 5 });
    expect(container.querySelector('.symbol-adjust-overlay')).toBeTruthy();

    const yInput = container.querySelectorAll('.symbol-adjust-overlay input')[1] as HTMLInputElement;
    fireEvent.change(yInput, { target: { value: '-12' } });
    fireEvent.blur(yInput);
    const saved = onRightChange.mock.calls.at(-1)![0] as MeasureData[];
    expect(saved[0].voices![1].events[0].symbolAdjust?.chordSymbol?.offsetY).toBe(-12);
  });

  it('調整値は記号が属する声部へ書き戻される（アクティブ声部へ誤爆しない）', () => {
    // 右手・声部1 がアクティブな状態で、右手・声部2 の f を触って確定する
    const onRightChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: 'treble', data: RIGHT_HAND, onChange: onRightChange, label: '右手' },
          { clef: 'bass', data: LEFT_HAND, onChange: vi.fn(), label: '左手' },
        ]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        symbolsClickable={true}
        activeVoiceIndex={0}
        activeLayerPartIndex={0}
      />
    );
    // 右手の判定は声部1（a/4 の pp）と声部2（e/3 の f）の2つ。声部2 のものを選ぶため
    // data-symbol-target が dynamics の region を両方取り、2つ目（声部2）を使う
    const rightRegions = Array.from(container.querySelectorAll('.symbol-hit-region'))
      .filter((r) => Number(r.getAttribute('data-symbol-part')) === 0);
    expect(rightRegions.length).toBe(2);
    fireEvent.click(rightRegions[1], { clientX: 5, clientY: 5 });

    const input = container.querySelectorAll('.symbol-adjust-overlay input')[1] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-30' } });
    fireEvent.blur(input);

    const saved = onRightChange.mock.calls.at(-1)![0] as MeasureData[];
    // 声部2（f が付いている側）へ書かれ、声部1（pp）は無傷
    expect(saved[0].voices![1].events[0].symbolAdjust?.dynamics?.offsetY).toBe(-30);
    expect(saved[0].voices![0].events[0].symbolAdjust).toBeUndefined();
  });
});
