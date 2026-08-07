// Issue #192（声部2のタイ／スラー 段4）: 弧の向きの既定値と、
// スラーが避ける障害物のスコープを決める純ロジックのテスト。
// 描画（座標計算）を通さずに「浄書上の決めごと」だけを固定する。
import { describe, it, expect } from 'vitest';

import { isSlurObstacleNote, resolveArcUpward } from './arcDirectionUtils';

describe('resolveArcUpward（弧の向きの既定値）', () => {
  describe('2声部が共存する小節', () => {
    it('声部1（上声）は音高に関係なく上向き', () => {
      // pitchBasedUpward=false（＝音高だけなら下向きになる低い音）でも上向きにする。
      expect(resolveArcUpward({
        isMultiVoiceMeasure: true, voiceIndex: 0, pitchBasedUpward: false,
      })).toBe(true);
    });

    it('声部2（下声）は音高に関係なく下向き', () => {
      expect(resolveArcUpward({
        isMultiVoiceMeasure: true, voiceIndex: 1, pitchBasedUpward: true,
      })).toBe(false);
    });

    it('flipDirection（手動反転）は既定値より優先される', () => {
      expect(resolveArcUpward({
        isMultiVoiceMeasure: true, voiceIndex: 1, pitchBasedUpward: true, flipDirection: true,
      })).toBe(true);
      expect(resolveArcUpward({
        isMultiVoiceMeasure: true, voiceIndex: 0, pitchBasedUpward: false, flipDirection: true,
      })).toBe(false);
    });
  });

  describe('声部が1つしか無い小節（声部トグルの無い譜種を含む）', () => {
    it('従来どおり音高から決まる（既定値の上書きをしない）', () => {
      expect(resolveArcUpward({
        isMultiVoiceMeasure: false, voiceIndex: 0, pitchBasedUpward: true,
      })).toBe(true);
      expect(resolveArcUpward({
        isMultiVoiceMeasure: false, voiceIndex: 0, pitchBasedUpward: false,
      })).toBe(false);
    });

    it('flipDirection は従来どおり音高から決まった向きを反転させる', () => {
      expect(resolveArcUpward({
        isMultiVoiceMeasure: false, voiceIndex: 0, pitchBasedUpward: true, flipDirection: true,
      })).toBe(false);
    });
  });
});

describe('isSlurObstacleNote（スラーが避ける音符のスコープ）', () => {
  it('既定では自声部の音符だけを障害物として数える', () => {
    expect(isSlurObstacleNote({ arcVoiceIndex: 1, noteVoiceIndex: 1 })).toBe(true);
    expect(isSlurObstacleNote({ arcVoiceIndex: 1, noteVoiceIndex: 0 })).toBe(false);
    expect(isSlurObstacleNote({ arcVoiceIndex: 0, noteVoiceIndex: 1 })).toBe(false);
  });

  it('all-voices を指定したときだけ他声部の音符も数える（将来の方針変更用の切り替え口）', () => {
    expect(isSlurObstacleNote({ arcVoiceIndex: 1, noteVoiceIndex: 0, scope: 'all-voices' })).toBe(true);
  });
});
