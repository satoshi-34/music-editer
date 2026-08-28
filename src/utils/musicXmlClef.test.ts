// src/utils/musicXmlClef.test.ts
// 途中クレフ変更（小節単位の clef・小節途中の clefChange）が MusicXML の
// export / import で正しく往復するかを確認するテスト。
// 読み込み側は Issue #453（段2）で対応した（それ以前は小節途中の <clef> を捨てていた）。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の途中クレフ変更対応（書き出し）', () => {
  it('3小節目に clef があると、その小節の attributes に clef が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Clef Change Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'cello',
        clef: 'bass',
        measures: [
          { events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
          { events: [{ dur: '4', isRest: false, keys: ['c/4'] }], clef: 'tenor' },
        ],
      }],
      1,
      3,
      'single',
      'C'
    );

    const xml = scoreToMusicXml(data);
    // 1小節目: パート既定のヘ音記号（F, line 4）
    expect(xml).toMatch(/<measure number="1">.*<clef><sign>F<\/sign><line>4<\/line><\/clef>/s);
    // 3小節目: テナー記号（C, line 4）へ変更
    expect(xml).toMatch(/<measure number="3">.*<clef><sign>C<\/sign><line>4<\/line><\/clef>/s);
    // 2小節目はクレフが変わらないので clef 自体を出力しない
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure2).not.toContain('<clef>');
  });

  it('小節途中のクレフ変更（NoteEvent.clefChange）は、その音符の直前に attributes が出る（Issue #424）', () => {
    const data = createSavedScoreData(
      { title: 'Mid Measure Clef', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'right-hand',
        clef: 'treble',
        measures: [
          {
            events: [
              { dur: '4', isRest: false, keys: ['c/5'] },
              { dur: '4', isRest: false, keys: ['e/5'] },
              // 3つ目からヘ音記号（月光37小節の書き方）
              { dur: '4', isRest: false, keys: ['a/3'], clefChange: 'bass' },
              { dur: '4', isRest: false, keys: ['f/3'] },
            ],
          },
          { events: [{ dur: '1', isRest: false, keys: ['c/3'] }] },
        ],
      }],
      1,
      2,
      'single',
      'C'
    );

    const xml = scoreToMusicXml(data);
    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    // 小節の途中に「clef だけの attributes」が入り、それが3つ目の音符より前にある
    expect(measure1).toContain('<attributes><clef><sign>F</sign><line>4</line></clef></attributes>');
    const midClefAt = measure1.indexOf('<attributes><clef><sign>F</sign>');
    const thirdNoteAt = measure1.indexOf('<step>A</step>');
    expect(midClefAt).toBeGreaterThan(0);
    expect(midClefAt).toBeLessThan(thirdNoteAt);

    // 次の小節は「前の小節の末尾＝ヘ音記号」を引き継ぐので、頭でもう一度出さない
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure2).not.toContain('<clef>');
  });

  it('パート既定クレフがアルト記号のとき、既定クレフの MusicXML は C/line3 で出力される', () => {
    const data = createSavedScoreData(
      { title: 'Alto Clef Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'viola',
        clef: 'alto',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
      }],
      1,
      1,
      'single',
      'C'
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<clef><sign>C</sign><line>3</line></clef>');
  });

  it('テナー記号のパートを export → import すると、パート既定クレフとして tenor が復元される', () => {
    const data = createSavedScoreData(
      { title: 'Tenor Clef Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'cello',
        clef: 'tenor',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
      }],
      1,
      1,
      'single',
      'C'
    );
    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    expect(parsed.parts[0].clef).toBe('tenor');
  });
});

