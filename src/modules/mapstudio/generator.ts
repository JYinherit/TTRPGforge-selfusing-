/* ================================================================
   ClueForge — 程序化楼层生成  |  src/modules/mapstudio/generator.ts
   输入一个 seed，输出一份完整的 MapDoc：
     房间（矩形，带真实米数元数据）
     走廊（MST 连通所有房间）
     墙（只沿"不可通行边界"生成，相邻段合并成折线）
     门（每个房间至少一个门洞，可关掉门的图标）
   同一 seed + 同一参数 = 同一张图，便于 KP 复现与分享。
   ================================================================ */
import { Rng } from './rng';
import { nextId } from './types';
import type { CorridorMeta, DoorMeta, MapDoc, RoomMeta, WallMeta } from './types';

export interface GenOptions {
    seed: string;
    cols: number;
    rows: number;
    /** 房间最小/最大格数（边长）。 */
    roomMin: number;
    roomMax: number;
    roomCount: number;
    /** 每格像素。 */
    cell: number;
    /** 1 格 = 多少米（只写进元数据，不改变像素）。 */
    metersPerCell: number;
    /** 是否放门图标；关掉时只留门洞。 */
    doors: boolean;
}

interface RoomCell {
    col: number;
    row: number;
    w: number;
    h: number;
    name: string;
}

interface Segment {
    kind: 'H' | 'V';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

const NAME_POOL = [
    '门厅', '会客厅', '书房', '餐厅', '厨房', '储藏室', '卧房', '客房',
    '浴室', '阁楼', '地下室', '画室', '祭坛', '温室', '钟楼', '档案室',
    '祈祷间', '酒窖', '裁缝房', '儿童房', '标本室', '暗室'
];

export const DEFAULT_GEN: GenOptions = {
    seed: 'ashcroft-manor',
    cols: 26,
    rows: 18,
    roomMin: 3,
    roomMax: 7,
    roomCount: 7,
    cell: 40,
    metersPerCell: 1.5,
    doors: true
};

export function generateMap(options: Partial<GenOptions> = {}): MapDoc {
    const opt: GenOptions = { ...DEFAULT_GEN, ...options };
    const rng = new Rng(opt.seed);
    const cols = Math.max(6, Math.round(opt.cols));
    const rows = Math.max(6, Math.round(opt.rows));
    const occ = new Int8Array(cols * rows); // 0 空 / 1 房间 / 2 走廊
    const roomAt = new Int16Array(cols * rows).fill(-1);
    const rooms: RoomCell[] = [];
    const names = rng.shuffle(NAME_POOL.slice());
    const cell = opt.cell;

    const at = (c: number, r: number): number => (c < 0 || r < 0 || c >= cols || r >= rows ? -1 : occ[r * cols + c]);

    /* ---------- 1. 摆房间（彼此留 1 格缝隙，避免粘成一片） ---------- */
    for (let attempt = 0; attempt < opt.roomCount * 400 && rooms.length < opt.roomCount; attempt++) {
        // 房间太挤时逐步缩小尺寸要求，保证"要几间就有几间"，而不是默默少放几间
        const shrink = Math.floor(attempt / Math.max(60, opt.roomCount * 90));
        const hi = Math.max(opt.roomMin, opt.roomMax - shrink);
        const lo = Math.min(opt.roomMin, hi);
        const w = rng.int(lo, hi);
        const h = rng.int(lo, hi);
        const col = rng.int(1, Math.max(1, cols - w - 2));
        const row = rng.int(1, Math.max(1, rows - h - 2));
        let free = true;
        for (let r = row - 1; r <= row + h && free; r++) {
            for (let c = col - 1; c <= col + w; c++) {
                if (at(c, r) !== 0) {
                    free = false;
                    break;
                }
            }
        }
        if (!free) continue;
        for (let r = row; r < row + h; r++) {
            for (let c = col; c < col + w; c++) {
                occ[r * cols + c] = 1;
                roomAt[r * cols + c] = rooms.length;
            }
        }
        rooms.push({ col, row, w, h, name: names[rooms.length % names.length] || `房间 ${rooms.length + 1}` });
    }
    if (rooms.length === 0) {
        const w = Math.min(opt.roomMax, cols - 4);
        const h = Math.min(opt.roomMax, rows - 4);
        const col = Math.floor((cols - w) / 2);
        const row = Math.floor((rows - h) / 2);
        for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) occ[r * cols + c] = 1;
        rooms.push({ col, row, w, h, name: '大厅' });
    }

    /* ---------- 2. 走廊：房间中心做 Manhattan MST，逐段开凿 ---------- */
    const centers = rooms.map((rm) => ({
        c: rm.col + Math.floor(rm.w / 2),
        r: rm.row + Math.floor(rm.h / 2)
    }));
    const openings = new Set<string>(); // 门洞（房间与走廊之间的连通口）
    const edgeKeyH = (c: number, r: number): string => `H:${c}:${r}`;
    const edgeKeyV = (c: number, r: number): string => `V:${c}:${r}`;

