/* ================================================================
   ClueForge — 网格  |  src/modules/mapstudio/grid.ts
   只有一种网格：方格。cell = 每格像素边长，可任意调大调小。
   所有几何吸附 / 程序化生成 / 尺寸换算都走这里，保证口径唯一。
   ================================================================ */
import type { GridSpec, Pt } from './types';

export function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
}

export function snap(v: number, cell: number): number {
    if (!cell) return v;
    return Math.round(v / cell) * cell;
}

export function snapHalf(v: number, cell: number): number {
    if (!cell) return v;
    const half = cell / 2;
    return Math.round(v / half) * half;
}

export function cellOf(px: number, grid: GridSpec): number {
    return Math.round((px - grid.originX) / grid.cell);
}

export function pxOf(cell: number, grid: GridSpec): number {
    return grid.originX + cell * grid.cell;
}

export function snapPoint(x: number, y: number, grid: GridSpec): Pt {
    return {
        x: snap(x - grid.originX, grid.cell) + grid.originX,
        y: snap(y - grid.originY, grid.cell) + grid.originY
    };
}

/** 把像素长度换算成"格"，并给出米数（1 格 = 1.5 米，与现有地图默认一致）。 */
export function lengthToMeters(px: number, grid: GridSpec, metersPerCell = 1.5): number {
    return Math.round((Math.abs(px) / grid.cell) * metersPerCell * 10) / 10;
}

/** 画网格背景（独立 canvas，fabric 只负责对象层，避免格线被选中/被导出）。 */
export function paintGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    grid: GridSpec,
    zoom: number
): void {
    ctx.clearRect(0, 0, width, height);
    const cell = grid.cell * zoom;
    if (cell < 6) return;
    ctx.save();
    ctx.lineWidth = 1;
    // origin 被夹取到 ±1e6 时，从 0 递增会先空转上百万次。直接从画布左/上边界对应的格号起步，
    // 再按"画布最多几格"封顶：迭代次数只跟画布尺寸有关，不再跟 origin 大小有关。
    const startCol = Math.max(0, Math.ceil((-grid.originX * zoom) / cell));
    const maxCols = Math.min(Math.ceil(width / cell) + 2, 4096);
    for (let n = 0; n < maxCols; n++) {
        const i = startCol + n;
        const x = grid.originX * zoom + i * cell;
        if (x > width) break;
        ctx.strokeStyle = i % 5 === 0 ? 'rgba(201,168,76,0.18)' : 'rgba(201,168,76,0.08)';
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
        ctx.stroke();
    }
    const startRow = Math.max(0, Math.ceil((-grid.originY * zoom) / cell));
    const maxRows = Math.min(Math.ceil(height / cell) + 2, 4096);
    for (let n = 0; n < maxRows; n++) {
        const j = startRow + n;
        const y = grid.originY * zoom + j * cell;
        if (y > height) break;
        ctx.strokeStyle = j % 5 === 0 ? 'rgba(201,168,76,0.18)' : 'rgba(201,168,76,0.08)';
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
        ctx.stroke();
    }
    ctx.restore();
}
