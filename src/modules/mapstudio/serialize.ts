/* ================================================================
   ClueForge — 文档 ⇄ 画布  |  src/modules/mapstudio/serialize.ts
   · docToObjects：把 MapDoc 渲染成 fabric 对象（新开/重开/撤销都走这里）
   · collectDoc：从当前画布回收一份"干净"的 MapDoc（保存/导出都走这里）
   原则：墙/门/走廊以 cf 元数据为真相；房间矩形以画布几何为真相。
   ================================================================ */
import { fabric } from '../../vendor';
import { clamp } from './grid';
import { makeCorridor, makeDoor, makeRoom, makeRoomLabel, makeWall, type FabricWithCf } from './objects';
import { gridMeters } from './types';
import type { CorridorMeta, DoorMeta, MapDoc, RoomMeta, WallMeta } from './types';

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

    canvas.forEachObject((obj) => {
        const o = obj as FabricWithCf;
        const meta = o.cf;
        if (!meta) return;
        if (meta.type === 'room') {
            // 标签随行，跳过
            if ((o as unknown as { cfLabel?: boolean }).cfLabel) return;
            if (o.type !== 'rect') return;
            const geo = o as fabric.Rect;
            const w = (geo.width || 0) * (geo.scaleX || 1);
            const h = (geo.height || 0) * (geo.scaleY || 1);
            const room: RoomMeta = {
                ...clone(meta),
                left: round1(geo.left || 0),
                top: round1(geo.top || 0),
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

/** 导入/读档的硬上限：这些值直接喂给 canvas 与绘制循环，无界就能用一份 JSON 冻死页面。 */
const DOC_LIMITS = {
    cellMin: 12,
    cellMax: 160,
    /** 坐标/原点允许的最大绝对值 */
    coord: 1e6,
    sizeMin: 64,
    sizeMax: 10000,
    metersMin: 0.2,
    metersMax: 30,
    /** rooms/walls/doors/corridors 各自的成员上限 */
    items: 2000,
    /** 单条墙的折点上限 */
    wallPoints: 500
};

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
        size: {
            width: clamp(num(r.size?.width, 1600), DOC_LIMITS.sizeMin, DOC_LIMITS.sizeMax),
            height: clamp(num(r.size?.height, 1000), DOC_LIMITS.sizeMin, DOC_LIMITS.sizeMax)
        },
        // 只认内嵌图片：data: 之外的 URL 会在读档时被动外连（file:// 页面也挡不住 <img>）
        background: typeof r.background === 'string' && r.background.startsWith('data:image/') ? r.background : null,
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
    return base;
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
    const doc = normalizeDoc(raw);
    if (!doc) return { ok: false, reason: '地图数据无法解析' };
    return { ok: true, doc };
}

