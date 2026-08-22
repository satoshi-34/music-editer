// アプリ内ヘルプ（Issue #341）の簡易 markdown レンダラー。
// HelpPanel から分離しているのは、react-refresh の制約（コンポーネントファイルからの
// 関数 export）を避けつつ、描画結果を直接テストできるようにするため。
/**
 * README の markdown を最小限の JSX に描く簡易レンダラー。
 * 依存を増やさないため、ヘルプで実際に使う記法だけ対応する:
 * 見出し(####)・箇条書き・番号付きリスト・表・段落・強調(**)・コード(`)。
 * リンクはヘルプ内で開けないので「表示テキストだけ」に落とす。
 */
export function renderMarkdownLite(markdown: string): React.ReactNode[] {
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
    // 箇条書きの継続行（行頭がインデントされた地の文）は、直前の項目の続きとして保つ。
    // trim してから段落扱いすると、README「調号」のような階層付きの説明が
    // リストの外へ吐き出されて構造が崩れる（Codex round1 P3）
    if (list && /^\s+\S/.test(line) && !/^\s+[-*]\s+/.test(line) && !/^\s+\d+\.\s+/.test(line)) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }
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

