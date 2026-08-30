// src/utils/exportFileName.test.ts
// 書き出しファイル名の組み立て（Issue #507）の受入テスト。
// 受入条件2「拡張子はアプリが付与し、ユーザー入力の拡張子重複を防ぐ」がここの担当。

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_EXPORT_FILE_BASE,
  buildExportFileName,
  sanitizeFileNameBase,
  stripDuplicateExtension,
} from './exportFileName';

describe('sanitizeFileNameBase', () => {
  it('ファイル名に使えない記号を取り除く', () => {
    expect(sanitizeFileNameBase('a/b:c*?"<>|d')).toBe('abcd');
  });

  it('空白や記号だけの入力は既定名（楽譜）になる', () => {
    expect(sanitizeFileNameBase('   ')).toBe(DEFAULT_EXPORT_FILE_BASE);
    expect(sanitizeFileNameBase('///')).toBe(DEFAULT_EXPORT_FILE_BASE);
    expect(sanitizeFileNameBase('')).toBe(DEFAULT_EXPORT_FILE_BASE);
  });

  it('名前の途中の空白・ハイフンは残す（読みやすさのため消さない）', () => {
    expect(sanitizeFileNameBase('第1番 ト短調 - 改訂版')).toBe('第1番 ト短調 - 改訂版');
  });

  it('改行などの制御文字を取り除く（他ソフトからのコピペ対策）', () => {
    expect(sanitizeFileNameBase('曲名\n第2稿')).toBe('曲名第2稿');
  });

  it('末尾のドットを取り除く（Windows が黙って落とすため）', () => {
    expect(sanitizeFileNameBase('曲名...')).toBe('曲名');
  });

  it('長すぎる名前は 80 文字で切る', () => {
    expect(sanitizeFileNameBase('あ'.repeat(200))).toBe('あ'.repeat(80));
  });
});

describe('stripDuplicateExtension', () => {
  it('同じ拡張子が付いていれば取り除く', () => {
    expect(stripDuplicateExtension('曲.musicxml', 'musicxml')).toBe('曲');
    expect(stripDuplicateExtension('曲.mid', 'midi')).toBe('曲');
    expect(stripDuplicateExtension('曲.score.json', 'score')).toBe('曲');
  });

  it('大文字小文字は区別しない', () => {
    expect(stripDuplicateExtension('曲.MusicXML', 'musicxml')).toBe('曲');
  });

  it('別名の拡張子（.xml / .midi / .json）も重複として扱う', () => {
    expect(stripDuplicateExtension('曲.xml', 'musicxml')).toBe('曲');
    expect(stripDuplicateExtension('曲.midi', 'midi')).toBe('曲');
    expect(stripDuplicateExtension('曲.json', 'score')).toBe('曲');
  });

  it('重ねて付いていても取り除けなくなるまで繰り返す', () => {
    expect(stripDuplicateExtension('曲.mid.mid', 'midi')).toBe('曲');
  });

  it('拡張子だけの入力は取り除かない（名前が消えてしまうため）', () => {
    expect(stripDuplicateExtension('.musicxml', 'musicxml')).toBe('.musicxml');
  });

  it('関係のない拡張子は残す（名前の一部かもしれないため）', () => {
    expect(stripDuplicateExtension('曲.pdf', 'musicxml')).toBe('曲.pdf');
  });
});

describe('buildExportFileName', () => {
  it('種類ごとの拡張子をアプリ側が付ける', () => {
    expect(buildExportFileName('わたしの曲', 'score')).toBe('わたしの曲.score.json');
    expect(buildExportFileName('わたしの曲', 'musicxml')).toBe('わたしの曲.musicxml');
    expect(buildExportFileName('わたしの曲', 'midi')).toBe('わたしの曲.mid');
  });

  it('ユーザーが拡張子まで入力しても二重にならない（受入条件2）', () => {
    expect(buildExportFileName('わたしの曲.score.json', 'score')).toBe('わたしの曲.score.json');
    expect(buildExportFileName('わたしの曲.musicxml', 'musicxml')).toBe('わたしの曲.musicxml');
    expect(buildExportFileName('わたしの曲.mid', 'midi')).toBe('わたしの曲.mid');
  });

  it('使えない記号を含んだ入力でも安全な名前になる', () => {
    expect(buildExportFileName('a/b:c*?"<>|d', 'score')).toBe('abcd.score.json');
  });

  it('タイトルが空なら既定名になる（3種類で同じ）', () => {
    expect(buildExportFileName('', 'score')).toBe('楽譜.score.json');
    expect(buildExportFileName('', 'musicxml')).toBe('楽譜.musicxml');
    expect(buildExportFileName('', 'midi')).toBe('楽譜.mid');
  });

  it('先頭のドットは落とす（隠しファイルにしない）', () => {
    expect(buildExportFileName('.musicxml', 'musicxml')).toBe('musicxml.musicxml');
  });

  it('Windows の予約デバイス名は接頭辞で回避する（round1 P2）', () => {
    expect(sanitizeFileNameBase('CON')).toBe('_CON');
    expect(sanitizeFileNameBase('con')).toBe('_con');
    expect(sanitizeFileNameBase('Com1')).toBe('_Com1');
    expect(sanitizeFileNameBase('LPT9')).toBe('_LPT9');
    // 「CON.json」のようにドット以降が続く形も予約扱い
    expect(sanitizeFileNameBase('CON.backup')).toBe('_CON.backup');
    // 予約名を含むだけ（CONcerto 等）は通常どおり
    expect(sanitizeFileNameBase('CONcerto')).toBe('CONcerto');
  });

  it('長さ切りはコードポイント単位で、絵文字のサロゲートペアを分断しない（round1 P3）', () => {
    const base = 'a'.repeat(79) + '😀😀';
    const result = sanitizeFileNameBase(base);
    // 80コードポイント = 'a'×79 + 😀 1つ。分断された不正なサロゲート片が残らない
    expect([...result].length).toBe(80);
    expect(result.endsWith('😀')).toBe(true);
    expect(result).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