// ここから読み込み側（Issue #453 / 段2）。
// 書き出しは段1で対応済みだったが、読み込みは小節途中の <clef> を捨てていたため、
// 他ソフト（Finale 等）から持ち込んだ途中クレフ変更が黙って消えていた。
describe('MusicXML の途中クレフ変更対応（読み込み・Issue #453）', () => {
  /** 小節途中に <attributes><clef> を含む外部形式の断片（1パート1五線・divisions=4） */
  function midMeasureClefXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <attributes><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
  }

  it('小節途中の <attributes><clef> が、その位置の音符の clefChange として読み込まれる', () => {
    const parsed = parseMusicXml(midMeasureClefXml());
    const part = parsed.parts[0];
    expect(part.clef).toBe('treble'); // 小節頭のクレフはパート既定クレフのまま
    const events = part.measures[0].events;
    expect(events).toHaveLength(4);
    // 3つ目の音（ヘ音記号の <attributes> の直後）からヘ音記号
    expect(events[2].clefChange).toBe('bass');
    // それ以外の音には clefChange のプロパティ自体が生えない（保存内容を増やさない）
    expect(events[0].clefChange).toBeUndefined();
    expect(events[1].clefChange).toBeUndefined();
    expect(events[3].clefChange).toBeUndefined();
    // 小節単位のクレフ変更としては保存しない（変わったのは小節の途中なので）
    expect(part.measures[0].clef).toBeUndefined();
    // 次の小節は「前の小節の末尾＝ヘ音記号」を引き継ぐので、頭に指定は足さない
    expect(part.measures[1].clef).toBeUndefined();
  });

  it('小節頭の <clef> は、前の小節から変わったときだけ小節単位の clef になる', () => {
    // 2小節目の頭でテナー記号へ、3小節目は同じクレフを念押しで書き直しただけ
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Violoncello</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <attributes><clef><sign>C</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="3">
      <attributes><clef><sign>C</sign><line>4</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const part = parseMusicXml(xml).parts[0];
    expect(part.clef).toBe('bass');
    expect(part.measures[0].clef).toBeUndefined();
    expect(part.measures[1].clef).toBe('tenor');
    // 同じクレフの書き直しは「変更」ではないので取り込まない
    expect(part.measures[2].clef).toBeUndefined();
  });

  it('小節末尾（最後の音より後ろ）の予告クレフは、次の小節の頭からの変更として読み込まれる', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
      <attributes><clef><sign>F</sign><line>4</line></clef></attributes>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const part = parseMusicXml(xml).parts[0];
    // 1小節目の音には付かない（クレフはその音より後ろに書かれている）
    expect(part.measures[0].events[0].clefChange).toBeUndefined();
    expect(part.measures[0].clef).toBeUndefined();
    // 2小節目の頭から有効
    expect(part.measures[1].clef).toBe('bass');
  });

  it('大譜表（<staves>2）では、番号で指された段だけが小節途中のクレフ変更を受け取る', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const parsed = parseMusicXml(xml);
    const upper = parsed.parts[0];
    const lower = parsed.parts[1];
    // 上段（number="1" で指された側）だけ2つ目の音からヘ音記号になる
    expect(upper.measures[0].events[1].clefChange).toBe('bass');
    // 下段は指されていないので何も変わらない（番号なしの先頭 <clef> へのフォールバックで
    // 巻き添えにしない）
    expect(lower.clef).toBe('bass');
    expect(lower.measures[0].events.every((ev) => ev.clefChange === undefined)).toBe(true);
    expect(lower.measures[0].clef).toBeUndefined();
  });

  it('export → import の往復で、小節途中の clefChange と小節単位の clef が保持される', () => {
    const data = createSavedScoreData(
      { title: 'Clef Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [
          {
            events: [
              { dur: '4', isRest: false, keys: ['c/5'] },
              { dur: '4', isRest: false, keys: ['e/5'] },
              { dur: '4', isRest: false, keys: ['a/3'], clefChange: 'bass' },
              { dur: '4', isRest: false, keys: ['f/3'] },
            ],
          },
          // 小節単位の変更（ヘ音記号 → アルト記号）
          { events: [{ dur: '1', isRest: false, keys: ['c/4'] }], clef: 'alto' },
        ],
      }],
      1,
      2,
      'single',
      'C'
    );

    const parsed = parseMusicXml(scoreToMusicXml(data));
    const part = parsed.parts[0];
    expect(part.clef).toBe('treble');
    expect(part.measures[0].events[2].clefChange).toBe('bass');
    expect(part.measures[0].events[0].clefChange).toBeUndefined();
    expect(part.measures[1].clef).toBe('alto');
  });
});
