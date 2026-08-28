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
import { unzipSync, strFromU8 } from 'fflate';

/** ZIP（= .mxl コンテナ）のマジックバイト 'PK\x03\x04' か */
export function isMxlContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b
    && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 展開失敗の理由（通知文言の出し分けに使う。#318: 黙って失敗しない） */
export type MxlExtractFailure = 'notZip' | 'brokenZip' | 'noXmlEntry';

export class MxlExtractError extends Error {
  readonly reason: MxlExtractFailure;
  constructor(reason: MxlExtractFailure, message: string) {
    super(message);
    this.name = 'MxlExtractError';
    this.reason = reason;
  }
}

/**
 * .mxl のバイト列から MusicXML 本文（文字列）を取り出す。
 * 失敗時は MxlExtractError を投げる（呼び出し側が理由つきで通知する）。
 */
export function extractMusicXmlFromMxl(bytes: Uint8Array): string {
  if (!isMxlContainer(bytes)) {
    throw new MxlExtractError('notZip', 'ZIP 形式ではありません');
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new MxlExtractError('brokenZip', 'ZIP の展開に失敗しました');
  }

  // 1. container.xml の rootfile が指すエントリを最優先で読む
  const containerEntry = entries['META-INF/container.xml'];
  if (containerEntry) {
    const containerXml = strFromU8(containerEntry);
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const fullPath = doc.querySelector('rootfile')?.getAttribute('full-path');
    if (fullPath && entries[fullPath]) {
      return strFromU8(entries[fullPath]);
    }
    // rootfile が壊れている・指す先が無い場合はフォールバックへ落とす
  }

  // 2. META-INF 以外の最初の .xml / .musicxml エントリ
  const fallbackName = Object.keys(entries).find((name) =>
    !name.startsWith('META-INF/')
    && (name.toLowerCase().endsWith('.xml') || name.toLowerCase().endsWith('.musicxml')));
  if (fallbackName) {
    return strFromU8(entries[fallbackName]);
  }

  throw new MxlExtractError('noXmlEntry', '中に MusicXML ファイルが見つかりませんでした');
}
