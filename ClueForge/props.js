/* ================================================================
   ClueForge — 道具生成器模块  |  props.js
   信件 / 报纸 / 电报 / 档案卡 / 自定义画布 模板预览与导出
   ================================================================ */
'use strict';

const PropsModule = (() => {

    // ── 模板定义 ──────────────────────────────────────────────────
    const TEMPLATES = {
        letter: {
            name: '旧信件', icon: '📜',
            fields: [
                { key: 'recipient', label: '收件人', placeholder: 'Dear Dr. Watson,' },
                { key: 'body', label: '正文', type: 'textarea', placeholder: '信件正文内容...' },
                { key: 'signature', label: '签名', placeholder: '— S.H.' },
                { key: 'date', label: '日期', placeholder: '1891年12月24日' },
            ],
        },
        newspaper: {
            name: '报纸剪报', icon: '📰',
            fields: [
                { key: 'headline', label: '标题', placeholder: 'MYSTERIOUS DISAPPEARANCE' },
                { key: 'subtitle', label: '副标题', placeholder: 'Police baffled by locked room case' },
                { key: 'body', label: '正文', type: 'textarea', placeholder: '报纸正文...' },
                { key: 'source', label: '来源', placeholder: 'The London Herald — 14 March 1923' },
            ],
        },
        telegram: {
            name: '电报', icon: '⚡',
            fields: [
                { key: 'to', label: '收件人', placeholder: 'INSPECTOR LESTRADE' },
                { key: 'from', label: '发件人', placeholder: 'HOLMES BAKER STREET' },
                { key: 'body', label: '正文', type: 'textarea', placeholder: 'COME AT ONCE STOP BRING REVOLVER STOP' },
                { key: 'number', label: '电报编号', placeholder: 'TEL-1923-00472' },
                { key: 'time', label: '时间', placeholder: '14:35 GMT' },
            ],
        },
        dossier: {
            name: '档案卡', icon: '📋',
            fields: [
                { key: 'photo', label: '照片', type: 'file' },
                { key: 'name', label: '姓名', placeholder: 'Professor Moriarty' },
                { key: 'alias', label: '别名', placeholder: '"The Napoleon of Crime"' },
                { key: 'desc', label: '描述', type: 'textarea', placeholder: '身高、特征、已知关联...' },
                { key: 'status', label: '状态', placeholder: 'AT LARGE — EXTREMELY DANGEROUS' },
                { key: 'casenum', label: '案件编号', placeholder: 'CASE #1891-M-221B' },
            ],
        },
        custom: {
            name: '自定义', icon: '🎨',
            fields: [],  // 自定义模板无固定字段
        },
    };

    let currentTemplate = 'letter';
    let fieldValues = {};
    let agingLevel = 0.5;
    let dossierPhotoDataUrl = null;  // 档案卡照片的 DataURL

    // ── 自定义画布状态 ────────────────────────────────────────────
    let customCanvas = null;   // fabric.Canvas 实例
    let customBgDataUrl = null; // 自定义画布背景图

    // ── 初始化 ────────────────────────────────────────────────────
    function init() {
        Bus.on('tab:switched', ({ tab }) => {
            if (tab === 'props') {
                renderAll();
                if (currentTemplate === 'custom' && customCanvas) {
                    setTimeout(() => customCanvas.renderAll(), 50);
                }
            }
        });
        Bus.on('project:collect:props', callback => {
            callback({
                template: currentTemplate, values: fieldValues, aging: agingLevel,
                dossierPhoto: dossierPhotoDataUrl,
            });
        });
        Bus.on('project:restore:props', data => {
            if (!data) return;
            currentTemplate = data.template || 'letter';
            fieldValues = data.values || {};
            agingLevel = data.aging ?? 0.5;
            dossierPhotoDataUrl = data.dossierPhoto || null;
            renderAll();
        });

        setupTemplateTabs();
        setupExportBtn();
        setupAgingSlider();
        renderAll();
    }

    // ── 模板标签切换 ──────────────────────────────────────────────
    function setupTemplateTabs() {
        document.querySelectorAll('.props-template-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                currentTemplate = tab.dataset.template;
                document.querySelectorAll('.props-template-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderAll();
            });
        });
    }

    // ── 做旧滑块 ──────────────────────────────────────────────────
    function setupAgingSlider() {
        const slider = document.getElementById('propsAgingSlider');
        if (!slider) return;
        slider.addEventListener('input', () => {
            agingLevel = parseFloat(slider.value);
            updatePreview();
        });
    }

    // ── 导出按钮 ──────────────────────────────────────────────────
    function setupExportBtn() {
        const btn = document.getElementById('propsExportBtn');
        if (!btn) return;
        btn.addEventListener('click', exportPNG);
    }

    // ── 渲染 ──────────────────────────────────────────────────────
    function renderAll() {
        renderForm();
        updatePreview();
    }

    function renderForm() {
        const formEl = document.getElementById('propsFormArea');
        if (!formEl) return;

        // 自定义模板使用特殊表单
        if (currentTemplate === 'custom') {
            renderCustomForm(formEl);
            return;
        }

        const tpl = TEMPLATES[currentTemplate];
        if (!tpl) return;

        let html = '';
        tpl.fields.forEach(f => {
            const val = (fieldValues[currentTemplate] && fieldValues[currentTemplate][f.key]) || '';
            if (f.type === 'file') {
                // 图片上传字段
                const hasImg = (f.key === 'photo' && dossierPhotoDataUrl);
                html += `<label class="props-field-label">${f.label}</label>
                         <div class="props-file-upload" data-key="${f.key}">
                             <input type="file" accept="image/*" class="props-file-input" data-key="${f.key}" style="display:none">
                             <button class="props-upload-btn" type="button">${hasImg ? '✅ 已上传 (点击更换)' : '📷 选择图片'}</button>
                             ${hasImg ? '<button class="props-remove-img-btn" type="button" title="移除图片">✕</button>' : ''}
                         </div>`;
            } else if (f.type === 'textarea') {
                html += `<label class="props-field-label">${f.label}</label>
                         <textarea class="props-input" data-key="${f.key}" placeholder="${f.placeholder}" rows="5">${val}</textarea>`;
            } else {
                html += `<label class="props-field-label">${f.label}</label>
                         <input class="props-input" type="text" data-key="${f.key}" placeholder="${f.placeholder}" value="${val}">`;
            }
        });
        formEl.innerHTML = html;

        // 绑定输入事件
        formEl.querySelectorAll('.props-input').forEach(el => {
            el.addEventListener('input', () => {
                if (!fieldValues[currentTemplate]) fieldValues[currentTemplate] = {};
                fieldValues[currentTemplate][el.dataset.key] = el.value;
                updatePreview();
            });
        });

        // 绑定文件上传事件
        formEl.querySelectorAll('.props-upload-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wrapper = btn.closest('.props-file-upload');
                const input = wrapper.querySelector('.props-file-input');
                input.click();
            });
        });
        formEl.querySelectorAll('.props-file-input').forEach(inp => {
            inp.addEventListener('change', e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    if (inp.dataset.key === 'photo') {
                        dossierPhotoDataUrl = ev.target.result;
                    }
                    renderAll();
                };
                reader.readAsDataURL(file);
            });
        });
        formEl.querySelectorAll('.props-remove-img-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                dossierPhotoDataUrl = null;
                renderAll();
            });
        });
    }

    // ── 自定义模板表单 ───────────────────────────────────────────
    function renderCustomForm(formEl) {
        formEl.innerHTML = `
            <label class="props-field-label">背景图片</label>
            <div class="props-file-upload">
                <input type="file" accept="image/*" id="customBgInput" style="display:none">
                <button class="props-upload-btn" id="customBgBtn" type="button">
                    ${customBgDataUrl ? '✅ 已上传 (点击更换)' : '🖼 选择背景图'}
                </button>
            </div>
            <hr style="border-color:rgba(255,255,255,0.08);margin:12px 0">
            <label class="props-field-label">工具</label>
            <button class="props-upload-btn" id="customAddTextBtn" type="button" style="width:100%">＋ 添加文字框</button>
            <div style="margin-top:6px">
                <input type="file" accept="image/*" id="customAddImgInput" style="display:none" multiple>
                <button class="props-upload-btn" id="customAddImgBtn" type="button" style="width:100%">🖼 添加图片</button>
            </div>
            <hr style="border-color:rgba(255,255,255,0.08);margin:12px 0">
            <p style="font-size:10px;color:rgba(255,255,255,0.35);line-height:1.5">
                ▪ 双击文字框编辑内容<br>
                ▪ 选中后按 Delete 删除<br>
                ▪ 滚轮缩放画布<br>
                ▪ 按住 Space+拖拽平移画布
            </p>
        `;

        // 背景上传
        const bgBtn = formEl.querySelector('#customBgBtn');
        const bgInput = formEl.querySelector('#customBgInput');
        bgBtn.addEventListener('click', () => bgInput.click());
        bgInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                customBgDataUrl = ev.target.result;
                loadCustomCanvasBg(customBgDataUrl);
                renderCustomForm(formEl);
            };
            reader.readAsDataURL(file);
        });

        // 添加文字框
        formEl.querySelector('#customAddTextBtn').addEventListener('click', addCustomTextbox);

        // 添加图片
        const addImgBtn = formEl.querySelector('#customAddImgBtn');
        const addImgInput = formEl.querySelector('#customAddImgInput');
        addImgBtn.addEventListener('click', () => addImgInput.click());
        addImgInput.addEventListener('change', e => {
            Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => addCustomImage(ev.target.result);
                reader.readAsDataURL(file);
            });
            addImgInput.value = ''; // 重置以支持重复选择
        });

        // 初始化 canvas
        initCustomCanvas();
    }

    // ── 自定义画布：无限画布 + 键盘删除 + 平移缩放 ──────────
    let _customSpaceDown = false, _customPanning = false, _customLastPt = null;

    function initCustomCanvas() {
        const previewEl = document.getElementById('propsPreview');
        if (!previewEl) return;

        if (customCanvas) {
            const wrapper = previewEl.querySelector('.props-custom-canvas-wrap');
            if (wrapper) wrapper.style.display = 'block';
            customCanvas.renderAll();
            return;
        }

        // 清空预览区全部内容
        previewEl.innerHTML = `
            <div class="props-custom-canvas-wrap">
                <canvas id="propsCustomCanvas"></canvas>
            </div>`;

        // 让 canvas 填满预览区
        const pane = previewEl.closest('.props-preview-pane');
        const pw = pane ? pane.clientWidth - 40 : 800;
        const ph = pane ? pane.clientHeight - 40 : 600;

        customCanvas = new fabric.Canvas('propsCustomCanvas', {
            width: pw,
            height: ph,
            backgroundColor: '#e8e0cc',
            selection: true,
        });

        if (customBgDataUrl) loadCustomCanvasBg(customBgDataUrl);

        // DEL 键删除
        window.addEventListener('keydown', e => {
            if (currentTemplate !== 'custom' || !customCanvas) return;
            if (!document.getElementById('propsPanel').classList.contains('active')) return;
            // 正在编辑文字时不拦截
            if (customCanvas.getActiveObject() && customCanvas.getActiveObject().isEditing) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                const active = customCanvas.getActiveObject();
                if (active) {
                    if (active.type === 'activeSelection') {
                        active.forEachObject(o => customCanvas.remove(o));
                        customCanvas.discardActiveObject();
                    } else {
                        customCanvas.remove(active);
                    }
                    customCanvas.renderAll();
                    e.preventDefault();
                }
            }
            if (e.code === 'Space' && !_customSpaceDown) {
                _customSpaceDown = true;
                customCanvas.defaultCursor = 'grab';
                customCanvas.selection = false;
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', e => {
            if (e.code === 'Space') {
                _customSpaceDown = false;
                _customPanning = false;
                if (customCanvas) {
                    customCanvas.defaultCursor = 'default';
                    customCanvas.selection = true;
                }
            }
        });

        // 空格平移
        customCanvas.on('mouse:down', opt => {
            if (_customSpaceDown) {
                _customPanning = true;
                _customLastPt = { x: opt.e.clientX, y: opt.e.clientY };
                customCanvas.defaultCursor = 'grabbing';
            }
        });
        customCanvas.on('mouse:move', opt => {
            if (_customPanning && _customLastPt) {
                const vpt = customCanvas.viewportTransform;
                vpt[4] += opt.e.clientX - _customLastPt.x;
                vpt[5] += opt.e.clientY - _customLastPt.y;
                customCanvas.requestRenderAll();
                _customLastPt = { x: opt.e.clientX, y: opt.e.clientY };
            }
        });
        customCanvas.on('mouse:up', () => {
            _customPanning = false;
            if (_customSpaceDown) customCanvas.defaultCursor = 'grab';
        });

        // 滚轮缩放
        customCanvas.on('mouse:wheel', opt => {
            const delta = opt.e.deltaY;
            let zoom = customCanvas.getZoom();
            zoom *= 0.999 ** delta;
            zoom = Math.min(Math.max(0.1, zoom), 10);
            customCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
    }

    function loadCustomCanvasBg(dataUrl) {
        if (!customCanvas) return;
        fabric.Image.fromURL(dataUrl, img => {
            const scale = Math.max(customCanvas.width / img.width, customCanvas.height / img.height);
            customCanvas.setBackgroundImage(img, customCanvas.renderAll.bind(customCanvas), {
                scaleX: scale, scaleY: scale,
                originX: 'left', originY: 'top',
            });
        });
    }

    function addCustomTextbox() {
        if (!customCanvas) return;
        // 在可见区域中心放置
        const vpt = customCanvas.viewportTransform;
        const zoom = customCanvas.getZoom();
        const cx = (customCanvas.width / 2 - vpt[4]) / zoom;
        const cy = (customCanvas.height / 2 - vpt[5]) / zoom;
        const textbox = new fabric.Textbox('双击编辑文字', {
            left: cx - 100 + Math.random() * 40,
            top: cy - 20 + Math.random() * 40,
            width: 200, fontSize: 18,
            fontFamily: 'Special Elite, serif',
            fill: '#1a0e05',
            backgroundColor: 'rgba(255,255,230,0.6)',
            padding: 8,
            borderColor: '#c9a84c', cornerColor: '#c9a84c',
            cornerSize: 8, transparentCorners: false,
            editable: true,
        });
        customCanvas.add(textbox);
        customCanvas.setActiveObject(textbox);
        customCanvas.renderAll();
    }

    function addCustomImage(dataUrl) {
        if (!customCanvas) return;
        fabric.Image.fromURL(dataUrl, img => {
            // 缩放以适应画布
            const maxDim = Math.min(customCanvas.width, customCanvas.height) * 0.6;
            const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
            const vpt = customCanvas.viewportTransform;
            const zoom = customCanvas.getZoom();
            img.set({
                left: (customCanvas.width / 2 - vpt[4]) / zoom,
                top: (customCanvas.height / 2 - vpt[5]) / zoom,
                scaleX: scale, scaleY: scale,
                originX: 'center', originY: 'center',
                borderColor: '#c9a84c', cornerColor: '#c9a84c',
                cornerSize: 8, transparentCorners: false,
            });
            customCanvas.add(img);
            customCanvas.setActiveObject(img);
            customCanvas.renderAll();
        });
    }

    // ── 更新预览 ─────────────────────────────────────────────
    function updatePreview() {
        const previewEl = document.getElementById('propsPreview');
        if (!previewEl) return;

        // 自定义模式：清除所有非 canvas 内容，显示 canvas
        if (currentTemplate === 'custom') {
            // 移除所有 .props-doc 元素
            previewEl.querySelectorAll('.props-doc').forEach(d => d.remove());
            initCustomCanvas();
            return;
        }

        // 非自定义模式：隐藏 canvas
        const customWrap = previewEl.querySelector('.props-custom-canvas-wrap');
        if (customWrap) customWrap.style.display = 'none';

        const tpl = TEMPLATES[currentTemplate];
        if (!tpl) return;
        const vals = fieldValues[currentTemplate] || {};

        const sepia = (agingLevel * 80).toFixed(0);
        const contrast = (100 - agingLevel * 15).toFixed(0);
        const brightness = (100 - agingLevel * 10).toFixed(0);
        const agingFilter = `sepia(${sepia}%) contrast(${contrast}%) brightness(${brightness}%)`;

        let innerHTML = '';

        if (currentTemplate === 'letter') {
            innerHTML = `
                <div class="props-doc props-letter" style="filter:${agingFilter}">
                    <div class="props-letter-wax"></div>
                    <p class="props-letter-date">${esc(vals.date || '日期未填')}</p>
                    <p class="props-letter-recipient">${esc(vals.recipient || 'Dear ...')}</p>
                    <div class="props-letter-body">${nlToBr(esc(vals.body || '信件正文'))}</div>
                    <p class="props-letter-sig">${esc(vals.signature || '— 签名')}</p>
                </div>`;
        } else if (currentTemplate === 'newspaper') {
            innerHTML = `
                <div class="props-doc props-newspaper" style="filter:${agingFilter}">
                    <div class="props-np-masthead">THE DAILY CHRONICLE</div>
                    <div class="props-np-date">${esc(vals.source || 'Source')}</div>
                    <hr class="props-np-rule">
                    <h1 class="props-np-headline">${esc(vals.headline || 'HEADLINE')}</h1>
                    <h2 class="props-np-subtitle">${esc(vals.subtitle || '')}</h2>
                    <hr class="props-np-rule">
                    <div class="props-np-body">${nlToBr(esc(vals.body || '正文'))}</div>
                </div>`;
        } else if (currentTemplate === 'telegram') {
            innerHTML = `
                <div class="props-doc props-telegram" style="filter:${agingFilter}">
                    <div class="props-tg-header">
                        <span>⚡ TELEGRAM</span>
                        <span class="props-tg-num">${esc(vals.number || 'TEL-000')}</span>
                    </div>
                    <div class="props-tg-strip"></div>
                    <div class="props-tg-field"><b>TO:</b> ${esc(vals.to || '...')}</div>
                    <div class="props-tg-field"><b>FROM:</b> ${esc(vals.from || '...')}</div>
                    <div class="props-tg-strip"></div>
                    <div class="props-tg-body">${esc(vals.body || '...').replace(/STOP/g, '<b class="props-tg-stop">STOP</b>')}</div>
                    <div class="props-tg-strip"></div>
                    <div class="props-tg-footer">${esc(vals.time || '00:00 GMT')}</div>
                </div>`;
        } else if (currentTemplate === 'dossier') {
            const photoHtml = dossierPhotoDataUrl
                ? `<img src="${dossierPhotoDataUrl}" class="props-ds-photo-img" alt="照片">`
                : '📷';
            innerHTML = `
                <div class="props-doc props-dossier" style="filter:${agingFilter}">
                    <div class="props-ds-stamp">CONFIDENTIAL</div>
                    <div class="props-ds-case">${esc(vals.casenum || 'CASE #___')}</div>
                    <div class="props-ds-photo-area">${photoHtml}</div>
                    <div class="props-ds-field"><span class="props-ds-key">NAME:</span> ${esc(vals.name || '...')}</div>
                    <div class="props-ds-field"><span class="props-ds-key">ALIAS:</span> ${esc(vals.alias || '...')}</div>
                    <div class="props-ds-field"><span class="props-ds-key">STATUS:</span> <span class="props-ds-danger">${esc(vals.status || '...')}</span></div>
                    <hr style="border-color:rgba(0,0,0,0.15)">
                    <div class="props-ds-desc">${nlToBr(esc(vals.desc || '描述'))}</div>
                </div>`;
        }

        // 替换旧文档内容，保留隐藏的 canvas 容器
        previewEl.querySelectorAll('.props-doc').forEach(d => d.remove());
        const frag = document.createElement('div');
        frag.innerHTML = innerHTML;
        while (frag.firstChild) {
            if (customWrap) previewEl.insertBefore(frag.firstChild, customWrap);
            else previewEl.appendChild(frag.firstChild);
        }
    }

    // ── 导出 PNG ──────────────────────────────────────────────────
    function exportPNG() {
        // 自定义画布直接用 fabric 导出
        if (currentTemplate === 'custom' && customCanvas) {
            const dataUrl = customCanvas.toDataURL({ format: 'png', multiplier: 2 });
            downloadDataUrl(dataUrl, 'clueforge-custom.png');
            return;
        }

        // 其他模板：克隆 DOM 到 iframe → 内联所有样式 → 用 html2canvas 逻辑渲染
        const previewEl = document.getElementById('propsPreview');
        if (!previewEl) return;
        const docEl = previewEl.querySelector('.props-doc');
        if (!docEl) return;

        // 克隆节点 + 内联所有计算样式
        const clone = docEl.cloneNode(true);
        inlineAllStyles(docEl, clone);

        // 创建一个离屏容器
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
        container.appendChild(clone);
        document.body.appendChild(container);

        // 等一帧让浏览器布局
        requestAnimationFrame(() => {
            const rect = clone.getBoundingClientRect();
            const dpr = 2;
            const w = Math.ceil(rect.width);
            const h = Math.ceil(rect.height);

            // 用 SVG foreignObject + 内联样式（此时所有样式已嵌入元素）
            // 先把所有图片转为 dataURL
            const images = clone.querySelectorAll('img');
            const promises = Array.from(images).map(img => {
                if (img.src.startsWith('data:')) return Promise.resolve();
                return new Promise(resolve => {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth || 90;
                    c.height = img.naturalHeight || 110;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    try { img.src = c.toDataURL(); } catch (_) { }
                    resolve();
                });
            });

            Promise.all(promises).then(() => {
                const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
                    <foreignObject width="100%" height="100%">
                        <div xmlns="http://www.w3.org/1999/xhtml" style="font-size:0;line-height:0">
                            ${clone.outerHTML}
                        </div>
                    </foreignObject>
                </svg>`;
                const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const cvs = document.createElement('canvas');
                cvs.width = w * dpr;
                cvs.height = h * dpr;
                const ctx = cvs.getContext('2d');
                ctx.scale(dpr, dpr);
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, w, h);
                    URL.revokeObjectURL(url);
                    document.body.removeChild(container);
                    downloadDataUrl(cvs.toDataURL('image/png'), `clueforge-${currentTemplate}.png`);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    document.body.removeChild(container);
                    // 终极回退：直接导出文档截图提示
                    alert('PNG 导出受浏览器安全策略限制。\n建议使用浏览器截图功能（Win: Win+Shift+S）');
                };
                img.src = url;
            });
        });
    }

    /** 递归内联所有计算样式到 clone 的 style 属性 */
    function inlineAllStyles(original, clone) {
        const computed = window.getComputedStyle(original);
        const important = [
            'font-family', 'font-size', 'font-weight', 'font-style',
            'color', 'background-color', 'background-image', 'background-size',
            'background-repeat', 'background-position',
            'border', 'border-radius', 'border-top', 'border-bottom', 'border-left', 'border-right',
            'padding', 'margin', 'width', 'height', 'min-height', 'max-width',
            'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
            'text-align', 'letter-spacing', 'line-height', 'text-transform',
            'position', 'top', 'right', 'bottom', 'left',
            'transform', 'opacity', 'box-shadow', 'overflow',
            'column-count', 'column-gap', 'column-rule', 'filter',
            'white-space', 'word-break',
        ];
        let styleStr = '';
        important.forEach(p => {
            const v = computed.getPropertyValue(p);
            if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)') {
                styleStr += `${p}:${v};`;
            }
        });
        clone.style.cssText = styleStr;

        // 递归子节点
        const origChildren = original.children;
        const cloneChildren = clone.children;
        for (let i = 0; i < origChildren.length; i++) {
            if (cloneChildren[i]) inlineAllStyles(origChildren[i], cloneChildren[i]);
        }
    }

    function downloadDataUrl(dataUrl, filename) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        a.click();
    }

    // ── 工具函数 ──────────────────────────────────────────────────
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function nlToBr(s) { return s.replace(/\n/g, '<br>'); }

    return { init };
})();
