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

type Props = {
  onClose: () => void;
};

/**
 * README の markdown を最小限の JSX に描く簡易レンダラー。
 * 依存を増やさないため、ヘルプで実際に使う記法だけ対応する:
 * 見出し(####)・箇条書き・番号付きリスト・表・段落・強調(**)・コード(`)。
 * リンクはヘルプ内で開けないので「表示テキストだけ」に落とす。
 */
function renderMarkdownLite(markdown: string): React.ReactNode[] {
  const stripInline = (text: string): React.ReactNode[] => {
    // リンク→テキスト、画像→除去
    const plain = text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // **強調** と `コード` を split で拾う
    const parts = plain.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
      return part;
    });
  };

  const lines = markdown.split('\n');
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(<p key={key++}>{stripInline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{stripInline(item)}</li>);
    out.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };
  const flushTable = () => {
    if (!table || table.length === 0) { table = null; return; }
    const [head, ...rows] = table;
    out.push(
      <div className="help-table-wrap" key={key++}>
        <table>
          <thead><tr>{head.map((cell, i) => <th key={i}>{stripInline(cell)}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{stripInline(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    table = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === '') { flushAll(); continue; }
    const h4 = /^#{4,6}\s+(.+)$/.exec(trimmed);
    if (h4) { flushAll(); out.push(<h4 key={key++}>{stripInline(h4[1])}</h4>); continue; }
    if (/^\|.*\|$/.test(trimmed)) {
      flushParagraph(); flushList();
      // 区切り行（|---|---|）は捨てる
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
      const cells = trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
      (table ??= []).push(cells);
      continue;
    }
    flushTable();
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    const numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
      continue;
    }
    // 引用（>）は普通の段落として扱う
    flushList();
    paragraph.push(trimmed.replace(/^>\s?/, ''));
  }
  flushAll();
  return out;
}

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
  const sections = useMemo(() => parseReadmeSections(readmeRaw), []);
  const { guides, sections: hitSections } = useMemo(
    () => searchHelp(query, sections),
    [query, sections],
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 目的別ガイドの「詳しく」からリファレンス項目へスクロールする
  const jumpToSection = (title: string) => {
    const target = sections.find((s) => s.title === title);
    if (!target) return;
    setQuery('');
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
      <div className="help-panel" role="dialog" aria-label="ヘルプ" aria-modal="true">
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
                    <details key={section.id} data-help-section={section.id} className="help-ref-item" open={query.trim() !== ''}>
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
