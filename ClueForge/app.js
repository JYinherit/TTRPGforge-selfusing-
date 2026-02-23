/* ================================================================
   ClueForge — TRPG 线索制作工坊  |  app.js
   全功能主逻辑：画布管理、批注系统、历史记录、导出、智能图例生成器
   ================================================================ */

'use strict';

// ================================================================
// 0. 全局状态
// ================================================================
const state = {
    mode: 'select',  // 'select' | 'rect' | 'ellipse' | 'crop' | 'pin'
    pendingPin: null,      // 待放置的 Emoji
    pendingNumberPin: null,      // 待放置的数字 Pin（联动图例）
    isSpaceDown: false,
    isPanning: false,
    lastPanPt: null,
    bgImage: null,      // Fabric.Image (底图)
    legendEntries: [],        // [{ num, label }]
};

// ================================================================
// 1. 初始化 Fabric.js 画布
// ================================================================
const container = document.getElementById('canvasContainer');
const canvasEl = document.getElementById('mainCanvas');

// 调整画布尺寸以匹配容器
function resizeCanvas() {
    canvas.setWidth(container.clientWidth);
    canvas.setHeight(container.clientHeight);
    canvas.renderAll();
}

const canvas = new fabric.Canvas('mainCanvas', {
    selection: true,
    preserveObjectStacking: true,
    fireRightClick: true,
    stopContextMenu: true,
});

// rough.js 使用 SVG 渲染器生成路径（无需离屏 canvas）

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ================================================================
// 2. 工具栏 DOM 引用
// ================================================================
const dropHint = document.getElementById('dropHint');
const fileInput = document.getElementById('fileInput');
const customStampInput = document.getElementById('customStampInput');
const strokeColorEl = document.getElementById('strokeColor');
const strokeWidthEl = document.getElementById('strokeWidth');
const roughnessEl = document.getElementById('roughness');
const filterSelect = document.getElementById('filterSelect');
const statusMode = document.getElementById('statusMode');
const statusZoom = document.getElementById('statusZoom');
const statusObjects = document.getElementById('statusObjects');
const statusHint = document.getElementById('statusHint');
const legendPanel = document.getElementById('legendPanel');
const legendTextarea = document.getElementById('legendTextarea');

// ================================================================
// 3. 工具栏图例浮窗设置
// ================================================================
// 注入图例 HTML（因与画布重叠，直接放 canvasContainer 内）
container.insertAdjacentHTML('beforeend', `
<div id="legendPanel">
  <div class="legend-header" id="legendDragHandle">
    📜 图例对照表
    <button class="legend-sync-btn" id="legendSyncBtn" title="同步标记编号到图例">↺ 同步编号</button>
  </div>
  <textarea id="legendTextarea" rows="4" spellcheck="false"
    placeholder="1 - 杂货店&#10;2 - 废弃教堂&#10;3 - 嫌疑人宅邸"></textarea>
  <div class="legend-footer">
    <button class="legend-btn" id="legendHideBtn">隐藏</button>
    <button class="legend-btn primary" id="legendBakeBtn">烙入画布</button>
  </div>
</div>
`);

// 重新获取注入后的元素
const legendPanelEl = document.getElementById('legendPanel');
const legendTextareaEl = document.getElementById('legendTextarea');
const legendDragHandle = document.getElementById('legendDragHandle');
const legendSyncBtn = document.getElementById('legendSyncBtn');
const legendHideBtn = document.getElementById('legendHideBtn');
const legendBakeBtn = document.getElementById('legendBakeBtn');

// 图例面板拖拽
makeDraggable(legendPanelEl, legendDragHandle);

function makeDraggable(el, handle) {
    let ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', e => {
        dragging = true;
        const rect = el.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        ox = e.clientX - (rect.left - cRect.left);
        oy = e.clientY - (rect.top - cRect.top);
        e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const cRect = container.getBoundingClientRect();
        let nx = e.clientX - ox;
        let ny = e.clientY - oy;
        nx = Math.max(0, Math.min(nx, cRect.width - el.offsetWidth));
        ny = Math.max(0, Math.min(ny, cRect.height - el.offsetHeight));
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        el.style.right = 'unset';
        el.style.bottom = 'unset';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
}

legendHideBtn.addEventListener('click', () => {
    legendPanelEl.classList.remove('visible');
});

// 同步数字标记编号到图例输入框占位
legendSyncBtn.addEventListener('click', syncLegendEntries);

