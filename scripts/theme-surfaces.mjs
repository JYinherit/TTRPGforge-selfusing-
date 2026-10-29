/**
 * 表面/强调色收口：把“面板底色 + 强调色叠加”两类字面量搬进令牌，
 * 并给三套皮肤补上基于 --bg-deep / --accent 的重算覆盖。幂等可重复执行。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cf = path.join(root, 'ClueForge');

const PANEL = { 40: 0.4, 60: 0.6, 70: 0.7, 92: 0.92, 95: 0.95 };
const ACCENT = { 12: 0.12, 18: 0.18, 20: 0.2, 25: 0.25, 30: 0.3, 35: 0.35, 45: 0.45, 50: 0.5, 60: 0.6 };

const stylePath = path.join(cf, 'style.css');
const tokenPath = path.join(cf, 'tokens.css');

let style = readFileSync(stylePath, 'utf8');
let styleHits = 0;
for (const [k, a] of Object.entries(PANEL)) {
    const literal = `rgba(18, 18, 35, ${a})`;
    const n = style.split(literal).length - 1;
    if (n) { style = style.split(literal).join(`var(--cf-panel-${k})`); styleHits += n; }
}
for (const [k, a] of Object.entries(ACCENT)) {
    const literal = `rgba(184, 50, 50, ${a})`;
    const n = style.split(literal).length - 1;
    if (n) { style = style.split(literal).join(`var(--cf-accent-${k})`); styleHits += n; }
}
writeFileSync(stylePath, style, 'utf8');

const defs = [
    ...Object.entries(PANEL).map(([k, a]) => `    --cf-panel-${k}: rgba(18, 18, 35, ${a});`),
    ...Object.entries(ACCENT).map(([k, a]) => `    --cf-accent-${k}: rgba(184, 50, 50, ${a});`),
    '    --cf-accent-soft: rgba(184, 50, 50, 0.18);',
    '    --cf-accent-line: rgba(184, 50, 50, 0.45);',
    '    --cf-accent-glow: rgba(184, 50, 50, 0.2);',
    '    --cf-accent-text: #e05050;'
].filter((line) => !readFileSync(tokenPath, 'utf8').includes(line.trim().split(':')[0] + ':'));

let tokens = readFileSync(tokenPath, 'utf8');
if (defs.length) {
    const anchor = '    /* —— 兼容别名 —— */';
    tokens = tokens.replace(anchor, `${defs.join('\n')}\n\n${anchor}`);
    writeFileSync(tokenPath, tokens, 'utf8');
}

const skinOverrides = `
    /* —— 表面/强调色：按主题重算（theme-surfaces.mjs 维护） —— */
    --cf-panel-40: color-mix(in srgb, var(--bg-deep) 40%, transparent);
    --cf-panel-60: color-mix(in srgb, var(--bg-deep) 60%, transparent);
    --cf-panel-70: color-mix(in srgb, var(--bg-deep) 72%, transparent);
    --cf-panel-92: color-mix(in srgb, var(--bg-deep) 94%, transparent);
    --cf-panel-95: color-mix(in srgb, var(--bg-deep) 96%, transparent);
    --cf-accent-soft: color-mix(in srgb, var(--accent) 18%, transparent);
    --cf-accent-line: color-mix(in srgb, var(--accent) 52%, transparent);
    --cf-accent-glow: color-mix(in srgb, var(--accent) 24%, transparent);
    --cf-accent-text: color-mix(in srgb, var(--accent) 64%, #fff);
`;

const skinDir = path.join(cf, 'skins');
for (const name of readdirSync(skinDir)) {
    if (!name.endsWith('.css')) continue;
    const p = path.join(skinDir, name);
    let css = readFileSync(p, 'utf8');
    if (css.includes('theme-surfaces.mjs')) continue;
    const idx = css.lastIndexOf('}');
    css = css.slice(0, idx) + skinOverrides + '}\n' + css.slice(idx + 1);
    writeFileSync(p, css, 'utf8');
    console.log(`  ${name} 覆盖已补`);
}
console.log(`style.css 替换 ${styleHits} 处；tokens.css 新增 ${defs.length} 条`);
