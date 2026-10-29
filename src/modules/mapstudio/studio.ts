/* ================================================================
   ClueForge — 地图工坊编辑器核心  |  src/modules/mapstudio/studio.ts
   只做三件事：把 MapDoc 画出来、接受编辑、把编辑收回 MapDoc。
   画布 = 视图；MapDoc = 真相。撤销 = 文档快照。
   ================================================================ */
import { fabric } from '../../vendor';
import { paintGrid, snap, snapHalf, snapPoint } from './grid';
import { generateMap } from './generator';
import type { GenOptions } from './generator';
import { ASSET_LIMITS, DOC_LIMITS, UNDO_MAX_BYTES, EXPORT_MAX_PIXELS, contentHash, dataUrlBytes } from './limits';
import { collectDoc, docToJSON, docToObjects, normalizeDoc } from './serialize';
import { createEmptyDoc, nextId } from './types';
import { invalidatePalette, pal } from './theme';
import type { AssetMeta, CorridorMeta, DoorMeta, MapDoc, MarkerMeta, Pt, RoomMeta, WallMeta } from './types';
import {
    makeDoor,
    makeMarker,
    makeMarkerImage,
    markerDiameter,
    makeRoom,
    makeRoomLabel,
    makeWall,
    type FCanvas,
    type FIEvent,
    type FObject,
    type FPolyline,
    type FRect,
    type FTextbox,
    type FabricWithCf
} from './objects';

export type Tool = 'select' | 'room' | 'wall' | 'door' | 'erase' | 'marker';
export type DoorKind = 'door' | 'window' | 'secret';
export type MarkerShape = 'token' | 'prop';

export interface StudioStatus {
    tool: Tool;
    zoomPct: number;
    rooms: number;
    walls: number;
    doors: number;
    markers: number;
    hint: string;
}

/** 组选（多选）摘要：UI 用它显示“已选 N 个”并提供批量操作。 */
export interface MultiSelection {
    count: number;
    rooms: number;
    walls: number;
    doors: number;
    corridors: number;
    markers: number;
}

