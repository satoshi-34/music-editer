import { describe, expect, it } from 'vitest';
import type { MeasureData } from '../types/storage';
import {
  allocateCombinedMeasureWidths,
  effectiveSystemCount,
  measureMinimumContentWidth,
  planEffectiveMeasuresPerSystem,
  planSystemMeasureRanges,
  vexFlowCombinedMeasureMinimumContentWidth,
} from './measureLayoutUtils';

describe('measureMinimumContentWidth', () => {
  it('16分音符が16個の小節には、ビームを含めた幅を確保する', () => {
    const measure: MeasureData = {
      events: Array.from({ length: 16 }, (_, index) => ({
        dur: '16' as const,
        isRest: false,
        keys: [index % 2 === 0 ? 'c/4' : 'd/4'],
      })),
    };

    // 16個 × (符頭8px + ビーム等4px) + 小節左右余白18px
    expect(measureMinimumContentWidth(measure)).toBe(210);
  });

  it('臨時記号と前打音の張り出しも改段判定に含める', () => {
    const plain: MeasureData = {
      events: Array.from({ length: 4 }, () => ({ dur: '16' as const, isRest: false, keys: ['c/4'] })),
    };
    const decorated: MeasureData = {
      events: Array.from({ length: 4 }, () => ({
        dur: '16' as const,
        isRest: false,
        keys: ['c#/4'],
        graceNotes: [{ keys: ['d/4'], slash: true }],
      })),
    };

    expect(measureMinimumContentWidth(decorated)).toBeGreaterThan(measureMinimumContentWidth(plain));
  });

  it('keys が未確定の編集中データでも幅を計算できる', () => {
    const incompleteMeasure = {
      events: [{ dur: '8', isRest: false }],
    } as unknown as MeasureData;

    expect(() => measureMinimumContentWidth(incompleteMeasure)).not.toThrow();
    expect(measureMinimumContentWidth(incompleteMeasure)).toBe(52);
  });

  it('付点・複数声部・3連符/5連符・臨時記号を含む合同幅を VexFlow で計測できる', () => {
    const triplet = Array.from({ length: 3 }, (_, index) => ({
      dur: '8' as const,
      isRest: false,
      keys: [index === 0 ? 'f#/4' : 'd/4'],
      tuplet: { id: 'right-triplet', numNotes: 3, notesOccupied: 2 },
    }));
    const quintuplet = Array.from({ length: 5 }, (_, index) => ({
      dur: '16' as const,
      isRest: false,
      keys: [index === 0 ? 'g#/3' : 'b/3'],
      tuplet: { id: 'inner-quintuplet', numNotes: 5, notesOccupied: 4 },
    }));
    const rightHand: MeasureData = {
      events: [...triplet, ...Array.from({ length: 3 }, () => ({ dur: '4' as const, isRest: false, keys: ['e/4'] }))],
      voices: [
        { events: [...triplet, ...Array.from({ length: 3 }, () => ({ dur: '4' as const, isRest: false, keys: ['e/4'] }))] },
        { events: [...quintuplet, ...Array.from({ length: 3 }, () => ({ dur: '4' as const, isRest: false, keys: ['c/4'] }))] },
      ],
    };
    const leftHand: MeasureData = {
      events: Array.from({ length: 8 }, (_, index) => ({
        dur: '8' as const,
        isRest: false,
        keys: [index === 6 ? 'a#/2' : 'c/3'],
      })),
    };

    const width = vexFlowCombinedMeasureMinimumContentWidth([rightHand, leftHand], [4, 4]);

    expect(width).toBeTypeOf('number');
    expect(width).toBeGreaterThan(0);
  });

  it('密な64分音符でも合同幅の計測に失敗しない', () => {
    const dense: MeasureData = {
      events: Array.from({ length: 64 }, (_, index) => ({
        dur: '64' as const,
        isRest: false,
        keys: [index % 8 === 0 ? 'c#/4' : 'd/4'],
      })),
    };

    expect(vexFlowCombinedMeasureMinimumContentWidth([dense], [4, 4])).toBeGreaterThan(0);
  });

  it('付点・臨時記号・複数声部を加えるほど合同Formatterの最低幅を狭めない', () => {
    const plain: MeasureData = {
      events: Array.from({ length: 4 }, () => ({ dur: '4' as const, isRest: false, keys: ['c/4'] })),
    };
    const dotted: MeasureData = {
      events: [
        { dur: '2' as const, dots: 1 as const, isRest: false, keys: ['c/4'] },
        { dur: '4' as const, isRest: false, keys: ['d/4'] },
      ],
    };
    const accidental: MeasureData = {
      events: [
        { dur: '4' as const, isRest: false, keys: ['c#/4'] },
        { dur: '4' as const, isRest: false, keys: ['c/4'] },
        { dur: '4' as const, isRest: false, keys: ['d/4'] },
        { dur: '4' as const, isRest: false, keys: ['e/4'] },
      ],
    };
    const multiVoice: MeasureData = {
      ...accidental,
      voices: [
        { events: accidental.events },
        { events: Array.from({ length: 8 }, () => ({ dur: '8' as const, isRest: false, keys: ['g/3'] })) },
      ],
    };

    const plainWidth = vexFlowCombinedMeasureMinimumContentWidth([plain], [4, 4])!;
    expect(vexFlowCombinedMeasureMinimumContentWidth([dotted], [4, 4])!).toBeGreaterThanOrEqual(plainWidth);
    expect(vexFlowCombinedMeasureMinimumContentWidth([accidental], [4, 4])!).toBeGreaterThan(plainWidth);
    expect(vexFlowCombinedMeasureMinimumContentWidth([multiVoice], [4, 4])!).toBeGreaterThanOrEqual(
      vexFlowCombinedMeasureMinimumContentWidth([accidental], [4, 4])!,
    );
  });

  it('complex M10/M22相当の密な合同小節に十分な下限を返す', () => {
    const rightHand: MeasureData = {
      events: Array.from({ length: 16 }, (_, index) => ({
        dur: '16' as const,
        isRest: false,
        keys: [index === 3 ? 'f#/5' : 'c/5'],
      })),
      voices: [
        { events: Array.from({ length: 16 }, () => ({ dur: '16' as const, isRest: false, keys: ['c/5'] })) },
        { events: Array.from({ length: 8 }, () => ({ dur: '8' as const, isRest: false, keys: ['e/4'] })) },
      ],
    };
    const leftHand: MeasureData = {
      events: Array.from({ length: 32 }, (_, index) => ({
        dur: '32' as const,
        isRest: false,
        keys: [index === 20 ? 'a#/2' : 'c/3'],
      })),
    };

    expect(vexFlowCombinedMeasureMinimumContentWidth([rightHand, leftHand], [4, 4])!).toBeGreaterThan(240);
  });

  it('調号由来のnatural・courtesy・三和音の臨時記号を本描画と同じ状態機械で計測する', () => {
    const previous: MeasureData = {
      events: [{ dur: '1', isRest: false, keys: ['f#/4'] }],
    };
    const current: MeasureData = {
      events: [
        // G dur の F natural（調号を打ち消す）と、3和音内の明示的な変化を同時に置く。
        { dur: '2', isRest: false, keys: ['f/4', 'e#/4', 'b#/4'] },
        { dur: '2', isRest: false, keys: ['f/4', 'c/5', 'g/5'] },
      ],
    };
    const plain: MeasureData = {
      events: [{ dur: '1', isRest: false, keys: ['c/5'] }],
    };
    const measured = vexFlowCombinedMeasureMinimumContentWidth([current], [4, 4], {
      measureIndex: 1,
      keySignature: 'G',
      parts: [{ measures: [previous, current], clef: 'treble' }],
    })!;
    const plainWidth = vexFlowCombinedMeasureMinimumContentWidth([plain], [4, 4], {
      measureIndex: 0,
      keySignature: 'G',
      parts: [{ measures: [plain], clef: 'treble' }],
    })!;

    // 以前の「# / b 文字列だけ」方式（約50px）では小節線へ食い込んだケース。
    expect(measured).toBeGreaterThan(110);
    expect(measured).toBeGreaterThan(plainWidth);
  });

  it('全小節で共通の effective measures per system を選び、縮小へ逃がさない', () => {
    const dense: MeasureData = {
      events: Array.from({ length: 32 }, () => ({ dur: '32' as const, isRest: false, keys: ['c#/5'] })),
    };
    const plan = planEffectiveMeasuresPerSystem(
      [{ measures: [dense, dense, dense, dense], clef: 'treble' }],
      [4, 4],
      'C',
      4,
      250,
      0.75,
    );
    expect(plan.effectiveMeasuresPerSystem).toBeLessThan(4);
    expect(plan.effectiveMeasuresPerSystem).toBeGreaterThanOrEqual(1);
  });

  it('1小節でも物理予算を超える極端なデータは明示的なoverflowとして返す', () => {
    const impossible: MeasureData = {
      events: Array.from({ length: 128 }, () => ({ dur: '64' as const, isRest: false, keys: ['c#/5', 'd#/5', 'f#/5'] })),
    };
    const plan = planEffectiveMeasuresPerSystem(
      [{ measures: [impossible], clef: 'treble' }], [4, 4], 'C', 4, 300,
    );
    expect(plan.effectiveMeasuresPerSystem).toBe(1);
    expect(plan.hasUnavoidableOverflow).toBe(true);
  });

  it('effective=2でも従来の12段×4小節の編集枠を24段へ換算して維持する', () => {
    expect(effectiveSystemCount(12, 4, 2, 0)).toBe(24);
    expect(effectiveSystemCount(12, 4, 2, 51)).toBe(26);
  });

  it('最低幅が入らない場合も、追加縮小をせず fit 状態を返す', () => {
    const allocation = allocateCombinedMeasureWidths([280, 140, 90, 90], 420, 0.75);

    expect(allocation.doesFit).toBe(false);
    expect(allocation.contentWidths.reduce((sum, width) => sum + width, 0)).toBe(450);
  });

  it('evenness=0 では余剰を均等配分するだけで最低幅の差を残す', () => {
    // 密な小節（最低幅300）と通常小節（最低幅100×3）を1段に置く。余剰は 1000-600=400。
    const allocation = allocateCombinedMeasureWidths([300, 100, 100, 100], 1000, 1, 0);

    // evenness=0 は「最低幅 + extra/n」= [400, 200, 200, 200]（従来の均等余剰配分）。
    expect(allocation.contentWidths).toEqual([400, 200, 200, 200]);
    // 比例配分だった頃は密な小節が 300 + 400*(300/600) = 500 まで膨らみ差が増幅されていた。
    expect(allocation.contentWidths[0]).toBeLessThan(500);
    expect(allocation.doesFit).toBe(true);
  });

  it('evenness=1 では全小節を完全に等幅へ寄せる（総和は保存）', () => {
    const allocation = allocateCombinedMeasureWidths([300, 100, 100, 100], 1000, 1, 1);

    // equalShare = 1000/4 = 250。evenness=1 なら全小節がこの等分幅になる。
    expect(allocation.contentWidths).toEqual([250, 250, 250, 250]);
    // 総和は使用可能幅（1000）に保たれる。
    expect(allocation.contentWidths.reduce((sum, width) => sum + width, 0)).toBe(1000);
  });

  it('evenness=0.5 では最低幅ベース配分と等幅のちょうど中間へ均す（既定挙動）', () => {
    // 既定の MEASURE_WIDTH_EVENNESS=0.5 を明示的に渡して固定する。
    const allocation = allocateCombinedMeasureWidths([300, 100, 100, 100], 1000, 1, 0.5);

    // base=[400,200,200,200], equalShare=250 → base + 0.5*(250-base)
    //   → [400-75, 200+25, 200+25, 200+25] = [325, 225, 225, 225]
    expect(allocation.contentWidths).toEqual([325, 225, 225, 225]);
    // 密な小節の占有率は evenness=0 の 400/1000=40% から 325/1000=32.5% へ縮む。
    expect(allocation.contentWidths[0]).toBeLessThan(400);
    // 総和は保存され、余剰配分だけの版より密・疎の差が小さい。
    expect(allocation.contentWidths.reduce((sum, width) => sum + width, 0)).toBe(1000);
    expect(allocation.doesFit).toBe(true);
  });

  it('可変system rangeは通常小節を4のまま保ち、密な小節だけを縮めて連続にする', () => {
    const ranges = planSystemMeasureRanges([100, 100, 100, 100, 420, 100, 100, 100, 100], 4, 410);
    expect(ranges.map((range) => range.count)).toEqual([4, 1, 4]);
    expect(ranges.map((range) => range.start)).toEqual([0, 4, 5]);
    expect(ranges[1].overflow).toBe(true);
    expect(ranges.flatMap((range) => Array.from({ length: range.count }, (_, i) => range.start + i)))
      .toEqual(Array.from({ length: 9 }, (_, i) => i));
  });

  it('48小節の編集枠は内容が空でも12個の4小節rangeとして残る', () => {
    const ranges = planSystemMeasureRanges(Array.from({ length: 48 }, () => 52), 4, 550);
    expect(ranges).toHaveLength(12);
    expect(ranges.every((range) => range.count === 4)).toBe(true);
    expect(ranges.at(-1)?.start).toBe(44);
  });

  it('breakAt を指定すると、内容小節と編集バッファ小節が同じ段に混ざらないよう強制的に段が切れる', () => {
    // 48小節の内容 + 8小節の編集バッファ（計56小節）。breakAt=48 で最終内容小節(index47)を含む段を打ち切る。
    const ranges = planSystemMeasureRanges(Array.from({ length: 56 }, () => 52), 4, 550, 48);
    // 46,47 の2小節だけの段で打ち切られ、次の段（編集バッファ）は48から始まる
    const finalContentRange = ranges.find((range) => range.start <= 47 && 47 < range.start + range.count);
    expect(finalContentRange).toEqual({ start: 44, count: 4, minimumWidths: [52, 52, 52, 52], totalWidth: 208, overflow: false });
    // breakAt がちょうど段境界(44+4=48)と一致するため、この例では従来の4小節/段のまま変化しない
    const nextRange = ranges.find((range) => range.start === 48);
    expect(nextRange?.count).toBe(4);
  });

  it('breakAt が段の途中に来る場合はそこで段を打ち切り、次の段はbreakAtから始まる', () => {
    // 47小節の内容（breakAtは47）+ 編集バッファ。段境界(44,48,...)の途中でbreakAtが来るケース。
    const ranges = planSystemMeasureRanges(Array.from({ length: 55 }, () => 52), 4, 550, 47);
    const finalContentRange = ranges.find((range) => range.start === 44);
    // 44から始まる段は本来4小節(44-47)入るはずが、breakAt=47で打ち切られ44,45,46の3小節になる
    expect(finalContentRange?.count).toBe(3);
    const nextRange = ranges.find((range) => range.start === 47);
    expect(nextRange).toBeDefined();
  });

  it('breakAt が既存24小節ぴったり(4小節/段)のときは段の切れ目と一致し、結果が変化しない', () => {
    const withoutBreak = planSystemMeasureRanges(Array.from({ length: 24 }, () => 52), 4, 550);
    const withBreak = planSystemMeasureRanges(Array.from({ length: 24 }, () => 52), 4, 550, 24);
    expect(withBreak).toEqual(withoutBreak);
  });

  describe('systemMeasureOverrides（段ごとの小節数のユーザー上書き）', () => {
    it('上書きのある段はその小節数を使い、無い段は自動計画のまま続きから再計算される', () => {
      // 8小節・4小節/段の自動計画なら [0-3][4-7] の2段になるはずだが、
      // start=0 の段だけ 3小節へ上書きすると、次の段は自動計画で 3 から続く。
      const ranges = planSystemMeasureRanges(
        Array.from({ length: 8 }, () => 52),
        4,
        550,
        undefined,
        [{ startMeasure: 0, count: 3 }],
      );
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 3 },
        { start: 3, count: 4 },
        { start: 7, count: 1 },
      ]);
    });

    it('▶（+1）相当: 上書きで段の最低幅合計が使用可能幅を超えても許容し、overflow を返す', () => {
      // 1小節あたり最低幅300で、2小節に上書きすると600 > availableWidth(410) となり overflow=true。
      const ranges = planSystemMeasureRanges(
        [300, 300, 300, 300],
        1,
        410,
        undefined,
        [{ startMeasure: 0, count: 2 }],
      );
      expect(ranges[0]).toEqual({ start: 0, count: 2, minimumWidths: [300, 300], totalWidth: 600, overflow: true });
    });

    it('◀（-1）相当: count を1へ上書きすると、その段は1小節だけになり残りは自動計画へ戻る', () => {
      const ranges = planSystemMeasureRanges(
        Array.from({ length: 8 }, () => 52),
        4,
        550,
        undefined,
        [{ startMeasure: 0, count: 1 }],
      );
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 1 },
        { start: 1, count: 4 },
        { start: 5, count: 3 },
      ]);
    });

    it('上書きの startMeasure が実際の段境界とずれている場合は無視され、自動計画のまま進む', () => {
      // start=2 は段の途中（自動計画では 0-3 の段の中）なので、この上書きは一致せず適用されない。
      const ranges = planSystemMeasureRanges(
        Array.from({ length: 8 }, () => 52),
        4,
        550,
        undefined,
        [{ startMeasure: 2, count: 5 }],
      );
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 4 },
        { start: 4, count: 4 },
      ]);
    });

    it('残り小節数を超える上書きはクランプされる', () => {
      const ranges = planSystemMeasureRanges(
        Array.from({ length: 5 }, () => 52),
        4,
        550,
        undefined,
        [{ startMeasure: 0, count: 10 }],
      );
      expect(ranges).toEqual([
        { start: 0, count: 5, minimumWidths: Array.from({ length: 5 }, () => 52), totalWidth: 260, overflow: false },
      ]);
    });

    it('overrides が空・未指定でも従来どおりの結果を返す（後方互換）', () => {
      const withUndefined = planSystemMeasureRanges(Array.from({ length: 8 }, () => 52), 4, 550);
      const withEmpty = planSystemMeasureRanges(Array.from({ length: 8 }, () => 52), 4, 550, undefined, []);
      expect(withEmpty).toEqual(withUndefined);
    });
  });
});
