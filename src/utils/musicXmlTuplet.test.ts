// src/utils/musicXmlTuplet.test.ts
// 連符（tuplet, 例: 3連符）が MusicXML の export → import を通じて保持されるかを確認するテスト。

import { describe, expect, it } from 'vitest';

import { createSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';

describe('MusicXML の連符（tuplet）対応', () => {
  it('3連符（8分音符×3）を export すると time-modification と tuplet start/stop が出力される', () => {
    const tuplet = { id: 'g1', numNotes: 3, notesOccupied: 2 };
    const data = createSavedScoreData(
      { title: 'Tuplet Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<actual-notes>3</actual-notes>');
    expect(xml).toContain('<normal-notes>2</normal-notes>');
    expect(xml).toContain('<tuplet type="start"');
    expect(xml).toContain('<tuplet type="stop"');
    // 通常の8分音符(DIVISIONS=16基準で8) * (2/3) = 5.33... -> 四捨五入で5
    expect(xml).toContain('<duration>5</duration>');
  });

  it('3連符を export → import すると tuplet フィールドがそのまま復元される（ラウンドトリップ）', () => {
    const tuplet = { id: 'g1', numNotes: 3, notesOccupied: 2 };
    const data = createSavedScoreData(
      { title: 'Tuplet Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    const events = parsed.parts[0].measures[0].events;
    expect(events).toHaveLength(3);
    expect(events[0].tuplet).toBeTruthy();
    expect(events[0].tuplet?.numNotes).toBe(3);
    expect(events[0].tuplet?.notesOccupied).toBe(2);
    // 3イベントとも同じグループ id を共有する
    expect(events[1].tuplet?.id).toBe(events[0].tuplet?.id);
    expect(events[2].tuplet?.id).toBe(events[0].tuplet?.id);
  });

  it('5連符（16分音符×5, 5:4）を export → import しても numNotes/notesOccupied がそのまま復元される', () => {
    const tuplet = { id: 'g5', numNotes: 5, notesOccupied: 4 };
    const data = createSavedScoreData(
      { title: 'Quintuplet Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '16', isRest: false, keys: ['c/4'], tuplet },
            { dur: '16', isRest: true, keys: [], tuplet },
            { dur: '16', isRest: true, keys: [], tuplet },
            { dur: '16', isRest: true, keys: [], tuplet },
            { dur: '16', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<actual-notes>5</actual-notes>');
    expect(xml).toContain('<normal-notes>4</normal-notes>');

    const parsed = parseMusicXml(xml);
    const events = parsed.parts[0].measures[0].events;
    expect(events).toHaveLength(5);
    expect(events[0].tuplet?.numNotes).toBe(5);
    expect(events[0].tuplet?.notesOccupied).toBe(4);
    expect(events.every((ev) => ev.tuplet?.id === events[0].tuplet?.id)).toBe(true);
  });

  it('tuplet が無い音符には time-modification も notations/tuplet も出力されない', () => {
    const data = createSavedScoreData(
      { title: 'No Tuplet', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).not.toContain('time-modification');
    expect(xml).not.toContain('<tuplet');
  });
  it('数字を隠した連符（Issue #269）は show-number="none" と bracket="no" 付きで出力される', () => {
    const tuplet = { id: 'g1', numNotes: 3, notesOccupied: 2, hideNumber: true };
    const data = createSavedScoreData(
      { title: 'Tuplet Hide Number', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<tuplet type="start" number="1" bracket="no" show-number="none"/>');
    // 終了タグ側には付けない（MusicXML では開始タグの属性でグループ全体の表示が決まる）
    expect(xml).toContain('<tuplet type="stop" number="1"/>');
  });

  it('hideNumber を指定しない連符の出力は従来どおり（属性が増えない）', () => {
    const tuplet = { id: 'g1', numNotes: 3, notesOccupied: 2 };
    const data = createSavedScoreData(
      { title: 'Tuplet Default', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '8', isRest: false, keys: ['c/4'], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
            { dur: '8', isRest: true, keys: [], tuplet },
          ]
        }]
      }],
      1,
      1
    );

    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<tuplet type="start" number="1"/>');
    expect(xml).not.toContain('show-number');
  });
});

// 連続する同じ比の連符グループの分離（ソナチネ実測バグの再発防止）。
// 以前は「time-modification の連続」だけで判定していたため、三連×3（8分×9個）が
// 1グループ（9イベント/numNotes3）に結合し、描画側が連符と認識しなかった。
describe('MusicXML 読込: 連符グループの境界', () => {
  const NOTE = (step: string, marks: string) => `
      <note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        ${marks}</note>`;
  const wrap = (notes: string) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Mel</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>12</divisions><clef><sign>G</sign><line>2</line></clef></attributes>${notes}
  </measure></part>
</score-partwise>`;

  it('明示の <tuplet type="start"/"stop"> で連続する三連×3 が3グループに分かれる', () => {
    const start = '<notations><tuplet type="start"/></notations>';
    const stop = '<notations><tuplet type="stop"/></notations>';
    const xml = wrap(
      NOTE('C', start) + NOTE('D', '') + NOTE('E', stop)
      + NOTE('F', start) + NOTE('G', '') + NOTE('A', stop)
      + NOTE('B', start) + NOTE('C', '') + NOTE('D', stop));
    const events = parseMusicXml(xml).parts[0].measures[0].events;
    const ids = events.map((e) => e.tuplet?.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[3]).toBe(ids[5]);
    expect(ids[2]).not.toBe(ids[3]);
    // 各グループが numNotes と同数 → 描画側の連符条件を満たす
    expect(events.filter((e) => e.tuplet?.id === ids[0]).length).toBe(3);
  });

  it('明示グループ内では numNotes 個数カットが働かない（4分+8分の2イベント三連が保持される）', () => {
    const start = '<notations><tuplet type="start"/></notations>';
    const stop = '<notations><tuplet type="stop"/></notations>';
    const mixed = (type: string, dur: number, marks: string) => `
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        ${marks}</note>`;
    const xml = wrap(
      mixed('quarter', 8, start) + mixed('eighth', 4, stop)
      + mixed('quarter', 8, start) + mixed('eighth', 4, stop));
    const events = parseMusicXml(xml).parts[0].measures[0].events;
    const ids = events.map((e) => e.tuplet?.id);
    // 明示の境界どおり 2+2 の2グループ（個数カットで 3+1 に割らない）
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[1]).not.toBe(ids[2]);
  });

  it('マーカー無し+混合音価の連続グループは結合したまま読む（既知の制約・3+1に誤分割しない）', () => {
    const mixed = (type: string, dur: number) => `
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
        </note>`;
    const xml = wrap(mixed('quarter', 8) + mixed('eighth', 4) + mixed('quarter', 8) + mixed('eighth', 4));
    const events = parseMusicXml(xml).parts[0].measures[0].events;
    const ids = events.map((e) => e.tuplet?.id);
    // 境界を判定できないため1グループのまま（時間は各イベントの比で保存されている）。
    // 少なくとも「3個で切って 3+1」の誤分割にはならないことを固定する
    expect(new Set(ids).size).toBe(1);
  });

  it('マーカーの無い出力でも numNotes 個ごとにグループが切れる（フォールバック）', () => {
    const xml = wrap(Array.from({ length: 6 }, () => NOTE('C', '')).join(''));
    const events = parseMusicXml(xml).parts[0].measures[0].events;
    const ids = events.map((e) => e.tuplet?.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[3]).toBe(ids[5]);
    expect(ids[2]).not.toBe(ids[3]);
  });
});
