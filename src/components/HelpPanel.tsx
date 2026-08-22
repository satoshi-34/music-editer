// アプリ内ヘルプ（Issue #341）。
// 「やりたいこと」から引ける目的別ガイドと、README 由来の操作リファレンスの2層を
// 1つの検索ボックスで横断する。コンテンツの正本は utils/helpContent.ts（ガイド）と
// README.md（リファレンス。実行時にパースするだけで二重管理しない）。
import { useMemo, useRef, useState } from 'react';
import readmeRaw from '../../README.md?raw';
import {
  parseReadmeSections,
  searchHelp,
  type HelpSection,
  type TaskGuide,
} from '../utils/helpContent';
import { renderMarkdownLite } from './helpMarkdown';

type Props = {
  onClose: () => void;
};

function GuideItem({ guide, onJumpTo }: { guide: TaskGuide; onJumpTo: (title: string) => void }) {
  return (
    <details className="help-guide-item">
      <summary>{guide.title}</summary>
      <ol>
        {guide.steps.map((step, i) => <li key={i}>{step}</li>)}
      </ol>
      {guide.seeAlso && (
        <button type="button" className="help-see-also" onClick={() => onJumpTo(guide.seeAlso!)}>
          詳しく: リファレンス「{guide.seeAlso}」へ
        </button>
      )}
    </details>
  );
}

export default function HelpPanel({ onClose }: Props) {
  const [query, setQuery] = useState('');
  // 「詳しく」でジャンプした先の項目 id。検索を消しても、この項目だけは開いたままにする
  // （閉じた details へスクロールしても本文が見えない・Codex round1 P2）
  const [pinnedSectionId, setPinnedSectionId] = useState<string | null>(null);
  const sections = useMemo(() => parseReadmeSections(readmeRaw), []);
  const { guides, sections: hitSections } = useMemo(
    () => searchHelp(query, sections),
    [query, sections],
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // モーダル内のキー入力を譜面へ届かせない（ConfirmDialog と同じ守り・Codex round1 P1）。
  // 検索欄の Backspace/Delete が window のグローバルハンドラへ伝播すると、
  // ヘルプの裏で選択中の音符・弧・松葉が無言で消えてしまう（#238 と同型）。
  // Escape はヘルプを閉じる操作として受ける
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') onClose();
  };

  // 目的別ガイドの「詳しく」からリファレンス項目へスクロールする
  const jumpToSection = (title: string) => {
    const target = sections.find((s) => s.title === title);
    if (!target) return;
    setQuery('');
    setPinnedSectionId(target.id);
    // クエリを消した再レンダー後に対象へスクロールする
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector(`[data-help-section="${target.id}"]`)
        ?.scrollIntoView({ block: 'start' });
    });
  };

  // 章ごとにまとめて見出しを付ける（検索でヒットした項目だけを章の下に並べる）
  const chapters: Array<{ chapter: string; items: HelpSection[] }> = [];
  for (const section of hitSections) {
    const last = chapters[chapters.length - 1];
    if (last && last.chapter === section.chapter) last.items.push(section);
    else chapters.push({ chapter: section.chapter, items: [section] });
  }

  return (
    <>
      <div className="dropdown-overlay" onClick={onClose} />
      <div className="help-panel" role="dialog" aria-label="ヘルプ" aria-modal="true" onKeyDown={handleKeyDown}>
        <div className="help-panel-head">
          <strong>ヘルプ</strong>
          <input
            type="search"
            className="help-search"
            placeholder="検索（例: タイ／連符 数字／段またぎ）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="ヘルプ内を検索"
            autoFocus
          />
          <button type="button" className="ghost" onClick={onClose} aria-label="ヘルプを閉じる">✕ 閉じる</button>
        </div>
        <div className="help-panel-body" ref={bodyRef}>
          <section>
            <h3>やりたいことから探す</h3>
            {guides.length === 0 ? (
              <p className="help-empty">見つかりませんでした。下のリファレンスも確認してください</p>
            ) : (
              guides.map((guide) => <GuideItem key={guide.id} guide={guide} onJumpTo={jumpToSection} />)
            )}
          </section>
          <section>
            <h3>操作リファレンス（説明書）</h3>
            {chapters.length === 0 ? (
              <p className="help-empty">この言葉ではリファレンスに見つかりませんでした（言い換えて検索してみてください）</p>
            ) : (
              chapters.map(({ chapter, items }) => (
                <div key={chapter}>
                  <h4 className="help-chapter">{chapter}</h4>
                  {items.map((section) => (
                    <details key={section.id} data-help-section={section.id} className="help-ref-item" open={query.trim() !== '' || section.id === pinnedSectionId}>
                      <summary>{section.title}</summary>
                      <div className="help-ref-body">{renderMarkdownLite(section.body)}</div>
                    </details>
                  ))}
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </>
  );
}
