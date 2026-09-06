// MusicXML 取り込みの声部上限（#417 round1 P1-4 / round2 P1-1）:
// 5 声以上の小節は上限（MAX_VOICES_PER_PART）まで読み、超過した小節数を返して呼び出し側が通知する。
import { describe, it, expect } from 'vitest';
import { parseMusicXmlWithDefaults } from './musicXmlImport';
import { MAX_VOICES_PER_PART } from './voiceMeasureUtils';

function fiveVoiceMeasureXml(): string {
  const voiceNotes = Array.from({ length: 5 }, (_unused, v) =>
    `${v > 0 ? '<backup><duration>16</duration></backup>' : ''}<note><pitch><step>C</step><octave>${4 + (v % 3)}</octave></pitch><duration>16</duration><voice>${v + 1}</voice><type>whole</type></note>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${voiceNotes}
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
}

describe('MusicXML の声部上限', () => {
  it('5 声の小節は上限までしか読まず、超過した小節数を voicesOverLimitMeasureCount で返す', () => {
    const result = parseMusicXmlWithDefaults(fiveVoiceMeasureXml());
    expect(result.voicesOverLimitMeasureCount).toBe(1);
    const measure = result.score.parts[0].measures[0];
    expect((measure.voices ?? []).length).toBeLessThanOrEqual(MAX_VOICES_PER_PART);
  });

  it('上限内なら voicesOverLimitMeasureCount は undefined', () => {
    const xml = fiveVoiceMeasureXml().replace(/<voice>5<\/voice>/, '<voice>4</voice>');
    const result = parseMusicXmlWithDefaults(xml);
    expect(result.voicesOverLimitMeasureCount).toBeUndefined();
  });
});

describe('大譜表の <voice> 通し番号（round3 P1-1）', () => {
  it('下段を voice 5・6 で書く Finale/MuseScore 流の大譜表では、上限超えとは数えない', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><voice>6</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const result = parseMusicXmlWithDefaults(xml);
    expect(result.voicesOverLimitMeasureCount).toBeUndefined();
    expect(result.score.parts.length).toBe(2);
  });
});
