/*
 * 浄書既定値の A/B 比較用スニペット（Issue #195 段1）
 *
 * 【これは何か】
 * アプリのコードを一切変えずに、ブラウザ上だけで「五線・小節線・符幹などの太さ」と
 * 「文字の大きさ」を候補値へ差し替えて見比べるための道具です。
 * 値の選定は人間（運用者・#89 のインタビュー）が行うため、その判断材料として
 * 「同じ譜面・同じ倍率で、現状値と候補値を切り替えて見る」ことだけを目的にしています。
 *
 * 【使い方】
 *   1. アプリを開く（dev サーバーでも本番でも可）
 *   2. ブラウザの開発者ツール → コンソール にこのファイルの中身を貼り付けて実行
 *   3. コンソールで次を実行して切り替える
 *        engravingAB('current')  … 現状の既定値（何もしない状態）
 *        engravingAB('a')        … 候補A（Bravura の engravingDefaults に合わせる）
 *        engravingAB('b')        … 候補B（候補Aより線をわずかに太く。画面での視認性優先）
 *        engravingAB('off')      … 適用を解除（= current と同じ）
 *   4. 譜面を編集して再描画されたら engravingAB() を引数なしで呼ぶと再適用します
 *      （MutationObserver で自動再適用もしますが、取りこぼした場合の保険です）
 *
 * 【注意】
 * - 保存データは一切変更しません。リロードすれば元に戻ります
 * - 太さの単位は「五線間隔（staff space, sp）」です。このアプリの SVG は
 *   1 sp = 10 ユーザー単位で描かれているので、sp 値 × 10 が stroke-width になります
 * - 候補値の出典は .claude/specs/engraving-defaults/design.md を参照してください
 */