    // 邻接语义：同一行 → 竖直边 edgeKeyV(min c, r)；同一列 → 水平边 edgeKeyH(c, min r)
    const keyBetween = (c1: number, r1: number, c2: number, r2: number): string | null => {
        if (r1 === r2) return edgeKeyV(Math.min(c1, c2), r1);
        if (c1 === c2) return edgeKeyH(c1, Math.min(r1, r2));
        return null;
    };

    const carve = (c: number, r: number): void => {
        if (c < 0 || r < 0 || c >= cols || r >= rows) return;
        if (occ[r * cols + c] === 0) occ[r * cols + c] = 2;
    };

    const carvePathCells = (a: { c: number; r: number }, b: { c: number; r: number }): Array<{ c: number; r: number }> => {
        const cells: Array<{ c: number; r: number }> = [];
        const horizFirst = rng.chance(0.5);
        if (horizFirst) {
            const step = a.c <= b.c ? 1 : -1;
            for (let c = a.c; c !== b.c + step; c += step) cells.push({ c, r: a.r });
            const vstep = a.r <= b.r ? 1 : -1;
            for (let r = a.r + vstep; r !== b.r + vstep; r += vstep) cells.push({ c: b.c, r });
        } else {
            const vstep = a.r <= b.r ? 1 : -1;
            for (let r = a.r; r !== b.r + vstep; r += vstep) cells.push({ c: a.c, r });
            const step = a.c <= b.c ? 1 : -1;
            for (let c = a.c + step; c !== b.c + step; c += step) cells.push({ c: b.c, r: b.r });
        }
        return cells;
    };

    const connect = (ai: number, bi: number): void => {
        const a = centers[ai];
        const b = centers[bi];
        const cells = carvePathCells(a, b);
        cells.forEach((cur) => carve(cur.c, cur.r));
        // 记录房间 A 的出口
        for (let i = 1; i < cells.length; i++) {
            const prev = cells[i - 1];
            const cur = cells[i];
            if (roomAt[prev.r * cols + prev.c] === ai && roomAt[cur.r * cols + cur.c] !== ai) {
                const key = keyBetween(prev.c, prev.r, cur.c, cur.r);
                if (key) openings.add(key);
                break;
            }
        }
        // 记录房间 B 的出口
        for (let i = cells.length - 2; i >= 0; i--) {
            const cur = cells[i];
            const next = cells[i + 1];
            if (roomAt[next.r * cols + next.c] === bi && roomAt[cur.r * cols + cur.c] !== bi) {
                const key = keyBetween(cur.c, cur.r, next.c, next.r);
                if (key) openings.add(key);
                break;
            }
        }
    };

    // Prim MST
    if (rooms.length > 1) {
        const inTree = new Array<boolean>(rooms.length).fill(false);
        inTree[0] = true;
        const edgesUsed = new Set<string>();
        for (let k = 1; k < rooms.length; k++) {
            let best: { a: number; b: number; d: number } | null = null;
            for (let i = 0; i < rooms.length; i++) {
                if (!inTree[i]) continue;
                for (let j = 0; j < rooms.length; j++) {
                    if (inTree[j]) continue;
                    const id = i < j ? `${i}-${j}` : `${j}-${i}`;
                    if (edgesUsed.has(id)) continue;
                    const d = Math.abs(centers[i].c - centers[j].c) + Math.abs(centers[i].r - centers[j].r);
                    if (!best || d < best.d) best = { a: i, b: j, d };
                }
            }
            if (!best) break;
            edgesUsed.add(best.a < best.b ? `${best.a}-${best.b}` : `${best.b}-${best.a}`);
            inTree[best.b] = true;
            connect(best.a, best.b);
        }
    }

    /* ---------- 3. 墙：沿不可通行边界收集线段，再合并成折线 ---------- */
    const segs = new Map<string, Segment>();
    const addSeg = (seg: Segment): void => {
        const key = `${seg.kind}:${seg.x1}:${seg.y1}:${seg.x2}:${seg.y2}`;
        segs.set(key, seg);
    };

