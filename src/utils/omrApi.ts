// PDF楽譜の取り込み（Issue #487・#461 段1）。
//
// アプリは PDF を直接読まない。Audiveris を積んだ変換API（server/omr）へ PDF を送り、
// 返ってきた .mxl を**既存の MusicXML 読込経路へそのまま流す**（新しいパーサを増やさない）。
// 変換APIの場所は環境変数 VITE_OMR_API_URL で与える。未設定なら機能ごと出さない。

/** 変換に失敗した理由（変換API の error.reason と同じ語彙 + アプリ側で起きる network） */
export type OmrConvertFailure =
  | 'notConfigured'
  | 'network'
  | 'unauthorized'
  | 'noFile'
  | 'notPdf'
  | 'tooLarge'
  | 'tooManyPages'
  | 'timeout'
  | 'conversionFailed'
  | 'noOutput';

export class OmrConvertError extends Error {
  readonly reason: OmrConvertFailure;
  constructor(reason: OmrConvertFailure, message: string) {
    super(message);
    this.name = 'OmrConvertError';
    this.reason = reason;
  }
}

/**
 * 変換APIのURL（末尾の / は落として揃える）。未設定なら null。
 * 本番では未設定のままにしておき、「PDF (β)」ボタン自体を出さない運用にしている。
 */
export function getOmrApiUrl(): string | null {
  const raw = import.meta.env?.VITE_OMR_API_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/** 変換API が返す理由コードかどうか（知らない文字列は conversionFailed 扱いにする） */
function normalizeReason(reason: unknown): OmrConvertFailure {
  const known: OmrConvertFailure[] = [
    'unauthorized', 'noFile', 'notPdf', 'tooLarge', 'tooManyPages', 'timeout', 'conversionFailed', 'noOutput',
  ];
  return known.includes(reason as OmrConvertFailure) ? (reason as OmrConvertFailure) : 'conversionFailed';
}

/**
 * PDF を変換APIへ送り、.mxl のバイト列を受け取る。
 * 失敗時は必ず OmrConvertError（理由つき）を投げる。#318 の方針どおり、
 * 呼び出し側が「なぜ駄目だったか」と代替手順を出せるようにするため。
 */
export async function convertPdfToMxl(file: File): Promise<Uint8Array> {
  const apiUrl = getOmrApiUrl();
  if (!apiUrl) {
    throw new OmrConvertError('notConfigured', '変換APIのURL（VITE_OMR_API_URL）が設定されていません');
  }

  const form = new FormData();
  form.append('file', file, file.name);

  // 共有トークン（#493）。試用公開ではプレビュー環境の環境変数にだけ設定し、
  // 本番バンドルにはトークンも設定も一切載せない運用にしている
  const token = import.meta.env?.VITE_OMR_API_TOKEN;
  const headers: Record<string, string> =
    typeof token === 'string' && token.trim().length > 0 ? { 'x-omr-token': token.trim() } : {};

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/convert`, { method: 'POST', body: form, headers });
  } catch (err) {
    // 変換APIが起動していない・URLが違う等。ここで握りつぶすと「押しても何も起きない」になる
    throw new OmrConvertError('network', `変換サーバーに接続できませんでした: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    // 失敗レスポンスは { error: { reason, message } } の形。JSON で無い場合も想定して守る
    let reason: OmrConvertFailure = 'conversionFailed';
    let message = `変換に失敗しました（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      reason = normalizeReason(body?.error?.reason);
      if (typeof body?.error?.message === 'string' && body.error.message.length > 0) {
        message = body.error.message;
      }
    } catch {
      // JSON として読めないレスポンスはそのまま既定の文言で扱う
    }
    throw new OmrConvertError(reason, message);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    throw new OmrConvertError('noOutput', '変換結果が空でした');
  }
  return bytes;
}
