// Issue #243: 月光1〜9小節の実機入力データを使った回帰チェックの「描画」担当。
//
// #237（発想標語が描画されない）は「データには入っているのに描かれない」種類の移植漏れだった。
// 読込テスト（moonlightRegressionLoad.test.ts）だけでは検知できないので、
// 実際に PianoSystemCanvas へ流して「例外なく完走し、期待した数の要素が出る」ところまで見る。
//
// 段構成は fixture の systemMeasureOverrides どおり「3小節×3段」。
// 1段ぶんずつ別々に render すると ScorePage 系と同じくマウント回数ぶんだけ重くなり、
// 共有Docker環境でタイムアウトしやすくなるため、3段を1回の render にまとめている
// （マウント回数を減らす方針は #176 の知見）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData, SavedScoreData } from '../types/storage';
import { normalizeTupletGroupsInParts } from '../utils/tupletGroupIntegrity';

// 音源系は描画テストに不要なうえ、実体を読み込むと AudioContext を触りに行くのでモックする。
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
/** fixture の systemMeasureOverrides どおりの段の先頭小節（0起点）。 */
const SYSTEM_START_MEASURES = [0, 3, 6];
const MEASURES_PER_SYSTEM = 3;

/**
 * 段ごとの期待値（fixture からの実測値）。
 *
 * - stavenote: VexFlow が描いた音符・休符の総数。表示専用の穴埋め休符（.vf-padding-rest）を含む
 * - padding:   穴埋め休符の数。3段目だけ出るのは、9小節目の声部が拍を埋め切っていないため
 * - tuplet:    連符の囲み（3連符の「3」）の数
 * - arc:       スラー／タイの弧の数
 */
const EXPECTED_PER_SYSTEM = [
  { stavenote: 42, padding: 0, tuplet: 12, arc: 2 },
  { stavenote: 50, padding: 0, tuplet: 12, arc: 0 },
  // 3段目の連符が 11 → 12 に増えたのは Issue #282 の修正によるもの。
  // 9小節目の連符IDの交錯（既知の傷3）が読込時に区切り直されるようになり、
  // 囲みが描けなかった1グループが描かれるようになった（fixture 自体は無改変）。
  { stavenote: 50, padding: 2, tuplet: 12, arc: 1 },
];

/**
 * 段ごとの「データ上のイベント数（全パート・全声部の合計）」。
 * 穴埋め休符を除いた stavenote の数はこれと一致するはず、という不変条件の期待値。
 */
const EXPECTED_EVENTS_PER_SYSTEM = [42, 50, 48];

function loadFixture(): SavedScoreData {
  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as SavedScoreData;
  // 実際のアプリは localStorage からもファイルからも「正規化を通したデータ」しか画面へ渡さない。
  // このテストも同じ姿を描くために、読込経路と同じ正規化（Issue #282）を通してから使う。
  // fixture のファイル自体は書き換えない（読み込んだあとの姿だけが変わる）。
  return { ...data, parts: normalizeTupletGroupsInParts(data.parts) };
}

describe('月光1〜9小節 回帰チェック: 描画（Issue #243）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeAll(() => {
    // jsdom はレイアウトを持たず clientWidth が常に0になるため、
    // 譜面の横幅計算が成立するように親要素の幅を与える。
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

  // 重い描画なので、3段ぶんを1回だけ描いて、その結果に対して複数の観点を確認する。
  it('3段ぶんを例外なく描き切り、音符・連符・スラーの数が期待どおりになる', () => {
    const data = loadFixture();
    const onChange = vi.fn();
    const partsConfig = [
      { clef: data.parts[0].clef, data: data.parts[0].measures as MeasureData[], onChange },
      { clef: data.parts[1].clef, data: data.parts[1].measures as MeasureData[], onChange },
    ];

    const { container } = render(
      <div>
        {SYSTEM_START_MEASURES.map((startMeasureIndex) => (
          <PianoSystemCanvas
            key={startMeasureIndex}
            measuresPerSystem={MEASURES_PER_SYSTEM}
            startMeasureIndex={startMeasureIndex}
            tool={{ duration: '4', isRest: false } as never}
            scale={1}
            partsConfig={partsConfig}
            showInstrumentLabels={false}
            keySignature={data.keySignature}
            timeSignature={data.timeSignature}
          />
        ))}
      </div>
    );

    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs).toHaveLength(SYSTEM_START_MEASURES.length);

    svgs.forEach((svg, systemIndex) => {
      const counts = {
        stavenote: svg.querySelectorAll('g.vf-stavenote').length,
        padding: svg.querySelectorAll('.vf-padding-rest').length,
        tuplet: svg.querySelectorAll('g.vf-tuplet').length,
        arc: svg.querySelectorAll('path[data-arc-key]').length,
      };
      expect(counts, `${systemIndex + 1}段目`).toEqual(EXPECTED_PER_SYSTEM[systemIndex]);

      // 大譜表なので、どの段も五線は2本（右手・左手）描かれている。
      expect(svg.querySelectorAll('g.vf-stave').length).toBeGreaterThanOrEqual(2);

      // 不変条件: 穴埋め休符を除いた音符・休符の数は、データ上のイベント数と一致する。
      // 数字を丸暗記した期待値とは別経路で「描き漏らし・描きすぎ」を検知するための確認。
      expect(counts.stavenote - counts.padding, `${systemIndex + 1}段目の実イベント数`).toBe(
        EXPECTED_EVENTS_PER_SYSTEM[systemIndex]
      );
    });

    // 3段合わせてスラーは3本。1段目に小節内スラー2本、3段目に小節またぎ（7→8小節）1本。
    const totalArcs = svgs.reduce(
      (sum, svg) => sum + svg.querySelectorAll('path[data-arc-key]').length,
      0
    );
    expect(totalArcs).toBe(3);

    // 連符は全36グループぶんの囲みが描かれる。
    // Issue #282 以前は「9小節目の連符IDが入れ子に交錯している」（既知の傷3）せいで
    // 1グループぶんの囲みが描けず 35 だった。読込時に区切り直すようにしたので 36 で揃う。
    const totalTuplets = svgs.reduce(
      (sum, svg) => sum + svg.querySelectorAll('g.vf-tuplet').length,
      0
    );
    expect(totalTuplets).toBe(36);
  });
});
