/* ================================================================
   ClueForge — 构建  |  scripts/build.mjs
   1) vite build  → dist/clueforge-studio.js（fabric/rough/marked + 地图工坊）
   2) 把 ClueForge/ 整目录拷进 dist（老模块保持经典 <script>，一行不改）
   产物可 file:// 直接双击打开，无任何网络请求。
   ================================================================ */
import { rmSync, mkdirSync, copyFileSync, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const legacyDir = path.join(root, 'ClueForge');

function fail(msg) {
    console.error(`\n✖ ${msg}\n`);
    process.exit(1);
}

if (!existsSync(legacyDir)) fail('找不到 ClueForge/ 目录');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteBin)) fail('找不到 vite，请先运行 npm install');

console.log('▸ 令牌门禁 …');
const lint = spawnSync(process.execPath, [path.join(root, 'scripts', 'lint-tokens.mjs')], { cwd: root, stdio: 'inherit' });
if (lint.status !== 0) fail('设计令牌泄漏，构建中止');

console.log('▸ 打包只读查看器（分享 HTML 用）…');
const viewerBuild = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-viewer.mjs')], { cwd: root, stdio: 'inherit' });
if (viewerBuild.status !== 0) fail('查看器打包失败');

console.log('▸ 清理 dist …');
rmSync(dist, { recursive: true, force: true });

console.log('▸ 打包 fabric / rough / marked + 地图工坊 …');
const r = spawnSync(process.execPath, [viteBin, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
});
if (r.status !== 0) fail('vite build 失败');

console.log('▸ 拷入老应用（HTML / CSS / 老模块 / 资源）…');
// 注意：不能用 fs.cpSync —— Node 22 在 D:\团 这类非 ASCII 路径上会 fail-fast 崩溃（0xC0000409），
// 这里手写递归拷贝，逐文件 copyFileSync，稳定。
function copyDir(src, dst) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else if (entry.isFile()) copyFileSync(s, d);
    }
}
copyDir(legacyDir, dist);

// 自检：入口文件必须存在
const required = [
    'index.html', 'clueforge-studio.js', 'tokens.css', 'style.css', 'app.js', 'project.js', 'ui.js', 'map.js',
    // 皮肤系统：主题包是"可选",但漏拷会变成静默失败（构建绿、双击版缺功能）
    'skin.css', 'skins/registry.js', 'skins/vermilion.css', 'skins/ritual.css', 'skins/coldlight.css'
];
const missing = required.filter((f) => !existsSync(path.join(dist, f)));
if (missing.length) fail(`产物缺文件：${missing.join(', ')}`);

// 皮肤包门禁：只允许 --* 自定义属性 + color-scheme，禁止选择器规则（否则会腐化成第二套 style.css）
console.log('▸ 皮肤包门禁 …');
const skinDir = path.join(root, 'ClueForge', 'skins');
for (const name of readdirSync(skinDir)) {
    if (!name.endsWith('.css')) continue;
    const raw = readFileSafe(path.join(skinDir, name));
    const body = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const line of body.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t === '}' || /^\[data-cf-skin="[a-z0-9-]{1,24}"\]\s*\{$/.test(t)) continue;
        if (t.startsWith('--') || t === 'color-scheme: dark;' || t === 'color-scheme: light;') continue;
        fail(`皮肤包 ${name} 出现非令牌声明：${t}`);
    }
}

const idx = readFileSafe(path.join(dist, 'index.html'));
if (!idx.includes('clueforge-studio.js')) fail('dist/index.html 没有引用 clueforge-studio.js');
if (idx.includes('cdn.jsdelivr.net')) fail('dist/index.html 仍存在 CDN 引用，离线会挂');
if (!idx.includes('tokens.css')) fail('dist/index.html 没有先引入 tokens.css，令牌会失效');

function readFileSafe(p) {
    try {
        return readFileSync(p, 'utf8');
    } catch {
        return '';
    }
}

function dirSize(dir) {
    let total = 0;
    for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = statSync(p);
        total += st.isDirectory() ? dirSize(p) : st.size;
    }
    return total;
}

const mb = (dirSize(dist) / 1048576).toFixed(2);
console.log(`\n✔ 构建完成 · dist/ · ${mb} MB`);
console.log('  双击 dist/index.html 即可离线运行；或 npm run serve 起本地预览。');



