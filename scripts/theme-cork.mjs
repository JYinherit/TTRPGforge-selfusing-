/**
 * 线索墙板面主题化：板底色收口为 --cf-cork* 令牌，换肤时由 skins/*.css 覆盖。
 * 幂等：已存在令牌/规则则跳过。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cf = path.join(root, 'ClueForge');

const defaults = {
    '--cf-cork': '#b5874e',
    '--cf-cork-noir': '#1a1610',
    '--cf-cork-chinese': '#2c1e12',
    '--cf-cork-federal': '#e8e4de'
};

let tokens = readFileSync(path.join(cf, 'tokens.css'), 'utf8');
if (!tokens.includes('--cf-cork:')) {
    const anchor = '    /* —— 兼容别名 —— */';
    const defs = Object.entries(defaults).map(([k, v]) => `    ${k}: ${v};`).join('\n');
    tokens = tokens.replace(anchor, `    /* —— 线索墙板面 —— */\n${defs}\n\n${anchor}`);
    writeFileSync(path.join(cf, 'tokens.css'), tokens, 'utf8');
    console.log('tokens.css 增补线索墙板面令牌');
}

let skinCss = readFileSync(path.join(cf, 'skin.css'), 'utf8');
if (!skinCss.includes('cb-theme-cork')) {
    skinCss += `
/* 线索墙四种板面：只用令牌换底色，纹理保持不变 */
[data-cf-skin] .cb-theme-cork { background-color: var(--cf-cork); }
[data-cf-skin] .cb-theme-noir { background-color: var(--cf-cork-noir); }
[data-cf-skin] .cb-theme-chinese { background-color: var(--cf-cork-chinese); }
[data-cf-skin] .cb-theme-federal { background-color: var(--cf-cork-federal); }
`;
    writeFileSync(path.join(cf, 'skin.css'), skinCss, 'utf8');
    console.log('skin.css 增补板面规则');
}

const perSkin = {
    'vermilion.css': { cork: '#8a6438', noir: '#171310', chinese: '#3a2412', federal: '#ded6c6' },
    'ritual.css': { cork: '#6b5334', noir: '#171410', chinese: '#2a1b10', federal: '#d8cfbe' },
    'coldlight.css': { cork: '#2c3a46', noir: '#0b1016', chinese: '#1a2430', federal: '#c9d4de' }
};

for (const [name, v] of Object.entries(perSkin)) {
    const p = path.join(cf, 'skins', name);
    let css = readFileSync(p, 'utf8');
    if (css.includes('--cf-cork:')) continue;
    const block = `    --cf-cork: ${v.cork};\n    --cf-cork-noir: ${v.noir};\n    --cf-cork-chinese: ${v.chinese};\n    --cf-cork-federal: ${v.federal};\n`;
    css = css.replace('    --cf-cream:', block + '    --cf-cream:');
    writeFileSync(p, css, 'utf8');
    console.log(`${name} 板面已覆盖`);
}
