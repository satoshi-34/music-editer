// テキストの書式（書体・文字サイズ・太さ）を編集中にその場で出すコンテキストUI（Issue #576）。
//
// タイトル欄の書式は元々「楽譜設定」タブに常設されていたが、使う頻度は「まれ」で、
// 常に見えていること自体が邪魔だった（運用者指示 2026-09-02）。編集している対象の
// そばに出す形へ移し、この部品を **共通部品** として切り出してある。
// 将来 #451（テキストボックスごとのフォント変更）でも同じ見た目・同じ操作で使えるように、
// 値と変更ハンドラだけを受け取り、状態はいっさい自分で持たない（制御コンポーネント）。
import {
  TITLE_FONT_OPTIONS,
  TITLE_FONT_SIZE_MAX,
  TITLE_FONT_SIZE_MIN,
  TITLE_FONT_SIZE_STEP,
  DEFAULT_TITLE_FONT_ID,
  normalizeTitleFontSize,
  normalizeTitleFontWeight,
} from '../utils/titleFontOptions';
import type { TitleFontWeight } from '../utils/titleFontOptions';

export type TextFormatContextPanelProps = {
  /**
   * アクセシブルな名前の接頭辞（例: 'タイトル' → 'タイトルの書体'）。
   * 呼び出し側ごとに読み上げ名を変えられるようにしてある（#451 では 'テキスト' 等になる想定）。
   */
  labelPrefix: string;
  /** 書体 id（utils/titleFontOptions.ts の一覧の id） */
  fontId: string;
  /** 文字サイズ。px ではなく「既定の見た目に対する倍率」（1 = 従来どおり） */
  fontSize: number;
  /** 太さ。undefined は「既定（タイトル行だけ太字）」の意味 */
  fontWeight: TitleFontWeight | undefined;
  onFontIdChange: (fontId: string) => void;
  onFontSizeChange: (fontSize: number) => void;
  onFontWeightChange: (fontWeight: TitleFontWeight | undefined) => void;
  /** 書体一覧の「既定」に出す文言（対象ごとに既定の意味が違うため差し替えられるようにする） */
  defaultFontLabel?: string;
  /** 太さの「既定」に出す文言 */
  defaultWeightLabel?: string;
  /** 位置決めは呼び出し側の責任（この部品は中身だけを持つ） */
  style?: React.CSSProperties;
};

/**
 * 書体・文字サイズ・太さの3つを1行に並べた小さなパネル。
 * 見た目は自由注釈の入力パネル（PianoSystemCanvas 内・#421/#432）にそろえてある
 * （白地・濃い枠・角丸・小さな影）。譜面の上に浮くので、視認できる程度に不透明にする。
 */
export default function TextFormatContextPanel({
  labelPrefix,
  fontId,
  fontSize,
  fontWeight,
  onFontIdChange,
  onFontSizeChange,
  onFontWeightChange,
  defaultFontLabel,
  defaultWeightLabel = '既定（タイトルのみ太字）',
  style,
}: TextFormatContextPanelProps) {
  return (
    <div
      className="text-format-context-panel"
      role="group"
      aria-label={`${labelPrefix}の書式`}
      style={style}
    >
      <label className="text-format-context-panel__field">
        <span>書体</span>
        <select
          value={fontId}
          onChange={(event) => onFontIdChange(event.target.value)}
          aria-label={`${labelPrefix}の書体`}
        >
          {TITLE_FONT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.id === DEFAULT_TITLE_FONT_ID && defaultFontLabel ? defaultFontLabel : option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-format-context-panel__field">
        <span>サイズ</span>
        <input
          type="range"
          min={TITLE_FONT_SIZE_MIN}
          max={TITLE_FONT_SIZE_MAX}
          step={TITLE_FONT_SIZE_STEP}
          value={fontSize}
          onChange={(event) => onFontSizeChange(normalizeTitleFontSize(Number(event.target.value)))}
          aria-label={`${labelPrefix}の文字サイズ`}
        />
        {/* 現在値はラベルの外（span）に出す。ラベル内に入れるとアクセシブルな名前が
            「サイズ140%」のように値を含んでしまい、動かすたびに名前が変わる（#563 と同じ理由） */}
      </label>
      <span className="text-format-context-panel__value">{Math.round(fontSize * 100)}%</span>

      <label className="text-format-context-panel__field">
        <span>太さ</span>
        <select
          value={fontWeight ?? ''}
          onChange={(event) => onFontWeightChange(normalizeTitleFontWeight(event.target.value))}
          aria-label={`${labelPrefix}の太さ`}
        >
          <option value="">{defaultWeightLabel}</option>
          <option value="normal">標準</option>
          <option value="bold">太字</option>
        </select>
      </label>
    </div>
  );
}
