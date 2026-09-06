// 指定した行範囲（例: 符頭クリックのハンドラ本体）が、その外側で宣言された識別子を
// いくつ参照しているかを TypeScript の AST で列挙する（#695 段6b の「自由変数」計測）。
// 使い方: node scratchpad/free-ids.cjs src/components/PianoSystemCanvas.tsx <開始行> <終了行>
// 出力: 名前 / 宣言の場所（component-local = コンポーネント関数内のローカル、module = モジュール
// スコープ、import = 他ファイル）/ 参照回数。JSON でも出す（--json）。
const ts = require('typescript');
const fs = require('fs');
const [,, file, startLine, endLine, flag0] = process.argv;
const flag = (endLine && endLine.startsWith('--')) ? endLine : flag0;
const src = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
let start = Number(startLine), end = Number(endLine);
if (!endLine || endLine.startsWith('--')) {
  // 終了行が無ければ、開始行にある addEventListener の第2引数（アロー関数）の終端を使う
  let found = null;
  const seek = (n) => {
    if (!found && lineOf(n.getStart(sf)) === start && ts.isCallExpression(n) && n.arguments.length >= 2 &&
        (ts.isArrowFunction(n.arguments[1]) || ts.isFunctionExpression(n.arguments[1]))) {
      found = n.arguments[1];
    }
    if (!found) ts.forEachChild(n, seek);
  };
  seek(sf);
  if (!found) { console.error('handler not found at line', start); process.exit(1); }
  start = lineOf(found.getStart(sf)); end = lineOf(found.getEnd());
}

// 範囲内で宣言された名前（ローカル）を集める
const declaredInside = new Set();
const visitDecl = (n) => {
  if (lineOf(n.getStart(sf)) >= start && lineOf(n.getEnd()) <= end) {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isBindingElement(n)) && n.name) {
      if (ts.isIdentifier(n.name)) declaredInside.add(n.name.text);
    }
  }
  ts.forEachChild(n, visitDecl);
};
visitDecl(sf);

// モジュールスコープ / import の名前
const moduleNames = new Map();
for (const st of sf.statements) {
  if (ts.isImportDeclaration(st) && st.importClause) {
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) nb.elements.forEach(e => moduleNames.set(e.name.text, 'import'));
    if (st.importClause.name) moduleNames.set(st.importClause.name.text, 'import');
  } else if (ts.isVariableStatement(st)) {
    st.declarationList.declarations.forEach(d => { if (ts.isIdentifier(d.name)) moduleNames.set(d.name.text, 'module'); });
  } else if ((ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name) {
    moduleNames.set(st.name.text, 'module');
  }
}

const refs = new Map();
const visit = (n) => {
  if (ts.isIdentifier(n)) {
    const l = lineOf(n.getStart(sf));
    if (l >= start && l <= end) {
      const p = n.parent;
      const isPropName = (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) || (ts.isPropertySignature(p) && p.name === n) ||
        (ts.isBindingElement(p) && p.propertyName === n) || ts.isJsxAttribute(p) ||
        (ts.isShorthandPropertyAssignment(p) && false);
      const isDeclName = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === n;
      if (!isPropName && !isDeclName && !declaredInside.has(n.text)) {
        refs.set(n.text, (refs.get(n.text) || 0) + 1);
      }
    }
  }
  ts.forEachChild(n, visit);
};
visit(sf);

const globals = new Set(['Math','Number','String','Array','Map','Set','Object','JSON','console','window','document','Date','Error','undefined','NaN','Infinity','Boolean','Promise','parseInt','parseFloat','isNaN','Symbol','requestAnimationFrame','setTimeout','clearTimeout','Element','SVGElement','SVGSVGElement','SVGGElement','MouseEvent','HTMLElement','Event','KeyboardEvent','PointerEvent','structuredClone','performance','navigator','Reflect','Intl','globalThis','TypeError','RangeError','Node','Text']);
const rows = [...refs.entries()].filter(([k]) => !globals.has(k))
  .map(([name, count]) => ({ name, kind: moduleNames.get(name) || 'component-local', count }))
  .sort((a, b) => a.kind.localeCompare(b.kind) || b.count - a.count);
if (flag === '--json') { console.log(JSON.stringify(rows, null, 1)); }
else {
  const byKind = {};
  rows.forEach(r => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
  console.log(`range ${start}-${end}: free identifiers ${rows.length}`, byKind);
  rows.forEach(r => console.log(`${r.kind.padEnd(16)} ${String(r.count).padStart(4)}  ${r.name}`));
}
