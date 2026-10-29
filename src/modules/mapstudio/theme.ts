/* ================================================================
   ClueForge — 画布调色板  |  src/modules/mapstudio/theme.ts
   fabric 不吃 var()，所以令牌只能「读回 JS 再用」。
   唯一入口：读一次 getComputedStyle，缓存；换肤时 invalidate 后重建。
   ================================================================ */

export interface CanvasPalette {
    bg: string;
    ink: string;
    inkDim: string;
    roomFill: string;
    roomStroke: string;
    roomText: string;
    corner: string;
    door: string;
    corrFill: string;
    corrStroke: string;
    gridMajor: string;
    gridMinor: string;
    /** 标记显示色（6 个）；文档里存的仍是 MARKER_COLORS 的原始值，显示时按索引查表 */
    markerColors: string[];
}

function cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function numVar(name: string, fallback: number): number {
    const n = parseFloat(cssVar(name, String(fallback)));
    return Number.isFinite(n) ? n : fallback;
}

/** #rrggbb → rgba()；fabric 的 fill/stroke 只吃字符串，alpha 只能自己拼 */
export function hexA(hex: string, alpha: number): string {
    const h = hex.replace('#', '').trim();
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function readCanvasPalette(): CanvasPalette {
    const ink = cssVar('--cf-cv-ink', '#cfc7b8');
    const roomFill = cssVar('--cf-cv-room-fill', '#7a78aa');
    const corr = cssVar('--cf-cv-corridor-fill', '#c9a84c');
    const corrStroke = cssVar('--cf-cv-corridor-stroke', '#c9a84c');
    const gridMajor = cssVar('--cf-cv-grid-major', '#c9a84c');
    const gridMinor = cssVar('--cf-cv-grid-minor', '#c9a84c');
    return {
        bg: cssVar('--cf-canvas-bg', '#12121c'),
        ink,
        inkDim: cssVar('--cf-cv-ink-dim', '#8b8577'),
        roomFill: hexA(roomFill, numVar('--cf-cv-room-fill-a', 0.14)),
        roomStroke: cssVar('--cf-cv-room-stroke', '#9a95b8'),
        roomText: cssVar('--cf-cv-room-text', '#d8d0c0'),
        corner: cssVar('--cf-cv-corner', '#2a2a3a'),
        door: cssVar('--cf-cv-door', '#b8b2a2'),
        corrFill: hexA(corr, numVar('--cf-cv-corridor-fill-a', 0.06)),
        corrStroke: hexA(corrStroke, numVar('--cf-cv-corridor-stroke-a', 0.4)),
        gridMajor: hexA(gridMajor, numVar('--cf-cv-grid-major-a', 0.24)),
        gridMinor: hexA(gridMinor, numVar('--cf-cv-grid-minor-a', 0.1)),
        markerColors: [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--cf-cv-marker-${i}`, '#a8a094')),
    };
}

let CACHE: CanvasPalette | null = null;

/** 懒加载 + 缓存：渲染路径里绝不逐帧读 computed style */
export function pal(): CanvasPalette {
    if (!CACHE) CACHE = readCanvasPalette();
    return CACHE;
}

/** 换肤后必须调用，否则画布对象还用旧色（fabric 的对象缓存不会因 fill 变化失效） */
export function invalidatePalette(): void {
    CACHE = null;
}

/** 把文档里存的标记色（原始 hex）映射成当前主题的显示色；未登记的颜色原样保留 */
export function displayMarkerColor(stored: string, known: string[]): string {
    const i = known.indexOf(stored);
    const shown = i >= 0 ? pal().markerColors[i] : '';
    return shown || stored || '#a8a094';
}