    const consider = (c1: number, r1: number, c2: number, r2: number): void => {
        const t1 = at(c1, r1);
        const t2 = at(c2, r2);
        const f1 = t1 > 0;
        const f2 = t2 > 0;
        if (!f1 && !f2) return;
        if (f1 && f2 && t1 === t2) return; // 同类地板内部：不砌墙
        if (r1 === r2) {
            // 同一行的左右两格 → 竖直墙在 x = (min c + 1) * cell
            const c = Math.min(c1, c2);
            if (openings.has(edgeKeyV(c, r1))) return; // 门洞：不砌墙，洞口由门负责
            addSeg({ kind: 'V', x1: (c + 1) * cell, y1: r1 * cell, x2: (c + 1) * cell, y2: (r1 + 1) * cell });
        } else {
            // 同一列的上下两格 → 水平墙在 y = (min r + 1) * cell
            const r = Math.min(r1, r2);
            if (openings.has(edgeKeyH(c1, r))) return;
            addSeg({ kind: 'H', x1: c1 * cell, y1: (r + 1) * cell, x2: (c1 + 1) * cell, y2: (r + 1) * cell });
        }
    };

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            consider(c, r, c + 1, r);
            consider(c, r, c, r + 1);
            consider(c, r, c - 1, r);
            consider(c, r, c, r - 1);
        }
    }

    const merged: WallMeta[] = [];
    const mergeChain = (list: Segment[], horizontal: boolean): void => {
        const groups = new Map<number, Segment[]>();
        list.forEach((s) => {
            const g = horizontal ? s.y1 : s.x1;
            const arr = groups.get(g) || [];
            arr.push(s);
            groups.set(g, arr);
        });
        groups.forEach((arr) => {
            arr.sort((a, b) => (horizontal ? a.x1 - b.x1 : a.y1 - b.y1));
            let cur: Segment | null = null;
            arr.forEach((s) => {
                if (!cur) {
                    cur = { ...s };
                    return;
                }
                const touching = horizontal ? Math.abs(cur.x2 - s.x1) < 0.01 : Math.abs(cur.y2 - s.y1) < 0.01;
                if (touching) {
                    if (horizontal) cur.x2 = s.x2;
                    else cur.y2 = s.y2;
                } else {
                    merged.push(segToWall(cur));
                    cur = { ...s };
                }
            });
            if (cur) merged.push(segToWall(cur));
        });
    };
    const segToWall = (s: Segment): WallMeta => ({
        id: nextId('wall'),
        type: 'wall',
        unit: 'm',
        points: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]
    });
    mergeChain(Array.from(segs.values()).filter((s) => s.kind === 'H'), true);
    mergeChain(Array.from(segs.values()).filter((s) => s.kind === 'V'), false);

    /* ---------- 4. 门：门洞位置生成门图标 ---------- */
    const doors: DoorMeta[] = [];
    if (opt.doors) {
        openings.forEach((key) => {
            const parts = key.split(':');
            if (parts[0] === 'H') {
                const c = Number(parts[1]);
                const r = Number(parts[2]);
                // H 边在 (c, r) 与 (c, r+1) 之间：铰链落在 (c*cell, (r+1)*cell)，门沿 +x 展开
                doors.push({
                    id: nextId('door'),
                    type: 'door',
                    kind: 'door',
                    x: c * cell,
                    y: (r + 1) * cell,
                    angle: 0,
                    width: cell
                });
            } else {
                const c = Number(parts[1]);
                const r = Number(parts[2]);
                // V 边在 (c, r) 与 (c+1, r) 之间：铰链落在 ((c+1)*cell, r*cell)，门沿 +y 展开
                doors.push({
                    id: nextId('door'),
                    type: 'door',
                    kind: 'door',
                    x: (c + 1) * cell,
                    y: r * cell,
                    angle: 90,
                    width: cell
                });
            }
        });
    }

    /* ---------- 5. 房间 / 走廊矩形 ---------- */
    const roomMetas: RoomMeta[] = rooms.map((rm) => ({
        id: nextId('room'),
        type: 'room',
        name: rm.name,
        left: rm.col * cell,
        top: rm.row * cell,
        width: rm.w * cell,
        height: rm.h * cell,
        meters: {
            w: Math.round(((rm.w * cell) / 40) * opt.metersPerCell * 10) / 10,
            h: Math.round(((rm.h * cell) / 40) * opt.metersPerCell * 10) / 10
        }
    }));

    const corridors: CorridorMeta[] = [];
    for (let r = 0; r < rows; r++) {
        let start = -1;
        for (let c = 0; c <= cols; c++) {
            const isCorr = c < cols && occ[r * cols + c] === 2;
            if (isCorr && start < 0) start = c;
            if (!isCorr && start >= 0) {
                corridors.push({
                    id: nextId('corr'),
                    type: 'corridor',
                    left: start * cell,
                    top: r * cell,
                    width: (c - start) * cell,
                    height: cell
                });
                start = -1;
            }
        }
    }

    return {
        version: 1,
        name: opt.seed ? `自动生成 · ${opt.seed}` : '自动生成地图',
        grid: { kind: 'square', cell, originX: 0, originY: 0 },
        rooms: roomMetas,
        walls: merged,
        doors,
        corridors,
        size: { width: cols * cell, height: rows * cell },
        background: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}
