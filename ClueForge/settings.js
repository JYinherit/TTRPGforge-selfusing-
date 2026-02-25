/* ================================================================
   ClueForge — 设置面板模块  |  settings.js
   包含项目保存/读取、本地缓存管理
   ================================================================ */
'use strict';

const SettingsModule = (() => {

    let panelEl, overlayEl;

    function init() {
        panelEl = document.getElementById('settingsPanel');
        overlayEl = document.getElementById('settingsOverlay');

        // 面板开关
        document.getElementById('btn-settings').addEventListener('click', openPanel);
        document.getElementById('btn-close-settings').addEventListener('click', closePanel);
        overlayEl.addEventListener('click', closePanel);

        // 绑定动作
        document.getElementById('set-save-btn').addEventListener('click', () => {
            Bus.emit('project:action:save');
            closePanel();
        });

        document.getElementById('set-load-btn').addEventListener('click', () => {
            document.getElementById('loadProjectInput').click();
            closePanel();
        });

        document.getElementById('set-exp-cache-btn').addEventListener('click', () => {
            Bus.emit('project:action:exportCache');
            closePanel();
        });

        document.getElementById('set-clr-cache-btn').addEventListener('click', () => {
            Bus.emit('project:action:clearCache');
        });

        // ESC 关闭
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && panelEl.classList.contains('active')) {
                closePanel();
            }
        });
    }

    function openPanel() {
        panelEl.classList.add('active');
        overlayEl.classList.add('active');
    }

    function closePanel() {
        panelEl.classList.remove('active');
        overlayEl.classList.remove('active');
    }

    return { init };
})();
