/* ================================================================
   ClueForge — 分享 HTML 生成 | share/build.ts
   产物：一个自包含 .html（内联 JSON + 内联只读渲染器），file:// 双击即用，零网络请求。
   口径：玩家版不含 KP 私有信息 —— marker.label（备注）强制剥离；轻量模式再剥离贴图与底图。
   ================================================================ */
import type { MapDoc } from '../types';
import { VIEWER_JS } from './viewer-bundle';

export interface ShareOptions {
    /** 轻量模式：剥离图片资产与底图，改用色块 + 字形（体积可降一个数量级） */
    light?: boolean;
}

const SHARE_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: #0d0d1a; color: #e8e0d0; font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif; }
.top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #2a2a3a; background: #14141f; }
.top .badge { font-size: 11px; letter-spacing: .12em; color: #c9a84c; border: 1px solid #4a3f22; border-radius: 4px; padding: 3px 7px; }
.top h1 { margin: 0; font-size: 16px; font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btn { appearance: none; border: 1px solid #33334a; background: #1a1a28; color: #d8d0c0; border-radius: 4px; height: 28px; padding: 0 10px; font-size: 12px; cursor: pointer; }
.btn:hover { border-color: #c9a84c; color: #e8e0d0; }
.btn.on { border-color: #c9a84c; color: #c9a84c; }
#cf-share-stage { position: fixed; top: 49px; left: 0; right: 0; bottom: 0; background: #12121c; cursor: grab; touch-action: none; }
#cf-share-stage.dragging { cursor: grabbing; }
#cf-share-canvas { display: block; width: 100%; height: 100%; }
#cf-share-error { display: none; position: fixed; left: 50%; top: 45%; transform: translate(-50%,-50%); max-width: 70%; padding: 14px 18px; border: 1px solid #6b2b2b; border-radius: 6px; background: #1c1218; color: #e9b7b7; font-size: 13px; line-height: 1.6; }
.hint { position: fixed; left: 16px; bottom: 12px; font-size: 11px; color: #6f6a80; pointer-events: none; }
`;

/** 从分享产物里剥掉 KP 私有信息；轻量模式再剥贴图与底图。 */
export function toShareDoc(doc: MapDoc, options: ShareOptions = {}): MapDoc {
    const clone: MapDoc = JSON.parse(JSON.stringify(doc));
    clone.markers = (clone.markers || []).map((m) => ({ ...m, label: undefined }));
    if (options.light) {
        clone.assets = [];
        clone.markers = clone.markers.map((m) => ({ ...m, assetId: undefined }));
        clone.background = null;
        clone.backgroundRepeat = false;
    }
    return clone;
}

export function estimateShareBytes(doc: MapDoc, options: ShareOptions = {}): number {
    const html = buildShareHtmlUnsafe(doc, options);
    return new TextEncoder().encode(html).length;
}

export function buildShareHtml(doc: MapDoc, options: ShareOptions = {}): string {
    const html = buildShareHtmlUnsafe(doc, options);
    if (/src\s*=\s*["']https?:/i.test(html) || /href\s*=\s*["']https?:/i.test(html)) {
        throw new Error('分享产物出现外部链接，已中止');
    }
    return html;
}

function buildShareHtmlUnsafe(doc: MapDoc, options: ShareOptions): string {
    const shareDoc = toShareDoc(doc, options);
    const json = JSON.stringify(shareDoc)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    const name = escapeHtml(shareDoc.name || '分享的地图');
    return [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '<head>',
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        `<title>${name} · ClueForge</title>`,
        `<style>${SHARE_CSS}</style>`,
        '</head>',
        '<body>',
        '<div class="top">',
        '<span class="badge">MAP</span>',
        `<h1 id="cf-share-title">${name}</h1>`,
        '<button class="btn on" id="cf-share-grid" type="button">格线</button>',
        '<button class="btn" id="cf-share-fit" type="button">适配</button>',
        '</div>',
        '<div id="cf-share-stage">',
        '<canvas id="cf-share-canvas"></canvas>',
        '</div>',
        '<div id="cf-share-error"></div>',
        '<div class="hint">滚轮缩放 · 拖拽平移 · 双击复位 · 只读，无网络请求</div>',
        `<script type="application/json" id="cf-doc">${json}</script>`,
        `<script>${VIEWER_JS}</script>`,
        '</body>',
        '</html>'
    ].join('\n');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export const SHARE_VIEWER_STUB = 'cf-viewer-v1';
