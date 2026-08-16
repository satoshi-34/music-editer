// src/utils/fileStorage.test.ts
// ファイル書き出し（exportScoreToFile）の分岐テスト。
// Issue #229: 保存先を選べたのに書き込みに失敗する環境（埋め込みブラウザ・一部の WebView）で、
// 0 バイトの抜け殻ファイルが残ったまま無言でダウンロードへ切り替わっていた問題の再発防止。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportScoreToFile, importScoreFromFile } from './fileStorage';
import type { SavedScoreData } from '../types/storage';

// 検証に必要な最小限の譜面データ（中身は JSON 化できれば何でもよい）
const SCORE: SavedScoreData = {
  version: '1.0.0',
  timestamp: 0,
  metadata: { title: 'テスト譜面', subtitle: '', lyricist: '', composer: '', arranger: '' },
  scoreType: 'single',
  parts: [],
  systems: 1,
  measuresPerSystem: 4,
};

/** 書き込みが成功する（正常な）ファイルハンドルを作る */
function createWorkingHandle() {
  const written: string[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const handle = {
    createWritable: vi.fn().mockResolvedValue({
      write: vi.fn(async (text: string) => { written.push(text); }),
      close,
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { handle, written, close };
}

/**
 * createWritable が失敗するファイルハンドルを作る（本Issueの再現）。
 * ファイル自体（空）は作られているので remove() の呼び出し有無が確認できる。
 */
function createFailingHandle(options: { removable?: boolean; removeThrows?: boolean } = {}) {
  const { removable = true, removeThrows = false } = options;
  const err = new Error('The request is not allowed by the user agent');
  err.name = 'NotAllowedError';
  const remove = removeThrows
    ? vi.fn().mockRejectedValue(new Error('remove denied'))
    : vi.fn().mockResolvedValue(undefined);
  const handle: Record<string, unknown> = {
    createWritable: vi.fn().mockRejectedValue(err),
  };
  // 未対応環境の再現では remove を生やさない（Chromium 系にしか無い新しめのAPIのため）
  if (removable) handle.remove = remove;
  return { handle, remove };
}

describe('exportScoreToFile', () => {
  let anchorClick: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // ダウンロードが起きたかどうかは <a>.click() の呼び出しで判定する
    anchorClick = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
    // jsdom には Blob URL の実装が無いため差し替える
    createObjectURL = vi.fn().mockReturnValue('blob:mock');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    // 警告ログでテスト出力が汚れないように黙らせる
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  it('書き込みに成功したら saved を返し、ダウンロードは起こさない', async () => {
    const { handle, written } = createWorkingHandle();
    const picker = vi.fn().mockResolvedValue(handle);
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;

    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    expect(result).toEqual({ status: 'saved', handle });
    expect(picker).toHaveBeenCalledTimes(1);
    expect(JSON.parse(written[0])).toEqual(SCORE);
    expect(anchorClick).not.toHaveBeenCalled();
    // 成功した保存先を消してしまわないこと
    expect(handle.remove).not.toHaveBeenCalled();
  });

  it('ユーザーがダイアログを閉じたら（AbortError）何もせず cancelled を返す', async () => {
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn().mockRejectedValue(abort);

    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    expect(result).toEqual({ status: 'cancelled' });
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('createWritable が NotAllowedError で失敗したら、空ファイルを削除してダウンロードへ切り替える', async () => {
    const { handle, remove } = createFailingHandle();
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    // 削除できたので「空ファイルが残っている」とは言わない
    expect(result).toEqual({ status: 'fallback-download', leftoverEmptyFile: false });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('remove() が無い環境では leftoverEmptyFile: true を返す（呼び出し側が削除を促せるように）', async () => {
    const { handle } = createFailingHandle({ removable: false });
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    expect(result).toEqual({ status: 'fallback-download', leftoverEmptyFile: true });
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('remove() 自体が失敗した場合も leftoverEmptyFile: true を返す', async () => {
    const { handle, remove } = createFailingHandle({ removeThrows: true });
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    expect(result).toEqual({ status: 'fallback-download', leftoverEmptyFile: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('既存ファイルへの上書きが失敗しても、そのファイルは削除しない', async () => {
    // 上書き用に渡されたハンドルの中身はユーザーの財産なので、
    // 書き込みに失敗しても消してはいけない（消してよいのは今回作った空ファイルだけ）
    const { handle, remove } = createFailingHandle();
    const picker = vi.fn();
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;

    const result = await exportScoreToFile(SCORE, 'テスト譜面', handle as unknown as FileSystemFileHandle);

    expect(result).toEqual({ status: 'fallback-download', leftoverEmptyFile: false });
    expect(remove).not.toHaveBeenCalled();
    // 上書き経路なので保存先ダイアログは出ない
    expect(picker).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('ファイル作成後の AbortError は、空ファイルを片付けてフォールバック扱いにする', async () => {
    // ダイアログを閉じた直後の AbortError（＝ファイル未作成）と違い、
    // ファイルが作られた後の中断は抜け殻を残すため cancelled にはしない
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    const remove = vi.fn().mockResolvedValue(undefined);
    const handle = { createWritable: vi.fn().mockRejectedValue(abort), remove };
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn().mockResolvedValue(handle);

    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    expect(result).toEqual({ status: 'fallback-download', leftoverEmptyFile: false });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('File System Access API 非対応ブラウザでは downloaded を返す（従来どおり無言）', async () => {
    // Safari/Firefox の通常経路。異常ではないので警告の対象にしない
    const result = await exportScoreToFile(SCORE, 'テスト譜面');

    expect(result).toEqual({ status: 'downloaded' });
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('ファイル名に使えない文字はダウンロード名から除去される', async () => {
    let downloadName = '';
    anchorClick.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    await exportScoreToFile(SCORE, 'a/b:c*?"<>|d');

    expect(downloadName).toBe('abcd.score.json');
  });
});

// Issue #305: 「ファイルを開く」経路にも、localStorage 読込と同じ
// 「空のまま残った声部を畳む」正規化が入っていること。
// 譜面ファイルは他人の環境や、この修正より前のアプリで作られたものが来るため、
// 片方の経路にだけ入れると同じ譜面が開き方で違う見た目になってしまう。
describe('importScoreFromFile: 空のまま残った声部の正規化（Issue #305）', () => {
  const note = (key: string) => ({ dur: '4', isRest: false, keys: [key] });

  function scoreFileWith(measures: unknown[]): File {
    const data = {
      ...SCORE,
      parts: [{ partId: 'right-hand', clef: 'treble', measures }],
    };
    return new File([JSON.stringify(data)], 'empty-voice.score.json', { type: 'application/json' });
  }

  it('空の voices[1] を含むファイルを開くと、単声部の小節へ畳まれる', async () => {
    const loaded = await importScoreFromFile(scoreFileWith([{
      events: [note('c/5')],
      voices: [
        { id: 'voice-1', events: [note('c/5')] },
        { id: 'voice-2', stemDirection: 'down', events: [] },
      ],
    }]));

    expect(loaded.parts[0].measures[0].voices).toBeUndefined();
    expect(loaded.parts[0].measures[0].events.map((ev) => ev.keys[0])).toEqual(['c/5']);
  });

  it('中身のある声部2はそのまま残る', async () => {
    const loaded = await importScoreFromFile(scoreFileWith([{
      events: [note('c/5')],
      voices: [
        { id: 'voice-1', events: [note('c/5')] },
        { id: 'voice-2', stemDirection: 'down', events: [note('c/3')] },
      ],
    }]));

    expect(loaded.parts[0].measures[0].voices).toHaveLength(2);
  });
});
