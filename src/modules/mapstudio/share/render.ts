/* ================================================================
   ClueForge — 只读渲染器（分享 HTML 用） | share/render.ts
   不依赖 fabric：玩家侧只需要“按文档画一遍”，15–25KB 足够。
   绘制顺序与 serialize.docToObjects 一致：底图 → 格线 → 走廊 → 房间 → 房名 → 墙 → 门 → 标记。
   注意：色值从 objects.ts 复制而来（一次性债）。改色时两处一起改，否则导出图与编辑器会漂移。
   ================================================================ */
import type { DoorMeta, MapDoc, MarkerMeta } from '../types';

export interface ShareView {
    zoom: number;
    offsetX: number;
    offsetY: number;
    showGrid: boolean;
    dpr: number;
}

export type ImageLookup = (id: string) => HTMLImageElement | undefined;

const ROOM_FILL = 'rgba(122,120,170,0.14)';
const ROOM_STROKE = '#9a95b8';
const ROOM_TEXT = '#d8d0c0';
const WALL_INK = '#cfc7b8';
const WALL_SHADOW = '#8b8577';
const CORRIDOR_FILL = 'rgba(201,168,76,0.06)';
const CORRIDOR_STROKE = 'rgba(201,168,76,0.40)';
const DOOR_STROKE = '#b8b2a2';
const FONT = 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif';

