// #244 段5-5: 声部3・4（N 声）のデータレベル対応テスト（§2-5 完了条件）。
//
// UI（声部トグル・パレット）は現状 2 声までだが、データモデルと正規 API・保存・再生・
// 出力のコアは N 声で「壊れず全声部が出る」ことをここで固定する。
// 浄書品質（3声の中声の符幹・衝突回避の最適化）は将来課題（§2-5「2を焼き込まない」）。
import { describe, expect, it } from 'vitest';

import type { MeasureData, NoteEvent, SavedScoreData } from '../types/storage';
import {
  flattenMeasureForPlayback,
  getVoiceEvents,
  voiceStemDirectionFor,
  withVoiceEventsUpdated,
} from './voiceMeasureUtils';
import { deleteVoiceEventFromMeasures } from './noteDeletionUtils';
import { saveScoreData, loadScoreData, clearStoredData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import { scoreToMidi } from './midiExport';

const note = (key: string, dur: NoteEvent['dur'] = '4'): NoteEvent => ({ dur, isRest: false, keys: [key] });

/** 4声の小節（鏡は同期済みの正規形） */
function fourVoiceMeasure(): MeasureData {
  const primary = [note('c/5'), note('d/5'), note('e/5'), note('f/5')];
  return {
    events: primary,
    voices: [
      { id: 'voice-1', events: primary.map((ev) => ({ ...ev, keys: [...ev.keys] })) },
      { id: 'voice-2', events: [note('a/4'), note('b/4'), note('c/5'), note('d/5')], stemDirection: 'down' },
      { id: 'voice-3', events: [note('e/4'), note('f/4'), note('g/4'), note('a/4')] },
      { id: 'voice-4', events: [note('c/4', '2'), note('d/4', '2')] },
    ],
  };
}

function savedDataWith(measures: MeasureData[]): SavedScoreData {
  return {
    version: '1.0',
    timestamp: 1,
    metadata: { title: 'n-voice', subtitle: '', lyricist: '', composer: '', arranger: '' },
    scoreType: 'grand-staff',
    parts: [{ partId: 'right-hand', clef: 'treble', measures }],
    systems: 1,
    measuresPerSystem: 4,
  };
}

describe('N 声（声部3・4）のコア対応（#244 段5-5）', () => {
  it('正規 API で声部3・4 を読み書きできる（器の自動生成含む）', () => {
    const base: MeasureData = { events: [note('c/5')] };
    // 声部3（index 2）へ書くと、声部1の鏡と空の声部2が器として揃う
    const withV3 = withVoiceEventsUpdated(base, 2, () => [note('g/4')]);
    expect(withV3.voices).toHaveLength(3);
    expect(getVoiceEvents(withV3, 2)[0].keys).toEqual(['g/4']);
    // さらに声部4へ
    const withV4 = withVoiceEventsUpdated(withV3, 3, () => [note('c/4')]);
    expect(withV4.voices).toHaveLength(4);
    expect(getVoiceEvents(withV4, 3)[0].keys).toEqual(['c/4']);
  });

  it('声部3 のイベント削除が声部1・2・4 に影響しない', () => {
    const measures = [fourVoiceMeasure()];
    const next = deleteVoiceEventFromMeasures(measures, 2, 0, 1, undefined, 'treble');
    expect(next).not.toBe(measures);
    expect(getVoiceEvents(next[0], 0)).toHaveLength(4);
    expect(getVoiceEvents(next[0], 1)).toHaveLength(4);
    expect(getVoiceEvents(next[0], 3)).toHaveLength(2);
  });

  it('保存→読込の往復で4声すべてが保存される', () => {
    try {
      expect(saveScoreData(savedDataWith([fourVoiceMeasure()])).success).toBe(true);
      const loaded = loadScoreData();
      expect(loaded.success).toBe(true);
      const measure = loaded.success ? loaded.data!.parts[0].measures[0] : undefined;
      expect(measure?.voices).toHaveLength(4);
      expect(getVoiceEvents(measure!, 2)[0].keys).toEqual(['e/4']);
      expect(getVoiceEvents(measure!, 3)[0].keys).toEqual(['c/4']);
    } finally {
      clearStoredData();
    }
  });

  it('再生用のフラット化に全声部のイベントが開始拍つきで含まれる', () => {
    const flattened = flattenMeasureForPlayback(fourVoiceMeasure());
    // 4 + 4 + 4 + 2 = 14 イベント
    expect(flattened).toHaveLength(14);
    // 声部4 の2音目（2分音符）は 2 拍目から始まる
    const v4Second = flattened.filter((ev) => ev.keys[0] === 'd/4');
    expect(v4Second).toHaveLength(1);
    expect(v4Second[0].startBeat).toBe(2);
  });

  it('MusicXML 書出に声部3・4 が <voice>3</voice>/<voice>4</voice> として出る（読込往復で戻る）', () => {
    const xml = scoreToMusicXml(savedDataWith([fourVoiceMeasure()]));
    expect(xml).toContain('<voice>3</voice>');
    expect(xml).toContain('<voice>4</voice>');
    const imported = parseMusicXml(xml);
    const measure = imported.parts[0].measures[0];
    // 読込側は <backup> ごとに区切って全声部を復元する（Codex 1巡目 P1:
    // 旧実装は最初の <backup> だけで分割し、4声が2声へ潰れていた）
    expect(measure.voices).toHaveLength(4);
    expect(getVoiceEvents(measure, 1).map((e) => e.keys[0])).toEqual(['a/4', 'b/4', 'c/5', 'd/5']);
    expect(getVoiceEvents(measure, 2).map((e) => e.keys[0])).toEqual(['e/4', 'f/4', 'g/4', 'a/4']);
    expect(getVoiceEvents(measure, 3).map((e) => e.keys[0])).toEqual(['c/4', 'd/4']);
  });

  it('MIDI 書出に全声部の音が出る（声部2以降が出ないバグの修正・§2-5 予告分）', () => {
    const bytes = scoreToMidi(savedDataWith([fourVoiceMeasure()]));
    // Note-On (0x90 ch0) の数 = 4+4+4+2 = 14
    let noteOns = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x90 && bytes[i + 2] === 80) noteOns++;
    }
    expect(noteOns).toBe(14);
  });

  it('符幹方向ポリシーは声部数によらず1関数で決まる（3声のときの中声はポリシー追加で済む形）', () => {
    expect(voiceStemDirectionFor(0, 1)).toBeUndefined();
    expect(voiceStemDirectionFor(0, 2)).toBe('up');
    expect(voiceStemDirectionFor(1, 2)).toBe('down');
    expect(voiceStemDirectionFor(1, 3)).toBe('down');
    expect(voiceStemDirectionFor(2, 4)).toBe('down');
  });
});
