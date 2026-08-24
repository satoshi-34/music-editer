// 弧の五線間クランプ（Issue #390）の ScorePage 配線テスト。
//
// arcStaveClamp.test.ts は純粋関数だけを見るため、描画側が呼んでいなければ通ってしまう
// （#382 のときも同じ理由で配線テストを求められた）。ここでは作品を復元した実経路で
// 「深い音型に掛けた下向きスラーの弧が、下の五線の上端より下へ行かない」ことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX } from '../utils/symbolCollisionUtils';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/**
 * 月光 m1 型: 上段（Violin I 相当）の深い音型にスラーを掛ける。
 * ピアノはレイヤー明示選択で非選択段の情報が取りにくいため、#382 の配線テストと同じく
 * レイヤー概念の無い弦楽四重奏で「次の五線」との関係を固定する
 * （クランプは PianoSystemCanvas 内の同一経路で、譜種によらず次パートの五線を境界にする）
 */
function seedDeepSlurWork() {
  const deep = [
    { dur: '4' as const, isRest: false, keys: ['b/3'],
      arcs: [{ fromKey: 'b/3', toKey: 'd/4', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' as const }] },
    // 中間音を低くすると、スラーはそれを避けるため自然な膨らみが深くなる（月光型）
    { dur: '4' as const, isRest: false, keys: ['f/3'] },
    { dur: '2' as const, isRest: false, keys: ['d/4'] },
  ];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: '弧クランプ配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: [{
        events: i === 0 ? deep : plain,
        voices: [{ id: 'voice-1', events: i === 0 ? deep : plain }],
      }],
    })),
    1,
    1,
    'quartet'
  );
  const created = createWork('弧クランプ配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/**
 * 弧のパスの「実際に描かれる曲線」の最下点を求める。
 *
 * 注意が2つある:
 * - d 属性の数値をそのまま拾うと**制御点**（曲線上に無い点）まで数えてしまう
 * - t=0.5 の点は、始点と終点の高さが違う弧では極値にならない。
 *   実装と同じ誤りをテストが踏むと不具合を検出できない（#403 round1 P2）
 *
 * ここでは曲線を細かく刻んで最大Yを取る（実装の閉形式とは別のやり方にして、
 * 同じ間違いを両側でしないようにする）。
 */
function lowestCurveYInPath(d: string): number {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 8) return Number.NaN;
  const yOfCubic = (p0y: number, c1y: number, c2y: number, p3y: number, t: number): number => {
    const mt = 1 - t;
    return mt * mt * mt * p0y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * p3y;
  };
  const sample = (p0y: number, c1y: number, c2y: number, p3y: number): number => {
    let max = -Infinity;
    for (let i = 0; i <= 200; i++) max = Math.max(max, yOfCubic(p0y, c1y, c2y, p3y, i / 200));
    return max;
  };
  // "M x y C c1x c1y c2x c2y x y C c1x c1y c2x c2y x y Z"
  const outer = sample(nums[1], nums[3], nums[5], nums[7]);
  const inner = nums.length >= 16 ? sample(nums[7], nums[9], nums[11], nums[13]) : outer;
  return Math.max(outer, inner);
}

/**
 * 小節をまたぐ下向きスラー。Stave は小節ごとに作り直されるので、同じ五線かどうかを
 * オブジェクト同一性で判定するとここが対象外になり、五線へ食い込む（#403 round2 P2）
 */