function syncLegendEntries() {
    const existing = legendTextareaEl.value.trim();
    const lines = existing ? existing.split('\n') : [];
    // 为每个尚未存在的编号追加一行
    const numbers = state.legendEntries.map(e => e.num);
    numbers.forEach(n => {
        const alreadyIn = lines.some(l => l.trim().startsWith(n + ' -') || l.trim().startsWith(n + '-'));
        if (!alreadyIn) lines.push(`${n} - `);
    });
    legendTextareaEl.value = lines.join('\n');
    legendTextareaEl.focus();
}

// 「烙入画布」：将图例文字渲染为 Fabric.Textbox 对象（可拖拽）
legendBakeBtn.addEventListener('click', bakeLeafLegend);

function bakeLeafLegend() {
    const text = legendTextareaEl.value.trim();
    if (!text) return;

    // 移除上一张已烙入图例（通过 data 标记）
    const old = canvas.getObjects().find(o => o._isLegend);
    if (old) canvas.remove(old);

    // 计算放置位置（右下角，考虑缩放）
    const vpt = canvas.viewportTransform;
    const zoom = canvas.getZoom();
    const cW = canvas.getWidth();
    const cH = canvas.getHeight();
    const bx = (cW - 250 - vpt[4]) / zoom;
    const by = (cH - 40 - vpt[5]) / zoom;

    const box = new fabric.Textbox(text, {
        left: bx - 220,
        top: by - (text.split('\n').length * 22 + 24),
        width: 210,
        fontSize: 16,
        fontFamily: 'Special Elite, serif',
        fill: '#e8d8b0',
        backgroundColor: 'rgba(10,8,20,0.82)',
        padding: 12,
        lineHeight: 1.65,
        borderColor: '#c9a84c',
        cornerColor: '#c9a84c',
        cornerSize: 8,
        transparentCorners: false,
        editable: true,
        selectable: true,
        hasControls: true,
        _isLegend: true,
    });

    canvas.add(box);
    canvas.setActiveObject(box);
    canvas.renderAll();
    history.save();

    legendPanelEl.classList.remove('visible');
    setStatus('hint', '图例已烙入画布，可拖拽移动');
}

// ================================================================
// 4. 历史记录管理器
// ================================================================
const history = (() => {
    const MAX = 60;
    let stack = [];
    let idx = -1;

    function save() {
        const json = canvas.toJSON(['_isLegend', '_isBg', '_pinNum']);
        stack = stack.slice(0, idx + 1);
        stack.push(json);
        if (stack.length > MAX) stack.shift();
        idx = stack.length - 1;
        updateHistoryButtons();
    }

    function undo() {
        if (idx <= 0) return;
        idx--;
        restore(stack[idx]);
    }

    function redo() {
        if (idx >= stack.length - 1) return;
        idx++;
        restore(stack[idx]);
    }

    function restore(json) {
        canvas.loadFromJSON(json, () => {
            canvas.renderAll();
            updateObjCount();
            // 重新获取底图引用
            state.bgImage = canvas.getObjects().find(o => o._isBg) || null;
            updateHistoryButtons();
        });
    }

    return { save, undo, redo };
})();

function updateHistoryButtons() {
    // 通过禁用样式体现状态（简化实现）
}

// ================================================================
// 5. 模式切换
// ================================================================
function setMode(mode) {
    state.mode = mode;
    // 只有切换到非 pin 模式时才清空待放置 pin，避免进入 pin 模式时自我清空
    if (mode !== 'pin') {
        state.pendingPin = null;
        state.pendingNumberPin = null;
    }

    // 清除所有按钮激活态
    document.querySelectorAll('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('btn-' + mode);
    if (btn) btn.classList.add('active');

    // 画布交互模式
    switch (mode) {
        case 'select':
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'default';
            canvas.hoverCursor = 'move';
            canvas.selection = true;
            canvas.getObjects().forEach(o => { o.selectable = true; o.evented = true; });
            setCropMode(false);
            break;
        case 'rect':
        case 'ellipse':
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
            canvas.selection = false;
            canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
            setCropMode(false);
            break;
        case 'crop':
            canvas.isDrawingMode = false;
            canvas.selection = false;
            canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
            setCropMode(true);
            break;
        case 'pin':
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
            canvas.selection = false;
            canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
            setCropMode(false);
            break;
        case 'arrow':
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
            canvas.selection = false;
            canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
            setCropMode(false);
            break;
    }

    statusMode.textContent = `模式：${{ select: '选择', rect: '手绘矩形', ellipse: '手绘椭圆', crop: '裁剪', pin: '放置标记', arrow: '手绘箭头' }[mode] || mode}`;
    setStatus('hint', {
        select: '点击选中对象，Delete 删除，Ctrl+Z 撤销',
        rect: '拖拽绘制手绘矩形',
        ellipse: '拖拽绘制手绘椭圆',
        arrow: '拖拽绘制手绘箭头，可调节糟糟度',
        crop: '拖拽框选裁剪区域，松开鼠标确认裁剪',
        pin: '点击画布放置标记，Esc 退出',
    }[mode] || '');
}

// 工具栏按钮点击
document.querySelectorAll('.tool-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

// 快捷键：V R E C A
window.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'v' || e.key === 'V') setMode('select');
    if (e.key === 'r' || e.key === 'R') setMode('rect');
    if (e.key === 'e' || e.key === 'E') setMode('ellipse');
    if (e.key === 'c' || e.key === 'C') setMode('crop');
    if (e.key === 'a' || e.key === 'A') setMode('arrow');
});

