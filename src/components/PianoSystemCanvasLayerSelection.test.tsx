// 編集レイヤー明示選択（#316）: 手×声部のレイヤーで編集対象を絞る挙動の検証。
// 設計は .claude/specs/editor-layer-selection/design.md（裁定②案B・③案A）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { SCORE_ACTIVE_VOICE_CHANGE_EVENT, type ScoreActiveVoiceChangeDetail } from '../utils/scoreEditorNotices';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));
vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));
vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn()
    };
  })
}));

const TEST_CONTAINER_WIDTH = 900;

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 400;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

const note = (key: string): MeasureData['events'][number] => ({ dur: '4', isRest: false, keys: [key] });

function renderPiano(activeLayerPartIndex?: number) {
  const right: MeasureData[] = [{ events: [note('c/5'), note('d/5'), note('e/5'), note('f/5')] }];
  // 左手は2音だけにして空きを残す（空白クリック挿入の検証で満杯にならないように）
  const left: MeasureData[] = [{ events: [note('c/3'), note('d/3')] }];
  const onRightChange = vi.fn();
  const onLeftChange = vi.fn();
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[
        { clef: 'treble', data: right, onChange: onRightChange, label: '右手' },
        { clef: 'bass', data: left, onChange: onLeftChange, label: '左手' },
      ]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      activeVoiceIndex={0}
      {...(activeLayerPartIndex !== undefined ? { activeLayerPartIndex } : {})}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  return { svg, onRightChange, onLeftChange };
}

describe('PianoSystemCanvas 編集レイヤー明示選択（#316）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });
  afterEach(() => {
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('レイヤー=右手のとき、左手の音符には編集用セルが作られず選択専用ヒットになる', () => {
    const { svg } = renderPiano(0);
    // 編集用セル（.vf-note-hit）は右手の4イベントぶんだけ
    expect(svg.querySelectorAll('.vf-note-hit').length).toBe(4);
    // 左手の音符（2音）は選択専用ヒット（.vf-inactive-voice-note-hit）になる
    expect(svg.querySelectorAll('.vf-inactive-voice-note-hit').length).toBeGreaterThanOrEqual(2);
  });

  it('レイヤー未指定（従来モード）では両手に編集用セルが作られる（後方互換）', () => {
    const { svg } = renderPiano(undefined);
    // 右手4 + 左手2音+末尾パディング表示ぶんのセル（左手は空き2拍が詰め物になりセル数は実イベント+詰め物）
    expect(svg.querySelectorAll('.vf-note-hit').length).toBeGreaterThanOrEqual(6);
  });

  it('レイヤー外（左手）の符頭クリックはパート付きのレイヤー切替を要求する', () => {
    const { svg } = renderPiano(0);
    const events: ScoreActiveVoiceChangeDetail[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail);
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    try {
      const hit = svg.querySelectorAll('.vf-inactive-voice-note-hit')[0] as SVGRectElement;
      const x = parseFloat(hit.getAttribute('x') ?? '0') + parseFloat(hit.getAttribute('width') ?? '0') / 2;
      const y = parseFloat(hit.getAttribute('y') ?? '0') + parseFloat(hit.getAttribute('height') ?? '0') / 2;
      fireEvent.click(hit, { clientX: x, clientY: y });
      expect(events).toHaveLength(1);
      expect(events[0].partIndex).toBe(1);
      expect(events[0].voiceIndex).toBe(0);
    } finally {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    }
  });

  it('レイヤー=右手でも、左手の帯の空白クリックは左手パートへ挿入される（裁定②案B）+ レイヤー自動切替', () => {
    const { svg, onLeftChange, onRightChange } = renderPiano(0);
    const events: ScoreActiveVoiceChangeDetail[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail);
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    try {
      // 左手の小節背景（2つ目の .vf-hit）の空き（3拍目以降）をクリック
      const bg = svg.querySelectorAll('rect.vf-hit')[1] as SVGRectElement;
      const bx = parseFloat(bg.getAttribute('x') ?? '0');
      const bw = parseFloat(bg.getAttribute('width') ?? '0');
      const by = parseFloat(bg.getAttribute('y') ?? '0');
      const bh = parseFloat(bg.getAttribute('height') ?? '0');
      fireEvent.click(bg, { clientX: bx + bw * 0.85, clientY: by + bh * 0.5 });
      // 帯域帰属（裁定②案B）: 右手ではなく左手パートへ入る
      expect(onRightChange).not.toHaveBeenCalled();
      expect(onLeftChange).toHaveBeenCalled();
      const nextLeft = onLeftChange.mock.calls.at(-1)![0] as MeasureData[];
      expect(nextLeft[0].events.filter((ev) => !ev.isRest).length).toBe(3);
      // 入れた先へレイヤー自動切替（パート付きの要求）+ 声部はセレクタ（0）のまま
      const switchEv = events.find((d) => d.partIndex === 1);
      expect(switchEv).toBeTruthy();
      expect(switchEv?.voiceIndex).toBe(0);
    } finally {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    }
  });
});