(function () {
  'use strict';

  /** 1 staff space = 10 SVG ユーザー単位（VexFlow の論理座標） */
  const UNITS_PER_SPACE = 10;

  /**
   * 候補値（単位はすべて staff space）。
   * current は「現状の実測値」で、比較の基準としてそのまま残す。
   */
  const PRESETS = {
    current: {
      label: '現状の既定値',
      staffLine: 0.12, stem: 0.12, ledger: 0.12, thinBarline: 0.10,
      hairpin: 0.12, bracket: 0.12, textEnclosure: 0.14,
      instrumentLabel: 1.1, measureNumber: 1.1, lyrics: 1.1, dynamics: 1.6,
      titlePx: 28, subtitlePx: 14, creditPx: 14, titleLetterSpacingEm: 0.08,
      scoreTextFont: null,
    },
    a: {
      label: '候補A（Bravura engravingDefaults 準拠）',
      staffLine: 0.13, stem: 0.12, ledger: 0.16, thinBarline: 0.16,
      hairpin: 0.16, bracket: 0.16, textEnclosure: 0.16,
      instrumentLabel: 1.7, measureNumber: 1.4, lyrics: 1.5, dynamics: 2.0,
      titlePx: 26, subtitlePx: 14, creditPx: 13, titleLetterSpacingEm: 0.02,
      scoreTextFont: '"Century Schoolbook", Georgia, "Times New Roman", serif',
    },
    b: {
      label: '候補B（Aより線を +0.02sp。小さい五線での視認性優先）',
      staffLine: 0.15, stem: 0.14, ledger: 0.18, thinBarline: 0.18,
      hairpin: 0.18, bracket: 0.18, textEnclosure: 0.18,
      instrumentLabel: 1.8, measureNumber: 1.5, lyrics: 1.6, dynamics: 2.1,
      titlePx: 26, subtitlePx: 14, creditPx: 13, titleLetterSpacingEm: 0.02,
      scoreTextFont: '"Century Schoolbook", Georgia, "Times New Roman", serif',
    },
  };

  const STYLE_ID = 'engraving-ab-style';
  let currentMode = 'current';
  let observer = null;

  /** 太さ系はCSSで当てる。`.score-area svg path` より詳細度を上げないと効かない */
  function buildCss(p) {
    const u = (sp) => (sp * UNITS_PER_SPACE).toFixed(2);
    return `
      .score-area svg g.vf-stave > path { stroke-width: ${u(p.staffLine)}px !important; }
      .score-area svg g.vf-stem > path { stroke-width: ${u(p.stem)}px !important; }
      /* 加線は StaveNote グループ直下の path（VexFlow が #444 で描く） */
      .score-area svg g.vf-stavenote > path[stroke] { stroke-width: ${u(p.ledger)}px !important; stroke: #000 !important; }
      .score-area svg path.vf-hairpin-line { stroke-width: ${u(p.hairpin)}px !important; }
      .score-area svg text { font-family: ${p.scoreTextFont ? p.scoreTextFont.replace(/"/g, "'") : 'inherit'}; }
      /* 音楽記号（Bravura）はテキスト置換の対象外に戻す */
      .score-area svg g[class^="vf-"] text { font-family: Bravura, Academico !important; }
      .score-title { font-size: ${p.titlePx}px !important; letter-spacing: ${p.titleLetterSpacingEm}em !important; ${p.scoreTextFont ? `font-family: ${p.scoreTextFont} !important;` : ''} }
      .score-subtitle { font-size: ${p.subtitlePx}px !important; ${p.scoreTextFont ? `font-family: ${p.scoreTextFont} !important;` : ''} }
      .page-head--title > div[style*="absolute"] { font-size: ${p.creditPx}px !important; ${p.scoreTextFont ? `font-family: ${p.scoreTextFont} !important;` : ''} }
    `;
  }

  /**
   * rect で描かれる要素（小節線・グループ括弧）と、font-size 属性で描かれる
   * 手書きテキスト（パート名・小節番号・歌詞・強弱）はCSSで変えられないので、
   * 属性を直接書き換える。元の値は data-ab-* に退避して 'current' で戻せるようにする。
   */
  function applyAttributes(p) {
    document.querySelectorAll('.score-area svg').forEach((svg) => {
      // 小節線: 幅1（=0.1sp）の rect。中心をずらさないよう x も補正する
      svg.querySelectorAll('g.vf-stavebarline > rect, :scope > rect').forEach((r) => {
        const w0 = r.dataset.abW0 !== undefined ? parseFloat(r.dataset.abW0) : parseFloat(r.getAttribute('width'));
        const x0 = r.dataset.abX0 !== undefined ? parseFloat(r.dataset.abX0) : parseFloat(r.getAttribute('x'));
        if (!Number.isFinite(w0) || !Number.isFinite(x0) || w0 > 3) return; // 符頭の当たり判定など太い rect は対象外
        r.dataset.abW0 = String(w0);
        r.dataset.abX0 = String(x0);
        const w = p.thinBarline * UNITS_PER_SPACE;
        r.setAttribute('width', String(w));
        r.setAttribute('x', String(x0 - (w - w0) / 2));
      });
      // 手書きテキスト: font-family 属性を持つものだけが対象（音楽記号は属性を持たない）
      svg.querySelectorAll('text[font-family]').forEach((t) => {
        const fs0 = t.dataset.abFs0 !== undefined ? parseFloat(t.dataset.abFs0) : parseFloat(t.getAttribute('font-size'));
        if (!Number.isFinite(fs0)) return;
        t.dataset.abFs0 = String(fs0);
        const kind = classifyText(t, fs0);
        const target = p[kind];
        if (!target) return;
        // 現状値に対する比率で拡大する（フル名の自動縮小など、元の相対関係を保つため）
        const ratio = target / PRESETS.current[kind];
        t.setAttribute('font-size', String(fs0 * ratio));
      });
    });
  }

  /** テキストの種類を、描画側が使っている font-family / 位置から推定する */
  function classifyText(t, fs0) {
    const ff = t.getAttribute('font-family') || '';
    const style = t.getAttribute('font-style') || '';
    if (style === 'italic' && ff.includes('Times')) return 'dynamics';
    if (ff.startsWith('system-ui')) {
      // パート名は text-anchor="end"（五線の左）、小節番号は "start"
      return t.getAttribute('text-anchor') === 'end' ? 'instrumentLabel' : 'measureNumber';
    }
    if (ff === 'sans-serif' && fs0 <= 11) return 'lyrics';
    return null;
  }

  function restoreAttributes() {
    document.querySelectorAll('.score-area svg').forEach((svg) => {
      svg.querySelectorAll('[data-ab-w0]').forEach((r) => {
        r.setAttribute('width', r.dataset.abW0);
        r.setAttribute('x', r.dataset.abX0);
      });
      svg.querySelectorAll('[data-ab-fs0]').forEach((t) => {
        t.setAttribute('font-size', t.dataset.abFs0);
      });
    });
  }

  function ensureObserver() {
    if (observer) return;
    // 譜面はユーザー操作のたびに描き直されるため、変化を見て自動で再適用する
    observer = new MutationObserver(() => {
      if (currentMode === 'current' || currentMode === 'off') return;
      clearTimeout(ensureObserver._timer);
      ensureObserver._timer = setTimeout(() => applyAttributes(PRESETS[currentMode]), 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function engravingAB(mode) {
    if (mode === undefined) mode = currentMode;
    if (mode === 'off') mode = 'current';
    const preset = PRESETS[mode];
    if (!preset) {
      console.log('使い方: engravingAB("current" | "a" | "b")');
      return Object.keys(PRESETS).map((k) => `${k}: ${PRESETS[k].label}`);
    }
    currentMode = mode;
    document.getElementById(STYLE_ID)?.remove();
    restoreAttributes();
    if (mode !== 'current') {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = buildCss(preset);
      document.head.appendChild(style);
      applyAttributes(preset);
      ensureObserver();
    }
    console.log(`[engravingAB] ${preset.label} を適用しました`);
    return preset.label;
  }

  window.engravingAB = engravingAB;
  console.log('[engravingAB] 準備できました。engravingAB("a") / engravingAB("b") / engravingAB("current")');
})();
