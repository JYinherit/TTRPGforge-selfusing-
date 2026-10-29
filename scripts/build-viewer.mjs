/* ================================================================
   ClueForge — 只读查看器打包 | scripts/build-viewer.mjs
   把 src/modules/mapstudio/share/viewer.ts 打成 IIFE，内联为字符串常量
   （src/modules/mapstudio/share/viewer-bundle.ts），随主 bundle 一起分发。
   为什么单独打：查看器不需要 fabric，体积差两个数量级；内联字符串保证 file:// 单文件可用。
   ================================================================ */
import { build } from 'esbuild';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src', 'modules', 'mapstudio', 'share', 'viewer.ts');
const outFile = path.join(root, 'src', 'modules', 'mapstudio', 'share', 'viewer-bundle.ts');

if (!existsSync(entry)) {
    console.error(`✖ 找不到查看器入口：${entry}`);
    process.exit(1);
}

const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: ['es2019'],
    minify: true,
    write: false,
    legalComments: 'none',
    banner: { js: '/* cf-viewer-v1 */' },
    logLevel: 'error'
});

const code = result.outputFiles && result.outputFiles[0] ? result.outputFiles[0].text : '';
if (!code || !code.includes('cf-viewer-v1')) {
    console.error('✖ 查看器产物为空或缺少哨兵');
    process.exit(1);
}

const escaped = JSON.stringify(code)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const ts = `/* 由 scripts/build-viewer.mjs 生成，勿手改。提交时此处为 stub，构建时覆盖。 */
export const VIEWER_JS: string = ${escaped};
`;

writeFileSync(outFile, ts, 'utf8');
const kb = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);
console.log(`✔ 查看器已内联 · ${kb} KB`);
