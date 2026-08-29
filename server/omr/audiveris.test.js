// Audiveris 実行部（子プロセス）の単体テスト（Issue #487 round1 P2）。
// 実物の Audiveris / pdfinfo は起動せず、child_process.spawn を差し替えて
// 「タイムアウト時に必ず kill する」「一時ファイルを必ず消す」「ページ上限を確定判定する」
// という約束が退行したら落ちるようにする。ファイル入出力は本物の一時ディレクトリを使う
// （finally の rm が本当に消しているかを確かめたいので、fs はモックしない）。
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock, default: { spawn: spawnMock } }));

const { convertPdfToMxl, assertPageCountWithPdfinfo } = await import('./audiveris.js');

/** spawn が返す子プロセスの偽物（stdout/stderr と kill だけ再現する） */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    // SIGKILL 相当: 少し遅れて close が来る（実プロセスと同じ順序）
    setTimeout(() => child.emit('close', null), 0);
  });
  return child;
}

/** pdfinfo 呼び出しに「Pages: n」を返させる */
function respondPdfinfo(child, pages) {
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(`Producer: test\nPages: ${pages}\nEncrypted: no\n`));
    child.emit('close', 0);
  }, 0);
}

afterEach(() => {
  spawnMock.mockReset();
});

describe('assertPageCountWithPdfinfo', () => {
  it('上限内なら通し、上限超過なら tooManyPages で断る', async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      respondPdfinfo(child, 25);
      return child;
    });
    await expect(assertPageCountWithPdfinfo('/tmp/x.pdf', { maxPages: 20 }))
      .rejects.toMatchObject({ reason: 'tooManyPages' });

    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      respondPdfinfo(child, 3);
      return child;
    });
    await expect(assertPageCountWithPdfinfo('/tmp/x.pdf', { maxPages: 20 })).resolves.toBe(3);
  });

  it('ページ数を読み取れない出力は変換に進ませない（conversionFailed）', async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('Producer: test\n'));
        child.emit('close', 0);
      }, 0);
      return child;
    });
    await expect(assertPageCountWithPdfinfo('/tmp/x.pdf')).rejects.toMatchObject({ reason: 'conversionFailed' });
  });
});

describe('convertPdfToMxl（子プロセスと一時ファイルの約束）', () => {
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n', 'latin1');

  /** spawn をモックしつつ、audiveris 呼び出し時の出力ディレクトリを覗けるようにする */
  function mockEngines({ pages = 1, audiveris }) {
    const seen = { outputDir: null, audiverisChild: null };
    spawnMock.mockImplementation((bin, args) => {
      const child = fakeChild();
      if (args.includes('-batch')) {
        seen.outputDir = args[args.indexOf('-output') + 1];
        seen.audiverisChild = child;
        audiveris(child, seen);
      } else {
        respondPdfinfo(child, pages);
      }
      return child;
    });
    return seen;
  }

  it('成功時は .mxl を返し、一時ディレクトリを消す', async () => {
    const seen = mockEngines({
      audiveris: (child, s) => {
        setTimeout(async () => {
          await mkdir(s.outputDir, { recursive: true });
          await writeFile(path.join(s.outputDir, 'score.mxl'), Buffer.from('MXL'));
          child.emit('close', 0);
        }, 0);
      },
    });
    const { mxl, name } = await convertPdfToMxl(pdf, 'moonlight.pdf');
    expect(mxl.toString()).toBe('MXL');
    expect(name).toBe('moonlight.mxl');
    // 受入条件1: 変換後にユーザーの楽譜（一時ディレクトリ）が残っていないこと
    expect(existsSync(path.dirname(seen.outputDir))).toBe(false);
  });

  it('異常終了は conversionFailed で失敗し、一時ディレクトリを消す', async () => {
    const seen = mockEngines({
      audiveris: (child) => setTimeout(() => child.emit('close', 1), 0),
    });
    await expect(convertPdfToMxl(pdf, 'x.pdf')).rejects.toMatchObject({ reason: 'conversionFailed' });
    expect(existsSync(path.dirname(seen.outputDir))).toBe(false);
  });

  it('タイムアウトしたら子プロセスを kill して timeout で失敗し、一時ディレクトリを消す', async () => {
    const seen = mockEngines({
      audiveris: () => {
        // close を出さない = 実プロセスが刺さった状態。kill されるまで終わらない
      },
    });
    await expect(convertPdfToMxl(pdf, 'x.pdf', { timeoutMs: 30 })).rejects.toMatchObject({ reason: 'timeout' });
    expect(seen.audiverisChild.kill).toHaveBeenCalledWith('SIGKILL');
    expect(existsSync(path.dirname(seen.outputDir))).toBe(false);
  });

  it('pdfinfo が上限超過を報告したら Audiveris を起動しない', async () => {
    const seen = mockEngines({ pages: 25, audiveris: () => {} });
    await expect(convertPdfToMxl(pdf, 'x.pdf')).rejects.toMatchObject({ reason: 'tooManyPages' });
    expect(seen.audiverisChild).toBeNull();
  });
});
