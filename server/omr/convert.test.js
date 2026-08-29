// 変換API（PDF → .mxl）の入口ロジックの単体テスト（Issue #487）。
// ここが緩むと「壊れたPDFで変換エンジンが長時間走る」「上限を素通りする」に直結するため、
// 正常系・上限超過・壊れたPDF の3系統を固定する。
import { describe, it, expect } from 'vitest';

import {
  ConvertError,
  assertAcceptablePdf,
  countPdfPages,
  extractUploadedFile,
  isPdfBytes,
  parseBoundary,
  safeBaseName,
} from './convert.js';

/** テスト用の最小 PDF バイト列（先頭マジック + 指定ページ数ぶんの /Type /Page） */
function fakePdf(pageCount = 1, padding = 0) {
  const pages = Array.from({ length: pageCount }, () => '/Type /Page').join('\n');
  return Buffer.concat([
    Buffer.from(`%PDF-1.7\n${pages}\n%%EOF\n`, 'latin1'),
    Buffer.alloc(padding, 0x20),
  ]);
}

/** multipart/form-data のボディを組み立てる（ブラウザの FormData 相当） */
function multipartBody(boundary, filename, fileBytes) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\n`, 'latin1'),
    Buffer.from(`content-disposition: form-data; name="file"; filename="${filename}"\r\n`, 'latin1'),
    Buffer.from('content-type: application/pdf\r\n\r\n', 'latin1'),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
}

describe('parseBoundary', () => {
  it('multipart の境界文字列を取り出す（引用符あり・なしの両方）', () => {
    expect(parseBoundary('multipart/form-data; boundary=----abc123')).toBe('----abc123');
    expect(parseBoundary('multipart/form-data; boundary="----abc123"')).toBe('----abc123');
  });

  it('multipart でない Content-Type は null', () => {
    expect(parseBoundary('application/pdf')).toBeNull();
    expect(parseBoundary(undefined)).toBeNull();
  });
});

describe('extractUploadedFile（正常系）', () => {
  it('multipart のボディから PDF の中身とファイル名を取り出す', () => {
    const pdf = fakePdf(2);
    const body = multipartBody('----boundary1', 'moonlight.pdf', pdf);
    const extracted = extractUploadedFile(body, '----boundary1');
    expect(extracted.filename).toBe('moonlight.pdf');
    // バイト単位で一致すること（1バイトでもずれると PDF として壊れる）
    expect(Buffer.compare(extracted.bytes, pdf)).toBe(0);
    expect(isPdfBytes(extracted.bytes)).toBe(true);
  });

  it('ファイルが入っていない multipart は noFile で失敗する', () => {
    const body = Buffer.concat([
      Buffer.from('------boundary1\r\n', 'latin1'),
      Buffer.from('content-disposition: form-data; name="note"\r\n\r\n', 'latin1'),
      Buffer.from('hello', 'latin1'),
      Buffer.from('\r\n------boundary1--\r\n', 'latin1'),
    ]);
    expect(() => extractUploadedFile(body, '----boundary1')).toThrowError(ConvertError);
    try {
      extractUploadedFile(body, '----boundary1');
    } catch (err) {
      expect(err.reason).toBe('noFile');
      expect(err.statusCode).toBe(400);
    }
  });
});

describe('assertAcceptablePdf（上限超過）', () => {
  it('サイズ上限を超えた PDF は tooLarge で断る', () => {
    const big = fakePdf(1, 2048);
    try {
      assertAcceptablePdf(big, { maxBytes: 1024 });
      throw new Error('ここへ来てはいけない');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect(err.reason).toBe('tooLarge');
      // 上限超過は 413（Payload Too Large）で返す
      expect(err.statusCode).toBe(413);
    }
  });

  it('ページ数上限を超えた PDF は tooManyPages で断る', () => {
    const many = fakePdf(25);
    expect(countPdfPages(many)).toBe(25);
    try {
      assertAcceptablePdf(many, { maxPages: 20 });
      throw new Error('ここへ来てはいけない');
    } catch (err) {
      expect(err.reason).toBe('tooManyPages');
    }
  });

  it('上限内の PDF は素通しする', () => {
    expect(() => assertAcceptablePdf(fakePdf(3), { maxBytes: 1024 * 1024, maxPages: 20 })).not.toThrow();
  });

  it('ページ数を数えられない PDF（本文が圧縮されている等）はページ上限で弾かない', () => {
    // /Type /Page が現れない = 数えられないケース。ここで弾くと正当なPDFを拒否してしまうため、
    // タイムアウト側で守る設計になっていることを固定する
    const compressed = Buffer.from('%PDF-1.7\n<< /ObjStm >>\n%%EOF\n', 'latin1');
    expect(countPdfPages(compressed)).toBeNull();
    expect(() => assertAcceptablePdf(compressed, { maxPages: 1 })).not.toThrow();
  });
});

describe('assertAcceptablePdf（壊れたPDF）', () => {
  it('中身が PDF でないファイルは notPdf で断る', () => {
    const notPdf = Buffer.from('これはPDFではありません', 'utf8');
    try {
      assertAcceptablePdf(notPdf);
      throw new Error('ここへ来てはいけない');
    } catch (err) {
      expect(err.reason).toBe('notPdf');
      expect(err.statusCode).toBe(400);
    }
  });

  it('先頭が欠けた（切り詰められた）PDF も notPdf として扱う', () => {
    const truncated = Buffer.from('DF-1.7\n/Type /Page\n', 'latin1');
    expect(isPdfBytes(truncated)).toBe(false);
    expect(() => assertAcceptablePdf(truncated)).toThrowError(ConvertError);
  });
});

describe('safeBaseName', () => {
  it('パス区切りや危険な文字を落として拡張子を外す', () => {
    expect(safeBaseName('../../etc/passwd.pdf')).toBe('passwd');
    // 日本語のファイル名は「安全な文字だけ」に置き換わる（保存名にそのまま使うため）
    expect(safeBaseName('月光 第1楽章.pdf')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(safeBaseName('')).toBe('score');
  });
});
