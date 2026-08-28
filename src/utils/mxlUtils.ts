// 圧縮MusicXML（.mxl）の展開（Issue #465）。
//
// .mxl は ZIP コンテナで、Finale 等の既定書き出し形式。中身は
//   META-INF/container.xml … <rootfile full-path="〜.xml"/> が本体の場所を指す
//   （本体の .xml / .musicxml）
// という構造（MusicXML 仕様の Compressed MusicXML）。
// container.xml が無い・壊れている .mxl も現実には流通しているため、
// その場合は「META-INF 以外の最初の .xml/.musicxml エントリ」へフォールバックする。
//
// ZIP 展開は fflate（依存ゼロ・MIT・軽量）を使う。JSZip は Promise ベースで
// 依存も大きいため見送った（選定理由は save-load-redesign 設計書参照）。
//
// zip bomb 対策: 展開は container.xml と選ばれた MusicXML 本体だけに限定し
// （unzipSync の filter で他エントリの伸長をスキップ）、圧縮ファイル・
// 展開後サイズ・エントリ数に上限を設ける。超過は 'tooLarge' で理由つき通知。
import { unzipSync, strFromU8 } from 'fflate';

/** 圧縮ファイル（.mxl 全体）の上限。実在の総譜 .mxl は数百KB程度 */
export const MXL_MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
/** 1エントリの展開後サイズ上限（MusicXML はテキスト。巨大総譜でも数十MBに収まる） */
export const MXL_MAX_ENTRY_BYTES = 128 * 1024 * 1024;
/** エントリ数上限（.mxl の中身は数個。数千件はコンテナとして異常） */
export const MXL_MAX_ENTRIES = 1024;

/** ZIP（= .mxl コンテナ）のマジックバイト 'PK\x03\x04' か */
export function isMxlContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b
    && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 展開失敗の理由（通知文言の出し分けに使う。#318: 黙って失敗しない） */
export type MxlExtractFailure = 'notZip' | 'brokenZip' | 'noXmlEntry' | 'tooLarge';

export class MxlExtractError extends Error {
  readonly reason: MxlExtractFailure;
  constructor(reason: MxlExtractFailure, message: string) {
    super(message);
    this.name = 'MxlExtractError';
    this.reason = reason;
  }
}

/** 対象エントリだけを伸長する（zip bomb 対策の中核）。上限超過は例外で止める */
function unzipSelected(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  let entryCount = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        if (entryCount > MXL_MAX_ENTRIES) {
          throw new MxlExtractError('tooLarge', 'ZIP のエントリ数が多すぎます');
        }
        if (!wanted(file.name)) return false;
        if (file.originalSize > MXL_MAX_ENTRY_BYTES) {
          throw new MxlExtractError('tooLarge', '展開後のサイズが大きすぎます');
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof MxlExtractError) throw err;
    throw new MxlExtractError('brokenZip', 'ZIP の展開に失敗しました');
  }
}

/** エントリ名の列挙だけを行う（伸長しない） */
function listEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  unzipSelected(bytes, (name) => {
    names.push(name);
    return false;
  });
  return names;
}

/**
 * .mxl のバイト列から MusicXML 本文（文字列）を取り出す。
 * 失敗時は MxlExtractError を投げる（呼び出し側が理由つきで通知する）。
 */
export function extractMusicXmlFromMxl(bytes: Uint8Array): string {
  if (!isMxlContainer(bytes)) {
    throw new MxlExtractError('notZip', 'ZIP 形式ではありません');
  }
  if (bytes.length > MXL_MAX_COMPRESSED_BYTES) {
    throw new MxlExtractError('tooLarge', 'ファイルが大きすぎます');
  }

  const names = listEntryNames(bytes);

  // 1. container.xml の rootfile が指すエントリを最優先で読む
  let targetName: string | undefined;
  if (names.includes('META-INF/container.xml')) {
    const containerXml = strFromU8(
      unzipSelected(bytes, (name) => name === 'META-INF/container.xml')['META-INF/container.xml'],
    );
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const fullPath = doc.querySelector('rootfile')?.getAttribute('full-path');
    if (fullPath && names.includes(fullPath)) {
      targetName = fullPath;
    }
    // rootfile が壊れている・指す先が無い場合はフォールバックへ落とす
  }

  // 2. META-INF 以外の最初の .xml / .musicxml エントリ
  if (!targetName) {
    targetName = names.find((name) =>
      !name.startsWith('META-INF/')
      && (name.toLowerCase().endsWith('.xml') || name.toLowerCase().endsWith('.musicxml')));
  }
  if (!targetName) {
    throw new MxlExtractError('noXmlEntry', '中に MusicXML ファイルが見つかりませんでした');
  }

  const entry = unzipSelected(bytes, (name) => name === targetName)[targetName];
  if (!entry) {
    throw new MxlExtractError('brokenZip', 'ZIP の展開に失敗しました');
  }
  return strFromU8(entry);
}
