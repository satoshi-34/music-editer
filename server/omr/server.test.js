// HTTP 層の配線テスト（Issue #487 round1 P1/P2）。
// 実ポートで待ち受けて本物の HTTP でやり取りし、
// 「上限超過でも理由コード付きの 413 JSON がクライアントへ届く」
// 「CORS ヘッダーが付く」という約束が退行したら落ちるようにする。
// Audiveris は起動しない（convert を差し替える）。
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createOmrServer } from './server.js';

const servers = [];

/** テスト用サーバーを空きポートで起動して { port, close } を返す */
function listen(options) {
  const server = createOmrServer(options);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port }));
  });
}

/** 素の http.request でレスポンスを受け取る（fetch は途中送信の制御ができないため） */
function request({ port, method = 'POST', path = '/convert', headers = {}, body = null, chunked = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (chunked) {
      // Content-Length を付けずに書く = chunked 転送。途中で 413 が返るのを待つ
      req.write(chunked);
    } else if (body) {
      req.end(body);
      return;
    } else {
      req.end();
    }
  });
}

function multipartBody(boundary, fileBytes) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="x.pdf"\r\n\r\n`, 'latin1'),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
  ]);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('POST /convert の上限超過（round1 P1: 413 が実際に届くこと）', () => {
  it('Content-Length が上限超過なら受信前に 413 JSON を返す', async () => {
    const { port } = await listen({ convert: async () => { throw new Error('呼ばれてはいけない'); } });
    const res = await request({
      port,
      headers: { 'content-type': 'multipart/form-data; boundary=b', 'content-length': String(30 * 1024 * 1024) },
      chunked: Buffer.alloc(16),
    });
    expect(res.status).toBe(413);
    const payload = JSON.parse(res.body.toString('utf8'));
    expect(payload.error.reason).toBe('tooLarge');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('Content-Length なし（chunked）でも受信中に打ち切って 413 JSON を返す', async () => {
    const { port } = await listen({
      convert: async () => { throw new Error('呼ばれてはいけない'); },
      maxPdfBytes: 1024, // bodyLimit = 1024 + 1MB なので、それを超える塊を送る
    });
    const res = await request({
      port,
      headers: { 'content-type': 'multipart/form-data; boundary=b', 'transfer-encoding': 'chunked' },
      chunked: Buffer.alloc(2 * 1024 * 1024, 0x20),
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body.toString('utf8')).error.reason).toBe('tooLarge');
  });
});

describe('POST /convert の基本配線', () => {
  it('multipart でない POST は noFile の 400', async () => {
    const { port } = await listen();
    const res = await request({ port, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('%PDF-') });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body.toString('utf8')).error.reason).toBe('noFile');
  });

  it('正常系: 変換結果の .mxl がそのまま返り、CORS ヘッダーが付く', async () => {
    const { port } = await listen({
      convert: async (bytes, filename) => {
        expect(filename).toBe('x.pdf');
        expect(bytes.slice(0, 5).toString('latin1')).toBe('%PDF-');
        return { mxl: Buffer.from('MXLDATA'), name: 'x.mxl' };
      },
    });
    const body = multipartBody('bnd1', Buffer.from('%PDF-1.7\n/Type /Page\n%%EOF', 'latin1'));
    const res = await request({
      port,
      headers: { 'content-type': 'multipart/form-data; boundary=bnd1', 'content-length': String(body.length) },
      body,
    });
    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toBe('MXLDATA');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['content-disposition']).toContain('x.mxl');
  });

  it('OPTIONS は CORS プリフライトに 204 で答える', async () => {
    const { port } = await listen();
    const res = await request({ port, method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('GET /health は ok を返し、その他のパスは 404', async () => {
    const { port } = await listen();
    const health = await request({ port, method: 'GET', path: '/health' });
    expect(health.status).toBe(200);
    const other = await request({ port, method: 'GET', path: '/nope' });
    expect(other.status).toBe(404);
  });
});
