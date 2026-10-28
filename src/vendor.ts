/* ================================================================
   ClueForge — 第三方依赖本地化  |  src/vendor.ts
   把 fabric / roughjs / marked 打进 IIFE 产物，并回填到 window，
   让仍然以"全局脚本"方式编写的老模块（map.js 等）继续可用。
   ================================================================ */
import * as fabricPkg from 'fabric';
import * as roughPkg from 'roughjs';
import * as markedPkg from 'marked';

type AnyDict = Record<string, any>;

function pickFabric(mod: AnyDict): any {
    if (mod && mod.fabric) return mod.fabric;
    if (mod && mod.default && mod.default.fabric) return mod.default.fabric;
    if (mod && mod.default) return mod.default;
    return mod;
}

function pickRough(mod: AnyDict): any {
    if (mod && mod.default && mod.default.svg) return mod.default;
    if (mod && mod.default && mod.default.rough) return mod.default.rough;
    if (mod && mod.rough) return mod.rough;
    if (mod && mod.svg) return mod;
    return mod;
}

function pickMarked(mod: AnyDict): any {
    if (mod && mod.marked) return mod.marked;
    if (mod && mod.default) return mod.default;
    return mod;
}

export const fabric: any = pickFabric(fabricPkg as unknown as AnyDict);
export const rough: any = pickRough(roughPkg as unknown as AnyDict);
export const marked: any = pickMarked(markedPkg as unknown as AnyDict);

/** 在 legacy 脚本执行前把依赖放回 window（index.html 已删掉 CDN 标签）。 */
export function exposeLegacyGlobals(): void {
    const g = window as unknown as AnyDict;
    if (!g.fabric) g.fabric = fabric;
    if (!g.rough) g.rough = rough;
    if (!g.marked) g.marked = marked;
}
