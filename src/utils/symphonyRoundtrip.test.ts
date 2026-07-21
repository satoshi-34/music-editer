// src/utils/symphonyRoundtrip.test.ts
// 夜間QA フェーズB: フルオーケストラ（17パート）のテストスコアを使って
// MusicXML の書出→読込の往復と、MIDI 書出がクラッシュしないことを検証する。
// ブラウザのダウンロード操作を介さず、変換関数を直接呼び出すことで確実に検証する。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SavedScoreData } from '../types/storage';
import { scoreToMusicXml } from './musicXmlExport';
import { parseMusicXml } from './musicXmlImport';
import { scoreToMidi } from './midiExport';

function loadSymphonyData(): SavedScoreData {
  const filePath = resolve(__dirname, '../../test-data/symphony-test-score.json');
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as SavedScoreData;
}

describe('フルオーケストラ（17パート）MusicXML 往復テスト', () => {
  it('scoreToMusicXml が例外なく実行できる', () => {
    const data = loadSymphonyData();
    expect(() => scoreToMusicXml(data)).not.toThrow();
  });

  it('export → import でパート数が保たれる', () => {
    const data = loadSymphonyData();
    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);
    expect(parsed.parts.length).toBe(data.parts.length);
  });

  it('export → import で各パートの小節数が保たれる', () => {
    const data = loadSymphonyData();
    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);

    data.parts.forEach((origPart, i) => {
      const parsedPart = parsed.parts[i];
      expect(parsedPart.measures.length).toBe(origPart.measures.length);
    });
  });

  it('export → import で各小節の音符イベント数が（休符含め）概ね保たれる', () => {
    const data = loadSymphonyData();
    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);

    const mismatches: string[] = [];
    data.parts.forEach((origPart, pi) => {
      const parsedPart = parsed.parts[pi];
      origPart.measures.forEach((origMeasure, mi) => {
        const parsedMeasure = parsedPart.measures[mi];
        const origCount = origMeasure.events.length;
        const parsedCount = parsedMeasure ? parsedMeasure.events.length : -1;
        if (origCount !== parsedCount) {
          mismatches.push(
            `part=${origPart.partId} measure=${mi} orig=${origCount} parsed=${parsedCount}`
          );
        }
      });
    });

    // 不一致があればテスト失敗時のメッセージで詳細を確認できるようにしておく
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });

  it('export → import で実音（休符でないイベント）のキー（音高）が保たれる', () => {
    const data = loadSymphonyData();
    const xml = scoreToMusicXml(data);
    const parsed = parseMusicXml(xml);

    const mismatches: string[] = [];
    data.parts.forEach((origPart, pi) => {
      const parsedPart = parsed.parts[pi];
      origPart.measures.forEach((origMeasure, mi) => {
        const parsedMeasure = parsedPart.measures[mi];
        if (!parsedMeasure) return;
        origMeasure.events.forEach((origEv, ei) => {
          const parsedEv = parsedMeasure.events[ei];
          if (!parsedEv) {
            mismatches.push(`part=${origPart.partId} m=${mi} e=${ei} missing in parsed`);
            return;
          }
          if (origEv.isRest !== parsedEv.isRest) {
            mismatches.push(
              `part=${origPart.partId} m=${mi} e=${ei} isRest mismatch orig=${origEv.isRest} parsed=${parsedEv.isRest}`
            );
            return;
          }
          if (!origEv.isRest) {
            const origKeys = [...origEv.keys].sort().join(',');
            const parsedKeys = [...parsedEv.keys].sort().join(',');
            if (origKeys !== parsedKeys) {
              mismatches.push(
                `part=${origPart.partId} m=${mi} e=${ei} keys orig=${origKeys} parsed=${parsedKeys}`
              );
            }
          }
        });
      });
    });

    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});

describe('フルオーケストラ（17パート）MIDI 書出テスト', () => {
  it('scoreToMidi が例外なく実行でき、17パート分のトラックを含む MIDI バイナリを生成する', () => {
    const data = loadSymphonyData();
    let bytes: Uint8Array | undefined;
    expect(() => {
      bytes = scoreToMidi(data);
    }).not.toThrow();

    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(0);

    // SMF ヘッダ 'MThd' で始まることを確認
    const header = String.fromCharCode(bytes![0], bytes![1], bytes![2], bytes![3]);
    expect(header).toBe('MThd');

    // フォーマット1のトラック数（ヘッダの7,8バイト目がntrks、ビッグエンディアン）が
    // 「パート数 + テンポ等を格納する先頭のコンダクタートラック1本」と一致することを確認
    const ntrks = (bytes![10] << 8) | bytes![11];
    expect(ntrks).toBe(data.parts.length + 1);
  });
});