function seedCrossMeasureDeepSlurWork() {
  const m0 = [
    { dur: '2' as const, isRest: false, keys: ['b/3'],
      arcs: [{ fromKey: 'b/3', toKey: 'd/4', toMeasureIndex: 1, toEventIndex: 1, kind: 'slur' as const }] },
    { dur: '2' as const, isRest: false, keys: ['f/3'] },
  ];
  const m1 = [
    { dur: '2' as const, isRest: false, keys: ['f/3'] },
    { dur: '2' as const, isRest: false, keys: ['d/4'] },
  ];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: '小節またぎ弧テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: [0, 1].map((mi) => {
        const events = i === 0 ? (mi === 0 ? m0 : m1) : plain;
        return { events, voices: [{ id: 'voice-1', events }] };
      }),
    })),
    1,
    2,
    'quartet'
  );
  const created = createWork('小節またぎ弧テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/**
 * 運用者の月光 m2 と同じ形: ピアノ譜の右手・声部2の三連符を renderStaff:'below' で
 * 左手五線へ移し、その音符どうしにスラーを掛ける。
 * 音符は左手五線に描かれるので、右手パートの「次の五線＝左手五線の上端」を境界にすると
 * 音符より上を境界にしてしまい、弧が最大まで潰れる（2026-08-24 実機で発生）
 */
function seedCrossStaffSlurWork() {
  const voice2 = [
    { dur: '8' as const, isRest: false, keys: ['e/3'], renderStaff: 'below' as const,
      arcs: [{ fromKey: 'e/3', toKey: 'c/4', toMeasureIndex: 0, toEventIndex: 2, kind: 'slur' as const }] },
    { dur: '8' as const, isRest: false, keys: ['g/3'], renderStaff: 'below' as const },
    { dur: '8' as const, isRest: false, keys: ['c/4'], renderStaff: 'below' as const },
  ];
  const voice1 = [{ dur: '2' as const, isRest: true, keys: ['b/4'] }];
  const lh = [{ dur: '1' as const, isRest: false, keys: ['c/2', 'g/2', 'c/3'] }];
  const data = createSavedScoreData(
    { title: 'パートまたぎ弧テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [
      { partId: 'right-hand', clef: 'treble', measures: [{
        events: voice1,
        voices: [{ id: 'voice-1', events: voice1 }, { id: 'voice-2', events: voice2, stemDirection: 'down' }],
      }] },
      { partId: 'left-hand', clef: 'bass', measures: [{ events: lh, voices: [{ id: 'voice-1', events: lh }] }] },
    ],
    1,
    1,
    'piano'
  );
  const created = createWork('パートまたぎ弧テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/**
 * 段（システム）をまたぐ深い下向きスラー。1段2小節にして m1(1段目の最後)→m2(2段目の最初)
 * へ掛ける。弧は2本のセグメントに割れ、それぞれ自分の段の五線間に描かれるので、
 * 境界も別々に引く必要がある（#403 round2 P2）
 */
function seedCrossSystemDeepSlurWork() {
  // 各段のセグメントが自然には境界を越えるよう、あいだの音を深くする
  // （越えないとクランプの有無で差が出ず、テストに検出力が無くなる）
  const m1 = [
    { dur: '2' as const, isRest: false, keys: ['b/3'],
      arcs: [{ fromKey: 'b/3', toKey: 'd/4', toMeasureIndex: 2, toEventIndex: 1, kind: 'slur' as const }] },
    { dur: '2' as const, isRest: false, keys: ['c/3'] },
  ];
  const m2 = [
    { dur: '2' as const, isRest: false, keys: ['c/3'] },
    { dur: '2' as const, isRest: false, keys: ['d/4'] },
  ];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: '段またぎ弧テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: [0, 1, 2, 3].map((mi) => {
        const events = i === 0 ? (mi === 1 ? m1 : mi === 2 ? m2 : plain) : plain;
        return { events, voices: [{ id: 'voice-1', events }] };
      }),
    })),
    2,
    2,
    'quartet'
  );
  const created = createWork('段またぎ弧テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

/** 旧形式のタイ（tiedToNext）。同じ五線内で隣の音符へ繋がる */
function seedLegacyTieWork() {
  const events = [
    { dur: '2' as const, isRest: false, keys: ['b/3'], tiedToNext: true },
    { dur: '2' as const, isRest: false, keys: ['b/3'] },
  ];
  const plain = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
  const clefs = ['treble', 'treble', 'alto', 'bass'] as const;
  const data = createSavedScoreData(
    { title: '旧タイテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
      partId,
      clef: clefs[i],
      measures: [{
        events: i === 0 ? events : plain,
        voices: [{ id: 'voice-1', events: i === 0 ? events : plain }],
      }],
    })),
    1,
    1,
    'quartet'
  );
  const created = createWork('旧タイテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: 弧が次の五線へ食い込まない（Issue #390）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('深い音型の下向きスラーでも、弧は下の五線の上端より下へ行かない', async () => {
    seedDeepSlurWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const svg = Array.from(document.querySelectorAll('svg'))
      .find((c) => c.querySelector('rect.vf-note-hit')) as SVGSVGElement;

    // 五線上端は音符ヒットの data-line0-y（描画時の実測値）から取る。昇順2つ目が次の段
    const staveTops = [...new Set(
      Array.from(svg.querySelectorAll('.vf-note-hit'))
        .map((el) => parseFloat(el.getAttribute('data-line0-y')!))
    )].sort((a, b) => a - b);
    expect(staveTops.length).toBeGreaterThanOrEqual(2);
    const nextStaveTopY = staveTops[1];

    // 弧は class="vf-arc"（data-arc-key 付き）で描かれる。
    // 単に path を拾うと音部記号などのグリフまで混ざるので必ず絞る
    const arcPaths = Array.from(svg.querySelectorAll('path.vf-arc'))
      .map((p) => p.getAttribute('d') ?? '');
    expect(arcPaths.length).toBeGreaterThan(0);

    const lowest = Math.max(...arcPaths.map(lowestCurveYInPath));
    expect(Number.isFinite(lowest)).toBe(true);
    // 下の五線に入らない。クランプは中心線を「五線上端−マージン」に合わせるので、
    // 塗りの太さぶん（1px未満）はそこから出るが、五線そのものには届かない
    expect(lowest).toBeLessThan(nextStaveTopY);
    // マージンぶんの余白もおおむね保たれている（太さぶんの超過だけ許す）
    expect(lowest).toBeLessThan(nextStaveTopY - BELOW_SYMBOL_STAVE_BOUNDARY_MARGIN_PX + 1);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // Stave は小節ごとに new されるため、同じ五線かどうかをオブジェクト同一性で比べると
  // 小節をまたぐ弧が「別の五線」と判定されてクランプ対象外になる（#403 round2 P2）
  it('小節をまたぐ弧でも、下の五線に食い込まない', async () => {
    seedCrossMeasureDeepSlurWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('path.vf-arc')).toBeTruthy();
    }, { timeout: 15000 });

    const svg = Array.from(document.querySelectorAll('svg'))
      .find((c) => c.querySelector('rect.vf-note-hit')) as SVGSVGElement;
    const staveTops = [...new Set(
      Array.from(svg.querySelectorAll('.vf-note-hit'))
        .map((el) => parseFloat(el.getAttribute('data-line0-y')!))
    )].sort((a, b) => a - b);
    expect(staveTops.length).toBeGreaterThanOrEqual(2);

    const lowest = Math.max(...Array.from(svg.querySelectorAll('path.vf-arc'))
      .map((p) => lowestCurveYInPath(p.getAttribute('d') ?? '')));
    expect(lowest).toBeLessThan(staveTops[1]);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  /** その弧の下にある「次の五線の上端」を返す（無ければ undefined） */
  function nextStaveTopBelowY(staveTops: number[], y: number): number | undefined {
    return staveTops.find((t) => t > y + 1);
  }

  // 段またぎの弧は2本に割れ、それぞれ自分の段の五線間に描かれる。
  //
  // 注意（検出力の限界）: 段またぎセグメントの膨らみは**端点だけ**で決まり
  // （obstacleY に端点のYを渡している）、間の音符の深さに影響されない。実測でも
  // 深さは常に18px前後で、五線間隔80pxでは境界（五線上端−3px）に届かない。
  // そのためセグメント側のクランプは**防御的**な位置づけで、外しても現在の
  // レイアウトでは差が出ない。このテストは「両セグメントが境界内にある」ことと
  // 2本とも実際に検証したことを固定するに留まる（#403 round2/3）。
  it('段をまたぐ弧は、2本のセグメントとも自分の段の次の五線に食い込まない', async () => {
    seedCrossSystemDeepSlurWork();
    render(<ScorePage />);

    // 段は段ごとに別の SVG に描かれる（＝弧の2本目は別 Canvas 側の経路を通る）
    await waitFor(() => {
      const keys = Array.from(document.querySelectorAll('path.vf-arc'))
        .map((p) => p.getAttribute('data-arc-key') ?? '');
      expect(keys.some((k) => k.endsWith('-1'))).toBe(true);
      expect(keys.some((k) => k.endsWith('-2'))).toBe(true);
    }, { timeout: 15000 });

    const svgs = Array.from(document.querySelectorAll('svg'))
      .filter((c) => c.querySelector('rect.vf-note-hit'));
    expect(svgs.length).toBeGreaterThanOrEqual(2);

    let checked = 0;
    svgs.forEach((svg) => {
      const staveTops = [...new Set(
        Array.from(svg.querySelectorAll('.vf-note-hit'))
          .map((el) => parseFloat(el.getAttribute('data-line0-y')!))
      )].sort((a, b) => a - b);

      Array.from(svg.querySelectorAll('path.vf-arc'))
        .filter((p) => (p.getAttribute('data-arc-key') ?? '').match(/-[12]$/))
        .forEach((seg) => {
          const d = seg.getAttribute('d') ?? '';
          const startY = Number((d.match(/-?\d+(\.\d+)?/g) ?? [])[1]);
          const boundary = nextStaveTopBelowY(staveTops, startY);
          if (boundary === undefined) return;   // 最下段のセグメントは境界なし
          expect(lowestCurveYInPath(d)).toBeLessThan(boundary);
          checked += 1;
        });
    });
    // 1本目・2本目の両方を実際に検証できていること（素通りで通らないように）
    expect(checked).toBeGreaterThanOrEqual(2);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 旧形式のタイ（tiedToNext）も同じ経路を通ることの確認。
  // タイは元々浅いので境界に届かず、こちらも防御的な配線の確認に留まる
  it('旧形式のタイでも、下の五線に食い込まない', async () => {
    seedLegacyTieWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('path.vf-arc')).toBeTruthy();
    }, { timeout: 15000 });

    const svg = Array.from(document.querySelectorAll('svg'))
      .find((c) => c.querySelector('rect.vf-note-hit')) as SVGSVGElement;
    const staveTops = [...new Set(
      Array.from(svg.querySelectorAll('.vf-note-hit'))
        .map((el) => parseFloat(el.getAttribute('data-line0-y')!))
    )].sort((a, b) => a - b);
    expect(staveTops.length).toBeGreaterThanOrEqual(2);

    const lowest = Math.max(...Array.from(svg.querySelectorAll('path.vf-arc'))
      .map((p) => lowestCurveYInPath(p.getAttribute('d') ?? '')));
    expect(lowest).toBeLessThan(staveTops[1]);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // クランプが「音符より上」を境界にしてしまうと、弧は最大まで潰されてほぼ直線になる。
  // 潰れていない＝ちゃんと弧の形が残っていることを固定する
  it('パートまたぎ（⇵）の音符に掛けた弧を、平らに潰さない', async () => {
    seedCrossStaffSlurWork();
    render(<ScorePage />);

    await waitFor(() => {
      expect(document.querySelector('path.vf-arc')).toBeTruthy();
    }, { timeout: 15000 });

    const arcPath = document.querySelector('path.vf-arc')!.getAttribute('d') ?? '';
    const nums = arcPath.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(nums.length).toBeGreaterThanOrEqual(8);

    // 端点を結ぶ直線から、曲線の最下点がどれだけ離れているか（＝弧の深さ）
    const p0y = nums[1];
    const p3y = nums[7];
    const chordMidY = (p0y + p3y) / 2;
    const lowest = lowestCurveYInPath(arcPath);
    const depth = lowest - chordMidY;

    // 最大まで潰されると深さはほぼ0になる。弧として見える深さが残っていること
    // 境界をパート番号から引いていた頃は、音符より上を境界にしてしまうため
    // 最大まで潰されて深さ 14 前後になっていた（正しくクランプ対象外なら 26 前後）。
    // 20 はその中間で、潰れの再発を捕まえるための線
    expect(depth).toBeGreaterThan(20);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
