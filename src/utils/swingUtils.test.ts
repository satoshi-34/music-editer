import { describe, expect, it } from 'vitest';
import {
  SWING_OFF_BEAT_RATIO,
  SWING_ON_BEAT_RATIO,
  applySwingToTiming,
  isCompoundTimeSignature,
  isSwingEligibleNote,
  shouldApplySwing,
} from './swingUtils';

describe('swingUtils', () => {
  describe('isSwingEligibleNote', () => {
    it('付点なし・連符なしの8分音符は対象になる', () => {
      expect(isSwingEligibleNote('8')).toBe(true);
    });

    it('8分音符以外は対象外', () => {
      expect(isSwingEligibleNote('4')).toBe(false);
      expect(isSwingEligibleNote('16')).toBe(false);
    });

    it('付点8分音符は対象外', () => {
      expect(isSwingEligibleNote('8', 1)).toBe(false);
    });

    it('3連符の8分音符は対象外', () => {
      expect(isSwingEligibleNote('8', undefined, { id: 't1', numNotes: 3, notesOccupied: 2 })).toBe(false);
    });
  });

  describe('applySwingToTiming', () => {
    it('表拍（拍頭）の8分音符は開始位置そのまま・長さが2/3拍になる', () => {
      const result = applySwingToTiming({ startBeat: 0, durationBeats: 0.5 }, '8');
      expect(result.startBeat).toBeCloseTo(0);
      expect(result.durationBeats).toBeCloseTo(SWING_ON_BEAT_RATIO);
    });

    it('裏拍（拍の真ん中）の8分音符は開始位置が2/3拍の位置へ遅れ、長さが1/3拍になる', () => {
      const result = applySwingToTiming({ startBeat: 0.5, durationBeats: 0.5 }, '8');
      expect(result.startBeat).toBeCloseTo(SWING_ON_BEAT_RATIO);
      expect(result.durationBeats).toBeCloseTo(SWING_OFF_BEAT_RATIO);
    });

    it('2拍目以降でも拍頭基準で正しくスウィングする', () => {
      const onBeat = applySwingToTiming({ startBeat: 2, durationBeats: 0.5 }, '8');
      expect(onBeat.startBeat).toBeCloseTo(2);
      expect(onBeat.durationBeats).toBeCloseTo(SWING_ON_BEAT_RATIO);

      const offBeat = applySwingToTiming({ startBeat: 2.5, durationBeats: 0.5 }, '8');
      expect(offBeat.startBeat).toBeCloseTo(2 + SWING_ON_BEAT_RATIO);
      expect(offBeat.durationBeats).toBeCloseTo(SWING_OFF_BEAT_RATIO);
    });

    it('4分音符はストレートのまま変わらない', () => {
      const result = applySwingToTiming({ startBeat: 0, durationBeats: 1 }, '4');
      expect(result).toEqual({ startBeat: 0, durationBeats: 1 });
    });

    it('付点8分音符はストレートのまま変わらない（タイ相当の伸ばした音符も対象外）', () => {
      const result = applySwingToTiming({ startBeat: 0, durationBeats: 0.75 }, '8', 1);
      expect(result).toEqual({ startBeat: 0, durationBeats: 0.75 });
    });

    it('3連符はストレートのまま変わらない', () => {
      const timing = { startBeat: 0, durationBeats: 1 / 3 };
      const result = applySwingToTiming(timing, '8', undefined, { id: 't1', numNotes: 3, notesOccupied: 2 });
      expect(result).toEqual(timing);
    });

    it('16分音符はストレートのまま変わらない', () => {
      const result = applySwingToTiming({ startBeat: 0, durationBeats: 0.25 }, '16');
      expect(result).toEqual({ startBeat: 0, durationBeats: 0.25 });
    });

    it('拍頭・拍の真ん中のどちらにも一致しないオフセットは変わらない', () => {
      const timing = { startBeat: 0.25, durationBeats: 0.5 };
      const result = applySwingToTiming(timing, '8');
      expect(result).toEqual(timing);
    });
  });

  describe('isCompoundTimeSignature', () => {
    it('6/8, 9/8, 12/8 は複合拍子として判定される', () => {
      expect(isCompoundTimeSignature([6, 8])).toBe(true);
      expect(isCompoundTimeSignature([9, 8])).toBe(true);
      expect(isCompoundTimeSignature([12, 8])).toBe(true);
    });

    it('4/4, 3/4, 3/8 は複合拍子ではない', () => {
      expect(isCompoundTimeSignature([4, 4])).toBe(false);
      expect(isCompoundTimeSignature([3, 4])).toBe(false);
      expect(isCompoundTimeSignature([3, 8])).toBe(false);
    });
  });

  describe('shouldApplySwing', () => {
    it('トグルOFFなら常に false', () => {
      expect(shouldApplySwing(false, [4, 4])).toBe(false);
    });

    it('トグルONでも複合拍子なら false', () => {
      expect(shouldApplySwing(true, [6, 8])).toBe(false);
    });

    it('トグルONかつ単純拍子なら true', () => {
      expect(shouldApplySwing(true, [4, 4])).toBe(true);
    });

    it('拍子が渡されない場合はトグルの値だけで判定する', () => {
      expect(shouldApplySwing(true)).toBe(true);
    });
  });
});
