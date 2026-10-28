/* ================================================================
   ClueForge — 设计令牌门禁  |  scripts/lint-tokens.mjs
   只守「地图工坊」样式段（从 MAP STUDIO 标题到文件末尾）：
   - 字号 / 圆角 / 间距 / 颜色 / 控件宽高必须是 var(--cf-*)；
   - 例外：0 / auto / 100% / 1fr / unitless line-height / em letter-spacing。
   退出码 1 = 有泄漏，build 会红。
   ================================================================ */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(root, 'ClueForge', 'style.css');
if (!existsSync(cssPath)) {
    console.error('✖ 找不到 ClueForge/style.css');
    process.exit(1);
}

const css = readFileSync(cssPath, 'utf8');
const marker = 'MAP STUDIO · 地图工坊';
const start = css.indexOf(marker);
if (start < 0) {
    console.error('✖ 找不到地图工坊样式段');
    process.exit(1);
}
const section = css.slice(start);

const PROPS = [
    'font-size', 'border-radius', 'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'gap', 'row-gap', 'column-gap', 'width', 'min-width', 'max-width', 'height',
    'min-height', 'max-height', 'color', 'background', 'background-color',
    'border-color', 'box-shadow', 'letter-spacing', 'line-height', 'outline',
    'outline-color', 'accent-color', 'opacity'
];
const propRe = new RegExp(
    `(?:^|[;{\\s])(${PROPS.map((p) => p.replace(/-/g, '\\-')).join('|')})\\s*:\\s*([^;{}]+);`,
    'gm'
);

const OK_RAW = /^(0|auto|inherit|initial|none|transparent|1fr|100%|[\d.]+(fr|%)?)$/;
const TOKEN = /var\(--(cf-|state-|bg-|text-|border|radius|gold|accent)[a-z0-9-]*\)/i;

const problems = [];
const lines = section.split(/\r?\n/);
let lineNo = css.slice(0, start).split(/\r?\n/).length;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    lineNo = css.slice(0, start).split(/\r?\n/).length + i;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) continue;

    let m;
    propRe.lastIndex = 0;
    while ((m = propRe.exec(line)) !== null) {
        const prop = m[1].toLowerCase();
        const value = m[2].trim();

        // 允许：line-height 无单位系数、letter-spacing em、bare 0/auto/100%
        if (prop === 'line-height' && /^[\d.]+$/.test(value)) continue;
        if (prop === 'letter-spacing' && /^-?[\d.]+em$/.test(value)) continue;
        if (prop === 'opacity' && /^[\d.]+$/.test(value)) continue;
        if (OK_RAW.test(value)) continue;
        if (TOKEN.test(value)) continue;

        problems.push({ line: lineNo, text: `${prop}: ${value}` });
    }

    // 裸 hex / rgb() 颜色
    if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\brgba?\(/.test(line)) {
        problems.push({ line: lineNo, text: `裸颜色：${trimmed.slice(0, 80)}` });
    }
}

if (problems.length) {
    console.error(`\n✖ 令牌泄漏 ${problems.length} 处（ClueForge/style.css，行为相对令牌段）\n`);
    for (const p of problems) console.error(`  L${p.line}: ${p.text}`);
    console.error('\n修法：值搬到 ClueForge/tokens.css 的 :root，组件里写 var(--cf-*)。\n');
    process.exit(1);
}
console.log('✔ 令牌门禁通过：地图工坊样式全部走 var(--cf-*)');
