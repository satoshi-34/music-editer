// ホーム画面（Issue #500・レイアウトは #512 → #528）の単体テスト。
// 画面が「何を出すか」「押したら何を呼ぶか」をここで固定し、
// 実際に譜面画面へ届くこと（配線）は App.test.tsx の統合テストで確かめる。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import HomeScreen, { type HomeOpenKind, type HomeScreenProps } from './HomeScreen';
import type { WorkSummary } from '../types/storage';
import {
  HOME_STORAGE_LOCATION_NOTE, HOME_STORAGE_LOCATION_NOTE_SHORT, HOME_STORAGE_PORTABILITY_NOTE,
} from '../utils/storageLocationNotice';

const WORKS: WorkSummary[] = [
  { id: 'w1', title: 'ソナタ', updatedAt: new Date(2026, 7, 30, 12, 34).getTime(), createdAt: 1 },
  { id: 'w2', title: '', updatedAt: new Date(2026, 7, 29, 9, 5).getTime(), createdAt: 1 },
];

const ALL_OPEN_KINDS: HomeOpenKind[] = ['file', 'musicxml', 'pdf', 'legacy'];

function renderHome(overrides: Partial<HomeScreenProps> = {}) {
  const props: HomeScreenProps = {
    appVersion: '3.6.0',
    works: WORKS,
    availableOpenKinds: ALL_OPEN_KINDS,
    onSelectWork: vi.fn(),
    onCreateNew: vi.fn(),
    onOpen: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<HomeScreen {...props} />);
  return props;
}

