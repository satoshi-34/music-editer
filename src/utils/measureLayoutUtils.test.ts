import { describe, expect, it } from 'vitest';
import type { MeasureData } from '../types/storage';
import {
  allocateCombinedMeasureWidths,
  effectiveSystemCount,
  measureMinimumContentWidth,
  planEffectiveMeasuresPerSystem,
  planSystemMeasureRanges,
  vexFlowCombinedMeasureMinimumContentWidth,
  printScoreAreaWidthPx,
  worstCaseSystemContentBudget,
  PRINT_SCORE_AREA_WIDTH_PX,
  DEFAULT_PAGE_SIDE_MARGIN_MM,
  systemRowSlotHeightPx,
  systemRowTopOffsetsPx,
  resolveDefaultLayoutForScoreType,
  SYSTEM_ROW_GAP_MIN_PX,
  measurePlannerSafetyPadding,
  VEXFLOW_IDEAL_WIDTH_COMPRESSION,
} from './measureLayoutUtils';

describe('printScoreAreaWidthPx / worstCaseSystemContentBudget（ページ余白と本文幅の連動）', () => {
  it('引数省略時は既定余白14mmの従来値と一致する', () => {
    expect(printScoreAreaWidthPx()).toBeCloseTo(PRINT_SCORE_AREA_WIDTH_PX, 6);
    expect(printScoreAreaWidthPx(DEFAULT_PAGE_SIDE_MARGIN_MM)).toBeCloseTo(PRINT_SCORE_AREA_WIDTH_PX, 6);
  });

  it('左右余白を広げると本文幅が狭くなる', () => {
    const narrow = printScoreAreaWidthPx(25);
    const wide = printScoreAreaWidthPx(8);
    expect(narrow).toBeLessThan(printScoreAreaWidthPx(14));
    expect(wide).toBeGreaterThan(printScoreAreaWidthPx(14));
    // 210mm - margin*2 の物理計算どおりであることを確認
    expect(narrow).toBeCloseTo((210 - 25 * 2) * (96 / 25.4), 6);
  });

  it('worstCaseSystemContentBudget も余白拡大に連動して縮む', () => {
    const budgetDefault = worstCaseSystemContentBudget();
    const budgetWideMargin = worstCaseSystemContentBudget(25);
    const budgetNarrowMargin = worstCaseSystemContentBudget(8);
    expect(budgetWideMargin).toBeLessThan(budgetDefault);
    expect(budgetNarrowMargin).toBeGreaterThan(budgetDefault);
  });
});

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

    // 閾値は圧縮率に比例する（0.64 のとき 240 超 → 0.3 のとき 112 超）。符頭の重なりの下限は
    // 別の実寸見積もり（combinedMeasureMinimumContentWidth）が張るので、ここは「VexFlow の理想幅を
    // 圧縮率どおりに縮めた値が返る」ことの固定
    expect(vexFlowCombinedMeasureMinimumContentWidth([rightHand, leftHand], [4, 4])!)
      .toBeGreaterThan(240 * (VEXFLOW_IDEAL_WIDTH_COMPRESSION / 0.64));
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

  it('最低幅の合計が使える幅を超える場合は比例圧縮して段の右端を揃える（段の小節数上書きでの詰め込み対策）', () => {
    // 物理最低幅 = [280,140,90,90]*0.75 = [210,105,67.5,67.5]、合計450 > 使用可能幅420。
    // フォントや五線の縦サイズ（renderScale）は変えず、割り当て幅だけ 420/450 倍へ比例縮小する。
    const allocation = allocateCombinedMeasureWidths([280, 140, 90, 90], 420, 0.75, 0);

    // evenness=0（余剰配分のみ、圧縮後の余剰は0なので base=圧縮後の幅そのもの）。
    expect(allocation.contentWidths.map((w) => Math.round(w * 100) / 100)).toEqual([196, 98, 63, 63]);
    // 総和は使用可能幅ちょうどに保たれる（=段の右端が揃う）。
    expect(allocation.contentWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(420, 5);
    // 圧縮して使用可能幅に収めた以上、はみ出しとしては扱わない。
    expect(allocation.doesFit).toBe(true);
  });

  it('圧縮が発生しない通常ケースでは従来どおり最低幅を尊重する', () => {
    const allocation = allocateCombinedMeasureWidths([100, 100, 100, 100], 1000, 1, 0);

    // sumMin=400 <= usableWidth=1000 なので圧縮は発生せず、従来どおり均等余剰配分（evenness=0）。
    expect(allocation.contentWidths).toEqual([250, 250, 250, 250]);
    expect(allocation.doesFit).toBe(true);
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

  describe('previousRanges / lastEditedMeasureIndex（Issue #67: 編集位置より前の段だけ安定化する）', () => {
    it('lastEditedMeasureIndex が未指定なら previousRanges は無視され、常に貪欲法で計画される', () => {
      // 8小節・4小節/段の自動計画なら [0-3][4-7] の2段。
      const previous = [{ startMeasure: 0, count: 4 }, { startMeasure: 4, count: 4 }];
      // 2小節目(index 1)の幅が増え、段0(0-3)の合計が使用可能幅を超えた想定。
      const widened = [52, 420, 52, 52, 52, 52, 52, 52];
      const ranges = planSystemMeasureRanges(widened, 4, 550, undefined, undefined, previous);
      // previousRanges を渡していても lastEditedMeasureIndex が無いので安定化されず、
      // 通常の貪欲法どおり段0は3小節に縮む。
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 3 },
        { start: 3, count: 4 },
        { start: 7, count: 1 },
      ]);
    });

    it('編集位置より前で完結する段は、幅が変わっても previousRanges の count のまま再利用される', () => {
      const previous = [{ startMeasure: 0, count: 4 }, { startMeasure: 4, count: 4 }];
      // 段0(0-3)の幅は変わっていない前提。段1(4-7)の中の小節6(index 6)を編集した想定。
      const widened = [52, 52, 52, 52, 52, 52, 420, 52];
      // lastEditedMeasureIndex=6 は段0(0-3, end=4<=6)の外なので段0は安定化対象。
      const ranges = planSystemMeasureRanges(widened, 4, 550, undefined, undefined, previous, 6);
      expect(ranges[0]).toEqual({ start: 0, count: 4, minimumWidths: [52, 52, 52, 52], totalWidth: 208, overflow: false });
    });

    it('編集位置を含む段以降は previousRanges を無視し、詰まる／溢れたら次の段へ送られる（最後の段に入力し続けるケース）', () => {
      const previous = [{ startMeasure: 0, count: 4 }, { startMeasure: 4, count: 4 }];
      // 最後の段(4-7)の1小節目(index 4)へ音符を入力し続けて幅が増え、
      // 4小節がもう段に収まらなくなった想定。
      const overflowing = [52, 52, 52, 52, 420, 52, 52, 52];
      // lastEditedMeasureIndex=4 は段1(4-7, start=4)を含むため、段1以降は previousRanges を無視し、
      // 貪欲法で詰まるだけ詰め、溢れた分は次の段へ送る。
      const ranges = planSystemMeasureRanges(overflowing, 4, 550, undefined, undefined, previous, 4);
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 4 },
        { start: 4, count: 3 },
        { start: 7, count: 1 },
      ]);
    });

    it('編集位置を含む段は、内容が減って空きができれば previousRanges に縛られず requested まで詰め直す', () => {
      const previous = [{ startMeasure: 0, count: 2 }, { startMeasure: 2, count: 4 }];
      // 段0(0-1)は以前は密で2小節しか入らなかったが、編集で幅が縮み4小節入るようになった想定。
      const shrunk = [52, 52, 52, 52, 52, 52];
      // lastEditedMeasureIndex=0 は段0(0-1, start=0)を含むため、段0は previousRanges の count(2) に
      // 縛られず、貪欲法で requested(4) まで詰め直される。
      const ranges = planSystemMeasureRanges(shrunk, 4, 550, undefined, undefined, previous, 0);
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 4 },
        { start: 4, count: 2 },
      ]);
    });

    it('overrides は previousRanges / lastEditedMeasureIndex より常に優先される', () => {
      const previous = [{ startMeasure: 0, count: 4 }];
      const ranges = planSystemMeasureRanges(
        Array.from({ length: 8 }, () => 52),
        4,
        550,
        undefined,
        [{ startMeasure: 0, count: 2 }],
        previous,
        6,
      );
      expect(ranges.map((r) => ({ start: r.start, count: r.count }))).toEqual([
        { start: 0, count: 2 },
        { start: 2, count: 4 },
        { start: 6, count: 2 },
      ]);
    });

    it('breakAt をまたぐ previousRanges の段は再利用されず、その段から貪欲法へフォールバックする', () => {
      const previous = [{ startMeasure: 0, count: 4 }];
      // 以前は8小節の内容だったが、末尾を削除して breakAt=3（内容は0-2の3小節）になった想定。
      const ranges = planSystemMeasureRanges(
        Array.from({ length: 8 }, () => 52),
        4,
        550,
        3,
        undefined,
        previous,
        10,
      );
      const finalContentRange = ranges.find((r) => r.start === 0);
      expect(finalContentRange?.count).toBe(3);
    });

    it('previousRanges / lastEditedMeasureIndex が未指定でも従来どおりの結果を返す（後方互換）', () => {
      const withoutPrevious = planSystemMeasureRanges(Array.from({ length: 8 }, () => 52), 4, 550);
      const withUndefinedPrevious = planSystemMeasureRanges(
        Array.from({ length: 8 }, () => 52), 4, 550, undefined, undefined, undefined, undefined,
      );
      expect(withUndefinedPrevious).toEqual(withoutPrevious);
    });
  });
});

