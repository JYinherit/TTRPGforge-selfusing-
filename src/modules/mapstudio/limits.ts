/**
 * 地图工坊的限额唯一真源。
 *
 * 规则：限额只在这里定义；读档路径只做收敛（截断/钳制），写路径（addAsset / 导入 /
 * 底图上传）必须在这里的同一组数字上拒绝，避免“存得进、读不回”的静默丢数据。
 */

/** 文档结构上限（导入/读档时钳制，防止一份 JSON 冻死页面）。 */
export const DOC_LIMITS = {
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
    wallPoints: 500,
    /** 标记（token / 物件）上限 */
    markers: 500,
    /** 标记备注字数上限（按字符数，不按 UTF-16 码元） */
    markerLabel: 40,
    /** 图片资产：条数、单张、总量 */
    assets: 40,
    assetBytes: 300 * 1024,
    assetsTotal: 6 * 1024 * 1024
} as const;

/** 图片资产上限：写入与读取共用同一组数字。 */
export const ASSET_LIMITS = {
    /** 资产条数 */
    count: DOC_LIMITS.assets,
    /** 单张编码后的字节上限 */
    bytes: DOC_LIMITS.assetBytes,
    /** 全部资产编码后的总字节上限 */
    totalBytes: DOC_LIMITS.assetsTotal,
    /** token / 物件贴图的边长上限 */
    maxSideToken: 256,
    /** 地板材质（需要平铺，稍大一点）的边长上限 */
    maxSideTexture: 512
} as const;

/** 撤销栈总字节上限：超过就丢最老的一步，避免 60 步 × 大底图把内存吃光。 */
export const UNDO_MAX_BYTES = 8 * 1024 * 1024;

/** 导出 PNG 的像素总量上限（宽 × 高 × 倍率²），超过就自动降倍率。 */
export const EXPORT_MAX_PIXELS = 24 * 1024 * 1024;

/** 估算 dataURL 的编码后字节数。 */
export function dataUrlBytes(dataUrl: string): number {
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? Math.floor((dataUrl.length - comma - 1) * 0.75) : 0;
}

/**
 * 内容指纹：FNV-1a 32 位 + 长度。
 * 旧实现用「长度 + 末尾 48 字符」，等长同尾的不同 PNG 会串图；这里改为全串散列。
 */
export function contentHash(dataUrl: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < dataUrl.length; i++) {
        h ^= dataUrl.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${(h >>> 0).toString(16)}_${dataUrl.length.toString(36)}`;
}
