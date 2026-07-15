// src/utils/hairpin.test.ts
// 松葉（ヘアピン、クレッシェンド＜／ディミヌエンド＞）のテスト。
// - 保存データのバリデーション（不正な hairpins を弾く）
// - MusicXML 書き出し（<wedge> の start/stop）
// - 再生ベロシティ（テキストの cresc./dim. と同等の段階変化）

import { describe, expect, it } from 'vitest';

import { createSavedScoreData, validateSavedScoreData } from './storage';
import { scoreToMusicXml, buildHairpinPositionMaps } from './musicXmlExport';
import { resolveDynamicVelocities, buildDynamicEventKey } from './dynamicMarkingUtils';
import type { MeasureData, NoteEvent } from '../types/storage';

/** テスト用の四分音符イベントを作る */
function note(keys: string[] = ['c/4'], extra: Partial<NoteEvent> = {}): NoteEvent {
  return { dur: '4', isRest: false, keys, ...extra };
}

/** テスト用の SavedScoreData を1小節ぶんの events から作る */
function makeScore(measures: MeasureData[]) {
  return createSavedScoreData(
    { title: 'Hairpin Test', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures }],
    1,
    measures.length
  );
}

describe('松葉（ヘアピン）の保存データバリデーション', () => {
  it('正しい hairpins を持つデータは有効と判定される', () => {
    const data = makeScore([{
      events: [
        note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }),
        note(), note(), note(),
      ],
    }]);
    expect(validateSavedScoreData(data)).toBe(true);
  });

  it('offsetY 付きの hairpins も有効と判定される（省略時と同じ扱い）', () => {
    const data = makeScore([{
      events: [
        note(['c/4'], { hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 1, offsetY: -10 }] }),
        note(),
      ],
    }]);
    expect(validateSavedScoreData(data)).toBe(true);
  });

  it('hairpins が無い旧データも従来通り有効（後方互換）', () => {
    const data = makeScore([{ events: [note(), note()] }]);
    expect(validateSavedScoreData(data)).toBe(true);
  });

  it('type が不正な hairpins は弾かれる', () => {
    const data = makeScore([{
      events: [note(['c/4'], { hairpins: [{ type: 'sforzando' as never, endMeasure: 0, endEvent: 1 }] }), note()],
    }]);
    expect(validateSavedScoreData(data)).toBe(false);
  });

  it('endMeasure / endEvent が負や非整数の hairpins は弾かれる', () => {
    const negative = makeScore([{
      events: [note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: -1, endEvent: 0 }] }), note()],
    }]);
    expect(validateSavedScoreData(negative)).toBe(false);

    const fractional = makeScore([{
      events: [note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 1.5 }] }), note()],
    }]);
    expect(validateSavedScoreData(fractional)).toBe(false);
  });

  it('offsetY が範囲外（±100超）の hairpins は弾かれる', () => {
    const data = makeScore([{
      events: [note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 1, offsetY: 500 }] }), note()],
    }]);
    expect(validateSavedScoreData(data)).toBe(false);
  });
});

describe('松葉（ヘアピン）の開始/終了位置マップ', () => {
  it('開始音符の hairpins から starts / stops のキーが正しく作られる', () => {
    const measures: MeasureData[] = [
      { events: [note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: 1, endEvent: 2 }] }), note(), note(), note()] },
      { events: [note(), note(), note(), note()] },
    ];
    const { starts, stops } = buildHairpinPositionMaps(measures);
    expect(starts.get('0-0')).toEqual(['crescendo']);
    expect(stops.get('1-2')).toBe(1);
  });
});

describe('松葉（ヘアピン）の MusicXML 書き出し', () => {
  it('cresc の松葉は <wedge type="crescendo"/> と <wedge type="stop"/> になる', () => {
    const data = makeScore([{
      events: [
        note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }),
        note(), note(), note(),
      ],
    }]);
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<wedge type="crescendo"/>');
    expect(xml).toContain('<wedge type="stop"/>');
    // 開始 wedge は最初の note より前に出ること
    expect(xml.indexOf('<wedge type="crescendo"/>')).toBeLessThan(xml.indexOf('<note>'));
  });

  it('dim の松葉は <wedge type="diminuendo"/> になり、小節をまたいでも stop が出力される', () => {
    const data = makeScore([
      { events: [note(), note(['e/4'], { hairpins: [{ type: 'dim', endMeasure: 1, endEvent: 0 }] })] },
      { events: [note(), note()] },
    ]);
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<wedge type="diminuendo"/>');
    // stop は2小節目（measure number="2"）の中に出る
    const measure2 = xml.slice(xml.indexOf('<measure number="2">'));
    expect(measure2).toContain('<wedge type="stop"/>');
  });

  it('松葉が無い楽譜には wedge を出力しない', () => {
    const data = makeScore([{ events: [note(), note()] }]);
    expect(scoreToMusicXml(data)).not.toContain('<wedge');
  });
});

describe('松葉（ヘアピン）の再生ベロシティ', () => {
  it('cresc の松葉以降、次の音符から段階的にベロシティが上がる（テキスト cresc. と同等）', () => {
    const measures: MeasureData[] = [{
      events: [
        note(['c/4'], { hairpins: [{ type: 'cresc', endMeasure: 0, endEvent: 3 }] }),
        note(), note(), note(),
      ],
    }];
    const velocities = resolveDynamicVelocities(measures);
    const v0 = velocities.get(buildDynamicEventKey(0, 0))!;
    const v1 = velocities.get(buildDynamicEventKey(0, 1))!;
    const v3 = velocities.get(buildDynamicEventKey(0, 3))!;
    expect(v1).toBeGreaterThan(v0);
    expect(v3).toBeGreaterThan(v1);
  });

  it('dim の松葉以降、段階的にベロシティが下がる', () => {
    const measures: MeasureData[] = [{
      events: [
        note(['c/4'], { hairpins: [{ type: 'dim', endMeasure: 0, endEvent: 2 }] }),
        note(), note(),
      ],
    }];
    const velocities = resolveDynamicVelocities(measures);
    const v0 = velocities.get(buildDynamicEventKey(0, 0))!;
    const v2 = velocities.get(buildDynamicEventKey(0, 2))!;
    expect(v2).toBeLessThan(v0);
  });
});
