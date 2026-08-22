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

/**
 * Google Fonts が必要なフォントなら <link> を1回だけ注入する。
 * システムスタックのフォントでは何もしない。オフラインで読み込めない場合も
 * スタックの後続フォントで表示できるため、失敗は握りつぶしてよい。
 */
export function ensureTitleFontLoaded(option: TitleFontOption): void {
  if (!option.googleFontFamily || typeof document === 'undefined') return;
  const linkId = `title-font-${option.id}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${option.googleFontFamily}&display=swap`;
  document.head.appendChild(link);
}