describe('systemRowSlotHeightPx / systemRowTopOffsetsPx（段の間隔を単一の連続方式に統一）', () => {
  const BUDGET_PX = 938;
  const SYSTEMS_PER_PAGE = 5;
  // Issue #37 の受入条件どおり、-30/-1/0/+1/+30 の代表値で検証する。
  const GAPS = [-30, -1, 0, 1, 30];

  it('既定値0のスロット高は「予算 ÷ 段数」の均等割で、旧仕様（flex:1 1 0%等分）と一致する', () => {
    expect(systemRowSlotHeightPx(BUDGET_PX, SYSTEMS_PER_PAGE, 0)).toBeCloseTo(BUDGET_PX / SYSTEMS_PER_PAGE, 6);
  });

  it('スロット高は gap に対して単調減少・連続に変化し、0の前後で式が切り替わらない', () => {
    const heights = GAPS.map((gap) => systemRowSlotHeightPx(BUDGET_PX, SYSTEMS_PER_PAGE, gap));
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThan(heights[i - 1]);
    }
    // 線形式 (budget - (n-1)*gap)/n であることを直接確認し、0近傍で特別扱いがないことを検証する。
    GAPS.forEach((gap) => {
      const expected = (BUDGET_PX - (SYSTEMS_PER_PAGE - 1) * gap) / SYSTEMS_PER_PAGE;
      expect(systemRowSlotHeightPx(BUDGET_PX, SYSTEMS_PER_PAGE, gap)).toBeCloseTo(expected, 6);
    });
  });

  it('各段のY座標はgapに対して単調増加・連続に変化する（0前後で段配置が跳ばない）', () => {
    const offsetsByGap = GAPS.map((gap) => systemRowTopOffsetsPx(BUDGET_PX, SYSTEMS_PER_PAGE, gap));

    // 先頭の段（1段目）は常にページ上端（Y=0）で、gapの値に関わらず変わらない。
    offsetsByGap.forEach((offsets) => expect(offsets[0]).toBe(0));

    // 2段目以降の各段について、gapを増やすほどY座標も単調に増加する（連続・非負の傾き）。
    for (let rowIndex = 1; rowIndex < SYSTEMS_PER_PAGE; rowIndex++) {
      for (let i = 1; i < offsetsByGap.length; i++) {
        expect(offsetsByGap[i][rowIndex]).toBeGreaterThan(offsetsByGap[i - 1][rowIndex]);
      }
    }
  });

  it('最終段の下端は常にページ予算いっぱいに一致する（gapの正負に関わらず段が予算を超えない）', () => {
    GAPS.forEach((gap) => {
      const offsets = systemRowTopOffsetsPx(BUDGET_PX, SYSTEMS_PER_PAGE, gap);
      const slotHeight = systemRowSlotHeightPx(BUDGET_PX, SYSTEMS_PER_PAGE, gap);
      const lastRowBottom = offsets[offsets.length - 1] + slotHeight;
      expect(lastRowBottom).toBeCloseTo(BUDGET_PX, 6);
    });
  });
});