// ================================================================
// 6. 拖拽导入底图
// ================================================================
container.addEventListener('dragover', e => {
    e.preventDefault();
    container.classList.add('drag-over');
});
container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
container.addEventListener('drop', e => {
    e.preventDefault();
    container.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImageFile(file);
});

fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadImageFile(e.target.files[0]);
});

function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = ev => {
        fabric.Image.fromURL(ev.target.result, img => {
            setBackgroundImage(img);
            setTimeout(() => history.save(), 100);
        }, { crossOrigin: 'anonymous' });
    };
    reader.readAsDataURL(file);
}

function setBackgroundImage(img) {
    // 移除旧底图
    if (state.bgImage) canvas.remove(state.bgImage);

    const cW = canvas.getWidth();
    const cH = canvas.getHeight();

    // 适应画布，保持长宽比
    const scaleX = (cW * 0.9) / img.width;
    const scaleY = (cH * 0.9) / img.height;
    const scale = Math.min(scaleX, scaleY, 1);

    img.set({
        left: (cW - img.width * scale) / 2,
        top: (cH - img.height * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        _isBg: true,
    });

    // 插入最底层
    canvas.insertAt(img, 0);
    state.bgImage = img;

    dropHint.classList.add('hidden');
    canvas.renderAll();
    updateObjCount();
    setStatus('hint', '底图已加载！切换工具开始批注');
}

// ================================================================
// 7. 缩放 & 平移
// ================================================================
canvas.on('mouse:wheel', opt => {
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom() * (delta > 0 ? 0.95 : 1.05);
    zoom = Math.min(Math.max(zoom, 0.05), 30);
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    opt.e.preventDefault();
    opt.e.stopPropagation();
    statusZoom.textContent = `缩放：${Math.round(zoom * 100)}%`;
});

window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !state.isSpaceDown) {
        if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
        state.isSpaceDown = true;
        canvas.defaultCursor = 'grab';
        canvas.hoverCursor = 'grab';
        e.preventDefault();
    }
});
window.addEventListener('keyup', e => {
    if (e.code === 'Space') {
        state.isSpaceDown = false;
        state.isPanning = false;
        setMode(state.mode); // 恢复光标
    }
});

canvas.on('mouse:down', opt => {
    if (state.isSpaceDown) {
        state.isPanning = true;
        state.lastPanPt = { x: opt.e.clientX, y: opt.e.clientY };
        canvas.defaultCursor = 'grabbing';
        return;
    }

    if (state.mode === 'rect' || state.mode === 'ellipse') { startDraw(opt); return; }
    if (state.mode === 'arrow') { startDraw(opt); return; }
    if (state.mode === 'crop') { startCrop(opt); return; }
    if (state.mode === 'pin') {
        if (state.pendingPin) {
            placePinAt(opt);
            // 留在 pin 模式，允许连续放置同一标记
        } else if (state.pendingNumberPin != null) {
            const pt = getCanvasPoint(opt);
            addNumberedPin(state.pendingNumberPin, pt.x, pt.y);
            state.pendingNumberPin = null;
            setMode('select');
        }
    }
});

canvas.on('mouse:move', opt => {
    if (state.isPanning && state.isSpaceDown && state.lastPanPt) {
        const vpt = canvas.viewportTransform;
        vpt[4] += opt.e.clientX - state.lastPanPt.x;
        vpt[5] += opt.e.clientY - state.lastPanPt.y;
        canvas.requestRenderAll();
        state.lastPanPt = { x: opt.e.clientX, y: opt.e.clientY };
        return;
    }
    if (state.mode === 'rect' || state.mode === 'ellipse' || state.mode === 'arrow') updateDraw(opt);
    if (state.mode === 'crop') updateCrop(opt);
});

