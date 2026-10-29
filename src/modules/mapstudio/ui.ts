/* ================================================================
   ClueForge — 地图工坊面板  |  src/modules/mapstudio/ui.ts
   把 MapStudio 挂到 #mapStudioPanel：工具栏 / 画布 / 检查器 / 自动生成。
   对外只暴露 window.ClueForgeBridge（见 src/main.ts），老模块通过它存取数据。
   ================================================================ */
import { lengthToMeters } from './grid';
import { ASSET_LIMITS, EXPORT_MAX_PIXELS } from './limits';
import { MARKER_COLORS } from './objects';
import { pal } from './theme';
import { validateMapDoc } from './serialize';
import { buildShareHtml, estimateShareBytes } from './share/build';
import { MapStudio } from './studio';
import type { StudioStatus, Tool, DoorKind, MarkerShape, MultiSelection } from './studio';
import { createEmptyDoc } from './types';
import type { DoorMeta, MapDoc, MarkerMeta, RoomMeta, WallMeta } from './types';

type SelectionInfo = RoomMeta | WallMeta | DoorMeta | MarkerMeta | null;

const TEMPLATE = `
<div class="cf-ms">
  <header class="cf-ms-head">
    <div class="cf-ms-title">
      <span class="cf-ms-badge">MAP STUDIO</span>
      <div>
        <h2>地图工坊</h2>
        <p>房间 · 墙体 · 门洞 · 尺寸元数据 · 程序化楼层</p>
      </div>
    </div>
    <div class="cf-ms-head-actions">
      <button class="cf-ms-btn" id="cfMsNew" title="清空画布（可撤销）">新建</button>
      <label class="cf-ms-btn" title="载入一张旧地图当底图，在上面描房间和墙">
        载入底图
        <input type="file" id="cfMsBg" accept="image/*" hidden />
      </label>
      <span class="cf-ms-divider" aria-hidden="true"></span>
      <label class="cf-ms-btn" title="导入地图 JSON（覆盖当前工坊地图，可撤销）">
        导入 JSON
        <input type="file" id="cfMsJsonIn" accept=".json,application/json" hidden />
      </label>
      <button class="cf-ms-btn" id="cfMsPng" title="导出当前地图为 PNG">导出 PNG</button>
      <select class="cf-ms-select" id="cfMsPngOpt" title="导出规格：倍率与是否带格线">
        <option value="1-0">1x</option>
        <option value="1-1">1x+格线</option>
        <option value="2-0">2x</option>
        <option value="2-1">2x+格线</option>
      </select>
      <button class="cf-ms-btn" id="cfMsShare" title="导出一个自包含 HTML：玩家双击就能看，只读、无网络、已剥离备注">分享 HTML</button>
      <button class="cf-ms-btn gold" id="cfMsJson" title="导出地图 JSON（可被工程文件引用）">导出 JSON</button>
    </div>
  </header>

  <div class="cf-ms-body">
    <aside class="cf-ms-side">
      <div class="cf-ms-group">
        <div class="cf-ms-label">工具</div>
        <div class="cf-ms-toolgrid">
          <button class="cf-ms-tool active" data-tool="select"><b>V</b>选择</button>
          <button class="cf-ms-tool" data-tool="room"><b>R</b>房间</button>
          <button class="cf-ms-tool" data-tool="wall"><b>W</b>墙体</button>
          <button class="cf-ms-tool" data-tool="door"><b>D</b>门</button>
          <button class="cf-ms-tool" data-tool="marker"><b>M</b>标记</button>
          <button class="cf-ms-tool" data-tool="erase"><b>X</b>擦除</button>
        </div>
      </div>

      <div class="cf-ms-group">
        <div class="cf-ms-label">门型</div>
        <div class="cf-ms-toolgrid cols3">
          <button class="cf-ms-tool small active" data-door="door">平开</button>
          <button class="cf-ms-tool small" data-door="window">窗</button>
          <button class="cf-ms-tool small" data-door="secret">暗门</button>
        </div>
      </div>

      <div class="cf-ms-group">
        <div class="cf-ms-label">标记类型</div>
        <div class="cf-ms-toolgrid cols3">
          <button class="cf-ms-tool small active" data-marker="token">Token</button>
          <button class="cf-ms-tool small" data-marker="prop">物件</button>
          <button class="cf-ms-tool small" id="cfMsUploadBtn" title="给选中的标记上传图片">上传图</button>
        </div>
        <input type="file" id="cfMsImgIn" accept="image/*" hidden />
      </div>

      <div class="cf-ms-group">
        <div class="cf-ms-label">网格</div>
        <div class="cf-ms-row">
          <input class="cf-ms-range" id="cfMsCell" type="range" min="16" max="96" step="4" value="40" />
          <output class="cf-ms-num" id="cfMsCellVal">40px</output>
        </div>
        <div class="cf-ms-row">
          <span class="cf-ms-k">1 格 =</span>
          <input class="cf-ms-input" id="cfMsMeters" type="number" min="0.2" max="30" step="0.1" value="1.5" />
          <span class="cf-ms-k">米</span>
        </div>
        <label class="cf-ms-check"><input type="checkbox" id="cfMsGrid" checked /> 显示格线</label>
        <label class="cf-ms-check"><input type="checkbox" id="cfMsRepeat" /> 底图按格平铺（地板材质）</label>
      </div>

      <div class="cf-ms-group">
        <div class="cf-ms-label">视图</div>
        <div class="cf-ms-row">
          <button class="cf-ms-btn mini" id="cfMsZoomOut">−</button>
          <span class="cf-ms-zoom" id="cfMsZoom">75%</span>
          <button class="cf-ms-btn mini" id="cfMsZoomIn">+</button>
          <button class="cf-ms-btn mini" id="cfMsFit">适配</button>
        </div>
        <div class="cf-ms-row">
          <button class="cf-ms-btn mini" id="cfMsUndo">撤销</button>
          <button class="cf-ms-btn mini" id="cfMsRedo">重做</button>
          <span class="cf-ms-divider" aria-hidden="true"></span>
          <button class="cf-ms-btn mini danger" id="cfMsDelete">删除</button>
        </div>
      </div>

      <div class="cf-ms-group grow">
        <div class="cf-ms-label">自动生成</div>
        <div class="cf-ms-row"><span class="cf-ms-k">seed</span><input class="cf-ms-input" id="cfMsSeed" value="ashcroft" /></div>
        <div class="cf-ms-row"><span class="cf-ms-k">房间数</span><input class="cf-ms-input" id="cfMsRoomCount" type="number" min="1" max="12" value="7" /></div>
        <div class="cf-ms-row">
          <span class="cf-ms-k">列×行</span>
          <input class="cf-ms-input" id="cfMsCols" type="number" min="6" max="60" value="26" aria-label="列数" placeholder="列" />
          <input class="cf-ms-input" id="cfMsRows" type="number" min="6" max="60" value="18" aria-label="行数" placeholder="行" />
        </div>
        <label class="cf-ms-check"><input type="checkbox" id="cfMsGenDoors" checked /> 自动开门</label>
        <button class="cf-ms-btn primary block" id="cfMsGenerate">生成楼层</button>
        <p class="cf-ms-hint">同一 seed 永远得到同一张图，方便 KP 反复出同一套房型。</p>
      </div>
    </aside>

    <section class="cf-ms-center">
      <div class="cf-ms-stage" id="cfMsStage">
        <div class="cf-ms-canvas-wrap">
          <canvas id="cfMsGridLayer" class="cf-ms-grid"></canvas>
          <canvas id="cfStCanvas"></canvas>
        </div>
        <div class="cf-ms-empty" id="cfMsEmpty">
          <div class="cf-ms-empty-card">
            <div class="cf-ms-empty-icon" aria-hidden="true">▦</div>
            <h3>空白地图</h3>
            <p>用「房间 / 墙体」自己画，或直接生成一层。</p>
            <button class="cf-ms-btn primary" id="cfMsEmptyGen">生成楼层</button>
          </div>
        </div>
      </div>
      <footer class="cf-ms-status">
        <span id="cfMsCounts">房间 0 · 墙 0 · 门 0</span>
        <span class="cf-ms-hint" id="cfMsHint">拖动选择 · Delete 删除 · Ctrl+Z 撤销</span>
        <span class="cf-ms-hint" id="cfMsSave" aria-live="polite"></span>
      </footer>
    </section>

    <aside class="cf-ms-inspector">
      <div class="cf-ms-label">选中对象</div>
      <div id="cfMsInspector">
        <div class="cf-ms-ins-empty">
          <div class="cf-ms-ins-empty-icon" aria-hidden="true">◎</div>
          <b>未选中对象</b>
          <span>点房间：改名、看尺寸</span>
          <span>点墙体：看折点与总长</span>
          <span>点门/窗：看类型与朝向</span>
        </div>
      </div>
    </aside>
  </div>
</div>
`;

