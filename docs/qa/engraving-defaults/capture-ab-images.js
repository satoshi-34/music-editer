/*
 * A/B比較画像の書き出しスニペット（Issue #195 段1）
 *
 * 【これは何か】
 * 画面に出ている譜面を、そのままの見た目で PNG に書き出す道具です。
 * `ab-preview.js` で切り替えた「現状 / 候補A / 候補B」を、
 * **同じ箇所・同じ倍率**で並べた比較画像を作るために使います。
 *
 * 【使い方】
 *   1. アプリを開き、比較したい譜例を「読込」で開く
 *   2. コンソールに ab-preview.js を貼り付けて実行（切り替えの土台）
 *   3. 続けてこのファイルを貼り付けて実行
 *   4. コンソールで次を実行するとファイルがダウンロードされる
 *        await engravingShot('page.png')            … 1ページ目をそのまま PNG に
 *        await engravingCompare('compare.png')      … 現状/候補A/候補B を縦に並べた比較画像
 *
 * 【なぜ画面キャプチャではなくこの方法なのか】
 * 譜面は SVG で描かれているが、太さや文字の大きさの多くは CSS 側で決まっているため、
 * SVG をそのまま取り出しても見た目が再現できない。そこで
 *   - 描画中の要素の**計算後スタイル**を1つずつ属性へ焼き込む
 *   - 音楽記号のフォント（Bravura / Academico）を base64 で SVG の中へ埋め込む
 *     （アプリが実行時に読みに行くのと同じ jsDelivr の URL から取得する）
 * という手順を踏んで「単体で完結する SVG」を作り、canvas 経由で PNG にしている。
 * この方法だと人間が手で画面を撮るより位置ずれが起きず、A/B が厳密に同じ切り出しになる。
 *
 * 【注意】
 * - 保存データもアプリのコードも変更しない
 * - タイトル・作者欄などの HTML 側の文字は <text> として写し取っている。
 *   行の折り返し位置は実画面と同じだが、ベースラインはフォントサイズの 0.8 倍で近似している
 */