canvas.on('mouse:up', opt => {
    if (state.isPanning) { state.isPanning = false; return; }
    if (state.mode === 'rect' || state.mode === 'ellipse' || state.mode === 'arrow') endDraw(opt);
    if (state.mode === 'crop') endCrop(opt);
});

// ================================================================
// 8. 手绘矩形 / 椭圆（Rough.js）
// ================================================================
let drawStartPt = null;
let drawPreview = null;

function getCanvasPoint(opt) {
    const vpt = canvas.viewportTransform;
    const zoom = canvas.getZoom();
    return {
        x: (opt.e.offsetX - vpt[4]) / zoom,
        y: (opt.e.offsetY - vpt[5]) / zoom,
    };
}

function getRoughOptions() {
    return {
        stroke: strokeColorEl.value,
        strokeWidth: parseInt(strokeWidthEl.value),
        roughness: parseFloat(roughnessEl.value),
        fill: 'none',
        seed: Math.floor(Math.random() * 9999),
    };
}

function startDraw(opt) {
    if (opt.target && opt.target.selectable) return;
    drawStartPt = getCanvasPoint(opt);
}

function updateDraw(opt) {
    if (!drawStartPt) return;
    const cur = getCanvasPoint(opt);
    if (drawPreview) { canvas.remove(drawPreview); drawPreview = null; }
    drawPreview = createRoughObject(drawStartPt, cur, true);
    if (drawPreview) canvas.add(drawPreview);
    canvas.requestRenderAll();
}

function endDraw(opt) {
    if (!drawStartPt) return;
    const cur = getCanvasPoint(opt);
    if (drawPreview) { canvas.remove(drawPreview); drawPreview = null; }

    const dx = Math.abs(cur.x - drawStartPt.x);
    const dy = Math.abs(cur.y - drawStartPt.y);
    if (dx < 5 && dy < 5) { drawStartPt = null; return; }

    const obj = createRoughObject(drawStartPt, cur, false);
    if (obj) {
        canvas.add(obj);
        canvas.renderAll();
        history.save();
        updateObjCount();
    }
    drawStartPt = null;
}

function createRoughObject(p1, p2, isPreview) {
    // 箭头单独处理
    if (state.mode === 'arrow') return createRoughArrow(p1, p2, isPreview);

    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    if (w < 5 || h < 5) return null;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNS, 'svg');
    const rc = rough.svg(svgEl);
    const opts = {
        stroke: strokeColorEl.value,
        strokeWidth: parseInt(strokeWidthEl.value),
        roughness: isPreview ? 0.4 : parseFloat(roughnessEl.value),
        fill: 'none',
        seed: Math.floor(Math.random() * 9999),
    };

    let node;
    if (state.mode === 'rect') {
        node = rc.rectangle(x, y, w, h, opts);
    } else {
        node = rc.ellipse(x + w / 2, y + h / 2, w, h, opts);
    }

    return roughNodesToGroup([node], opts, !isPreview);
}

// ================================================================
// 手绘箭头（Rough.js）
// ================================================================
function createRoughArrow(p1, p2, isPreview) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return null;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNS, 'svg');
    const rc = rough.svg(svgEl);
    const rOpts = {
        stroke: strokeColorEl.value,
        strokeWidth: parseInt(strokeWidthEl.value),
        roughness: isPreview ? 0.3 : parseFloat(roughnessEl.value),
        fill: 'none',
        seed: Math.floor(Math.random() * 9999),
    };

    // 箭身
    const shaft = rc.linearPath([[p1.x, p1.y], [p2.x, p2.y]], rOpts);

    // 箭头两条短线
    const angle = Math.atan2(dy, dx);
    const headLen = Math.max(12, Math.min(28, len * 0.22));
    const spread = Math.PI / 6; // 30°
    const hx1 = p2.x - headLen * Math.cos(angle - spread);
    const hy1 = p2.y - headLen * Math.sin(angle - spread);
    const hx2 = p2.x - headLen * Math.cos(angle + spread);
    const hy2 = p2.y - headLen * Math.sin(angle + spread);

    const wing1 = rc.linearPath([[hx1, hy1], [p2.x, p2.y]], rOpts);
    const wing2 = rc.linearPath([[hx2, hy2], [p2.x, p2.y]], rOpts);

    return roughNodesToGroup([shaft, wing1, wing2], rOpts, !isPreview);
}

