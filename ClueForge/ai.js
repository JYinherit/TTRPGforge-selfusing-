/* ================================================================
   ClueForge — AI Assistant模块  |  ai.js
   提供悬浮球和与AI (Gemini/AI Studio) 通信的上下文打包功能
   ================================================================ */
'use strict';

const AIModule = (() => {

    let modal, toggleBtn, contextPreview, questionInput;
    let currentContextText = '';

    function init() {
        buildToggleBtn();
        buildModal();
        bindEvents();
    }

    function buildToggleBtn() {
        const btn = document.createElement('button');
        btn.id = 'aiToggleBtn';
        btn.className = 'ai-toggle-btn';
        btn.title = 'AI 助手 (提问当前情况)';
        btn.innerHTML = '✨';
        document.body.appendChild(btn);
        toggleBtn = btn;
    }

    function buildModal() {
        const html = `
<div class="ai-modal-overlay" id="aiModalOverlay" style="display:none"></div>
<div class="ai-modal" id="aiModal" style="display:none">
    <div class="ai-modal-header">
        <h3>✨ AI 调查助手</h3>
        <button id="aiModalClose" class="layer-toggle-btn" title="关闭">✕</button>
    </div>
    <div class="ai-modal-body">
        <div class="ai-context-section">
            <div class="ai-section-title">
                <span>当前剧本上下文摘要</span>
                <span class="ai-char-count" id="aiCharCount">0 字符</span>
            </div>
            <textarea id="aiContextPreview" class="ai-textarea ai-preview-textarea" readonly placeholder="正在收集上下文..."></textarea>
            <p class="ai-hint-text">系统会自动收集地图标注、线索墙内容、时间线与KP笔记并作为背景发送给AI。</p>
        </div>
        
        <div class="ai-query-section">
            <div class="ai-section-title">向 AI 提问：</div>
            <textarea id="aiQuestionInput" class="ai-textarea ai-question-textarea" placeholder="在此输入您的问题，例如：\n'根据以上线索，玩家下一步最可能去哪里？'\n'你能帮我把这些线索整理成一段发给玩家看的剧情描述吗？'"></textarea>
        </div>
    </div>
    <div class="ai-modal-footer">
        <button id="btnSendGemini" class="ai-send-btn gemini-btn">
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6a5.87 5.87 0 0 1-2.8-.7l-1.46 1.46A7.93 7.93 0 0 0 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46A7.93 7.93 0 0 0 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z" fill="currentColor"/>
            </svg>
            发送至 Gemini
        </button>
        <button id="btnSendAiStudio" class="ai-send-btn aistudio-btn">
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
            发送至 AI Studio
        </button>
    </div>
</div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        modal = document.getElementById('aiModal');
        contextPreview = document.getElementById('aiContextPreview');
        questionInput = document.getElementById('aiQuestionInput');
    }

    function bindEvents() {
        toggleBtn.addEventListener('click', openModal);
        document.getElementById('aiModalClose').addEventListener('click', closeModal);
        document.getElementById('aiModalOverlay').addEventListener('click', closeModal);

        document.getElementById('btnSendGemini').addEventListener('click', () => sendToAI('https://gemini.google.com/'));
        document.getElementById('btnSendAiStudio').addEventListener('click', () => sendToAI('https://aistudio.google.com/'));
    }

    async function openModal() {
        modal.style.display = 'flex';
        document.getElementById('aiModalOverlay').style.display = 'block';
        toggleBtn.classList.add('active');
        questionInput.focus();

        contextPreview.style.opacity = '0.5';
        contextPreview.value = '正在收集当前项目上下文数据...';

        const contextStr = await gatherContextText();
        currentContextText = contextStr;

        contextPreview.value = currentContextText;
        contextPreview.style.opacity = '1';
        document.getElementById('aiCharCount').textContent = currentContextText.length + ' 字符';
    }

    function closeModal() {
        modal.style.display = 'none';
        document.getElementById('aiModalOverlay').style.display = 'none';
        toggleBtn.classList.remove('active');
    }

    async function sendToAI(url) {
        const question = questionInput.value.trim() || '请根据以上情况，给我一些下一步游戏推进的建议。';
        const finalPrompt =
            `以下是我作为 TRPG (跑团) 主持人 (KP) 目前的剧本和线索上下文情况：

=== 上下文开始 ===
${currentContextText}
=== 上下文结束 ===

我的问题/请求是：
${question}`;

        try {
            await navigator.clipboard.writeText(finalPrompt);
            Bus.emit('status:update', { target: 'cb', field: 'hint', text: '提示：提问已复制到剪贴板，正在前往AI站点...' });
            Bus.emit('status:update', { target: 'map', field: 'hint', text: '提示：提问已复制到剪贴板，正在前往AI站点...' });

            // 为了确信提示存在
            const oldStatus = toggleBtn.title;
            toggleBtn.title = '✓ 已复制！请在弹出的页面粘贴';
            setTimeout(() => toggleBtn.title = oldStatus, 3000);

            // 在新标签页打开AI网站
            window.open(url, '_blank');
            closeModal();

        } catch (e) {
            console.error('复制失败', e);
            alert('复制到剪贴板失败，请手动全选预览框及问题并复制内容。\n\n错误信息: ' + e.message);
        }
    }

    // --- 数据收集逻辑 ---
    // 通过调用已有的 project 收集器，或者直接广播收集
    async function gatherContextText() {
        let parts = [];

        let mapData = null, cbData = null, notesData = null, tlData = null;

        await new Promise(resolve => Bus.emit('project:collect:map', d => { mapData = d; resolve(); }));
        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:cb', d => { cbData = d; collected = true; resolve(); });
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });
        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:notes', d => { notesData = d; collected = true; resolve(); });
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });
        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:timeline', d => { tlData = d; collected = true; resolve(); });
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });

        // 1. 提取 KP 笔记
        if (notesData && notesData.notes && notesData.notes.length > 0) {
            parts.push('【KP笔记】');
            notesData.notes.forEach(n => {
                parts.push(`标题: ${n.title || '（无标题）'}`);
                parts.push(`内容: ${n.content}`);
                parts.push('---');
            });
            parts.push('');
        }

        // 2. 提取时间线
        if (tlData && tlData.lanes && tlData.lanes.length > 0) {
            let hasEvents = false;
            let tlLines = [];
            tlData.lanes.forEach(lane => {
                if (lane.events && lane.events.length > 0) {
                    hasEvents = true;
                    tlLines.push(`泳道 [${lane.name}]:`);
                    // 按 x 轴大致排序（时间顺序）
                    const sorted = [...lane.events].sort((a, b) => a.x - b.x);
                    sorted.forEach(ev => {
                        tlLines.push(` - [${ev.time || '未定时间'}] ${ev.title} (${ev.desc || ''})`);
                    });
                }
            });
            if (hasEvents) {
                parts.push('【时间线】');
                parts.push(tlLines.join('\n'));
                parts.push('');
            }
        }

        // 3. 提取线索墙文本
        if (cbData && cbData.canvasJSON && cbData.canvasJSON.objects) {
            const extracted = extractTextFromCanvas(cbData.canvasJSON.objects);
            if (extracted) {
                parts.push('【线索墙】');
                parts.push('画板上的线索文本摘要：');
                parts.push(extracted);
                parts.push('');
            }
        }

        // 4. 提取地图标注/图例
        if (mapData) {
            let mapLines = [];
            if (mapData.legendText) {
                mapLines.push(`地图图例: ${mapData.legendText}`);
            }
            if (mapData.canvasJSON && mapData.canvasJSON.objects) {
                const extracted = extractTextFromCanvas(mapData.canvasJSON.objects);
                if (extracted && extracted !== mapData.legendText) {
                    mapLines.push('地图上的文本标记: ' + extracted);
                }
            }
            if (mapLines.length > 0) {
                parts.push('【地图标注】');
                parts.push(mapLines.join('\n'));
                parts.push('');
            }
        }

        if (parts.length === 0) {
            return "当前项目似乎是空白的，没有捕捉到任何文本或线索。";
        }

        return parts.join('\n');
    }

    // 从 Fabric 序列化对象中提取文本的通用方法
    function extractTextFromCanvas(objects) {
        if (!objects || !Array.isArray(objects)) return '';
        let texts = [];
        objects.forEach(obj => {
            if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
                if (obj.text) texts.push(obj.text);
            } else if (obj.type === 'group' && obj.objects) {
                const subTxt = extractTextFromCanvas(obj.objects);
                if (subTxt) texts.push(subTxt);
            }
        });
        // 去重和清理
        return Array.from(new Set(texts.map(t => t.trim()).filter(t => t !== ''))).join(' | ');
    }

    return { init };
})();
