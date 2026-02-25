/* ================================================================
   ClueForge — UI 管理  |  ui.js
   标签切换、状态栏更新
   ================================================================ */
'use strict';

const UIModule = (() => {

    function init() {
        // 标签切换按钮
        document.getElementById('tabMap').addEventListener('click', () => switchTab('map'));
        document.getElementById('tabClue').addEventListener('click', () => switchTab('clue'));
        document.getElementById('tabProps').addEventListener('click', () => switchTab('props'));
        document.getElementById('tabTimeline').addEventListener('click', () => switchTab('timeline'));

        // 订阅状态栏更新
        Bus.on('status:update', onStatusUpdate);
    }

    function switchTab(tab) {
        // 面板切换
        document.getElementById('mapPanel').classList.toggle('active', tab === 'map');
        document.getElementById('cluePanel').classList.toggle('active', tab === 'clue');
        document.getElementById('propsPanel').classList.toggle('active', tab === 'props');
        document.getElementById('timelinePanel').classList.toggle('active', tab === 'timeline');

        // 按钮高亮
        document.getElementById('tabMap').classList.toggle('active', tab === 'map');
        document.getElementById('tabClue').classList.toggle('active', tab === 'clue');
        document.getElementById('tabProps').classList.toggle('active', tab === 'props');
        document.getElementById('tabTimeline').classList.toggle('active', tab === 'timeline');

        // 发布事件
        Bus.emit('tab:switched', { tab });
    }

    function onStatusUpdate({ target, field, text }) {
        // target: 'map' | 'cb'
        if (target === 'map') {
            if (field === 'mode') document.getElementById('statusMode').textContent = text;
            if (field === 'zoom') document.getElementById('statusZoom').textContent = text;
            if (field === 'objects') document.getElementById('statusObjects').textContent = text;
            if (field === 'hint') document.getElementById('statusHint').textContent = text;
        } else if (target === 'cb') {
            if (field === 'mode') document.getElementById('cbStatusMode').textContent = text;
            if (field === 'count') document.getElementById('cbStatusCount').textContent = text;
            if (field === 'hint') document.getElementById('cbStatusHint').textContent = text;
        }
    }

    return { init, switchTab };
})();
