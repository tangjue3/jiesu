import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

const code = readFileSync(
  new URL('../fixtures/original/f1-static-classname.tsx', import.meta.url),
  'utf8',
);
const ast = parse(code, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });

const hits = [];
const visit = (node, parent) => {
  if (!node || typeof node !== 'object') return;
  const n = node;
  let nextParent = parent;
  if (n.type === 'JSXElement') {
    nextParent = n;
    if (n.openingElement?.loc?.start) hits.push(n.openingElement);
  }
  for (const key of Object.keys(n)) {
    if (key === 'loc') continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => visit(c, nextParent));
    else if (child && typeof child === 'object') visit(child, nextParent);
  }
};
visit(ast, null);

console.log('命中 JSX 元素数:', hits.length);
for (const el of hits) {
  const attrs = el.attributes.map((a) => ({
    type: a.type,
    nameType: a.name?.type,
    name: a.name?.name,
    valueType: a.value?.type,
    value: a.value?.value,
  }));
  console.log(el.loc.start.line, JSON.stringify(attrs));
}
