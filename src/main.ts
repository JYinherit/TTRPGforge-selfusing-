/* ================================================================
   ClueForge — 新应用入口  |  src/main.ts
   职责：
   1) 把 fabric / roughjs / marked 回填成全局变量（老模块按经典脚本使用它们）
   2) 挂载地图工坊面板
   3) 暴露 window.ClueForgeBridge，供 project.js 存取地图文档
   构建产物 dist/clueforge-studio.js，IIFE 经典脚本，index.html 里先于老模块执行。
   ================================================================ */
import { exposeLegacyGlobals } from './vendor';
import { mountMapStudio } from './modules/mapstudio/ui';
import type { MapDoc } from './modules/mapstudio/types';
import type { MapStudio } from './modules/mapstudio/studio';

exposeLegacyGlobals();

declare global {
    interface Window {
        ClueForgeBridge?: {
            version: string;
            mount(): void;
            onTabShown(tab: string): void;
            /** 调试/自动化入口：直接拿到编辑器实例 */
            studio: MapStudio;
            getDoc(): MapDoc | null;
            /** 返回 false 表示数据未通过校验、画布未改动 */
            loadDoc(raw: unknown): boolean;
            /** 清空画布（载入不含地图数据的老项目时调用） */
            clearDoc(): void;
        };
    }
}

function boot(): void {
    const panel = document.getElementById('mapStudioPanel');
    if (!panel) {
        console.warn('[clueforge] 找不到 #mapStudioPanel，地图工坊未挂载');
        return;
    }
    // 持久化存储：IndexedDB 在磁盘紧张/清理时可能被整源回收，主动申请一次 persist
    try {
        void navigator.storage?.persist?.().then((ok) => {
            if (!ok) console.info('[clueforge] 浏览器未授予持久化存储，清缓存可能丢存档');
        });
    } catch {
        /* 老浏览器无 storage.persist，忽略 */
    }
    try {
        const api = mountMapStudio();
        window.ClueForgeBridge = {
            version: '0.6.0',
            studio: api.studio,
            mount: () => api.mount(),
            onTabShown: (tab: string) => api.onTabShown(tab),
            getDoc: () => {
                try {
                    return api.getDoc();
                } catch (e) {
                    console.warn('[clueforge] 地图工坊取数失败', e);
                    return null;
                }
            },
            loadDoc: (raw: unknown) => {
                try {
                    return api.loadDoc(raw);
                } catch (e) {
                    console.warn('[clueforge] 地图工坊数据恢复失败', e);
                    return false;
                }
            },
            clearDoc: () => {
                try {
                    api.clearDoc();
                } catch (e) {
                    console.warn('[clueforge] 地图工坊清空失败', e);
                }
            }
        };
        console.info('[clueforge] 地图工坊就绪 · v0.6.0');
    } catch (e) {
        console.error('[clueforge] 地图工坊初始化失败', e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