export interface StudioOptions {
    gridCanvas: HTMLCanvasElement;
    stage: HTMLElement;
    onStatus?: (s: StudioStatus) => void;
    onSelection?: (meta: RoomMeta | WallMeta | DoorMeta | MarkerMeta | null) => void;
    onMultiSelection?: (info: MultiSelection | null) => void;
    onHistory?: (undo: number, redo: number) => void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MapStudio {
    private canvas: FCanvas;
    private gridCanvas: HTMLCanvasElement;
    private gctx: CanvasRenderingContext2D | null;
    private stage: HTMLElement;
    private opts: StudioOptions;

    doc: MapDoc;
    tool: Tool = 'select';
    doorKind: DoorKind = 'door';
    markerShape: MarkerShape = 'token';
    private applyingGroup = false;
    zoom = 0.75;
    showGrid = true;
    /** 最近一次导出的实际倍率；被像素闸门降过时 degraded=true（UI 提示用）。 */
    lastExportScale = 1;
    lastExportDegraded = false;

    /** 图片资产（token / 物件 / 地板材质）。不进撤销快照：撤销只回文档，资产只在会话内常驻。 */
    assets: AssetMeta[] = [];
    private assetImages = new Map<string, HTMLImageElement>();

    private undoStack: string[] = [];
    private redoStack: string[] = [];
    private limit = 60;
    private suppress = false;

    private roomStart: Pt | null = null;
    private previewRect: FRect | null = null;
    private chain: Pt[] = [];
    private chainPreview: FPolyline | null = null;
    private dblTimer: number | null = null;

    constructor(options: StudioOptions) {
        this.opts = options;
        this.gridCanvas = options.gridCanvas;
        this.gctx = options.gridCanvas.getContext('2d');
        this.stage = options.stage;
        this.doc = createEmptyDoc();

        const canvasEl = this.stage.querySelector('canvas#cfStCanvas') as HTMLCanvasElement;
        this.canvas = new fabric.Canvas(canvasEl, {
            backgroundColor: 'transparent',
            preserveObjectStacking: true,
            selection: true,
            fireRightClick: false,
            stopContextMenu: true,
            uniformScaling: true
        });
        this.canvas.setZoom(this.zoom);
        this.bindEvents();
        this.loadDoc(createEmptyDoc(), true);
    }

    /* ---------------- 基础 ---------------- */

    private saveTimer: number | null = null;

    private emit(): void {
        if (this.opts.onStatus) this.opts.onStatus(this.status());
        if (this.opts.onHistory) this.opts.onHistory(this.undoStack.length, this.redoStack.length);
        this.scheduleAutoSave();
    }

    /** 任何文档/选中变化后延迟触发一次工程自动存档（老应用 project.js 的 auto-save 链路） */
    private scheduleAutoSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            const bus = (window as unknown as { Bus?: { emit(ev: string): void } }).Bus;
            if (bus && typeof bus.emit === 'function') bus.emit('project:auto-save');
        }, 1200);
    }

    status(): StudioStatus {
        const counts = this.counts();
        let hint = '拖动选择 · Delete 删除 · Ctrl+Z 撤销 · 双击房间改名';
        if (this.tool === 'room') hint = '在空白处按住拖出矩形（自动吸附网格）· Esc 回到选择';
        if (this.tool === 'wall') hint = '点击落点连墙 · 双击/Enter 结束 · Esc 取消';
        if (this.tool === 'door') hint = '点击墙上放门 · 再点可继续 · Esc 回到选择';
        if (this.tool === 'erase') hint = '点击要删除的房间/墙/门/标记';
        if (this.tool === 'marker') hint = '点格子放标记 · 检查器里改颜色/字形/大小/图片 · Esc 回到选择';
        return {
            tool: this.tool,
            zoomPct: Math.round(this.zoom * 100),
            rooms: counts.rooms,
            walls: counts.walls,
            doors: counts.doors,
            markers: counts.markers,
            hint
        };
    }

    counts(): { rooms: number; walls: number; doors: number; markers: number } {
        let rooms = 0;
        let walls = 0;
        let doors = 0;
        let markers = 0;
        this.canvas.forEachObject((o: FObject) => {
            const meta = (o as FabricWithCf).cf;
            if (!meta) return;
            if (meta.type === 'room' && o.type === 'rect') rooms += 1;
            if (meta.type === 'wall') walls += 1;
            if (meta.type === 'door') doors += 1;
            if (meta.type === 'marker') markers += 1;
        });
        return { rooms, walls, doors, markers };
    }

    private sizeCanvas(): void {
        const { width, height } = this.doc.size;
        const cw = Math.round(width * this.zoom);
        const ch = Math.round(height * this.zoom);
        this.canvas.setDimensions({ width: cw, height: ch });
        this.canvas.setViewportTransform([this.zoom, 0, 0, this.zoom, 0, 0]);
        // 老样式的 .canvas-container 是 flex:1 + 子元素绝对定位，容器尺寸不会跟着 canvas 走；
        // panel 隐藏时初始化尺寸为 0，这里显式把 wrapper 撑到画布大小，并重算交互偏移。
        const wrapper = (this.canvas as unknown as { wrapperEl?: HTMLDivElement }).wrapperEl;
        if (wrapper) {
            wrapper.style.width = `${cw}px`;
            wrapper.style.height = `${ch}px`;
            wrapper.style.flex = 'none';
        }
        this.canvas.calcOffset();
        this.gridCanvas.width = Math.round(width * this.zoom);
        this.gridCanvas.height = Math.round(height * this.zoom);
        this.gridCanvas.style.width = `${Math.round(width * this.zoom)}px`;
        this.gridCanvas.style.height = `${Math.round(height * this.zoom)}px`;
        this.paintGridLayer();
    }

    private paintGridLayer(): void {
        if (!this.gctx) return;
        if (!this.showGrid) {
            this.gctx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
            return;
        }
        paintGrid(this.gctx, this.gridCanvas.width, this.gridCanvas.height, this.doc.grid, this.zoom);
    }

    setZoom(z: number): void {
        const next = Math.min(3, Math.max(0.15, z));
        this.zoom = next;
        this.sizeCanvas();
        this.canvas.requestRenderAll();
        this.emit();
    }

    /** 供外部（面板切换时机）强制重绘 */
    render(): void {
        this.sizeCanvas();
        this.canvas.requestRenderAll();
    }

    /**
     * 换肤后用：令牌缓存失效 → 按文档重建所有画布对象 → 重画网格 → 保持视图。
     * 必须重建而不是只改 fill：fabric 的对象缓存不会因 fill 变化而失效。
     */
    refreshTheme(): void {
        invalidatePalette();
        const doc = this.collect();
        const vt = this.canvas.viewportTransform ? [...this.canvas.viewportTransform] as [number, number, number, number, number, number] : null;
        const zoom = this.zoom;
        this.loadDoc(doc, false);
        this.zoom = zoom;
        if (vt) this.canvas.setViewportTransform(vt);
        this.paintGridLayer();
        this.canvas.requestRenderAll();
        this.emit();
    }

    zoomBy(factor: number): void {
        this.setZoom(this.zoom * factor);
    }

    fitZoom(): void {
        // 舞台有 padding，若只按 24px 留白算，画布永远比可用区大一圈，底部常驻滚动条。
        // 直接读 computed padding，左右/上下各留 12px 呼吸位。
        const cs = getComputedStyle(this.stage);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const pad = 12;
        const w = this.stage.clientWidth - padX - pad;
        const h = this.stage.clientHeight - padY - pad;
        // 面板隐藏/布局未完成时 stage 可能只有几十像素，此时"适配"会算出 0 并被夹到最小缩放，
        // 表现为一打开工坊地图缩成一粒米。宁可不动，也不要记下错误的缩放。
        if (w < 40 || h < 40) return;
        if (!this.doc.size.width || !this.doc.size.height) return;
        this.setZoom(Math.min(w / this.doc.size.width, h / this.doc.size.height, 2.5));
    }

    getMetersPerCell(): number {
        return this.doc.grid.metersPerCell ?? 1.5;
    }

    /** 1 格 = 多少米。只改尺寸口径，不动像素网格。 */
    setMetersPerCell(mpc: number): void {
        const v = Math.max(0.2, Math.min(30, Math.round(mpc * 10) / 10));
        this.doc.grid.metersPerCell = v;
        this.reportSelection();
        this.emit();
    }

    setGridCell(cell: number): void {
        const c = Math.max(12, Math.min(160, Math.round(cell)));
        this.doc.grid.cell = c;
        this.paintGridLayer();
        this.emit();
    }

    setTool(tool: Tool): void {
        this.tool = tool;
        this.cancelPending();
        this.canvas.selection = tool === 'select';
        (this.canvas as unknown as { skipTargetFind: boolean }).skipTargetFind = tool === 'room' || tool === 'wall';
        this.stage.style.cursor = tool === 'select' ? 'default' : 'crosshair';
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
        this.emit();
    }

    setDoorKind(kind: DoorKind): void {
        this.doorKind = kind;
        this.setTool('door');
    }

    setMarkerShape(shape: MarkerShape): void {
        this.markerShape = shape;
        this.setTool('marker');
    }

    /** 当前选中的文档条目（组选时返回 null），UI 用它决定检查器显示什么。 */
    activeMeta(): RoomMeta | WallMeta | DoorMeta | MarkerMeta | CorridorMeta | null {
        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        return active && active.cf ? active.cf : null;
    }

    toggleGrid(show: boolean): void {
        this.showGrid = show;
        this.paintGridLayer();
    }

    /* ---------------- 文档加载 ---------------- */

    loadDoc(doc: MapDoc, resetHistory: boolean): void {
        const d = normalizeDoc(doc) || createEmptyDoc();
        this.suppress = true;
        this.doc = d;
        this.assets = d.assets && d.assets.length ? d.assets : this.assets;
        this.cancelPending();
        this.canvas.discardActiveObject();
        this.canvas.clear();
        this.sizeCanvas();
        docToObjects(d).forEach((obj) => this.canvas.add(obj));
        this.normalizeLayerOrder();
        this.applyBackground();
        this.suppress = false;
        if (resetHistory) {
            this.undoStack = [];
            this.redoStack = [];
        }
        this.canvas.requestRenderAll();
        this.applyMarkerImages();
        this.reportSelection();
        this.emit();
    }

    private applyBackground(): void {
        if (!this.doc.background) {
            this.canvas.setBackgroundImage(null as unknown as string, () => undefined);
            return;
        }
        const url = this.doc.background;
        const repeat = this.doc.backgroundRepeat === true;
        fabric.Image.fromURL(
            url,
            (img: FObject) => {
                if (repeat) {
                    // 地板材质平铺：fabric 5 的 Image repeat 选项不生效，Pattern 在本构建里没有 render；
                    // 故先用 2D canvas 按文档尺寸铺满一张 tile 图，再整体作为背景图（1:1，不拉伸）。
                    const getEl = (img as unknown as { getElement?: () => HTMLImageElement }).getElement;
                    const src = typeof getEl === 'function' ? getEl.call(img) : null;
                    const w = Math.max(1, Math.round(this.doc.size.width));
                    const h = Math.max(1, Math.round(this.doc.size.height));
                    const tile = document.createElement('canvas');
                    tile.width = w;
                    tile.height = h;
                    const ctx = tile.getContext('2d');
                    const pat = ctx && src ? ctx.createPattern(src, 'repeat') : null;
                    if (ctx && pat) {
                        ctx.fillStyle = pat;
                        ctx.fillRect(0, 0, w, h);
                        const bg = new fabric.Image(tile, { left: 0, top: 0, selectable: false, evented: false });
                        this.canvas.setBackgroundImage(bg as unknown as string, this.canvas.renderAll.bind(this.canvas));
                        return;
                    }
                    // 平铺失败兜底：按原始尺寸居中铺一次
                    img.set({ left: 0, top: 0, selectable: false, evented: false });
                    this.canvas.setBackgroundImage(img as unknown as string, this.canvas.renderAll.bind(this.canvas));
                } else {
                    img.set({
                        left: 0,
                        top: 0,
                        scaleX: this.doc.size.width / (img.width || this.doc.size.width),
                        scaleY: this.doc.size.height / (img.height || this.doc.size.height),
                        selectable: false,
                        evented: false
                    });
                    this.canvas.setBackgroundImage(img as unknown as string, this.canvas.renderAll.bind(this.canvas));
                }
            },
            { crossOrigin: 'anonymous' }
        );
    }

    setBackgroundRepeat(repeat: boolean): void {
        this.pushHistory();
        this.doc.backgroundRepeat = repeat;
        this.applyBackground();
        this.canvas.requestRenderAll();
        this.emit();
    }

    setBackground(dataUrl: string | null): void {
        this.doc.background = dataUrl;
        this.applyBackground();
        this.canvas.requestRenderAll();
    }

    /** 上传底图/地板材质：进撤销栈、发状态、触发自动存档。 */
    commitBackground(dataUrl: string, repeat = false): void {
        this.pushHistory();
        this.setBackground(dataUrl);
        if (repeat) {
            this.doc.backgroundRepeat = true;
            this.applyBackground();
        }
        this.emit();
    }

    /* ---------------- 历史 ---------------- */

    /** 撤销快照：文档全量，但剥掉图片资产（资产以内容哈希常驻，撤销只需保住 assetId 引用）。 */
    private snapshot(): string {
        const doc = collectDoc(this.canvas, this.doc);
        doc.assets = [];
        return docToJSON(doc);
    }

    pushHistory(): void {
        if (this.suppress) return;
        const snapshot = this.snapshot();
        if (this.undoStack[this.undoStack.length - 1] === snapshot) return;
        this.undoStack.push(snapshot);
        while (this.undoStack.length > this.limit) this.undoStack.shift();
        // 字节封顶：底图/大文档时按总大小丢最老的一步，避免几十份全量 JSON 撑爆内存
        let bytes = 0;
        for (let i = this.undoStack.length - 1; i >= 0; i--) {
            bytes += this.undoStack[i].length;
            if (bytes > UNDO_MAX_BYTES) {
                this.undoStack.splice(0, i + 1);
                break;
            }
        }
        this.redoStack = [];
        this.emit();
    }

    undo(): void {
        if (this.undoStack.length === 0) return;
        const current = this.snapshot();
        const prev = this.undoStack.pop() as string;
        this.redoStack.push(current);
        this.loadDoc(JSON.parse(prev) as MapDoc, false);
    }

    redo(): void {
        if (this.redoStack.length === 0) return;
        const current = this.snapshot();
        const next = this.redoStack.pop() as string;
        this.undoStack.push(current);
        this.loadDoc(JSON.parse(next) as MapDoc, false);
    }

    canUndo(): number {
        return this.undoStack.length;
    }

    /* ---------------- 事件 ---------------- */

    private bindEvents(): void {
        const c = this.canvas;
        c.on('mouse:down', (opt: FIEvent) => this.onMouseDown(opt));
        c.on('mouse:move', (opt: FIEvent) => this.onMouseMove(opt));
        c.on('mouse:up', () => this.onMouseUp());
        c.on('mouse:dblclick', (opt: FIEvent) => this.onDblClick(opt));
        c.on('before:transform', () => {
            this.captureMoveOrigins();
            this.pushHistory();
        });
        c.on('object:modified', (e: FIEvent) => this.onObjectModified({ target: e.target as unknown as FabricWithCf }));
        c.on('object:moving', (e: FIEvent) => this.onObjectMoving({ target: e.target as unknown as FabricWithCf }));
        c.on('selection:created', () => { this.tidyControls(); this.reportSelection(); });
        c.on('selection:updated', () => { this.tidyControls(); this.reportSelection(); });
        c.on('selection:cleared', () => this.reportSelection());
    }

    /** 组选拖动：记录按下与最后移动的指针位置（画布坐标），位移只认它。 */
    private dragStart: Pt | null = null;
    private dragLast: Pt | null = null;
    /**
     * 按下时是否命中对象。框选（在空白处拖）也会在松手时得到一个 ActiveSelection，
     * 如果只看"是否多选"就会把框选当成拖拽——一框选，选中的对象就被整体挪走一截。
     */
    private dragStartedOnTarget = false;

    private captureMoveOrigins(): void {
        const active = this.canvas.getActiveObject() as unknown as FabricWithCf | undefined;
        if (active && (active as unknown as { getObjects?: () => FabricWithCf[] }).getObjects) {
            // 组选：指针位移由 mouse:down/move 记录，这里只清空旧值
            this.dragLast = this.dragStart;
        } else {
            this.dragStart = null;
            this.dragLast = null;
        }
    }

    /** fabric v5 里 hasRotatingPoint 已失效，旋转柄拖不动只是噪声：统一收掉四角与旋转柄，只留四边中点。 */
    private tidyControls(): void {
        const objs = this.canvas.getActiveObjects() as unknown as Array<{ setControlsVisibility?: (v: Record<string, boolean>) => void }>;
        for (const o of objs) {
            if (typeof o.setControlsVisibility === 'function') {
                o.setControlsVisibility({ mtr: false, tl: false, tr: false, bl: false, br: false });
            }
        }
    }

    private pointer(opt: { e: Event }): Pt {
        const p = this.canvas.getPointer(opt.e as MouseEvent);
        return { x: p.x, y: p.y };
    }

    private onMouseDown(opt: { e: Event; target?: FObject }): void {
        this.dragStart = this.canvas.getPointer(opt.e as unknown as MouseEvent);
        this.dragLast = this.dragStart;
        this.dragStartedOnTarget = Boolean(opt.target);
        if (this.tool === 'select') {
            if (opt.target) this.pushHistory();
            return;
        }
        if (this.tool === 'room') {
            if (opt.target) return;
            const p = snapPoint(this.pointer(opt).x, this.pointer(opt).y, this.doc.grid);
            this.roomStart = p;
            const rect = new fabric.Rect({
                left: p.x,
                top: p.y,
                width: 0,
                height: 0,
                fill: 'rgba(201,168,76,0.12)',
                stroke: '#c9a84c',
                strokeWidth: 1.5,
                strokeDashArray: [6, 4],
                selectable: false,
                evented: false
            });
            this.previewRect = rect;
            this.canvas.add(rect);
            return;
        }
        if (this.tool === 'wall') {
            const p = snapPoint(this.pointer(opt).x, this.pointer(opt).y, this.doc.grid);
            if (this.chain.length > 1 && this.dist(p, this.chain[0]) < this.doc.grid.cell * 0.6) {
                // 点回起点：闭合成房间轮廓
                this.chain.push({ x: this.chain[0].x, y: this.chain[0].y });
                this.finishChain();
                return;
            }
            if (this.chain.length === 0) {
                this.chain = [p];
            } else {
                this.chain.push(p);
            }
            this.renderChainPreview(p);
            return;
        }
        if (this.tool === 'door') {
            const p = this.pointer(opt);
            this.placeDoor(p.x, p.y);
            return;
        }
        if (this.tool === 'marker') {
            if (opt.target) return;
            const cell = this.doc.grid.cell;
            const p = this.pointer(opt);
            this.addMarker((Math.floor(p.x / cell) + 0.5) * cell, (Math.floor(p.y / cell) + 0.5) * cell);
            return;
        }
        if (this.tool === 'erase') {
            const target = opt.target as FabricWithCf | undefined;
            if (!target) return;
            this.pushHistory();
            this.removeObject(target);
            this.emit();
        }
    }

    private onMouseMove(opt: { e: Event }): void {
        this.dragLast = this.canvas.getPointer(opt.e as unknown as MouseEvent);
        if (this.tool === 'room' && this.roomStart && this.previewRect) {
            const p = snapPoint(this.pointer(opt).x, this.pointer(opt).y, this.doc.grid);
            const left = Math.min(p.x, this.roomStart.x);
            const top = Math.min(p.y, this.roomStart.y);
            this.previewRect.set({
                left,
                top,
                width: Math.abs(p.x - this.roomStart.x),
                height: Math.abs(p.y - this.roomStart.y)
            });
            this.canvas.requestRenderAll();
            return;
        }
        if (this.tool === 'wall' && this.chain.length > 0) {
            const p = snapPoint(this.pointer(opt).x, this.pointer(opt).y, this.doc.grid);
            this.renderChainPreview(p);
        }
    }

    private onMouseUp(): void {
        if (this.tool === 'select') {
            const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
            const fromTarget = this.dragStartedOnTarget;
            this.dragStartedOnTarget = false;
            if (active && fromTarget && this.isMultiSelection(active) && this.dragStart && this.dragLast) {
                const dx = snap(this.dragLast.x - this.dragStart.x, this.doc.grid.cell);
                const dy = snap(this.dragLast.y - this.dragStart.y, this.doc.grid.cell);
                // 位移不足半格：fabric 已经把组跟着手动了，这里不该再重建（否则一次单击也会整组弹一下）
                if (dx !== 0 || dy !== 0) {
                    this.applyGroupModify(active);
                }
            }
            this.dragStart = null;
            this.dragLast = null;
        }
        if (this.tool === 'room' && this.previewRect && this.roomStart) {
            const rect = this.previewRect;
            const left = rect.left || 0;
            const top = rect.top || 0;
            const w = rect.width || 0;
            const h = rect.height || 0;
            this.canvas.remove(rect);
            this.previewRect = null;
            const start = this.roomStart;
            this.roomStart = null;
            if (w >= this.doc.grid.cell * 0.9 && h >= this.doc.grid.cell * 0.9) {
                this.addRoom({ left, top, width: w, height: h });
            } else if (start) {
                // 单击：放一个 2×2 格的房间，减少"画不出来"的挫败感
                this.addRoom({
                    left: start.x,
                    top: start.y,
                    width: this.doc.grid.cell * 2,
                    height: this.doc.grid.cell * 2
                });
            }
            this.canvas.requestRenderAll();
        }
    }

    private onDblClick(opt: { target?: FObject }): void {
        if (this.tool === 'wall') {
            this.finishChain();
            return;
        }
        const target = opt.target as FabricWithCf | undefined;
        if (target && target.cf && target.cf.type === 'room') {
            const meta = target.cf as RoomMeta;
            const next = window.prompt('房间名', meta.name);
            if (next !== null) this.renameRoomById(meta.id, next);
        }
    }

    /**
     * 组选拖动落点：房间/走廊/标记按格吸附，墙/门按整体位移改点再重建。
     * fabric 移动的是视图，文档必须在这里写回，否则一刷新就回弹。
     */
    private applyGroupModify(sel: FabricWithCf): void {
        if (this.applyingGroup) return;
        this.applyingGroup = true;
        const children = (sel as unknown as { getObjects: () => FabricWithCf[] }).getObjects();
        const g = this.doc.grid;
        // 指针位移最可信：fabric 组选里子对象坐标是相对选择框的，选择框自己也会被重算，
        // 只有鼠标从按下到松开走了多少格是稳的。
        const a = this.dragStart;
        const b = this.dragLast;
        const rawDx = a && b ? b.x - a.x : 0;
        const rawDy = a && b ? b.y - a.y : 0;
        const dx = snap(rawDx, g.cell);
        const dy = snap(rawDy, g.cell);
        for (const child of children) {
            // 房间标签与房间共用 meta，重复累加会翻倍
            if ((child as unknown as { cfLabel?: boolean }).cfLabel) continue;
            const meta = child.cf;
            if (!meta) continue;
            if (meta.type === 'room') {
                // 文档坐标即画布坐标（1:1）
                meta.left = snap(meta.left + dx, g.cell);
                meta.top = snap(meta.top + dy, g.cell);
            } else if (meta.type === 'corridor') {
                const cm = meta as unknown as CorridorMeta;
                cm.left = snap(cm.left + dx, g.cell / 2);
                cm.top = snap(cm.top + dy, g.cell / 2);
            } else if (meta.type === 'marker') {
                meta.x = snapHalf(meta.x + dx, g.cell);
                meta.y = snapHalf(meta.y + dy, g.cell);
            } else if (meta.type === 'wall') {
                meta.points = meta.points.map((p) => snapPoint(p.x + dx, p.y + dy, g));
            } else if (meta.type === 'door') {
                meta.x = snapHalf(meta.x + dx, g.cell);
                meta.y = snapHalf(meta.y + dy, g.cell);
            }
        }
        this.dragStart = null;
        this.dragLast = null;
        this.canvas.discardActiveObject();
        // 文档已改，画布整体按文档重建：不跟 fabric 的组坐标纠缠
        try { this.rebuildCanvasFromDoc(); } finally { this.applyingGroup = false; }
        this.reportSelection();
        this.emit();
    }

    /** 清掉所有带 cf 的对象，按 this.doc 重建；组拖动/批量操作后用。 */
    private rebuildCanvasFromDoc(): void {
        const old = this.canvas.getObjects().filter((o) => (o as FabricWithCf).cf);
        old.forEach((o) => this.canvas.remove(o));
        docToObjects(this.doc).forEach((o) => this.canvas.add(o));
        this.applyMarkerImages();
        this.canvas.requestRenderAll();
    }

    /* ---------------- 标记 / 图片资产 ---------------- */

    /** 把资产里的图片装到标记上：先用占位矢量图，图片解码完再无缝替换。 */
    private applyMarkerImages(): void {
        const markers = (this.doc.markers || []).slice();
        if (markers.length === 0) return;
        for (const meta of markers) {
            if (!meta.assetId) continue;
            const cached = this.assetImages.get(meta.assetId);
            if (cached) {
                this.swapMarkerImage(meta, cached);
                continue;
            }
            const asset = this.assets.find((a) => a.id === meta.assetId);
            if (!asset) continue;
            const img = new Image();
            img.onload = () => {
                this.assetImages.set(asset.id, img);
                this.swapMarkerImage(meta, img);
                this.canvas.requestRenderAll();
            };
            img.src = asset.dataUrl;
        }
    }

    private swapMarkerImage(meta: MarkerMeta, img: HTMLImageElement): void {
        let target: FabricWithCf | null = null;
        this.canvas.forEachObject((obj: FObject) => {
            const o = obj as FabricWithCf;
            if (o.cf && o.cf.type === 'marker' && o.cf.id === meta.id && !o.cfImageView) target = o;
        });
        if (!target) return;
        const wasActive = (this.canvas.getActiveObject() as unknown as FabricWithCf) === target;
        this.canvas.remove(target);
        const next = makeMarkerImage(meta, this.doc.grid.cell, img);
        this.canvas.add(next);
        if (wasActive) this.canvas.setActiveObject(next);
    }

    addMarker(x: number, y: number, extra: Partial<MarkerMeta> = {}): MarkerMeta {
        this.pushHistory();
        const g = this.doc.grid;
        const meta: MarkerMeta = {
            id: nextId('mk'),
            type: 'marker',
            shape: this.markerShape,
            x: snapHalf(x, g.cell),
            y: snapHalf(y, g.cell),
            sizeCells: 1,
            color: '#d0564f',
            glyph: this.markerShape === 'prop' ? '◆' : 'A',
            ...extra
        };
        const obj = meta.assetId && this.assetImages.get(meta.assetId)
            ? makeMarkerImage(meta, g.cell, this.assetImages.get(meta.assetId) as HTMLImageElement)
            : makeMarker(meta, g.cell);
        this.doc.markers = this.doc.markers || [];
        this.doc.markers.push(meta);
        this.canvas.add(obj);
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();
        this.reportSelection();
        this.emit();
        return meta;
    }

    /** 检查器改标记属性：直接重建对象，避免"颜色改了但存档没改"的分叉。 */
    setMarkerProps(patch: Partial<MarkerMeta>): void {
        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        const meta = active && active.cf;
        if (!meta || meta.type !== 'marker') return;
        this.pushHistory();
        Object.assign(meta, patch);
        if (patch.glyph) meta.glyph = String(patch.glyph).slice(0, 1);
        this.rebuildObject(active as FabricWithCf);
        this.emit();
        this.reportSelection();
    }

    /** 标记备注：≤40 字符，只存文档、不参与画布渲染（检查器与 JSON 里可见）。 */
    setMarkerLabel(label: string): void {
        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        const meta = active && active.cf;
        if (!meta || meta.type !== 'marker') return;
        const value = Array.from(String(label || '').trim()).slice(0, DOC_LIMITS.markerLabel).join('');
        if ((meta.label || '') === value) return;
        this.pushHistory();
        meta.label = value || undefined;
        this.emit();
        this.reportSelection();
    }

    /** 注册一张图片资产（调用方负责先压到 256/512px 内），返回 assetId。 */
    addAsset(dataUrl: string, kind: 'token' | 'prop' | 'texture' = 'token', w = 256, h = 256): string | null {
        if (!dataUrl.startsWith('data:image/')) return null;
        const hash = contentHash(dataUrl);
        const existing = this.assets.find((a) => a.hash === hash);
        if (existing) return existing.id;
        if (this.assets.length >= ASSET_LIMITS.count) return null;
        const bytes = dataUrlBytes(dataUrl);
        if (bytes > ASSET_LIMITS.bytes) return null;
        // 写路径必须与读路径同一道闸门：总量超限就拒绝，不能“存得进、读不回”
        const total = this.assets.reduce((sum, a) => sum + (a.bytes || 0), 0);
        if (total + bytes > ASSET_LIMITS.totalBytes) return null;
        const id = nextId('asset');
        this.assets.push({ id, hash, kind, dataUrl, w, h, bytes });
        const img = new Image();
        img.onload = () => {
            this.assetImages.set(id, img);
            // 图片加载完成后，若已有标记引用这张资产，立即换成图片标记
            const target = (this.doc.markers || []).find((m) => m.assetId === id);
            if (target) this.swapMarkerImage(target, img);
            this.canvas.requestRenderAll();
            this.reportSelection();
        };
        img.src = dataUrl;
        return id;
    }

    /** 当前选中标记换图；没有图片资产时创建。 */
    attachImageToSelected(dataUrl: string, w = 256, h = 256): boolean {        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        const meta = active && active.cf;
        if (!meta || meta.type !== 'marker') return false;
        const id = this.addAsset(dataUrl, meta.shape === 'prop' ? 'prop' : 'token', w, h);
        if (!id) return false;
        this.setMarkerProps({ assetId: id });
        return true;
    }

    clearSelectedImage(): void {
        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        const meta = active && active.cf;
        if (!meta || meta.type !== 'marker' || !meta.assetId) return;
        this.pushHistory();
        delete meta.assetId;
        this.rebuildObject(active as FabricWithCf);
        this.emit();
        this.reportSelection();
    }

    private onObjectMoving(e: { target: FabricWithCf }): void {
        const o = e.target;
        const meta = o.cf;
        if (!meta) return;
        if (meta.type === 'room' && !this.altDown) {
            o.set({
                left: snap(o.left || 0, this.doc.grid.cell),
                top: snap(o.top || 0, this.doc.grid.cell)
            });
            this.syncLabel(meta);
        }
    }

    private altDown = false;

    setAlt(down: boolean): void {
        this.altDown = down;
    }

    private onObjectModified(e: { target: FabricWithCf }): void {
        const o = e.target;
        if (this.isMultiSelection(o)) {
            this.applyGroupModify(o as FabricWithCf);
            return;
        }
        const meta = o.cf;
        if (!meta) return;
        const g = this.doc.grid;
        if (meta.type === 'room') {
            const w = Math.max(g.cell, snap((o.width || 0) * (o.scaleX || 1), g.cell));
            const h = Math.max(g.cell, snap((o.height || 0) * (o.scaleY || 1), g.cell));
            o.set({ width: w, height: h, scaleX: 1, scaleY: 1, left: snap(o.left || 0, g.cell), top: snap(o.top || 0, g.cell) });
            o.setCoords();
            meta.width = w;
            meta.height = h;
            meta.left = o.left || 0;
            meta.top = o.top || 0;
            this.syncLabel(meta);
            this.canvas.requestRenderAll();
            this.reportSelection();
            this.emit();
            return;
        }
        if (meta.type === 'corridor') {
            const half = g.cell / 2;
            const w = Math.max(half, snap((o.width || 0) * (o.scaleX || 1), half));
            const h = Math.max(half, snap((o.height || 0) * (o.scaleY || 1), half));
            o.set({ width: w, height: h, scaleX: 1, scaleY: 1, left: snap(o.left || 0, half), top: snap(o.top || 0, half) });
            o.setCoords();
            const meta2 = meta as unknown as { left: number; top: number; width: number; height: number };
            meta2.left = o.left || 0;
            meta2.top = o.top || 0;
            meta2.width = w;
            meta2.height = h;
            this.canvas.requestRenderAll();
            this.reportSelection();
            this.emit();
            return;
        }
        const anchor = o.cfAnchor;
        if (meta.type === 'marker') {
            const w = (o.width || 0) * (o.scaleX || 1);
            const h = (o.height || 0) * (o.scaleY || 1);
            const sizeCells = Math.max(1, Math.min(4, Math.round(Math.max(w, h) / g.cell)));
            meta.sizeCells = sizeCells;
            meta.x = snapHalf((o.left || 0) + w / 2, g.cell);
            meta.y = snapHalf((o.top || 0) + h / 2, g.cell);
            this.rebuildObject(o);
            this.emit();
            return;
        }
        if (!anchor) return;
        const dx = (o.left || 0) - anchor.left;
        const dy = (o.top || 0) - anchor.top;
        if (meta.type === 'wall') {
            meta.points = meta.points.map((p) => snapPoint(p.x + dx, p.y + dy, g));
            this.rebuildObject(o);
            return;
        }
        if (meta.type === 'door') {
            meta.x = snapHalf(meta.x + dx, g.cell);
            meta.y = snapHalf(meta.y + dy, g.cell);
            this.rebuildObject(o);
        }
    }

    private syncLabel(room: RoomMeta): void {
        this.canvas.forEachObject((obj: FObject) => {
            const o = obj as FabricWithCf;
            if (!o.cf || o.cf.type !== 'room' || (o as unknown as { cfLabel?: boolean }).cfLabel !== true) return;
            const sameRoom =
                o.cf.id === room.id ||
                ((o.cf as RoomMeta).left === room.left && (o.cf as RoomMeta).top === room.top);
            if (!sameRoom) return;
            o.set({
                left: room.left + room.width / 2,
                top: room.top + room.height / 2,
                width: Math.max(40, room.width - 16)
            });
            (o as unknown as FTextbox).set({ text: room.name });
            o.setCoords();
        });
        this.canvas.requestRenderAll();
    }

    /** 统一图层顺序：房间 → 房名 → 墙 → 门 → 走廊 → 标记。
     *  新增/重建对象后调用，避免“后加的元素骑在一切上面”，让编辑态与读档后的层级一致。 */
    normalizeLayerOrder(): void {
        const rank = (o: FabricWithCf): number => {
            const t = o.cf && o.cf.type;
            if (t === 'room') return (o as unknown as { cfLabel?: boolean }).cfLabel ? 1 : 0;
            if (t === 'wall') return 2;
            if (t === 'door') return 3;
            if (t === 'corridor') return 4;
            if (t === 'marker') return 5;
            return 6;
        };
        const list = (this.canvas as unknown as { _objects: FabricWithCf[] })._objects;
        list.sort((a, b) => rank(a) - rank(b));
        this.canvas.requestRenderAll();
    }

    private rebuildObject(oldObj: FabricWithCf): void {
        const meta = oldObj.cf;
        if (!meta) return;
        this.canvas.remove(oldObj);
        let next: FabricWithCf | null = null;
        if (meta.type === 'wall') next = makeWall(meta);
        if (meta.type === 'door') next = makeDoor(meta);
        if (meta.type === 'marker') {
            const img = meta.assetId ? this.assetImages.get(meta.assetId) : undefined;
            next = img ? makeMarkerImage(meta, this.doc.grid.cell, img) : makeMarker(meta, this.doc.grid.cell);
        }
        if (!next) return;
        this.canvas.add(next);
        this.canvas.setActiveObject(next);
        this.canvas.requestRenderAll();
        this.reportSelection();
        this.emit();
    }

    private removeObject(target: FabricWithCf): void {
        const meta = target.cf;
        if (!meta) return;
        if (meta.type === 'room') {
            const labels: FabricWithCf[] = [];
            this.canvas.forEachObject((obj: FObject) => {
                const o = obj as FabricWithCf;
                if (o.cf && o.cf.type === 'room' && (o as unknown as { cfLabel?: boolean }).cfLabel && o.cf.id === meta.id) labels.push(o);
            });
            labels.forEach((l) => this.canvas.remove(l));
        }
        this.canvas.remove(target);
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
        this.reportSelection();
    }

    /* ---------------- 添加元素 ---------------- */

    addRoom(geo: { left: number; top: number; width: number; height: number }): RoomMeta {
        this.pushHistory();
        const room: RoomMeta = {
            id: nextId('room'),
            type: 'room',
            name: this.uniqueRoomName(`房间 ${this.counts().rooms + 1}`, ''),
            left: geo.left,
            top: geo.top,
            width: geo.width,
            height: geo.height
        };
        const rect = makeRoom(room);
        const label = makeRoomLabel(room);
        (label as unknown as { cfLabel?: boolean }).cfLabel = true;
        this.canvas.add(rect);
        this.canvas.add(label);
        this.canvas.setActiveObject(rect);
        this.canvas.requestRenderAll();
        this.reportSelection();
        this.emit();
        return room;
    }

    private renderChainPreview(cursor: Pt): void {
        if (this.chainPreview) this.canvas.remove(this.chainPreview);
        const pts = this.chain.concat([cursor]);
        if (pts.length < 2) return;
        const poly = new fabric.Polyline(pts, {
            fill: '',
            stroke: '#c9a84c',
            strokeWidth: 2,
            strokeDashArray: [6, 4],
            selectable: false,
            evented: false
        });
        this.chainPreview = poly;
        this.canvas.add(poly);
        this.canvas.requestRenderAll();
    }

    finishChain(): void {
        if (this.chainPreview) {
            this.canvas.remove(this.chainPreview);
            this.chainPreview = null;
        }
        const pts = this.chain.filter((p, i, arr) => i === 0 || this.dist(p, arr[i - 1]) > 1);
        this.chain = [];
        if (pts.length < 2) {
            this.canvas.requestRenderAll();
            return;
        }
        this.pushHistory();
        const wall: WallMeta = {
            id: nextId('wall'),
            type: 'wall',
            unit: 'm',
            points: pts.map((p) => ({ x: p.x, y: p.y }))
        };
        const obj = makeWall(wall);
        this.canvas.add(obj);
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();
        this.reportSelection();
        this.emit();
    }

    cancelPending(): void {
        if (this.previewRect) {
            this.canvas.remove(this.previewRect);
            this.previewRect = null;
        }
        if (this.chainPreview) {
            this.canvas.remove(this.chainPreview);
            this.chainPreview = null;
        }
        this.chain = [];
        this.roomStart = null;
        this.canvas.requestRenderAll();
    }

    private placeDoor(x: number, y: number): void {
        const g = this.doc.grid;
        const near = this.nearestWall(x, y);
        let hinge: Pt;
        let angle = 0;
        if (near && near.dist < g.cell * 0.9) {
            const wall = near.wall;
            const horizontal = Math.abs(wall.points[0].x - wall.points[wall.points.length - 1].x) >= Math.abs(wall.points[0].y - wall.points[wall.points.length - 1].y);
            angle = horizontal ? 0 : 90;
            const proj = nearestPointOnSegments(wall.points, x, y);
            const w = g.cell;
            const ux = Math.cos((angle * Math.PI) / 180);
            const uy = Math.sin((angle * Math.PI) / 180);
            hinge = { x: snapHalf(proj.x - (ux * w) / 2, g.cell), y: snapHalf(proj.y - (uy * w) / 2, g.cell) };
        } else {
            hinge = { x: snapHalf(x, g.cell), y: snapHalf(y, g.cell) };
        }
        this.pushHistory();
        const door: DoorMeta = {
            id: nextId('door'),
            type: 'door',
            kind: this.doorKind,
            x: hinge.x,
            y: hinge.y,
            angle,
            width: g.cell
        };
        const obj = makeDoor(door);
        this.canvas.add(obj);
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();
        this.reportSelection();
        this.emit();
    }

    private nearestWall(x: number, y: number): { wall: WallMeta; dist: number } | null {
        let best: { wall: WallMeta; dist: number } | null = null;
        this.canvas.forEachObject((o: FObject) => {
            const meta = (o as FabricWithCf).cf;
            if (!meta || meta.type !== 'wall') return;
            const d = nearestDistance(meta.points, x, y);
            if (!best || d < best.dist) best = { wall: meta, dist: d };
        });
        return best;
    }

    private dist(a: Pt, b: Pt): number {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    /* ---------------- 选择 / 编辑 ---------------- */

    /** 只有 ActiveSelection 才算多选；marker 本身是 fabric.Group，不能按 getObjects 判断。 */
    private isMultiSelection(o: FObject | undefined): boolean {
        if (!o) return false;
        const t = (o as unknown as { type?: string }).type;
        return t === 'activeSelection' || t === 'ActiveSelection';
    }
    private reportSelection(): void {
        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        if (!active) {
            if (this.opts.onSelection) this.opts.onSelection(null);
            if (this.opts.onMultiSelection) this.opts.onMultiSelection(null);
            return;
        }
        if (this.isMultiSelection(active)) {
            const children = (active as unknown as { getObjects: () => FabricWithCf[] }).getObjects();
            const info: MultiSelection = { count: 0, rooms: 0, walls: 0, doors: 0, corridors: 0, markers: 0 };
            for (const child of children) {
                const m = child.cf;
                if (!m) continue;
                info.count += 1;
                if (m.type === 'room') info.rooms += 1;
                else if (m.type === 'wall') info.walls += 1;
                else if (m.type === 'door') info.doors += 1;
                else if (m.type === 'corridor') info.corridors += 1;
                else if (m.type === 'marker') info.markers += 1;
            }
            if (this.opts.onSelection) this.opts.onSelection(null);
            if (this.opts.onMultiSelection) this.opts.onMultiSelection(info);
            return;
        }
        const meta = active.cf ? active.cf : null;
        if (this.opts.onMultiSelection) this.opts.onMultiSelection(null);
        if (!this.opts.onSelection) return;
        if (meta && meta.type === 'corridor') this.opts.onSelection(null);
        else this.opts.onSelection(meta);
    }

    renameSelectedRoom(name: string): void {
        const active = this.canvas.getActiveObject() as FabricWithCf | undefined;
        const meta = active && active.cf;
        if (!meta || meta.type !== 'room') return;
        this.pushHistory();
        meta.name = name || '房间';
        this.syncLabel(meta);
        this.emit();
        this.reportSelection();
    }

    renameRoomById(id: string, name: string): void {
        let target: RoomMeta | null = null;
        this.canvas.forEachObject((o: FObject) => {
            const meta = (o as FabricWithCf).cf;
            if (meta && meta.type === 'room' && meta.id === id) target = meta;
        });
        if (!target) return;
        this.pushHistory();
        const clean = this.uniqueRoomName(name.trim() || '房间', id);
        // rect 与 label 各持一份 cf，改名必须两份一起写，否则标签和存档会打架
        this.canvas.forEachObject((o: FObject) => {
            const meta = (o as FabricWithCf).cf;
            if (meta && meta.type === 'room' && meta.id === id) meta.name = clean;
        });
        this.syncLabel(target as RoomMeta);
        this.emit();
        this.reportSelection();
    }

    /** 同地图内房间名唯一：重名自动加序号，避免“删了 3 号房，新 3 号房和旧记录打架”。 */
    uniqueRoomName(base: string, selfId: string): string {
        const used = new Set<string>();
        this.canvas.forEachObject((o: FObject) => {
            const meta = (o as FabricWithCf).cf;
            if (!meta || meta.type !== 'room' || meta.id === selfId) return;
            if (meta.name) used.add(meta.name);
        });
        if (!used.has(base)) return base;
        let i = 2;
        while (used.has(`${base} (${i})`)) i += 1;
        return `${base} (${i})`;
    }

    /** 存量重复名一次性打散（生成/导入后调用） */
    dedupeRoomNames(): void {
        const used = new Set<string>();
        this.canvas.forEachObject((o: FObject) => {
            const obj = o as FabricWithCf;
            const meta = obj.cf;
            if (!meta || meta.type !== 'room' || (obj as unknown as { cfLabel?: boolean }).cfLabel) return;
            let name = meta.name || '房间';
            if (used.has(name)) {
                let i = 2;
                while (used.has(`${name} (${i})`)) i += 1;
                name = `${name} (${i})`;
                const id = meta.id;
                this.canvas.forEachObject((other: FObject) => {
                    const m = (other as FabricWithCf).cf;
                    if (m && m.type === 'room' && m.id === id) m.name = name;
                });
                this.syncLabel(meta);
            }
            used.add(name);
        });
    }

    setDocName(name: string): void {
        const clean = name.trim().slice(0, 60);
        if (!clean) return;
        this.doc.name = clean;
        this.emit();
    }

    deleteSelected(): void {
        const active = this.canvas.getActiveObject();
        if (!active) return;
        const childrenOf = (active as unknown as { getObjects?: () => FabricWithCf[] }).getObjects;
        this.pushHistory();
        if (typeof childrenOf === 'function') {
            // 组选：先把选择拆掉再逐个删（selection 里删子对象会让 fabric 状态混乱）
            const objs = childrenOf.call(active);
            this.canvas.discardActiveObject();
            objs.forEach((o) => this.removeObject(o));
            this.canvas.requestRenderAll();
            this.reportSelection();
            this.emit();
            return;
        }
        this.removeObject(active as FabricWithCf);
        this.emit();
    }

    clearAll(): void {
        this.pushHistory();
        this.canvas.clear();
        this.doc = createEmptyDoc(this.doc.name);
        this.sizeCanvas();
        this.applyBackground();
        this.canvas.requestRenderAll();
        this.emit();
        this.reportSelection();
    }

    /* ---------------- 生成 / 导出 ---------------- */

    generate(overrides: Partial<GenOptions> = {}, replace = true): MapDoc {
        const gen = generateMap(overrides);
        if (replace) {
            // 生成结果进撤销栈：生成错了 Ctrl+Z 能回来
            this.pushHistory();
            this.doc = gen;
            this.loadDoc(gen, false);
            this.dedupeRoomNames();
        } else {
            // 追加模式：保留现有元素，把生成结果并进来
            const merged: MapDoc = clone(this.doc);
            const offset = 0;
            gen.rooms.forEach((r) => merged.rooms.push({ ...r, left: r.left + offset }));
            gen.walls.forEach((w) => merged.walls.push(w));
            gen.doors.forEach((d) => merged.doors.push(d));
            gen.corridors.forEach((c) => merged.corridors.push(c));
            merged.size = {
                width: Math.max(merged.size.width, gen.size.width),
                height: Math.max(merged.size.height, gen.size.height)
            };
            this.pushHistory();
            this.doc = merged;
            this.loadDoc(merged, false);
        }
        return gen;
    }

    collect(): MapDoc {
        const doc = collectDoc(this.canvas, this.doc);
        doc.assets = this.assets.slice();
        doc.markers = doc.markers || [];
        return doc;
    }

    toJSON(): string {
        return docToJSON(this.collect());
    }

    private renderFlat(scale = 1): string {
        const vpt = (this.canvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice() as number[];
        const w = this.canvas.getWidth();
        const h = this.canvas.getHeight();
        const { width, height } = this.doc.size;
        this.canvas.setDimensions({ width, height });
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        this.canvas.renderAll();
        const url = this.canvas.toDataURL({ format: 'png', multiplier: scale });
        this.canvas.setDimensions({ width: w, height: h });
        this.canvas.setViewportTransform(vpt);
        this.canvas.requestRenderAll();
        return url;
    }

    /**
     * 导出 PNG。默认沿用当前格线显示状态与 1x 尺寸；
     * grid 可强制含/不含格线，scale 支持 1–4 倍（2x 适合印在纸质卡上）。
     */
    async exportPNG(opts: { grid?: boolean; scale?: number } = {}): Promise<string> {
        let scale = Math.max(1, Math.min(4, Math.round(opts.scale ?? 1)));
        const withGrid = opts.grid ?? this.showGrid;
        const { width, height } = this.doc.size;
        // 像素闸门：超大图幅 + 4x 会让 canvas 直接分配失败（白屏/崩溃），这里自动降倍率
        const maxScale = Math.sqrt(EXPORT_MAX_PIXELS / Math.max(1, width * height));
        const clamped = Math.max(1, Math.min(scale, Math.floor(maxScale * 100) / 100));
        this.lastExportScale = clamped;
        this.lastExportDegraded = clamped < scale;
        scale = clamped;
        const out = document.createElement('canvas');
        out.width = width * scale;
        out.height = height * scale;
        const ctx = out.getContext('2d');
        if (!ctx) return this.renderFlat(scale);
        ctx.fillStyle = pal().bg;
        ctx.fillRect(0, 0, out.width, out.height);
        if (withGrid) paintGrid(ctx, out.width, out.height, this.doc.grid, scale);
        const flat = this.renderFlat(scale);
        const img = await loadImage(flat);
        ctx.drawImage(img, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
    }
}

function nearestPointOnSegments(points: Pt[], x: number, y: number): Pt {
    let best: Pt = points[0];
    let bestD = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) {
            bestD = d;
            best = { x: px, y: py };
        }
    }
    return best;
}

function nearestDistance(points: Pt[], x: number, y: number): number {
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (d < best) best = d;
    }
    return points.length === 1 ? Math.hypot(x - points[0].x, y - points[0].y) : best;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
