// 通用：will rough.js SVG 节点转为 Fabric.Group
function roughNodesToGroup(nodes, opts, selectable) {
    const pathEls = nodes.flatMap(n => Array.from(n.querySelectorAll('path')));
    if (!pathEls.length) return null;

    const fabPaths = pathEls.map(el => {
        const svgFill = el.getAttribute('fill');
        const svgStroke = el.getAttribute('stroke') || opts.stroke;
        const svgSW = parseFloat(el.getAttribute('stroke-width')) || opts.strokeWidth;
        const fabricFill = (!svgFill || svgFill === 'none') ? 'transparent' : svgFill;
        return new fabric.Path(el.getAttribute('d'), {
            stroke: svgStroke,
            strokeWidth: svgSW,
            fill: fabricFill,
            selectable: false,
            evented: false,
            objectCaching: false,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
        });
    });

    return new fabric.Group(fabPaths, {
        selectable: selectable,
        evented: selectable,
        hasControls: selectable,
        hasBorders: selectable,
        cornerColor: '#c9a84c',
        cornerSize: 8,
        transparentCorners: false,
        objectCaching: false,
    });
}

// ================================================================
// 手绘标记绘制函数（叉 / 点 / 问号 / 血 / 眼）
// ================================================================
function createRoughMarker(type, x, y) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNS, 'svg');
    const rc = rough.svg(svgEl);            // rough = 全局 Rough.js 库
    const roughness = parseFloat(roughnessEl.value); // 粗糙度滑块值
    const seed = Math.floor(Math.random() * 9999);
    const sw = Math.max(2, parseInt(strokeWidthEl.value));

    const nodes = [];
    const sz = 18; // 标记半尺寸

    if (type === 'x') {
        // 手绘红叉：两条对角线
        const xOpts = { stroke: '#dc143c', strokeWidth: sw + 1, roughness: roughness + 0.5, fill: 'none', seed };
        nodes.push(rc.linearPath([[x - sz, y - sz], [x + sz, y + sz]], xOpts));
        nodes.push(rc.linearPath([[x + sz, y - sz], [x - sz, y + sz]], xOpts));

    } else if (type === 'dot') {
        // 手绘红点：充实粗糙圆
        const dotOpts = {
            stroke: '#dc143c', strokeWidth: sw, roughness: roughness + 0.3,
            fill: '#dc143c', fillStyle: 'solid', seed
        };
        nodes.push(rc.circle(x, y, sz * 1.6, dotOpts));

    } else if (type === 'question') {
        // 手绘问号圈：粗糙圆轮 + "?" 文字
        const qOpts = { stroke: '#d08000', strokeWidth: sw + 1, roughness: roughness + 0.4, fill: 'none', seed };
        nodes.push(rc.circle(x, y, sz * 2, qOpts));

    } else if (type === 'blood') {
        // 血迹：不规则布浓点
        const bOpts = r => ({ stroke: '#7a0000', strokeWidth: 1.5, roughness: r, fill: '#8b0000', fillStyle: 'solid', seed });
        nodes.push(rc.circle(x, y, sz * 1.7, bOpts(roughness + 1.5)));
        nodes.push(rc.circle(x - sz * 0.9, y + sz * 0.8, sz * 0.8, bOpts(roughness + 2)));
        nodes.push(rc.circle(x + sz * 1.0, y + sz * 0.6, sz * 0.55, bOpts(roughness + 2)));
        nodes.push(rc.circle(x + sz * 0.3, y + sz * 1.2, sz * 0.45, bOpts(roughness + 2)));

    } else if (type === 'eye') {
        // 观察标记：手绘眼形
        const eOpts = { stroke: '#1a7030', strokeWidth: sw + 1, roughness: roughness + 0.3, fill: 'none', seed };
        const p1Opts = {
            stroke: '#1a7030', strokeWidth: sw, roughness: roughness + 0.5,
            fill: '#1a7030', fillStyle: 'solid', seed: seed + 1
        };
        nodes.push(rc.ellipse(x, y, sz * 3, sz * 1.5, eOpts));
        nodes.push(rc.circle(x, y, sz * 0.9, p1Opts));
    }

    const group = roughNodesToGroup(nodes, { stroke: '#000', strokeWidth: sw }, true);

    // 问号标记需要额外加上 "?" 文字
    if (type === 'question' && group) {
        const qText = new fabric.Text('?', {
            left: x, top: y,
            fontSize: sz * 1.4,
            fontFamily: 'Special Elite, serif',
            fontWeight: 'bold',
            fill: '#d08000',
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
        });
        const combo = new fabric.Group([group, qText], {
            selectable: true, evented: true,
            hasControls: true, hasBorders: true,
            cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
        });
        return combo;
    }

    return group;
}

