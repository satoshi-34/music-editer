import { describe, expect, it } from 'vitest';

import type { NoteEvent } from '../types/storage';
import {
  buildTupletGroupPlan,
  buildTupletRestReplacement,
  generateTupletId,
  planTupletGroupDeletion,
} from './tupletUtils';

describe('tupletUtils', () => {
  describe('generateTupletId', () => {
    it('連続して呼んでも重複しない一意な id を発行する', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 200; i += 1) {
        ids.add(generateTupletId());
      }
      expect(ids.size).toBe(200);
    });
  });

  describe('buildTupletGroupPlan', () => {
    it('八分3連（音符1＋連符内休符2）を組み立てる', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4');
      expect(plan.groupEvents).toHaveLength(3);
      expect(plan.groupEvents[0].isRest).toBe(false);
      expect(plan.groupEvents[0].keys).toEqual(['c/4']);
      expect(plan.groupEvents[1].isRest).toBe(true);
      expect(plan.groupEvents[2].isRest).toBe(true);
      // 八分音符3つ分(1.5拍)が、3連符では2/3倍→ 8分音符1つ分(0.5拍)の合計と同じ1拍になる
      expect(plan.groupBeats).toBeCloseTo(1);
    });

    it('グループ内の3イベントは同じ tuplet id を共有する', () => {
      const plan = buildTupletGroupPlan('16', undefined, ['e/4'], 'b/4');
      const ids = new Set(plan.groupEvents.map((ev) => ev.tuplet?.id));
      expect(ids.size).toBe(1);
      expect(plan.groupEvents[0].tuplet).toEqual({ id: [...ids][0], numNotes: 3, notesOccupied: 2 });
    });

    it('連続で呼び出すと毎回別の tuplet id になる（パートをまたいでも衝突しないことの確認）', () => {
      const planA = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4');
      const planB = buildTupletGroupPlan('8', undefined, ['g/3'], 'd/3');
      expect(planA.groupEvents[0].tuplet?.id).not.toBe(planB.groupEvents[0].tuplet?.id);
    });
  });

  describe('buildTupletRestReplacement', () => {
    const tupletInfo = { id: 'tuplet-test', numNotes: 3, notesOccupied: 2 };

    it('連符内の休符でなければ undefined を返す（呼び出し側で通常ロジックへフォールバック）', () => {
      const rest: NoteEvent = { dur: '8', isRest: true, keys: ['b/4'] };
      expect(buildTupletRestReplacement(rest, 'c/4', { duration: '8' })).toBeUndefined();
    });

    it('音価が一致する連符内休符は音符へ置換される（tuplet情報を引き継ぐ）', () => {
      const rest: NoteEvent = { dur: '8', isRest: true, keys: ['b/4'], tuplet: tupletInfo };
      const result = buildTupletRestReplacement(rest, 'c/4', { duration: '8' });
      expect(result).toEqual([{ dur: '8', isRest: false, keys: ['c/4'], dots: undefined, tuplet: tupletInfo }]);
    });

    it('音価が一致しない連符内休符は null（分割せず何もしない）', () => {
      const rest: NoteEvent = { dur: '8', isRest: true, keys: ['b/4'], tuplet: tupletInfo };
      expect(buildTupletRestReplacement(rest, 'c/4', { duration: '16' })).toBeNull();
    });
  });

  describe('planTupletGroupDeletion', () => {
    it('連符内イベントを削除しようとするとグループ全体を実長と同じ通常休符に置き換える', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4');
      const events: NoteEvent[] = [...plan.groupEvents];
      const deletion = planTupletGroupDeletion(events, 1, 'b/4');
      expect(deletion).not.toBeNull();
      expect(deletion!.groupStart).toBe(0);
      expect(deletion!.groupEnd).toBe(2);
      // 3連符（8分音符×3）の実長は4分音符1つ分と同じなので、置き換え後は tuplet なしの4分休符1個になる
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['c/4'] }]);
      expect(deletion!.replacement.every((ev) => !ev.tuplet)).toBe(true);
    });

    it('連符ではないイベントには null を返す', () => {
      const events: NoteEvent[] = [{ dur: '4', isRest: false, keys: ['c/4'] }];
      expect(planTupletGroupDeletion(events, 0, 'b/4')).toBeNull();
    });

    it('他の連符グループが前後に隣接していても自グループだけを対象にする', () => {
      const planA = buildTupletGroupPlan('16', undefined, ['c/4'], 'b/4');
      const planB = buildTupletGroupPlan('8', undefined, ['e/4'], 'b/4');
      const events: NoteEvent[] = [...planA.groupEvents, ...planB.groupEvents];
      const deletion = planTupletGroupDeletion(events, 3, 'b/4');
      expect(deletion!.groupStart).toBe(3);
      expect(deletion!.groupEnd).toBe(5);
    });
  });
});