export interface MapStudioPanelApi {
    studio: MapStudio;
    mount(): void;
    isMounted(): boolean;
    getDoc(): MapDoc;
    /** 校验失败返回 false 且不触碰画布；调用方据此提示用户 */
    loadDoc(raw: unknown): boolean;
    /** 清空画布（载入不含地图工坊数据的旧项目时用，避免把上一个项目的图带进新项目） */
    clearDoc(): void;
    onTabShown(tab: string): void;
}

let api: MapStudioPanelApi | null = null;

function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`[mapstudio] 缺少 DOM 节点 #${id}`);
    return node as T;
}

export function mountMapStudio(): MapStudioPanelApi {
    if (api) return api;

    const panel = el<HTMLDivElement>('mapStudioPanel');
    panel.innerHTML = TEMPLATE;

    const stage = el<HTMLDivElement>('cfMsStage');
    const gridCanvas = el<HTMLCanvasElement>('cfMsGridLayer');
    const countsEl = el<HTMLSpanElement>('cfMsCounts');
    const hintEl = el<HTMLSpanElement>('cfMsHint');
    const zoomEl = el<HTMLSpanElement>('cfMsZoom');
    const emptyEl = el<HTMLDivElement>('cfMsEmpty');
    const inspectorEl = el<HTMLDivElement>('cfMsInspector');
    const cellInput = el<HTMLInputElement>('cfMsCell');
    const cellVal = el<HTMLOutputElement>('cfMsCellVal');
    const metersInput = el<HTMLInputElement>('cfMsMeters');
    const undoBtn = el<HTMLButtonElement>('cfMsUndo');
    const redoBtn = el<HTMLButtonElement>('cfMsRedo');

    let fitted = false;

    const studio = new MapStudio({
        gridCanvas,
        stage,
        onStatus: (s) => applyStatus(s),
        onSelection: (meta) => renderInspector(meta),
        onMultiSelection: (info) => renderMultiInspector(info),
        onHistory: (undo, redo) => {
            undoBtn.disabled = undo === 0;
            redoBtn.disabled = redo === 0;
        }
    });

    function applyStatus(s: StudioStatus): void {
        countsEl.textContent = `房间 ${s.rooms} · 墙 ${s.walls} · 门 ${s.doors} · 标记 ${s.markers}`;
        hintEl.textContent = s.hint;
        zoomEl.textContent = `${s.zoomPct}%`;
        const empty = s.rooms + s.walls + s.doors + s.markers === 0;
        emptyEl.style.display = empty ? 'flex' : 'none';
        document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-tool]').forEach((b) => {
            b.classList.toggle('active', b.dataset.tool === s.tool);
        });
    }

    function syncCellUi(): void {
        cellInput.value = String(studio.doc.grid.cell);
        cellVal.textContent = `${studio.doc.grid.cell}px`;
        metersInput.value = String(studio.getMetersPerCell());
        const repeatEl = el<HTMLInputElement>('cfMsRepeat');
        repeatEl.checked = studio.doc.backgroundRepeat === true;
    }

    /* ---------- 工具栏 ---------- */
    document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
            studio.setTool((btn.dataset.tool || 'select') as Tool);
        });
    });

    document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-door]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-door]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            studio.setDoorKind((btn.dataset.door || 'door') as DoorKind);
        });
    });

    document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-marker]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-marker]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            studio.setMarkerShape((btn.dataset.marker || 'token') as MarkerShape);
        });
    });

    /* ---------- 图片资产：压到 256px 以内再进存档，避免一张 JPEG 把工程撑爆 ---------- */
    const imgInput = el<HTMLInputElement>('cfMsImgIn');

    function shrinkImage(file: File, maxSide: number = ASSET_LIMITS.maxSideToken): Promise<{ dataUrl: string; w: number; h: number }> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('图片解码失败'));
                img.onload = () => {
                    const max = maxSide;
                    const scale = Math.min(1, max / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * scale));
                    const h = Math.max(1, Math.round(img.height * scale));
                    const cv = document.createElement('canvas');
                    cv.width = w;
                    cv.height = h;
                    const ctx = cv.getContext('2d');
                    if (!ctx) {
                        reject(new Error('无法创建画布'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve({ dataUrl: cv.toDataURL('image/png'), w, h });
                };
                img.src = String(reader.result || '');
            };
            reader.readAsDataURL(file);
        });
    }

    async function takeImage(file: File | null): Promise<void> {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert('只支持图片文件（PNG / JPG / WebP）。');
            return;
        }
        try {
            const { dataUrl, w, h } = await shrinkImage(file, ASSET_LIMITS.maxSideToken);
            // 有选中标记 → 换图；没选中 → 作为底图/地板材质载入
            const selected = studio.activeMeta();
            if (selected && selected.type === 'marker') {
                if (!studio.attachImageToSelected(dataUrl, w, h)) alert('图片过大（单张上限 300KB），换一张小一点的。');
                return;
            }
            const repeat = el<HTMLInputElement>('cfMsRepeat').checked;
            // 底图/地板材质可以大一点（要平铺），但仍有边长上限；texture 单独压一次
            const tex = repeat ? await shrinkImage(file, ASSET_LIMITS.maxSideTexture) : { dataUrl, w, h };
            studio.commitBackground(tex.dataUrl, repeat);
        } catch (err) {
            alert(String((err as Error).message || err));
        } finally {
            imgInput.value = '';
        }
    }

    el<HTMLButtonElement>('cfMsUploadBtn').addEventListener('click', () => {
        const selected = studio.activeMeta();
        if (!selected || selected.type !== 'marker') {
            alert('先点选一个标记（M 键放置），再上传图片；未选中时会作为底图载入。');
            return;
        }
        imgInput.click();
    });
    imgInput.addEventListener('change', () => void takeImage(imgInput.files && imgInput.files[0] ? imgInput.files[0] : null));

    cellInput.addEventListener('input', () => {
        const v = Number(cellInput.value);
        studio.setGridCell(v);
        cellVal.textContent = `${studio.doc.grid.cell}px`;
    });

    metersInput.addEventListener('change', () => {
        studio.setMetersPerCell(Number(metersInput.value) || 1.5);
        metersInput.value = String(studio.getMetersPerCell());
    });

    el<HTMLInputElement>('cfMsRepeat').addEventListener('change', (e) => {
        studio.setBackgroundRepeat((e.target as HTMLInputElement).checked);
    });

    el<HTMLInputElement>('cfMsGrid').addEventListener('change', (e) => {
        studio.toggleGrid((e.target as HTMLInputElement).checked);
    });

    el<HTMLButtonElement>('cfMsZoomIn').addEventListener('click', () => studio.zoomBy(1.2));
    el<HTMLButtonElement>('cfMsZoomOut').addEventListener('click', () => studio.zoomBy(1 / 1.2));
    el<HTMLButtonElement>('cfMsFit').addEventListener('click', () => {
        studio.fitZoom();
        fitted = true;
    });
    undoBtn.addEventListener('click', () => studio.undo());
    redoBtn.addEventListener('click', () => studio.redo());
    el<HTMLButtonElement>('cfMsDelete').addEventListener('click', () => studio.deleteSelected());

    /* ---------- 自动生成 ---------- */
    function docSlug(): string {
        const raw = (studio.collect().name || '未命名地图').trim();
        return raw.replace(/[\\/:*?"<>|\s·、，。！？；：（）()【】《》]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'map';
    }

    /** 本次会话内的导出序号，保证同名地图连续出图不互相覆盖。 */
    let pngSeq = 0;

    function generateNow(): void {
        const seed = el<HTMLInputElement>('cfMsSeed').value.trim() || 'ashcroft';
        const roomCount = Number(el<HTMLInputElement>('cfMsRoomCount').value) || 7;
        const cols = Number(el<HTMLInputElement>('cfMsCols').value) || 26;
        const rows = Number(el<HTMLInputElement>('cfMsRows').value) || 18;
        const doors = el<HTMLInputElement>('cfMsGenDoors').checked;
        const cell = studio.doc.grid.cell;
        const counts = studio.counts();
        if (counts.rooms + counts.walls + counts.doors > 0) {
            if (!confirm('生成会替换当前地图（Ctrl+Z 可撤销），继续？')) return;
        }
        studio.generate({ seed, roomCount, cols, rows, doors, cell }, true);
        studio.fitZoom();
        fitted = true;
        syncCellUi();
    }
    el<HTMLButtonElement>('cfMsGenerate').addEventListener('click', generateNow);
    // 空态里的入口与左栏按钮等价：第一次进来就有唯一动作
    el<HTMLButtonElement>('cfMsEmptyGen').addEventListener('click', generateNow);

    /* ---------- 新建 / 导出 / 底图 ---------- */
    const titleEl = document.querySelector('#mapStudioPanel .cf-ms-title h2');
    if (titleEl) {
        titleEl.setAttribute('title', '双击改地图名');
        titleEl.addEventListener('dblclick', () => {
            const next = window.prompt('地图名', studio.collect().name);
            if (next !== null) {
                studio.setDocName(next);
                titleEl.textContent = studio.collect().name;
            }
        });
    }

    // 存档反馈：project.js 把「有更改… / 保存中… / 已自动保存 (hh:mm:ss)」写进 #cache-status，
    // 这里镜像到工坊状态栏，免得用户以为改的东西没落盘。
    const cacheStatus = document.getElementById('cache-status');
    const saveEl = document.getElementById('cfMsSave');
    if (cacheStatus && saveEl) {
        const mirror = (): void => {
            const text = (cacheStatus.textContent || '').trim();
            saveEl.textContent = text ? '存档：' + text : '';
        };
        mirror();
        new MutationObserver(mirror).observe(cacheStatus, { childList: true, characterData: true, subtree: true });
    }

    el<HTMLButtonElement>('cfMsNew').addEventListener('click', () => {
        if (studio.counts().rooms + studio.counts().walls + studio.counts().doors > 0) {
            if (!confirm('清空当前地图？可以用 Ctrl+Z 撤销。')) return;
        }
        studio.pushHistory();
        studio.loadDoc(createEmptyDoc(), false);
        syncCellUi();
    });

    el<HTMLButtonElement>('cfMsPng').addEventListener('click', async () => {
        const opt = el<HTMLSelectElement>('cfMsPngOpt').value || '1-0';
        const [s, g] = opt.split('-');
        const dataUrl = await studio.exportPNG({ scale: Number(s) || 1, grid: g === '1' });
        const scaleTag = studio.lastExportDegraded ? `@${studio.lastExportScale.toFixed(2)}x` : `@${Number(s) || 1}x`;
        pngSeq += 1;
        downloadDataUrl(dataUrl, `${docSlug()}-${stamp()}-p${pngSeq}${scaleTag}${g === '1' ? '-grid' : ''}.png`);
        if (studio.lastExportDegraded) {
            hintEl.textContent = `图幅过大，已自动降到 ${studio.lastExportScale.toFixed(2)}x（像素上限 ${Math.round(EXPORT_MAX_PIXELS / 1048576)}M）`;
            hintEl.classList.add('warn');
        }
    });

    el<HTMLButtonElement>('cfMsShare').addEventListener('click', () => {
        try {
            const doc = studio.collect();
            let light = false;
            const bytes = estimateShareBytes(doc, { light });
            if (bytes > 4 * 1024 * 1024) {
                light = window.confirm(
                    `这份地图含贴图约 ${(bytes / 1048576).toFixed(1)} MB，发给玩家会很重。\n` +
                    '改用轻量模式？（剥掉贴图与底图，标记退化成色块 + 字形，体积可降一个数量级）'
                );
            }
            const html = buildShareHtml(doc, { light });
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            downloadDataUrl(url, `${docSlug()}-${stamp()}${light ? '-lite' : ''}.html`);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            hintEl.textContent = light
                ? '已导出轻量分享页：玩家版（无备注、无贴图），双击即看'
                : '已导出分享页：玩家版（已剥离备注），双击即看，无网络请求';
            hintEl.classList.remove('warn');
        } catch (err) {
            window.alert('分享页导出失败：' + (err instanceof Error ? err.message : String(err)));
        }
    });

    el<HTMLButtonElement>('cfMsJson').addEventListener('click', () => {
        const blob = new Blob([studio.toJSON()], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        downloadDataUrl(url, `${docSlug()}-${stamp()}.json`);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

    el<HTMLInputElement>('cfMsJsonIn').addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const check = validateMapDoc(JSON.parse(String(reader.result)));
                if (!check.ok) {
                    window.alert('这个文件不是地图 JSON：' + check.reason);
                    return;
                }
                studio.pushHistory();
                studio.loadDoc(check.doc, false);
                studio.dedupeRoomNames();
                syncCellUi();
                studio.fitZoom();
                fitted = true;
            } catch (err) {
                window.alert('这个文件不是地图 JSON：' + (err as Error).message);
            }
        };
        reader.readAsText(file);
        input.value = '';
    });

    el<HTMLInputElement>('cfMsBg').addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files && (e.target as HTMLInputElement).files![0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            studio.pushHistory();
            studio.setBackground(String(reader.result));
        };
        reader.readAsDataURL(file);
        (e.target as HTMLInputElement).value = '';
    });

    /* ---------- 检查器 ---------- */
    function renderMultiInspector(info: MultiSelection | null): void {
        // 单选/空选由 renderInspector 负责；这里只处理真正的组选。
        // 注意：构造期回调会先触发一次，此时 const studio 还没赋值，不能碰 studio。
        if (!info || info.count === 0) return;
        const parts: string[] = [];
        if (info.rooms) parts.push(`房间 ${info.rooms}`);
        if (info.walls) parts.push(`墙 ${info.walls}`);
        if (info.doors) parts.push(`门 ${info.doors}`);
        if (info.corridors) parts.push(`走廊 ${info.corridors}`);
        if (info.markers) parts.push(`标记 ${info.markers}`);
        inspectorEl.innerHTML = [
            '<div class="cf-ms-insp">',
            '<div class="cf-ms-ins-type">已选 ' + info.count + ' 个</div>',
            `<div class="cf-ms-kv"><span>构成</span><b>${escapeHtml(parts.join(' · ') || '—')}</b></div>`,
            '<p class="cf-ms-hint">拖动可整体移动（吸附网格）；Delete 或下面的按钮批量删除。</p>',
            '<button class="cf-ms-btn danger block" id="cfMsBatchDelete">删除这 ' + info.count + ' 个</button>',
            '</div>'
        ].join('');
        const batchBtn = document.getElementById('cfMsBatchDelete');
        if (batchBtn) batchBtn.addEventListener('click', () => studio.deleteSelected());
    }

    function renderInspector(meta: SelectionInfo): void {
        if (!meta) {
            inspectorEl.innerHTML = [
                '<div class="cf-ms-ins-empty">',
                '<div class="cf-ms-ins-empty-icon" aria-hidden="true">◎</div>',
                '<b>未选中对象</b>',
                '<span>点房间：改名、看尺寸</span>',
                '<span>点墙体：看折点与总长</span>',
                '<span>点门/窗：看类型与朝向</span>',
                '<span>点标记：改颜色、字形、图片</span>',
                '<span>拖框或 Shift+点击：多选</span>',
                '</div>'
            ].join('');
            return;
        }
        const g = studio.doc.grid;
        const mpc = studio.getMetersPerCell();
        if (meta.type === 'room') {
            const mw = lengthToMeters(meta.width, g, mpc);
            const mh = lengthToMeters(meta.height, g, mpc);
            inspectorEl.innerHTML = [
                '<div class="cf-ms-insp">',
                '<div class="cf-ms-ins-type">房间</div>',
                `<input class="cf-ms-input wide" id="cfMsRoomName" value="${escapeHtml(meta.name)}" />`,
                `<div class="cf-ms-kv"><span>尺寸(px)</span><b>${Math.round(meta.width)} × ${Math.round(meta.height)} px</b></div>`,
                `<div class="cf-ms-kv"><span>约合(m)</span><b>${mw} × ${mh} m</b></div>`,
                '</div>'
            ].join('');
            const nameInput = document.getElementById('cfMsRoomName') as HTMLInputElement | null;
            if (nameInput) {
                nameInput.addEventListener('change', () => studio.renameSelectedRoom(nameInput.value.trim()));
                nameInput.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                });
            }
            return;
        }
        if (meta.type === 'wall') {
            let len = 0;
            for (let i = 0; i < meta.points.length - 1; i++) {
                len += Math.hypot(meta.points[i + 1].x - meta.points[i].x, meta.points[i + 1].y - meta.points[i].y);
            }
            inspectorEl.innerHTML = [
                '<div class="cf-ms-insp">',
                '<div class="cf-ms-ins-type">墙体</div>',
                `<div class="cf-ms-kv"><span>折点</span><b>${meta.points.length}</b></div>`,
                `<div class="cf-ms-kv"><span>总长</span><b>${Math.round(len)} px ≈ ${lengthToMeters(len, g, mpc)} m</b></div>`,
                '<p class="cf-ms-hint">拖动可整体移动；端点吸附网格。</p>',
                '</div>'
            ].join('');
            return;
        }
        if (meta.type === 'marker') {
            const shown = pal().markerColors;
            const swatches = MARKER_COLORS.map((c, i) =>
                `<button class="cf-ms-swatch${c === meta.color ? ' active' : ''}" data-color="${c}" style="--cf-swatch-color:${shown[i] || c}" title="${c}" aria-label="颜色 ${c}"></button>`
            ).join('');
            inspectorEl.innerHTML = [
                '<div class="cf-ms-insp">',
                `<div class="cf-ms-ins-type">${meta.shape === 'prop' ? '物件' : 'Token'}</div>`,
                '<div class="cf-ms-ins-row"><span class="cf-ms-k">位置</span><b>(' + Math.round(meta.x) + ', ' + Math.round(meta.y) + ') px</b></div>',
                '<div class="cf-ms-label">颜色</div>',
                `<div class="cf-ms-swatches" id="cfMsSwatches">${swatches}</div>`,
                '<div class="cf-ms-ins-row"><span class="cf-ms-k">字形</span><input class="cf-ms-input" id="cfMsGlyph" maxlength="2" value="' + escapeHtml(meta.glyph) + '" /></div>',
                '<div class="cf-ms-label">备注</div>',
                '<input class="cf-ms-input block" id="cfMsNote" maxlength="40" placeholder="只存文档，不上画布" value="' + escapeHtml(meta.label || '') + '" />',
                `<div class="cf-ms-hint" id="cfMsNoteCount">${Array.from(meta.label || '').length}/40</div>`,
                '<div class="cf-ms-ins-row"><span class="cf-ms-k">大小</span><select class="cf-ms-input" id="cfMsSize">' +
                    [1, 2, 3, 4].map((n) => `<option value="${n}"${n === meta.sizeCells ? ' selected' : ''}>${n} 格</option>`).join('') +
                    '</select></div>',
                `<div class="cf-ms-ins-row"><span class="cf-ms-k">图片</span><button class="cf-ms-btn mini" id="cfMsInsUpload">${meta.assetId ? '换图' : '上传'}</button>` +
                    (meta.assetId ? '<button class="cf-ms-btn mini" id="cfMsInsClearImg">清除</button>' : '') + '</div>',
                '<button class="cf-ms-btn mini danger block" id="cfMsInsDelete">删除这个标记</button>',
                '</div>'
            ].join('');
            document.querySelectorAll<HTMLButtonElement>('#cfMsSwatches .cf-ms-swatch').forEach((btn) => {
                btn.addEventListener('click', () => studio.setMarkerProps({ color: btn.dataset.color || '#d0564f' }));
            });
            const glyphInput = document.getElementById('cfMsGlyph') as HTMLInputElement | null;
            if (glyphInput) {
                glyphInput.addEventListener('change', () => studio.setMarkerProps({ glyph: glyphInput.value.trim().slice(0, 2) || '●' }));
            }
            const sizeSel = document.getElementById('cfMsSize') as HTMLSelectElement | null;
            if (sizeSel) sizeSel.addEventListener('change', () => studio.setMarkerProps({ sizeCells: Number(sizeSel.value) || 1 }));
            const noteInput = document.getElementById('cfMsNote') as HTMLInputElement | null;
            const noteCount = document.getElementById('cfMsNoteCount');
            if (noteInput) {
                noteInput.addEventListener('input', () => {
                    if (noteCount) noteCount.textContent = `${Array.from(noteInput.value).length}/40`;
                });
                noteInput.addEventListener('change', () => studio.setMarkerLabel(noteInput.value));
            }
            const insUpload = document.getElementById('cfMsInsUpload');
            if (insUpload) insUpload.addEventListener('click', () => imgInput.click());
            const insClear = document.getElementById('cfMsInsClearImg');
            if (insClear) insClear.addEventListener('click', () => studio.clearSelectedImage());
            const insDelete = document.getElementById('cfMsInsDelete');
            if (insDelete) insDelete.addEventListener('click', () => studio.deleteSelected());
            return;
        }
        inspectorEl.innerHTML = [
            '<div class="cf-ms-insp">',
            '<div class="cf-ms-ins-type">门 / 窗</div>',
            `<div class="cf-ms-kv"><span>类型</span><b>${meta.kind === 'door' ? '平开门' : meta.kind === 'window' ? '窗' : '暗门'}</b></div>`,
            `<div class="cf-ms-kv"><span>宽</span><b>${Math.round(meta.width)} px</b></div>`,
            `<div class="cf-ms-kv"><span>角度</span><b>${meta.angle}°</b></div>`,
            '</div>'
        ].join('');
    }

    /* ---------- 快捷键 ---------- */
    document.addEventListener('keyup', (ev) => {
        if (!ev.altKey) studio.setAlt(false);
    });

    document.addEventListener('keydown', (ev) => {
        const panelActive = panel.classList.contains('active');
        if (!panelActive) return;
        const t = ev.target as HTMLElement | null;
        const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (ev.altKey) studio.setAlt(true);
        if (typing) return;
        const mod = ev.ctrlKey || ev.metaKey;
        if (mod && ev.key.toLowerCase() === 'z') {
            ev.preventDefault();
            if (ev.shiftKey) studio.redo();
            else studio.undo();
            return;
        }
        if (mod && ev.key.toLowerCase() === 'y') {
            ev.preventDefault();
            studio.redo();
            return;
        }
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
            ev.preventDefault();
            studio.deleteSelected();
            return;
        }
        if (ev.key === 'Escape') {
            studio.setTool('select');
            document.querySelectorAll<HTMLButtonElement>('.cf-ms-tool[data-tool]').forEach((b) => {
                b.classList.toggle('active', b.dataset.tool === 'select');
            });
            return;
        }
        if (ev.key === 'Enter' && studio.tool === 'wall') {
            studio.finishChain();
            return;
        }
        const key = ev.key.toLowerCase();
        const map: Record<string, Tool> = { v: 'select', r: 'room', w: 'wall', d: 'door', x: 'erase', m: 'marker' };
        if (map[key] && !mod) {
            studio.setTool(map[key]);
        }
    });
    document.addEventListener('keyup', (ev) => {
        if (!ev.altKey) studio.setAlt(false);
    });

    // Ctrl+滚轮 = 缩放
    stage.addEventListener(
        'wheel',
        (ev) => {
            if (!ev.ctrlKey) return;
            ev.preventDefault();
            studio.zoomBy(ev.deltaY < 0 ? 1.12 : 1 / 1.12);
        },
        { passive: false }
    );

    const result: MapStudioPanelApi = {
        studio,
        mount() {
            /* 构造时已挂载 */
        },
        isMounted() {
            return true;
        },
        getDoc(): MapDoc {
            return studio.collect();
        },
        loadDoc(raw: unknown): boolean {
            const check = validateMapDoc(raw);
            if (!check.ok) {
                console.warn('[mapstudio] 拒绝加载地图数据：' + check.reason);
                hintEl.textContent = '未加载地图：' + check.reason;
                return false;
            }
            studio.loadDoc(check.doc, true);
            syncCellUi();
            applyStatus(studio.status());
            // 读档时面板通常还是隐藏的（启动即恢复缓存），此时量不到真实视口，交给下次切页统一适配
            fitted = false;
            if (panel.classList.contains('active')) {
                requestAnimationFrame(() => {
                    studio.fitZoom();
                    studio.render();
                });
            }
            return true;
        },
        clearDoc(): void {
            studio.loadDoc(createEmptyDoc(), true);
            syncCellUi();
            applyStatus(studio.status());
            fitted = false;
            if (panel.classList.contains('active')) {
                requestAnimationFrame(() => {
                    studio.fitZoom();
                    studio.render();
                });
            }
        },
        onTabShown(tab: string): void {            if (tab !== 'mapstudio') return;
            // 每次切到工坊都重新适配一次：读档发生在隐藏状态时尺寸量不准，这里兜底
            requestAnimationFrame(() => {
                if (!fitted) {
                    fitted = true;
                    studio.fitZoom();
                }
                studio.render();
            });
        }
    };

    syncCellUi();
    applyStatus(studio.status());
    api = result;
    return result;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function stamp(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadDataUrl(href: string, filename: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}