// ================================================================
// 9. Pin 标记系统
// ================================================================
document.querySelectorAll('.pin-btn[data-marker]').forEach(btn => {
    btn.addEventListener('click', () => {
        const markerType = btn.dataset.marker;
        state.pendingPin = markerType;  // pendingPin 现在存储 marker 类型字符串
        state.pendingNumberPin = null;
        setMode('pin');
        setStatus('hint', `点击画布放置手绘标记，可连续放置，Esc 退出`);
    });
});

function placePinAt(opt) {
    const pt = getCanvasPoint(opt);
    const type = state.pendingPin;
    if (!type) return;

    const obj = createRoughMarker(type, pt.x, pt.y);
    if (!obj) return;

    canvas.add(obj);
    canvas.renderAll();
    history.save();
    updateObjCount();
}

// 带数字的 Pin（联动图例）
function addNumberedPin(num, x, y) {
    const circle = new fabric.Circle({
        radius: 14,
        fill: '#b83232',
        stroke: '#e8c090',
        strokeWidth: 1.5,
        originX: 'center',
        originY: 'center',
        left: 0,
        top: 0,
    });
    const label = new fabric.Text(String(num), {
        fontSize: 14,
        fontFamily: 'Special Elite, serif',
        fill: '#fff',
        fontWeight: 'bold',
        originX: 'center',
        originY: 'center',
        left: 0,
        top: 0,
    });
    const group = new fabric.Group([circle, label], {
        left: x,
        top: y,
        originX: 'center',
        originY: 'center',
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: '#c9a84c',
        cornerSize: 8,
        transparentCorners: false,
        _pinNum: num,
    });
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.renderAll();
    history.save();
    updateObjCount();

    // 联动图例
    state.legendEntries.push({ num, label: '' });
    showLegendPanel();
}

// 工具栏"数字 Pin"按钮事件（动态生成 #1 #2 #3 按钮）
// 通过插入隐藏按钮组实现
const numPinGroup = document.querySelector('.tool-group');
const numPinContainer = document.createElement('div');
numPinContainer.className = 'tool-group';
numPinContainer.innerHTML = `<span class="group-label">数字</span>`;
for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.className = 'pin-btn';
    b.title = `数字标记 ${i}（联动图例）`;
    b.style.fontFamily = 'Special Elite, serif';
    b.style.fontSize = '13px';
    b.style.fontWeight = 'bold';
    b.style.color = '#e05050';
    b.textContent = i;
    b.dataset.numPin = i;
    numPinContainer.appendChild(b);
}

// 插入到工具栏标记组后
const toolbar = document.getElementById('toolbar');
const dividers = toolbar.querySelectorAll('.toolbar-divider');
// 在第二个分隔线后插入数字 Pin 组
if (dividers[2]) {
    toolbar.insertBefore(numPinContainer, dividers[2]);
    const newDiv = document.createElement('div');
    newDiv.className = 'toolbar-divider';
    toolbar.insertBefore(newDiv, dividers[2]);
}

numPinContainer.querySelectorAll('[data-num-pin]').forEach(btn => {
    btn.addEventListener('click', () => {
        const num = parseInt(btn.dataset.numPin);
        // 使用 state.pendingNumberPin 统一管理，避免注册游离的 canvas.on() 监听器
        state.pendingNumberPin = num;
        state.pendingPin = null;
        setMode('pin');
        setStatus('hint', `点击画布放置数字标记 ${num}，Esc 退出`);
    });
});

function showLegendPanel() {
    legendPanelEl.classList.add('visible');
    syncLegendEntries();
}

// ================================================================
// 10. 自定义图章上传
// ================================================================
customStampInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        state.pendingPin = null;
        // 进入 pin 模式，放置图片对象
        canvas.defaultCursor = 'crosshair';
        canvas.selection = false;
        const handler = (opt) => {
            const pt = getCanvasPoint(opt);
            fabric.Image.fromURL(ev.target.result, img => {
                const sz = 60;
                img.set({
                    left: pt.x,
                    top: pt.y,
                    scaleX: sz / img.width,
                    scaleY: sz / img.height,
                    originX: 'center',
                    originY: 'center',
                    selectable: true,
                    evented: true,
                    hasControls: true,
                    hasBorders: true,
                    cornerColor: '#c9a84c',
                    cornerSize: 8,
                    transparentCorners: false,
                });
                canvas.add(img);
                canvas.setActiveObject(img);
                canvas.renderAll();
                history.save();
                updateObjCount();
            }, { crossOrigin: 'anonymous' });
            canvas.off('mouse:down', handler);
            setMode('select');
        };
        canvas.on('mouse:down', handler);
        setStatus('hint', '点击画布放置自定义图章');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
});

