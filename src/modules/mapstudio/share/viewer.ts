/* ================================================================
   ClueForge — 分享页只读查看器 | share/viewer.ts
   单独一次 esbuild 打包（IIFE，无 import/无 fetch），由 build-viewer.mjs
   内联进导出的单文件 HTML。file:// 双击即用，零网络请求。
   ================================================================ */
import type { MapDoc } from '../types';
import { renderMap, type ShareView } from './render';

const FONT_STACK = 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif';

function qs<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error('missing #' + id);
    return el as T;
}

function showError(msg: string): void {
    const box = document.getElementById('cf-share-error');
    if (box) {
        box.textContent = msg;
        box.style.display = 'block';
    }
    const canvas = document.getElementById('cf-share-canvas');
    if (canvas) canvas.style.display = 'none';
}

function readDoc(): MapDoc {
    const node = document.getElementById('cf-doc');
    if (!node || !node.textContent) throw new Error('文档为空');
    const parsed = JSON.parse(node.textContent) as Partial<MapDoc>;
    if (!parsed || parsed.version !== 1) throw new Error('地图版本不支持（需要 version: 1）');
    if (!parsed.size || !parsed.grid) throw new Error('地图结构不完整');
    return {
        version: 1,
        name: typeof parsed.name === 'string' ? parsed.name : '分享的地图',
        grid: parsed.grid,
        size: parsed.size,
        rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
        walls: Array.isArray(parsed.walls) ? parsed.walls : [],
        doors: Array.isArray(parsed.doors) ? parsed.doors : [],
        corridors: Array.isArray(parsed.corridors) ? parsed.corridors : [],
        markers: Array.isArray(parsed.markers) ? parsed.markers : [],
        assets: Array.isArray(parsed.assets) ? parsed.assets : [],
        background: typeof parsed.background === 'string' ? parsed.background : null,
        backgroundRepeat: !!parsed.backgroundRepeat,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
    } as MapDoc;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = src;
    });
}

async function boot(): Promise<void> {
    const doc = readDoc();
    const canvas = qs<HTMLCanvasElement>('cf-share-canvas');
    const stage = qs<HTMLDivElement>('cf-share-stage');
    const title = document.getElementById('cf-share-title');
    if (title) title.textContent = doc.name || '分享的地图';

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 Canvas 2D');

    const images = new Map<string, HTMLImageElement>();
    const jobs: Promise<void>[] = [];
    for (const a of doc.assets || []) {
        jobs.push(loadImage(a.dataUrl).then((img) => void images.set(a.id, img)).catch(() => undefined));
    }
    if (doc.background && doc.background.startsWith('data:image/')) {
        jobs.push(loadImage(doc.background).then((img) => void images.set(doc.background as string, img)).catch(() => undefined));
    }
    await Promise.all(jobs);

    const view: ShareView = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true, dpr: Math.min(window.devicePixelRatio || 1, 3) };
    let fitted = 0;

    const resize = (): void => {
        const w = Math.max(1, Math.round(stage.clientWidth));
        const h = Math.max(1, Math.round(stage.clientHeight));
        canvas.width = Math.round(w * view.dpr);
        canvas.height = Math.round(h * view.dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        if (!fitted) {
            fit();
            fitted = 1;
        }
        draw();
    };

    const fit = (): void => {
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        const z = Math.min(w / doc.size.width, h / doc.size.height, 4);
        view.zoom = z > 0 ? z : 1;
        view.offsetX = (w - doc.size.width * view.zoom) / 2;
        view.offsetY = (h - doc.size.height * view.zoom) / 2;
    };

    const draw = (): void => {
        renderMap(ctx, doc, view, (key) => images.get(key));
    };

    stage.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.max(0.05, Math.min(8, view.zoom * factor));
        const k = next / view.zoom;
        view.offsetX = mx - (mx - view.offsetX) * k;
        view.offsetY = my - (my - view.offsetY) * k;
        view.zoom = next;
        draw();
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    stage.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
        stage.classList.add('dragging');
        stage.setPointerCapture(ev.pointerId);
    });
    stage.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        view.offsetX += ev.clientX - lastX;
        view.offsetY += ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        draw();
    });
    const endDrag = (): void => {
        dragging = false;
        stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('dblclick', () => {
        fit();
        draw();
    });

    const gridBtn = document.getElementById('cf-share-grid');
    if (gridBtn) {
        gridBtn.addEventListener('click', () => {
            view.showGrid = !view.showGrid;
            gridBtn.classList.toggle('on', view.showGrid);
            draw();
        });
    }
    const fitBtn = document.getElementById('cf-share-fit');
    if (fitBtn) {
        fitBtn.addEventListener('click', () => {
            fit();
            draw();
        });
    }

    window.addEventListener('resize', resize);
    resize();
    document.body.classList.add('ready');
    const flag = window as unknown as { __cfViewerReady?: boolean };
    flag.__cfViewerReady = true;
    void FONT_STACK;
}

try {
    void boot().catch((err: unknown) => {
        showError('这份分享地图打不开：' + (err instanceof Error ? err.message : String(err)));
    });
} catch (err) {
    showError('这份分享地图打不开：' + (err instanceof Error ? err.message : String(err)));
}

