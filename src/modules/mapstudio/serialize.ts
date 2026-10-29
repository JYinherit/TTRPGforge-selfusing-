/* ================================================================
   ClueForge — 文档 ⇄ 画布  |  src/modules/mapstudio/serialize.ts
   · docToObjects：把 MapDoc 渲染成 fabric 对象（新开/重开/撤销都走这里）
   · collectDoc：从当前画布回收一份"干净"的 MapDoc（保存/导出都走这里）
   原则：墙/门/走廊以 cf 元数据为真相；房间矩形以画布几何为真相。
   ================================================================ */
import { fabric } from '../../vendor';
import { clamp } from './grid';
import { DOC_LIMITS } from './limits';
import { makeCorridor, makeDoor, makeMarker, makeRoom, makeRoomLabel, makeWall, type FabricWithCf } from './objects';
import { gridMeters } from './types';
import type { AssetMeta, CorridorMeta, DoorMeta, MapDoc, MarkerMeta, RoomMeta, WallMeta } from './types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function docToObjects(doc: MapDoc): FabricWithCf[] {
    const objs: FabricWithCf[] = [];
    doc.corridors.forEach((c) => objs.push(makeCorridor(c)));
    doc.rooms.forEach((r) => {
        objs.push(makeRoom(r));
        objs.push(makeRoomLabel(r));
    });
    doc.walls.forEach((w) => objs.push(makeWall(w)));
    doc.doors.forEach((d) => objs.push(makeDoor(d)));
    (doc.markers || []).forEach((m) => objs.push(makeMarker(m, doc.grid.cell)));
    return objs;
}

function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

export function collectDoc(canvas: fabric.Canvas, base: MapDoc): MapDoc {
    const next: MapDoc = clone(base);
    next.rooms = [];
    next.walls = [];
    next.doors = [];
    next.corridors = [];
    next.markers = [];

    canvas.forEachObject((obj) => {
        const o = obj as FabricWithCf;
        const meta = o.cf;
        if (!meta) return;
        if (meta.type === 'room') {
            // 标签随行，跳过
            if ((o as unknown as { cfLabel?: boolean }).cfLabel) return;
            if (o.type !== 'rect') return;
            const geo = o as fabric.Rect;
            // 组选时子对象坐标是相对选择框的，不能当绝对坐标用；此时以文档为准。
            const inGroup = !!(o as unknown as { group?: unknown }).group;
            const w = inGroup ? meta.width : (geo.width || 0) * (geo.scaleX || 1);
            const h = inGroup ? meta.height : (geo.height || 0) * (geo.scaleY || 1);
            const room: RoomMeta = {
                ...clone(meta),
                left: round1(inGroup ? meta.left : geo.left || 0),
                top: round1(inGroup ? meta.top : geo.top || 0),
                width: round1(w),
                height: round1(h),
                meters: {
                    w: round1(gridMeters(w, next.grid.cell, next.grid.metersPerCell ?? 1.5) as number),
                    h: round1(gridMeters(h, next.grid.cell, next.grid.metersPerCell ?? 1.5) as number)
                }
            };
            next.rooms.push(room);
            return;
        }
        if (meta.type === 'wall') {
            const w = clone(meta) as WallMeta;
            w.points = w.points.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
            next.walls.push(w);
            return;
        }
        if (meta.type === 'door') {
            const d = clone(meta) as DoorMeta;
            d.x = round1(d.x);
            d.y = round1(d.y);
            next.doors.push(d);
            return;
        }
        if (meta.type === 'marker') {
            // 标记以文档为真源：画布组选时子对象坐标是相对的，读出来会漂。
            const geo = o as unknown as { left?: number; top?: number; width?: number; height?: number; scaleX?: number; scaleY?: number };
            const w = ((geo.width || 0) * (geo.scaleX || 1));
            const h = ((geo.height || 0) * (geo.scaleY || 1));
            const inGroup = !!(o as unknown as { group?: unknown }).group;
            next.markers!.push({
                ...clone(meta),
                x: round1(inGroup ? meta.x : (geo.left || 0) + w / 2),
                y: round1(inGroup ? meta.y : (geo.top || 0) + h / 2),
                sizeCells: inGroup ? meta.sizeCells : Math.max(1, Math.min(4, Math.round(Math.max(w, h) / Math.max(1, next.grid.cell))))
            } as MarkerMeta);
            return;
        }
        if (meta.type === 'corridor') {
            const geo = o as fabric.Rect;
            next.corridors.push({
                ...clone(meta),
                left: round1(geo.left || 0),
                top: round1(geo.top || 0),
                width: round1((geo.width || 0) * (geo.scaleX || 1)),
                height: round1((geo.height || 0) * (geo.scaleY || 1))
            } as CorridorMeta);
        }
    });

    next.updatedAt = new Date().toISOString();
    return next;
}

