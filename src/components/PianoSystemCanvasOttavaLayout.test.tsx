// オッターバの見た目（実機所感 2026-08-26「文字が小さくて五線に近い」）のテスト。
// - 文字は 22px（従来の2倍）
// - 五線からの距離は 28px（従来の2倍）
// - 範囲内に高い音（加線の音）があれば、その上へ逃がす（障害物回避・#340 の型）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import PianoSystemCanvas, { OTTAVA_FONT_SIZE_PX, OTTAVA_STAFF_GAP_PX, OTTAVA_LABEL_WIDTH_EM } from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

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

function renderSingle(measures: MeasureData[]) {
  const { container } = render(
    <PianoSystemCanvas
      measuresPerSystem={1}
      tool={{ duration: '4', isRest: false } as never}
      scale={1}
      partsConfig={[{ clef: 'treble', data: measures, onChange: vi.fn() }]}
      showInstrumentLabels={false}
      timeSignature={[4, 4]}
    />
  );
  const svg = container.querySelector('svg') as SVGSVGElement;
  const label = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === '8va')!;
  const staveTopY = parseFloat(
    (svg.querySelector('.vf-note-hit') as SVGRectElement).getAttribute('data-line0-y')!,
  );
  return { svg, label, staveTopY };
}

describe('オッターバの見た目（2026-08-26 実機所感）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('低い音型では、文字22pxで五線上端の28px上に描かれる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'], ottava: '8va' },
        { dur: '4', isRest: false, keys: ['c/5'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { label, staveTopY } = renderSingle(measures);
    expect(label.getAttribute('font-size')).toBe(String(OTTAVA_FONT_SIZE_PX));
    expect(parseFloat(label.getAttribute('y')!)).toBe(staveTopY - OTTAVA_STAFF_GAP_PX);
  });

  // 加線の高い音は五線上端より上に描かれる。従来はブラケットが符頭・符幹に重なっていた
  it('範囲内に高い音があると、その上へ逃げる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/6'], ottava: '8va' },
        { dur: '4', isRest: false, keys: ['e/6'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, label, staveTopY } = renderSingle(measures);
    const y = parseFloat(label.getAttribute('y')!);
    // 既定位置（topY-28）より上へ動いている
    expect(y).toBeLessThan(staveTopY - OTTAVA_STAFF_GAP_PX);
    // ブラケットの破線もラベルと同じ高さ帯にある（ay-3）
    const dash = Array.from(svg.querySelectorAll('line'))
      .find((l) => l.getAttribute('stroke-dasharray'));
    expect(parseFloat(dash!.getAttribute('y1')!)).toBe(y - 3);
  });

  // 実機報告 2026-08-26: 上へ手動移動した pp（offsetY -95）にブラケットが重なった。
  // 音符だけでなく、強弱記号の確定位置も障害物として避ける
  it('上へ移動した強弱記号があると、その上へ逃げる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['a/4'], ottava: '8va',
          dynamics: [{ value: 'pp' }],
          symbolAdjust: { dynamics: { offsetX: 0, offsetY: -95 } } },
        { dur: '4', isRest: false, keys: ['g/4'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { label, staveTopY } = renderSingle(measures);
    // 音符は五線内（回避の理由にならない）なのに、既定位置より上へ動いている
    expect(parseFloat(label.getAttribute('y')!)).toBeLessThan(staveTopY - OTTAVA_STAFF_GAP_PX);
  });

  // PR #414 Codex round1 P1: 破線の始点が旧サイズ時代の +18 固定だと、22px の
  // "8va" の字面（ax-4 起点）に破線が重なる。フォントサイズ由来の字面幅の外から始めることを固定する
  it('破線はラベルの字面の右端より外から始まる', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'], ottava: '8va' },
        { dur: '4', isRest: false, keys: ['c/5'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { svg, label } = renderSingle(measures);
    const dash = Array.from(svg.querySelectorAll('line'))
      .find((l) => l.getAttribute('stroke-dasharray'))!;
    const labelX = parseFloat(label.getAttribute('x')!);
    // 字面の見積もり右端（ラベルx + フォントサイズ×em係数）より右にある
    expect(parseFloat(dash.getAttribute('x1')!)).toBeGreaterThanOrEqual(
      labelX + OTTAVA_FONT_SIZE_PX * OTTAVA_LABEL_WIDTH_EM
    );
  });

  // PR #414 Codex round1 P2: 8vb の回避量は実際の描画サイズ（scale込み）に追従する。
  // 定数（22px）のままだと、サイズ調整で拡大した 8vb が下側の障害物へ戻って重なる
  it('8vb をサイズ調整で拡大すると、回避量も文字の実サイズぶん深くなる', () => {
    const base: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/3'], ottava: '8vb' },
        { dur: '4', isRest: false, keys: ['d/3'], ottava: '8vbEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const scaled: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/3'], ottava: '8vb',
          symbolAdjust: { ottava: { scale: 2 } } },
        { dur: '4', isRest: false, keys: ['d/3'], ottava: '8vbEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const yOf = (m: MeasureData[]) => {
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: m, onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      const label = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === '8vb')!;
      const y = parseFloat(label.getAttribute('y')!);
      cleanup();
      return y;
    };
    const baseY = yOf(base);
    const scaledY = yOf(scaled);
    // 低い音（加線下の c/3）が障害物になる音型で、2倍サイズの 8vb は
    // 文字高さの増分（fontSize×0.8 の差）ぶんさらに下へ逃げる
    expect(scaledY).toBeGreaterThanOrEqual(baseY + OTTAVA_FONT_SIZE_PX * 0.8 - 1);
  });

  // #373 の手動優先: 手で動かした位置は自動回避で上書きしない
  it('手動で offsetY を設定した弧は自動回避しない', () => {
    const measures: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['c/6'], ottava: '8va',
          symbolAdjust: { ottava: { offsetY: 10 } } },
        { dur: '4', isRest: false, keys: ['e/6'], ottava: '8vaEnd' },
        { dur: '2', isRest: true, keys: ['b/4'] },
      ],
    }];
    const { label, staveTopY } = renderSingle(measures);
    // 既定位置 + 手動オフセットのまま（障害物回避が効いていない）
    expect(parseFloat(label.getAttribute('y')!)).toBe(staveTopY - OTTAVA_STAFF_GAP_PX + 10);
  });

  // 実機報告 2026-08-28: 段をまたぐ 8va（開始が段1・終了が段2）。
  // ペア照合を段内で閉じると両側とも無言で消える。開始側の段は右端まで
  // 終端フックなしで描き、終了側の段は左端から続きの括弧を描くことを固定する
  describe('段またぎの 8va', () => {
    const crossData: MeasureData[] = [
      { events: [
        { dur: '2', isRest: false, keys: ['c/5'] },
        { dur: '2', isRest: false, keys: ['d/5'], ottava: '8va' },
      ] },
      { events: [
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '2', isRest: false, keys: ['e/5'], ottava: '8vaEnd' },
      ] },
    ];
    function renderSystem(startMeasureIndex: number) {
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: crossData, onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          startMeasureIndex={startMeasureIndex}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      const label = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === '8va');
      const dash = Array.from(svg.querySelectorAll('line')).find((l) => l.getAttribute('stroke-dasharray'));
      // 終端フックはオッターバ描画コードの色（#374151）を持つ実線の縦線に限定して数える
      // （五線・小節線など他の縦線を誤カウントしないため）
      const hooks = Array.from(svg.querySelectorAll('line')).filter((l) => !l.getAttribute('stroke-dasharray')
        && l.getAttribute('stroke') === '#374151'
        && l.getAttribute('x1') === l.getAttribute('x2'));
      const result = { svg, label, dash, hookCount: hooks.length };
      cleanup();
      return result;
    }

    it('開始側の段: ラベル＋破線が段の右端まで伸び、終端フックは無い', () => {
      const { svg, label, dash, hookCount } = renderSystem(0);
      expect(label).toBeTruthy();
      expect(dash).toBeTruthy();
      // 「右端」は小節の当たり判定（vf-hit）の右端と同座標系。±2px で一致を要求する
      // （「100px以上」のような緩い判定だと端まで届かない退行を固定できない。round1 P2）
      const hitRight = Math.max(...Array.from(svg.querySelectorAll('rect.vf-hit'))
        .map((r) => parseFloat(r.getAttribute('x')!) + parseFloat(r.getAttribute('width')!)));
      expect(parseFloat(dash!.getAttribute('x2')!)).toBeGreaterThan(hitRight - 2);
      expect(hookCount).toBe(0);
    });

    it('終了側の段: 段の左端から続きの括弧（ラベル＋破線＋終端フック）が描かれる', () => {
      const { svg, label, dash, hookCount } = renderSystem(1);
      expect(label).toBeTruthy();
      expect(dash).toBeTruthy();
      expect(hookCount).toBe(1);
      // ラベルは段の左端（小節当たり判定の左端）付近から始まる
      const hitLeft = Math.min(...Array.from(svg.querySelectorAll('rect.vf-hit'))
        .map((r) => parseFloat(r.getAttribute('x')!)));
      expect(parseFloat(label!.getAttribute('x')!)).toBeLessThan(hitLeft + 40);
    });

    it('中間の段（開始も終了も無い）には全幅の括弧が終端フックなしで描かれる', () => {
      const threeSystems: MeasureData[] = [
        { events: [{ dur: '2', isRest: false, keys: ['c/5'] }, { dur: '2', isRest: false, keys: ['d/5'], ottava: '8va' }] },
        { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] },
        { events: [{ dur: '2', isRest: true, keys: ['b/4'] }, { dur: '2', isRest: false, keys: ['e/5'], ottava: '8vaEnd' }] },
      ];
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: threeSystems, onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          startMeasureIndex={1}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      const label = Array.from(svg.querySelectorAll('text')).find((t) => t.textContent === '8va');
      const dash = Array.from(svg.querySelectorAll('line')).find((l) => l.getAttribute('stroke-dasharray'));
      const hooks = Array.from(svg.querySelectorAll('line')).filter((l) => !l.getAttribute('stroke-dasharray')
        && l.getAttribute('stroke') === '#374151'
        && l.getAttribute('x1') === l.getAttribute('x2'));
      expect(label).toBeTruthy();
      expect(dash).toBeTruthy();
      expect(hooks.length).toBe(0);
      cleanup();
    });

    it('8vb も段をまたげる（終了側の段に続きの括弧）', () => {
      const vbData: MeasureData[] = [
        { events: [{ dur: '1', isRest: false, keys: ['c/4'], ottava: '8vb' }] },
        { events: [{ dur: '2', isRest: true, keys: ['b/4'] }, { dur: '2', isRest: false, keys: ['d/4'], ottava: '8vbEnd' }] },
      ];
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: vbData, onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          startMeasureIndex={1}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      expect(Array.from(svg.querySelectorAll('text')).some((t) => t.textContent === '8vb')).toBe(true);
      cleanup();
    });

    // round1 P2: 旧実装は pending が単一共有で、同じ段に 8va と 8vb が同時に
    // 開くと後の開始が先の開始を上書きし、片方のブラケットが消えた
    it('同じ段で 8va と 8vb が同時に開いても、両方のブラケットが描かれる', () => {
      const mixed: MeasureData[] = [{
        events: [
          { dur: '4', isRest: false, keys: ['c/5'], ottava: '8va' },
          { dur: '4', isRest: false, keys: ['c/4'], ottava: '8vb' },
          { dur: '4', isRest: false, keys: ['d/5'], ottava: '8vaEnd' },
          { dur: '4', isRest: false, keys: ['d/4'], ottava: '8vbEnd' },
        ],
      }];
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: mixed, onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
      expect(texts).toContain('8va');
      expect(texts).toContain('8vb');
      cleanup();
    });

    // round2 P2: 前の段から開いたままの 8va がある段で同種の 8va を新たに開始すると、
    // 旧実装は古い開始（段外走査の origin）を失効させず、段末の全幅処理が古い括弧を
    // 重ねて描いた（新しい開始の括弧との二重描画）。新しい開始で古い状態を失効させる
    it('同種の開始をやり直した段では、括弧は1本だけ描かれる（前の段からの古い開始は失効）', () => {
      const restart: MeasureData[] = [
        { events: [{ dur: '2', isRest: false, keys: ['c/5'] }, { dur: '2', isRest: false, keys: ['d/5'], ottava: '8va' }] },
        { events: [{ dur: '1', isRest: false, keys: ['e/5'], ottava: '8va' }] },
        { events: [{ dur: '2', isRest: true, keys: ['b/4'] }, { dur: '2', isRest: false, keys: ['f/5'], ottava: '8vaEnd' }] },
      ];
      const renderAt = (startMeasureIndex: number) => {
        const { container } = render(
          <PianoSystemCanvas
            measuresPerSystem={1}
            tool={{ duration: '4', isRest: false } as never}
            scale={1}
            partsConfig={[{ clef: 'treble', data: restart, onChange: vi.fn() }]}
            showInstrumentLabels={false}
            timeSignature={[4, 4]}
            startMeasureIndex={startMeasureIndex}
          />
        );
        const svg = container.querySelector('svg') as SVGSVGElement;
        const labels = Array.from(svg.querySelectorAll('text')).filter((t) => t.textContent === '8va');
        cleanup();
        return labels.length;
      };
      // やり直しの段（段2）: 新しい開始の括弧1本だけ（旧実装はここが2本になった）
      expect(renderAt(1)).toBe(1);
      // 最初の開始（段1）は対応する終了が無い（先に新しい開始が来る）ので描かれない
      expect(renderAt(0)).toBe(0);
    });

    it('段内で完結する場合は従来どおり（回帰なし: 開始と終了が同じ段）', () => {
      const inSystem: MeasureData[] = [{
        events: [
          { dur: '2', isRest: false, keys: ['c/5'], ottava: '8va' },
          { dur: '2', isRest: false, keys: ['d/5'], ottava: '8vaEnd' },
        ],
      }];
      const { container } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data: inSystem, onChange: vi.fn() }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      // 終端フックはオッターバ描画コードの色（#374151）を持つ実線の縦線に限定して数える
      // （五線・小節線など他の縦線を誤カウントしないため）
      const hooks = Array.from(svg.querySelectorAll('line')).filter((l) => !l.getAttribute('stroke-dasharray')
        && l.getAttribute('stroke') === '#374151'
        && l.getAttribute('x1') === l.getAttribute('x2'));
      expect(hooks.length).toBe(1);
      cleanup();
    });
  });
});