describe('ホーム画面（Issue #500）', () => {
  afterEach(() => cleanup());

  // 保存先の常設表示（Issue #570）。
  // 「ログインが無い＝全世界に公開されているのでは」という誤解は核ユーザーが実際に抱いたもので、
  // 初回の通知（#497）は数秒で消えるため後から来た不安には答えられない。
  // ここでは「消えない一言がホームに出ていること」と「文言が定数の1か所から来ていること」を固定する。
  it('保存先の説明と、持ち出し方の案内がホームに常設で出ている（#570 受入）', () => {
    renderHome();

    const note = screen.getByTestId('home-storage-location-note');
    // 直書きの文字列で照合しない: 定数と一致することまで見て、
    // 将来ログイン（#498）で差し替えたときに2か所へ書き分ける事故を防ぐ
    expect(note.textContent).toBe(HOME_STORAGE_LOCATION_NOTE);
    expect(note.textContent).toContain('この端末にだけ保存されます');
    // 「送信されない」ことまで言えていないと、公開の誤解は解けない
    expect(note.textContent).toContain('送信されることはありません');

    const portability = screen.getByTestId('home-storage-portability-note');
    expect(portability.textContent).toBe(HOME_STORAGE_PORTABILITY_NOTE);
    // 安心の裏返し（端末を変えると持ち出せない）への答えが対で出ている
    expect(portability.textContent).toContain('書き出し');

    // フッターにも控えめな一行が出るが、上と**同じ文の二度出し**にはしない
    // （同じ画面に同じ文が2つ並ぶと、かえってどちらも読み飛ばされる）
    const footer = screen.getByTestId('home-storage-footer-note');
    expect(footer.textContent).toBe(HOME_STORAGE_LOCATION_NOTE_SHORT);
    expect(footer.textContent).not.toBe(note.textContent);
  });

  it('作品が1件も無くても保存先の説明は消えない（不安を持つのは始めたてのユーザー）', () => {
    renderHome({ works: [] });

    expect(screen.getByTestId('home-works-empty')).toBeTruthy();
    expect(screen.getByTestId('home-storage-location-note').textContent).toBe(HOME_STORAGE_LOCATION_NOTE);
  });

  it('「最近使ったファイル」の先頭が最新の作品で、1クリックで開ける（#528 受入条件2）', () => {
    const props = renderHome();
    // 「前回の続き」専用バナーは廃止済み（#528）。一覧の先頭がその役割を引き継ぐ
    expect(screen.queryByTestId('home-resume')).toBeNull();

    const cards = [...document.querySelectorAll<HTMLButtonElement>('.home-work-list button')];
    expect(cards.map(card => card.dataset.testid)).toEqual(['home-work-w1', 'home-work-w2']);
    expect(cards[0].textContent).toContain('ソナタ');
    expect(cards[0].textContent).toContain('2026/08/30 12:34');

    fireEvent.click(cards[0]);
    expect(props.onSelectWork).toHaveBeenCalledWith('w1');
    expect(props.onSelectWork).toHaveBeenCalledTimes(1);
  });

  it('作品が1つも無いときも、レイアウトは崩れず次にやることを言葉で示す（#528 受入条件3）', () => {
    renderHome({ works: [] });
    expect(document.querySelector('.home-work-list')).toBeNull();
    expect(screen.getByTestId('home-works-empty').textContent).toContain('新しく作る');
    // 新規作成カードは作品0件でもそのまま並ぶ（初回起動でも入口が消えない）
    expect(screen.getByTestId('home-new-single')).toBeTruthy();
    expect(screen.getByTestId('home-new-open')).toBeTruthy();
  });

  it('新規作成カードの行に「ファイルを開く」カードが並ぶ（#528 仕様更新）', () => {
    const props = renderHome();
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.home-card-grid button')];
    expect(cards.map(card => card.dataset.testid)).toEqual([
      'home-new-single',
      'home-new-piano',
      'home-new-quartet',
      'home-new-ensemble',
      'home-new-open',
    ]);
    fireEvent.click(screen.getByTestId('home-new-open'));
    expect(props.onOpen).toHaveBeenCalledWith('file');
  });

  it('譜種を選んで新規作成できる（4種類すべて）', () => {
    const props = renderHome();
    for (const type of ['single', 'piano', 'quartet', 'ensemble'] as const) {
      fireEvent.click(screen.getByTestId(`home-new-${type}`));
      expect(props.onCreateNew).toHaveBeenCalledWith(type);
    }
    expect(props.onCreateNew).toHaveBeenCalledTimes(4);
  });

  it('既存の「開く」導線をすべて呼べる', () => {
    const props = renderHome();
    for (const kind of ALL_OPEN_KINDS) {
      fireEvent.click(screen.getByTestId('home-rail-open'));
      fireEvent.click(screen.getByTestId(`home-open-${kind}`));
      expect(props.onOpen).toHaveBeenCalledWith(kind);
    }
  });

  it('使えない「開く」導線（PDF変換API無し・旧手動保存なし）は並べない', () => {
    renderHome({ availableOpenKinds: ['file', 'musicxml'] });
    fireEvent.click(screen.getByTestId('home-rail-open'));
    expect(screen.getByTestId('home-open-file')).toBeTruthy();
    expect(screen.queryByTestId('home-open-pdf')).toBeNull();
    expect(screen.queryByTestId('home-open-legacy')).toBeNull();
  });

  it('保存した作品の一覧から作品を開ける（タイトル未設定は「無題」）', () => {
    const props = renderHome();
    expect(screen.getByTestId('home-work-w2').textContent).toContain('無題');
    fireEvent.click(screen.getByTestId('home-work-w1'));
    expect(props.onSelectWork).toHaveBeenCalledWith('w1');
  });

  it('設定の入口はツールバーのタブへ送るだけ（設定を二重に持たない）', () => {
    const props = renderHome();
    fireEvent.click(screen.getByTestId('home-rail-settings'));
    fireEvent.click(screen.getByTestId('home-settings-score'));
    expect(props.onOpenSettings).toHaveBeenCalledWith('score');
    fireEvent.click(screen.getByTestId('home-rail-settings'));
    fireEvent.click(screen.getByTestId('home-settings-layout'));
    expect(props.onOpenSettings).toHaveBeenCalledWith('layout');
    fireEvent.click(screen.getByTestId('home-rail-settings'));
    fireEvent.click(screen.getByTestId('home-settings-playback'));
    expect(props.onOpenSettings).toHaveBeenCalledWith('playback');
  });

  it('バージョンをフッターに表示する（受入条件7）', () => {
    renderHome({ appVersion: '3.7.1' });
    expect(screen.getByTestId('home-version').textContent).toBe('v3.7.1');
  });

  it('ログイン要素は置かない（お試しの障壁を上げない方針）', () => {
    renderHome();
    const buttonLabels = screen.getAllByRole('button').map(button => button.textContent ?? '');
    expect(buttonLabels.some(label => /ログイン|サインイン|アカウント/.test(label))).toBe(false);
  });

  it('busy 中は設定を含む全ボタンが無効になる（round3/round4 P2: 連打の無言無視を見た目で防ぐ）', () => {
    render(
      <HomeScreen
        appVersion="1.0.0"
        works={[{ id: 'w1', title: '作品', updatedAt: Date.now(), createdAt: Date.now() }]}
        availableOpenKinds={['file', 'musicxml']}
        busy
        onSelectWork={() => {}}
        onCreateNew={() => {}}
        onOpen={() => {}}
        onOpenSettings={() => {}}
      />
    );
    // レールの開く/設定トグルはページ内移動と同じく busy の無効化対象にしない
    //（フライアウトを開くだけで実行はしない。実行ボタン側は無効化される）
    const buttons = [...document.querySelectorAll('.home-screen button')]
      .filter((b) => !(b as HTMLElement).classList.contains('home-rail-button'));
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId('home-screen').getAttribute('aria-busy')).toBe('true');
  });

  it('フライアウトの新仕様: busy中トグル可・実行ボタン無効・排他・Escapeでフォーカス復帰（#561）', () => {
    const { rerender } = render(
      <HomeScreen
        appVersion="1.0.0"
        works={[]}
        availableOpenKinds={['file', 'musicxml']}
        busy
        onSelectWork={() => {}}
        onCreateNew={() => {}}
        onOpen={() => {}}
        onOpenSettings={() => {}}
      />
    );
    // busy 中でもトグルは押せて開く
    const openToggle = screen.getByTestId('home-rail-open') as HTMLButtonElement;
    expect(openToggle.disabled).toBe(false);
    fireEvent.click(openToggle);
    expect(openToggle.getAttribute('aria-expanded')).toBe('true');
    // フライアウト内の実行ボタンは busy で無効
    expect((screen.getByTestId('home-open-file') as HTMLButtonElement).disabled).toBe(true);
    // 排他: 設定を開くと開く側は閉じる
    fireEvent.click(screen.getByTestId('home-rail-settings'));
    expect(screen.queryByTestId('home-open-file')).toBeNull();
    expect(screen.getByTestId('home-settings-score')).toBeTruthy();
    // Escape で閉じてトグルへフォーカスが戻る。フライアウト内ボタンから（従来経路）と
    // トグルにフォーカスが残ったまま（round2 P2 の経路）の両方で効くことを固定する
    fireEvent.keyDown(screen.getByTestId('home-settings-score'), { key: 'Escape' });
    expect(screen.queryByTestId('home-settings-score')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('home-rail-settings'));
    fireEvent.click(screen.getByTestId('home-rail-settings'));
    (screen.getByTestId('home-rail-settings') as HTMLButtonElement).focus();
    fireEvent.keyDown(screen.getByTestId('home-rail-settings'), { key: 'Escape' });
    expect(screen.queryByTestId('home-settings-score')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('home-rail-settings'));

    // busy でない状態では実行で自動クローズ+フォーカス復帰
    rerender(
      <HomeScreen
        appVersion="1.0.0"
        works={[]}
        availableOpenKinds={['file', 'musicxml']}
        onSelectWork={() => {}}
        onCreateNew={() => {}}
        onOpen={() => {}}
        onOpenSettings={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('home-rail-open'));
    fireEvent.click(screen.getByTestId('home-open-file'));
    expect(screen.queryByTestId('home-open-file')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('home-rail-open'));
  });

  it('保存領域が満杯のときは、作品一覧を出したまま満杯の案内を出す（Issue #641）', () => {
    // jsdom の Storage はプロパティ代入を setItem として扱うので、prototype をスパイする
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    try {
      renderHome();
      expect(screen.getByTestId('home-storage-notice').textContent).toContain('満杯');
      // 作品は消えていない（一覧に出る）ので、ここから削除・書き出しで抜け出せる
      expect(screen.getByText(WORKS[0].title)).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('保存領域が使えないときは、その旨の案内を出す（Issue #640）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError', 'SecurityError');
    });
    try {
      renderHome();
      expect(screen.getByTestId('home-storage-notice').textContent).toContain('保存ができません');
    } finally {
      spy.mockRestore();
    }
  });
});
