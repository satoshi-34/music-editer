// src/utils/exportFileName.ts
// 書き出しファイル名の組み立て（Issue #507）。
//
// これまでファイル名は「タイトル由来の固定」で、しかも
// .score.json（fileStorage）と MusicXML / MIDI（各 downloadXxx）で
// サニタイズの有無すら揃っていなかった（MusicXML / MIDI は無加工）。
// 同じ目的の処理が3か所に散ると、片方だけ直しても片方に届かない事故になるため、
// 「使えない文字を落とす」「拡張子を付ける」をこのファイル1か所へ集約する。
// 設計の正本: .claude/specs/export-file-name/design.md

/** 書き出しの種類ごとの、付与する拡張子と「重複とみなして取り除く末尾」 */
export const EXPORT_FILE_TYPES = {
  /** 作品ファイル（.score.json） */
  score: { extension: '.score.json', duplicateSuffixes: ['.score.json', '.json'] },
  musicxml: { extension: '.musicxml', duplicateSuffixes: ['.musicxml', '.xml'] },
  midi: { extension: '.mid', duplicateSuffixes: ['.mid', '.midi'] },
} as const;

export type ExportFileType = keyof typeof EXPORT_FILE_TYPES;

/** タイトルが空のときに使う既定名 */
export const DEFAULT_EXPORT_FILE_BASE = '楽譜';

// ファイル名に使えない文字。Windows で禁止されている記号に加えて、
// 制御文字（改行など。他のソフトからコピペしたタイトルに紛れ込むことがある）も落とす。
// 制御文字を正規表現に書くと no-control-regex が警告するが、ここは
// 「制御文字を取り除く」ことが目的なので意図どおり
// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

// 長すぎる名前は OS 側で弾かれる（多くのファイルシステムは 255 バイト上限）。
// 日本語は1文字3バイトになりうるので、拡張子ぶんの余裕も見て 80 文字で切る
const MAX_FILE_NAME_BASE_LENGTH = 80;

/**
 * ユーザーの入力・タイトルを、ファイル名として安全な「拡張子なしの名前」に整える。
 * 空になってしまう場合は fallback（既定は「楽譜」）を返す。
 */
export function sanitizeFileNameBase(
  input: string,
  fallback: string = DEFAULT_EXPORT_FILE_BASE,
): string {
  const cleaned = input
    .replace(INVALID_FILE_NAME_CHARS, '')
    .trim()
    // 末尾のドットは Windows が黙って落とすため、こちらで先に取り除いて
    // 「保存したファイル名が入力と違う」という分かりにくいズレを防ぐ
    .replace(/\.+$/, '')
    // 先頭のドットは macOS / Linux で隠しファイル扱いになり、
    // 保存したのに見つけられなくなるので落とす
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_FILE_NAME_BASE_LENGTH)
    .trim();
  return cleaned || fallback;
}

/**
 * 末尾に付いている拡張子を取り除く（大文字小文字は区別しない）。
 * ユーザーが「曲.musicxml」と入力しても「曲.musicxml.musicxml」にならないようにするため。
 * 「曲.mid.mid」のように重ねて入力された場合に備えて、取り除けなくなるまで繰り返す。
 */
export function stripDuplicateExtension(base: string, type: ExportFileType): string {
  const { duplicateSuffixes } = EXPORT_FILE_TYPES[type];
  let result = base;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of duplicateSuffixes) {
      // result.length > suffix.length なので、名前が拡張子だけになる入力
      // （「.musicxml」）では取り除かない（空文字になって既定名へ落ちるのを防ぐ）
      if (result.length > suffix.length && result.toLowerCase().endsWith(suffix)) {
        result = result.slice(0, -suffix.length);
        stripped = true;
        break;
      }
    }
  }
  return result;
}

/**
 * 書き出し用のファイル名（拡張子つき）を組み立てる。
 * 拡張子は必ずアプリ側が付けるので、ユーザーは名前だけを考えればよい。
 */
export function buildExportFileName(input: string, type: ExportFileType): string {
  // 先にサニタイズしてから拡張子を外す。順番を逆にすると
  // 「曲.musicxml"」のような入力で、引用符に邪魔されて拡張子判定が外れる
  const sanitized = sanitizeFileNameBase(input);
  const base = sanitizeFileNameBase(stripDuplicateExtension(sanitized, type));
  return `${base}${EXPORT_FILE_TYPES[type].extension}`;
}
