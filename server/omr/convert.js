// PDF → .mxl 変換API の「純粋な部分」（Issue #487）。
//
// ここには HTTP もファイル入出力も書かない。理由は2つ:
//  - 上限チェックや multipart の解析はバグると「ユーザーの楽譜が変換できない」直撃なので、
//    プロセスを起動しなくても単体テストできる形にしておきたい
//  - Audiveris の実行（子プロセス）は環境依存が強く、テストでは差し替えたい
// HTTP と子プロセスの担当は server.js / audiveris.js 側にある。

/** 受け付ける PDF の最大バイト数（20MB）。スキャン譜でも1曲ならこの範囲に収まる */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** 受け付ける最大ページ数。長大なPDFは変換に何十分もかかるため入口で断る */
export const MAX_PDF_PAGES = 20;
/** Audiveris 1回の変換に許す時間（ミリ秒）。#461 の実測は3ページ26秒なので20ページで足りる想定 */
export const CONVERT_TIMEOUT_MS = 120_000;

/**
 * 失敗の理由コード（#318「黙って失敗しない」）。
 * アプリ側はこのコードを見て、日本語の理由と代替手順（Audiveris 手動変換）を出す。
 */
export const CONVERT_FAILURE_REASONS = /** @type {const} */ ([
  'noFile',        // multipart に PDF が入っていない
  'notPdf',        // 中身が PDF ではない（先頭が %PDF- でない）
  'tooLarge',      // サイズ上限超過
  'tooManyPages',  // ページ数上限超過
  'timeout',       // 変換が時間内に終わらなかった
  'conversionFailed', // Audiveris が異常終了した
  'noOutput',      // Audiveris は成功したが .mxl が出てこなかった（認識できる譜面が無い等）
]);

/** 変換API内で投げるエラー。reason でクライアントへの説明を出し分ける */
export class ConvertError extends Error {
  /**
   * @param {(typeof CONVERT_FAILURE_REASONS)[number]} reason
   * @param {string} message 人が読む説明（そのままレスポンスに載せる）
   */
  constructor(reason, message) {
    super(message);
    this.name = 'ConvertError';
    this.reason = reason;
    // 上限超過は 413、それ以外の入力不備は 400、変換側の失敗は 422 / 504 に割り当てる
    this.statusCode =
      reason === 'tooLarge' || reason === 'tooManyPages' ? 413
      : reason === 'timeout' ? 504
      : reason === 'noFile' || reason === 'notPdf' ? 400
      : 422;
  }
}

/** Content-Type ヘッダから multipart の境界文字列を取り出す（無ければ null） */
export function parseBoundary(contentType) {
  if (typeof contentType !== 'string') return null;
  if (!/^multipart\/form-data/i.test(contentType)) return null;
  // boundary は引用符付き（boundary="----x"）でも来るので両方に対応する
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const raw = match ? (match[1] ?? match[2]) : null;
  return raw ? raw.trim() : null;
}

/** 先頭の 5 バイトが '%PDF-' か（拡張子ではなく中身で判定する） */
export function isPdfBytes(bytes) {
  return bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
    && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/**
 * PDF のページ数をおおまかに数える（あくまで入口の足切り用）。
 * PDF は本文をオブジェクトストリームで圧縮できる形式なので、非圧縮の
 * `/Type /Page` を数えるこの方法では**数えられない PDF がある**。
 * 数えられなかった場合は null を返し、呼び出し側はページ上限を課さずに
 * 変換タイムアウト側で守る（誤って正当なPDFを弾かないことを優先する）。
 */
export function countPdfPages(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  // 「/Type /Page」の直後が s（= /Pages ツリーのノード）でないものだけを数える。
  // PDF は空白の入り方が自由なので /Type と /Page の間の空白は任意個を許す
  const matches = text.match(/\/Type\s*\/Page(?![\s]*s)/g);
  const count = matches ? matches.length : 0;
  return count > 0 ? count : null;
}

/**
 * multipart/form-data のボディから最初のファイル部分（PDF）を取り出す。
 * 依存を増やさないための最小実装で、扱うのは「PDFが1つ入っているだけ」の
 * リクエストに限る（このAPIの用途がそれしかないため）。
 *
 * @returns {{ filename: string, bytes: Buffer }}
 */
export function extractUploadedFile(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const crlf = Buffer.from('\r\n', 'latin1');

  // 「正式な境界行」だけを区切りとして採用する（round1 P2）。
  // PDF はバイナリなので、本文の中に `--境界` と同じバイト列が偶然（あるいは故意に）
  // 現れうる。RFC 2046 どおり、境界は本文先頭か CRLF の直後に置かれ、
  // 直後に CRLF（続きのパートあり）か `--`（終端）が来るものだけが本物。
  const findRealDelimiter = (from) => {
    let pos = body.indexOf(delimiter, from);
    while (pos !== -1) {
      const precededOk = pos === 0 || body.slice(pos - 2, pos).equals(crlf);
      const after = body.slice(pos + delimiter.length, pos + delimiter.length + 2);
      const followedOk = after.equals(crlf) || after.toString('latin1') === '--';
      if (precededOk && followedOk) return pos;
      pos = body.indexOf(delimiter, pos + 1);
    }
    return -1;
  };

  const parts = [];
  let start = findRealDelimiter(0);
  while (start !== -1) {
    // 区切り直後が '--' なら終端マーカー（--boundary--）なので打ち切る
    const afterDelimiter = start + delimiter.length;
    if (body.slice(afterDelimiter, afterDelimiter + 2).toString('latin1') === '--') break;
    const next = findRealDelimiter(afterDelimiter);
    if (next === -1) break;
    // 区切りの直後の CRLF と、次の区切りの直前の CRLF はパート本体に含めない
    parts.push(body.slice(afterDelimiter + 2, next - 2));
    start = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd).toString('latin1');
    if (!/name="?file"?/i.test(headers) && !/filename=/i.test(headers)) continue;
    const filenameMatch = /filename="([^"]*)"/i.exec(headers);
    return {
      filename: filenameMatch ? filenameMatch[1] : 'input.pdf',
      bytes: part.slice(headerEnd + 4),
    };
  }
  throw new ConvertError('noFile', 'PDF ファイルが送られていません（multipart の file フィールドが必要です）');
}

/**
 * 受け取ったバイト列が変換して良い PDF かを確かめる。
 * 問題があれば ConvertError を投げる（呼び出し側はそのまま理由つきで返す）。
 */
export function assertAcceptablePdf(bytes, { maxBytes = MAX_PDF_BYTES, maxPages = MAX_PDF_PAGES } = {}) {
  if (bytes.length > maxBytes) {
    throw new ConvertError(
      'tooLarge',
      `PDF が大きすぎます（${Math.round(bytes.length / 1024 / 1024)}MB / 上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`,
    );
  }
  if (!isPdfBytes(bytes)) {
    throw new ConvertError('notPdf', 'PDF として読めないファイルです（中身が PDF ではありません）');
  }
  const pages = countPdfPages(bytes);
  if (pages !== null && pages > maxPages) {
    throw new ConvertError('tooManyPages', `ページ数が多すぎます（${pages}ページ / 上限 ${maxPages}ページ）`);
  }
}

/** 保存用の安全なファイル名（パス区切りや親ディレクトリ指定を落とす） */
export function safeBaseName(filename) {
  const base = String(filename).replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  const withoutExt = cleaned.replace(/\.pdf$/i, '');
  return withoutExt.length > 0 ? withoutExt.slice(0, 64) : 'score';
}
