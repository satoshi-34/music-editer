// src/utils/musicXmlGrandStaff.test.ts
// Issue #419: 1つの <part> に複数の五線がある MusicXML（ピアノ大譜表）の読込テスト。
//
// MusicXML のピアノ譜は慣習的に「1つの <part> に <staves>2</staves> を宣言し、
// 各音符が <staff>1|2</staff> で上下どちらの五線かを名乗る」形で書かれる
// （Finale / MuseScore の書き出しも OMR ツールの出力もこの形）。
// 以前の parseMusicXml は <staff> を一切見ておらず、左手の音が右手の五線へ
// 混ざって取り込まれていた（加線だらけの単旋律譜になる）ため、その回帰防止も兼ねる。

import { describe, expect, it } from 'vitest';

import { parseMusicXml } from './musicXmlImport';
import { getMeasureVoices } from './voiceMeasureUtils';

/** 1part×2staves のピアノ譜（MuseScore/Finale 書き出しの形。左手の <voice> は 5 番から） */
const GRAND_STAFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

/** 左手（五線2）に2声部ある譜。MusicXML の慣習で左手の声部番号は 5・6 になる */
const GRAND_STAFF_TWO_VOICES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><voice>6</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

/** OMR（oemer など）の出力に近い形: <staves> はあるが <voice> タグが無い */
const GRAND_STAFF_NO_VOICE_TAG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

/** 従来どおりの「パートごとに <part> を分ける」形式（回帰確認用） */
const SEPARATE_PARTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Right</part-name></score-part>
    <score-part id="P2"><part-name>Left</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

/** その小節の声部ごとの keys 一覧（和音は1イベントに複数 key が入る） */
function voiceKeys(parsedMeasure: Parameters<typeof getMeasureVoices>[0]): string[][] {
  return getMeasureVoices(parsedMeasure).map((voice) => voice.events.flatMap((ev) => ev.keys));
}

describe('MusicXML 読込: 1パート複数五線（ピアノ大譜表）', () => {
  it('<staves>2 の part は右手/左手の2パートに分かれる', () => {
    const parsed = parseMusicXml(GRAND_STAFF_XML);

    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts.map((p) => p.partId)).toEqual(['right-hand', 'left-hand']);
    // 音部記号は <clef number="N"> から五線ごとに読む
    expect(parsed.parts.map((p) => p.clef)).toEqual(['treble', 'bass']);
    expect(parsed.scoreType).toBe('piano');
  });

  it('<staff> ごとに音符が振り分けられる（左手の低音が右手に混ざらない）', () => {
    const parsed = parseMusicXml(GRAND_STAFF_XML);
    const [right, left] = parsed.parts;

    expect(right.measures.map((m) => m.events.flatMap((ev) => ev.keys)))
      .toEqual([['c/5', 'e/5'], ['g/5']]);
    expect(left.measures.map((m) => m.events.flatMap((ev) => ev.keys)))
      .toEqual([['c/3'], ['g/2']]);
  });

  it('五線をまたぐ <voice> 番号（左手 5・6）は五線ごとに 1 から振り直される', () => {
    const parsed = parseMusicXml(GRAND_STAFF_TWO_VOICES_XML);
    const [right, left] = parsed.parts;

    // 右手は1声部のまま
    expect(voiceKeys(right.measures[0])).toEqual([['c/5']]);
    // 左手は voice 5 → 声部1、voice 6 → 声部2 に対応づく
    expect(voiceKeys(left.measures[0])).toEqual([['c/3'], ['g/2']]);
    expect(left.measures[0].voices?.map((v) => v.id)).toEqual(['voice-1', 'voice-2']);
  });

  it('練習番号は1番目の五線ぶんだけ拾う（両手に二重に付かない）', () => {
    const parsed = parseMusicXml(GRAND_STAFF_XML);

    expect(parsed.parts[0].measures[0].rehearsalMark).toBe('A');
    expect(parsed.parts[1].measures[0].rehearsalMark).toBeUndefined();
  });

  it('<voice> タグが無い出力（OMR 由来）でも五線で振り分けられる', () => {
    const parsed = parseMusicXml(GRAND_STAFF_NO_VOICE_TAG_XML);

    expect(parsed.parts.map((p) => p.clef)).toEqual(['treble', 'bass']);
    expect(voiceKeys(parsed.parts[0].measures[0])).toEqual([['e/5']]);
    expect(voiceKeys(parsed.parts[1].measures[0])).toEqual([['a/2']]);
  });

  it('従来の「part ごとに分かれた」形式は今までどおり読める（回帰防止）', () => {
    const parsed = parseMusicXml(SEPARATE_PARTS_XML);

    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts.map((p) => p.partId)).toEqual(['Right', 'Left']);
    expect(parsed.parts.map((p) => p.clef)).toEqual(['treble', 'bass']);
    expect(voiceKeys(parsed.parts[0].measures[0])).toEqual([['c/5']]);
    expect(voiceKeys(parsed.parts[1].measures[0])).toEqual([['c/3']]);
  });
});
