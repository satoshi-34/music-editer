// Issue #190（声部2のタイ／スラー 段3）: 入力・選択・ドラッグ編集の解禁の回帰テスト。
//
// 段1（#186）で描画収集を、段2（#188）で削除の追従を声部対応させたうえで、
// この段でようやく「声部2の音符間に弧・松葉を張り、掴んで調節し、Delete で消す」までを解禁する。
//
// ここが壊れると起きるのは、画面では気づけない無言のデータ破壊である
// （声部2をドラッグしたのに声部1の同じ位置のイベントへ arcs が書かれる = #112 のタイ誤爆）。
// そのため、どのテストでも「声部2側に入った」だけでなく
// 「声部1の events が1バイトも変わっていない」ことまで確認する。
//
// 固定したいのは受入条件の1〜4:
//   1. 声部2アクティブのドラッグ → voices[1] に arcs が入り、声部1の events は不変
//   2. 同じ操作で松葉も声部2側に入る
//   3. 声部2の弧を選択 → 曲率ドラッグ・端点ドラッグ・向き反転・Delete が声部2側にだけ保存される
//   4. 声部1アクティブでの従来操作が一切変わらない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

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

const TEST_CONTAINER_WIDTH = 700;

// jsdom はレイアウトを持たないので、SVG の見た目サイズを論理サイズと同じにする。
// こうすると「クリック座標（clientX/Y）＝ SVG 内部座標」になり、狙った位置を素直に指定できる。
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

// いま描かれている譜面 SVG を取り直して測り直す。
// 弧を掴むと選択状態が変わって SVG がまるごと作り直されるため、
// 掴んだあとの mousemove / mouseup はこちらの SVG に対して投げる。
function remockCurrentSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg') as SVGSVGElement;
  expect(svg).toBeTruthy();
  mockSvgLayout(svg);
  return svg;
}

// 音符のヒット領域は五線の上3加線〜下3加線の固定範囲なので、
// rect の高さを10等分すれば任意の line のY座標を逆算できる。
function yForLine(hit: SVGRectElement, line: number): number {
  const y = parseFloat(hit.getAttribute('y')!);
  const h = parseFloat(hit.getAttribute('height')!);
  return y + (line - (-3)) * (h / 10);
}

function centerXOf(hit: SVGRectElement): number {
  const left = parseFloat(hit.getAttribute('data-note-left')!);
  const right = parseFloat(hit.getAttribute('data-note-right')!);
  return (left + right) / 2;
}

