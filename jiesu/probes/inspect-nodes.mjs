/**
 * 探针：确认 babel 节点的 start/end 字符区间与原始文本的对应关系。
 * 这是"AST 定位 + 源码精确替换"方案的前提。
 */
import { parse } from '@babel/parser';

const code = `export function A() {
  return (
    <div className="p-4 text-white" style={{ padding: '16px' }}>
      <span className={\`px-3 \${x ? 'a' : 'b'}\`}>hello</span>
    </div>
  );
}
`;

const ast = parse(code, {
  sourceType: 'unambiguous',
  plugins: ['typescript', 'jsx'],
});

const seen = new Set();

function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(visit);
    return;
  }
  const t = node.type;
  if (
    ['StringLiteral', 'TemplateElement', 'JSXText', 'JSXAttribute', 'TemplateLiteral'].includes(t)
  ) {
    const key = `${t}:${node.start}:${node.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      const slice = code.slice(node.start, node.end);
      console.log(
        `${t.padEnd(16)} [${node.start},${node.end}] slice=${JSON.stringify(slice)}` +
          (node.extra ? ` extra.raw=${JSON.stringify(node.extra.raw)}` : '') +
          (t === 'TemplateElement'
            ? ` value.raw=${JSON.stringify(node.value.raw)} cooked=${JSON.stringify(node.value.cooked)}`
            : ''),
      );
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'extra' || key === 'leadingComments' || key === 'trailingComments') continue;
    const child = node[key];
    if (child && typeof child === 'object') visit(child);
  }
}

visit(ast);
