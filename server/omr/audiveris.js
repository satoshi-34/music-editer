// Audiveris（OMR エンジン）をコンテナ内で実行して .mxl を得る部分（Issue #487）。
//
// AGPL 境界: Audiveris は**無改造のバイナリを子プロセスとして起動するだけ**で、
// コードを取り込んだり改変したりしない。プロセス分離のため本体アプリのライセンスに
// 影響しない（設計書 .claude/specs/omr-import/design.md 参照）。
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConvertError, CONVERT_TIMEOUT_MS, safeBaseName } from './convert.js';

/** コンテナ内の Audiveris 起動コマンド（Dockerfile で /usr/local/bin/audiveris へ symlink する） */
const AUDIVERIS_BIN = process.env.AUDIVERIS_BIN ?? '/usr/local/bin/audiveris';

/** 指定ディレクトリ以下から最初に見つかった .mxl のパスを返す（無ければ null） */
async function findMxl(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findMxl(full);
      if (found) return found;
    } else if (entry.name.toLowerCase().endsWith('.mxl')) {
      return full;
    }
  }
  return null;
}

/**
 * Audiveris をバッチ実行する。タイムアウトしたら子プロセスを止めて 'timeout' で失敗させる。
 * （放置すると重い OMR が積み上がってコンテナが刺さるため、必ず kill する）
 */
function runAudiveris(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(AUDIVERIS_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk) => {
      // ログは末尾だけ残す（Audiveris は大量に出力するのでメモリを食わせない）
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ConvertError('conversionFailed', `変換エンジンを起動できませんでした: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new ConvertError('timeout', `変換が時間内（${Math.round(timeoutMs / 1000)}秒）に終わりませんでした`));
        return;
      }
      if (code !== 0) {
        reject(new ConvertError('conversionFailed', `変換エンジンが異常終了しました（終了コード ${code}）`));
        return;
      }
      resolve({ stderr });
    });
  });
}

/**
 * PDF のバイト列を .mxl のバイト列へ変換する。
 * 一時ファイルは成功・失敗にかかわらず finally で必ず消す
 * （ユーザーの楽譜をサーバーに残さないための約束。受入条件1）。
 *
 * @param {Buffer} pdfBytes
 * @param {string} filename 元のファイル名（出力名の見た目を揃えるためだけに使う）
 * @returns {Promise<{ mxl: Buffer, name: string }>}
 */
export async function convertPdfToMxl(pdfBytes, filename, { timeoutMs = CONVERT_TIMEOUT_MS } = {}) {
  const base = safeBaseName(filename);
  const workDir = await mkdtemp(path.join(tmpdir(), 'omr-'));
  try {
    const inputPath = path.join(workDir, `${base}.pdf`);
    const outputDir = path.join(workDir, 'out');
    await writeFile(inputPath, pdfBytes);
    // -batch: GUI を出さない / -export: MusicXML(.mxl) を書き出す / -output: 出力先
    await runAudiveris(['-batch', '-export', '-output', outputDir, '--', inputPath], timeoutMs);
    const mxlPath = await findMxl(outputDir).catch(() => null);
    if (!mxlPath) {
      throw new ConvertError('noOutput', '変換は終わりましたが、楽譜として読み取れる内容がありませんでした');
    }
    return { mxl: await readFile(mxlPath), name: `${base}.mxl` };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
