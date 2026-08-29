// PDF変換API クライアントの単体テスト（Issue #487）。
// fetch をモックして「送り方」と「失敗の伝え方」を固定する（#318: 黙って失敗しない）。
import { describe, it, expect, vi, afterEach } from 'vitest';

import { convertPdfToMxl, getOmrApiUrl, OmrConvertError } from './omrApi';

function pdfFile(name = 'moonlight.pdf') {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], name, { type: 'application/pdf' });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getOmrApiUrl', () => {
  it('未設定なら null（＝機能ごと出さない）', () => {
    vi.stubEnv('VITE_OMR_API_URL', '');
    expect(getOmrApiUrl()).toBeNull();
  });

  it('設定されていれば末尾の / を落として返す', () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080/');
    expect(getOmrApiUrl()).toBe('http://localhost:8080');
  });
});

describe('convertPdfToMxl', () => {
  it('/convert へ multipart で POST し、返ってきた .mxl のバイト列を返す', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    const mxlBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => mxlBytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await convertPdfToMxl(pdfFile());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8080/convert');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(Array.from(result)).toEqual(Array.from(mxlBytes));
  });

  it('URL 未設定なら通信せず notConfigured で失敗する', async () => {
    vi.stubEnv('VITE_OMR_API_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(convertPdfToMxl(pdfFile())).rejects.toMatchObject({ reason: 'notConfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('変換サーバーへ繋がらないときは network で失敗する', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(convertPdfToMxl(pdfFile())).rejects.toBeInstanceOf(OmrConvertError);
  });

  it('サーバーが返した理由コード（上限超過など）をそのまま持ち上げる', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ error: { reason: 'tooManyPages', message: 'ページ数が多すぎます（30ページ / 上限 20ページ）' } }),
    }));

    await expect(convertPdfToMxl(pdfFile())).rejects.toMatchObject({
      reason: 'tooManyPages',
      message: 'ページ数が多すぎます（30ページ / 上限 20ページ）',
    });
  });

  it('JSON でない失敗応答は conversionFailed に丸める', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    }));

    await expect(convertPdfToMxl(pdfFile())).rejects.toMatchObject({ reason: 'conversionFailed' });
  });

  it('知らない理由コード（サーバーが将来増やした語彙など）も conversionFailed に丸める', async () => {
    // JSON としては正常だが reason がアプリの知らない文字列のケース（round1 P3）。
    // 丸めが壊れると、通知の出し分けが undefined 分岐へ落ちて説明のない失敗になる
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { reason: 'unknownReason', message: '新しい失敗理由' } }),
    }));

    await expect(convertPdfToMxl(pdfFile())).rejects.toMatchObject({
      reason: 'conversionFailed',
      message: '新しい失敗理由',
    });
  });

  it('中身が空の応答は noOutput（読み取れる譜面が無かった）として扱う', async () => {
    vi.stubEnv('VITE_OMR_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    await expect(convertPdfToMxl(pdfFile())).rejects.toMatchObject({ reason: 'noOutput' });
  });
});
