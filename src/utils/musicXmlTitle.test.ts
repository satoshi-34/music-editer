// MusicXML 読込のタイトル解決の単体テスト（Issue #502）。
// タイトルの置き場所は <work><work-title>（曲集全体）と <movement-title>（単一楽章）の
// 2通りあり、Finale は単曲書き出しで movement-title 側だけを使う。
// work-title しか見ないと Finale 持ち込み（#419 系）でタイトルが空になるため、
// フォールバックの優先順位をここで固定する。
import { describe, it, expect } from 'vitest';

import { parseMusicXml } from './musicXmlImport';

/** 最小の score-partwise を組み立てる（head にタイトル系タグを差し込む） */
function xmlWith(headTags: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  ${headTags}
  <part-list><score-part id="P1"><part-name>piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice></note></measure></part>
</score-partwise>`;
}

describe('parseMusicXml のタイトル解決（#502）', () => {
  it('movement-title のみのファイル（Finale の単曲書き出し）からタイトルを読む', () => {
    const data = parseMusicXml(xmlWith('<movement-title>ソナチネ 第1楽章</movement-title>'));
    expect(data.metadata.title).toBe('ソナチネ 第1楽章');
  });

  it('work-title のみの従来ファイルの挙動は変わらない', () => {
    const data = parseMusicXml(xmlWith('<work><work-title>組曲のタイトル</work-title></work>'));
    expect(data.metadata.title).toBe('組曲のタイトル');
  });

  it('両方あるときは work-title を優先する（既存挙動の維持）', () => {
    const data = parseMusicXml(xmlWith(
      '<work><work-title>組曲のタイトル</work-title></work><movement-title>第1楽章</movement-title>',
    ));
    expect(data.metadata.title).toBe('組曲のタイトル');
  });

  it('どちらも無ければ空タイトル', () => {
    const data = parseMusicXml(xmlWith(''));
    expect(data.metadata.title).toBe('');
  });
});