// ================================================================
// 11. 裁剪功能
// ================================================================
const cropOverlay = document.getElementById('cropOverlay');
const cropSelection = document.getElementById('cropSelection');
let cropStart = null, cropCurrent = null;

function setCropMode(on) {
    cropOverlay.style.display = on ? 'block' : 'none';
    if (!on) { cropStart = null; cropCurrent = null; cropSelection.style.cssText = ''; }
}

cropOverlay.addEventListener('mousedown', e => {
    e.stopPropagation();
    const rect = container.getBoundingClientRect();
    cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});

cropOverlay.addEventListener('mousemove', e => {
    if (!cropStart) return;
    const rect = container.getBoundingClientRect();
    cropCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const x = Math.min(cropStart.x, cropCurrent.x);
    const y = Math.min(cropStart.y, cropCurrent.y);
    const w = Math.abs(cropCurrent.x - cropStart.x);
    const h = Math.abs(cropCurrent.y - cropStart.y);
    Object.assign(cropSelection.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
});

cropOverlay.addEventListener('mouseup', e => {
    if (!cropStart || !cropCurrent) return;
    const x = Math.min(cropStart.x, cropCurrent.x);
    const y = Math.min(cropStart.y, cropCurrent.y);
    const w = Math.abs(cropCurrent.x - cropStart.x);
    const h = Math.abs(cropCurrent.y - cropStart.y);
    if (w < 10 || h < 10) { setCropMode(false); setMode('select'); return; }

    applyCrop(x, y, w, h);
});

function applyCrop(sx, sy, sw, sh) {
    if (!state.bgImage) { setCropMode(false); setMode('select'); return; }

    // 将屏幕坐标转换为画布坐标
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform;
    const cx = (sx - vpt[4]) / zoom;
    const cy = (sy - vpt[5]) / zoom;
    const cw = sw / zoom;
    const ch = sh / zoom;

    // 用离屏 canvas 裁剪底图
    const img = state.bgImage;
    const imgEl = img.getElement();
    const offC = document.createElement('canvas');
    offC.width = Math.round(cw);
    offC.height = Math.round(ch);
    const ctx = offC.getContext('2d');

    // 还原底图在画布坐标系中的变换
    const imgLeft = img.left;
    const imgTop = img.top;
    const imgScaleX = img.scaleX;
    const imgScaleY = img.scaleY;

    // 目标区域在图像像素坐标系中的位置
    const srcX = (cx - imgLeft) / imgScaleX;
    const srcY = (cy - imgTop) / imgScaleY;
    const srcW = cw / imgScaleX;
    const srcH = ch / imgScaleY;

    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, offC.width, offC.height);

    fabric.Image.fromURL(offC.toDataURL(), cropped => {
        setBackgroundImage(cropped);
        history.save();
        setCropMode(false);
        setMode('select');
        setStatus('hint', '裁剪完成！');
    }, { crossOrigin: 'anonymous' });
}

// ================================================================
// 12. 快捷键
// ================================================================
window.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    // 撤销
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); history.undo();
    }
    // 重做
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); history.redo();
    }
    // 删除选中
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey) {
        const active = canvas.getActiveObject();
        if (!active) return;
        if (active.type === 'activeSelection') {
            active.forEachObject(o => canvas.remove(o));
            canvas.discardActiveObject();
        } else {
            canvas.remove(active);
        }
        canvas.renderAll();
        history.save();
        updateObjCount();
    }
    // Escape 退出绘制模式
    if (e.key === 'Escape') setMode('select');
});

// 工具栏按钮
document.getElementById('btn-undo').addEventListener('click', () => history.undo());
document.getElementById('btn-redo').addEventListener('click', () => history.redo());

// ================================================================
// 13. 对象事件（完成移动/缩放后保存历史）
// ================================================================
canvas.on('object:modified', () => { history.save(); updateObjCount(); });

// ================================================================
// 14. 导出功能（含做旧滤镜）
// ================================================================
document.getElementById('btn-export-png').addEventListener('click', exportPNG);

