// PDF楽譜 → .mxl 変換API の HTTP 層（Issue #487）。
//
// 依存パッケージをゼロにするため、Node 標準の http だけで書いている
// （multipart の解析は convert.js の最小実装。用途が「PDF を1つ受け取る」だけなので足りる）。
import { createServer } from 'node:http';

import {
  ConvertError,
  MAX_PDF_BYTES,
  assertAcceptablePdf,
  extractUploadedFile,
  parseBoundary,
} from './convert.js';
import { convertPdfToMxl } from './audiveris.js';

const PORT = Number(process.env.PORT ?? 8080);
// 開発時はブラウザ（http://localhost:5173）から直接呼ぶため CORS を許可する。
// 公開先では変換APIを呼べるオリジンを絞れるよう環境変数で指定できるようにしている
const ALLOWED_ORIGIN = process.env.OMR_ALLOWED_ORIGIN ?? '*';

/** リクエストボディを上限つきで読む。上限を超えたらその場で打ち切る（メモリ枯渇の防止） */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        // 受信を止めないと上限を超えたデータを読み続けてしまう
        req.destroy();
        reject(new ConvertError('tooLarge', `PDF が大きすぎます（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'access-control-allow-origin': ALLOWED_ORIGIN,
  });
  res.end(body);
}

/** 失敗は必ず理由コード付きで返す（#318: 黙って失敗しない） */
function sendFailure(res, err) {
  if (err instanceof ConvertError) {
    sendJson(res, err.statusCode, { error: { reason: err.reason, message: err.message } });
    return;
  }
  sendJson(res, 500, {
    error: { reason: 'conversionFailed', message: `変換中に予期しないエラーが発生しました: ${err?.message ?? err}` },
  });
}

const server = createServer(async (req, res) => {
  // multipart のボディ本体に加えて境界やヘッダ分の余裕を持たせる
  const bodyLimit = MAX_PDF_BYTES + 1024 * 1024;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': ALLOWED_ORIGIN,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  // デプロイ先（Cloud Run 等）のヘルスチェック用
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/convert') {
    sendJson(res, 404, { error: { reason: 'noFile', message: 'POST /convert を使ってください' } });
    return;
  }

  try {
    const boundary = parseBoundary(req.headers['content-type']);
    if (!boundary) {
      throw new ConvertError('noFile', 'multipart/form-data で PDF を送ってください');
    }
    const body = await readBody(req, bodyLimit);
    const { filename, bytes } = extractUploadedFile(body, boundary);
    assertAcceptablePdf(bytes);
    const { mxl, name } = await convertPdfToMxl(bytes, filename);
    res.writeHead(200, {
      'content-type': 'application/vnd.recordare.musicxml',
      'content-length': String(mxl.length),
      'content-disposition': `attachment; filename="${name}"`,
      'access-control-allow-origin': ALLOWED_ORIGIN,
    });
    res.end(mxl);
  } catch (err) {
    sendFailure(res, err);
  }
});

server.listen(PORT, () => {
  console.log(`[omr] 変換APIを起動しました: http://0.0.0.0:${PORT}/convert`);
});