function noteHit(svg: SVGSVGElement, noteIndex: number, measure = 0): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-note-hit[data-measure="${measure}"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

// 弧の同定キー。PianoSystemCanvas の arcKeyP() が発行する形式に合わせる。
function arcKey(partIndex: number, voiceIndex: number, fromMeasure: number, fromEvent: number, arcIndex: number) {
  return `p${partIndex}v${voiceIndex}m${fromMeasure}e${fromEvent}a${arcIndex}`;
}

function quarter(key: string) {
  return { dur: '4' as const, isRest: false, keys: [key] };
}

// 声部1＝c/5・d/5・e/5・f/5、声部2＝すべて e/4（ト音記号の第1線 = line 4）。
// 声部2をすべて同じ音高にしているのは、クリックY座標の計算を単純にするため。
function twoVoiceMeasure(): MeasureData {
  return {
    events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')],
    voices: [
      { id: 'voice-1', events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')] },
      {
        id: 'voice-2',
        stemDirection: 'down',
        events: [quarter('e/4'), quarter('e/4'), quarter('e/4'), quarter('e/4')],
      },
    ],
  };
}

// 声部2の1音目→3音目にスラーが張ってある状態（選択・ドラッグ編集の検証用）。
function twoVoiceMeasureWithVoice2Slur(): MeasureData {
  const measure = twoVoiceMeasure();
  measure.voices![1].events[0] = {
    ...measure.voices![1].events[0],
    arcs: [{ kind: 'slur', fromKey: 'e/4', toKey: 'e/4', toMeasureIndex: 0, toEventIndex: 2 }],
  };
  return measure;
}

describe('PianoSystemCanvas 声部2の弧・松葉の入力と編集（Issue #190 段3）', () => {
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
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(
    data: MeasureData[],
    tool: Record<string, unknown>,
    activeVoiceIndex: 0 | 1,
    measuresPerSystem = 1,
  ) {
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={measuresPerSystem}
        tool={tool as never}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={activeVoiceIndex}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { container, svg, onChange, data };
  }

  // 最後に onChange へ渡された譜面データ（＝保存される内容）を取り出す。
  async function latestScore(onChange: ReturnType<typeof vi.fn>): Promise<MeasureData[]> {
    await waitFor(() => { expect(onChange).toHaveBeenCalled(); });
    return onChange.mock.calls.at(-1)![0] as MeasureData[];
  }

  describe('受入1・2: 声部2アクティブでの新規入力', () => {
    it('声部2の音符間をタイツールでドラッグすると、voices[1] にだけ弧が入る', async () => {
      const original = twoVoiceMeasure();
      const { svg, onChange } = renderScore([twoVoiceMeasure()], { mode: 'tie' }, 1);

      const from = noteHit(svg, 0);
      const to = noteHit(svg, 2);
      fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 4) });
      fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 4) });

      const updated = await latestScore(onChange);
      const arcs = updated[0].voices?.[1]?.events[0].arcs;
      expect(arcs).toHaveLength(1);
      // 同じ音高どうしを結んだのでタイ、終点は声部2の events の中で数えた位置（案A）。
      expect(arcs![0].kind).toBe('tie');
      expect(arcs![0].toEventIndex).toBe(2);
      expect(arcs![0].toMeasureIndex).toBe(0);
      // 声部1は参照の中身ごと不変。
      expect(updated[0].events).toEqual(original.events);
      expect(updated[0].voices?.[0]?.events).toEqual(original.voices![0].events);
    });

    it('声部2の松葉（クレッシェンド）も voices[1] にだけ入る', async () => {
      const original = twoVoiceMeasure();
      const { svg, onChange } = renderScore(
        [twoVoiceMeasure()], { mode: 'hairpin', hairpinType: 'cresc' }, 1
      );

      const from = noteHit(svg, 0);
      const to = noteHit(svg, 3);
      fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 4) });
      fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 4) });

      const updated = await latestScore(onChange);
      const hairpins = updated[0].voices?.[1]?.events[0].hairpins;
      expect(hairpins).toHaveLength(1);
      expect(hairpins![0].type).toBe('cresc');
      expect(hairpins![0].endEvent).toBe(3);
      expect(updated[0].events).toEqual(original.events);
      expect(updated[0].events[0].hairpins).toBeUndefined();
    });

    it('声部2を使っていない小節に空の voices[1] を作らない（#112 の事故の再発防止）', async () => {
      // 2小節ぶんの譜面で、声部2があるのは1小節目だけ。
      const data: MeasureData[] = [
        twoVoiceMeasure(),
        { events: [quarter('c/5'), quarter('d/5'), quarter('e/5'), quarter('f/5')] },
      ];
      const { svg, onChange } = renderScore(data, { mode: 'tie' }, 1, 2);

      const from = noteHit(svg, 0);
      const to = noteHit(svg, 2);
      fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 4) });
      fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 4) });

      const updated = await latestScore(onChange);
      expect(updated[0].voices?.[1]?.events[0].arcs).toHaveLength(1);
      // 触っていない2小節目に voices が生えていない（生えると多声小節と判定され見た目が変わる）。
      expect(updated[1].voices).toBeUndefined();
    });
  });

  describe('受入3: 声部2の弧の選択・調節・削除', () => {
    it('声部2アクティブなら声部2の弧に当たり判定が付く（声部1の弧には付かない）', () => {
      const data = [twoVoiceMeasureWithVoice2Slur()];
      // 声部1側にも同じ位置の弧を用意し、取り違えていないことを確かめる。
      data[0].events[0] = {
        ...data[0].events[0],
        arcs: [{ kind: 'slur', fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }],
      };
      data[0].voices![0].events[0] = data[0].events[0];
      const { svg } = renderScore(data, { mode: 'tie' }, 1);

      expect(svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 1, 0, 0, 0)}"]`)).toBeTruthy();
      expect(svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 0, 0, 0, 0)}"]`)).toBeNull();
    });

    it('声部2の弧を掴んで縦にドラッグすると、cpDyOffset が声部2側にだけ保存される', async () => {
      const original = twoVoiceMeasureWithVoice2Slur();
      const { container, svg, onChange } = renderScore([twoVoiceMeasureWithVoice2Slur()], { mode: 'tie' }, 1);

      const hit = svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 1, 0, 0, 0)}"]`) as SVGPathElement;
      expect(hit).toBeTruthy();
      // 掴む → 少しだけ下へ動かす（20px 未満なので向きの自動反転はしない）→ 離す。
      // 掴んだ時点で選択状態が変わり譜面 SVG が作り直されるので、測り直してから動かす
      // （Issue #235 でドラッグ中の座標変換を「いま描かれている SVG」基準にそろえたため）。
      fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
      const svgAfterGrab = remockCurrentSvg(container);
      fireEvent.mouseMove(svgAfterGrab, { clientX: 200, clientY: 108 });
      fireEvent.mouseUp(svgAfterGrab, { clientX: 200, clientY: 108 });

      const updated = await latestScore(onChange);
      const arc = updated[0].voices?.[1]?.events[0].arcs?.[0];
      expect(arc?.cpDyOffset).toBeCloseTo(8);
      expect(arc?.flipDirection).toBeUndefined();
      expect(updated[0].events).toEqual(original.events);
    });

    it('声部2の弧を大きくドラッグすると、向きの反転（flipDirection）も声部2側に保存される', async () => {
      const original = twoVoiceMeasureWithVoice2Slur();
      const { container, svg, onChange } = renderScore([twoVoiceMeasureWithVoice2Slur()], { mode: 'tie' }, 1);

      const hit = svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 1, 0, 0, 0)}"]`) as SVGPathElement;
      // 音符クラスタを大きく超えて動かすと弧の向きが反転する（既存仕様）。
      // 声部2は下声なので弧は下向きに描かれる。上へ大きく動かして上向きへ反転させる。
      fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
      const svgAfterGrab = remockCurrentSvg(container);
      fireEvent.mouseMove(svgAfterGrab, { clientX: 200, clientY: -400 });
      fireEvent.mouseUp(svgAfterGrab, { clientX: 200, clientY: -400 });

      const updated = await latestScore(onChange);
      const arc = updated[0].voices?.[1]?.events[0].arcs?.[0];
      expect(arc?.flipDirection).toBe(true);
      expect(updated[0].events).toEqual(original.events);
    });

    it('声部2の弧を選ぶと端点ハンドルが出て、ドラッグ結果が声部2側にだけ保存される', async () => {
      const original = twoVoiceMeasureWithVoice2Slur();
      const { container, svg, onChange } = renderScore([twoVoiceMeasureWithVoice2Slur()], { mode: 'tie' }, 1);

      const hit = svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 1, 0, 0, 0)}"]`) as SVGPathElement;
      fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
      fireEvent.mouseUp(svg, { clientX: 200, clientY: 100 });

      // 選択されると譜面 SVG がまるごと描き直され、ハンドル（青い丸）が追加される。
      // 古い svg 要素にはイベントリスナーも残っていないので、必ず取り直す。
      const handle = await waitFor(() => {
        const el = container.querySelector(`circle[data-arc-ep-end="${arcKey(0, 1, 0, 0, 0)}"]`);
        expect(el).toBeTruthy();
        return el as SVGCircleElement;
      });
      const svg2 = container.querySelector('svg') as SVGSVGElement;
      mockSvgLayout(svg2);

      fireEvent.mouseDown(handle, { clientX: 300, clientY: 100 });
      fireEvent.mouseMove(svg2, { clientX: 306, clientY: 103 });
      fireEvent.mouseUp(svg2, { clientX: 306, clientY: 103 });

      const updated = await latestScore(onChange);
      const arc = updated[0].voices?.[1]?.events[0].arcs?.[0];
      expect(arc?.endDx).toBeCloseTo(6);
      expect(arc?.endDy).toBeCloseTo(3);
      expect(updated[0].events).toEqual(original.events);
    });

    it('声部2の弧を選んで Delete すると、声部2の弧だけが消える', async () => {
      const data = [twoVoiceMeasureWithVoice2Slur()];
      // 声部1にも同じ位置・同じ本数の弧を置き、巻き込んで消していないことを確かめる。
      data[0].events[0] = {
        ...data[0].events[0],
        arcs: [{ kind: 'slur', fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }],
      };
      data[0].voices![0].events[0] = data[0].events[0];
      const { svg, onChange } = renderScore(data, { mode: 'tie' }, 1);

      const hit = svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 1, 0, 0, 0)}"]`) as SVGPathElement;
      fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
      fireEvent.mouseUp(svg, { clientX: 200, clientY: 100 });
      fireEvent.keyDown(window, { key: 'Delete' });

      const updated = await latestScore(onChange);
      expect(updated[0].voices?.[1]?.events[0].arcs).toBeUndefined();
      // 声部1の弧は残っている。
      expect(updated[0].events[0].arcs).toHaveLength(1);
    });

    it('声部2の松葉を選んで Delete すると、声部2の松葉だけが消える', async () => {
      const measure = twoVoiceMeasure();
      measure.voices![1].events[0] = {
        ...measure.voices![1].events[0],
        hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }],
      };
      measure.events[0] = {
        ...measure.events[0],
        hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 3 }],
      };
      measure.voices![0].events[0] = measure.events[0];
      const { svg, onChange } = renderScore([measure], { mode: 'tie' }, 1);

      // 松葉の当たり判定はクラス名でしか区別できないので、アクティブ声部のぶんだけが
      // 作られていること（1本だけ）を確かめてからクリックする。
      const hits = svg.querySelectorAll('path.vf-hairpin-hit');
      expect(hits).toHaveLength(1);
      fireEvent.click(hits[0]);
      fireEvent.keyDown(window, { key: 'Delete' });

      const updated = await latestScore(onChange);
      expect(updated[0].voices?.[1]?.events[0].hairpins).toBeUndefined();
      expect(updated[0].events[0].hairpins).toHaveLength(1);
    });
  });

  describe('受入4: 声部1側のリグレッション', () => {
    it('声部1アクティブなら、2声部小節でも従来どおり声部1にタイが張れる', async () => {
      const original = twoVoiceMeasure();
      const { svg, onChange } = renderScore([twoVoiceMeasure()], { mode: 'tie' }, 0);

      // 声部1は c/5（line 1.5）→ d/5（line 1）。音高が違うのでスラーになる。
      const from = noteHit(svg, 0);
      const to = noteHit(svg, 1);
      fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 1.5) });
      fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 1) });

      const updated = await latestScore(onChange);
      expect(updated[0].events[0].arcs).toHaveLength(1);
      expect(updated[0].events[0].arcs![0].kind).toBe('slur');
      // 声部2は巻き込まれていない。
      expect(updated[0].voices?.[1]?.events).toEqual(original.voices![1].events);
    });

    it('単声部（声部トグルの無い譜面）の弧は従来どおり掴めて Delete で消える', async () => {
      const data: MeasureData[] = [{
        events: [
          {
            ...quarter('c/5'),
            arcs: [{ kind: 'slur', fromKey: 'c/5', toKey: 'e/5', toMeasureIndex: 0, toEventIndex: 2 }],
          },
          quarter('d/5'),
          quarter('e/5'),
          quarter('f/5'),
        ],
      }];
      const { svg, onChange } = renderScore(data, { mode: 'tie' }, 0);

      const hit = svg.querySelector(`path[data-arc-key-hit="${arcKey(0, 0, 0, 0, 0)}"]`) as SVGPathElement;
      expect(hit).toBeTruthy();
      fireEvent.mouseDown(hit, { clientX: 200, clientY: 100 });
      fireEvent.mouseUp(svg, { clientX: 200, clientY: 100 });
      fireEvent.keyDown(window, { key: 'Delete' });

      const updated = await latestScore(onChange);
      expect(updated[0].events[0].arcs).toBeUndefined();
      // voices を生やしていない（単声部の保存形のまま）。
      expect(updated[0].voices).toBeUndefined();
    });
  });

  describe('声部またぎの禁止（設計メモ §4 の確定裁定）', () => {
    it('ドラッグ中に声部が切り替わったら、どちらの声部にも書き込まない', async () => {
      const original = twoVoiceMeasure();
      const data = [twoVoiceMeasure()];
      const onChange = vi.fn();
      // 声部2でドラッグを開始し、離す前にアクティブ声部を1へ切り替える。
      const { container, rerender } = render(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ mode: 'tie' } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data, onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          activeVoiceIndex={1}
        />
      );
      const svg = container.querySelector('svg') as SVGSVGElement;
      mockSvgLayout(svg);

      const from = noteHit(svg, 0);
      fireEvent.mouseDown(from, { clientX: centerXOf(from), clientY: yForLine(from, 4) });

      rerender(
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ mode: 'tie' } as never}
          scale={1}
          partsConfig={[{ clef: 'treble', data, onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
          activeVoiceIndex={0}
        />
      );
      const svgAfter = container.querySelector('svg') as SVGSVGElement;
      mockSvgLayout(svgAfter);
      const to = noteHit(svgAfter, 2);
      fireEvent.mouseUp(to, { clientX: centerXOf(to), clientY: yForLine(to, 1) });

      // 声部をまたぐ弧は許可しないので、どちらの声部にも弧は入らない。
      expect(data[0].events).toEqual(original.events);
      const updated = onChange.mock.calls.at(-1)?.[0] as MeasureData[] | undefined;
      expect(updated?.[0].events[0].arcs ?? undefined).toBeUndefined();
      expect(updated?.[0].voices?.[1]?.events[0].arcs ?? undefined).toBeUndefined();
    });
  });
});
