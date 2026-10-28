/* ================================================================
   ClueForge — 本地预览  |  scripts/serve.mjs
   无依赖静态服务器：npm run serve -- --port 5173
   只是方便调试；dist/index.html 本身双击也能跑（file:// 无任何 fetch）。
   ================================================================ */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const argPort = process.argv.indexOf('--port');
const port = argPort > -1 ? Number(process.argv[argPort + 1]) : 5173;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        let filePath = path.join(root, decodeURIComponent(url.pathname));
        if (!filePath.startsWith(root)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        const st = await stat(filePath).catch(() => null);
        if (!st || st.isDirectory()) filePath = path.join(filePath, 'index.html');
        const body = await readFile(filePath);
        res.writeHead(200, {
            'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-store'
        });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

server.listen(port, '127.0.0.1', () => {
    console.log(`ClueForge 预览 · http://127.0.0.1:${port}/  (根目录 dist/)`);
});
