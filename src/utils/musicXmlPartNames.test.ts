// MusicXML の <part-name>（#443 Codex round1 P2）:
// 書き出しは安定ID（partId）ではなく表示名を出し、読込は既知の表示名を安定IDへ
// 正規化して往復（export → parse → partId 照合）を保つ。
import { describe, it, expect } from 'vitest';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import { createSavedScoreData } from './storage';
import type { MeasureData } from '../types/storage';

const note = (key: string): MeasureData['events'][number] => ({ dur: '4', isRest: false, keys: [key] });
const mk = (events: MeasureData['events']): MeasureData => ({
  events, voices: [{ id: 'voice-1', events }],
});
const meta = { title: 'パート名', subtitle: '', lyricist: '', composer: '', arranger: '' };

describe('MusicXML の part-name（#443）', () => {
  it('弦楽四重奏の書き出しは正式名を part-name に出し、読込で安定IDへ戻る（往復）', () => {
    const data = createSavedScoreData(
      meta,
      [
        { partId: 'violin-1', clef: 'treble', measures: [mk([note('c/5'), note('d/5'), note('e/5'), note('f/5')])] },
        { partId: 'violin-2', clef: 'treble', measures: [mk([note('a/4'), note('b/4'), note('c/5'), note('d/5')])] },
        { partId: 'viola', clef: 'alto', measures: [mk([note('c/4'), note('d/4'), note('e/4'), note('f/4')])] },
        { partId: 'cello', clef: 'bass', measures: [mk([note('c/3'), note('d/3'), note('e/3'), note('f/3')])] },
      ],
      1, 1, 'quartet'
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<part-name>Violin I</part-name>');
    expect(xml).toContain('<part-name>Violin II</part-name>');
    expect(xml).toContain('<part-name>Viola</part-name>');
    expect(xml).toContain('<part-name>Violoncello</part-name>');
    // 安定IDが表示に漏れない
    expect(xml).not.toContain('<part-name>cello</part-name>');

    const loaded = parseMusicXml(xml);
    expect(loaded.parts.map((p) => p.partId)).toEqual(['violin-1', 'violin-2', 'viola', 'cello']);
  });

  it('保存済み instrumentation の名前を最優先で part-name に出す（既存作品の保存名優先）', () => {
    const data = createSavedScoreData(
      meta,
      [{ partId: 'flute-1', clef: 'treble', measures: [mk([note('c/5'), note('d/5'), note('e/5'), note('f/5')])] }],
      1, 1, 'ensemble', 'C', [4, 4],
      {
        presetId: 'custom',
        name: 'テスト編成',
        parts: [{
          id: 'flute-1', name: 'Große Flöte', abbreviation: 'Fl.', family: 'woodwind',
          clef: 'treble', staffCount: 1, transposition: 'C', bracketGroup: 'winds',
          playbackInstrument: 'piano', order: 0,
        }],
      } as never
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<part-name>Große Flöte</part-name>');
  });

  it('単旋律の往復で partId が melody のまま保たれる', () => {
    const data = createSavedScoreData(
      meta,
      [{ partId: 'melody', clef: 'treble', measures: [mk([note('c/5'), note('d/5'), note('e/5'), note('f/5')])] }],
      1, 1, 'single'
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<part-name>Melody</part-name>');
    const loaded = parseMusicXml(xml);
    expect(loaded.parts[0].partId).toBe('melody');
  });
});
