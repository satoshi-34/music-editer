// タイトルまわりのフォント選択（Issue #342）。
// 対象はタイトル・サブタイトル・作詞/作曲/編曲者の文字だけで、
// 音符・記号のフォント（Bravura 系）には一切触らない。
//
// 第1弾は提供フォントを限定していた（Codex レビュー反映の仕様）:
// - システム標準スタック（明朝/ゴシック/欧文セリフ/欧文サンセリフ）
// - Google Fonts の定番2種（Noto Serif JP / Noto Sans JP。オフライン時はスタックの
//   後続システムフォントへフォールバックする）
// Issue #420 で浄書向きの Google Fonts を10種追加した（欧文6・日本語4）。
// 一覧はこの定数1か所に集約してあるので、追加は1行で済む。
// あわせて、タイトルブロック（タイトル/サブタイトル/作者欄）の文字サイズ倍率と
// 太さもこのファイルで面倒を見る（保存データの正規化まで含める）。

export type TitleFontOption = {
  /**
   * 太さ未指定時に注入する互換用の title 側ウェイト。
   * 旧来の Noto 2書体は 400;600 だけを配信しており、h1 の太字要求（700）は 600 で
   * 描画されていた。#420 で 700 を配信に加えたため、未指定の既存譜面が 600→700 へ
   * 変わってしまう（Codex round1 P1）。この値がある書体は、未指定時に明示的に
   * この太さ（600）を注入して旧来の見た目を保ち、明示的な「太い」だけが 700 になる
   */
  legacyTitleWeight?: number;
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
  { id: 'noto-serif-jp', label: 'Noto Serif JP（Webフォント）', stack: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif', googleFontFamily: 'Noto+Serif+JP:wght@400;600;700', legacyTitleWeight: 600 },
  { id: 'noto-sans-jp', label: 'Noto Sans JP（Webフォント）', stack: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', googleFontFamily: 'Noto+Sans+JP:wght@400;600;700', legacyTitleWeight: 600 },
  // ここから Issue #420 の追加分。いずれも 400（標準）と 700（太字）を持つ書体だけを選んである
  // （太さトグルで 700 を使うため。無い書体を混ぜるとブラウザの合成太字になり品位が落ちる）。
  // 欧文の浄書向きセリフ体
  { id: 'eb-garamond', label: 'EB Garamond（欧文・Webフォント）', stack: '"EB Garamond", Garamond, "Times New Roman", serif', googleFontFamily: 'EB+Garamond:wght@400;700' },
  { id: 'cormorant-garamond', label: 'Cormorant Garamond（欧文・Webフォント）', stack: '"Cormorant Garamond", Garamond, "Times New Roman", serif', googleFontFamily: 'Cormorant+Garamond:wght@400;700' },
  { id: 'playfair-display', label: 'Playfair Display（欧文・Webフォント）', stack: '"Playfair Display", Georgia, "Times New Roman", serif', googleFontFamily: 'Playfair+Display:wght@400;700' },
  { id: 'libre-baskerville', label: 'Libre Baskerville（欧文・Webフォント）', stack: '"Libre Baskerville", Baskerville, Georgia, serif', googleFontFamily: 'Libre+Baskerville:wght@400;700' },
  { id: 'lora', label: 'Lora（欧文・Webフォント）', stack: 'Lora, Georgia, "Times New Roman", serif', googleFontFamily: 'Lora:wght@400;700' },
  { id: 'montserrat', label: 'Montserrat（欧文サンセリフ・Webフォント）', stack: 'Montserrat, "Helvetica Neue", Arial, sans-serif', googleFontFamily: 'Montserrat:wght@400;700' },
  // 日本語の浄書向き明朝・ゴシック
  { id: 'shippori-mincho', label: 'しっぽり明朝（日本語・Webフォント）', stack: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif', googleFontFamily: 'Shippori+Mincho:wght@400;700' },
  { id: 'zen-old-mincho', label: 'Zen Old Mincho（日本語・Webフォント）', stack: '"Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif', googleFontFamily: 'Zen+Old+Mincho:wght@400;700' },
  { id: 'biz-ud-pmincho', label: 'BIZ UDP明朝（日本語・Webフォント）', stack: '"BIZ UDPMincho", "Hiragino Mincho ProN", "Yu Mincho", serif', googleFontFamily: 'BIZ+UDPMincho:wght@400;700' },
  { id: 'zen-kaku-gothic-new', label: 'Zen Kaku Gothic New（日本語・Webフォント）', stack: '"Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', googleFontFamily: 'Zen+Kaku+Gothic+New:wght@400;700' },
];

// ── タイトルブロックの文字サイズ・太さ（Issue #420） ──────────────────────

/**
 * 文字サイズは「px の実値」ではなく **既定の見た目に対する倍率** で持つ。
 * タイトル・サブタイトル・作者欄は画面と印刷で基準サイズが違う（例: タイトルは
 * 画面 26px / 印刷 24px）ため、倍率にしておけばどちらにも同じ比率で効く。
 * 1 = 現状の見た目そのまま。
 */
export const TITLE_FONT_SIZE_DEFAULT = 1;
export const TITLE_FONT_SIZE_MIN = 0.7;
export const TITLE_FONT_SIZE_MAX = 1.6;
/** スライダーの刻み。0.05 = 26px のタイトルで約1.3px 刻み */
export const TITLE_FONT_SIZE_STEP = 0.05;

/** タイトルブロックの太さ。未指定（undefined）は「従来どおり」＝タイトルだけ太字 */
export type TitleFontWeight = 'normal' | 'bold';

/** 太字を選んだときに使う font-weight の実値 */
export const TITLE_FONT_WEIGHT_BOLD = 700;
/** 標準を選んだときに使う font-weight の実値 */
export const TITLE_FONT_WEIGHT_NORMAL = 400;

/**
 * 保存データの titleFontSize を安全な倍率へ丸める。
 * 未指定・数値でないものは既定の 1 へ、範囲外は最小/最大へクランプする
 * （打ち込み途中の値や手書き JSON の意図をできるだけ保つため。設計書と同語）。
 */
export function normalizeTitleFontSize(size: number | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) return TITLE_FONT_SIZE_DEFAULT;
  if (size < TITLE_FONT_SIZE_MIN) return TITLE_FONT_SIZE_MIN;
  if (size > TITLE_FONT_SIZE_MAX) return TITLE_FONT_SIZE_MAX;
  return size;
}

/**
 * 保存データの titleFontWeight を正規化する。
 * 'normal' / 'bold' 以外（未指定・未知の値）は undefined ＝「従来どおり」に倒す。
 */
export function normalizeTitleFontWeight(weight: string | undefined): TitleFontWeight | undefined {
  return weight === 'normal' || weight === 'bold' ? weight : undefined;
}

/**
 * タイトルブロックへ流し込む CSS 変数をまとめて作る。
 *
 * 既定値のときは**変数を1つも注入しない**のが要点で、こうしておくと App.css 側の
 * フォールバック（従来の px 値・従来の太さ）がそのまま効き、既存譜面の見た目が
 * 1px も変わらない。読込・復元・印刷のどの経路でも同じ関数を通す。
 */
export function titleBlockStyleVars(
  fontStack: string,
  fontSize: number | undefined,
  fontWeight: TitleFontWeight | undefined,
  /** 太さ未指定時に注入する互換ウェイト（TitleFontOption.legacyTitleWeight）。 */
  legacyTitleWeight?: number,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fontStack) vars['--title-font-override'] = fontStack;
  const size = normalizeTitleFontSize(fontSize);
  if (size !== TITLE_FONT_SIZE_DEFAULT) vars['--title-font-scale'] = String(size);
  const weight = normalizeTitleFontWeight(fontWeight);
  if (!weight && legacyTitleWeight) {
    // 旧来 600 上限だった書体の既存譜面の見た目を保つ（サブタイトル側は元々 400 なので触らない）
    vars['--title-font-weight'] = String(legacyTitleWeight);
  }
  if (weight) {
    const value = weight === 'bold' ? TITLE_FONT_WEIGHT_BOLD : TITLE_FONT_WEIGHT_NORMAL;
    // タイトル行と、サブタイトル・作者欄で別変数にしてある。
    // 「一括で太くする」ときに3つとも同じ太さになるようにしつつ、既定では
    // タイトルだけ太字という現状の見た目を壊さないため
    vars['--title-font-weight'] = String(value);
    vars['--title-font-weight-sub'] = String(value);
  }
  return vars;
}

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
    // タイトルは太字で描かれ得るため、標準と太字の両ウェイトを対象にする
    await document.fonts.load(`16px "${primaryFamily}"`, text);
    await document.fonts.load(`600 16px "${primaryFamily}"`, text);
    // 太さトグル（Issue #420）で 700 を使うため、太字ぶんも読み込み対象に含める
    await document.fonts.load(`700 16px "${primaryFamily}"`, text);
    await document.fonts.ready;
  })().catch(() => undefined);
  await Promise.race([work, timeout]);
}
