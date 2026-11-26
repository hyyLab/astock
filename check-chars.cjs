// 检查 collect.ts 一行流里换行去哪了：是不是被替换成了别的字符
const fs = require('fs');
const t = fs.readFileSync('F:/astock-src/src/lib/collector/collect.ts', 'utf8');
// 找所有控制字符
const ctrl = {};
for (const ch of t) {
  const code = ch.codePointAt(0);
  if (code < 32 || code === 127) {
    ctrl[code] = (ctrl[code] || 0) + 1;
  }
}
console.log('控制字符统计:', JSON.stringify(ctrl));
console.log('总长:', t.length);
// 看看原来注释里的换行位置现在是什么
const idx = t.indexOf('preWindowDays');
console.log('preWindowDays 前 80 字符:', JSON.stringify(t.slice(Math.max(0, idx - 80), idx + 20)));
