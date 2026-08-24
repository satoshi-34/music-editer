// Issue #296: 多声部で声部1のスラーが自声部の符頭・ビームを貫通する問題の回帰テスト。
//
// 症状は「弧の向きだけ声部で固定した（#192）が、端点と障害物の計算が符頭基準のまま」
// だったこと。多声部では声部1の符幹が上向きに固定されるので、上向きの弧を符頭に
// 付けると弧の両端が符幹の中から生えてしまい、途中も符幹・ビームを貫く。
//
// ここでは「実際に描かれた SVG」を相手にする。弧のパスをベジェとしてサンプリングし、
// 同じ SVG に描かれた符幹（.vf-stem）・ビーム（.vf-beam の四角形）・符頭と
// 1点でも重なっていないことを確かめる。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import PianoSystemCanvas from './PianoSystemCanvas';
import { deleteVoiceEventFromMeasures } from '../utils/noteDeletionUtils';
import type { MeasureData, SavedScoreData } from '../types/storage';

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

const FIXTURE_PATH = resolve(__dirname, '../../docs/qa/regression/moonlight-bars1-9.score.json');
const TEST_CONTAINER_WIDTH = 900;

/** 月光 fixture の3小節目（0起点で 2）に張られた a/3 → e/4 のスラー。 */
const TARGET_ARC_KEY = 'p0v0m2e0a0';

/**
 * 単声部のままレンダリングしたときの弧のパス（`origin/main` の実測値）。
 *
 * Issue #296 の受入条件「単声部の同じ譜面では従来と1pxも変わらない」を、
 * 数字そのもので固定するために丸ごと持っている。ここが変わったら、
 * 多声部向けの変更が単声部まで漏れているということ。
 */
// 2026-08-24: スラーの曲率を緩めた（下限10→7px・係数0.15→0.13・制御点0.25→0.32）ため、
// この基準値も更新した。固定している性質は「単声部と多声部で1文字も変わらない」ことであり、
// 曲率そのものではない
const SINGLE_VOICE_ARC_D =
  'M 638.513 123 C 672.809 134.659 711.226 134.659 745.227 103 ' +
  'C 710.931 133.086 672.514 133.086 638.513 123 Z';

/**
 * 上段（右手）の五線の下端あたりのY。大譜表の下段（左手）と切り分けるための目安で、
 * 実測では上段が y=80〜120、下段はそれよりずっと下にある。
 */
const UPPER_STAFF_BOTTOM_Y = 130;

/** 対象のスラーが架かっている横方向の範囲（実測値。3小節目のあたり）。 */
const ARC_X_RANGE: [number, number] = [600, 780];

type Pt = { x: number; y: number };

function loadFixture(): SavedScoreData {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as SavedScoreData;
}

/** d 属性から数値だけを順に取り出す（このアプリの弧・符幹・ビームはすべて直線＋ベジェのみ）。 */
function numbersOf(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/**
 * 弧の表示パス（テーパー形状）から、外側・内側の2本の三次ベジェを取り出してサンプリングする。
 *
 * 形は `M p0 C o1 o2 p3 C i2 i1 p0 Z`（`arcUtils.computeArcTaperGeometry`）。
 * 音符とぶつかるかどうかは内側（音符に近い側）で決まるが、両方見ておけば
 * どちらの縁が食い込んでも検知できる。
 */
function sampleArcOutline(d: string, samples = 600): Pt[] {
  const n = numbersOf(d);
  // M(2) + C(6) + C(6) = 14 個。最後の点は始点と同じなので数値には現れない。
  expect(n.length, `弧のパスの数値が足りない: ${d}`).toBeGreaterThanOrEqual(14);
  const p0 = { x: n[0], y: n[1] };
  const o1 = { x: n[2], y: n[3] };
  const o2 = { x: n[4], y: n[5] };
  const p3 = { x: n[6], y: n[7] };
  const i2 = { x: n[8], y: n[9] };
  const i1 = { x: n[10], y: n[11] };

  const cubic = (a: Pt, b: Pt, c: Pt, e: Pt, t: number): Pt => {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return {
      x: w[0] * a.x + w[1] * b.x + w[2] * c.x + w[3] * e.x,
      y: w[0] * a.y + w[1] * b.y + w[2] * c.y + w[3] * e.y,
    };
  };

  const pts: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    pts.push(cubic(p0, o1, o2, p3, t));
    pts.push(cubic(p3, i2, i1, p0, t));
  }
  return pts;
}

type Obstacle = { label: string; polygon: Pt[] };

/**
 * SVG に描かれた「弧が避けるべきもの」を集める。
 *
 * - 符幹: `.vf-stem` の直線（`M x y L x y`）。線の太さぶん左右に広げて短冊にする
 * - ビーム: `.vf-beam` 直下の四角形（数値8個の閉じたパス）
 * - 符頭: `.vf-notehead` の文字位置。jsdom は文字の実寸を返せないので、
 *   五線1間（=10）を目安にした公称サイズの箱として扱う
 */
