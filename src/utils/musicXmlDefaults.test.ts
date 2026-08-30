// MusicXML の <defaults>（作品のレイアウト指定）読み取りのテスト（Issue #477）。
// Finale の実書き出しは <defaults> に「その作品をどう組むか」を持っており、従来の読込は
// これを全部捨てていた。ここでは「読めた値をアプリの単位へ正しく換算できること」と、
// 「壊れた値・極端な値は無視して既定へ倒れること（ファイル由来の値で画面を壊さない）」を固定する。
import { describe, it, expect } from 'vitest';
import {
  readMusicXmlDefaults,
  staffHeightMmForNotationSize,
  notationSizeMultiplierForStaffHeightMm,
  nearestPageSize,
} from './musicXmlDefaults';

/** Finale の実書き出し相当の scaling（五線高 6.9674mm ＝ 浄書標準の 7mm 相当）。 */
const FINALE_MM_PER_TENTH = 6.9674 / 40;

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

/** mm を tenths へ（ファイル側の単位。<scaling> の比で決まる） */
function tenths(mm: number): string {
  return (mm / FINALE_MM_PER_TENTH).toFixed(4);
}

function scoreWithDefaults(defaultsXml: string): Document {
  return parse(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  ${defaultsXml}
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1"><measure number="1"/></part>
</score-partwise>`);
}

const FINALE_DEFAULTS = `<defaults>
    <scaling><millimeters>6.9674</millimeters><tenths>40</tenths></scaling>
    <page-layout>
      <page-height>${tenths(297)}</page-height>
      <page-width>${tenths(210)}</page-width>
      <page-margins type="both">
        <left-margin>${tenths(12)}</left-margin>
        <right-margin>${tenths(12)}</right-margin>
        <top-margin>${tenths(16)}</top-margin>
        <bottom-margin>${tenths(16)}</bottom-margin>
      </page-margins>
    </page-layout>
  </defaults>`;

describe('五線の高さ（mm）と「音符の大きさ」倍率の換算', () => {
  it('既定の150%はおよそ 6.98mm ＝ 浄書標準の五線高（7mm）相当になる', () => {
    expect(staffHeightMmForNotationSize(1.5)).toBeCloseTo(6.985, 3);
  });

  it('Finale 既定の 6.9674mm は 150% として読める（5%刻みへ丸める）', () => {
    expect(notationSizeMultiplierForStaffHeightMm(6.9674)).toBe(1.5);
  });

  it('小さい五線（例 5.6mm）は 120% として読める', () => {
    expect(notationSizeMultiplierForStaffHeightMm(5.6)).toBe(1.2);
  });

  it('スライダーの範囲（80〜200%）を超える極端な指定はクランプされる', () => {
    expect(notationSizeMultiplierForStaffHeightMm(20)).toBe(2.0);
    expect(notationSizeMultiplierForStaffHeightMm(1)).toBe(0.8);
  });
});

describe('用紙の実寸から最も近い判型を選ぶ', () => {
  it('A4 ちょうどは A4（丸めていない）', () => {
    expect(nearestPageSize(210, 297)).toEqual({ id: 'a4', rounded: false });
  });

  it('US レター（215.9×279.4mm）は最も近い A4 へ丸める', () => {
    expect(nearestPageSize(215.9, 279.4)).toEqual({ id: 'a4', rounded: true });
  });

  it('JIS B4 ちょうどは B4（丸めていない）', () => {
    expect(nearestPageSize(257, 364)).toEqual({ id: 'b4', rounded: false });
  });
});

describe('readMusicXmlDefaults', () => {
  it('Finale 相当の <defaults> から縮尺・判型・余白をすべて読む', () => {
    const result = readMusicXmlDefaults(scoreWithDefaults(FINALE_DEFAULTS));
    expect(result).toBeDefined();
    expect(result?.staffHeightMm).toBeCloseTo(6.9674, 4);
    expect(result?.notationSizeMultiplier).toBe(1.5);
    expect(result?.pageSize).toBe('a4');
    expect(result?.pageSizeRounded).toBe(false);
    expect(result?.pageMargins).toEqual({ sideMm: 12, topMm: 16, bottomMm: 16 });
  });

  it('US レターの page-layout は A4 へ丸め、丸めたことを示す', () => {
    const result = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <scaling><millimeters>6.9674</millimeters><tenths>40</tenths></scaling>
      <page-layout>
        <page-height>${tenths(279.4)}</page-height>
        <page-width>${tenths(215.9)}</page-width>
      </page-layout>
    </defaults>`));
    expect(result?.pageSize).toBe('a4');
    expect(result?.pageSizeRounded).toBe(true);
  });

  it('<defaults> が無いファイルは undefined（従来どおりアプリの既定値で組む）', () => {
    const doc = parse(`<?xml version="1.0"?><score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
      <part id="P1"><measure number="1"/></part>
    </score-partwise>`);
    expect(readMusicXmlDefaults(doc)).toBeUndefined();
  });

  it('<scaling> が無ければ page-layout も換算できないので読み飛ばす（単位が tenths のため）', () => {
    const result = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <page-layout><page-height>1700</page-height><page-width>1200</page-width></page-layout>
    </defaults>`));
    expect(result).toBeUndefined();
  });

  it('壊れた scaling（0・数値でない）は無視する', () => {
    const zero = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <scaling><millimeters>0</millimeters><tenths>40</tenths></scaling>
    </defaults>`));
    expect(zero).toBeUndefined();
    const notNumber = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <scaling><millimeters>abc</millimeters><tenths>40</tenths></scaling>
    </defaults>`));
    expect(notNumber).toBeUndefined();
  });

  it('極端な五線高（40mm）は読まなかったことにする（ファイル由来の値で画面を壊さない）', () => {
    const result = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <scaling><millimeters>40</millimeters><tenths>40</tenths></scaling>
    </defaults>`));
    expect(result?.notationSizeMultiplier).toBeUndefined();
  });

  it('余白は type="both" を優先し、左右は平均を採る（アプリの左右余白はスライダー1本のため）', () => {
    const result = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <scaling><millimeters>6.9674</millimeters><tenths>40</tenths></scaling>
      <page-layout>
        <page-height>${tenths(297)}</page-height>
        <page-width>${tenths(210)}</page-width>
        <page-margins type="odd">
          <left-margin>${tenths(25)}</left-margin><right-margin>${tenths(25)}</right-margin>
          <top-margin>${tenths(25)}</top-margin><bottom-margin>${tenths(25)}</bottom-margin>
        </page-margins>
        <page-margins type="both">
          <left-margin>${tenths(10)}</left-margin><right-margin>${tenths(14)}</right-margin>
          <top-margin>${tenths(13)}</top-margin><bottom-margin>${tenths(11)}</bottom-margin>
        </page-margins>
      </page-layout>
    </defaults>`));
    expect(result?.pageMargins).toEqual({ sideMm: 12, topMm: 13, bottomMm: 11 });
  });

  it('範囲外の余白（3mm）はスライダーの最小値へクランプする', () => {
    const result = readMusicXmlDefaults(scoreWithDefaults(`<defaults>
      <scaling><millimeters>6.9674</millimeters><tenths>40</tenths></scaling>
      <page-layout>
        <page-height>${tenths(297)}</page-height>
        <page-width>${tenths(210)}</page-width>
        <page-margins type="both">
          <left-margin>${tenths(3)}</left-margin><right-margin>${tenths(3)}</right-margin>
          <top-margin>${tenths(3)}</top-margin><bottom-margin>${tenths(3)}</bottom-margin>
        </page-margins>
      </page-layout>
    </defaults>`));
    expect(result?.pageMargins).toEqual({ sideMm: 8, topMm: 8, bottomMm: 8 });
  });

  it('余白 0 tenths は「余白なし指定」として下限へクランプされ、余白全体が破棄されない（round1 P2）', () => {
    const xml = `<score-partwise><defaults>
      <scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>
      <page-layout>
        <page-height>1697</page-height><page-width>1200</page-width>
        <page-margins type="both">
          <left-margin>0</left-margin><right-margin>0</right-margin>
          <top-margin>0</top-margin><bottom-margin>0</bottom-margin>
        </page-margins>
      </page-layout>
    </defaults></score-partwise>`;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const result = readMusicXmlDefaults(doc);
    expect(result?.pageMargins).toBeDefined();
    // 0mm はアプリの下限（左右8mm・上下8mm）へクランプされる
    expect(result!.pageMargins!.sideMm).toBeGreaterThanOrEqual(8);
    expect(result!.pageMargins!.topMm).toBeGreaterThanOrEqual(8);
  });
});