export function docToJSON(doc: MapDoc): string {
    return JSON.stringify(doc, null, 2);
}


function num(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 旧存档兼容：任何形状/缺字段的 mapstudio 值都收敛为一份可用的 MapDoc。 */
export function normalizeDoc(raw: unknown): MapDoc | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<MapDoc>;
    const base: MapDoc = {
        version: 1,
        name: typeof r.name === 'string' ? r.name : '导入的地图',
        grid: {
            kind: 'square',
            // 死值必须有界：originX=-1e9 之类会让绘制循环空转，size 会直接把 canvas 撑爆
            cell: clamp(num(r.grid?.cell, 40), DOC_LIMITS.cellMin, DOC_LIMITS.cellMax),
            originX: clamp(num(r.grid?.originX, 0), -DOC_LIMITS.coord, DOC_LIMITS.coord),
            originY: clamp(num(r.grid?.originY, 0), -DOC_LIMITS.coord, DOC_LIMITS.coord),
            metersPerCell: clamp(num(r.grid?.metersPerCell, 1.5), DOC_LIMITS.metersMin, DOC_LIMITS.metersMax)
        },
        rooms: [],
        walls: [],
        doors: [],
        corridors: [],
        markers: [],
        assets: [],
        size: {
            width: clamp(num(r.size?.width, 1600), DOC_LIMITS.sizeMin, DOC_LIMITS.sizeMax),
            height: clamp(num(r.size?.height, 1000), DOC_LIMITS.sizeMin, DOC_LIMITS.sizeMax)
        },
        // 只认内嵌图片：data: 之外的 URL 会在读档时被动外连（file:// 页面也挡不住 <img>）
        background: typeof r.background === 'string' && r.background.startsWith('data:image/') ? r.background : null,
        backgroundRepeat: r.backgroundRepeat === true,
        createdAt: r.createdAt || new Date().toISOString(),
        updatedAt: r.updatedAt || new Date().toISOString()
    };
    if (Array.isArray(r.rooms)) {
        r.rooms.slice(0, DOC_LIMITS.items).forEach((rm) => {
            if (!rm || typeof rm !== 'object') return;
            const g = rm;
            if (typeof g.left !== 'number' || typeof g.top !== 'number' || typeof g.width !== 'number' || typeof g.height !== 'number') return;
            base.rooms.push({
                // 先展开原字段：tags / level / notes 这类扩展元数据不能被读档抹掉
                ...g,
                id: g.id || `room_${base.rooms.length}`,
                type: 'room',
                name: typeof g.name === 'string' ? g.name : `房间 ${base.rooms.length + 1}`,
                left: g.left,
                top: g.top,
                width: g.width,
                height: g.height,
                meters: g.meters
            });
        });
    }
    if (Array.isArray(r.walls)) {
        r.walls.slice(0, DOC_LIMITS.items).forEach((w) => {
            if (!w || !Array.isArray(w.points) || w.points.length < 2) return;
            const pts = w.points
                .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
                .slice(0, DOC_LIMITS.wallPoints);
            if (pts.length < 2) return;
            base.walls.push({
                ...w,
                id: w.id || `wall_${base.walls.length}`,
                type: 'wall',
                unit: w.unit === 'ft' || w.unit === 'px' ? w.unit : 'm',
                points: pts.map((p) => ({ x: p.x, y: p.y }))
            });
        });
    }
    if (Array.isArray(r.doors)) {
        r.doors.slice(0, DOC_LIMITS.items).forEach((d) => {
            if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return;
            base.doors.push({
                ...d,
                id: d.id || `door_${base.doors.length}`,
                type: 'door',
                kind: d.kind === 'window' || d.kind === 'secret' ? d.kind : 'door',
                x: d.x,
                y: d.y,
                angle: typeof d.angle === 'number' ? d.angle : 0,
                width: typeof d.width === 'number' && d.width > 0 ? d.width : base.grid.cell
            });
        });
    }
    if (Array.isArray(r.corridors)) {
        r.corridors.slice(0, DOC_LIMITS.items).forEach((c) => {
            if (!c || typeof c.left !== 'number' || typeof c.top !== 'number') return;
            base.corridors.push({
                ...c,
                id: c.id || `corr_${base.corridors.length}`,
                type: 'corridor',
                left: c.left,
                top: c.top,
                width: typeof c.width === 'number' ? c.width : base.grid.cell,
                height: typeof c.height === 'number' ? c.height : base.grid.cell
            });
        });
    }
    if (Array.isArray(r.markers)) {
        base.markers = [];
        r.markers.slice(0, DOC_LIMITS.markers).forEach((m, idx) => {
            if (!m || typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
            const g = m as Partial<MarkerMeta>;
            base.markers!.push({
                ...m,
                id: g.id || `mk_${idx}`,
                type: 'marker',
                shape: g.shape === 'prop' ? 'prop' : 'token',
                x: clamp(g.x as number, -DOC_LIMITS.coord, DOC_LIMITS.coord),
                y: clamp(g.y as number, -DOC_LIMITS.coord, DOC_LIMITS.coord),
                sizeCells: clamp(Math.round(num(g.sizeCells, 1)), 1, 4),
                color: typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#a8a094',
                glyph: typeof g.glyph === 'string' && g.glyph ? g.glyph.slice(0, 1) : '?',
                label: typeof g.label === 'string' ? Array.from(g.label).slice(0, DOC_LIMITS.markerLabel).join('') : undefined,
                assetId: typeof g.assetId === 'string' ? g.assetId : undefined
            } as MarkerMeta);
        });
    }
    if (Array.isArray(r.assets)) {
        base.assets = normalizeAssets(r.assets);
    }
    if (typeof r.backgroundRepeat === 'boolean') base.backgroundRepeat = r.backgroundRepeat;
    return base;
}

/** 只收内嵌图片资产；去重、限条数、限单张与总量（防止一份 JSON 把内存打满）。 */
function normalizeAssets(raw: unknown[]): AssetMeta[] {
    const out: AssetMeta[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const item of raw) {
        if (out.length >= DOC_LIMITS.assets) break;
        if (!item || typeof item !== 'object') continue;
        const a = item as Partial<AssetMeta>;
        if (typeof a.dataUrl !== 'string' || !a.dataUrl.startsWith('data:image/')) continue;
        const comma = a.dataUrl.indexOf(',');
        if (comma < 0) continue;
        const guess = Math.floor((a.dataUrl.length - comma - 1) * 0.75);
        if (guess > DOC_LIMITS.assetBytes) continue;
        if (total + guess > DOC_LIMITS.assetsTotal) break;
        const hash = typeof a.hash === 'string' && a.hash ? a.hash : a.dataUrl.slice(-48);
        if (seen.has(hash)) continue;
        seen.add(hash);
        total += guess;
        out.push({
            id: typeof a.id === 'string' && a.id ? a.id : `asset_${seen.size}`,
            hash,
            kind: a.kind === 'token' || a.kind === 'texture' ? a.kind : 'prop',
            dataUrl: a.dataUrl,
            w: num(a.w, 256),
            h: num(a.h, 256),
            bytes: guess
        });
    }
    return out;
}

export type DocValidation = { ok: true; doc: MapDoc } | { ok: false; reason: string };

/**
 * 导入校验：不合法的 JSON 一律拒绝，绝不交给 loadDoc 去"静默清空"当前画布。
 * 兼容旧存档：version 可缺失；一旦写了就必须是 1（更高的版本由更新版程序自己读）。
 */
export function validateMapDoc(raw: unknown): DocValidation {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: '不是地图 JSON 对象' };
    }
    const r = raw as Record<string, unknown>;
    if (r.version !== undefined && r.version !== 1) {
        return { ok: false, reason: `地图数据版本 ${String(r.version)} 不受支持（本程序只读 version 1）` };
    }
    for (const key of ['rooms', 'walls', 'doors', 'corridors']) {
        if (!Array.isArray(r[key])) return { ok: false, reason: `缺少 ${key} 数组，这不是地图 JSON` };
    }
    const grid = r.grid as { cell?: unknown } | null | undefined;
    if (!grid || typeof grid !== 'object' || typeof grid.cell !== 'number' || !Number.isFinite(grid.cell)) {
        return { ok: false, reason: 'grid.cell 不是有限数字，这不是地图 JSON' };
    }
    if (typeof r.background === 'string' && !r.background.startsWith('data:image/')) {
        return { ok: false, reason: 'background 只接受内嵌 data:image/ 图片（拒绝外部链接）' };
    }
    for (const key of ['markers', 'assets']) {
        if (r[key] !== undefined && !Array.isArray(r[key])) return { ok: false, reason: `${key} 必须是数组` };
    }
    if (Array.isArray(r.assets)) {
        for (const item of r.assets as Array<Record<string, unknown>>) {
            const url = item && item.dataUrl;
            if (typeof url === 'string' && !url.startsWith('data:image/')) {
                return { ok: false, reason: 'assets 只接受内嵌 data:image/ 图片（拒绝外部链接）' };
            }
        }
    }
    const doc = normalizeDoc(raw);
    if (!doc) return { ok: false, reason: '地图数据无法解析' };
    return { ok: true, doc };
}





