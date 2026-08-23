// 編集レイヤー明示選択（#316）: 手×声部のレイヤーで編集対象を絞る挙動の検証。
// 設計は .claude/specs/editor-layer-selection/design.md（裁定②は 2026-08-23 に案Aへ差し替え・③案A）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import { SCORE_ACTIVE_VOICE_CHANGE_EVENT, SCORE_EDIT_NOTICE_EVENT, type ScoreActiveVoiceChangeDetail } from '../utils/scoreEditorNotices';
import { keyToMidi } from '../utils/noteMidiUtils';

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

function renderPiano(activeLayerPartIndex?: number, options?: { rightHasRoom?: boolean }) {
  // 既定は満杯の右手（既存テストの前提）。挿入テストは rightHasRoom で空きを作る
  const right: MeasureData[] = [{
    events: options?.rightHasRoom
      ? [note('c/5'), note('d/5')]
      : [note('c/5'), note('d/5'), note('e/5'), note('f/5')],
  }];
  // 左手は2音だけにして空きを残す（空白クリック挿入の検証で満杯にならないように）
  const left: MeasureData[] = [{ events: [note('c/3'), note('d/3')] }];
  const onRightChange = vi.fn();
  const onLeftChange = vi.fn();
  // 再レンダーで activeLayerPartIndex 以外の参照が変わらないよう、オブジェクト系 prop は固定する。
  // ここが毎回新しい参照だと、依存配列の別項目（tool 等）で描画 effect が再実行されてしまい、
  // 「activeLayerPartIndex が依存に無い」取りこぼしをテストが検出できない
  const stableTool = { duration: '4', isRest: false } as never;
  const stablePartsConfig = [
    { clef: 'treble' as const, data: right, onChange: onRightChange, label: '右手' },
    { clef: 'bass' as const, data: left, onChange: onLeftChange, label: '左手' },
  ];
  const stableTimeSignature: [number, number] = [4, 4];
  // customSymbolDefs は省略するとデフォルト引数 `= []` が毎レンダー新しい配列になり、
  // 描画 effect が毎回再実行されて依存漏れを隠してしまう。実アプリ（ScorePage）は
  // 安定した state を渡しているので、テストも安定参照を渡して同じ条件にする
  const stableCustomSymbolDefs: never[] = [];
  const props = (layerPart?: number) => ({
    measuresPerSystem: 1,
    tool: stableTool,
    scale: 1,
    partsConfig: stablePartsConfig,
    showInstrumentLabels: false,
    timeSignature: stableTimeSignature,
    customSymbolDefs: stableCustomSymbolDefs,
    activeVoiceIndex: 0,
    ...(layerPart !== undefined ? { activeLayerPartIndex: layerPart } : {}),
  });
  const { container, rerender } = render(<PianoSystemCanvas {...props(activeLayerPartIndex)} />);
  const svg = container.querySelector('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  const rerenderWithLayer = (layerPart: number) => rerender(<PianoSystemCanvas {...props(layerPart)} />);
  return { svg, container, onRightChange, onLeftChange, rerenderWithLayer };
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

  it('声部を変えずレイヤーのパートだけ切り替えても、編集用セルが付け替わる（再レンダー）', () => {
    // 右手・声部1 → 左手・声部1 の切替は activeVoiceIndex が変わらないため、
    // 描画 effect の依存に activeLayerPartIndex が無いと SVG が古いレイヤーのまま残る
    // （Issue #112 と同型の取りこぼし。Codex round1 P1）
    const { container, rerenderWithLayer } = renderPiano(0);
    expect(container.querySelectorAll('.vf-note-hit').length).toBe(4); // 右手4音
    rerenderWithLayer(1);
    // 左手（2音 + 空き2拍の詰め物休符）側にだけ編集用セルが付く
    const cells = container.querySelectorAll('.vf-note-hit');
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cells.length).toBeLessThan(4); // 右手4音のセルが残っていない
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

  it('レイヤー=右手のまま左手の帯の空白をクリックすると、右手へ低い加線音として入る（裁定②案A）', () => {
    // 月光 m5 の三連符のユースケース: 右手なのに音域が低く、視覚上は左手の帯にある。
    // 旧・案B（帯域優先+自動切替）ではここで左手に音が入り明示選択が壊れた（2026-08-23 裁定で差し替え）
    const { svg, onLeftChange, onRightChange } = renderPiano(0, { rightHasRoom: true });
    const events: ScoreActiveVoiceChangeDetail[] = [];
    const notices: string[] = [];
    const onChange = (e: Event) => events.push((e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail);
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      // 左手の小節背景（2つ目の .vf-hit）の空き（3拍目以降・左手五線の中央の高さ）をクリック
      const bg = svg.querySelectorAll('rect.vf-hit')[1] as SVGRectElement;
      const bx = parseFloat(bg.getAttribute('x') ?? '0');
      const bw = parseFloat(bg.getAttribute('width') ?? '0');
      const by = parseFloat(bg.getAttribute('y') ?? '0');
      const bh = parseFloat(bg.getAttribute('height') ?? '0');
      fireEvent.click(bg, { clientX: bx + bw * 0.85, clientY: by + bh * 0.5 });

      // 挿入先は選択レイヤー（右手）。左手は一切変わらない
      expect(onLeftChange).not.toHaveBeenCalled();
      expect(onRightChange).toHaveBeenCalled();
      const nextRight = onRightChange.mock.calls.at(-1)![0] as MeasureData[];
      const inserted = nextRight[0].events.filter((ev) => !ev.isRest).at(-1)!;
      // 音高は右手（ト音記号）の五線を物差しに計算されるので、
      // 左手の帯の高さのクリックは右手五線のはるか下の加線音になる
      expect(keyToMidi(inserted.keys[0])!).toBeLessThan(keyToMidi('c/4')!);

      // レイヤーは自動で変わらない（切替イベントが飛ばない）
      expect(events).toHaveLength(0);
      // どこへ入ったかは通知される（帯またぎのときだけ）
      expect(notices.join(' ')).toContain('右手・声部1に入れました');
    } finally {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onChange);
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });

  it('選択レイヤーと同じ帯の空白クリックでは帯またぎ通知は出ない', () => {
    const { svg, onRightChange } = renderPiano(0);
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      const bg = svg.querySelectorAll('rect.vf-hit')[0] as SVGRectElement;
      const bx = parseFloat(bg.getAttribute('x') ?? '0');
      const bw = parseFloat(bg.getAttribute('width') ?? '0');
      const by = parseFloat(bg.getAttribute('y') ?? '0');
      const bh = parseFloat(bg.getAttribute('height') ?? '0');
      // 右手は4音で満杯なので、満杯通知が出るケースを避けるため上端（高音）ではなく…
      // →この小節は満杯（4分×4）なので挿入自体は起きず「入りきりません」通知になる。
      // ここでは「帯またぎの通知が出ない」ことだけを確認する
      fireEvent.click(bg, { clientX: bx + bw * 0.5, clientY: by + bh * 0.3 });
      expect(notices.join(' ')).not.toContain('に入れました（');
      void onRightChange;
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  });

  it('レイヤー未指定（従来モード・非ピアノ相当）では空白クリックは帯域のパートへ入る（後方互換）', () => {
    const { svg, onLeftChange, onRightChange } = renderPiano(undefined);
    const bg = svg.querySelectorAll('rect.vf-hit')[1] as SVGRectElement;
    const bx = parseFloat(bg.getAttribute('x') ?? '0');
    const bw = parseFloat(bg.getAttribute('width') ?? '0');
    const by = parseFloat(bg.getAttribute('y') ?? '0');
    const bh = parseFloat(bg.getAttribute('height') ?? '0');
    fireEvent.click(bg, { clientX: bx + bw * 0.85, clientY: by + bh * 0.5 });
    expect(onRightChange).not.toHaveBeenCalled();
    expect(onLeftChange).toHaveBeenCalled();
    const nextLeft = onLeftChange.mock.calls.at(-1)![0] as MeasureData[];
    const nonRestKeys = nextLeft[0].events.filter((ev) => !ev.isRest).map((ev) => ev.keys[0]);
    expect(nonRestKeys).toHaveLength(3);
    expect(nonRestKeys[0]).toBe('c/3');
    expect(nonRestKeys[1]).toBe('d/3');
  });
});
