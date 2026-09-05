// MusicXML 読込のタイトル解決の単体テスト（Issue #502）。
// タイトルの置き場所は <work><work-title>（曲集全体）と <movement-title>（単一楽章）の
// 2通りあり、Finale は単曲書き出しで movement-title 側だけを使う。
// work-title しか見ないと Finale 持ち込み（#419 系）でタイトルが空になるため、
// フォールバックの優先順位をここで固定する。
import { describe, it, expect } from 'vitest';

import { parseMusicXml } from './musicXmlImport';
import { scoreToMusicXml } from './musicXmlExport';

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

// ── 複数行タイトルの往復（Issue #576 / #636） ─────────────────────────
// タイトル編集ダイアログで Enter を押すと改行が入る。MusicXML は work-title が
// 「1本の文字列」なので、行が分かれている情報は <credit> の credit-words にしか残らない。
describe('複数行タイトルの MusicXML 往復（#576 / #636）', () => {
  it('2行のタイトルが書き出し→読み込みで改行ごと保たれる', () => {
    const source = parseMusicXml(xmlWith('<work><work-title>もとの題</work-title></work>'));
    const twoLine = {
      ...source,
      metadata: { ...source.metadata, title: '月光 第1楽章\n（ペダル校訂つき）' },
    };

    const xml = scoreToMusicXml(twoLine);
    // 標準の <credit> にも1行ずつ出す（他アプリが紙面の見た目を復元できるように）
    expect(xml).toContain('<credit-words>月光 第1楽章</credit-words><credit-words>（ペダル校訂つき）</credit-words>');
    // work-title 側は数値文字参照で改行を保つ（生の改行は読み手の空白の扱いで潰れ得る）
    expect(xml).toContain('&#10;');

    expect(parseMusicXml(xml).metadata.title).toBe('月光 第1楽章\n（ペダル校訂つき）');
  });

  it('1行のタイトルでは credit を足さない（従来の出力を変えない）', () => {
    const source = parseMusicXml(xmlWith('<work><work-title>ふつうの題</work-title></work>'));
    const xml = scoreToMusicXml(source);
    expect(xml).not.toContain('<credit');
    expect(parseMusicXml(xml).metadata.title).toBe('ふつうの題');
  });
});
