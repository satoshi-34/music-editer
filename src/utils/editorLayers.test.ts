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
import { MAX_VOICES_PER_PART, enforceVoiceLimitInParts, withVoiceEventsUpdated } from './voiceMeasureUtils';

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

  it('「＋」で足した直後の空の声部は、編集中であるあいだチップに残る（#305 の自動掃除に消されない）', () => {
    // 音符を入れる前は使用中の声部は1つだけ。それでも編集中の声部3（添字2）までは出す
    expect(resolveVoiceSlotCount(1, 1, 2)).toBe(3);
    // 逆に、データのほうが多ければデータに合わせる（3声の譜面を開いた直後）
    expect(resolveVoiceSlotCount(3, 1, 0)).toBe(3);
    expect(resolveVoiceSlotCount(5, 1, 4)).toBe(MAX_VOICES_PER_LAYER);
  });

  it('末尾の空声部は、そこから離れるとチップからも消える（Codex round1 P1-1）', () => {
    // 声部3を足して何も書かないまま声部1へ戻った状態。データは1声のままなので
    // チップも1枚へ戻る（「足した本数」を状態で覚えていた頃は増えっぱなしだった）
    expect(resolveVoiceSlotCount(1, 1, 0)).toBe(1);
    // ピアノ譜は声部1・2が常設なので、離れても2枚は残る（#316 の4枚を維持）
    expect(resolveVoiceSlotCount(1, 2, 0)).toBe(2);
  });

  it('編集対象でない段（null）は、データにある本数だけを出す', () => {
    expect(resolveVoiceSlotCount(3, 1, null)).toBe(3);
    expect(resolveVoiceSlotCount(1, 1, null)).toBe(1);
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

describe('声部の上限はデータ層で強制する（#417 Codex round1 P1-4）', () => {
  it('UI 側の上限（MAX_VOICES_PER_LAYER）はデータ層の上限と同じ値を指す', () => {
    // 別々の値になると「チップは4枚なのにデータは5声を受け付ける」隠れた声部ができる
    expect(MAX_VOICES_PER_LAYER).toBe(MAX_VOICES_PER_PART);
  });

  it('上限を超える声部への書き込みは受け付けない（引数の小節をそのまま返す）', () => {
    const measure: MeasureData = { events: [note('c/5')] };
    const written = withVoiceEventsUpdated(measure, MAX_VOICES_PER_PART, () => [note('e/4')]);
    // 参照ごと同じ = 何も起きていない（Issue #245 の「変化が無ければ引数を返す」約束）
    expect(written).toBe(measure);
  });

  it('上限内の声部への書き込みは従来どおり通る', () => {
    const measure: MeasureData = { events: [note('c/5')] };
    const written = withVoiceEventsUpdated(measure, MAX_VOICES_PER_PART - 1, () => [note('e/4')]);
    expect(written.voices).toHaveLength(MAX_VOICES_PER_PART);
    expect(written.voices?.[MAX_VOICES_PER_PART - 1].events).toHaveLength(1);
  });

  it('読込の境界で、上限を超える声部を落として件数を返す', () => {
    const voices = Array.from({ length: 6 }, (_v, i) => ({ id: `voice-${i + 1}`, events: [note('c/5')] }));
    const parts = [{ id: 'p1', name: 'Piano', clef: 'treble' as const, measures: [{ events: [note('c/5')], voices }] }];
    const result = enforceVoiceLimitInParts(parts);
    expect(result.parts[0].measures[0].voices).toHaveLength(MAX_VOICES_PER_PART);
    // 何小節で落としたかを返す（黙って捨てない・#318）
    expect(result.droppedMeasureCount).toBe(1);
  });

  it('上限以内のデータは配列ごとそのまま返す（無駄な再描画を起こさない）', () => {
    const parts = [{ id: 'p1', name: 'Piano', clef: 'treble' as const, measures: [{ events: [note('c/5')] }] }];
    expect(enforceVoiceLimitInParts(parts).parts).toBe(parts);
    expect(enforceVoiceLimitInParts(parts).droppedMeasureCount).toBe(0);
  });
});
