// src/components/ConfirmDialog.tsx
// アプリ内の確認ダイアログ（Issue #221）。
// これまで `window.confirm` を使っていたが、埋め込みブラウザ（CDP 制御下のブラウザ・
// 一部の WebView・キオスク環境）では confirm のダイアログが表示されず常に false が
// 返るため、押しても何も起きない「無反応」になっていた。React で描くダイアログに
// 置き換えることで、どの実行環境でも同じように確認できるようにする。
// 設計の正本: .claude/specs/score-new-document/design.md

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogProps {
  /** 確認したい内容の本文（window.confirm に渡していた文言をそのまま使う） */
  message: string;
  /** ダイアログ自体の説明（スクリーンリーダー向け。既定は「確認」） */
  ariaLabel?: string;
  /** 実行ボタンの文言 */
  confirmLabel?: string;
  /** 取りやめボタンの文言 */
  cancelLabel?: string;
  /**
   * 入力欄つきで開くときの初期値（Issue #507 の書き出しファイル名など）。
   * undefined なら従来どおり「確認だけ」のダイアログになる。
   * window.prompt を使わないのは confirm と同じ理由で、埋め込みブラウザでは
   * 表示されず必ず null が返る（＝押しても何も起きない）ため。
   */
  inputDefaultValue?: string;
  /** 入力欄のラベル（スクリーンリーダー向け。既定は message と同じ） */
  inputLabel?: string;
  /** 入力欄の右に固定で見せる文字（拡張子など。ユーザーは編集できない） */
  inputSuffix?: string;
  /** OK が押されたときの処理。入力欄つきのときは入力値が渡る */
  onConfirm: (inputValue: string) => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  message,
  ariaLabel = '確認',
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  inputDefaultValue,
  inputLabel,
  inputSuffix,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 入力欄つきかどうかは「初期値が渡されたか」で決める（空文字も入力欄つき扱い）
  const hasInput = inputDefaultValue !== undefined;
  const [inputValue, setInputValue] = useState(inputDefaultValue ?? '');
  // 決着済みフラグ。Enter キーとボタンのクリックが同じ操作で二重に走っても
  // （新規作成のような取り消せない処理が2回実行されないよう）1回しか通さない。
  const settledRef = useRef(false);

  // 開いた直後にフォーカスを移す。window.confirm と同じく
  // 「開く → Enter で決定」がキーボードだけで完結するようにするため
  // （入力欄つきのときは入力欄、そうでなければ OK ボタンへ）。
  useEffect(() => {
    if (hasInput) {
      // 入力欄つきのときは入力欄へフォーカスし、既定値を選択状態にする。
      // 既定値（タイトル由来のファイル名）をそのまま使う人は Enter、
      // 変えたい人はそのまま打ち始められる、という両取りのため
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    confirmButtonRef.current?.focus();
  }, [hasInput]);

  const settle = (action: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    action();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // どのキーもここで止める。Escape/Enter だけ止める形だと、モーダル表示中の
    // Delete や矢印キーが window の譜面操作へ伝播し、ダイアログの裏で選択中の
    // 音符が無言で消える（#238 と同型の回帰。レビュー指摘）。
    // stopPropagation は Tab のフォーカス移動などブラウザ標準の挙動は妨げない。
    e.stopPropagation();
    if (e.key === 'Escape') {
      settle(onCancel);
      return;
    }
    if (e.key === 'Enter') {
      // 「フォーカス中のボタンを Enter で押す」というブラウザ標準の挙動に頼らず、
      // ここで明示的に決定する。埋め込みブラウザ（この Issue の発端になった環境）では
      // 標準の押下が起きないことがあるため。preventDefault で標準の押下を止め、
      // それでもクリックが飛んだ場合は settle が二重実行を防ぐ。
      e.preventDefault();
      settle(() => onConfirm(inputValue));
    }
  };

  // ツールバーは overflow や transform（ページ拡縮）の中にあり、その中で描くと
  // ダイアログが切れたり位置がずれたりする。パート編集ウィンドウと同じく
  // document.body 直下へ portal して、常に画面の中央へ重ねる。
  return createPortal(
    <div
      className="confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-testid="confirm-dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="confirm-dialog">
        <p className="confirm-dialog-message">{message}</p>
        {hasInput && (
          <div className="confirm-dialog-input-row">
            <input
              ref={inputRef}
              type="text"
              className="confirm-dialog-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              aria-label={inputLabel ?? message}
              data-testid="confirm-dialog-input"
            />
            {inputSuffix && (
              // 拡張子はアプリが付けるので、編集できない添え字として見せる
              <span className="confirm-dialog-input-suffix">{inputSuffix}</span>
            )}
          </div>
        )}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => settle(onCancel)}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog-ok"
            ref={confirmButtonRef}
            onClick={() => settle(() => onConfirm(inputValue))}
            data-testid="confirm-dialog-ok"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
