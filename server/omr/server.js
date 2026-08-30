// PDF楽譜 → .mxl 変換API の HTTP 層（Issue #487）。
//
// 依存パッケージをゼロにするため、Node 標準の http だけで書いている
// （multipart の解析は convert.js の最小実装。用途が「PDF を1つ受け取る」だけなので足りる）。
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

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
// 共有トークン（#493）。設定されている場合のみ x-omr-token ヘッダの一致を要求する。
// 未設定＝検査なしはローカル開発（docker compose --profile omr）の従来挙動を保つため
// 空文字は未設定と同じ扱いにする（docker compose の `${OMR_API_TOKEN:-}` は未設定時に
// 空文字を渡してくるため。空文字を「合言葉」にすると誰でも通ってしまう）
const API_TOKEN = (process.env.OMR_API_TOKEN ?? '').trim() || null;

/** 一致検査。長さの違いも含めて比較時間から token を推測されないようにする（#493） */
function tokenMatches(expected, received) {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * リクエストボディを上限つきで読む。上限を超えたらそれ以上バッファせず reject する。
 * ここで req.destroy() はしない（round1 P1）: destroy はソケットごと壊すため、
 * 呼び出し側が 413 の JSON を返す前に接続が切れてしまう。残りの受信データは
 * リスナーを外して読み捨て、レスポンス送信後にソケットを閉じる（呼び出し側の仕事）。
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const onData = (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        // 以降のデータはバッファしない（メモリ枯渇の防止）。resume で読み捨てる
        req.off('data', onData);
        chunks.length = 0;
        req.resume();
        reject(new ConvertError('tooLarge', `PDF が大きすぎます（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, allowedOrigin) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'access-control-allow-origin': allowedOrigin,
  });
  res.end(body);
}

/** 失敗は必ず理由コード付きで返す（#318: 黙って失敗しない） */
function sendFailure(res, err, allowedOrigin) {
  if (err instanceof ConvertError) {
    sendJson(res, err.statusCode, { error: { reason: err.reason, message: err.message } }, allowedOrigin);
    return;
  }
  sendJson(res, 500, {
    error: { reason: 'conversionFailed', message: `変換中に予期しないエラーが発生しました: ${err?.message ?? err}` },
  }, allowedOrigin);
}

/**
 * 変換APIのサーバーを作る。listen はしない（テストが任意ポートで起動できるように、
 * 起動は末尾の「直接実行されたときだけ」ブロックが行う）。
 * convert は Audiveris 実行部の差し替え口（テストでは子プロセスを起動しない）。
 */
export function createOmrServer({
  convert = convertPdfToMxl,
  allowedOrigin = ALLOWED_ORIGIN,
  maxPdfBytes = MAX_PDF_BYTES,
  apiToken = API_TOKEN,
} = {}) {
  return createServer(async (req, res) => {
    // multipart のボディ本体に加えて境界やヘッダ分の余裕を持たせる
    const bodyLimit = maxPdfBytes + 1024 * 1024;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-omr-token',
      });
      res.end();
      return;
    }

    // デプロイ先（Cloud Run 等）のヘルスチェック用
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true }, allowedOrigin);
      return;
    }

    if (req.method !== 'POST' || req.url !== '/convert') {
      sendJson(res, 404, { error: { reason: 'noFile', message: 'POST /convert を使ってください' } }, allowedOrigin);
      return;
    }

    try {
      // 共有トークン検査（#493）。重い OMR 処理に入る前・受信を始める前に断る。
      // これは「URL を見つけただけの第三者」を弾くための札で、本気の解析には
      // 破られうる前提（脅威モデルは設計書参照）。課金の天井は max-instances 等が受け持つ
      if (apiToken !== null && !tokenMatches(apiToken, req.headers['x-omr-token'])) {
        throw new ConvertError('unauthorized', '変換サーバーの利用トークンが一致しません');
      }

      // Content-Length が申告されていれば、1バイトも受け取る前に断る（round1 P1）。
      // ブラウザの fetch(FormData) は必ず Content-Length を付けるので通常はここで止まる
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > bodyLimit) {
        throw new ConvertError('tooLarge', `PDF が大きすぎます（上限 ${Math.round(maxPdfBytes / 1024 / 1024)}MB）`);
      }

      const boundary = parseBoundary(req.headers['content-type']);
      if (!boundary) {
        throw new ConvertError('noFile', 'multipart/form-data で PDF を送ってください');
      }
      const body = await readBody(req, bodyLimit);
      const { filename, bytes } = extractUploadedFile(body, boundary);
      assertAcceptablePdf(bytes, { maxBytes: maxPdfBytes });
      const { mxl, name } = await convert(bytes, filename);
      res.writeHead(200, {
        'content-type': 'application/vnd.recordare.musicxml',
        'content-length': String(mxl.length),
        'content-disposition': `attachment; filename="${name}"`,
        'access-control-allow-origin': allowedOrigin,
      });
      res.end(mxl);
    } catch (err) {
      sendFailure(res, err, allowedOrigin);
      // アップロード途中で断った場合の後始末。即座に destroy すると、クライアントが
      // 413/401 の JSON を読み取る前に RST で接続ごと消えることがある（実測）ため、
      // まず残りを読み捨てて自然に閉じさせ、読み捨てが長引く場合（送り続ける攻撃）だけ
      // 猶予つきで強制切断する
      if (!req.readableEnded) {
        req.resume();
        const cutoff = setTimeout(() => req.destroy(), 5000);
        cutoff.unref();
        req.on('end', () => clearTimeout(cutoff));
        req.on('close', () => clearTimeout(cutoff));
      }
    }
  });
}

// 直接実行されたときだけ待ち受ける（テストからの import では起動しない）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createOmrServer().listen(PORT, () => {
    console.log(`[omr] 変換APIを起動しました: http://0.0.0.0:${PORT}/convert`);
  });
}
