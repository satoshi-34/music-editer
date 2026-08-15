import { describe, expect, it } from 'vitest';

import type { NoteEvent } from '../types/storage';
import {
  buildTupletGroupPlan,
  buildTupletRestReplacement,
  canInheritRestDisplayKey,
  generateTupletId,
  planTupletGroupDeletion,
  planTupletReplacementForRest,
  toggleTupletNumberVisibility,
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

    it('5連符(5:4)を組み立てる: 16分音符5個で音符1＋連符内休符4個、実長は16分音符4個分', () => {
      const plan = buildTupletGroupPlan('16', undefined, ['c/4'], 'b/4', { numNotes: 5, notesOccupied: 4 });
      expect(plan.groupEvents).toHaveLength(5);
      expect(plan.groupEvents[0].isRest).toBe(false);
      expect(plan.groupEvents.slice(1).every((ev) => ev.isRest)).toBe(true);
      expect(plan.groupEvents.every((ev) => ev.tuplet?.numNotes === 5 && ev.tuplet?.notesOccupied === 4)).toBe(true);
      // 16分音符5個(5×0.25=1.25拍)が5:4連符では4/5倍→ 16分音符4個分(1拍)になる
      expect(plan.groupBeats).toBeCloseTo(1);
    });

    it('6連符(6:4)を組み立てる: 音符1＋連符内休符5個', () => {
      const plan = buildTupletGroupPlan('16', undefined, ['c/4'], 'b/4', { numNotes: 6, notesOccupied: 4 });
      expect(plan.groupEvents).toHaveLength(6);
      expect(plan.groupEvents[0].isRest).toBe(false);
      expect(plan.groupEvents.slice(1).every((ev) => ev.isRest)).toBe(true);
      // 16分音符6個(1.5拍)が6:4連符では4/6倍→ 16分音符4個分(1拍)になる
      expect(plan.groupBeats).toBeCloseTo(1);
    });

    it('7連符(7:4)を組み立てる: 音符1＋連符内休符6個', () => {
      const plan = buildTupletGroupPlan('16', undefined, ['c/4'], 'b/4', { numNotes: 7, notesOccupied: 4 });
      expect(plan.groupEvents).toHaveLength(7);
      expect(plan.groupEvents.slice(1).every((ev) => ev.isRest)).toBe(true);
      // 16分音符7個(1.75拍)が7:4連符では4/7倍→ 16分音符4個分(1拍)になる
      expect(plan.groupBeats).toBeCloseTo(1);
    });

    it('tupletSpec を省略すると従来どおり3連符(3:2)になる（後方互換）', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4');
      expect(plan.groupEvents).toHaveLength(3);
      expect(plan.groupEvents[0].tuplet).toEqual({ id: plan.groupEvents[0].tuplet!.id, numNotes: 3, notesOccupied: 2 });
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

  describe('planTupletReplacementForRest（Issue #224: 休符を連符グループで置き換える）', () => {
    const TRIPLET = { numNotes: 3, notesOccupied: 2 };

    it('4分休符を8分3連（1拍）で置き換えると、余りが出ずグループだけになる', () => {
      const rest: NoteEvent = { dur: '4', isRest: true, keys: ['b/4'] };
      const plan = planTupletReplacementForRest(rest, ['c/4'], { duration: '8' }, 'b/4', TRIPLET);
      expect(plan).not.toBeNull();
      expect(plan!.groupEvents).toHaveLength(3);
      expect(plan!.groupEvents[0].isRest).toBe(false);
      expect(plan!.groupEvents[0].keys).toEqual(['c/4']);
      expect(plan!.groupEvents.slice(1).every((ev) => ev.isRest)).toBe(true);
      // 3つとも同じ連符グループに属する
      expect(new Set(plan!.groupEvents.map((ev) => ev.tuplet?.id)).size).toBe(1);
      expect(plan!.remainingBeats).toBe(0);
    });

    it('2分休符（2拍）なら8分3連（1拍）を置いて1拍ぶんが余る', () => {
      const rest: NoteEvent = { dur: '2', isRest: true, keys: ['b/4'] };
      const plan = planTupletReplacementForRest(rest, ['c/4'], { duration: '8' }, 'b/4', TRIPLET);
      expect(plan!.remainingBeats).toBeCloseTo(1, 6);
    });

    it('付点4分休符（1.5拍）でも置ける（余りは0.5拍）', () => {
      const rest: NoteEvent = { dur: '4', dots: 1, isRest: true, keys: ['b/4'] };
      const plan = planTupletReplacementForRest(rest, ['c/4'], { duration: '8' }, 'b/4', TRIPLET);
      expect(plan!.remainingBeats).toBeCloseTo(0.5, 6);
    });

    it('休符がグループより短いときは null（何もしない）', () => {
      // 8分休符=0.5拍に、8分3連グループ=1拍は入らない
      const rest: NoteEvent = { dur: '8', isRest: true, keys: ['b/4'] };
      expect(planTupletReplacementForRest(rest, ['c/4'], { duration: '8' }, 'b/4', TRIPLET)).toBeNull();
    });

    it('連符内の休符は対象外（null）。従来の buildTupletRestReplacement に任せる', () => {
      const rest: NoteEvent = {
        dur: '8', isRest: true, keys: ['b/4'],
        tuplet: { id: 'tuplet-existing', ...TRIPLET },
      };
      expect(planTupletReplacementForRest(rest, ['c/4'], { duration: '8' }, 'b/4', TRIPLET)).toBeNull();
    });

    it('休符ではないイベント（音符）は対象外（null）', () => {
      const note: NoteEvent = { dur: '4', isRest: false, keys: ['c/4'] };
      expect(planTupletReplacementForRest(note, ['c/4'], { duration: '8' }, 'b/4', TRIPLET)).toBeNull();
    });

    it('5連符（16分×5＝1拍）でも4分休符を置き換えられる', () => {
      const rest: NoteEvent = { dur: '4', isRest: true, keys: ['b/4'] };
      const plan = planTupletReplacementForRest(
        rest, ['c/4'], { duration: '16' }, 'b/4', { numNotes: 5, notesOccupied: 4 }
      );
      expect(plan!.groupEvents).toHaveLength(5);
      expect(plan!.remainingBeats).toBe(0);
    });

    it('16分3連（0.5拍）は8分休符（0.5拍）へちょうど収まる（誤差で弾かれない）', () => {
      const rest: NoteEvent = { dur: '8', isRest: true, keys: ['b/4'] };
      const plan = planTupletReplacementForRest(rest, ['c/4'], { duration: '16' }, 'b/4', TRIPLET);
      expect(plan).not.toBeNull();
      expect(plan!.remainingBeats).toBeCloseTo(0, 6);
    });
  });

  describe('planTupletGroupDeletion', () => {
    it('連符内イベントを削除しようとするとグループ全体を実長と同じ通常休符に置き換える', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4');
      const events: NoteEvent[] = [...plan.groupEvents];
      const deletion = planTupletGroupDeletion(events, 1, 'treble');
      expect(deletion).not.toBeNull();
      expect(deletion!.groupStart).toBe(0);
      expect(deletion!.groupEnd).toBe(2);
      // 3連符（8分音符×3）の実長は4分音符1つ分と同じなので、置き換え後は tuplet なしの4分休符1個になる
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['c/4'] }]);
      expect(deletion!.replacement.every((ev) => !ev.tuplet)).toBe(true);
    });

    it('連符ではないイベントには null を返す', () => {
      const events: NoteEvent[] = [{ dur: '4', isRest: false, keys: ['c/4'] }];
      expect(planTupletGroupDeletion(events, 0, 'treble')).toBeNull();
    });

    it('他の連符グループが前後に隣接していても自グループだけを対象にする', () => {
      const planA = buildTupletGroupPlan('16', undefined, ['c/4'], 'b/4');
      const planB = buildTupletGroupPlan('8', undefined, ['e/4'], 'b/4');
      const events: NoteEvent[] = [...planA.groupEvents, ...planB.groupEvents];
      const deletion = planTupletGroupDeletion(events, 3, 'treble');
      expect(deletion!.groupStart).toBe(3);
      expect(deletion!.groupEnd).toBe(5);
    });

    // ===== Issue #226: 消した音の音高をそのまま休符位置にすると異常位置の休符が生まれる =====

    it('五線から極端に離れた音高（ト音の c#/2）のグループを消すと、休符は音価ごとの標準位置になる', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c#/2'], 'b/4');
      const deletion = planTupletGroupDeletion([...plan.groupEvents], 0, 'treble');
      // 引き継がず、4分休符の標準位置（ト音の五線中央 = b/4）へフォールバックする
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['b/4'] }]);
    });

    it('五線に近い音高（下方1加線の c/4）はそのまま引き継ぐ', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4');
      const deletion = planTupletGroupDeletion([...plan.groupEvents], 0, 'treble');
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['c/4'] }]);
    });

    it('範囲判定は音部記号ごとに行う（ヘ音記号なら c/2 は範囲内でそのまま引き継ぐ）', () => {
      const plan = buildTupletGroupPlan('8', undefined, ['c/2'], 'd/3');
      const deletion = planTupletGroupDeletion([...plan.groupEvents], 0, 'bass');
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['c/2'] }]);
    });

    it('範囲外へのフォールバックでは、全休符だけ第4線ぶら下げの標準位置になる', () => {
      // 4分音符の3連符 = 実長2分音符ぶん…ではなく、ここでは全休符が出る長さを作るために
      // 全音符3つの3連符（実長 = 全音符2つぶん = 8拍）を消す。
      // 4/4 の1小節を超える長さだが、planTupletGroupDeletion は拍数の分解だけを行う純関数なので成立する。
      const plan = buildTupletGroupPlan('1', undefined, ['c#/2'], 'b/4');
      const deletion = planTupletGroupDeletion([...plan.groupEvents], 0, 'treble');
      expect(deletion!.replacement).toEqual([
        { dur: '1', isRest: true, keys: ['d/5'] },
        { dur: '1', isRest: true, keys: ['d/5'] },
      ]);
    });

    it('キーが壊れている（解釈できない文字列）ときも標準位置へフォールバックする', () => {
      // keyToLine は解釈できないキーに 2（五線中央）を返すため、
      // 妥当性チェックを飛ばすと「壊れたキーは範囲内」と誤判定してそのまま保存してしまう。
      const plan = buildTupletGroupPlan('8', undefined, ['zz'], 'b/4');
      const deletion = planTupletGroupDeletion([...plan.groupEvents], 0, 'treble');
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['b/4'] }]);
    });

    it('グループ先頭に keys が無いときも標準位置へフォールバックする', () => {
      const plan = buildTupletGroupPlan('8', undefined, [], 'b/4');
      const deletion = planTupletGroupDeletion([...plan.groupEvents], 0, 'treble');
      expect(deletion!.replacement).toEqual([{ dur: '4', isRest: true, keys: ['b/4'] }]);
    });
  });

  describe('canInheritRestDisplayKey', () => {
    it('五線 ±2加線の内側は引き継ぎ可（ト音: 上方2加線 c/6 〜 下方2加線 a/3）', () => {
      expect(canInheritRestDisplayKey('treble', 'b/4')).toBe(true); // 五線中央
      expect(canInheritRestDisplayKey('treble', 'c/6')).toBe(true); // 上方2加線ちょうど
      expect(canInheritRestDisplayKey('treble', 'a/3')).toBe(true); // 下方2加線ちょうど
    });

    it('五線 ±2加線より外は引き継ぎ不可', () => {
      expect(canInheritRestDisplayKey('treble', 'e/6')).toBe(false); // 上方3加線
      expect(canInheritRestDisplayKey('treble', 'f/3')).toBe(false); // 下方3加線
      expect(canInheritRestDisplayKey('treble', 'c#/2')).toBe(false); // Issue #226 の実測ケース
    });

    it('未定義・空文字・壊れたキーは引き継ぎ不可', () => {
      expect(canInheritRestDisplayKey('treble', undefined)).toBe(false);
      expect(canInheritRestDisplayKey('treble', '')).toBe(false);
      expect(canInheritRestDisplayKey('treble', 'h/4')).toBe(false);
    });
  });
  describe('toggleTupletNumberVisibility（Issue #269）', () => {
    it('連符グループの全イベントに hideNumber:true が付く', () => {
      const events = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4').groupEvents;

      const toggled = toggleTupletNumberVisibility(events, 0);

      expect(toggled).not.toBeNull();
      expect(toggled!.every((ev) => ev.tuplet?.hideNumber === true)).toBe(true);
      // 元の配列は書き換えない（Undo 用の履歴が壊れないこと）
      expect(events.every((ev) => ev.tuplet?.hideNumber === undefined)).toBe(true);
    });

    it('もう一度切り替えると hideNumber がプロパティごと消える（旧データと同じ形に戻る）', () => {
      const events = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4').groupEvents;

      const hidden = toggleTupletNumberVisibility(events, 0)!;
      const shown = toggleTupletNumberVisibility(hidden, 2)!;

      expect(shown.every((ev) => ev.tuplet && !('hideNumber' in ev.tuplet))).toBe(true);
    });

    it('連符内休符をクリックしてもグループ全体が切り替わる', () => {
      const events = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4').groupEvents;

      // index 1 と 2 は連符内休符
      const toggled = toggleTupletNumberVisibility(events, 1)!;

      expect(toggled.every((ev) => ev.tuplet?.hideNumber === true)).toBe(true);
    });

    it('隣接する別グループには影響しない', () => {
      const first = buildTupletGroupPlan('8', undefined, ['c/4'], 'b/4').groupEvents;
      const second = buildTupletGroupPlan('8', undefined, ['d/4'], 'b/4').groupEvents;
      const events = [...first, ...second];

      const toggled = toggleTupletNumberVisibility(events, 0)!;

      expect(toggled.slice(0, 3).every((ev) => ev.tuplet?.hideNumber === true)).toBe(true);
      expect(toggled.slice(3).every((ev) => ev.tuplet?.hideNumber === undefined)).toBe(true);
    });

    it('連符ではないイベントを指したときは null を返す（呼び出し側は何もしない）', () => {
      const events: NoteEvent[] = [{ dur: '4', isRest: false, keys: ['c/4'] }];

      expect(toggleTupletNumberVisibility(events, 0)).toBeNull();
    });
  });
});
