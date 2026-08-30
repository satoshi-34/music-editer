// アプリ内ヘルプ（Issue #341）のコンテンツ層テスト。
// リファレンスの正本は README なので、実物の README も読み込んで
// 「目的別ガイドの参照先（seeAlso）が実在する」ことまで固定する。
import { describe, expect, it } from 'vitest';
import readmeRaw from '../../README.md?raw';
import { TASK_GUIDES, parseReadmeSections, searchHelp } from './helpContent';

const FIXTURE = `# アプリ

## 1. このアプリでできること
- いろいろ

## 3. 画面・各タブの説明
タブの説明の前文。

## 5. よく使う応用操作

### タイ／スラー
- 始点 → 終点の順にクリック

### 連符
- 数字を消せる

## 6. キーボードショートカット

| キー | 動作 |
| --- | --- |
| V | 声部切替 |

## 8. 開発者向け文書へのリンク
- ここは載せない
`;

describe('parseReadmeSections（README→リファレンス項目）', () => {
  it('操作章だけを ###（無ければ ##）単位で項目化し、開発者向け章は除く', () => {
    const sections = parseReadmeSections(FIXTURE);
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(['画面・各タブの説明', 'タイ／スラー', '連符', 'キーボードショートカット']);
    // 「できること」「開発者向け」は含まれない
    expect(sections.some((s) => s.body.includes('ここは載せない'))).toBe(false);
    // 章タイトルから番号は除去され、body は markdown のまま
    expect(sections[1].chapter).toBe('よく使う応用操作');
    expect(sections[1].body).toContain('始点 → 終点');
  });

  it('実物の README からも主要な操作項目が取れる（章番号の振り直しに依存しない）', () => {
    const sections = parseReadmeSections(readmeRaw);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain('タイ／スラー');
    expect(titles).toContain('キーボードショートカット');
    expect(titles.length).toBeGreaterThan(15);
  });

  it('目的別ガイドの seeAlso は、実物の README のリファレンス項目に必ず実在する', () => {
    const titles = new Set(parseReadmeSections(readmeRaw).map((s) => s.title));
    for (const guide of TASK_GUIDES) {
      if (guide.seeAlso) {
        expect(titles.has(guide.seeAlso), `${guide.id} の seeAlso「${guide.seeAlso}」`).toBe(true);
      }
    }
  });
});

describe('searchHelp（横断検索）', () => {
  const sections = parseReadmeSections(FIXTURE);

  it('空クエリは全件を返す（一覧として眺められる）', () => {
    const { guides, sections: hit } = searchHelp('', sections);
    expect(guides).toHaveLength(TASK_GUIDES.length);
    expect(hit).toHaveLength(sections.length);
  });

  it('キーワードで目的別ガイドとリファレンスの両方に絞り込める', () => {
    const { guides, sections: hit } = searchHelp('タイ', sections);
    expect(guides.some((g) => g.id === 'tie-slur')).toBe(true);
    expect(hit.some((s) => s.title === 'タイ／スラー')).toBe(true);
  });

  it('スペース区切りは AND 条件（例:「連符 数字」）', () => {
    const { guides } = searchHelp('連符 数字', parseReadmeSections(FIXTURE));
    expect(guides.map((g) => g.id)).toContain('tuplet-number');
    expect(guides.map((g) => g.id)).not.toContain('tie-slur');
  });

  it('大文字小文字を区別しない（英字キーワード）', () => {
    const { guides } = searchHelp('musicxml', sections);
    expect(guides.some((g) => g.id === 'musicxml')).toBe(true);
  });
});

describe('データの保存場所と安全性（#497）', () => {
  const sections = parseReadmeSections(readmeRaw);

  it('README のリファレンス項目として存在し、保存先と非送信の両方を書いている', () => {
    const section = sections.find((s) => s.title === 'データの保存場所と安全性');
    expect(section).toBeDefined();
    expect(section!.body).toContain('この端末の中だけ');
    expect(section!.body).toContain('送られることはありません');
  });

  it('不安に思ったユーザーが打ちそうな言葉で引ける（「保存 どこ」「公開」）', () => {
    // ヘルプは「知りたいときに引けて初めて意味がある」ので、検索経路まで固定する
    const byWhere = searchHelp('保存 どこ', sections);
    expect(
      byWhere.guides.some((g) => g.id === 'storage-location')
      || byWhere.sections.some((s) => s.title === 'データの保存場所と安全性'),
    ).toBe(true);

    const byPublic = searchHelp('公開', sections);
    expect(
      byPublic.guides.some((g) => g.id === 'storage-location')
      || byPublic.sections.some((s) => s.title === 'データの保存場所と安全性'),
    ).toBe(true);
  });
});
