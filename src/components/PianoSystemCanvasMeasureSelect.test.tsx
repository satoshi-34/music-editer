// Issue #145「小節選択の操作性改善」の回帰テスト。
//
// 確認する3点:
//   1. 小節選択ツール中に小節Aで押して小節Bまでドラッグすると A〜B が範囲選択になる
//   2. 音符ツール等を選んだままでも Shift+クリックで小節選択になる（音符は増えない）
//   3. 選択中の小節の当たり判定 rect に `vf-measure-selected` クラスが付く
//      （App.css の `.vf-hit { fill: transparent !important }` を上書きして
//        ハイライトを見えるようにするためのクラス。付いていないと選択しても
//        見た目が変わらない ＝ Issue #145 の指摘3点目そのものになる）
//
// jsdom は mouseenter を「実際にカーソルが動いたか」で判定しないので、
// ドラッグは mousedown → mouseenter → mouseup を明示的に発火して再現する。
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
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

// jsdom はレイアウトを持たないため、実ブラウザに近い横幅で描画させる
const TEST_CONTAINER_WIDTH = 900;

type RenderOptions = {
  tool: React.ComponentProps<typeof PianoSystemCanvas>['tool'];
  selectedMeasures?: { start: number; end: number };
};

function renderScore({ tool, selectedMeasures }: RenderOptions) {
  // 3小節ぶん。1小節目にだけ音符を置き、「音符の上のクリック」も試せるようにする。
  const data: MeasureData[] = [
    { events: [{ dur: '4', isRest: false, keys: ['b/4'] }] },
    { events: [] },
    { events: [] },
  ];
  const onChange = vi.fn();
  const onMeasureSelect = vi.fn();
  const onMeasureRangeSelect = vi.fn();

  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={3}
      tool={tool}
      scale={1}
      partsConfig={[{ clef: 'treble', data, onChange }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
      selectedMeasures={selectedMeasures}
      onMeasureSelect={onMeasureSelect}
      onMeasureRangeSelect={onMeasureRangeSelect}
    />
  );

  const svg = container.querySelector('svg') as SVGSVGElement;
  expect(svg).toBeTruthy();
  // 小節の背景当たり判定（.vf-hit）は小節ごとに1つ、描画順（左から右）に並ぶ
  const measureHits = Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
  return { container, svg, measureHits, onChange, onMeasureSelect, onMeasureRangeSelect };
}

describe('PianoSystemCanvas 小節選択の操作性（Issue #145）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  function setup() {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  }
  function teardown() {
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      // `delete (X as any).clientWidth` と同じことを any 無しで書く（lint:ratchet 対策）
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  }

  it('小節選択ツール中に1小節目から3小節目へドラッグすると範囲選択になる', () => {
    setup();
    try {
      const { measureHits, onMeasureRangeSelect } = renderScore({ tool: { mode: 'select' } });
      expect(measureHits.length).toBe(3);

      fireEvent.mouseDown(measureHits[0], { button: 0 });
      fireEvent.mouseEnter(measureHits[1]);
      fireEvent.mouseEnter(measureHits[2]);
      fireEvent.mouseUp(window);

      // 通り過ぎた小節ごとに、開始小節からの範囲が通知される
      expect(onMeasureRangeSelect.mock.calls).toEqual([[0, 1], [0, 2]]);
    } finally {
      teardown();
    }
  });

  it('右から左へドラッグしても範囲は小さい順で通知される', () => {
    setup();
    try {
      const { measureHits, onMeasureRangeSelect } = renderScore({ tool: { mode: 'select' } });

      fireEvent.mouseDown(measureHits[2], { button: 0 });
      fireEvent.mouseEnter(measureHits[0]);
      fireEvent.mouseUp(window);

      expect(onMeasureRangeSelect).toHaveBeenCalledWith(0, 2);
    } finally {
      teardown();
    }
  });

  it('ドラッグ後に発生するクリックでは単一小節へ戻さない', () => {
    setup();
    try {
      const { measureHits, onMeasureSelect, onMeasureRangeSelect } = renderScore({ tool: { mode: 'select' } });

      fireEvent.mouseDown(measureHits[0], { button: 0 });
      fireEvent.mouseEnter(measureHits[2]);
      fireEvent.mouseUp(window);
      // 実ブラウザでは、ドラッグの終わりに click が飛んでくることがある。
      // これをそのまま処理すると範囲選択が単一選択へ戻ってしまう。
      fireEvent.click(measureHits[2]);

      expect(onMeasureRangeSelect).toHaveBeenCalledWith(0, 2);
      expect(onMeasureSelect).not.toHaveBeenCalled();
    } finally {
      teardown();
    }
  });

  it('ドラッグ後に click が飛んでこなくても、次のクリックは読み飛ばさない', () => {
    setup();
    try {
      const { measureHits, onMeasureSelect } = renderScore({ tool: { mode: 'select' } });

      // 押した rect が再描画で作り直されると、ドラッグの終わりに click が
      // どこへも飛んでこない。この状態で「次のクリックを読み飛ばす」フラグが
      // 残っていると、そのあとの1クリックが無反応になってしまう（ブラウザ確認で発覚）。
      fireEvent.mouseDown(measureHits[0], { button: 0 });
      fireEvent.mouseEnter(measureHits[2]);
      fireEvent.mouseUp(window);

      fireEvent.mouseDown(measureHits[1], { button: 0 });
      fireEvent.mouseUp(window);
      fireEvent.click(measureHits[1]);

      expect(onMeasureSelect).toHaveBeenCalledWith(1, false);
    } finally {
      teardown();
    }
  });

  it('ドラッグせずクリックしただけなら従来どおり単一選択になる', () => {
    setup();
    try {
      const { measureHits, onMeasureSelect, onMeasureRangeSelect } = renderScore({ tool: { mode: 'select' } });

      fireEvent.mouseDown(measureHits[1], { button: 0 });
      fireEvent.mouseUp(window);
      fireEvent.click(measureHits[1]);

      expect(onMeasureRangeSelect).not.toHaveBeenCalled();
      expect(onMeasureSelect).toHaveBeenCalledWith(1, false);
    } finally {
      teardown();
    }
  });

  it('音符ツール中でも Shift+クリックで小節選択になり、音符は増えない', () => {
    setup();
    try {
      const { measureHits, onMeasureSelect, onMeasureRangeSelect, onChange } =
        renderScore({ tool: { duration: '4', isRest: false } });

      fireEvent.click(measureHits[1], { shiftKey: true });

      // shiftHeld=true で通知されるので、既存の選択があれば範囲拡張として扱われる
      expect(onMeasureSelect).toHaveBeenCalledWith(1, true);
      expect(onMeasureRangeSelect).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      teardown();
    }
  });

  it('音符ツール中の Shift なしクリックは従来どおり音符の配置になる', () => {
    setup();
    try {
      const { measureHits, onMeasureSelect, onChange } =
        renderScore({ tool: { duration: '4', isRest: false } });

      fireEvent.click(measureHits[1], { clientX: 10, clientY: 10 });

      expect(onMeasureSelect).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalled();
    } finally {
      teardown();
    }
  });

  it('音符の上を Shift+クリックしても小節選択になり、音符は増えない', () => {
    setup();
    try {
      const { svg, onMeasureSelect, onChange } =
        renderScore({ tool: { duration: '4', isRest: false } });

      const noteHit = svg.querySelector('rect.vf-note-hit[data-measure="0"]') as SVGRectElement;
      expect(noteHit).toBeTruthy();
      fireEvent.click(noteHit, { shiftKey: true });

      expect(onMeasureSelect).toHaveBeenCalledWith(0, true);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      teardown();
    }
  });

  it('選択中の小節にだけハイライト用クラスが付く', () => {
    setup();
    try {
      const { measureHits } = renderScore({
        tool: { mode: 'select' },
        selectedMeasures: { start: 1, end: 2 },
      });

      expect(measureHits[0].classList.contains('vf-measure-selected')).toBe(false);
      expect(measureHits[1].classList.contains('vf-measure-selected')).toBe(true);
      expect(measureHits[2].classList.contains('vf-measure-selected')).toBe(true);
      // 枠線は譜面の線に紛れないよう太くする
      expect(measureHits[1].getAttribute('stroke-width')).toBe('3');
    } finally {
      teardown();
    }
  });
});
