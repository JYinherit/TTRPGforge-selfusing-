/* ================================================================
   ClueForge — fabric 对象工厂  |  src/modules/mapstudio/objects.ts
   每个 fabric 对象身上挂 .cf = 它对应的文档条目；渲染与存档分离。
   墙/门只允许"移动"（缩放/旋转禁用），几何以文档点为真相。
   ================================================================ */
import { fabric } from '../../vendor';
import type { fabric as FabricNs } from 'fabric';
import type { CorridorMeta, DoorMeta, RoomMeta, WallMeta } from './types';

export const INK = '#cfc7b8';
export const INK_DIM = '#8b8577';
export const GOLD = '#c9a84c';

/** fabric 5 的对象类型（fabric 包本身不带 d.ts，走 @types/fabric 的命名空间） */
export type FObject = FabricNs.Object;
export type FCanvas = FabricNs.Canvas;
export type FRect = FabricNs.Rect;
export type FPolyline = FabricNs.Polyline;
export type FTextbox = FabricNs.Textbox;
export type FIEvent = FabricNs.IEvent<Event>;

export interface CfAnchor {
    left: number;
    top: number;
}

export interface FabricWithCf extends FObject {
    cf?: RoomMeta | WallMeta | DoorMeta | CorridorMeta;
    /** 房间名标签标记：与房间矩形共用同一个 cf，回收几何时跳过它 */
    cfLabel?: boolean;
    /** 对象创建时的 left/top；object:modified 用它算整体位移（墙/门没有 cf 坐标兜底） */
    cfAnchor?: CfAnchor;
}

export function makeRoom(room: RoomMeta): FabricWithCf {
    const rect = new fabric.Rect({
        left: room.left,
        top: room.top,
        width: room.width,
        height: room.height,
        fill: 'rgba(122,120,170,0.14)',
        stroke: '#9a95b8',
        strokeWidth: 1.5,
        strokeUniform: true,
        hasRotatingPoint: false,
        lockRotation: true,
        cornerColor: GOLD,
        cornerStrokeColor: '#2a2a3a',
        cornerSize: 9,
        transparentCorners: false,
        borderColor: GOLD,
        padding: 2
    }) as FabricWithCf;
    rect.cf = room;
    return rect;
}

export function makeRoomLabel(room: RoomMeta): FabricWithCf {
    const label = new fabric.Textbox(room.name || '房间', {
        left: room.left + room.width / 2,
        top: room.top + room.height / 2,
        width: Math.max(40, room.width - 16),
        fontSize: 18,
        fontWeight: '500',
        lineHeight: 1.15,
        fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
        fill: '#d8d0c0',
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        hoverCursor: 'default'
    }) as FabricWithCf;
    label.cf = room;
    label.cfLabel = true;
    return label;
}

export function makeWall(wall: WallMeta): FabricWithCf {
    const poly = new fabric.Polyline(
        wall.points.map((p) => ({ x: p.x, y: p.y })),
        {
            fill: '',
            stroke: INK,
            strokeWidth: 3,
            strokeLineJoin: 'round',
            strokeLineCap: 'round',
            strokeUniform: true,
            hasControls: false,
            hasBorders: false,
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
            hoverCursor: 'move',
            objectCaching: false
        }
    ) as FabricWithCf;
    poly.cf = wall;
    poly.cfAnchor = { left: poly.left || 0, top: poly.top || 0 };
    return poly;
}

export function doorGeometry(meta: DoorMeta): {
    hinge: { x: number; y: number };
    closed: { x: number; y: number };
    tip: { x: number; y: number };
} {
    const a = ((meta.angle ?? 0) * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // v = u 旋转 90°（屏幕坐标系 y 向下）
    const vx = -uy;
    const vy = ux;
    const w = meta.width;
    return {
        hinge: { x: meta.x, y: meta.y },
        closed: { x: meta.x + ux * w, y: meta.y + uy * w },
        tip: { x: meta.x + vx * w, y: meta.y + vy * w }
    };
}

export function doorPathString(meta: DoorMeta): string {
    const { hinge, closed, tip } = doorGeometry(meta);
    const n = (v: number) => Math.round(v * 100) / 100;
    const h = `${n(hinge.x)} ${n(hinge.y)}`;
    const c = `${n(closed.x)} ${n(closed.y)}`;
    const t = `${n(tip.x)} ${n(tip.y)}`;
    const w = n(meta.width);
    if (meta.kind === 'window') {
        const a = ((meta.angle ?? 0) * Math.PI) / 180;
        const ox = -Math.sin(a) * 2.5;
        const oy = Math.cos(a) * 2.5;
        return [
            `M ${n(hinge.x + ox)} ${n(hinge.y + oy)} L ${n(closed.x + ox)} ${n(closed.y + oy)}`,
            `M ${n(hinge.x - ox)} ${n(hinge.y - oy)} L ${n(closed.x - ox)} ${n(closed.y - oy)}`
        ].join(' ');
    }
    if (meta.kind === 'secret') {
        return `M ${h} L ${c} M ${h} L ${t}`;
    }
    return `M ${h} L ${c} M ${h} L ${t} M ${c} A ${w} ${w} 0 0 1 ${t}`;
}

export function makeDoor(meta: DoorMeta): FabricWithCf {
    const path = new fabric.Path(doorPathString(meta), {
        fill: '',
        stroke: meta.kind === 'secret' ? INK_DIM : '#b8b2a2',
        strokeWidth: meta.kind === 'window' ? 1.4 : 1.8,
        strokeUniform: true,
        strokeDashArray: meta.kind === 'secret' ? [6, 4] : null,
        hasControls: false,
        hasBorders: false,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        hoverCursor: 'move',
        objectCaching: false
    }) as FabricWithCf;
    path.cf = meta;
    path.cfAnchor = { left: path.left || 0, top: path.top || 0 };
    return path;
}

export function makeCorridor(meta: CorridorMeta): FabricWithCf {
    const rect = new fabric.Rect({
        left: meta.left,
        top: meta.top,
        width: meta.width,
        height: meta.height,
        fill: 'rgba(201,168,76,0.06)',
        stroke: 'rgba(201,168,76,0.40)',
        strokeWidth: 1,
        strokeDashArray: [6, 6],
        // 走廊也是地图元素：能选中才能改、能删（否则只能整图重来）
        selectable: true,
        evented: true,
        lockRotation: true,
        hoverCursor: 'move'
    }) as FabricWithCf;
    rect.cf = meta;
    return rect;
}

/** 把对象几何重新对齐到它的 cf 文档条目（对象被移动/缩放后重建用）。 */
export function rebuildByMeta(oldObj: FabricWithCf): FabricWithCf | null {
    const meta = oldObj.cf;
    if (!meta) return null;
    if (meta.type === 'wall') return makeWall(meta);
    if (meta.type === 'door') return makeDoor(meta);
    return null;
}
