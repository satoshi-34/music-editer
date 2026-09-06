// タイトル編集ダイアログ（Issue #576）。
//
// 譜面のタイトル・サブタイトル・作詞者・作曲者・編曲者は、以前は譜面の上で直接
// タイプする（contentEditable）方式で、書式（書体・文字サイズ・太さ）だけが
// 「楽譜設定」タブに離れて常設されていた。運用者裁定（2026-09-05）で
// 「タイトルを選択したらダイアログが出て、そこで全部決められる」形へ一本化した。
//
// 設計上の要点は3つ:
// 1. **暗幕（モーダルの黒い覆い）を使わない**。書体や文字サイズを変えた結果は
//    後ろの譜面のタイトルで確かめるものなので、譜面が隠れると意味がない
// 2. **入力のたびに親へ即座に伝える**（下書きを内部で溜めない）。親が本物の state を
//    書き換えるので、後ろのタイトルがその場で変わる＝即時プレビュー
// 3. **確定は「決定」だけ**。キャンセル・Esc は親が開く前の値へ丸ごと戻す
//    （プレビュー中に変えたものも含めて戻すため、戻す責任は親が持つ）
import { useEffect, useRef } from 'react';
import TextFormatContextPanel from './TextFormatContextPanel';
import type { TitleFontWeight } from '../utils/titleFontOptions';

type TitleEditDialogProps = {
  title: string;
  subtitle: string;
  lyricist: string;
  composer: string;
  arranger: string;
  fontId: string;
  fontSize: number;
  fontWeight: TitleFontWeight | undefined;
  /** どの欄が変わったかを親へ伝える（親が本物の state を書き換える＝即時プレビュー） */
  onFieldChange: (field: 'title' | 'subtitle' | 'lyricist' | 'composer' | 'arranger', value: string) => void;
  onFontIdChange: (fontId: string) => void;
  onFontSizeChange: (fontSize: number) => void;
  onFontWeightChange: (fontWeight: TitleFontWeight | undefined) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 欄の並びと見出し。作者欄は市販譜の並び（作詞→作曲→編曲）にそろえる */
const FIELDS = [
  { key: 'title', label: 'タイトル' },
  { key: 'subtitle', label: 'サブタイトル' },
  { key: 'lyricist', label: '作詞者' },
  { key: 'composer', label: '作曲者' },
  { key: 'arranger', label: '編曲者' },
] as const;

export default function TitleEditDialog({
  title,
  subtitle,
  lyricist,
  composer,
  arranger,
  fontId,
  fontSize,
  fontWeight,
  onFieldChange,
  onFontIdChange,
  onFontSizeChange,
  onFontWeightChange,
  onConfirm,
  onCancel,
}: TitleEditDialogProps) {
  const values = { title, subtitle, lyricist, composer, arranger };
  const firstFieldRef = useRef<HTMLTextAreaElement | null>(null);
  // 「押した時点の最新のハンドラ」を Esc 用に保つ。onCancel を effect の依存に入れると、
  // 親が毎レンダー新しい関数を作るたびにキーの登録・解除を繰り返すことになるため
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  // 開いたらタイトル欄へフォーカスを置く（クリックした人がそのまま打てるように）
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // Esc で取り消し。ダイアログの外（譜面やツールバー）にフォーカスがあるときも効かせたいので
  // window で受ける。譜面側のショートカット（Delete 等）へ届く前に止める必要はないが、
  // Esc は他でも使われるため、ダイアログが出ている間はここで握りつぶす
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      // 各欄が textarea（Enter は改行）なので、決定のキーボード操作は
      // 修飾キーつきの Enter にする（Mac は Cmd、Windows / Linux は Ctrl）
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        onConfirmRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <div className="title-edit-dialog" role="dialog" aria-label="タイトルの編集">
      <div className="title-edit-dialog__head">
        <strong>タイトルの編集</strong>
        {/* 暗幕が無いぶん「後ろは触れる」ことが伝わりにくいので、一言そえる */}
        <span className="title-edit-dialog__hint">変更はそのまま譜面に反映されます</span>
      </div>

      <div className="title-edit-dialog__fields">
        {FIELDS.map((field, index) => (
          <label key={field.key} className="title-edit-dialog__field">
            <span>{field.label}</span>
            {/* textarea なので Enter がそのまま改行になる（#636 の「タイトルを2行にしたい」）。
                rows=1 の見た目のまま、入力に応じて縦に伸びるより単純な固定高さにしてある */}
            <textarea
              ref={index === 0 ? firstFieldRef : undefined}
              value={values[field.key]}
              rows={field.key === 'title' || field.key === 'subtitle' ? 2 : 1}
              onChange={(event) => onFieldChange(field.key, event.target.value)}
              aria-label={field.label}
            />
          </label>
        ))}
      </div>

      {/* 書体・文字サイズ・太さ。5つの欄すべてへまとめて効く（従来と同じ範囲） */}
      <TextFormatContextPanel
        labelPrefix="タイトル"
        fontId={fontId}
        fontSize={fontSize}
        fontWeight={fontWeight}
        onFontIdChange={onFontIdChange}
        onFontSizeChange={onFontSizeChange}
        onFontWeightChange={onFontWeightChange}
      />

      <div className="title-edit-dialog__actions">
        <button type="button" className="ghost" onClick={onCancel}>キャンセル</button>
        <button type="button" className="primary" onClick={onConfirm}>決定</button>
      </div>
    </div>
  );
}