(function () {
  'use strict';

  const HOST = 'https://cdn.jsdelivr.net/npm/@vexflow-fonts/';
  const FONTS = { Bravura: 'bravura/bravura.woff2', Academico: 'academico/academico.woff2' };
  /** クローンへ焼き込む CSS プロパティ。太さ・色・書体まわりだけで足りる */
  const COPY = [
    'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'font-family', 'font-size', 'font-style', 'font-weight', 'opacity', 'visibility', 'display',
    'text-anchor', 'letter-spacing',
  ];
  const LABELS = {
    current: '現状の既定値',
    a: '候補A（Bravura engravingDefaults 準拠）',
    b: '候補B（Aより線を +0.02sp）',
  };

  let fontCssCache = null;

  /** 音楽フォントを base64 で埋め込む @font-face を作る（1回だけ取得してキャッシュ） */
  async function fontCss() {
    if (fontCssCache) return fontCssCache;
    const parts = [];
    for (const [family, path] of Object.entries(FONTS)) {
      const bytes = new Uint8Array(await (await fetch(HOST + path)).arrayBuffer());
      // 一度に String.fromCharCode へ渡すと引数が多すぎて落ちるので分割する
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      parts.push(`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");}`);
    }
    fontCssCache = parts.join('\n');
    return fontCssCache;
  }

  const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** style="..." の中に " が入ると属性が壊れるので ' に寄せる（font-family が該当する） */
  const singleQuote = (s) => s.replace(/"/g, "'");

  function inlineComputedStyles(original, clone) {
    const src = [original, ...original.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < src.length; i++) {
      const cs = getComputedStyle(src[i]);
      let decl = '';
      for (const prop of COPY) {
        const v = cs.getPropertyValue(prop);
        if (v) decl += `${prop}:${v};`;
      }
      dst[i].setAttribute('style', singleQuote(decl));
    }
  }

  /** 折り返した行を、1文字ずつの矩形を見て行単位へ分ける */
  function splitLines(node) {
    const text = node.nodeValue;
    const range = document.createRange();
    const lines = [];
    let prevTop = null;
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width > 0) {
        if (prevTop !== null && Math.abs(r.top - prevTop) > 1) {
          lines.push(cur);
          cur = '';
        }
        prevTop = r.top;
      }
      cur += text[i];
    }
    lines.push(cur);
    return lines.map((s) => s.trim());
  }

  /** タイトル・サブタイトル・作者欄・ページ番号（HTML 側の文字）を SVG の <text> へ写す */
  function htmlTextsToSvg(page, pageRect, scale) {
    const out = [];
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const trimmed = node.nodeValue.trim();
      if (!trimmed) continue;
      const el = node.parentElement;
      if (!el || el.closest('.score-area')) continue; // 譜面本体は SVG 側で拾う
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fontSize = parseFloat(cs.fontSize);
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      if (!rects.length) continue;
      const lines = rects.length === 1 ? [trimmed] : splitLines(node);
      rects.forEach((r, i) => {
        const txt = lines[i];
        if (!txt) return;
        const x = (r.left - pageRect.left) / scale;
        const y = (r.top - pageRect.top) / scale + fontSize * 0.8; // ベースラインの近似
        const style = singleQuote(
          `font-family:${cs.fontFamily};font-size:${fontSize}px;font-weight:${cs.fontWeight};` +
          `font-style:${cs.fontStyle};letter-spacing:${cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing};fill:${cs.color}`
        );
        out.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" style="${style}">${escapeXml(txt)}</text>`);
      });
    }
    return out.join('\n');
  }

  /** 1ページぶんを「ページ座標系（A4 = 794×1123 CSS px）」の単体 SVG として組み立てる */
  async function buildPageSvg(pageIndex) {
    const page = document.querySelectorAll('.print-page')[pageIndex || 0];
    if (!page) throw new Error('ページが見つかりません');
    const pageRect = page.getBoundingClientRect();
    const W = page.offsetWidth;
    const H = page.offsetHeight;
    // 画面表示のズーム倍率。矩形はズーム後の値なので、この倍率で割ってページ座標へ戻す
    const scale = pageRect.width / W;
    let body = `<rect x="0" y="0" width="${W}" height="${H}" fill="${getComputedStyle(page).backgroundColor}"/>`;
    page.querySelectorAll('.score-area svg').forEach((svg) => {
      const r = svg.getBoundingClientRect();
      const clone = svg.cloneNode(true);
      inlineComputedStyles(svg, clone);
      clone.setAttribute('x', ((r.left - pageRect.left) / scale).toFixed(2));
      clone.setAttribute('y', ((r.top - pageRect.top) / scale).toFixed(2));
      clone.setAttribute('width', (r.width / scale).toFixed(2));
      clone.setAttribute('height', (r.height / scale).toFixed(2));
      clone.setAttribute('overflow', 'visible'); // 加線や符尾がレイアウト枠からはみ出すため
      body += new XMLSerializer().serializeToString(clone);
    });
    body += htmlTextsToSvg(page, pageRect, scale);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><style type="text/css">${await fontCss()}</style></defs>${body}</svg>`;
  }

  /** 切り出したい矩形（ページ座標）を求める。system は .score-area svg の何番目か */
  function cropBox(pageIndex, systemIndex, padTop, padBottom, padX) {
    const page = document.querySelectorAll('.print-page')[pageIndex || 0];
    const pageRect = page.getBoundingClientRect();
    const scale = pageRect.width / page.offsetWidth;
    const r = page.querySelectorAll('.score-area svg')[systemIndex || 0].getBoundingClientRect();
    return {
      x: (r.left - pageRect.left) / scale - padX,
      y: (r.top - pageRect.top) / scale - padTop,
      w: r.width / scale + padX * 2,
      h: r.height / scale + padTop + padBottom,
    };
  }

  /** ページ座標で組んであるので、root の viewBox を差し替えるだけで同じ縮尺の切り出しになる */
  function applyCrop(svgText, box, zoom) {
    return svgText.replace(
      /^<svg ([^>]*?)width="[^"]*" height="[^"]*" viewBox="[^"]*"/,
      `<svg $1width="${(box.w * zoom).toFixed(0)}" height="${(box.h * zoom).toFixed(0)}" viewBox="${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.w.toFixed(2)} ${box.h.toFixed(2)}"`
    );
  }

  function svgToImage(svgText) {
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
    const img = new Image();
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('SVG の読み込みに失敗しました'));
      img.src = url;
    });
  }

  function download(canvas, name) {
    const a = document.createElement('a');
    a.download = name;
    a.href = canvas.toDataURL('image/png');
    a.click();
    return { name, px: `${canvas.width}x${canvas.height}` };
  }

  /** 1ページをそのまま PNG に */
  async function engravingShot(name, pageIndex, zoom) {
    const img = await svgToImage(await buildPageSvg(pageIndex));
    const z = zoom || 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * z);
    cv.height = Math.round(img.height * z);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return download(cv, name || 'score.png');
  }

  /**
   * 現状 / 候補A / 候補B を、同じ箇所・同じ倍率で縦に並べた比較画像を作る。
   * ab-preview.js を先に読み込んでおくこと（engravingAB が必要）。
   */
  async function engravingCompare(name, opts) {
    if (typeof window.engravingAB !== 'function') {
      throw new Error('先に ab-preview.js を読み込んでください');
    }
    const o = Object.assign(
      { pageIndex: 0, systemIndex: 0, zoom: 2, padTop: 14, padBottom: 20, padX: 14 },
      opts || {}
    );
    // 切り出し範囲は最初に1回だけ決める（3案で同じ箇所を見るため）
    const box = cropBox(o.pageIndex, o.systemIndex, o.padTop, o.padBottom, o.padX);
    const shots = [];
    for (const mode of ['current', 'a', 'b']) {
      window.engravingAB(mode);
      await new Promise((r) => setTimeout(r, 450)); // 再描画と MutationObserver の再適用を待つ
      shots.push({ mode, img: await svgToImage(applyCrop(await buildPageSvg(o.pageIndex), box, o.zoom)) });
    }
    window.engravingAB('current');

    const BAND = 46; // 見出し帯の高さ
    const GAP = 14;
    const PAD = 16;
    const iw = shots[0].img.width;
    const ih = shots[0].img.height;
    const cv = document.createElement('canvas');
    cv.width = iw + PAD * 2;
    cv.height = PAD * 2 + shots.length * (BAND + ih) + (shots.length - 1) * GAP;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    let y = PAD;
    for (const { mode, img } of shots) {
      ctx.fillStyle = '#111111';
      ctx.font = '600 30px "Hiragino Kaku Gothic ProN", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(LABELS[mode], PAD, y + BAND / 2);
      y += BAND;
      ctx.drawImage(img, PAD, y);
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD + 0.5, y + 0.5, iw - 1, ih - 1);
      y += ih + GAP;
    }
    return download(cv, name || 'compare.png');
  }

  window.engravingShot = engravingShot;
  window.engravingCompare = engravingCompare;
  console.log('[engravingCapture] 準備できました。await engravingShot("page.png") / await engravingCompare("compare.png")');
})();
