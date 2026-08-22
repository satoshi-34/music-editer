// タイトルまわりのフォント選択（Issue #342）。
// 対象はタイトル・サブタイトル・作詞/作曲/編曲者の文字だけで、
// 音符・記号のフォント（Bravura 系）には一切触らない。
//
// 第1弾は提供フォントを限定する（Codex レビュー反映の仕様）:
// - システム標準スタック（明朝/ゴシック/欧文セリフ/欧文サンセリフ）
// - Google Fonts の定番2種（Noto Serif JP / Noto Sans JP。オフライン時はスタックの
//   後続システムフォントへフォールバックする）
// 「Word くらいの種類」を目指すと端末間の再現性・PDF埋め込み・ライセンスが絡むため、
// 一覧はこの定数1か所に集約し、追加が1行で済む形にしておく。

export type TitleFontOption = {
  /** 保存データ（SavedScoreData.titleFontId）に入る安定 id */
  id: string;
  /** 楽譜設定タブの選択肢に出す表示名 */
  label: string;
  /**
   * CSS の font-family スタック。空文字は「上書きしない」＝現行既定
   * （App.css の --score-text-font）のままという意味で、既存譜面の見た目を
   * 1px も変えないための特別値。
   */
  stack: string;
  /**
   * Google Fonts から読み込む場合の family クエリ（例: "Noto+Serif+JP:wght@400;600"）。
   * 指定があるフォントを選んだときだけ <link> を1回注入する。
   */
  googleFontFamily?: string;
};

export const DEFAULT_TITLE_FONT_ID = 'default';

export const TITLE_FONT_OPTIONS: TitleFontOption[] = [
  { id: DEFAULT_TITLE_FONT_ID, label: '既定（浄書セリフ体）', stack: '' },
  { id: 'mincho', label: '明朝', stack: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Times New Roman", serif' },
  { id: 'gothic', label: 'ゴシック', stack: '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", Arial, sans-serif' },
  { id: 'serif-latin', label: 'セリフ（欧文向け）', stack: 'Georgia, "Times New Roman", "Hiragino Mincho ProN", serif' },
  { id: 'sans-latin', label: 'サンセリフ（欧文向け）', stack: '"Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", sans-serif' },
  { id: 'noto-serif-jp', label: 'Noto Serif JP（Webフォント）', stack: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif', googleFontFamily: 'Noto+Serif+JP:wght@400;600' },
  { id: 'noto-sans-jp', label: 'Noto Sans JP（Webフォント）', stack: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', googleFontFamily: 'Noto+Sans+JP:wght@400;600' },
];

/**
 * id からフォント定義を引く。未知の id（将来の一覧変更・手書き JSON）や未指定は
 * 既定（上書きなし）へ倒す。読込側はこれを通すだけで後方互換になる。
 */
export function resolveTitleFontOption(id: string | undefined): TitleFontOption {
  return TITLE_FONT_OPTIONS.find((option) => option.id === id) ?? TITLE_FONT_OPTIONS[0];
}

/** 注入した <link> の読み込み完了を待てるように、id ごとの Promise を控えておく */
const fontLinkPromises = new Map<string, Promise<void>>();

/**
 * Google Fonts が必要なフォントなら <link> を1回だけ注入し、stylesheet の
 * 読み込み完了で resolve する Promise を返す。すでに <link> がある場合は
 * 控えてある Promise（無ければ解決済み）を返す。
 * システムスタックのフォントでは何もしない。オフラインで読み込めない場合も
 * スタックの後続フォントで表示できるため、onerror も resolve に倒す。
 */
function ensureTitleFontLink(option: TitleFontOption): Promise<void> {
  if (!option.googleFontFamily || typeof document === 'undefined') return Promise.resolve();
  const linkId = `title-font-${option.id}`;
  const existing = fontLinkPromises.get(option.id);
  if (existing && document.getElementById(linkId)) return existing;
  if (document.getElementById(linkId)) return Promise.resolve();
  const promise = new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${option.googleFontFamily}&display=swap`;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  fontLinkPromises.set(option.id, promise);
  return promise;
}

/** Google Fonts が必要なフォントなら <link> を1回だけ注入する（完了を待たない版） */
export function ensureTitleFontLoaded(option: TitleFontOption): void {
  void ensureTitleFontLink(option);
}

/**
 * 印刷（window.print）前に、選択中のWebフォントの読み込み完了を待つ。
 * 読み込み前に印刷すると、フォールバック書体のままPDFへ固定されてしまうため（Codex round1 P1）。
 *
 * 待ち方の要点（Codex round2 P1）:
 * - まず stylesheet（注入した <link>）の読み込みを待つ。解釈前だと font face が未登録で、
 *   document.fonts.load() が「該当なし」の即 resolve をしてしまう
 * - fonts.load には**実際に印刷される文字列**（タイトル等）を渡す。Google Fonts は
 *   unicode-range で分割配信されるため、文字列を渡さないと空白1文字ぶんの face しか
 *   読み込み対象にならず、日本語グリフの読み込み完了を保証できない
 * - 最後に document.fonts.ready も同じタイムアウト内で待つ
 *
 * システムスタックのフォントは即 resolve。ネットワーク断などで読み込めない場合に
 * 印刷が永久に止まらないよう、全体をタイムアウトで必ず先へ進める
 * （そのときはスタックの後続フォントで印刷される）。
 */
export async function waitForTitleFontReady(
  option: TitleFontOption,
  sampleText = '',
  timeoutMs = 2000,
): Promise<void> {
  if (!option.googleFontFamily || typeof document === 'undefined' || !document.fonts?.load) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  const work = (async () => {
    await ensureTitleFontLink(option);
    // スタック先頭の family 名（例: "Noto Serif JP"）で読み込みを待つ
    const primaryFamily = option.stack.split(',')[0].trim().replace(/^"|"$/g, '');
    const text = sampleText || undefined;
    // タイトルは太字（600）で描かれ得るため、標準と太字の両ウェイトを対象にする
    await document.fonts.load(`16px "${primaryFamily}"`, text);
    await document.fonts.load(`600 16px "${primaryFamily}"`, text);
    await document.fonts.ready;
  })().catch(() => undefined);
  await Promise.race([work, timeout]);
}
