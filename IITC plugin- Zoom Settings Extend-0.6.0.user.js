// ==UserScript==
// @id             iitc-plugin-zoom-settings-extend
// @name           IITC plugin: Zoom Settings Extend
// @category       d.org.addon
// @version        0.6.0
// @updateURL      none
// @downloadURL    none
// @description    [0.6.0] ズーム倍率ボタンの拡張 (待機処理・安全化強化版)
// @match          https://intel.ingress.com/*
// @match          https://intel-x.ingress.com/*
// @match          http://intel.ingress.com/*
// @match          http://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==

function wrapper(plugin_info) {
    // ensure plugin framework is there, even if iitc is not yet loaded
    if(typeof window.plugin !== 'function') window.plugin = function() {};

    plugin_info.buildName = 'local';
    plugin_info.dateTimeVersion = '20260127.060000';
    plugin_info.pluginId = 'zoom-settings-extend';

    // --- 名前空間の確保 ---
    window.plugin.zoomSettingsExtend = {};
    const self = window.plugin.zoomSettingsExtend;

    const STORAGE_KEY = 'plugin-zoom-settings-extend-v1';

    // デフォルト設定
    self.settings = {
        showExtendPanel: true,
        forcePanelTop: false,
        hideDefaultBtn: false,
        preventMapDbl: true,
        preventPortalDbl: true,
        preventWheel: true
    };

    // --- 設定ロード ---
    self.loadSettings = function() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) self.settings = JSON.parse(stored);
        } catch(e) {
            console.warn('ZoomExtend: Settings load error', e);
        }
    };
    self.saveSettings = function() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(self.settings));
    };

    // --- CSS注入 (Pure JS) ---
    self.addStyle = function() {
        const css = `
            .leaflet-control-zoom-extend {
                background: #fff;
                border: 2px solid rgba(0,0,0,0.2);
                background-clip: padding-box;
                border-radius: 4px;
                padding: 2px;
                display: flex;
                flex-direction: column;
                gap: 1px;
                margin-bottom: 10px !important;
                clear: both;
                pointer-events: auto; /* モバイルでのタッチ透過防止 */
            }
            .ze-row { display: flex; align-items: center; }
            .ze-btn {
                width: 26px; height: 20px; line-height: 20px;
                text-align: center; font-weight: bold; cursor: pointer;
                background-color: #f4f4f4; border: 1px solid #ccc;
                margin: 0 1px; font-size: 10px; color: #333; border-radius: 2px;
                user-select: none;
            }
            .ze-btn:hover { background-color: #e0e0e0; }
            .ze-btn:active { background-color: #bbb; }
            .ze-header { width: 16px; text-align: center; font-weight: bold; color: #000; font-size:12px; }
            .ze-reset { width: 100%; margin-top: 2px; background: #ffecb3; font-size: 11px; }
        `;
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        document.head.appendChild(style);
    };

    // --- 機能適用 ---
    self.applySettings = function() {
        if (!window.map) return;

        try {
            // 1. マウスホイール
            if (window.map.scrollWheelZoom) {
                self.settings.preventWheel ? window.map.scrollWheelZoom.disable() : window.map.scrollWheelZoom.enable();
            }

            // 2. マップダブルクリック
            if (window.map.doubleClickZoom) {
                self.settings.preventMapDbl ? window.map.doubleClickZoom.disable() : window.map.doubleClickZoom.enable();
            }

            // 3. パネル表示
            const $panel = $('.leaflet-control-zoom-extend');
            if ($panel.length) {
                if (self.settings.showExtendPanel) {
                    $panel.show();
                    if (self.settings.forcePanelTop) {
                        const container = $panel.closest('.leaflet-top.leaflet-left');
                        if (container.length) $panel.detach().prependTo(container);
                    }
                } else {
                    $panel.hide();
                }
            }

            // 4. デフォルトボタン
            const $defBtn = $('.leaflet-control-zoom');
            if ($defBtn.length) {
                self.settings.hideDefaultBtn ? $defBtn.hide() : $defBtn.show();
            }

            // 5. リスナー更新 & スナップ設定
            updatePortalClickListener();

            if(window.map.options) {
                window.map.options.zoomDelta = 1.0;
                window.map.options.zoomSnap = 0.01;
            }

        } catch(e) {
            console.error('ZoomExtend: Error in applySettings', e);
        }
    };

    function preventDblClick(e) {
        if (self.settings.preventPortalDbl) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            return false;
        }
    }

    let isListenerAttached = false;
    function updatePortalClickListener() {
        if(!window.map) return;
        const mapContainer = window.map.getContainer();
        if(!mapContainer) return;

        if (self.settings.preventPortalDbl) {
            if (!isListenerAttached) {
                mapContainer.addEventListener('dblclick', preventDblClick, true);
                isListenerAttached = true;
            }
        } else {
            if (isListenerAttached) {
                mapContainer.removeEventListener('dblclick', preventDblClick, true);
                isListenerAttached = false;
            }
        }
    }

    // --- コントロール生成 ---
    self.setupControl = function() {
        if (!window.L || !window.L.Control) {
            console.warn('ZoomExtend: Leaflet not ready for control setup.');
            return;
        }

        // 既に存在する場合は作らない（多重ロード防止）
        if ($('.leaflet-control-zoom-extend').length > 0) return;

        const ZoomExtendControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-zoom-extend');
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                const steps = [1.0, 0.8, 0.6, 0.4, 0.2, 0.1];
                const createRow = (symbol, isPlus) => {
                    const row = document.createElement('div');
                    row.className = 'ze-row';
                    row.innerHTML = `<div class="ze-header">${symbol}</div>`;
                    steps.forEach(step => {
                        let btn = document.createElement('div');
                        btn.className = 'ze-btn';
                        btn.innerText = step;
                        // タッチデバイスでの反応向上のためtouchendも考慮（念のためclickのみで実装しstopPropagationで守る）
                        btn.onclick = (e) => {
                            e.preventDefault();
                            isPlus ? map.zoomIn(step) : map.zoomOut(step);
                        };
                        row.appendChild(btn);
                    });
                    return row;
                };

                container.appendChild(createRow('➕', true));
                container.appendChild(createRow('➖', false));

                const rowReset = document.createElement('div');
                rowReset.className = 'ze-row';
                let btnReset = document.createElement('div');
                btnReset.className = 'ze-btn ze-reset';
                btnReset.innerText = '🔃 Reset (15)';
                btnReset.onclick = (e) => { e.preventDefault(); map.setZoom(15); };
                rowReset.appendChild(btnReset);
                container.appendChild(rowReset);

                return container;
            }
        });
        window.map.addControl(new ZoomExtendControl());
    };

    // --- 設定ダイアログ ---
    self.openSettings = function() {
        const html = `
            <div style="font-size: 13px; line-height: 2;">
                <strong>UI設定</strong>
                <table>
                    <tr><td><input type="checkbox" id="ze-opt-panel" ${self.settings.showExtendPanel ? 'checked' : ''}></td>
                    <td><label for="ze-opt-panel">拡張パネルを表示</label></td></tr>
                    <tr><td><input type="checkbox" id="ze-opt-top" ${self.settings.forcePanelTop ? 'checked' : ''}></td>
                    <td><label for="ze-opt-top">最上段に強制 <span style="color:red;font-size:10px;">(※リロード推奨)</span></label></td></tr>
                    <tr><td><input type="checkbox" id="ze-opt-hidedef" ${self.settings.hideDefaultBtn ? 'checked' : ''}></td>
                    <td><label for="ze-opt-hidedef">デフォルトボタンを隠す</label></td></tr>
                </table>
                <hr>
                <strong>動作設定</strong>
                <table>
                    <tr><td><input type="checkbox" id="ze-opt-mapdbl" ${self.settings.preventMapDbl ? 'checked' : ''}></td>
                    <td><label for="ze-opt-mapdbl">マップダブルクリック防止</label></td></tr>
                    <tr><td><input type="checkbox" id="ze-opt-portaldbl" ${self.settings.preventPortalDbl ? 'checked' : ''}></td>
                    <td><label for="ze-opt-portaldbl">ポータルダブルクリック防止</label></td></tr>
                    <tr><td><input type="checkbox" id="ze-opt-wheel" ${self.settings.preventWheel ? 'checked' : ''}></td>
                    <td><label for="ze-opt-wheel">ホイールズーム防止</label></td></tr>
                </table>
            </div>`;

        if(window.dialog) {
            window.dialog({ html: html, title: 'Zoom Settings Extend', width: 300, id: 'zoom-settings-dialog' });
        } else {
            alert('IITC Dialog not available.');
            return;
        }

        const bindCheck = (id, key) => {
            $('#'+id).change(function() {
                self.settings[key] = this.checked;
                self.saveSettings();
                self.applySettings();
            });
        };
        bindCheck('ze-opt-panel', 'showExtendPanel');
        bindCheck('ze-opt-top', 'forcePanelTop');
        bindCheck('ze-opt-hidedef', 'hideDefaultBtn');
        bindCheck('ze-opt-mapdbl', 'preventMapDbl');
        bindCheck('ze-opt-portaldbl', 'preventPortalDbl');
        bindCheck('ze-opt-wheel', 'preventWheel');
    };

    // --- メイン初期化 (リトライ機構付き) ---
    function init() {
        // マップとLeafletの準備確認
        if (!window.map || !window.L) {
            // まだ準備できていない場合、少し待つ (最大10回、500ms間隔)
            if (!init.retryCount) init.retryCount = 0;
            if (init.retryCount < 10) {
                init.retryCount++;
                setTimeout(init, 500);
                return;
            } else {
                console.error('ZoomExtend: Map not ready after retries. Aborting.');
                return;
            }
        }

        try {
            self.loadSettings();
            self.addStyle();
            self.setupControl();
            self.applySettings();

            // Toolbox追加
            if ($('#toolbox').length) {
                $('#toolbox').append('<a onclick="window.plugin.zoomSettingsExtend.openSettings();return false;">Zoom Opts</a>');
            }
            console.log('ZoomExtend: Loaded successfully.');
        } catch (e) {
            console.error('ZoomExtend: Critical setup error', e);
        }
    }

    var setup = init;
    setup.info = plugin_info;

    if(!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);

    if(window.iitcLoaded && typeof setup === 'function') {
        setup();
    }
}

var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);