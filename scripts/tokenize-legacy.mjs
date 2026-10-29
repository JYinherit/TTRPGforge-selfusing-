/**
 * 一次性迁移：把 ClueForge/style.css 里高频硬编码颜色收口为令牌。
 * - 默认令牌值 = 原字面量 → 不换肤时视觉零漂移
 * - 换肤时由 skins/*.css 用 color-mix 重算同系列 tints
 * 幂等：已迁移过的字面量不再出现，重复运行是 no-op。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const stylePath = path.join(root, 'ClueForge', 'style.css');
const tokenPath = path.join(root, 'ClueForge', 'tokens.css');

const GOLD = [201, 168, 76];
const ACCENT = [184, 50, 50];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/** [literal, token] */
const rules = [];
const add = (literal, token) => rules.push([literal, token]);

// 金色系列
for (const a of [0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6]) {
    add(`rgba(${GOLD.join(', ')}, ${a})`, `var(--cf-gold-${Math.round(a * 100)})`);
}
// 强调红系列
for (const a of [0.12, 0.18, 0.2, 0.25, 0.3, 0.35, 0.45, 0.5, 0.6]) {
    add(`rgba(${ACCENT.join(', ')}, ${a})`, `var(--cf-accent-${Math.round(a * 100)})`);
}
// 白色覆层（分层阴影 / 玻璃）
for (const a of [0.012, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.22]) {
    add(`rgba(${WHITE.join(', ')}, ${a})`, `var(--cf-w-${Math.round(a * 1000)})`);
}
// 黑色压暗
for (const a of [0.03, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6]) {
    add(`rgba(${BLACK.join(', ')}, ${a})`, `var(--cf-b-${Math.round(a * 100)})`);
}
// 裸色
add('#c9a84c', 'var(--gold)');
add('#e8d8b0', 'var(--cf-cream)');
add('#8b7740', 'var(--cf-brass-dim)');
add('#50c8ff', 'var(--cf-link)');
add('#0d0d1a', 'var(--bg-deep)');
add('#e8e0d0', 'var(--cf-text-strong)');

let css = readFileSync(stylePath, 'utf8');
let replaced = 0;
for (const [literal, token] of rules) {
    if (!css.includes(literal)) continue;
    const count = css.split(literal).length - 1;
    css = css.split(literal).join(token);
    replaced += count;
    console.log(`  ${literal.padEnd(28)} → ${token.padEnd(22)} ×${count}`);
}

const tokenDefs = [];
const seen = new Set();
for (const [literal, token] of rules) {
    if (!token.startsWith('var(--cf-')) continue;
    const name = token.slice(4, -1);
    if (seen.has(name)) continue;
    seen.add(name);
    tokenDefs.push(`    ${name}: ${literal};`);
}
if (tokenDefs.length) {
    let tokens = readFileSync(tokenPath, 'utf8');
    const marker = '    /* —— 兼容别名 —— */';
    if (!tokens.includes('/* —— 兼容别名 —— */')) throw new Error('tokens.css 缺少兼容别名锚点');
    if (!tokens.includes('/* —— 老样式字面量（迁移自 style.css） —— */')) {
        tokens = tokens.replace(marker, `    /* —— 老样式字面量（迁移自 style.css） —— */\n${tokenDefs.join('\n')}\n\n${marker}`);
    }
    writeFileSync(tokenPath, tokens, 'utf8');
    console.log(`tokens.css 新增 ${tokenDefs.length} 条`);
}

writeFileSync(stylePath, css, 'utf8');
console.log(`style.css 替换 ${replaced} 处`);

