// src/utils/musicXmlTempo.test.ts
// テンポ（全体テンポ・小節ごとの数値テンポ変更・速度標語）が MusicXML の
// export/import で往復するかを確認するテスト（Issue #518）。
//
// 以前は全体テンポ（再生パネルの ♩=N）がどこにも書き出されず、
// 書き出し→読み込みで既定の 120 に戻ってしまっていた。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import type { MeasureData, SavedScoreData } from '../types/storage';

/** テスト用の単旋律スコアを作る小さなヘルパー */
function makeScore(measures: MeasureData[]): SavedScoreData {
  return createSavedScoreData(
    { title: 'Tempo Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures }],
    1,
    measures.length,
    'single',
    'C'
  );
}

const oneNoteMeasure = (): MeasureData => ({ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] });

describe('MusicXML の全体テンポ（♩=N）', () => {
  it('globalBpm を渡すと先頭小節に <sound tempo> と <metronome> が出力される', () => {
    const xml = scoreToMusicXml(makeScore([oneNoteMeasure(), oneNoteMeasure()]), { globalBpm: 126 });

    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure1).toContain('<sound tempo="126"/>');
    expect(measure1).toContain('<per-minute>126</per-minute>');
    // 2小節目にはテンポ指定が無いので出さない（全体テンポは先頭小節にだけ書く）
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure2).not.toContain('<sound tempo=');
  });

  it('export → import で全体テンポが保たれる（既定の 120 に戻らない）', () => {
    const xml = scoreToMusicXml(makeScore([oneNoteMeasure(), oneNoteMeasure()]), { globalBpm: 126 });
    const imported = parseMusicXml(xml);

    // 読み込み側は「その小節から有効なテンポ」として先頭小節へ載せる
    expect(imported.parts[0].measures[0].bpm).toBe(126);
  });

  it('globalBpm を渡さない書き出しは従来どおりテンポを出さない（回帰）', () => {
    const xml = scoreToMusicXml(makeScore([oneNoteMeasure()]));
    expect(xml).not.toContain('<sound tempo=');
    expect(xml).not.toContain('<metronome>');
  });

  it('小節ごとの数値テンポ変更は全体テンポより優先して出力される', () => {
    const measures = [oneNoteMeasure(), { ...oneNoteMeasure(), bpm: 90 }];
    const xml = scoreToMusicXml(makeScore(measures), { globalBpm: 126 });

    const measure1 = xml.match(/<measure number="1">(.*?)<\/measure>/s)?.[1] ?? '';
    const measure2 = xml.match(/<measure number="2">(.*?)<\/measure>/s)?.[1] ?? '';
    expect(measure1).toContain('<sound tempo="126"/>');
    expect(measure2).toContain('<sound tempo="90"/>');

    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].bpm).toBe(126);
    expect(imported.parts[0].measures[1].bpm).toBe(90);
  });
});

describe('MusicXML の速度標語（Andante 等）', () => {
  it('速度標語は <words> と目安 BPM の <sound tempo> で出力される', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures));

    expect(xml).toContain('<words>Andante</words>');
    // tempoMarkingPresets の Andante = 76
    expect(xml).toContain('<sound tempo="76"/>');
  });

  it('対応表に無い自由入力は <words> だけを出し、テンポを主張しない', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Allegro con brio' }] },
    ];
    const xml = scoreToMusicXml(makeScore(measures));

    expect(xml).toContain('<words>Allegro con brio</words>');
    expect(xml).not.toContain('<sound tempo=');
  });

  it('export → import で速度標語が復元される', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'], tempoMarking: 'Andante' }] },
      oneNoteMeasure(),
    ];
    const xml = scoreToMusicXml(makeScore(measures));
    const imported = parseMusicXml(xml);

    expect(imported.parts[0].measures[0].events[0].tempoMarking).toBe('Andante');
    expect(imported.parts[0].measures[1].events[0].tempoMarking).toBeUndefined();
  });

  it('速度標語ではない <words>（発想標語など）は取り込まない', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><words>dolce</words></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
    const imported = parseMusicXml(xml);
    expect(imported.parts[0].measures[0].events[0].tempoMarking).toBeUndefined();
  });
});
