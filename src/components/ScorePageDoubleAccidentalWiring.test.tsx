// ダブルシャープ・ダブルフラット・descresc.（#423）の ScorePage 配線テスト（Codex round1 P2）。
//
// Palette 単体テストは props 直渡しのため、実タブ操作 → tool state → 譜面クリック →
// 保存データ・SVG 描画という配線を固定できない。ここで実経路をまとめて固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import { SCORE_EDIT_NOTICE_EVENT, type ScoreEditNoticeDetail } from '../utils/scoreEditorNotices';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

let workId = '';

function seedWork() {
  const events = [
    { dur: '2' as const, isRest: false, keys: ['g/4'] },
    { dur: '2' as const, isRest: false, keys: ['a/4'] },
  ];
  const data = createSavedScoreData(
    { title: 'ダブル記号配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('ダブル記号配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

function firstNoteHit(): SVGRectElement {
  return document.querySelector('rect.vf-note-hit[data-note="0"]') as SVGRectElement
    ?? document.querySelector('rect.vf-note-hit') as SVGRectElement;
}

/** jsdom はレイアウトを持たないので、SVG の表示サイズを固定して座標換算を成立させる */
function mockSvgLayout(svg: SVGSVGElement): number {
  const width = parseFloat(svg.getAttribute('width') ?? '0') || 900;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
  return width;
}

/**
 * 1音目（g/4）の符頭そのものをクリックする。
 * Issue #548 の統合で、臨時記号の付与は「符頭に当たったクリック」だけになったため
 * （セル中央を押すと音符が増える）。g/4 はト音譜表の第2線の下＝line 3。
 */
function clickFirstNoteHead() {
  const hit = firstNoteHit();
  const svg = hit.ownerSVGElement as SVGSVGElement;
  const width = mockSvgLayout(svg);
  const vbParts = (svg.getAttribute('viewBox') ?? '').split(/\s+/);
  const ratio = vbParts.length === 4 && parseFloat(vbParts[2]) > 0 ? width / parseFloat(vbParts[2]) : 1;
  const x = (parseFloat(hit.getAttribute('data-note-left')!) + parseFloat(hit.getAttribute('data-note-right')!)) / 2;
  const y = parseFloat(hit.getAttribute('data-line0-y')!) + 3 * parseFloat(hit.getAttribute('data-line-spacing')!);
  fireEvent.click(hit, { clientX: x * ratio, clientY: y * ratio });
}

/** 統合後のパレット: 「♯▾」のプルダウンを開いて変種（𝄪 など）を選ぶ */
function selectAccidentalVariant(familyMenu: RegExp, variant: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: familyMenu }));
  fireEvent.click(screen.getByRole('button', { name: variant }));
}

describe('ScorePage: ダブル記号と descresc. の配線（#423）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  // Issue #548 でパレットを統合したので、𝄪 は「♯▾」のプルダウンの中にある。
  // ツールは1つ（付与も入力も同じツール）で、意味はクリック先で決まるため、
  // ここでは符頭そのものを押して「付与」の経路を通す。
  it('𝄪 ツールで音符をクリックすると keys が ## になり、保存・SVG まで届く', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // VexFlow の臨時記号は g.vf-modifiers 配下の text グリフとして描かれる。
    // クラス名がバージョンで揺れるため、SVG 内の text ノード総数の増加で
    // 「臨時記号グリフが描画された」ことを検出する（適用前後で同じ譜面・同じ音符数）
    const svgTextCount = () => document.querySelectorAll('.system-stack svg text').length;
    const before = svgTextCount();
    selectAccidentalVariant(/^シャープ系の種類を選ぶ/, /^臨時記号: ダブルシャープ/);
    clickFirstNoteHead();

    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.keys?.[0]).toBe('g##/4');
    }, { timeout: 15000 });
    // SVG にも臨時記号が実際に描かれる（保存だけ通って描画へ渡らない退行の検出・round2 P2）
    await waitFor(() => {
      expect(svgTextCount()).toBeGreaterThan(before);
    }, { timeout: 15000 });
    // 外すのは♮（既存の♯♭と同じ規則。同じ記号の再クリックは維持）
    fireEvent.click(screen.getByRole('button', { name: /^臨時記号: ナチュラル/ }));
    clickFirstNoteHead();
    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.keys?.[0]).toBe('g/4');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('descresc. を音符に付けると保存され、テキストとして描かれる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    // 松葉＞ボタンも「デクレッシェンドの松葉＞…」という名前になった（Issue #444）ため、
    // /デクレッシェンド/ だけだと2件マッチしてしまう。文字表記の descresc. ボタンだけを指す
    fireEvent.click(
      await screen.findByRole('button', { name: /^デクレッシェンド（dim\./ }, { timeout: 15000 })
    );
    fireEvent.click(firstNoteHit());

    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.dynamics?.some((d) => d.value === 'descresc')).toBe(true);
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('descresc.');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // #430 round2 P2: 調号領域を 𝄪 で押したときの「行き止まりは喋る」と履歴・保存の不変
  it('𝄪 で調号領域をクリックすると案内が出て、譜面は変わらない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 調号領域のデバッグ rect（vf-key-signature-debug）は**臨時記号ツールを選んだ後**に
    // だけ描かれる。先にツールを選び、出現を必須アサーションにする（round3 P2:
    // 早期 return で空洞化していた）
    selectAccidentalVariant(/^シャープ系の種類を選ぶ/, /^臨時記号: ダブルシャープ/);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-key-signature-debug')).toBeTruthy();
    }, { timeout: 15000 });
    const svg = Array.from(document.querySelectorAll('svg'))
      .find((c) => c.querySelector('rect.vf-key-signature-debug')) as SVGSVGElement;
    const width = parseFloat(svg.getAttribute('width') ?? '0') || 900;
    const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
    svg.getBoundingClientRect = vi.fn(() => ({
      left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
    })) as unknown as typeof svg.getBoundingClientRect;
    Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
    Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });

    const debugRect = svg.querySelector('rect.vf-key-signature-debug') as SVGRectElement;
    expect(debugRect).toBeTruthy();
    // debug rect の座標は viewBox（論理）単位。クリックの clientX/Y は表示px なので、
    // viewBox→表示 の比で換算してから押す（換算しないと境界のすぐ外を押してしまう）
    const vbParts = (svg.getAttribute('viewBox') ?? '').split(/\s+/);
    const ratio = vbParts.length === 4 && parseFloat(vbParts[2]) > 0 ? width / parseFloat(vbParts[2]) : 1;
    const cx = (parseFloat(debugRect.getAttribute('x')!) + parseFloat(debugRect.getAttribute('width')!) / 2) * ratio;
    const cy = (parseFloat(debugRect.getAttribute('y')!) + parseFloat(debugRect.getAttribute('height')!) / 2) * ratio;

    const savedBefore = JSON.stringify(loadWorkAutosaveData(workId).data?.parts);
    const notices: string[] = [];
    const listener = (e: Event) => {
      const d = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
      if (d?.message) notices.push(d.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
    // 背景クリックの受け手は小節の当たり判定（vf-hit）。調号領域の座標で押す
    const bgHit = svg.querySelector('rect.vf-hit') as SVGRectElement;
    fireEvent.click(bgHit, { clientX: cx, clientY: cy });
    window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, listener);

    await waitFor(() => {
      const notice = document.querySelector('[data-testid="edit-notice"]');
      expect(notice?.textContent ?? '').toContain('調号には使えません');
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));
    expect(JSON.stringify(loadWorkAutosaveData(workId).data?.parts)).toBe(savedBefore);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
