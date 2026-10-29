/* ================================================================
   ClueForge — 地图工坊数据模型  |  src/modules/mapstudio/types.ts
   这是"存档即真相"的唯一模型：画布上的 fabric 对象只是视图，
   导出（PNG / JSON）与重新打开（JSON）都以这里的文档为准。
   ================================================================ */

export type Cell = { col: number; row: number };
export type Pt = { x: number; y: number };

export type GridKind = 'square';

/** 网格（目前为方格；像素尺寸 = cell）。origin 用于将来扩展偏移。 */
export interface GridSpec {
    kind: GridKind;
    /** 每格边长，像素（受 zoom 影响前的大小）。 */
    cell: number;
    /** 1 格等于多少米（尺寸元数据口径，默认 1.5）。 */
    metersPerCell?: number;
    originX: number;
    originY: number;
}

export interface MetaBase {
    id: string;
    type: 'room' | 'wall' | 'door' | 'corridor' | 'marker';
}

/** 房间：矩形（像素坐标，左下原点由编辑器统一处理为左上原点）。 */
export interface RoomMeta extends MetaBase {
    type: 'room';
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    /** 由网格尺寸换算出的真实尺寸（米），仅作元数据。 */
    meters?: { w: number; h: number };
    /** 自由标签，方便 KP 写"调查员入口/地下室"之类。 */
    tags?: string[];
}

/** 墙体：折线，点为绝对像素坐标。 */
export interface WallMeta extends MetaBase {
    type: 'wall';
    points: Pt[];
    /** m = 米；px = 像素（只记网格）；ft = 英尺。 */
    unit: 'm' | 'px' | 'ft';
}

/** 门：以中心点 + 角度 + 宽度描述，渲染为门扇弧线。 */
export interface DoorMeta extends MetaBase {
    type: 'door';
    x: number;
    y: number;
    /** 度，0 = 门的径向朝 +x。 */
    angle: number;
    width: number;
    kind: 'door' | 'window' | 'secret';
}

export interface CorridorMeta extends MetaBase {
    type: 'corridor';
    left: number;
    top: number;
    width: number;
    height: number;
}

/** 标记/物件：FVTT 风格的 token 与道具，几何只记中心点 + 格数。 */
export interface MarkerMeta extends MetaBase {
    type: 'marker';
    /** token=圆形棋子；prop=方形物件 */
    shape: 'token' | 'prop';
    /** 中心点（像素，绝对坐标） */
    x: number;
    y: number;
    /** 占几格（1 格 = grid.cell） */
    sizeCells: number;
    /** 主色（十六进制，仅从内置色板取） */
    color: string;
    /** 单字符字形（token 上显示首字） */
    glyph: string;
    label?: string;
    /** 可选：引用 assets 里的图片（上传的 token/物件图） */
    assetId?: string;
}

/** 二进制资产（图片）以 dataURL 存档；体积在导入/上传时就被钳住。 */
export interface AssetMeta {
    id: string;
    /** 内容哈希，用于去重 */
    hash: string;
    kind: 'token' | 'prop' | 'texture';
    dataUrl: string;
    w: number;
    h: number;
    bytes: number;
}

export interface MapDoc {
    version: 1;
    name: string;
    grid: GridSpec;
    rooms: RoomMeta[];
    walls: WallMeta[];
    doors: DoorMeta[];
    corridors: CorridorMeta[];
    markers?: MarkerMeta[];
    assets?: AssetMeta[];
    /** 画布逻辑尺寸（未缩放）与当前背景图像（dataURL）。 */
    size: { width: number; height: number };
    background?: string | null;
    /** 底图是否平铺（地板材质） */
    backgroundRepeat?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

let seq = 0;
export function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function createEmptyDoc(name = '未命名地图'): MapDoc {
    return {
        version: 1,
        name,
        grid: { kind: 'square', cell: 40, originX: 0, originY: 0 },
        rooms: [],
        walls: [],
        doors: [],
        corridors: [],
        markers: [],
        assets: [],
        size: { width: 1600, height: 1000 },
        background: null,
        backgroundRepeat: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/** 像素长度 → 米：按"1 格 = N 米"换算，格子像素大小不参与口径。 */
export function gridMeters(px: number, cellPx: number, metersPerCell = 1.5): number {
    if (!cellPx) return 0;
    return (px / cellPx) * metersPerCell;
}

