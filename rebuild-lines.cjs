// 重建 collect.ts 的换行：按语法边界断行
const fs = require('fs');
const path = 'F:/astock-src/src/lib/collector/collect.ts';
let text = fs.readFileSync(path, 'utf8');
// 去掉 BOM
if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

// 在这些模式后断行（保守策略，只断明确的语句边界）
const rules = [
  [/;/g, ';\n'],                                    // 分号后
  [/\{/g, '{\n'],                                   // 开括号后
  [/\}/g, '\n}\n'],                                 // 闭括号前后
  [/\/\/[^\n]*/g, m => m],                          // 注释保持
];

// 简单方案：分号、{、} 后断行，但跳过字符串/模板字面量/注释内部
// 逐字符扫描，跟踪状态
let out = '';
let inStr = null; // ', ", `
let inLineComment = false;
let inBlockComment = false;
let prev = '';
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  const next = text[i + 1];
  if (inLineComment) {
    out += c;
    if (c === '\n') inLineComment = false;
    continue;
  }
  if (inBlockComment) {
    out += c;
    if (c === '*' && next === '/') { out += next; i++; inBlockComment = false; }
    continue;
  }
  if (inStr) {
    out += c;
    if (c === '\\') { out += next; i++; continue; }
    if (c === inStr) inStr = null;
    continue;
  }
  if (c === '/' && next === '/') { inLineComment = true; out += c; continue; }
  if (c === '/' && next === '*') { inBlockComment = true; out += c; continue; }
  if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; continue; }
  // 语句边界断行
  if (c === ';') { out += ';\n'; prev = c; continue; }
  if (c === '{') { out += '{\n'; prev = c; continue; }
  if (c === '}') { out += '\n}\n'; prev = c; continue; }
  out += c;
  prev = c;
}

fs.writeFileSync(path, out, 'utf8');
console.log('重建完成，新行数:', out.split('\n').length);
