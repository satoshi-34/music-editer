// 編集レイヤーのモデル（#417）の単体テスト。
// 「声部は最大4」「V キーは巡回」「空の声部が畳まれてもチップは消えない」を固定する。
import { describe, expect, it } from 'vitest';

import type { MeasureData, NoteEvent } from '../types/storage';
import {
  MAX_VOICES_PER_LAYER,
  buildLayerChips,
  canAddVoice,
  countUsedVoices,
  cycleVoiceIndex,
  layerChipLabel,
  initialVoiceCount,
  layerPartCount,
  layerPartLabel,
  resolveVoiceSlotCount,
} from './editorLayers';

const note = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });

describe('レイヤーのパート軸（#417）', () => {
  it('ピアノ譜だけが手（右手・左手）の2本を持つ', () => {
    expect(layerPartCount('piano')).toBe(2);
    expect(layerPartLabel('piano', 0)).toBe('右手');
    expect(layerPartLabel('piano', 1)).toBe('左手');
  });

  it.each(['single', 'quartet', 'ensemble'] as const)(
    '%s はパート軸を1本として扱い、チップに手の名前を出さない',
    (scoreType) => {
      expect(layerPartCount(scoreType)).toBe(1);
      expect(layerPartLabel(scoreType, 0)).toBeNull();
      expect(layerChipLabel(scoreType, 0, 2)).toBe('声部3');
    }
  );

  it('ピアノ譜のチップ名は #316 の表記（手・声部N）のまま', () => {
    expect(layerChipLabel('piano', 1, 2)).toBe('左手・声部3');
  });
});

describe('最初から出しておく声部の数（#417）', () => {
  it('ピアノ譜は2声から始まる（#316 の「手×声部1/2 の4枚」を保つ）', () => {
    expect(initialVoiceCount('piano')).toBe(2);
    expect(buildLayerChips('piano', [initialVoiceCount('piano'), initialVoiceCount('piano')]).map(c => c.label))
      .toEqual(['右手・声部1', '右手・声部2', '左手・声部1', '左手・声部2']);
  });

  it.each(['single', 'quartet', 'ensemble'] as const)(
    '%s はもともと声部のUIが無かったので1声から始まる',
    (scoreType) => {
      expect(initialVoiceCount(scoreType)).toBe(1);
    }
  );
});

describe('声部数の解決（#417）', () => {
  it('データで使われている声部数を数える（voices を持たない小節は1声）', () => {
    const measures: MeasureData[] = [
      { events: [note('c/5')] },
      {
        events: [note('c/5')],
        voices: [
          { id: 'voice-1', events: [note('c/5')] },
          { id: 'voice-2', events: [note('a/4')] },
          { id: 'voice-3', events: [note('e/4')] },
        ],
      },
    ];
    expect(countUsedVoices(measures)).toBe(3);
  });

  it('空の譜面・未定義でも1を返す', () => {
    expect(countUsedVoices([])).toBe(1);
    expect(countUsedVoices(undefined)).toBe(1);
  });

  it('上限（4）を超える壊れたデータでも4に丸める', () => {
    const voices = Array.from({ length: 6 }, (_v, i) => ({ id: `voice-${i + 1}`, events: [note('c/5')] }));
    expect(countUsedVoices([{ events: [note('c/5')], voices }])).toBe(MAX_VOICES_PER_LAYER);
  });

  it('「＋」で足した希望値は、データがまだ空でもチップの本数として残る（#305 の自動掃除に消されない）', () => {
    // 音符を入れる前は使用中の声部は1つだけ。それでもユーザーが足した3声ぶんを出す
    expect(resolveVoiceSlotCount(1, 3)).toBe(3);
    // 逆に、データのほうが多ければデータに合わせる（3声の譜面を開いた直後）
    expect(resolveVoiceSlotCount(3, 1)).toBe(3);
    expect(resolveVoiceSlotCount(5, 5)).toBe(MAX_VOICES_PER_LAYER);
  });
});

describe('チップ列の組み立て（#417）', () => {
  it('ピアノ譜は手ごとに声部が並ぶ（#316 の4枚と同じ順序）', () => {
    expect(buildLayerChips('piano', [2, 2]).map(c => c.label)).toEqual([
      '右手・声部1', '右手・声部2', '左手・声部1', '左手・声部2',
    ]);
  });

  it('手ごとに声部数が違ってもよい（右手3声・左手1声）', () => {
    expect(buildLayerChips('piano', [3, 1]).map(c => c.label)).toEqual([
      '右手・声部1', '右手・声部2', '右手・声部3', '左手・声部1',
    ]);
  });

  it('単旋律譜は声部だけのチップ列になる', () => {
    expect(buildLayerChips('single', [3]).map(c => c.label)).toEqual(['声部1', '声部2', '声部3']);
  });

  it('声部数が0や上限超えでも1〜4に収める', () => {
    expect(buildLayerChips('single', [0])).toHaveLength(1);
    expect(buildLayerChips('single', [9])).toHaveLength(MAX_VOICES_PER_LAYER);
  });
});

describe('V キーの巡回（#417・従来は 1↔2 のトグル）', () => {
  it('声部1→2→3→4→声部1 と一巡する', () => {
    expect(cycleVoiceIndex(0, 4)).toBe(1);
    expect(cycleVoiceIndex(1, 4)).toBe(2);
    expect(cycleVoiceIndex(2, 4)).toBe(3);
    expect(cycleVoiceIndex(3, 4)).toBe(0);
  });

  it('2声のときは従来どおりのトグルになる（既存の操作感を変えない）', () => {
    expect(cycleVoiceIndex(0, 2)).toBe(1);
    expect(cycleVoiceIndex(1, 2)).toBe(0);
  });

  it('声部が1つしか無いときは動かない', () => {
    expect(cycleVoiceIndex(0, 1)).toBe(0);
  });

  it('声部が減った直後で現在値が範囲外でも、範囲内へ戻して巡回する', () => {
    // 声部3を選んだまま譜面が2声へ畳まれた状態（cycle で 0..1 の外へ出さない）
    expect(cycleVoiceIndex(2, 2)).toBe(0);
  });
});

describe('声部の追加可否（#417）', () => {
  it('4声まで足せる', () => {
    expect(canAddVoice(1)).toBe(true);
    expect(canAddVoice(3)).toBe(true);
    expect(canAddVoice(MAX_VOICES_PER_LAYER)).toBe(false);
  });
});
