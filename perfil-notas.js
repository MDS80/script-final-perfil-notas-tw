// ==UserScript==
// @name         TW Notes Scanner + Filtros de perfil - vfinal
// @namespace    http://tampermonkey.net/
// @version      1.7.0
// @description  Notes scanner + filtros K + muralha/torre + pontos + coords + pop defesa/ataque + datas defesa/ataque + velocidade scan
// @author       MDS80
// @match        *://*.tribalwars.com.pt/*
// @match        *://*.tribalwars.net/*
// @match        *://*.tribalwars.es/*
// @match        *://*.tribalwars.com.br/*
// @grant        none
// @run-at       document-idle
// @icon https://raw.githubusercontent.com/MDS80/tw-perfil-notes/main/logo MDS scripts.png
// ==/UserScript==

(function () {
    'use strict';

    function waitForTW(cb) {
        const start = Date.now();
        const max = 20000;

        const t = setInterval(() => {
            const hasJQ = typeof window.$ !== 'undefined';
            const hasUI = typeof window.UI !== 'undefined';
            const hasTable = document.querySelector('#villages_list');

            if (hasJQ && hasUI && hasTable) {
                clearInterval(t);
                cb();
                return;
            }

            if (Date.now() - start > max) {
                clearInterval(t);
                console.warn('[TW Script] Timeout: jQuery/UI/#villages_list não encontrados.');
            }
        }, 200);
    }

    waitForTW(init);

    function init() {
        if (window.__pp_notes_initialized) return;
        window.__pp_notes_initialized = true;

        const translations = {
            en: {
                notes: 'Notes',
                offensiveCount: 'Offensive villages count',
                defensiveCount: 'Defensive villages count',
                unknownCount: 'Unknown/unclassified villages count',
                pendingCount: 'Villages not yet analyzed',
                scanAll: 'Scan',
                scanAllTooltip: 'Load notes for all villages automatically',
                filterOff: 'OFF',
                filterOffTooltip: 'Show only offensive villages',
                filterDef: 'DEF',
                filterDefTooltip: 'Show only defensive villages',
                filterUnknown: '?',
                filterUnknownTooltip: 'Show only unknown villages',
                showAll: 'All',
                showAllTooltip: 'Show all villages',
                copyCoords: 'Copy Visible Coords',
                warningTitle: 'Warning:',
                warningMessage: 'Only {0} of {1} villages loaded. Click here to load all villages before scanning.',
                loadAll: 'Load All',
                villageIdNotFound: 'Village ID not found',
                gameDataNotAvailable: 'Game data not available',
                noNotesFound: 'No notes found for this village',
                failedToLoad: 'Failed to load note',
                copied: 'Copied {0} coordinates',
                villageNotes: 'Village Notes - {0}',
                scanConfirmMessage: 'This will load notes for all villages. This may take several minutes. Continue?',
                scanProgress: '{0}/{1} - {2}%',
                loadingAllVillages: 'Loading all villages...',
                scanningVillages: 'Scanning villages...'
            },
            pt_PT: {
                notes: 'Notas',
                offensiveCount: 'Contagem de aldeias ofensivas',
                defensiveCount: 'Contagem de aldeias defensivas',
                unknownCount: 'Contagem de aldeias desconhecidas/não classificadas',
                pendingCount: 'Aldeias ainda não analisadas',
                scanAll: 'Scan',
                scanAllTooltip: 'Carregar notas de todas as aldeias automaticamente',
                filterOff: 'OFF',
                filterOffTooltip: 'Mostrar apenas aldeias ofensivas',
                filterDef: 'DEF',
                filterDefTooltip: 'Mostrar apenas aldeias defensivas',
                filterUnknown: '?',
                filterUnknownTooltip: 'Mostrar apenas aldeias desconhecidas',
                showAll: 'Todas',
                showAllTooltip: 'Mostrar todas as aldeias',
                copyCoords: 'Copiar Coords Visíveis',
                warningTitle: 'Aviso:',
                warningMessage: 'Apenas {0} de {1} aldeias carregadas. Clique aqui para carregar todas as aldeias antes de analisar.',
                loadAll: 'Carregar Todas',
                villageIdNotFound: 'ID da aldeia não encontrado',
                gameDataNotAvailable: 'Dados do jogo não disponíveis',
                noNotesFound: 'Nenhuma nota encontrada para esta aldeia',
                failedToLoad: 'Falha ao carregar nota',
                copied: 'Copiadas {0} coordenadas',
                villageNotes: 'Notas da Aldeia - {0}',
                scanConfirmMessage: 'Isto irá carregar notas de todas as aldeias. Pode demorar vários minutos. Continuar?',
                scanProgress: '{0}/{1} - {2}%',
                loadingAllVillages: 'A carregar todas as aldeias...',
                scanningVillages: 'A analisar aldeias...'
            }
        };

        function getTranslation(key, ...args) {
            const locale = (typeof game_data !== 'undefined' && game_data.locale) || 'en';
            const lang = translations[locale] || translations.en;
            let text = lang[key] || translations.en[key] || key;
            args.forEach((arg, index) => { text = text.replace(`{${index}}`, arg); });
            return text;
        }

        window.pp_settings = window.pp_settings || {
            noteStates: {},
            wallLevels: {},
            towerLevels: {},
            // Quando NÓS atacámos (ele é defensor)
            lastNoteDef: {},    // villageId → timestamp do relatório mais recente onde ele é defensor
            popDefInside: {},   // tropas em casa nesse relatório
            popDefOutside: {},  // tropas fora nesse relatório (reconhecimento)
            // Quando ELE atacou (ele é atacante)
            lastNoteAtk: {},    // villageId → timestamp do relatório mais recente onde ele é atacante
            popAtkSent: {}      // tropas que ele enviou nesse relatório
        };

        // ── Multiplicadores de população por unidade ──
        const POP_COSTS = {
            spear: 1, sword: 1, axe: 1, archer: 1,
            spy: 2,
            light: 4, marcher: 5, heavy: 6,
            ram: 5, catapult: 8,
            knight: 10, snob: 100
        };

        // Mapeamento de class CSS → chave de custo
        const UNIT_CLASS_MAP = {
            'unit-item-spear':    'spear',
            'unit-item-sword':    'sword',
            'unit-item-axe':      'axe',
            'unit-item-archer':   'archer',
            'unit-item-spy':      'spy',
            'unit-item-light':    'light',
            'unit-item-marcher':  'marcher',
            'unit-item-heavy':    'heavy',
            'unit-item-ram':      'ram',
            'unit-item-catapult': 'catapult',
            'unit-item-knight':   'knight',
            'unit-item-snob':     'snob'
        };

        function classifyVillage(content) {
            const text = content.toLowerCase();
            if (text.includes('ofensiva') || text.includes('off')) return 'off';
            if (text.includes('defensiva') || text.includes('def')) return 'def';
            return 'no-data';
        }

        function getLabel(type) {
            if (type === 'off') return '⚔️';
            if (type === 'def') return '🛡️';
            if (type === 'no-data') return '❓';
            if (type === 'loading') return '...';
            return '⏳';
        }

        function loadSettings() {
            const saved = localStorage.getItem('pp_settings');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    window.pp_settings = { ...window.pp_settings, ...parsed };
                } catch (e) {
                    console.error('Failed to load pp_settings:', e);
                }
            }
        }

        function saveSettings() {
            try {
                localStorage.setItem('pp_settings', JSON.stringify(window.pp_settings));
            } catch (e) {
                console.error('Failed to save pp_settings:', e);
            }
        }

        loadSettings();

        // ── Mapa de meses PT abreviados → número ──
        const PT_MONTHS = {
            'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4,
            'mai': 5, 'jun': 6, 'jul': 7, 'ago': 8,
            'set': 9, 'out': 10, 'nov': 11, 'dez': 12
        };

        // ── Calcular população a partir de uma tabela de unidades ──
        // Só soma a PRIMEIRA linha de dados (Quantidade) — ignora a linha de Baixas
        // Ignora também células hidden (unidades que não existem no mundo)
        function calcPopFromTable($table) {
            let pop = 0;
            // A estrutura é: tr.center (ícones) | tr (Quantidade) | tr (Baixas)
            // Queremos apenas o PRIMEIRO tr que tenha td[data-unit-count] visíveis
            let found = false;
            $table.find('tr').each(function () {
                if (found) return false; // já processou a linha de Quantidade, para
                const $tds = $(this).find('td[data-unit-count]');
                if (!$tds.length) return; // linha de cabeçalho ou vazia, continua

                found = true; // esta é a linha de Quantidade
                $tds.each(function () {
                    const $td = $(this);
                    if ($td.hasClass('hidden') || $td.css('display') === 'none') return;
                    const count = parseInt($td.attr('data-unit-count'), 10);
                    if (!count || isNaN(count)) return;
                    const classes = ($td.attr('class') || '').split(/\s+/);
                    let unitKey = null;
                    for (const cls of classes) {
                        if (UNIT_CLASS_MAP[cls]) { unitKey = UNIT_CLASS_MAP[cls]; break; }
                    }
                    if (unitKey) pop += count * (POP_COSTS[unitKey] || 0);
                });
            });
            return pop;
        }

        // ── Extrair timestamp de "Tempo de batalha DD/mês./YYYY (HH:MM:SS)" ──
        function parseBattleDate(text) {
            const re = /(\d{1,2})\/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\/(\d{4})\s*\((\d{2}):(\d{2}):(\d{2})\)/i;
            const m = text.match(re);
            if (!m) return null;
            const mm = PT_MONTHS[(m[2] || '').toLowerCase().replace('.', '')] || 0;
            if (!mm) return null;
            return new Date(
                parseInt(m[3], 10), mm - 1, parseInt(m[1], 10),
                parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6], 10)
            ).getTime();
        }

        // ── Extrair nome do dono da aldeia da página info_village ──
        // Está no bloco de info lateral: "Jogador: <a>NomeJogador</a>"
        function extractVillageOwnerName($doc) {
            // Tenta primeiro o link do jogador na sidebar de info
            let name = null;
            $doc.find('td').each(function () {
                const txt = $(this).text().trim().toLowerCase();
                if (txt === 'jogador:' || txt === 'player:') {
                    const $next = $(this).next('td');
                    name = $next.find('a').first().text().trim();
                    if (!name) name = $next.text().trim();
                    return false;
                }
            });
            return name || null;
        }

        // ── Processar todos os relatórios da página, separando por papel do dono ──
        // Retorna { def: {ts, inside, outside}, atk: {ts, sent} } — sempre o mais recente de cada tipo
        function extractReports($doc, ownerName) {
            const result = {
                def: { ts: null, inside: null, outside: null },
                atk: { ts: null, sent: null }
            };

            if (!ownerName) return result;
            const ownerLower = ownerName.toLowerCase();

            // Cada relatório está dentro de um div.spoiler
            $doc.find('div.spoiler').each(function () {
                const $spoiler = $(this);

                // Extrair data do relatório — procura "Tempo de batalha" no texto do spoiler
                const spoilerText = $spoiler.text();
                const ts = parseBattleDate(spoilerText);
                if (!ts) return;

                // Verificar se o dono é ATACANTE neste relatório
                const $attTable = $spoiler.find('table#attack_info_att, #attack_info_att');
                const $defTable = $spoiler.find('table#attack_info_def, #attack_info_def');

                // Nome do atacante: th "Atacante:" → td > a
                let attName = '';
                $attTable.find('th').each(function () {
                    const txt = $(this).text().trim().toLowerCase();
                    if (txt === 'atacante:' || txt === 'attacker:') {
                        attName = $(this).next('th').find('a').first().text().trim().toLowerCase();
                        return false;
                    }
                });

                // Nome do defensor: th "Defensor:" → td > a
                let defName = '';
                $defTable.find('th').each(function () {
                    const txt = $(this).text().trim().toLowerCase();
                    if (txt === 'defensor:' || txt === 'defender:') {
                        defName = $(this).next('th').find('a').first().text().trim().toLowerCase();
                        return false;
                    }
                });

                // Ele é o DEFENSOR neste relatório → nós atacámos
                if (defName === ownerLower && (result.def.ts === null || ts > result.def.ts)) {
                    result.def.ts = ts;

                    // Tropas em casa: #attack_info_def_units dentro desta spoiler
                    const $defUnits = $spoiler.find('#attack_info_def_units').first();
                    result.def.inside = $defUnits.length ? calcPopFromTable($defUnits) : null;

                    // Tropas fora: #attack_spy_away dentro desta spoiler
                    const $spyAway = $spoiler.find('#attack_spy_away, table.attack_spy_away').first();
                    result.def.outside = $spyAway.length ? calcPopFromTable($spyAway) : null;
                }

                // Ele é o ATACANTE neste relatório → ele atacou-nos
                if (attName === ownerLower && (result.atk.ts === null || ts > result.atk.ts)) {
                    result.atk.ts = ts;

                    // Tropas que ele enviou: #attack_info_att_units dentro desta spoiler
                    const $attUnits = $spoiler.find('#attack_info_att_units').first();
                    result.atk.sent = $attUnits.length ? calcPopFromTable($attUnits) : null;
                }
            });

            return result;
        }

        $('<style>')
            .text(`
                .pp-note-icon {
                    font-size:13px;
                    display:inline-block;
                    cursor:pointer;
                    padding:2px 7px;
                    border-radius:4px;
                    transition:all .2s;
                    color:white;
                    font-weight:bold;
                }
                .pp-note-icon:hover { transform:scale(1.1); }
                .pp-note-icon.not-loaded { background:#c8c8c8; color:#555; }
                .pp-note-icon.loading   { background:#e08b00; color:#fff; animation:pulse 1s infinite; }
                .pp-note-icon.off       { background:#b71c1c; color:#fff; }
                .pp-note-icon.def       { background:#0d47a1; color:#fff; }
                .pp-note-icon.no-data   { background:#37474f; color:#fff; }

                @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }

                .pp-panel {
                    margin:6px 0;
                    border:2px solid #6b4c24;
                    border-radius:6px;
                    overflow:hidden;
                    font-family:sans-serif;
                    box-shadow:0 2px 6px rgba(0,0,0,.25);
                    width:100%;
                    max-width:none;
                    box-sizing:border-box;
                }

                .pp-row-header {
                    display:flex;
                    align-items:center;
                    gap:6px;
                    flex-wrap:nowrap;
                    padding:7px 10px;
                    background:#3d1f00;
                    min-width:0;
                    overflow-x:auto;
                }

                .pp-row-header .pp-label {
                    font-size:12px;
                    font-weight:bold;
                    color:#f5e6c8;
                    letter-spacing:1px;
                    text-transform:uppercase;
                    margin-right:2px;
                    flex:0 0 auto;
                }

                .pp-stat {
                    display:inline-flex;
                    align-items:center;
                    gap:4px;
                    font-size:12px;
                    padding:3px 10px;
                    border-radius:4px;
                    color:white;
                    font-weight:bold;
                    min-width:42px;
                    justify-content:center;
                    flex:0 0 auto;
                }

                .pp-stat.off     { background:#b71c1c; }
                .pp-stat.def     { background:#0d47a1; }
                .pp-stat.nd      { background:#424242; }
                .pp-stat.pending { background:#555; opacity:.8; }

                .pp-btn-scan {
                    font-size:10px;
                    padding:4px 10px;
                    background:#e53935;
                    border:1px solid #b71c1c;
                    border-radius:4px;
                    color:#fff;
                    font-weight:bold;
                    cursor:pointer;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                    transition:background .15s;
                    white-space:nowrap;
                    flex:0 0 auto;
                }
                .pp-btn-scan:hover { background:#ef5350; }

                .pp-btn-copy {
                    font-size:10px;
                    padding:4px 10px;
                    background:#2e7d32;
                    border:1px solid #1b5e20;
                    border-radius:4px;
                    color:#fff;
                    font-weight:bold;
                    cursor:pointer;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                    transition:background .15s;
                    white-space:nowrap;
                    flex:0 0 auto;
                    margin-left:auto;
                }
                .pp-btn-copy:hover { background:#388e3c; }

                .pp-row-filters,
                .pp-row-k,
                .pp-row-buildings {
                    display:flex;
                    align-items:center;
                    gap:5px;
                    flex-wrap:nowrap;
                    padding:6px 10px;
                    border-top:2px solid #6b4c24;
                    overflow-x:auto;
                }

                .pp-row-filters { background:#fff8f0; }
                .pp-row-k { background:#e8f0fe; min-height:32px; }
                .pp-row-buildings { background:#f0f4ff; min-height:32px; }

                .pp-filter-label {
                    font-size:10px;
                    font-weight:bold;
                    color:#8B4513;
                    text-transform:uppercase;
                    letter-spacing:.5px;
                    flex:0 0 auto;
                    min-width:max-content;
                }

                #filter-off.pp-btn {
                    background:#b71c1c;
                    border:1px solid #7f0000;
                    color:#fff;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                }
                #filter-off.pp-btn:hover { background:#c62828; }
                #filter-off.pp-btn.active-filter {
                    box-shadow:0 0 0 2px #ff8a80, inset 0 2px 5px rgba(0,0,0,.45);
                    filter:brightness(.85);
                }

                #filter-def.pp-btn {
                    background:#0d47a1;
                    border:1px solid #002171;
                    color:#fff;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                }
                #filter-def.pp-btn:hover { background:#1565c0; }
                #filter-def.pp-btn.active-filter {
                    box-shadow:0 0 0 2px #82b1ff, inset 0 2px 5px rgba(0,0,0,.45);
                    filter:brightness(.85);
                }

                #filter-nd.pp-btn {
                    background:#424242;
                    border:1px solid #212121;
                    color:#fff;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.15);
                }
                #filter-nd.pp-btn:hover { background:#616161; }
                #filter-nd.pp-btn.active-filter {
                    box-shadow:0 0 0 2px #bdbdbd, inset 0 2px 5px rgba(0,0,0,.45);
                    filter:brightness(.85);
                }

                #filter-attack-mine.pp-btn {
                    background:#7b1fa2;
                    border:1px solid #4a0072;
                    color:#fff;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                }
                #filter-attack-mine.pp-btn:hover { background:#9c27b0; }
                #filter-attack-mine.pp-btn.active-filter {
                    box-shadow:0 0 0 2px #ce93d8, inset 0 2px 5px rgba(0,0,0,.45);
                    filter:brightness(.85);
                }

                #filter-attack-ally.pp-btn {
                    background:#1565c0;
                    border:1px solid #003c8f;
                    color:#fff;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                }
                #filter-attack-ally.pp-btn:hover { background:#1976d2; }
                #filter-attack-ally.pp-btn.active-filter {
                    box-shadow:0 0 0 2px #90caf9, inset 0 2px 5px rgba(0,0,0,.45);
                    filter:brightness(.85);
                }

                #filter-attack-none.pp-btn {
                    background:#2e7d32;
                    border:1px solid #1b5e20;
                    color:#fff;
                    box-shadow:inset 0 1px 0 rgba(255,255,255,.2);
                }
                #filter-attack-none.pp-btn:hover { background:#388e3c; }
                #filter-attack-none.pp-btn.active-filter {
                    box-shadow:0 0 0 2px #a5d6a7, inset 0 2px 5px rgba(0,0,0,.45);
                    filter:brightness(.85);
                }

                .pp-btn {
                    font-size:10px;
                    padding:4px 9px;
                    border-radius:4px;
                    font-weight:bold;
                    cursor:pointer;
                    transition:box-shadow .15s, filter .15s, background .15s;
                    user-select:none;
                    flex:0 0 auto;
                    white-space:nowrap;
                }

                .pp-btn-reset {
                    font-size:10px;
                    padding:4px 9px;
                    margin-left:auto;
                    background:#fff;
                    border:2px solid #c0392b;
                    border-radius:4px;
                    color:#c0392b;
                    font-weight:bold;
                    cursor:pointer;
                    transition:background .15s, color .15s;
                    flex:0 0 auto;
                    white-space:nowrap;
                }
                .pp-btn-reset:hover { background:#c0392b; color:#fff; }

                .k-tag {
                    font-size:10px;
                    padding:3px 10px;
                    border-radius:12px;
                    cursor:pointer;
                    font-weight:bold;
                    background:#fff;
                    border:1px solid #3949ab;
                    color:#3949ab;
                    transition:background .15s, color .15s, box-shadow .15s;
                    user-select:none;
                    flex:0 0 auto;
                    white-space:nowrap;
                }
                .k-tag:hover { background:#e8eaf6; }
                .k-tag.active-filter {
                    background:#3949ab;
                    color:#fff;
                    border-color:#1a237e;
                    box-shadow:0 0 0 2px #9fa8da;
                }

                .pp-building-lvl-label {
                    display:inline-block;
                    margin-left:3px;
                    font-size:10px;
                    background:rgba(0,0,0,.18);
                    border-radius:3px;
                    padding:0 4px;
                    min-width:14px;
                    text-align:center;
                }
                .pp-building-lvl-label:empty { display:none; }

                .pp-building-input {
                    width:62px;
                    padding:2px 4px;
                    font-size:11px;
                    font-weight:bold;
                    border:1px solid #3949ab;
                    border-radius:4px;
                    text-align:center;
                    color:#1a237e;
                    background:#fff;
                    flex:0 0 auto;
                }
                .pp-building-input:focus { outline:2px solid #7986cb; }

                .pp-btn-clear-buildings {
                    font-size:11px;
                    padding:3px 8px;
                    background:#fff;
                    border:1px solid #c0392b;
                    border-radius:4px;
                    color:#c0392b;
                    font-weight:bold;
                    cursor:pointer;
                    transition:background .15s, color .15s;
                    flex:0 0 auto;
                    white-space:nowrap;
                }
                .pp-btn-clear-buildings:hover { background:#c0392b; color:#fff; }

                .pp-building-status {
                    font-size:10px;
                    font-style:italic;
                    color:#5c6bc0;
                    margin-left:4px;
                    flex:0 0 auto;
                    white-space:nowrap;
                }

                .pp-progress-wrap {
                    padding:5px 10px;
                    background:#fdf3e0;
                    border-top:1px solid #c9a97a;
                    display:none;
                }
                .pp-progress-wrap.active { display:block; }
                .pp-progress-bar-text {
                    font-size:11px;
                    color:#5a3e1b;
                    margin-bottom:4px;
                    text-align:center;
                }
                .pp-progress-track {
                    height:6px;
                    background:#d6b47a;
                    border-radius:3px;
                    overflow:hidden;
                }
                .pp-progress-fill {
                    height:100%;
                    width:0%;
                    background:#8B4513;
                    border-radius:3px;
                    transition:width .3s;
                }
                .pp-scan-done {
                    display:none;
                    margin-top:5px;
                    padding:5px 10px;
                    border-radius:4px;
                    background:#d4edda;
                    border:1px solid #4a7c59;
                    color:#1b3a27;
                    font-size:11px;
                    font-weight:bold;
                    text-align:center;
                }
                .pp-scan-done.visible { display:block; }

                .pp-building-cell {
                    text-align:center;
                    font-size:11px;
                    font-weight:bold;
                    padding:2px 6px;
                    border-radius:3px;
                    cursor:pointer;
                    min-width:28px;
                    display:inline-block;
                    user-select:none;
                    transition:filter .15s;
                }
                .pp-building-cell:hover { filter:brightness(1.15); }
                .pp-building-cell.wall-high  { background:#4e2a04; color:#f5e6c8; }
                .pp-building-cell.wall-mid   { background:#8B4513; color:#f5e6c8; }
                .pp-building-cell.wall-low   { background:#c8935a; color:#fff; }
                .pp-building-cell.wall-zero  { background:#e8d5b8; color:#7a5c3a; }
                .pp-building-cell.wall-none  { background:transparent; color:#bbb; font-weight:normal; }
                .pp-building-cell.tower-yes  { background:#33691e; color:#f1f8e9; }
                .pp-building-cell.tower-zero { background:#e8ead8; color:#7a8060; }
                .pp-building-cell.tower-none { background:transparent; color:#bbb; font-weight:normal; }

                .pp-level-picker {
                    position:fixed;
                    z-index:10002;
                    background:#fff;
                    border:2px solid #6b4c24;
                    border-radius:6px;
                    padding:10px;
                    box-shadow:0 4px 16px rgba(0,0,0,.35);
                    display:flex;
                    flex-direction:column;
                    gap:0;
                    min-width:230px;
                }
                .pp-op-wrap { display:flex; flex-direction:column; gap:3px; margin-bottom:2px; }
                .pp-op-btn {
                    font-size:11px;
                    padding:4px 8px;
                    border-radius:4px;
                    cursor:pointer;
                    font-weight:bold;
                    text-align:left;
                    background:#f5f5f5;
                    border:1px solid #ccc;
                    color:#444;
                    transition:background .1s;
                }
                .pp-op-btn:hover { background:#e8eaf6; border-color:#9fa8da; color:#1a237e; }
                .pp-op-btn.active { background:#3949ab; color:#fff; border-color:#1a237e; }

                .pp-lvl-grid { display:flex; flex-wrap:wrap; gap:3px; }
                .pp-level-picker .pp-lvl-btn {
                    font-size:11px;
                    padding:3px 7px;
                    border-radius:3px;
                    cursor:pointer;
                    font-weight:bold;
                    background:#e8eaf6;
                    border:1px solid #9fa8da;
                    color:#1a237e;
                    transition:background .1s;
                }
                .pp-level-picker .pp-lvl-btn:hover { background:#3949ab; color:#fff; }
                .pp-level-picker .pp-lvl-btn.active { background:#3949ab; color:#fff; border-color:#1a237e; }

                .pp-level-picker .pp-lvl-clear {
                    width:100%;
                    font-size:10px;
                    padding:3px;
                    border-radius:3px;
                    cursor:pointer;
                    background:#fff;
                    border:1px solid #c0392b;
                    color:#c0392b;
                    font-weight:bold;
                    text-align:center;
                    margin-top:6px;
                }
                .pp-level-picker .pp-lvl-clear:hover { background:#c0392b; color:#fff; }

                .pp-load-warning {
                    background:#f1aeb5;
                    border:1px solid #f5c2c7;
                    border-radius:5px;
                    padding:8px 12px;
                    margin-bottom:6px;
                    color:#842029;
                    font-size:12px;
                    cursor:pointer;
                    display:flex;
                    align-items:center;
                    gap:8px;
                }
                .pp-load-warning:hover { background:#ea868f; }
                .pp-load-warning-icon { font-size:16px; }
                .pp-load-warning-text { flex:1; }
                .pp-load-warning-button {
                    padding:3px 8px;
                    background:#dc3545;
                    border:1px solid #b02a37;
                    border-radius:3px;
                    color:#fff;
                    font-weight:bold;
                    font-size:11px;
                    white-space:nowrap;
                }

                /* ── Filtro de coordenadas X / Y ── */
                .pp-row-coords {
                    display:flex;
                    align-items:center;
                    gap:5px;
                    flex-wrap:nowrap;
                    padding:6px 10px;
                    border-top:2px solid #6b4c24;
                    overflow-x:auto;
                    background:#e8f5e9;
                    min-height:32px;
                }
                .pp-coord-group {
                    display:inline-flex;
                    align-items:center;
                    gap:3px;
                    flex:0 0 auto;
                }
                .pp-coord-label {
                    font-size:11px;
                    font-weight:bold;
                    padding:3px 7px;
                    border-radius:4px;
                    color:#fff;
                }
                .pp-coord-label.x-label { background:#00695c; }
                .pp-coord-label.y-label { background:#1565c0; }
                .pp-coord-op {
                    font-size:11px;
                    padding:2px 4px;
                    border:1px solid #3949ab;
                    border-radius:4px;
                    background:#fff;
                    color:#1a237e;
                    font-weight:bold;
                    cursor:pointer;
                    flex:0 0 auto;
                }
                .pp-coord-input {
                    width:52px;
                    padding:2px 4px;
                    font-size:11px;
                    font-weight:bold;
                    border:1px solid #3949ab;
                    border-radius:4px;
                    text-align:center;
                    color:#1a237e;
                    background:#fff;
                    flex:0 0 auto;
                }
                .pp-coord-input:focus { outline:2px solid #7986cb; }
                .pp-coord-status {
                    font-size:10px;
                    font-style:italic;
                    color:#2e7d32;
                    margin-left:4px;
                    flex:0 0 auto;
                    white-space:nowrap;
                }
                .pp-coord-sep {
                    font-size:12px;
                    color:#8B4513;
                    font-weight:bold;
                    flex:0 0 auto;
                    padding:0 4px;
                }

                /* ── Filtro de população ── */
                .pp-row-pop {
                    display:flex;
                    align-items:center;
                    gap:5px;
                    flex-wrap:nowrap;
                    padding:6px 10px;
                    border-top:2px solid #6b4c24;
                    overflow-x:auto;
                    background:#fff3e0;
                    min-height:32px;
                }

                /* ── Filtro de data da nota ── */
                .pp-row-notedate {
                    display:flex;
                    align-items:center;
                    gap:5px;
                    flex-wrap:nowrap;
                    padding:6px 10px;
                    border-top:2px solid #6b4c24;
                    overflow-x:auto;
                    background:#fce4ec;
                    min-height:32px;
                }

                .note-popup {
                    position:fixed;
                    background:#fff;
                    border:2px solid #8B4513;
                    border-radius:8px;
                    padding:0;
                    width:450px;
                    max-height:70vh;
                    overflow:hidden;
                    z-index:10000;
                    box-shadow:0 4px 20px rgba(0,0,0,.5);
                    display:flex;
                    flex-direction:column;
                }
                .note-popup-header {
                    font-size:15px;
                    font-weight:bold;
                    padding:10px 14px;
                    background:#8B4513;
                    color:#fff;
                    cursor:move;
                    user-select:none;
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                }
                .note-popup-close { cursor:pointer; font-size:20px; line-height:1; padding:0 4px; }
                .note-popup-close:hover { color:#ff6b6b; }
                .note-popup-content { padding:14px; overflow-y:auto; flex:1; }

                /* ── Ocultar barra nativa de filtros do TW abaixo da tabela ── */
                #paged_view_filter,
                #pl_filter,
                .paged-view-filter,
                #villages_list_filters { display:none !important; }
            `)
            .appendTo('head');

        window.pp_rows = window.pp_rows || [];

        function extractCoordsFromRow($row) {
            let coords = null;
            $row.find('td').each(function () {
                const text = $(this).text().trim();
                const match = text.match(/^(\d+)\|(\d+)$/) || text.match(/(\d+)\|(\d+)/);
                if (match) {
                    coords = `${match[1]}|${match[2]}`;
                    return false;
                }
            });
            return coords;
        }

        function extractPointsFromRow($row) {
            let points = null;
            $row.find('td').each(function () {
                const txt = $(this).text().trim();
                if (/^\d+\|\d+$/.test(txt)) {
                    const $next = $(this).next('td');
                    if ($next.length) {
                        const raw = $next.text().trim().replace(/\./g, '').replace(/\s/g, '').replace(/[^\d]/g, '');
                        const val = parseInt(raw, 10);
                        if (!isNaN(val)) points = val;
                    }
                    return false;
                }
            });
            return points;
        }

        function getContinentFromCoords(coords) {
            const m = coords && coords.match(/^(\d+)\|(\d+)$/);
            if (!m) return null;
            return `K${m[2][0]}${m[1][0]}`;
        }

        function getXYFromCoords(coords) {
            const m = coords && coords.match(/^(\d+)\|(\d+)$/);
            if (!m) return null;
            return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
        }

        function getTotalVillagesCount() {
            // Tenta vários seletores pois o colspan e estrutura variam
            let text = '';
            // Opção 1: th com colspan na thead
            $('#villages_list > thead th').each(function () {
                const t = $(this).text();
                if (t.match(/\(\d+\)/)) { text = t; return false; }
            });
            // Opção 2: caption ou título da tabela
            if (!text) text = $('#villages_list caption').text();
            // Opção 3: elemento antes da tabela com contagem
            if (!text) text = $('#villages_list').prev('h2, h3, p').first().text();

            const match = text.match(/\((\d+)\)/);
            if (match) return parseInt(match[1], 10);

            // Fallback: contar rows que têm ícone pp (analisadas + por analisar)
            return window.pp_rows.length || 0;
        }

        function updateStats() {
            const offCount  = window.pp_rows.filter(r => window.pp_settings.noteStates[r.id] === 'off').length;
            const defCount  = window.pp_rows.filter(r => window.pp_settings.noteStates[r.id] === 'def').length;
            const ndCount   = window.pp_rows.filter(r => window.pp_settings.noteStates[r.id] === 'no-data').length;
            const totalCount = getTotalVillagesCount() || window.pp_rows.length;
            const analyzedCount = offCount + defCount + ndCount;
            const pendingCount  = Math.max(0, totalCount - analyzedCount);

            $('#stat-off').text(offCount);
            $('#stat-def').text(defCount);
            $('#stat-nd').text(ndCount);
            $('#stat-pending').text(pendingCount);
        }

        function getBuildingCellHtml(villageId, type) {
            const levels = type === 'wall'
                ? (window.pp_settings.wallLevels || {})
                : (window.pp_settings.towerLevels || {});
            const lvl = levels[villageId];
            const base = ' data-vid="' + villageId + '" data-type="' + type + '"';

            if (lvl === undefined) {
                return '<span class="pp-building-cell ' + type + '-none" title="Sem informação — faça scan"' + base + '>–</span>';
            }

            let cls = '';
            if (type === 'wall') {
                if (lvl >= 15) cls = 'wall-high';
                else if (lvl >= 5) cls = 'wall-mid';
                else if (lvl > 0) cls = 'wall-low';
                else cls = 'wall-zero';
            } else {
                cls = lvl > 0 ? 'tower-yes' : 'tower-zero';
            }

            const icon = type === 'wall' ? '🏰' : '🗼';
            return '<span class="pp-building-cell ' + cls + '" title="Clique para filtrar"' + base + '>' + icon + lvl + '</span>';
        }

        // ── Formatar data da nota para exibição ──
        function formatNoteDate(ts) {
            if (!ts) return '–';
            const d = new Date(ts);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
        }

        // ── Dias desde a última nota ──
        function daysSinceNote(ts) {
            if (!ts) return null;
            return Math.floor((Date.now() - ts) / 86400000);
        }

        function initializeNoteIcons() {
            const $thead = $('#villages_list > thead > tr');
            if ($thead.find('th.pp-th-notes').length === 0) {
                $thead.each(function () {
                    $(this).append('<th class="pp-th-wall"    style="text-align:center;font-size:11px;">🏰<br>Muralha</th>');
                    $(this).append('<th class="pp-th-tower"   style="text-align:center;font-size:11px;">🗼<br>Torre</th>');
                    $(this).append('<th class="pp-th-popdef"  style="text-align:center;font-size:11px;color:#1b5e20;">👥<br>Pop defesa</th>');
                    $(this).append('<th class="pp-th-datedef" style="text-align:center;font-size:11px;color:#1b5e20;">📅<br>Última defesa</th>');
                    $(this).append('<th class="pp-th-popatk"  style="text-align:center;font-size:11px;color:#6a1b9a;">⚔️<br>Pop ataque</th>');
                    $(this).append('<th class="pp-th-dateatk" style="text-align:center;font-size:11px;color:#6a1b9a;">📅<br>Último ataque</th>');
                    $(this).append('<th class="pp-th-notes"   style="text-align:center;">' + getTranslation('notes') + '</th>');
                });
            }

            $('#villages_list > tbody > tr').each(function () {
                const $row = $(this);

                if ($row.find('.pp-note-icon').length > 0) {
                    const vid = $row.find('.pp-note-icon').data('village-id') + '';
                    $row.find('.pp-building-cell[data-type="wall"]').replaceWith(getBuildingCellHtml(vid, 'wall'));
                    $row.find('.pp-building-cell[data-type="tower"]').replaceWith(getBuildingCellHtml(vid, 'tower'));
                    const s = window.pp_settings;
                    $row.find('.pp-popdef-cell').html(buildPopCellHtml((s.popDefInside||{})[vid], (s.popDefOutside||{})[vid]));
                    $row.find('.pp-datedef-cell').text(formatNoteDate((s.lastNoteDef||{})[vid]));
                    $row.find('.pp-popatk-cell').html(buildPopAtkHtml((s.popAtkSent||{})[vid]));
                    $row.find('.pp-dateatk-cell').text(formatNoteDate((s.lastNoteAtk||{})[vid]));
                    return;
                }

                const $link = $row.find('td:first a');
                let villageId = null;
                if ($link.length > 0) {
                    const href = $link.attr('href') || '';
                    const match = href.match(/id=(\d+)/);
                    if (match) villageId = match[1];
                }

                const savedState = window.pp_settings.noteStates[villageId] || 'not-loaded';
                const s = window.pp_settings;

                const $wallTd    = $('<td style="text-align:center;"></td>').html(getBuildingCellHtml(villageId, 'wall'));
                const $towerTd   = $('<td style="text-align:center;"></td>').html(getBuildingCellHtml(villageId, 'tower'));
                const $popDefTd  = $('<td style="text-align:center;font-size:10px;color:#1b5e20;" class="pp-popdef-cell"></td>').html(buildPopCellHtml((s.popDefInside||{})[villageId], (s.popDefOutside||{})[villageId]));
                const $dateDefTd = $('<td style="text-align:center;font-size:10px;white-space:nowrap;color:#1b5e20;" class="pp-datedef-cell"></td>').text(formatNoteDate((s.lastNoteDef||{})[villageId]));
                const $popAtkTd  = $('<td style="text-align:center;font-size:10px;color:#6a1b9a;" class="pp-popatk-cell"></td>').html(buildPopAtkHtml((s.popAtkSent||{})[villageId]));
                const $dateAtkTd = $('<td style="text-align:center;font-size:10px;white-space:nowrap;color:#6a1b9a;" class="pp-dateatk-cell"></td>').text(formatNoteDate((s.lastNoteAtk||{})[villageId]));
                const $icon      = $('<span class="pp-note-icon ' + savedState + '" data-village-id="' + villageId + '">' + getLabel(savedState) + '</span>');
                const $newTd     = $('<td style="text-align:center;cursor:pointer;"></td>').append($icon);

                $row.append($wallTd).append($towerTd)
                    .append($popDefTd).append($dateDefTd)
                    .append($popAtkTd).append($dateAtkTd)
                    .append($newTd);

                if (villageId) window.pp_settings.noteStates[villageId] = savedState;
                window.pp_rows.push({ row: $row, id: villageId, icon: $icon });
            });

            updateStats();
        }

        // ── Formatar população em notação k ──
        function formatPop(val) {
            if (val === null || val === undefined) return '–';
            if (val >= 1000) {
                const k = val / 1000;
                // Mostrar 1 casa decimal apenas se não for número inteiro
                return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
            }
            return String(val);
        }

        // ── HTML da célula de população ──
        function buildPopCellHtml(inside, outside) {
            if (inside === undefined && outside === undefined) return '<span style="color:#bbb;">–</span>';
            const parts = [];
            if (inside !== null && inside !== undefined)   parts.push('<span title="Em casa (' + inside + ')" style="color:#1b5e20;">🏠' + formatPop(inside) + '</span>');
            if (outside !== null && outside !== undefined) parts.push('<span title="Fora (' + outside + ')" style="color:#b71c1c;">✈️' + formatPop(outside) + '</span>');
            return parts.length ? parts.join(' ') : '<span style="color:#bbb;">–</span>';
        }

        // ── HTML da célula de pop quando ELE atacou (só enviadas) ──
        function buildPopAtkHtml(sent) {
            if (sent === undefined || sent === null) return '<span style="color:#bbb;">–</span>';
            return '<span title="Tropas enviadas (' + sent + ')" style="color:#6a1b9a;font-weight:bold;">⚔️' + formatPop(sent) + '</span>';
        }

        window.pp_activeFilter = window.pp_activeFilter || {
            types: new Set(),
            kList: [],
            wallFilter: null,
            towerFilter: null,
            pointsFilter: null,
            attackFilter: null,
            coordXFilter: null,
            coordYFilter: null,
            noteDateFilter: null,  // { maxDays: number } — notas mais antigas que X dias
            popFilter: null        // { field: 'inside'|'outside'|'total', op: '>='|'<=', val: number }
        };

        function getAttackState($row) {
            const mine = $row.find('span.command-attack').not('.command-attack-ally').length > 0;
            const ally = $row.find('span.command-attack-ally').length > 0;
            return { mine, ally };
        }

        function applyFilters(types, kList, wallFilter, towerFilter, pointsFilter, attackFilter, coordXFilter, coordYFilter, noteDateFilter, popFilter) {
            if (types === 'reset') {
                window.pp_activeFilter.types = new Set();
                window.pp_activeFilter.kList = [];
                window.pp_activeFilter.wallFilter = null;
                window.pp_activeFilter.towerFilter = null;
                window.pp_activeFilter.pointsFilter = null;
                window.pp_activeFilter.attackFilter = null;
                window.pp_activeFilter.coordXFilter = null;
                window.pp_activeFilter.coordYFilter = null;
                window.pp_activeFilter.noteDateFilter = null;
                window.pp_activeFilter.popFilter = null;
            } else {
                if (types !== undefined)          window.pp_activeFilter.types = types;
                if (kList !== undefined)           window.pp_activeFilter.kList = kList;
                if (wallFilter !== undefined)      window.pp_activeFilter.wallFilter = wallFilter;
                if (towerFilter !== undefined)     window.pp_activeFilter.towerFilter = towerFilter;
                if (pointsFilter !== undefined)    window.pp_activeFilter.pointsFilter = pointsFilter;
                if (attackFilter !== undefined)    window.pp_activeFilter.attackFilter = attackFilter;
                if (coordXFilter !== undefined)    window.pp_activeFilter.coordXFilter = coordXFilter;
                if (coordYFilter !== undefined)    window.pp_activeFilter.coordYFilter = coordYFilter;
                if (noteDateFilter !== undefined)  window.pp_activeFilter.noteDateFilter = noteDateFilter;
                if (popFilter !== undefined)       window.pp_activeFilter.popFilter = popFilter;
            }

            const activeTypes    = window.pp_activeFilter.types;
            const activeK        = window.pp_activeFilter.kList;
            const activeWall     = window.pp_activeFilter.wallFilter;
            const activeTower    = window.pp_activeFilter.towerFilter;
            const activePoints   = window.pp_activeFilter.pointsFilter;
            const activeAttack   = window.pp_activeFilter.attackFilter;
            const activeX        = window.pp_activeFilter.coordXFilter;
            const activeY        = window.pp_activeFilter.coordYFilter;
            const activeDate     = window.pp_activeFilter.noteDateFilter;
            const activePop      = window.pp_activeFilter.popFilter;

            const kSet = activeK.length > 0 ? new Set(activeK) : null;
            const noTypeFilter = activeTypes.size === 0;

            window.pp_rows.forEach(r => {
                const state = window.pp_settings.noteStates[r.id];

                const typeMatch = noTypeFilter ||
                    (activeTypes.has('no-data') && state !== 'off' && state !== 'def') ||
                    activeTypes.has(state);

                const rowCoords = extractCoordsFromRow(r.row);
                const rowK = rowCoords ? getContinentFromCoords(rowCoords) : null;
                const kMatch = !kSet || (rowK && kSet.has(rowK));

                const wallLvl   = (window.pp_settings.wallLevels || {})[r.id];
                const towerLvl  = (window.pp_settings.towerLevels || {})[r.id];
                const rowPoints = extractPointsFromRow(r.row);

                function buildingMatch(lvl, filter) {
                    if (!filter) return true;
                    if (lvl === undefined) return false;
                    if (filter.op === '>=') return lvl >= filter.val;
                    if (filter.op === '<=') return lvl <= filter.val;
                    if (filter.op === '=')  return lvl === filter.val;
                    return true;
                }

                function pointsMatch(points, filter) {
                    if (!filter) return true;
                    if (points === null || points === undefined || isNaN(points)) return false;
                    if (filter.mode === 'max')     return points <= filter.value;
                    if (filter.mode === 'min')     return points >= filter.value;
                    if (filter.mode === 'between') return points >= filter.min && points <= filter.max;
                    return true;
                }

                function coordMatch(xy, filter) {
                    if (!filter) return true;
                    if (!xy) return false;
                    const val = filter.axis === 'x' ? xy.x : xy.y;
                    if (filter.op === '>=') return val >= filter.val;
                    if (filter.op === '<=') return val <= filter.val;
                    return true;
                }

                // ── Filtro de data da nota ──
                function noteDateMatch(id, filter) {
                    if (!filter) return true;
                    const s = window.pp_settings;
                    const tsDef = (s.lastNoteDef || {})[id] || null;
                    const tsAtk = (s.lastNoteAtk || {})[id] || null;

                    let ts = null;
                    if (filter.role === 'def')      ts = tsDef;
                    else if (filter.role === 'atk') ts = tsAtk;
                    else /* any */                  ts = Math.max(tsDef || 0, tsAtk || 0) || null;

                    if (!ts) return false;
                    const days = daysSinceNote(ts);
                    if (filter.mode === 'older') return days >= filter.days;
                    if (filter.mode === 'newer') return days <= filter.days;
                    return true;
                }

                // ── Filtro de população ──
                function popMatch(id, filter) {
                    if (!filter) return true;
                    const s = window.pp_settings;
                    const defIn  = (s.popDefInside  || {})[id];
                    const defOut = (s.popDefOutside || {})[id];
                    const atkSnt = (s.popAtkSent    || {})[id];

                    let val = null;
                    if (filter.field === 'defInside')  val = defIn;
                    else if (filter.field === 'defOutside') val = defOut;
                    else if (filter.field === 'defTotal') {
                        if (defIn != null && defOut != null) val = defIn + defOut;
                        else if (defIn != null) val = defIn;
                        else if (defOut != null) val = defOut;
                    }
                    else if (filter.field === 'atkSent') val = atkSnt;

                    if (val === null || val === undefined) return false;
                    if (filter.op === '>=') return val >= filter.val;
                    if (filter.op === '<=') return val <= filter.val;
                    return true;
                }

                const xy     = rowCoords ? getXYFromCoords(rowCoords) : null;
                const xMatch = coordMatch(xy, activeX ? { ...activeX, axis: 'x' } : null);
                const yMatch = coordMatch(xy, activeY ? { ...activeY, axis: 'y' } : null);

                const wallMatch   = buildingMatch(wallLvl, activeWall);
                const towerMatch  = buildingMatch(towerLvl, activeTower);
                const pointsOk    = pointsMatch(rowPoints, activePoints);
                const dateOk      = noteDateMatch(r.id, activeDate);
                const popOk       = popMatch(r.id, activePop);

                let attackOk = true;
                if (activeAttack) {
                    const atk = getAttackState(r.row);
                    if (activeAttack === 'mine') attackOk = atk.mine;
                    else if (activeAttack === 'ally') attackOk = atk.ally;
                    else if (activeAttack === 'none') attackOk = !atk.mine && !atk.ally;
                }

                const show = typeMatch && kMatch && wallMatch && towerMatch && pointsOk && attackOk && xMatch && yMatch && dateOk && popOk;

                if (show) r.row.show();
                else r.row.hide();
            });
        }

        function toggleType(type) {
            const types = new Set(window.pp_activeFilter.types);
            if (types.has(type)) types.delete(type);
            else types.add(type);
            applyFilters(types, undefined, undefined, undefined, undefined);
        }

        function checkAllVillagesLoaded() {
            const totalCount = getTotalVillagesCount();
            const displayedCount = $('#villages_list > tbody > tr').length;

            const lastRow = $('#villages_list > tbody > tr:last');
            const hasLoadAllLink = lastRow.find('a').filter(function () {
                const txt = ($(this).text() || '').toLowerCase();
                const oc = $(this).attr('onclick') || '';
                return txt.includes('todas') || txt.includes('all') || oc.includes('getAllVillages');
            }).length > 0;

            return !hasLoadAllLink && displayedCount >= totalCount;
        }

        function clickLoadAllVillages() {
            const lastRow = $('#villages_list > tbody > tr:last');
            const loadAllLink = lastRow.find('a').filter(function () {
                const txt = ($(this).text() || '').toLowerCase();
                const oc = $(this).attr('onclick') || '';
                return txt.includes('todas') || txt.includes('all') || oc.includes('getAllVillages');
            });

            if (loadAllLink.length > 0) {
                loadAllLink[0].click();
                return true;
            }

            if (typeof UI !== 'undefined' && UI.ErrorMessage) {
                UI.ErrorMessage('Não encontrei o botão para carregar todas as aldeias.');
            }
            return false;
        }

        function updateLoadWarning() {
            if (checkAllVillagesLoaded()) {
                $('#pp-load-warning').hide();
                return;
            }

            const totalCount = getTotalVillagesCount();
            const displayedCount = Math.max(0, $('#villages_list > tbody > tr').length - 1);

            if ($('#pp-load-warning').length === 0) {
                const warning = $(`
                    <div id="pp-load-warning" class="pp-load-warning">
                        <span class="pp-load-warning-icon">⚠️</span>
                        <span class="pp-load-warning-text">
                            <strong>${getTranslation('warningTitle')}</strong> ${getTranslation('warningMessage', displayedCount, totalCount)}
                        </span>
                        <span class="pp-load-warning-button">${getTranslation('loadAll')}</span>
                    </div>
                `);

                warning.on('click', function () {
                    clickLoadAllVillages();
                });

                $('#villages_list').before(warning);
            } else {
                $('#pp-load-warning').show();
                $('#pp-load-warning .pp-load-warning-text').html(
                    `<strong>${getTranslation('warningTitle')}</strong> ${getTranslation('warningMessage', displayedCount, totalCount)}`
                );
            }
        }

        const toolbar = $(`
            <div class="pp-panel">
                <div class="pp-row-header">
                    <span class="pp-label">Contadores</span>
                    <span class="pp-stat off" title="${getTranslation('offensiveCount')}">⚔️ <b id="stat-off">0</b></span>
                    <span class="pp-stat def" title="${getTranslation('defensiveCount')}">🛡️ <b id="stat-def">0</b></span>
                    <span class="pp-stat nd" title="${getTranslation('unknownCount')}">❓ <b id="stat-nd">0</b></span>
                    <span class="pp-stat pending" title="${getTranslation('pendingCount')}">⏳ <b id="stat-pending">0</b></span>
                    <button id="copy-visible" class="pp-btn-copy">${getTranslation('copyCoords')}</button>
                    <button id="scan-all" class="pp-btn-scan" title="${getTranslation('scanAllTooltip')}">${getTranslation('scanAll')}</button>
                </div>

                <div class="pp-row-filters">
                    <span class="pp-filter-label">Filtros:</span>
                    <button id="filter-off" class="pp-btn" title="${getTranslation('filterOffTooltip')}">⚔️ OFF</button>
                    <button id="filter-def" class="pp-btn" title="${getTranslation('filterDefTooltip')}">🛡️ DEF</button>
                    <button id="filter-nd" class="pp-btn" title="${getTranslation('filterUnknownTooltip')}">❓ Sem info</button>
                    <button id="filter-has-tower" class="pp-btn" title="Mostrar só aldeias com Torre">🗼 Torre</button>
                    <button id="reset-all-filters" class="pp-btn-reset" title="${getTranslation('showAllTooltip')}">✕ Limpar filtros</button>
                </div>

                <div class="pp-row-filters" style="background:#f3e5f5;">
                    <span class="pp-filter-label">Ataques:</span>
                    <button id="filter-attack-mine" class="pp-btn" title="Mostrar só aldeias que estou a atacar">⚔️ Atacado por mim</button>
                    <button id="filter-attack-ally" class="pp-btn" title="Mostrar só aldeias que o aliado está a atacar">🗡️ Atacado por aliado</button>
                    <button id="filter-attack-none" class="pp-btn" title="Mostrar só aldeias sem ataque">✅ Sem ataque</button>
                </div>

                <div class="pp-row-k">
                    <span class="pp-filter-label">K:</span>
                    <span class="k-tags-wrap" id="k-tags-wrap"></span>
                </div>

                <div class="pp-row-buildings">
                    <span class="pp-filter-label">Filtrar por nível:</span>
                    <button id="filter-wall-btn" class="pp-btn pp-building-toolbar-btn" title="Escolher nível de muralha">🏰 Muralha <span id="filter-wall-label" class="pp-building-lvl-label"></span></button>
                    <button id="filter-tower-btn" class="pp-btn pp-building-toolbar-btn" title="Escolher nível de torre">🗼 Torre <span id="filter-tower-label" class="pp-building-lvl-label"></span></button>
                    <span id="building-filter-status" class="pp-building-status"></span>
                </div>

                <div class="pp-row-buildings">
                    <span class="pp-filter-label">Pontos da aldeia:</span>
                    <select id="points-mode" class="pp-building-input" style="width:82px;">
                        <option value="max">Até</option>
                        <option value="between">Entre</option>
                        <option value="min">Mais de</option>
                    </select>
                    <input type="number" id="points-value-1" class="pp-building-input" placeholder="Valor">
                    <input type="number" id="points-value-2" class="pp-building-input" placeholder="Máx" style="display:none;">
                    <button id="clear-points-filter" class="pp-btn-clear-buildings">Limpar</button>
                    <span id="points-filter-status" class="pp-building-status"></span>
                </div>

                <!-- Filtro de coordenadas X e Y -->
                <div class="pp-row-coords">
                    <span class="pp-filter-label">Coords:</span>
                    <div class="pp-coord-group">
                        <span class="pp-coord-label x-label">X</span>
                        <select id="coord-x-op" class="pp-coord-op" title="Operador de comparação para X">
                            <option value=">=" title="Maior ou igual a este valor">≥</option>
                            <option value="<=" title="Menor ou igual a este valor">≤</option>
                        </select>
                        <input type="number" id="coord-x-val" class="pp-coord-input" placeholder="ex: 500" min="0" max="999" title="Coordenada X da aldeia (0–999)">
                    </div>
                    <span class="pp-coord-sep">|</span>
                    <div class="pp-coord-group">
                        <span class="pp-coord-label y-label">Y</span>
                        <select id="coord-y-op" class="pp-coord-op" title="Operador de comparação para Y">
                            <option value=">=" title="Maior ou igual a este valor">≥</option>
                            <option value="<=" title="Menor ou igual a este valor">≤</option>
                        </select>
                        <input type="number" id="coord-y-val" class="pp-coord-input" placeholder="ex: 500" min="0" max="999" title="Coordenada Y da aldeia (0–999)">
                    </div>
                    <button id="clear-coords-filter" class="pp-btn-clear-buildings" title="Remover filtro de coordenadas">Limpar</button>
                    <span id="coords-filter-status" class="pp-coord-status"></span>
                </div>

                <!-- Filtro de data da última nota -->
                <div class="pp-row-notedate">
                    <span class="pp-filter-label">📅 Nota:</span>
                    <select id="notedate-role" class="pp-coord-op" style="width:90px;" title="Papel do dono da aldeia no relatório">
                        <option value="def" title="Última vez que eu ou aliado atacou esta aldeia">Atacado</option>
                        <option value="atk" title="Última vez que ele nos atacou">Atacou</option>
                        <option value="any" title="Qualquer relatório, seja como def ou atk">Qualquer</option>
                    </select>
                    <select id="notedate-mode" class="pp-coord-op" style="width:60px;" title="MAX = relatório tem no máximo X dias (mais recente). MIN = relatório tem pelo menos X dias (mais antigo).">
                        <option value="newer" title="Mostra só aldeias cujo relatório tem NO MÁXIMO X dias. Ex: MAX 7 → só aparecem aldeias com relatório dos últimos 7 dias.">MAX</option>
                        <option value="older" title="Mostra só aldeias cujo relatório tem NO MÍNIMO X dias. Ex: MIN 7 → só aparecem aldeias com relatório com 7 ou mais dias.">MIN</option>
                    </select>
                    <input type="number" id="notedate-days" class="pp-coord-input" placeholder="dias" min="0" style="width:52px;" title="Número de dias. Ex: 7 → filtra relatórios com máximo ou mínimo de 7 dias.">
                    <span style="font-size:11px;color:#880e4f;font-weight:bold;flex:0 0 auto;">dias</span>
                    <button id="clear-notedate-filter" class="pp-btn-clear-buildings" title="Remover filtro de data">Limpar</button>
                    <span id="notedate-filter-status" class="pp-coord-status" style="color:#880e4f;"></span>
                </div>

                <!-- Filtro de população -->
                <div class="pp-row-pop">
                    <span class="pp-filter-label">👥 Pop:</span>
                    <select id="pop-field" class="pp-coord-op" style="width:120px;" title="Qual população filtrar">
                        <option value="defInside"  title="Tropas em casa quando TU atacaste (defensor em casa)">🏠 Defesa casa</option>
                        <option value="defOutside" title="Tropas fora de casa no momento do teu reconhecimento">✈️ Defesa fora</option>
                        <option value="defTotal"   title="Soma de tropas em casa + fora (quando TU atacaste)">👥 Defesa total</option>
                        <option value="atkSent"    title="Tropas que ELE enviou quando te atacou">⚔️ Ataque enviado</option>
                    </select>
                    <select id="pop-op" class="pp-coord-op" title="Operador de comparação">
                        <option value=">=" title="Mostrar aldeias com população maior ou igual ao valor">≥</option>
                        <option value="<=" title="Mostrar aldeias com população menor ou igual ao valor">≤</option>
                    </select>
                    <input type="number" id="pop-val" class="pp-coord-input" placeholder="ex: 40 = 40k" min="0" style="width:80px;" title="Valor em milhares (k). Ex: 40 = 40.000 pop. Ex: 5.5 = 5.500 pop.">
                    <span style="font-size:10px;color:#e65100;font-weight:bold;flex:0 0 auto;" title="O valor é multiplicado por 1000. Escreve 40 para filtrar 40.000 pop.">× 1k</span>
                    <button id="clear-pop-filter" class="pp-btn-clear-buildings" title="Remover filtro de população">Limpar</button>
                    <span id="pop-filter-status" class="pp-coord-status" style="color:#e65100;"></span>
                </div>

                <div class="pp-progress-wrap" id="pp-progress-wrap">
                    <div class="pp-progress-bar-text" id="pp-progress-text">A analisar...</div>
                    <div class="pp-progress-track"><div class="pp-progress-fill" id="pp-progress-fill"></div></div>
                    <div class="pp-scan-done" id="pp-scan-done"></div>
                </div>
            </div>
        `);

        $('#villages_list').before(toolbar);

        const copyBtnBottom = $('<div style="text-align:right;margin-top:6px;"><button id="copy-visible-bottom" class="pp-btn-copy" style="font-size:11px;padding:4px 12px;">' + getTranslation('copyCoords') + '</button></div>');
        $('#villages_list').after(copyBtnBottom);

        function hideTWFilterBar() {
            const selectors = ['#paged_view_filter', '#pl_filter', '.paged-view-filter', '#villages_list_filters'];
            selectors.forEach(sel => $(sel).hide());

            $('#villages_list').siblings().each(function () {
                const $el = $(this);
                if ($el.hasClass('pp-panel') || $el.hasClass('pp-load-warning') || $el.attr('id') === 'pp-load-warning') return;
                if ($el.find('#copy-visible-bottom').length > 0) return;

                const btns = $el.find('button, input[type=button]').map(function () { return $(this).text().trim(); }).get();
                const twBtns = ['Scan', 'OFF', 'DEF', '?', 'Todas', 'All'];
                const matches = btns.filter(t => twBtns.includes(t));
                if (matches.length >= 2) $el.hide();
            });
        }
        hideTWFilterBar();
        setTimeout(hideTWFilterBar, 500);
        setTimeout(hideTWFilterBar, 1500);

        initializeNoteIcons();
        updateStats();
        updateLoadWarning();

        let debounceTimer;
        const observer = new MutationObserver(function (mutations) {
            let shouldInit = false;
            mutations.forEach(function (mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(function (node) {
                        if (node.nodeType === 1) {
                            if ($(node).is('#villages_list tbody tr') || $(node).find('#villages_list tbody tr').length > 0) {
                                shouldInit = true;
                            }
                        }
                    });
                }
            });

            if (shouldInit) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    window.pp_rows = window.pp_rows.filter(r => r.row.closest('body').length > 0);
                    initializeNoteIcons();
                    updateLoadWarning();
                    updateActiveFilterUI();
                    applyFilters(undefined, undefined, undefined, undefined, undefined);
                }, 150);
            }
        });

        const villagesList = document.getElementById('villages_list');
        if (villagesList) observer.observe(villagesList, { childList: true, subtree: true });

        function filterLabel(f) {
            if (!f) return '';
            const opSym = f.op === '>=' ? '≥' : f.op === '<=' ? '≤' : '=';
            return '<i style="font-style:italic;font-weight:normal;">' + opSym + f.val + '</i>';
        }

        function updatePointsModeUI() {
            const mode = $('#points-mode').val();
            if (mode === 'between') {
                $('#points-value-1').attr('placeholder', 'Min');
                $('#points-value-2').show().attr('placeholder', 'Max');
            } else {
                $('#points-value-1').attr('placeholder', 'Valor');
                $('#points-value-2').hide().val('');
            }
        }

        function updatePointsFilterStatus() {
            const pf = window.pp_activeFilter.pointsFilter;

            if (!pf) {
                $('#points-filter-status').text('');
                $('#points-value-1').val('');
                $('#points-value-2').val('');
                return;
            }

            if (pf.mode === 'max') {
                $('#points-mode').val('max');
                $('#points-value-1').val(pf.value);
                $('#points-value-2').val('');
                $('#points-filter-status').text('Pontos da aldeia até ' + pf.value);
            } else if (pf.mode === 'min') {
                $('#points-mode').val('min');
                $('#points-value-1').val(pf.value);
                $('#points-value-2').val('');
                $('#points-filter-status').text('Pontos da aldeia acima de ' + pf.value);
            } else if (pf.mode === 'between') {
                $('#points-mode').val('between');
                $('#points-value-1').val(pf.min);
                $('#points-value-2').val(pf.max);
                $('#points-filter-status').text('Pontos da aldeia entre ' + pf.min + ' e ' + pf.max);
            }

            updatePointsModeUI();
        }

        function updateCoordsFilterStatus() {
            const xf = window.pp_activeFilter.coordXFilter;
            const yf = window.pp_activeFilter.coordYFilter;
            const parts = [];
            if (xf) parts.push('X ' + xf.op + ' ' + xf.val);
            if (yf) parts.push('Y ' + yf.op + ' ' + yf.val);
            $('#coords-filter-status').text(parts.length ? parts.join(' | ') : '');

            if (xf) { $('#coord-x-op').val(xf.op); $('#coord-x-val').val(xf.val); }
            if (yf) { $('#coord-y-op').val(yf.op); $('#coord-y-val').val(yf.val); }
        }

        function updateNoteDateFilterStatus() {
            const f = window.pp_activeFilter.noteDateFilter;
            if (!f) {
                $('#notedate-filter-status').text('');
                $('#notedate-days').val('');
                return;
            }
            const modeLabel = f.mode === 'newer' ? 'MAX' : 'MIN';
            const roleLabel = { def: 'como def', atk: 'como atk', any: 'qualquer' }[f.role] || '';
            $('#notedate-filter-status').text(`${modeLabel} ${f.days} dias (${roleLabel})`);
            $('#notedate-mode').val(f.mode);
            $('#notedate-role').val(f.role || 'any');
            $('#notedate-days').val(f.days);
        }

        function updatePopFilterStatus() {
            const f = window.pp_activeFilter.popFilter;
            if (!f) {
                $('#pop-filter-status').text('');
                $('#pop-val').val('');
                return;
            }
            const fieldLabel = { defInside: '🏠 Defesa casa', defOutside: '✈️ Defesa fora', defTotal: '👥 Defesa total', atkSent: '⚔️ Ataque enviado' }[f.field] || f.field;
            const displayVal = (f.val / 1000) % 1 === 0 ? (f.val / 1000) + 'k' : (f.val / 1000).toFixed(1) + 'k';
            $('#pop-filter-status').text(fieldLabel + ' ' + f.op + ' ' + displayVal);
            $('#pop-field').val(f.field);
            $('#pop-op').val(f.op);
            // Mostrar valor original em k no input
            $('#pop-val').val(f.val / 1000);
        }

        function updateBuildingStatus() {
            const w = window.pp_activeFilter.wallFilter;
            const t = window.pp_activeFilter.towerFilter;
            const wActive = !!w;
            const tActive = !!t;

            $('#filter-wall-label').html(wActive ? filterLabel(w) : '');
            $('#filter-tower-label').html(tActive ? filterLabel(t) : '');
            $('#filter-wall-btn').toggleClass('active-filter', wActive);
            $('#filter-tower-btn').toggleClass('active-filter', tActive);

            const towerToggleActive = tActive && t.op === '>=' && t.val === 1;
            $('#filter-has-tower').toggleClass('active-filter', towerToggleActive);

            const parts = [];
            if (wActive) parts.push('🏰' + filterLabel(w));
            if (tActive) parts.push('🗼' + filterLabel(t));
            $('#building-filter-status').html(parts.length ? parts.join(' | ') : '');
        }

        function updateActiveFilterUI() {
            const activeTypes = window.pp_activeFilter.types;
            const activeK = window.pp_activeFilter.kList;

            $('#filter-off').toggleClass('active-filter', activeTypes.has('off'));
            $('#filter-def').toggleClass('active-filter', activeTypes.has('def'));
            $('#filter-nd').toggleClass('active-filter', activeTypes.has('no-data'));

            const af = window.pp_activeFilter.attackFilter;
            $('#filter-attack-mine').toggleClass('active-filter', af === 'mine');
            $('#filter-attack-ally').toggleClass('active-filter', af === 'ally');
            $('#filter-attack-none').toggleClass('active-filter', af === 'none');

            const $wrap = $('#k-tags-wrap');
            const activeKSet = new Set(activeK);
            const allK = [];

            window.pp_rows.forEach(r => {
                const coords = extractCoordsFromRow(r.row);
                const k = coords ? getContinentFromCoords(coords) : null;
                if (k && !allK.includes(k)) allK.push(k);
            });

            allK.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

            $wrap.empty();
            allK.forEach(k => {
                const isActive = activeKSet.has(k);
                const $tag = $('<span class="k-tag"></span>')
                    .text(k)
                    .toggleClass('active-filter', isActive);

                $tag.on('click', function () {
                    const newKSet = new Set(window.pp_activeFilter.kList);
                    if (newKSet.has(k)) newKSet.delete(k);
                    else newKSet.add(k);

                    applyFilters(undefined, Array.from(newKSet), undefined, undefined, undefined);
                    updateActiveFilterUI();
                });

                $wrap.append($tag);
            });

            updateBuildingStatus();
            updatePointsFilterStatus();
            updateCoordsFilterStatus();
            updateNoteDateFilterStatus();
            updatePopFilterStatus();
        }

        function openToolbarPicker(type, $anchor) {
            $('.pp-level-picker').remove();
            const maxLvl = 20;
            const activeFilter = type === 'wall' ? window.pp_activeFilter.wallFilter : window.pp_activeFilter.towerFilter;
            const activeOp = (activeFilter && activeFilter.op) || '>=';
            const activeVal = (activeFilter && activeFilter.val != null) ? activeFilter.val : null;
            let selectedOp = activeOp;

            const $picker = $('<div class="pp-level-picker" style="min-width:230px;"></div>');
            const title = type === 'wall' ? '🏰 Muralha' : '🗼 Torre';
            $picker.append('<div style="width:100%;font-size:11px;font-weight:bold;color:#3949ab;margin-bottom:6px;">' + title + '</div>');

            const $opWrap = $('<div class="pp-op-wrap"></div>');
            const ops = [
                { val: '>=', label: '≥ maior ou igual' },
                { val: '<=', label: '≤ menor ou igual' },
                { val: '=', label: '= igual a' }
            ];

            ops.forEach(function (o) {
                const $ob = $('<button class="pp-op-btn' + (selectedOp === o.val ? ' active' : '') + '">' + o.label + '</button>');
                $ob.on('click', function (ev) {
                    ev.stopPropagation();
                    selectedOp = o.val;
                    $picker.find('.pp-op-btn').removeClass('active');
                    $ob.addClass('active');
                });
                $opWrap.append($ob);
            });

            $picker.append($opWrap);
            $picker.append('<div style="width:100%;font-size:10px;color:#888;margin:6px 0 4px;">Nível:</div>');

            const $grid = $('<div class="pp-lvl-grid"></div>');
            for (let i = 0; i <= maxLvl; i++) {
                const $btn = $('<button class="pp-lvl-btn">' + i + '</button>');
                if (activeVal == i) $btn.addClass('active');

                $btn.on('click', function (ev) {
                    ev.stopPropagation();
                    $('.pp-level-picker').remove();
                    const f = { op: selectedOp, val: i };
                    if (type === 'wall') applyFilters(undefined, undefined, f, undefined, undefined);
                    else applyFilters(undefined, undefined, undefined, f, undefined);
                    updateActiveFilterUI();
                    updateBuildingStatus();
                });

                $grid.append($btn);
            }

            $picker.append($grid);

            const $clear = $('<button class="pp-lvl-clear">✕ Sem filtro</button>');
            $clear.on('click', function (ev) {
                ev.stopPropagation();
                $('.pp-level-picker').remove();
                if (type === 'wall') applyFilters(undefined, undefined, null, undefined, undefined);
                else applyFilters(undefined, undefined, undefined, null, undefined);
                updateActiveFilterUI();
                updateBuildingStatus();
            });

            $picker.append($clear);

            $('body').append($picker);
            const rect = $anchor[0].getBoundingClientRect();
            $picker.css({
                top: rect.bottom + 4 + 'px',
                left: Math.min(rect.left, window.innerWidth - 240) + 'px'
            });
        }

        function doCopyVisible() {
            const coords = [];
            window.pp_rows.forEach(r => {
                if (r.row.is(':visible')) {
                    const c = extractCoordsFromRow(r.row);
                    if (c) coords.push(c);
                }
            });

            if (coords.length) {
                navigator.clipboard.writeText(coords.join(' '));
                if (typeof UI !== 'undefined' && UI.SuccessMessage) {
                    UI.SuccessMessage(getTranslation('copied', coords.length));
                }
            }
        }

        function applyPointsFilterLive() {
            const mode = $('#points-mode').val();
            const raw1 = $('#points-value-1').val().trim();
            const raw2 = $('#points-value-2').val().trim();

            if (raw1 === '' && raw2 === '') {
                applyFilters(undefined, undefined, undefined, undefined, null);
                updatePointsFilterStatus();
                return;
            }

            const v1 = raw1 === '' ? NaN : parseInt(raw1, 10);
            const v2 = raw2 === '' ? NaN : parseInt(raw2, 10);

            if (mode === 'max') {
                if (isNaN(v1)) return;
                applyFilters(undefined, undefined, undefined, undefined, { mode: 'max', value: v1 });
            } else if (mode === 'min') {
                if (isNaN(v1)) return;
                applyFilters(undefined, undefined, undefined, undefined, { mode: 'min', value: v1 });
            } else if (mode === 'between') {
                if (isNaN(v1) || isNaN(v2)) return;
                applyFilters(undefined, undefined, undefined, undefined, { mode: 'between', min: Math.min(v1, v2), max: Math.max(v1, v2) });
            }

            updatePointsFilterStatus();
        }

        function applyCoordsFilterLive() {
            const rawX = $('#coord-x-val').val().trim();
            const rawY = $('#coord-y-val').val().trim();
            const opX  = $('#coord-x-op').val();
            const opY  = $('#coord-y-op').val();

            const xFilter = rawX !== '' && !isNaN(parseInt(rawX, 10))
                ? { op: opX, val: parseInt(rawX, 10) }
                : null;

            const yFilter = rawY !== '' && !isNaN(parseInt(rawY, 10))
                ? { op: opY, val: parseInt(rawY, 10) }
                : null;

            applyFilters(undefined, undefined, undefined, undefined, undefined, undefined, xFilter, yFilter);
            updateCoordsFilterStatus();
        }

        function applyNoteDateFilterLive() {
            const raw  = $('#notedate-days').val().trim();
            const mode = $('#notedate-mode').val();
            const role = $('#notedate-role').val();

            if (raw === '' || isNaN(parseInt(raw, 10))) {
                applyFilters(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null);
                updateNoteDateFilterStatus();
                return;
            }

            applyFilters(
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                { mode, role, days: parseInt(raw, 10) }
            );
            updateNoteDateFilterStatus();
        }

        function applyPopFilterLive() {
            const raw   = $('#pop-val').val().trim();
            const field = $('#pop-field').val();
            const op    = $('#pop-op').val();

            if (raw === '' || isNaN(parseFloat(raw))) {
                applyFilters(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null);
                updatePopFilterStatus();
                return;
            }

            // Valor em k — utilizador escreve 40 para 40.000
            const val = Math.round(parseFloat(raw) * 1000);

            applyFilters(
                undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                { field, op, val }
            );
            updatePopFilterStatus();
        }

        // ── Event bindings ──

        $('#copy-visible').click(doCopyVisible);
        $(document).on('click', '#copy-visible-bottom', doCopyVisible);

        $('#filter-off').click(() => { toggleType('off'); updateActiveFilterUI(); });
        $('#filter-def').click(() => { toggleType('def'); updateActiveFilterUI(); });
        $('#filter-nd').click(() => { toggleType('no-data'); updateActiveFilterUI(); });

        $('#reset-all-filters').click(() => {
            applyFilters('reset');
            $('#coord-x-val').val('');
            $('#coord-y-val').val('');
            $('#notedate-days').val('');
            $('#notedate-role').val('any');
            $('#pop-val').val('');
            updateActiveFilterUI();
            updateBuildingStatus();
            updatePointsFilterStatus();
            updateCoordsFilterStatus();
            updateNoteDateFilterStatus();
            updatePopFilterStatus();
        });

        $('#filter-wall-btn').click(function (e) { e.stopPropagation(); openToolbarPicker('wall', $(this)); });
        $('#filter-tower-btn').click(function (e) { e.stopPropagation(); openToolbarPicker('tower', $(this)); });

        $('#filter-has-tower').click(() => {
            const current = window.pp_activeFilter.towerFilter;
            const isActive = current && current.op === '>=' && current.val === 1;
            const next = isActive ? null : { op: '>=', val: 1 };
            applyFilters(undefined, undefined, undefined, next, undefined);
            updateActiveFilterUI();
            updateBuildingStatus();
        });

        $('#filter-attack-mine').click(() => {
            const cur = window.pp_activeFilter.attackFilter;
            applyFilters(undefined, undefined, undefined, undefined, undefined, cur === 'mine' ? null : 'mine');
            updateActiveFilterUI();
        });

        $('#filter-attack-ally').click(() => {
            const cur = window.pp_activeFilter.attackFilter;
            applyFilters(undefined, undefined, undefined, undefined, undefined, cur === 'ally' ? null : 'ally');
            updateActiveFilterUI();
        });

        $('#filter-attack-none').click(() => {
            const cur = window.pp_activeFilter.attackFilter;
            applyFilters(undefined, undefined, undefined, undefined, undefined, cur === 'none' ? null : 'none');
            updateActiveFilterUI();
        });

        $('#points-mode').on('change', function () { updatePointsModeUI(); applyPointsFilterLive(); });
        $('#points-value-1').on('input', function () { applyPointsFilterLive(); });
        $('#points-value-2').on('input', function () { applyPointsFilterLive(); });
        $('#clear-points-filter').click(() => {
            $('#points-value-1').val('');
            $('#points-value-2').val('');
            applyFilters(undefined, undefined, undefined, undefined, null);
            updatePointsFilterStatus();
        });

        $('#coord-x-val').on('input', applyCoordsFilterLive);
        $('#coord-y-val').on('input', applyCoordsFilterLive);
        $('#coord-x-op').on('change', applyCoordsFilterLive);
        $('#coord-y-op').on('change', applyCoordsFilterLive);
        $('#clear-coords-filter').click(() => {
            $('#coord-x-val').val('');
            $('#coord-y-val').val('');
            applyFilters(undefined, undefined, undefined, undefined, undefined, undefined, null, null);
            updateCoordsFilterStatus();
        });

        // Nota date
        $('#notedate-days').on('input', applyNoteDateFilterLive);
        $('#notedate-mode').on('change', applyNoteDateFilterLive);
        $('#notedate-role').on('change', applyNoteDateFilterLive);
        $('#clear-notedate-filter').click(() => {
            $('#notedate-days').val('');
            applyFilters(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null);
            updateNoteDateFilterStatus();
        });

        // Pop
        $('#pop-val').on('input', applyPopFilterLive);
        $('#pop-field').on('change', applyPopFilterLive);
        $('#pop-op').on('change', applyPopFilterLive);
        $('#clear-pop-filter').click(() => {
            $('#pop-val').val('');
            applyFilters(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null);
            updatePopFilterStatus();
        });

        $(document).on('click', '.pp-building-cell', function (e) {
            e.stopPropagation();
            openToolbarPicker($(this).data('type'), $(this));
        });

        $(document).on('click', function (e) {
            if (!$(e.target).closest('.pp-level-picker').length) {
                $('.pp-level-picker').remove();
            }
        });

        $('#scan-all').click(async () => {
            const performScan = async (delay = 500) => {
                const $progressWrapEarly = $('#pp-progress-wrap');
                $progressWrapEarly.addClass('active');
                $('#pp-scan-done').removeClass('visible');
                $('#pp-progress-fill').css('width', '0%');
                $('#pp-progress-text').text(getTranslation('loadingAllVillages'));

                if (!checkAllVillagesLoaded()) {
                    const lastRow = $('#villages_list > tbody > tr:last');
                    const loadAllLink = lastRow.find('a').filter(function () {
                        const txt = ($(this).text() || '').toLowerCase();
                        const oc = $(this).attr('onclick') || '';
                        return txt.includes('todas') || txt.includes('all') || oc.includes('getAllVillages');
                    });

                    if (loadAllLink.length > 0) {
                        clickLoadAllVillages();

                        await new Promise(resolve => {
                            const checkInterval = setInterval(() => {
                                if (checkAllVillagesLoaded()) {
                                    clearInterval(checkInterval);
                                    resolve();
                                }
                            }, 500);

                            setTimeout(() => {
                                clearInterval(checkInterval);
                                resolve();
                            }, 30000);
                        });
                    }
                }

                const $progressWrap = $('#pp-progress-wrap');
                const $progressText = $('#pp-progress-text');
                const $progressFill = $('#pp-progress-fill');
                const $scanDone = $('#pp-scan-done');

                $scanDone.removeClass('visible');
                $progressFill.css('width', '0%');
                $progressText.text(getTranslation('scanningVillages'));
                $progressWrap.addClass('active');

                const total = window.pp_rows.length;

                for (let i = 0; i < window.pp_rows.length; i++) {
                    const r = window.pp_rows[i];
                    await new Promise(resolve => {
                        r.icon.click();
                        setTimeout(resolve, delay);
                    });

                    const current = i + 1;
                    const percentage = Math.round((current / total) * 100);
                    $progressText.text(getTranslation('scanProgress', current, total, percentage));
                    $progressFill.css('width', percentage + '%');
                }

                $progressFill.css('width', '100%');
                $progressText.text('✔ Concluído');
                $scanDone.text('✅ Scan completo! Todas as aldeias foram analisadas.').addClass('visible');
                updateActiveFilterUI();

                // ── Som de conclusão ──
                try {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
                    notes.forEach((freq, i) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.frequency.value = freq;
                        osc.type = 'sine';
                        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
                        osc.start(ctx.currentTime + i * 0.15);
                        osc.stop(ctx.currentTime + i * 0.15 + 0.35);
                    });
                } catch(e) { /* sem som se AudioContext não disponível */ }

                // ── Popup de conclusão ──
                const $scanPopup = $(`
                    <div style="
                        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                        z-index:20000;background:#fff;border:3px solid #2e7d32;border-radius:12px;
                        padding:28px 40px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.45);
                        font-family:sans-serif;min-width:300px;
                    ">
                        <div style="font-size:42px;margin-bottom:8px;">✅</div>
                        <div style="font-size:18px;font-weight:bold;color:#1b5e20;margin-bottom:6px;">Scan Completo!</div>
                        <div style="font-size:13px;color:#555;margin-bottom:16px;">
                            <b>${total}</b> aldeias analisadas com sucesso.
                        </div>
                        <button id="pp-scan-popup-close" style="
                            padding:8px 24px;background:#2e7d32;border:none;border-radius:6px;
                            color:#fff;font-size:13px;font-weight:bold;cursor:pointer;
                        ">OK</button>
                    </div>
                    <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.3);z-index:19999;" id="pp-scan-popup-overlay"></div>
                `);
                $('body').append($scanPopup);
                $('#pp-scan-popup-close, #pp-scan-popup-overlay').on('click', () => $scanPopup.remove());

                setTimeout(() => {
                    $progressWrap.removeClass('active');
                    $scanDone.removeClass('visible');
                }, 5000);
            };

            // ── Modal personalizado com slider de velocidade ──
            const $scanModal = $(`
                <div id="pp-scan-modal-overlay" style="
                    position:fixed;top:0;left:0;width:100%;height:100%;
                    background:rgba(0,0,0,.45);z-index:20000;
                "></div>
                <div id="pp-scan-modal" style="
                    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                    z-index:20001;background:#fff;border:3px solid #8B4513;border-radius:12px;
                    padding:24px 32px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5);
                    font-family:sans-serif;min-width:340px;max-width:420px;
                ">
                    <div style="font-size:22px;font-weight:bold;color:#3d1f00;margin-bottom:8px;">🔍 Scan de Aldeias</div>
                    <div style="font-size:12px;color:#666;margin-bottom:18px;">
                        Isto irá carregar as notas de todas as aldeias.<br>Pode demorar vários minutos.
                    </div>
                    <div style="background:#fdf3e0;border:1px solid #c9a97a;border-radius:8px;padding:14px;margin-bottom:18px;text-align:left;">
                        <div style="font-size:12px;font-weight:bold;color:#3d1f00;margin-bottom:10px;">⚡ Velocidade do scan</div>
                        <input type="range" id="pp-scan-speed" min="1" max="5" value="3" step="1" style="width:100%;accent-color:#8B4513;">
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-top:3px;">
                            <span>Mais seguro<br><span style="color:#555;">~700ms</span></span>
                            <span style="text-align:center;">Normal<br><span style="color:#555;">~500ms</span></span>
                            <span style="text-align:center;">Rápido ✅<br><span style="color:#2e7d32;font-weight:bold;">~350ms</span></span>
                            <span style="text-align:center;">Muito rápido<br><span style="color:#e65100;">~250ms ⚠️</span></span>
                            <span style="text-align:right;">Máximo<br><span style="color:#c0392b;font-weight:bold;">~150ms 🚫</span></span>
                        </div>
                        <div id="pp-scan-speed-label" style="font-size:11px;color:#5a3e1b;margin-top:8px;text-align:center;font-style:italic;"></div>
                    </div>
                    <div style="display:flex;gap:10px;justify-content:center;">
                        <button id="pp-scan-modal-cancel" style="
                            padding:8px 22px;background:#fff;border:2px solid #c0392b;border-radius:6px;
                            color:#c0392b;font-size:13px;font-weight:bold;cursor:pointer;
                        ">Cancelar</button>
                        <button id="pp-scan-modal-start" style="
                            padding:8px 22px;background:#8B4513;border:none;border-radius:6px;
                            color:#fff;font-size:13px;font-weight:bold;cursor:pointer;
                        ">Iniciar Scan</button>
                    </div>
                </div>
            `);

            const speedDelays = { 1: 700, 2: 500, 3: 350, 4: 250, 5: 150 };
            const speedLabels = {
                1: 'Mais seguro — menor risco de bloqueio pelo servidor',
                2: 'Normal — velocidade padrão recomendada',
                3: '✅ Rápido — máximo recomendado, bom equilíbrio segurança/velocidade',
                4: '⚠️ Muito rápido — acima do recomendado, usa com cuidado',
                5: '🚫 Máximo — risco elevado de bloqueio temporário pelo servidor'
            };

            function updateSpeedLabel() {
                const v = $('#pp-scan-speed').val();
                $('#pp-scan-speed-label').text(speedLabels[v] || '');
            }

            $('body').append($scanModal);
            updateSpeedLabel();

            $('#pp-scan-speed').on('input', updateSpeedLabel);

            $('#pp-scan-modal-cancel, #pp-scan-modal-overlay').on('click', () => {
                $scanModal.remove();
                $('#pp-progress-wrap').removeClass('active');
            });

            $('#pp-scan-modal-start').on('click', async () => {
                const delay = speedDelays[$('#pp-scan-speed').val()] || 500;
                $scanModal.remove();
                await performScan(delay);
            });
        });

        $('#villages_list').on('click', '.pp-note-icon', function (e) {
            e.stopPropagation();

            const $icon = $(this);
            const villageId = $icon.data('village-id');

            if (!villageId) {
                alert(getTranslation('villageIdNotFound'));
                return;
            }

            const currentState = window.pp_settings.noteStates[villageId];
            if (currentState === 'loading') return;

            window.pp_settings.noteStates[villageId] = 'loading';
            $icon.removeClass('not-loaded off def no-data').addClass('loading').text('...');

            if (typeof game_data === 'undefined' || !game_data.village) {
                alert(getTranslation('gameDataNotAvailable'));
                return;
            }

            const $row = $icon.closest('tr');
            const coords = extractCoordsFromRow($row) || '';
            const coordMatch = coords.match(/(\d+)\|(\d+)/);

            let noteUrl = `${location.origin}/game.php?village=${game_data.village.id}&screen=info_village&id=${villageId}`;
            if (coordMatch) noteUrl += `#${coordMatch[1]};${coordMatch[2]}`;

            $.ajax({
                url: noteUrl,
                type: 'GET',
                dataType: 'html',
                success: function (data) {
                    const $loadedContent = $(data);
                    const $noteBody = $loadedContent.find('.village-note-body');

                    let noteContent = '';
                    let hasData = false;

                    if ($noteBody.length > 0) {
                        $noteBody.each(function () {
                            const content = ($(this).html() || '').trim();
                            if (content.length > 0) {
                                hasData = true;
                                noteContent += $(this).prop('outerHTML');
                            }
                        });
                    }

                    const villageType = hasData ? classifyVillage(noteContent) : 'no-data';

                    // ── Extrair nome do dono da aldeia ──
                    const ownerName = extractVillageOwnerName($loadedContent);

                    // ── Processar relatórios separando por papel do dono ──
                    const reports = extractReports($loadedContent, ownerName);

                    // ── Extrair data da última nota (village-note-body) ──
                    // Usamos o mais recente de def ou atk como "última nota" geral para compatibilidade
                    const lastNoteTs = Math.max(reports.def.ts || 0, reports.atk.ts || 0) || null;

                    function extractBuildingFromTable($doc, namePatterns) {
                        let found = null;
                        $doc.find('td').each(function () {
                            const cellText = $(this).text().trim().toLowerCase();
                            if (namePatterns.some(function (p) { return cellText === p; })) {
                                const $next = $(this).next('td');
                                if ($next.length) {
                                    const lvl = parseInt($next.text().trim(), 10);
                                    if (!isNaN(lvl)) {
                                        found = lvl;
                                        return false;
                                    }
                                }
                            }
                        });
                        return found;
                    }

                    const wallLevel  = extractBuildingFromTable($loadedContent, ['muralha', 'wall']);
                    const towerLevel = extractBuildingFromTable($loadedContent, ['torre de vigia', 'watchtower']);

                    window.pp_settings.noteStates[villageId] = villageType;
                    window.pp_settings.wallLevels    = window.pp_settings.wallLevels    || {};
                    window.pp_settings.towerLevels   = window.pp_settings.towerLevels   || {};
                    window.pp_settings.lastNoteDef   = window.pp_settings.lastNoteDef   || {};
                    window.pp_settings.popDefInside  = window.pp_settings.popDefInside  || {};
                    window.pp_settings.popDefOutside = window.pp_settings.popDefOutside || {};
                    window.pp_settings.lastNoteAtk   = window.pp_settings.lastNoteAtk   || {};
                    window.pp_settings.popAtkSent    = window.pp_settings.popAtkSent    || {};

                    if (wallLevel !== null)  window.pp_settings.wallLevels[villageId]  = wallLevel;
                    else delete window.pp_settings.wallLevels[villageId];

                    if (towerLevel !== null) window.pp_settings.towerLevels[villageId] = towerLevel;
                    else delete window.pp_settings.towerLevels[villageId];

                    // Defensor (nós atacámos)
                    if (reports.def.ts) {
                        window.pp_settings.lastNoteDef[villageId]   = reports.def.ts;
                        if (reports.def.inside  !== null) window.pp_settings.popDefInside[villageId]  = reports.def.inside;
                        else delete window.pp_settings.popDefInside[villageId];
                        if (reports.def.outside !== null) window.pp_settings.popDefOutside[villageId] = reports.def.outside;
                        else delete window.pp_settings.popDefOutside[villageId];
                    } else {
                        delete window.pp_settings.lastNoteDef[villageId];
                        delete window.pp_settings.popDefInside[villageId];
                        delete window.pp_settings.popDefOutside[villageId];
                    }

                    // Atacante (ele atacou-nos)
                    if (reports.atk.ts) {
                        window.pp_settings.lastNoteAtk[villageId] = reports.atk.ts;
                        if (reports.atk.sent !== null) window.pp_settings.popAtkSent[villageId] = reports.atk.sent;
                        else delete window.pp_settings.popAtkSent[villageId];
                    } else {
                        delete window.pp_settings.lastNoteAtk[villageId];
                        delete window.pp_settings.popAtkSent[villageId];
                    }

                    saveSettings();

                    $icon.removeClass('loading not-loaded off def no-data').addClass(villageType).text(getLabel(villageType));

                    const $currentRow = $icon.closest('tr');
                    $currentRow.find('.pp-building-cell[data-type="wall"]').replaceWith(getBuildingCellHtml(villageId, 'wall'));
                    $currentRow.find('.pp-building-cell[data-type="tower"]').replaceWith(getBuildingCellHtml(villageId, 'tower'));

                    const s = window.pp_settings;
                    $currentRow.find('.pp-popdef-cell').html(buildPopCellHtml((s.popDefInside||{})[villageId], (s.popDefOutside||{})[villageId]));
                    $currentRow.find('.pp-datedef-cell').text(formatNoteDate((s.lastNoteDef||{})[villageId]));
                    $currentRow.find('.pp-popatk-cell').html(buildPopAtkHtml((s.popAtkSent||{})[villageId]));
                    $currentRow.find('.pp-dateatk-cell').text(formatNoteDate((s.lastNoteAtk||{})[villageId]));

                    updateStats();
                    updateActiveFilterUI();
                    applyFilters(undefined, undefined, undefined, undefined, undefined);

                    if (hasData) {
                        showNotePopup(villageId, noteContent, coords);
                    } else {
                        if (typeof UI !== 'undefined' && UI.ErrorMessage) UI.ErrorMessage(getTranslation('noNotesFound'));
                        else alert(getTranslation('noNotesFound'));
                    }
                },
                error: function () {
                    alert(getTranslation('failedToLoad'));
                    window.pp_settings.noteStates[villageId] = 'not-loaded';
                    $icon.removeClass('loading').addClass('not-loaded').text(getLabel('not-loaded'));
                }
            });
        });

        function showNotePopup(villageId, content, coords) {
            $('.note-popup').remove();
            $(document).off('.ppDrag');

            const $popup = $('<div class="note-popup"></div>');
            $popup.html(`
                <div class="note-popup-header">
                    <span>${getTranslation('villageNotes', coords || villageId)}</span>
                    <span class="note-popup-close">×</span>
                </div>
                <div class="note-popup-content">${content}</div>
            `);
            $('body').append($popup);

            // Encostado à direita, verticalmente abaixo do painel de filtros
            const popupWidth  = $popup.outerWidth()  || 450;
            const popupHeight = $popup.outerHeight() || 300;
            const windowWidth  = $(window).width();
            const windowHeight = $(window).height();
            const $toolbar = $('.pp-panel').first();
            let defaultTop = 100;
            if ($toolbar.length) {
                const tbRect = $toolbar[0].getBoundingClientRect();
                defaultTop = tbRect.bottom + 10;
                // Se ficar fora do ecrã por baixo, sobe
                if (defaultTop + popupHeight > windowHeight - 20) {
                    defaultTop = Math.max(20, windowHeight - popupHeight - 20);
                }
            }
            const defaultLeft = Math.max(20, windowWidth - popupWidth - 20);
            $popup.css({ top: defaultTop + 'px', left: defaultLeft + 'px', right: 'auto' });

            $popup.find('.note-popup-close').on('click', function (e) {
                e.stopPropagation();
                $(document).off('.ppDrag');
                $popup.remove();
            });

            let isDragging = false;
            let offsetX = 0;
            let offsetY = 0;

            $popup.find('.note-popup-header').on('mousedown', function (e) {
                if ($(e.target).hasClass('note-popup-close')) return;
                isDragging = true;
                const rect = $popup[0].getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                $popup.find('.note-popup-header').css('cursor', 'grabbing');
                e.preventDefault();
            });

            $(document).on('mousemove.ppDrag', function (e) {
                if (!isDragging) return;
                e.preventDefault();
                let newLeft = e.clientX - offsetX;
                let newTop  = e.clientY - offsetY;
                const maxLeft = $(window).width()  - $popup.outerWidth();
                const maxTop  = $(window).height() - $popup.outerHeight();
                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop  = Math.max(0, Math.min(newTop,  maxTop));
                $popup.css({ left: newLeft + 'px', top: newTop + 'px', right: 'auto' });
            });

            $(document).on('mouseup.ppDrag', function () {
                if (!isDragging) return;
                isDragging = false;
                $popup.find('.note-popup-header').css('cursor', 'move');
            });
        }

        updatePointsModeUI();
        updateActiveFilterUI();
        applyFilters(undefined, undefined, undefined, undefined, undefined);
    }
})();
