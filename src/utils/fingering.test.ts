// src/utils/fingering.test.ts
// 運指番号（指使いの数字）機能のユニットテスト。
// - textElementUtils 経由の付与/削除
// - storage.ts のバリデーション（8文字以内）
// - MusicXML の export/import ラウンドトリップ（単音・和音）

import { describe, expect, it } from 'vitest';

import { createSavedScoreData, saveScoreData, loadScoreData, validateSavedScoreData } from './storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import { applyTextElementToEvent, textElementLabel, textElementPlaceholder } from './textElementUtils';
import type { NoteEvent } from '../types/storage';

describe('運指番号（fingering）: textElementUtils 経由の付与/削除', () => {
  it('applyTextElementToEvent で fingering を設定できる', () => {
    const ev: NoteEvent = { dur: '4', isRest: false, keys: ['c/4'] };
    const withFingering = applyTextElementToEvent(ev, 'fingering', '3');
    expect(withFingering.fingering).toBe('3');
  });

  it('空文字を渡すと fingering フィールドが削除される', () => {
    const ev: NoteEvent = { dur: '4', isRest: false, keys: ['c/4'], fingering: '3' };
    const cleared = applyTextElementToEvent(ev, 'fingering', '   ');
    expect(cleared.fingering).toBeUndefined();
  });

  it('日本語ラベル・プレースホルダーを返す', () => {
    expect(textElementLabel('fingering')).toBe('運指');
    expect(textElementPlaceholder('fingering')).toContain('3');
  });
});

describe('運指番号（fingering）: storage.ts のバリデーション', () => {
  it('8文字以内の文字列は保存・読込できる（単音・和音・指替え）', () => {
    const data = createSavedScoreData(
      { title: 'Fingering Test', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], fingering: '3' },
            { dur: '4', isRest: false, keys: ['c/4', 'e/4', 'g/4'], fingering: '1,3,5' },
            { dur: '4', isRest: false, keys: ['d/4'], fingering: '5-1' },
          ],
        }],
      }],
      1,
      1,
      'single'
    );

    const saveResult = saveScoreData(data);
    expect(saveResult.success).toBe(true);

    const loadResult = loadScoreData();
    expect(loadResult.success).toBe(true);
    const events = loadResult.data?.parts[0].measures[0].events;
    expect(events?.[0].fingering).toBe('3');
    expect(events?.[1].fingering).toBe('1,3,5');
    expect(events?.[2].fingering).toBe('5-1');
  });

  it('9文字以上の fingering は不正データとして弾かれる', () => {
    const invalid = {
      version: '3.5.0',
      timestamp: Date.now(),
      metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
      scoreType: 'single',
      parts: [{
        partId: 'melody',
        clef: 'treble',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], fingering: '123456789' }] }],
      }],
      systems: 1,
      measuresPerSystem: 1,
    };
    expect(validateSavedScoreData(invalid)).toBe(false);
  });

  it('fingering が空文字（長さ0）の場合も不正データとして弾かれる', () => {
    const invalid = {
      version: '3.5.0',
      timestamp: Date.now(),
      metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
      scoreType: 'single',
      parts: [{
        partId: 'melody',
        clef: 'treble',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], fingering: '' }] }],
      }],
      systems: 1,
      measuresPerSystem: 1,
    };
    expect(validateSavedScoreData(invalid)).toBe(false);
  });

  it('fingering 未指定でも既存データ同様に有効', () => {
    const valid = {
      version: '3.5.0',
      timestamp: Date.now(),
      metadata: { title: '', subtitle: '', lyricist: '', composer: '', arranger: '' },
      scoreType: 'single',
      parts: [{
        partId: 'melody',
        clef: 'treble',
        measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }],
      }],
      systems: 1,
      measuresPerSystem: 1,
    };
    expect(validateSavedScoreData(valid)).toBe(true);
  });
});

describe('運指番号（fingering）の MusicXML 対応', () => {
  it('単音の fingering を export すると <technical><fingering>3</fingering></technical> が出力される', () => {
    const data = createSavedScoreData(
      { title: 'Fingering Export', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'], fingering: '3' }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<technical><fingering>3</fingering></technical>');
  });

  it('単音の fingering が export → import でラウンドトリップする', () => {
    const data = createSavedScoreData(
      { title: 'Fingering Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4'], fingering: '1' },
            { dur: '4', isRest: false, keys: ['d/4'], fingering: '5-1' },
          ],
        }],
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    const imported = parseMusicXml(xml);
    const events = imported.parts[0].measures[0].events;
    expect(events[0].fingering).toBe('1');
    expect(events[1].fingering).toBe('5-1');
  });

  it('和音の fingering（カンマ区切り）は音ごとに複数の <fingering> 要素として export され、import でラウンドトリップする', () => {
    const data = createSavedScoreData(
      { title: 'Fingering Chord Roundtrip', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{
        partId: 'melody',
        clef: 'treble',
        measures: [{
          events: [
            { dur: '4', isRest: false, keys: ['c/4', 'e/4', 'g/4'], fingering: '1,3,5' },
          ],
        }],
      }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    // 和音の3音それぞれに <technical><fingering> が出力される
    const matches = xml.match(/<fingering>\d<\/fingering>/g);
    expect(matches?.length).toBe(3);

    const imported = parseMusicXml(xml);
    const ev = imported.parts[0].measures[0].events[0];
    expect(ev.fingering).toBe('1,3,5');
    expect(ev.keys).toEqual(['c/4', 'e/4', 'g/4']);
  });

  it('fingering がない音符には <technical> は出力されない', () => {
    const data = createSavedScoreData(
      { title: 'No Fingering', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: [{ dur: '4', isRest: false, keys: ['c/4'] }] }] }],
      1,
      1
    );
    const xml = scoreToMusicXml(data);
    expect(xml).not.toContain('<technical>');
  });
});