const STEM_HALF_WIDTH = 1;
const NOTEHEAD_HALF_WIDTH = 6;
const NOTEHEAD_HALF_HEIGHT = 5;

function collectObstacles(svg: SVGSVGElement): Obstacle[] {
  const obstacles: Obstacle[] = [];

  svg.querySelectorAll('.vf-stem path').forEach((el) => {
    const n = numbersOf(el.getAttribute('d') ?? '');
    if (n.length < 4) return;
    const [x1, y1, x2, y2] = n;
    const left = Math.min(x1, x2) - STEM_HALF_WIDTH;
    const right = Math.max(x1, x2) + STEM_HALF_WIDTH;
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    obstacles.push({
      label: `符幹(${x1},${top}-${bottom})`,
      polygon: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
    });
  });

  svg.querySelectorAll('.vf-beam > path').forEach((el) => {
    const n = numbersOf(el.getAttribute('d') ?? '');
    if (n.length < 8) return;
    const polygon: Pt[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) polygon.push({ x: n[i], y: n[i + 1] });
    obstacles.push({ label: `ビーム(${n[0]},${n[1]})`, polygon });
  });

  svg.querySelectorAll('.vf-notehead > text').forEach((el) => {
    const x = Number(el.getAttribute('x'));
    const y = Number(el.getAttribute('y'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    obstacles.push({
      label: `符頭(${x},${y})`,
      polygon: [
        { x: x - NOTEHEAD_HALF_WIDTH, y: y - NOTEHEAD_HALF_HEIGHT },
        { x: x + NOTEHEAD_HALF_WIDTH, y: y - NOTEHEAD_HALF_HEIGHT },
        { x: x + NOTEHEAD_HALF_WIDTH, y: y + NOTEHEAD_HALF_HEIGHT },
        { x: x - NOTEHEAD_HALF_WIDTH, y: y + NOTEHEAD_HALF_HEIGHT },
      ],
    });
  });

  return obstacles;
}

/** 点が多角形の内側にあるか（レイキャスティング＝右方向に線を伸ばして交差回数を数える古典的な方法）。 */
function isInsidePolygon(pt: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > pt.y !== b.y > pt.y;
    if (!straddles) continue;
    const crossX = a.x + ((pt.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (pt.x < crossX) inside = !inside;
  }
  return inside;
}

/** 弧のパスと重なっている障害物のラベルを返す（空なら交差なし）。 */
function findCollisions(arcD: string, obstacles: Obstacle[]): string[] {
  const points = sampleArcOutline(arcD);
  const hit = new Set<string>();
  for (const obstacle of obstacles) {
    if (points.some((p) => isInsidePolygon(p, obstacle.polygon))) hit.add(obstacle.label);
  }
  return Array.from(hit);
}

/** 月光 fixture の3小節目（index 2）へ下声（声部2）を足した譜面データを作る。 */
function withLowerVoiceInMeasure2(measures: MeasureData[]): MeasureData[] {
  const target = measures[2];
  const lowerVoice = ['e/3', 'g/3'].map((key) => ({ dur: '2' as const, isRest: false, keys: [key] }));
  const copy = measures.slice();
  copy[2] = {
    ...target,
    voices: [
      { id: 'voice-1', events: target.events },
      { id: 'voice-2', stemDirection: 'down', events: lowerVoice },
    ],
  };
  return copy;
}

describe('多声部の弧が自声部の符幹・ビームを貫通しない（Issue #296）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeAll(() => {
    // jsdom はレイアウトを持たず clientWidth が 0 になるので、譜面幅の計算用に幅を与える。
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterAll(() => {
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderMoonlightSystem1(options?: { addLowerVoice?: boolean; measuresOverride?: MeasureData[] }) {
    const data = loadFixture();
    const rightHand = data.parts[0].measures as MeasureData[];
    const upperPartMeasures = options?.measuresOverride
      ?? (options?.addLowerVoice ? withLowerVoiceInMeasure2(rightHand) : rightHand);
    const onChange = vi.fn();
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={3}
        startMeasureIndex={0}
        tool={{ duration: '4', isRest: false } as never}
        scale={1}
        partsConfig={[
          { clef: data.parts[0].clef, data: upperPartMeasures, onChange },
          { clef: data.parts[1].clef, data: data.parts[1].measures as MeasureData[], onChange },
        ]}
        showInstrumentLabels={false}
        keySignature={data.keySignature}
        timeSignature={data.timeSignature}
      />
    );
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    const arc = svg.querySelector(`path[data-arc-key="${TARGET_ARC_KEY}"]`);
    expect(arc, `${TARGET_ARC_KEY} の弧が描かれていない`).toBeTruthy();
    return { svg, arcD: arc!.getAttribute('d') ?? '' };
  }

  it('受入1: 下声を足した状態でも、スラーが符頭・符幹・ビームのどれとも交差しない', () => {
    const { svg, arcD } = renderMoonlightSystem1({ addLowerVoice: true });

    // 前提: 下声を足したことで、この弧は声部で決まる向き（声部1＝上向き）になっている。
    const n = numbersOf(arcD);
    expect(n[3], '声部1の弧は上向きのはず').toBeLessThan(n[1]);

    expect(findCollisions(arcD, collectObstacles(svg))).toEqual([]);
  });

  it('受入1の裏取り: 端点が符幹の先端より外側にある（符頭に付いたままではない）', () => {
    const { svg, arcD } = renderMoonlightSystem1({ addLowerVoice: true });
    const n = numbersOf(arcD);
    const startY = n[1];
    const endY = n[7];

    // この小節の声部1（上向き符幹）の符幹先端のうち、いちばん下にあるもの。
    // 端点がそれより上にあれば、符頭ではなく符幹側に付いていると言える。
    //
    // 絞り込みは2つ。x はこの弧が架かっている範囲、y は上段（右手）の五線まわり。
    // 大譜表なので y で絞らないと、下段（左手）の符幹まで拾って条件が緩くなる。
    const upwardStemTops = Array.from(svg.querySelectorAll('.vf-stem path'))
      .map((el) => numbersOf(el.getAttribute('d') ?? ''))
      .filter((v) => v.length >= 4 && v[1] > v[3]) // 下（符頭）から上（先端）へ伸びる＝上向き符幹
      .filter((v) => v[0] > ARC_X_RANGE[0] && v[0] < ARC_X_RANGE[1])
      .filter((v) => v[1] <= UPPER_STAFF_BOTTOM_Y)
      .map((v) => v[3]);
    expect(upwardStemTops.length).toBeGreaterThan(0);
    const lowestStemTop = Math.max(...upwardStemTops);

    expect(startY).toBeLessThan(lowestStemTop);
    expect(endY).toBeLessThan(lowestStemTop);
  });

  it('受入2: 単声部のままなら、弧のパスが1文字も変わらない', () => {
    const { arcD } = renderMoonlightSystem1();
    expect(arcD).toBe(SINGLE_VOICE_ARC_D);
  });

  // Issue #305: 下声を消し切ったのに空の器（voices[1]）が残ると、この小節は多声のまま扱われ、
  // 弧が符幹先端へアンカーされたまま・声部1の符幹が上向き固定のままになる。
  // 「削除経路を通したら単声部の描画へ戻る」ことを、#296 と同じ比較方法（弧のパス文字列）で固定する。
  describe('下声を全部削除したら単声部の描画へ戻る（Issue #305）', () => {
    /** 実際の削除経路（Delete キーが呼ぶ関数）で、声部2の音符を1つずつ消す。 */
    function deleteWholeLowerVoice(measures: MeasureData[]): MeasureData[] {
      let next = measures;
      // 声部2が空になるまで先頭から消す（実機の「全部選んで Delete」と同じ結果になる）。
      while ((next[2].voices?.[1]?.events.length ?? 0) > 0) {
        next = deleteVoiceEventFromMeasures(next, 1, 2, 0, undefined, 'treble');
      }
      return next;
    }

    it('受入: 弧が符頭アンカー・音高ベースの向きへ戻り、単声部と1文字も変わらない', () => {
      const data = loadFixture();
      const rightHand = data.parts[0].measures as MeasureData[];
      const withLower = withLowerVoiceInMeasure2(rightHand);
      const afterDelete = deleteWholeLowerVoice(withLower);

      // 前提: 削除経路が voices ごと畳んでいる（＝多声判定 voices.length > 1 が成立しない）
      expect(afterDelete[2].voices).toBeUndefined();

      const { arcD } = renderMoonlightSystem1({ measuresOverride: afterDelete });
      expect(arcD).toBe(SINGLE_VOICE_ARC_D);
    });

    it('裏取り: 畳まずに空の voices[1] を残したままだと、弧のパスは単声部と一致しない', () => {
      // この対照実験が「単声部と一致しない」まま失敗しなくなったら、
      // 多声かどうかの判定そのものが変わったということ（このテストの前提が崩れている）。
      const data = loadFixture();
      const rightHand = data.parts[0].measures as MeasureData[];
      const withEmptyLower = withLowerVoiceInMeasure2(rightHand).slice();
      withEmptyLower[2] = {
        ...withEmptyLower[2],
        voices: [
          { id: 'voice-1', events: withEmptyLower[2].events },
          { id: 'voice-2', stemDirection: 'down', events: [] },
        ],
      };

      const { arcD } = renderMoonlightSystem1({ measuresOverride: withEmptyLower });
      expect(arcD).not.toBe(SINGLE_VOICE_ARC_D);
    });
  });
});
