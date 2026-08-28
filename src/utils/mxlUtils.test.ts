// 圧縮MusicXML（.mxl）展開のユニットテスト（Issue #465）。
// フィクスチャはテスト内で fflate.zipSync により生成する（バイナリを直接コミットしない）。
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractMusicXmlFromMxl, isMxlContainer, MxlExtractError, MXL_MAX_COMPRESSED_BYTES } from './mxlUtils';

const SCORE_XML = '<?xml version="1.0"?><score-partwise version="3.1"><part-list/></score-partwise>';
const CONTAINER_XML = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;

describe('mxlUtils（圧縮MusicXMLの展開・#465）', () => {
  it('container.xml の rootfile が指すエントリを取り出す', () => {
    const mxl = zipSync({
      'META-INF/container.xml': strToU8(CONTAINER_XML),
      'score.xml': strToU8(SCORE_XML),
      'other.txt': strToU8('note'),
    });
    expect(isMxlContainer(mxl)).toBe(true);
    expect(extractMusicXmlFromMxl(mxl)).toBe(SCORE_XML);
  });

  it('container.xml が無い .mxl は META-INF 以外の最初の .xml へフォールバックする', () => {
    const mxl = zipSync({
      'lieder.musicxml': strToU8(SCORE_XML),
    });
    expect(extractMusicXmlFromMxl(mxl)).toBe(SCORE_XML);
  });

  it('rootfile の指す先が無い場合もフォールバックで救う', () => {
    const broken = CONTAINER_XML.replace('score.xml', 'missing.xml');
    const mxl = zipSync({
      'META-INF/container.xml': strToU8(broken),
      'actual.xml': strToU8(SCORE_XML),
    });
    expect(extractMusicXmlFromMxl(mxl)).toBe(SCORE_XML);
  });

  it('XML エントリが1つも無い ZIP は理由つきで失敗する', () => {
    const mxl = zipSync({ 'readme.txt': strToU8('no xml here') });
    try {
      extractMusicXmlFromMxl(mxl);
      expect.unreachable('例外が投げられるはず');
    } catch (err) {
      expect(err).toBeInstanceOf(MxlExtractError);
      expect((err as MxlExtractError).reason).toBe('noXmlEntry');
    }
  });

  it('PK で始まるが壊れている ZIP は brokenZip として失敗する', () => {
    const valid = zipSync({ 'score.xml': strToU8(SCORE_XML) });
    const broken = valid.slice(0, Math.floor(valid.length / 2)); // 後半を欠損させる
    expect(isMxlContainer(broken)).toBe(true);
    try {
      extractMusicXmlFromMxl(broken);
      expect.unreachable('例外が投げられるはず');
    } catch (err) {
      expect(err).toBeInstanceOf(MxlExtractError);
      expect((err as MxlExtractError).reason).toBe('brokenZip');
    }
  });

  it('圧縮ファイル自体が上限超過なら tooLarge として失敗する（zip bomb 対策）', () => {
    const mxl = zipSync({ 'score.xml': strToU8(SCORE_XML) });
    // 上限+1 バイトのバッファ先頭に実ZIPを置く（サイズ検査は伸長前に走るので安全）
    const oversized = new Uint8Array(MXL_MAX_COMPRESSED_BYTES + 1);
    oversized.set(mxl);
    try {
      extractMusicXmlFromMxl(oversized);
      expect.unreachable('例外が投げられるはず');
    } catch (err) {
      expect(err).toBeInstanceOf(MxlExtractError);
      expect((err as MxlExtractError).reason).toBe('tooLarge');
    }
  });

  it('ZIP ではないバイト列は notZip として扱う', () => {
    const notZip = strToU8('<score-partwise/>');
    expect(isMxlContainer(notZip)).toBe(false);
    try {
      extractMusicXmlFromMxl(notZip);
      expect.unreachable('例外が投げられるはず');
    } catch (err) {
      expect((err as MxlExtractError).reason).toBe('notZip');
    }
  });
});