describe('resolveDefaultLayoutForScoreType（楽譜種別ごとの音符サイズ・段間隔・パート間隔の既定値、Issue #49・#199）', () => {
  it('単旋律: 音符150%・段間隔0px・パート間隔0px', () => {
    expect(resolveDefaultLayoutForScoreType('single')).toEqual({
      notationSizeMultiplier: 1.5,
      systemRowGapPx: 0,
      partSpacingOffsetPx: 0,
    });
  });

  // ピアノだけは運用者の実測選定値。#199 の旧値（-30/+38）から、市販譜見比べで
  // -3/+20 へ更新（2026-09-03。旧値は段が詰まりすぎ・内側が広すぎた=#586）。
  it('ピアノ: 音符150%・段間隔-3px・パート間隔20px', () => {
    expect(resolveDefaultLayoutForScoreType('piano')).toEqual({
      notationSizeMultiplier: 1.5,
      // 期待値は運用者の市販譜見比べで確定した新既定（2026-09-03: -30/38 → -3/20）
      systemRowGapPx: -3,
      partSpacingOffsetPx: 20,
    });
  });

  it('弦楽四重奏: 音符100%・段間隔0px・パート間隔0px（従来どおり変えない）', () => {
    expect(resolveDefaultLayoutForScoreType('quartet')).toEqual({
      notationSizeMultiplier: 1,
      systemRowGapPx: 0,
      partSpacingOffsetPx: 0,
    });
  });

  it('編成譜: 音符100%・段間隔0px・パート間隔0px（従来どおり変えない）', () => {
    expect(resolveDefaultLayoutForScoreType('ensemble')).toEqual({
      notationSizeMultiplier: 1,
      systemRowGapPx: 0,
      partSpacingOffsetPx: 0,
    });
  });

  // Issue #199: ピアノの既定値 -30px は旧スライダー下限そのものだったため、
  // そこからさらに詰めたい運用者が調整できるよう下限を -60px へ拡張した。
  // 「既定値が下限に張り付いていない」ことをテストで守る（下限を戻すと落ちる）。
  it('段の間隔スライダーの下限は、ピアノの既定値よりさらに低い（下限に張り付かない）', () => {
    expect(SYSTEM_ROW_GAP_MIN_PX).toBe(-60);
    expect(SYSTEM_ROW_GAP_MIN_PX).toBeLessThan(resolveDefaultLayoutForScoreType('piano').systemRowGapPx);
  });
});

