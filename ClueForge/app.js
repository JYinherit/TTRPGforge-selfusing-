/* ================================================================
   ClueForge — 入口  |  app.js
   初始化所有模块，设置 EventBus 连线
   ================================================================ */
'use strict';

// 按依赖顺序初始化各模块
// （Bus 已在 eventbus.js 中定义为全局变量）
UIModule.init();
MapModule.init();
ClueBoardModule.init();
PropsModule.init();
NotesModule.init();
TimelineModule.init();
ProjectModule.init();
SettingsModule.init();

// 默认激活地图标签
UIModule.switchTab('map');