function exportPNG() {
    const filter = filterSelect.value;
    setStatus('hint', '准备导出...');

    // 临时切换到高倍率离屏渲染
    const multiplier = window.devicePixelRatio || 2;

    const orig = { scaleX: canvas.viewportTransform[0], scaleY: canvas.viewportTransform[3] };

    // 计算底图包围盒作为导出范围
    if (!state.bgImage) {
        alert('请先导入底图！');
        return;
    }

    const bg = state.bgImage;
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform;

    // 以底图边界导出
    const bgLeft = bg.left * zoom + vpt[4];
    const bgTop = bg.top * zoom + vpt[5];
    const bgWidth = bg.getScaledWidth() * zoom;
    const bgHeight = bg.getScaledHeight() * zoom;

    // 临时禁用图例浮窗
    legendPanelEl.classList.add('exporting');

    const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1,
        multiplier: multiplier,
        left: bgLeft,
        top: bgTop,
        width: bgWidth,
        height: bgHeight,
    });

    legendPanelEl.classList.remove('exporting');

    if (filter === 'none') {
        triggerDownload(dataURL, 'clueforge-export.png');
        setStatus('hint', '导出完成！');
        return;
    }

    // 做旧滤镜
    applyFilter(dataURL, filter).then(filteredDataURL => {
        triggerDownload(filteredDataURL, `clueforge-${filter}.png`);
        setStatus('hint', `已应用【${filter === 'parchment' ? '羊皮纸泛黄' : '老报纸噪点'}】滤镜并导出！`);
    });
}

function triggerDownload(dataURL, filename) {
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = filename;
    a.click();
}

async function applyFilter(dataURL, filterType) {
    const img = await loadImg(dataURL);
    const offC = document.createElement('canvas');
    offC.width = img.width;
    offC.height = img.height;
    const ctx = offC.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, offC.width, offC.height);
    const d = imgData.data;

    if (filterType === 'parchment') {
        // 羊皮纸泛黄：暖色偏移 + 轻微噪点 + 暗角
        for (let i = 0; i < d.length; i += 4) {
            // 暖色调
            d[i] = Math.min(255, d[i] * 1.08 + 20);  // R
            d[i + 1] = Math.min(255, d[i + 1] * 1.02 + 10);  // G
            d[i + 2] = Math.max(0, d[i + 2] * 0.78 - 10);  // B
            // 随机噪点
            const n = (Math.random() - 0.5) * 18;
            d[i] = Math.min(255, Math.max(0, d[i] + n));
            d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
            d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
        }
        ctx.putImageData(imgData, 0, 0);
        // 暗角渐变
        const vignette = ctx.createRadialGradient(
            offC.width / 2, offC.height / 2, offC.width * 0.3,
            offC.width / 2, offC.height / 2, offC.width * 0.75,
        );
        vignette.addColorStop(0, 'rgba(80,50,10,0)');
        vignette.addColorStop(1, 'rgba(60,35,5,0.52)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, offC.width, offC.height);
        // 纸纹纵横线
        ctx.strokeStyle = 'rgba(120,80,30,0.07)';
        ctx.lineWidth = 1;
        for (let y = 0; y < offC.height; y += 6) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(offC.width, y); ctx.stroke();
        }

    } else if (filterType === 'newspaper') {
        // 老报纸：去色 + 对比度 + 粗噪点 + 纸纹
        for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            // 对比度增强
            const c = ((gray - 128) * 1.3 + 128);
            const n = (Math.random() - 0.5) * 40;
            const v = Math.min(255, Math.max(0, c + n));
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        // 纸纹横线
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        for (let y = 0; y < offC.height; y += 5) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(offC.width, y); ctx.stroke();
        }
        // 暖黄叠色模拟黄变
        ctx.fillStyle = 'rgba(200,185,140,0.22)';
        ctx.fillRect(0, 0, offC.width, offC.height);
        // 暗角
        const vignette2 = ctx.createRadialGradient(
            offC.width / 2, offC.height / 2, offC.width * 0.25,
            offC.width / 2, offC.height / 2, offC.width * 0.7,
        );
        vignette2.addColorStop(0, 'rgba(0,0,0,0)');
        vignette2.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = vignette2;
        ctx.fillRect(0, 0, offC.width, offC.height);
    }

    return offC.toDataURL('image/png');
}

function loadImg(src) {
    return new Promise(resolve => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.src = src;
    });
}

// ================================================================
// 15. 状态栏更新
// ================================================================
function updateObjCount() {
    // 不计底图
    const count = canvas.getObjects().filter(o => !o._isBg).length;
    statusObjects.textContent = `对象数：${count}`;
}

function setStatus(field, text) {
    if (field === 'hint') statusHint.textContent = `提示：${text}`;
}

// ================================================================
// 16. 初始化
// ================================================================
setMode('select');
history.save(); // 保存初始空状态

// 初始化完成提示
setStatus('hint', '欢迎使用 ClueForge！拖入图片以开始创作。');