export function hexA(hex: string, alpha: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(150,150,170,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function markerDiameter(meta: MarkerMeta, cell: number): number {
    return Math.max(cell * 0.7, meta.sizeCells * cell - 4);
}

export function doorGeometry(meta: DoorMeta): {
    hinge: { x: number; y: number };
    closed: { x: number; y: number };
    tip: { x: number; y: number };
} {
    const a = ((meta.angle ?? 0) * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const w = meta.width;
    return {
        hinge: { x: meta.x, y: meta.y },
        closed: { x: meta.x + ux * w, y: meta.y + uy * w },
        tip: { x: meta.x - uy * w, y: meta.y + ux * w }
    };
}

function drawBackground(ctx: CanvasRenderingContext2D, doc: MapDoc, images: ImageLookup): void {
    const bg = doc.background;
    if (!bg || !bg.startsWith('data:image/')) return;
    const img = images(bg);
    if (!img || !img.width) return;
    const { width, height } = doc.size;
    if (doc.backgroundRepeat) {
        const tile = Math.max(8, doc.grid.cell);
        const pattern = ctx.createPattern(img, 'repeat');
        if (!pattern) return;
        ctx.save();
        ctx.fillStyle = pattern;
        // pattern 以画布原点为基准，先平移到网格原点再铺
        ctx.translate(doc.grid.originX % tile, doc.grid.originY % tile);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(-width, -height, width * 3, height * 3);
        ctx.restore();
        return;
    }
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, 0, 0, width, height);
    ctx.globalAlpha = 1;
}


function drawGrid(ctx: CanvasRenderingContext2D, doc: MapDoc, view: ShareView): void {
    const { cell, originX, originY } = doc.grid;
    const { width, height } = doc.size;
    const z = view.zoom;
    if (cell * z < 6) return;
    ctx.save();
    ctx.lineWidth = 1 / z;
    const startCol = Math.max(0, Math.ceil(-originX / cell));
    const cols = Math.min(Math.ceil(width / cell) + 2, 4096);
    for (let n = 0; n < cols; n++) {
        const i = startCol + n;
        const x = originX + i * cell;
        if (x > width) break;
        ctx.strokeStyle = i % 5 === 0 ? 'rgba(201,168,76,0.24)' : 'rgba(201,168,76,0.10)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    const startRow = Math.max(0, Math.ceil(-originY / cell));
    const rows = Math.min(Math.ceil(height / cell) + 2, 4096);
    for (let n = 0; n < rows; n++) {
        const j = startRow + n;
        const y = originY + j * cell;
        if (y > height) break;
        ctx.strokeStyle = j % 5 === 0 ? 'rgba(201,168,76,0.24)' : 'rgba(201,168,76,0.10)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    ctx.restore();
}

function drawRooms(ctx: CanvasRenderingContext2D, doc: MapDoc, view: ShareView): void {
    const z = view.zoom;
    for (const room of doc.rooms) {
        ctx.fillStyle = ROOM_FILL;
        ctx.strokeStyle = ROOM_STROKE;
        ctx.lineWidth = 1.5 / z;
        ctx.beginPath();
        ctx.rect(room.left, room.top, room.width, room.height);
        ctx.fill();
        ctx.stroke();
    }
    ctx.save();
    ctx.fillStyle = ROOM_TEXT;
    ctx.font = `500 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of doc.rooms) {
        const text = room.name || '房间';
        const maxW = Math.max(40, room.width - 16);
        wrapText(ctx, text, room.left + room.width / 2, room.top + room.height / 2, maxW, 21);
    }
    ctx.restore();
}

function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    maxWidth: number,
    lineHeight: number
): void {
    const lines: string[] = [];
    let line = '';
    for (const ch of Array.from(text)) {
        const next = line + ch;
        if (ctx.measureText(next).width > maxWidth && line) {
            lines.push(line);
            line = ch;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

function drawCorridors(ctx: CanvasRenderingContext2D, doc: MapDoc, view: ShareView): void {
    const z = view.zoom;
    for (const c of doc.corridors || []) {
        ctx.fillStyle = CORRIDOR_FILL;
        ctx.strokeStyle = CORRIDOR_STROKE;
        ctx.lineWidth = 1 / z;
        ctx.setLineDash([6 / z, 6 / z]);
        ctx.beginPath();
        ctx.rect(c.left, c.top, c.width, c.height);
        ctx.fill();
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function drawWalls(ctx: CanvasRenderingContext2D, doc: MapDoc, view: ShareView): void {
    const z = view.zoom;
    ctx.strokeStyle = WALL_INK;
    ctx.lineWidth = 3 / z;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const w of doc.walls) {
        if (w.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(w.points[0].x, w.points[0].y);
        for (let i = 1; i < w.points.length; i++) ctx.lineTo(w.points[i].x, w.points[i].y);
        ctx.stroke();
    }
}

function drawDoors(ctx: CanvasRenderingContext2D, doc: MapDoc, view: ShareView): void {
    const z = view.zoom;
    for (const d of doc.doors) {
        const { hinge, closed, tip } = doorGeometry(d);
        if (d.kind === 'window') {
            const a = ((d.angle ?? 0) * Math.PI) / 180;
            const ox = -Math.sin(a) * 2.5;
            const oy = Math.cos(a) * 2.5;
            ctx.strokeStyle = DOOR_STROKE;
            ctx.lineWidth = 1.4 / z;
            ctx.beginPath();
            ctx.moveTo(hinge.x + ox, hinge.y + oy);
            ctx.lineTo(closed.x + ox, closed.y + oy);
            ctx.moveTo(hinge.x - ox, hinge.y - oy);
            ctx.lineTo(closed.x - ox, closed.y - oy);
            ctx.stroke();
            continue;
        }
        ctx.strokeStyle = d.kind === 'secret' ? WALL_SHADOW : DOOR_STROKE;
        ctx.lineWidth = 1.8 / z;
        ctx.setLineDash(d.kind === 'secret' ? [6 / z, 4 / z] : []);
        ctx.beginPath();
        ctx.moveTo(hinge.x, hinge.y);
        ctx.lineTo(closed.x, closed.y);
        ctx.moveTo(hinge.x, hinge.y);
        ctx.lineTo(tip.x, tip.y);
        if (d.kind === 'door') {
            const a0 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
            const a1 = Math.atan2(tip.y - hinge.y, tip.x - hinge.x);
            ctx.moveTo(closed.x, closed.y);
            ctx.arc(hinge.x, hinge.y, d.width, a0, a1, a1 < a0);
        }
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function drawMarkers(ctx: CanvasRenderingContext2D, doc: MapDoc, view: ShareView, images: ImageLookup): void {
    const z = view.zoom;
    const cell = doc.grid.cell;
    for (const m of doc.markers || []) {
        const d = markerDiameter(m, cell);
        const r = d / 2;
        const img = m.assetId ? images(m.assetId) : undefined;
        if (img && img.width) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, m.x - r, m.y - r, d, d);
            ctx.restore();
            ctx.strokeStyle = m.color;
            ctx.lineWidth = 2 / z;
            ctx.beginPath();
            ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
            ctx.stroke();
            continue;
        }
        ctx.fillStyle = hexA(m.color, 0.3);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        if (m.shape === 'prop') {
            roundRect(ctx, m.x - r, m.y - r, d, d, 3);
        } else {
            ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.fillStyle = ROOM_TEXT;
        ctx.font = `${Math.max(10, Math.round(d * 0.46))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.glyph || '?', m.x, m.y);
        ctx.restore();
    }
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

export function renderMap(
    ctx: CanvasRenderingContext2D,
    doc: MapDoc,
    view: ShareView,
    images: ImageLookup
): void {
    const dpr = view.dpr;
    const z = view.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
    ctx.fillStyle = '#12121c';
    ctx.fillRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
    ctx.setTransform(z * dpr, 0, 0, z * dpr, view.offsetX * dpr, view.offsetY * dpr);
    drawBackground(ctx, doc, images);
    if (view.showGrid) drawGrid(ctx, doc, view);
    drawCorridors(ctx, doc, view);
    drawRooms(ctx, doc, view);
    drawWalls(ctx, doc, view);
    drawDoors(ctx, doc, view);
    drawMarkers(ctx, doc, view, images);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