describe('ダブルシャープ・ダブルフラットの描画（Issue #423）', () => {
  const plain: MeasureData = {
    events: [
      { dur: '4', isRest: false, keys: ['c/4'] },
      { dur: '4', isRest: false, keys: ['d/4'] },
      { dur: '2', isRest: false, keys: ['e/4'] },
    ],
  };
  const doubled: MeasureData = {
    events: [
      { dur: '4', isRest: false, keys: ['c##/4'] },
      { dur: '4', isRest: false, keys: ['dbb/4'] },
      { dur: '2', isRest: false, keys: ['e/4'] },
    ],
  };

  it('VexFlow が 𝄪 / 𝄫 を受け付け、記号ぶんだけ小節が広くなる', () => {
    // この関数は VexFlow が例外を投げると undefined を返す。
    // つまり「値が返ってくる」こと自体が、Accidental('##'/'bb') を描けている証拠になる。
    const plainWidth = vexFlowCombinedMeasureMinimumContentWidth([plain], [4, 4]);
    const doubledWidth = vexFlowCombinedMeasureMinimumContentWidth([doubled], [4, 4]);
    expect(plainWidth).toBeDefined();
    expect(doubledWidth).toBeDefined();
    expect(doubledWidth as number).toBeGreaterThan(plainWidth as number);
  });
});

describe('小節途中のクレフ変更ぶんの幅の見込み（Issue #424）', () => {
  const quarter = (key: string, clefChange?: 'treble' | 'bass'): MeasureData['events'][number] => ({
    dur: '4', isRest: false, keys: [key], ...(clefChange ? { clefChange } : {}),
  });

  it('途中変更が無い小節の余裕幅は従来どおり（1pxも増えない）', () => {
    const measure: MeasureData = { events: [quarter('c/5'), quarter('e/5')] };
    expect(measurePlannerSafetyPadding([measure])).toBe(0);
  });

  it('途中変更の件数ぶん、小型クレフの幅が余裕幅に足される', () => {
    const one: MeasureData = { events: [quarter('c/5'), quarter('a/3', 'bass')] };
    const two: MeasureData = { events: [quarter('c/5', 'bass'), quarter('a/3'), quarter('e/5', 'treble')] };
    // 小節単位のクレフ変更（measure.clef）と同じ 28px を1件につき見込む。
    // 足りないと、途中変更のある小節だけ音符が詰まって重なる。
    expect(measurePlannerSafetyPadding([one])).toBe(28);
    expect(measurePlannerSafetyPadding([two])).toBe(56);
  });

  it('小節単位の変更（measure.clef）と途中変更は両方とも足される', () => {
    const measure: MeasureData = { clef: 'bass', events: [quarter('c/3'), quarter('e/5', 'treble')] };
    expect(measurePlannerSafetyPadding([measure])).toBe(28 + 28);
  });
});
