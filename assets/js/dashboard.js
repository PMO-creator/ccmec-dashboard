(function () {
  "use strict";

  const FALLBACK_DATA_URL = "data/master_data.json";
  const SHEET_ID = "1QAFhpV61xjHTMSjjOxl5fwDSrXoHVjPBUfzs2iHLhjg";
  const SHEET_TAB = "master data";
  const SHEET_EDIT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  const LIVE_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

  // Mesmo mapeamento de colunas usado em scripts/fetch_sheet_data.py.
  const CSV_COLUMNS = {
    1: "eixo", 2: "grupo", 3: "marco", 4: "tarefa", 5: "fornecedor", 6: "responsavel",
    7: "prioridade", 8: "status", 9: "data_inicio", 10: "data_fim", 11: "duracao",
    12: "predecessores", 15: "complexidade", 17: "progresso", 18: "impacto", 19: "encaminhamentos",
  };
  const CSV_AREA_COLUMNS = {
    21: "FOYER", 22: "ÁREA 0 (pinguela)", 23: "ÁREA 1 (diversidade)",
    24: "ÁREA 2 (oralidade e tecnologias)", 25: "ÁREA 3 (aturá e feira)", 26: "ÁREA 4 (crises)",
    27: "ÁREA 5 (bem viver)", 28: "MEZANINO", 29: "EXPOSIÇÃO TEMPORÁRIA", 30: "LOJA",
    31: "ÁREA EXTERNA DO MUSEU", 32: "ÁREAS COMUNS",
  };
  const CSV_FIRST_DATA_ROW = 2;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r") {
        // ignora
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function csvCell(row, idx) {
    return idx < row.length && typeof row[idx] === "string" ? row[idx].trim() : "";
  }

  function parseDateBR(value) {
    if (!value || value === "30/12/1899") return null;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  function parseDuracao(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }

  function buildTasksFromCsv(rows) {
    const tasks = [];
    for (let offset = 0; offset < rows.length - CSV_FIRST_DATA_ROW; offset++) {
      const row = rows[CSV_FIRST_DATA_ROW + offset];
      if (!row) continue;
      const hasAny = Object.keys(CSV_COLUMNS).some((idx) => csvCell(row, idx));
      if (!hasAny) continue;

      const task = {};
      for (const [idx, key] of Object.entries(CSV_COLUMNS)) {
        task[key] = csvCell(row, idx);
      }
      // O CSV ao vivo (gviz) descarta a linha 1, em branco, da planilha —
      // por isso a linha real é uma posição maior do que o índice no CSV.
      task.linha = CSV_FIRST_DATA_ROW + offset + 2;
      task.data_inicio = parseDateBR(task.data_inicio);
      task.data_fim = parseDateBR(task.data_fim);
      task.duracao = parseDuracao(task.duracao);
      task.areas = Object.entries(CSV_AREA_COLUMNS)
        .filter(([idx]) => csvCell(row, idx))
        .map(([, name]) => name);

      tasks.push(task);
    }
    return tasks;
  }

  async function loadPayload() {
    try {
      const res = await fetch(LIVE_CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const tasks = buildTasksFromCsv(parseCsv(text));
      if (tasks.length === 0) throw new Error("nenhuma tarefa retornada");
      return {
        generated_at: new Date().toISOString(),
        sheet_url: SHEET_EDIT_URL,
        task_count: tasks.length,
        tasks,
        source: "live",
      };
    } catch (err) {
      console.warn("Não foi possível buscar dados ao vivo da planilha, usando snapshot estático:", err);
      const res = await fetch(FALLBACK_DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      payload.source = "fallback";
      return payload;
    }
  }

  // Resumo no topo da aba Status Report — % de tarefas por estágio.
  const STATUS_OVERVIEW_STAGES = [
    { key: "feito", label: "Concluídas", color: "--stage-feito" },
    { key: "andamento", label: "Em andamento", color: "--stage-andamento" },
    { key: "iniciar", label: "A iniciar", color: "--stage-iniciar" },
    { key: "atrasado", label: "Atrasadas", color: "--stage-atrasado" },
    { key: "risco", label: "Risco de atraso", color: "--stage-risco" },
    { key: "definir", label: "Definir datas", color: "--stage-definir" },
  ];

  // Estágios do STATUS (coluna I da planilha) — cor das barras do Gantt.
  const STAGE_LEGEND = [
    { key: "feito", label: "Feito", color: "--stage-feito" },
    { key: "andamento", label: "Em andamento", color: "--stage-andamento" },
    { key: "risco", label: "Risco de atraso", color: "--stage-risco" },
    { key: "atrasado", label: "Atrasado", color: "--stage-atrasado" },
    { key: "iniciar", label: "A iniciar", color: "--stage-iniciar" },
    { key: "definir", label: "Definir datas", color: "--stage-definir" },
    { key: "cancelado", label: "Cancelado", color: "--stage-cancelado" },
    { key: "congelado", label: "Cancelado/Congelado", color: "--stage-congelado" },
  ];

  function stageKeyFor(status) {
    const s = (status || "").toLowerCase();
    if (s.includes("congelado")) return "congelado";
    if (s.includes("cancelado")) return "cancelado";
    if (s.includes("feito") || s.includes("conclu")) return "feito";
    if (s.includes("atras")) return "atrasado";
    if (s.includes("risco") || s.includes("alerta") || s.includes("atenção")) return "risco";
    if (s.includes("andamento") || s.includes("execu")) return "andamento";
    if (s.includes("definir")) return "definir";
    if (s.includes("iniciar")) return "iniciar";
    return "iniciar";
  }

  function stageColorVar(status) {
    const found = STAGE_LEGEND.find((s) => s.key === stageKeyFor(status));
    return found ? found.color : "--stage-iniciar";
  }

  // Prioridade de destaque para o selo do eixo: o pior/mais urgente status
  // presente entre suas tarefas "vence" e define a cor do selo.
  const STAGE_PRIORITY = ["atrasado", "risco", "andamento", "iniciar", "definir", "congelado", "cancelado", "feito"];
  function eixoStageColorVar(tasks) {
    const present = new Set(tasks.map((t) => stageKeyFor(t.status)));
    for (const key of STAGE_PRIORITY) {
      if (present.has(key)) {
        const found = STAGE_LEGEND.find((s) => s.key === key);
        return found.color;
      }
    }
    return "--stage-iniciar";
  }

  const ganttOpenState = new Set();
  let lastGanttTasks = [];
  let lastGanttEixoNames = null;
  let ganttViewMode = "monthly";

  const EIXO_ORDER_COLOR = [
    ["GESTÃO DO PROJETO", "--series-1"],
    ["INSTITUCIONAL", "--series-2"],
    ["PESQUISA E CURADORIA", "--series-3"],
    ["ARQUITETURA (PLANO DE OCUPAÇÃO E FLUXOS)", "--series-4"],
    ["EXPOGRAFIA E CONTEÚDO APLICADO", "--series-5"],
    ["PROJETOS COMPLEMENTARES", "--series-6"],
    ["IDENTIDADE VISUAL E BRANDING", "--series-7"],
    ["PLANO DE GESTÃO, GOVERNANÇA E SUSTENTABILIDADE", "--series-8"],
  ];

  const root = document.documentElement;
  function eixoColorVar(eixo) {
    const found = EIXO_ORDER_COLOR.find(([name]) => name === eixo);
    return found ? found[1] : "--series-other";
  }
  function cssVar(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function taskLabel(task) {
    return task.tarefa || "(tarefa a definir)";
  }

  function fmtDateBR(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  function eixoDisplayOrder(eixoNames) {
    const known = EIXO_ORDER_COLOR.map(([name]) => name).filter((n) => eixoNames.has(n));
    const unknown = [...eixoNames].filter((n) => !known.includes(n)).sort();
    return [...known, ...unknown];
  }

  function renderDataQualityAlert(allTasks, sheetUrl) {
    const alertEl = document.getElementById("dq-alert");
    const bar = document.getElementById("dq-alert-bar");
    const summaryEl = document.getElementById("dq-alert-summary");
    const linkEl = document.getElementById("dq-alert-link");
    const detailEl = document.getElementById("dq-alert-detail");
    const rowsEl = document.getElementById("dq-alert-rows");

    const problems = allTasks.filter((t) => !t.eixo && t.tarefa);
    if (problems.length === 0) {
      alertEl.hidden = true;
      return;
    }

    alertEl.hidden = false;
    summaryEl.textContent = `${problems.length} tarefa(s) com campos obrigatórios vazios. Clique aqui para ver detalhes`;
    linkEl.href = sheetUrl || "#";

    rowsEl.innerHTML = problems
      .map((t) => {
        const missing = [];
        if (!t.eixo) missing.push("B (Eixo)");
        if (!t.grupo) missing.push("C (Grupo)");
        if (!t.marco) missing.push("D (Marco)");
        return `
          <div class="dq-alert-row">
            <span>${t.linha ?? "—"}</span>
            <span class="dq-alert-muted">${t.eixo ? escapeHtml(t.eixo) : "—"}</span>
            <span class="dq-alert-muted">${t.grupo ? escapeHtml(t.grupo) : "—"}</span>
            <span>${escapeHtml(t.tarefa)}</span>
            <span class="dq-alert-missing">${missing.join(", ")}</span>
          </div>
        `;
      })
      .join("");

    let isOpen = false;
    bar.onclick = (e) => {
      if (e.target === linkEl) return;
      isOpen = !isOpen;
      detailEl.hidden = !isOpen;
      bar.classList.toggle("is-open", isOpen);
    };
  }

  function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".tab-panel");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
        panels.forEach((p) => {
          p.hidden = p.dataset.tabPanel !== target;
        });
      });
    });
  }

  async function main() {
    setupTabs();
    setupGanttTools();
    setupStatusTools();
    const stateEl = document.getElementById("app-state");
    let payload;
    try {
      payload = await loadPayload();
    } catch (err) {
      stateEl.textContent = `Não foi possível carregar os dados. Detalhe: ${err.message}`;
      return;
    }

    const tasks = payload.tasks || [];
    render(payload, tasks);
  }

  function render(payload, allTasks) {
    document.getElementById("app-state").remove();

    const generated = new Date(payload.generated_at);
    const generatedText = isNaN(generated)
      ? "—"
      : generated.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    document.getElementById("generated-at").textContent =
      payload.source === "fallback" ? `${generatedText} (offline, dados de backup)` : `${generatedText} (ao vivo)`;

    renderDataQualityAlert(allTasks, payload.sheet_url);

    const withDates = allTasks.filter((t) => t.data_inicio && t.data_fim);
    const withoutDates = allTasks.filter((t) => !(t.data_inicio && t.data_fim));

    let searchTerm = "";

    const stageLegendEl = document.getElementById("stage-legend");
    for (const stage of STAGE_LEGEND) {
      const item = document.createElement("span");
      item.className = "legend-item legend-item--static";
      item.innerHTML = `<span class="legend-dot" style="background:var(${stage.color})"></span>${escapeHtml(stage.label)}`;
      stageLegendEl.appendChild(item);
    }

    const statusStageLegendEl = document.getElementById("status-stage-legend");
    for (const stage of STAGE_LEGEND) {
      const item = document.createElement("span");
      item.className = "legend-item legend-item--static";
      item.innerHTML = `<span class="legend-dot" style="background:var(${stage.color})"></span>${escapeHtml(stage.label)}`;
      statusStageLegendEl.appendChild(item);
    }

    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", () => {
      searchTerm = searchInput.value.trim().toLowerCase();
      applyFilters();
    });

    function matches(task) {
      if (!searchTerm) return true;
      const hay = `${task.tarefa} ${task.responsavel} ${task.grupo} ${task.marco} ${task.eixo}`.toLowerCase();
      return hay.includes(searchTerm);
    }

    function applyFilters() {
      const matchedAll = allTasks.filter(matches);
      const eixoNames = new Set(matchedAll.map((t) => t.eixo || "Sem eixo definido"));
      renderGantt(matchedAll, eixoNames);
      renderWaitingList(matchedAll, eixoNames, payload.sheet_url);
    }

    applyFilters();
    initTooltip();

    renderStatusReport(allTasks);

    let statusSearchTerm = "";
    const statusSearchInput = document.getElementById("status-search-input");
    statusSearchInput.addEventListener("input", () => {
      statusSearchTerm = statusSearchInput.value.trim().toLowerCase();
      applyStatusFilters();
    });

    function statusMatches(task) {
      if (!statusSearchTerm) return true;
      const hay = `${task.tarefa} ${task.responsavel} ${task.grupo} ${task.marco} ${task.eixo}`.toLowerCase();
      return hay.includes(statusSearchTerm);
    }

    function applyStatusFilters() {
      const matchedAll = allTasks.filter(statusMatches);
      const eixoNames = new Set(matchedAll.map((t) => t.eixo || "Sem eixo definido"));
      renderStatusTree(matchedAll, eixoNames);
    }

    applyStatusFilters();

    setupVendorTab({
      field: "fornecedor",
      tasks: allTasks,
      prefix: "fornecedores",
      singular: "fornecedor",
      plural: "fornecedores",
      title: "Fornecedores",
    });
    setupVendorTab({
      field: "responsavel",
      tasks: allTasks,
      prefix: "responsaveis",
      singular: "responsável",
      plural: "responsáveis",
      title: "Responsáveis",
    });
  }

  function renderStatusReport(allTasks) {
    const summaryEl = document.getElementById("status-summary-row");
    summaryEl.innerHTML = "";

    const total = allTasks.length;
    const stageCounts = Object.fromEntries(STATUS_OVERVIEW_STAGES.map((s) => [s.key, 0]));
    for (const task of allTasks) {
      const key = stageKeyFor(task.status);
      if (key in stageCounts) stageCounts[key]++;
    }
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

    const marcos = new Map();
    for (const task of allTasks) {
      const marco = (task.marco || "").trim();
      if (!marco) continue;
      if (!marcos.has(marco)) marcos.set(marco, []);
      marcos.get(marco).push(task);
    }
    let marcosDone = 0;
    for (const tasks of marcos.values()) {
      if (tasks.every((t) => stageKeyFor(t.status) === "feito")) marcosDone++;
    }
    const marcosTotal = marcos.size;
    const marcosPct = marcosTotal ? Math.round((marcosDone / marcosTotal) * 100) : 0;

    const ringRadius = 40;
    const ringCirc = 2 * Math.PI * ringRadius;
    const ringOffset = ringCirc * (1 - marcosPct / 100);

    // Maiores fatias primeiro, para a barra (esquerda→direita) e a legenda
    // (ordem de leitura) apontarem sempre para o mesmo segmento.
    const orderedStages = [...STATUS_OVERVIEW_STAGES].sort((a, b) => stageCounts[b.key] - stageCounts[a.key]);

    const card = document.createElement("div");
    card.className = "status-overview-card";
    card.innerHTML = `
      <svg class="status-ring" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${marcosPct}% dos marcos concluídos">
        <circle cx="48" cy="48" r="${ringRadius}" fill="none" stroke="var(--gridline)" stroke-width="12"/>
        <circle cx="48" cy="48" r="${ringRadius}" fill="none" stroke="var(--brand-green)" stroke-width="12"
          stroke-dasharray="${ringCirc.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 48 48)"/>
        <text x="48" y="46" text-anchor="middle" class="status-ring-value">${marcosPct}%</text>
        <text x="48" y="62" text-anchor="middle" class="status-ring-sub">${marcosDone} de ${marcosTotal}</text>
      </svg>
      <div class="status-overview-body">
        <div class="status-overview-label">Marcos concluídos · distribuição de tarefas por status</div>
        <div class="status-stage-bar">
          ${orderedStages.map((s) => {
            const count = stageCounts[s.key];
            const width = count > 0 ? Math.max(pct(count), 0.6) : 0;
            return `<span style="width:${width}%;background:var(${s.color})" title="${escapeHtml(s.label)}: ${count} (${pct(count)}%)"></span>`;
          }).join("")}
        </div>
        <div class="status-stage-legend-row">
          ${orderedStages.map((s) => `
            <span class="status-stage-legend-item">
              <span class="dot" style="background:var(${s.color})"></span>${escapeHtml(s.label)} <b>${pct(stageCounts[s.key])}%</b>
            </span>
          `).join("")}
        </div>
      </div>
    `;
    summaryEl.appendChild(card);
  }

  // Árvore expansível da aba Status Report (Eixo > Grupo > Marco > Tarefa),
  // separada do estado de expansão do Gantt (mesma hierarquia, visual diferente).
  const statusOpenState = new Set();
  const statusTaskOpenState = new Set();
  let lastStatusTasks = [];
  let lastStatusEixoNames = null;

  function toggleStatusNode(key) {
    if (statusOpenState.has(key)) statusOpenState.delete(key); else statusOpenState.add(key);
    renderStatusTree(lastStatusTasks, lastStatusEixoNames);
  }

  function toggleStatusTaskDetail(key) {
    if (statusTaskOpenState.has(key)) statusTaskOpenState.delete(key); else statusTaskOpenState.add(key);
    renderStatusTree(lastStatusTasks, lastStatusEixoNames);
  }

  function collapseAllStatus() {
    statusOpenState.clear();
    renderStatusTree(lastStatusTasks, lastStatusEixoNames);
  }

  function worstStage(tasks) {
    const present = new Set(tasks.map((t) => stageKeyFor(t.status)));
    for (const key of STAGE_PRIORITY) {
      const found = STAGE_LEGEND.find((s) => s.key === key);
      if (found && present.has(key)) return found;
    }
    return null;
  }

  function statusPillHtml(stage) {
    if (!stage) return "";
    const textColor = stage.key === "risco" ? "#2b2100" : "#ffffff";
    return `<span class="status-pill" style="background:var(${stage.color});color:${textColor}">${escapeHtml(stage.label)}</span>`;
  }

  const ICON_CALENDAR = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
  const ICON_PERSON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/></svg>';
  const ICON_TAG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 2h6l6 6-6 6-6-6V2z"/><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none"/></svg>';

  function statusDetailField(label, value) {
    const has = value && String(value).trim();
    return `
      <div class="status-detail-field">
        <div class="status-detail-label">${escapeHtml(label)}</div>
        <div class="status-detail-value${has ? "" : " is-empty"}">${has ? escapeHtml(value) : "Não preenchido"}</div>
      </div>
    `;
  }

  function renderStatusTaskRow(task, depth, container, keyPrefix) {
    const key = `${keyPrefix}>t:${task.tarefa}:${task.data_inicio}`;
    const isOpen = statusTaskOpenState.has(key);
    const stage = STAGE_LEGEND.find((s) => s.key === stageKeyFor(task.status));
    const missingLabel = !task.grupo ? "Sem grupo/marco" : !task.marco ? "Sem marco" : "";

    const row = document.createElement("div");
    row.className = `status-row status-row--task${task.tarefa ? "" : " is-placeholder"}`;
    row.style.paddingLeft = `${16 + depth * 18}px`;
    row.innerHTML = `
      <span class="status-row-top">
        <span class="tree-toggle ${isOpen ? "is-open" : ""}"></span>
        <span class="status-checkbox"></span>
        ${statusPillHtml(stage)}
        <span class="status-row-name">${escapeHtml(taskLabel(task))}</span>
        ${missingLabel ? `<span class="status-row-flag">${missingLabel}</span>` : ""}
      </span>
      <span class="status-row-meta">
        ${task.data_inicio || task.data_fim ? `<span class="status-row-meta-item">${ICON_CALENDAR}${fmtTaskRange(task)}</span>` : ""}
        ${task.responsavel ? `<span class="status-row-meta-item">${ICON_PERSON}${escapeHtml(task.responsavel)}</span>` : ""}
        ${task.fornecedor ? `<span class="status-row-chip status-row-chip--fornecedor">${ICON_TAG}${escapeHtml(task.fornecedor)}</span>` : ""}
      </span>
    `;
    row.addEventListener("click", () => toggleStatusTaskDetail(key));
    container.appendChild(row);

    if (isOpen) {
      const detail = document.createElement("div");
      detail.className = "status-detail";
      detail.style.paddingLeft = `${16 + depth * 18 + 22}px`;
      detail.innerHTML = [
        statusDetailField("Prioridade", task.prioridade),
        statusDetailField("Complexidade", task.complexidade),
        statusDetailField("Progresso", task.progresso),
        statusDetailField("Impacto", task.impacto),
        statusDetailField("Encaminhamentos", task.encaminhamentos),
      ].join("");
      container.appendChild(detail);
    }
  }

  function renderStatusChildren(container, nodes, depth, keyPrefix, eixoIndex) {
    let grupoCounter = 0;
    for (const node of nodes) {
      if (node.type === "task") {
        renderStatusTaskRow(node.task, depth, container, keyPrefix);
        continue;
      }

      const isOpen = statusOpenState.has(node.key);
      const hasChildren = node.children.length > 0;
      const leafTasks = collectLeafTasks(node.children);
      const stage = leafTasks.length
        ? worstStage(leafTasks)
        : node.self ? STAGE_LEGEND.find((s) => s.key === stageKeyFor(node.self.status)) : null;
      const range = node.self && node.self.data_inicio && node.self.data_fim
        ? { data_fim: node.self.data_fim }
        : minMaxDates(leafTasks);

      const row = document.createElement("div");
      row.style.paddingLeft = `${16 + depth * 18}px`;

      if (node.type === "grupo") {
        grupoCounter++;
        const marcoCount = node.children.filter((c) => c.type === "marco").length;
        const countLabel = marcoCount ? `${marcoCount} marco(s)` : hasChildren ? `${node.children.length} tarefa(s)` : "sem marcos";
        row.className = "status-row status-row--grupo";
        row.innerHTML = `
          <span class="tree-toggle ${hasChildren ? (isOpen ? "is-open" : "") : "tree-toggle--spacer"}">▸</span>
          <span class="status-checkbox"></span>
          <span class="status-row-dot" style="background:var(${stage ? stage.color : "--status-neutral"})"></span>
          <span class="status-row-number">#${eixoIndex}.${grupoCounter}</span>
          <span class="status-row-name">${escapeHtml(node.name)}</span>
          <span class="status-row-meta">
            ${range.data_fim ? `<span class="status-row-dates">até ${fmtDateBR(range.data_fim)}</span>` : ""}
            ${statusPillHtml(stage)}
            <span class="status-count-btn">▸ ${countLabel}</span>
          </span>
        `;
      } else {
        row.className = `status-row status-row--${node.type}`;
        row.innerHTML = `
          <span class="tree-toggle ${hasChildren ? (isOpen ? "is-open" : "") : "tree-toggle--spacer"}">▸</span>
          <span class="status-checkbox"></span>
          ${statusPillHtml(stage)}
          <span class="status-row-name">${escapeHtml(node.name)}</span>
          <span class="status-row-meta">
            ${range.data_fim ? `<span class="status-row-dates">até ${fmtDateBR(range.data_fim)}</span>` : ""}
          </span>
        `;
      }

      if (hasChildren) row.addEventListener("click", () => toggleStatusNode(node.key));
      container.appendChild(row);

      if (isOpen && hasChildren) {
        renderStatusChildren(container, node.children, depth + 1, node.key, eixoIndex);
      }
    }
  }

  function renderStatusTree(tasks, eixoNames) {
    lastStatusTasks = tasks;
    lastStatusEixoNames = eixoNames || null;
    const container = document.getElementById("status-tree");
    const metaEl = document.getElementById("status-report-meta");
    container.innerHTML = "";

    const tree = buildGanttTree(tasks, eixoNames);
    const grupoTotal = tree.reduce((sum, e) => sum + e.children.filter((c) => c.type === "grupo").length, 0);
    metaEl.textContent = `Exibindo ${tasks.length} tarefa(s) · ${tree.length} eixo(s) · ${grupoTotal} grupo(s)`;

    if (tree.length === 0) {
      container.innerHTML = '<p class="empty-note">Nenhuma tarefa corresponde ao filtro atual.</p>';
      return;
    }

    tree.forEach((eixoNode, index) => {
      const isOpen = statusOpenState.has(eixoNode.key);
      const hasContent = eixoNode.children.length > 0;
      const grupoCount = eixoNode.children.filter((c) => c.type === "grupo").length;
      const countLabel = grupoCount > 0
        ? `${grupoCount} grupo(s)`
        : hasContent ? `${eixoNode.children.length} tarefa(s)` : "sem tarefas cadastradas";
      const badgeColor = eixoStageColorVar(collectLeafTasks(eixoNode.children));

      const wrap = document.createElement("div");
      wrap.className = "status-eixo-group";

      const head = document.createElement("div");
      head.className = `status-eixo-head${hasContent ? "" : " is-empty"}`;
      head.innerHTML = `<span class="tree-toggle ${isOpen ? "is-open" : ""}">▸</span><span class="eixo-badge" style="background:var(${badgeColor})">${index + 1}</span><span class="status-row-name">${escapeHtml(eixoNode.name)}</span><span class="eixo-count">${countLabel}</span>`;
      head.addEventListener("click", () => toggleStatusNode(eixoNode.key));
      wrap.appendChild(head);

      if (isOpen && hasContent) {
        const body = document.createElement("div");
        body.className = "status-eixo-body";
        renderStatusChildren(body, eixoNode.children, 1, eixoNode.key, index + 1);
        wrap.appendChild(body);
      }
      container.appendChild(wrap);
    });
  }

  function setupStatusTools() {
    document.getElementById("status-collapse-all-btn").addEventListener("click", collapseAllStatus);
  }

  function fmtTaskRange(task) {
    if (!task.data_inicio && !task.data_fim) return "Sem data definida";
    return `${fmtDateBR(task.data_inicio)} – ${fmtDateBR(task.data_fim)}`;
  }

  function buildGroups(tasks, field) {
    const grouped = groupBy(
      tasks.filter((t) => (t[field] || "").trim()),
      (t) => t[field].trim()
    );
    return [...grouped.entries()]
      .map(([name, groupTasks]) => ({ name, tasks: groupTasks }))
      .sort((a, b) => {
        const atrasadasA = a.tasks.filter((t) => stageKeyFor(t.status) === "atrasado").length;
        const atrasadasB = b.tasks.filter((t) => stageKeyFor(t.status) === "atrasado").length;
        if (atrasadasB !== atrasadasA) return atrasadasB - atrasadasA;
        if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
        return a.name.localeCompare(b.name, "pt-BR");
      });
  }

  function fmtBreadcrumb(task) {
    return [task.eixo, task.grupo, task.marco]
      .map((v) => (v || "").trim())
      .filter(Boolean)
      .join(" · ");
  }

  const VENDOR_PREVIEW_LIMIT = 4;

  function buildExportModal({ prefix, title, plural, allGroups, onGenerate }) {
    const overlay = document.createElement("div");
    overlay.className = "export-modal-overlay";
    overlay.id = `${prefix}-export-modal`;
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="export-modal">
        <div class="export-modal-header">
          <h3>Exportar PDF — ${escapeHtml(title)}</h3>
          <button type="button" class="export-modal-close" aria-label="Fechar">×</button>
        </div>
        <div class="export-modal-body">
          <div class="export-modal-sub">Selecione os ${escapeHtml(plural)} (<span class="export-modal-selected-count">0</span> selecionados):</div>
          <div class="export-modal-actions">
            <button type="button" class="pill-toggle-btn export-select-all">Selecionar todos</button>
            <button type="button" class="pill-toggle-btn export-select-none">Limpar</button>
          </div>
          <div class="export-modal-grid"></div>
        </div>
        <div class="export-modal-footer">
          <button type="button" class="export-generate-btn" disabled>Gerar PDF ↓</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const grid = overlay.querySelector(".export-modal-grid");
    const countEl = overlay.querySelector(".export-modal-selected-count");
    const generateBtn = overlay.querySelector(".export-generate-btn");

    for (const group of allGroups) {
      const atrasadasN = group.tasks.filter((t) => stageKeyFor(t.status) === "atrasado").length;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "export-modal-item";
      item.dataset.name = group.name;
      item.innerHTML = `${escapeHtml(group.name)} <span class="export-modal-item-count">(${group.tasks.length}${atrasadasN ? ` · ${atrasadasN} atrasada${atrasadasN > 1 ? "s" : ""}` : ""})</span>`;
      grid.appendChild(item);
    }

    function updateCount() {
      const n = grid.querySelectorAll(".export-modal-item.is-selected").length;
      countEl.textContent = n;
      generateBtn.disabled = n === 0;
    }

    grid.addEventListener("click", (e) => {
      const item = e.target.closest(".export-modal-item");
      if (!item) return;
      item.classList.toggle("is-selected");
      updateCount();
    });

    overlay.querySelector(".export-select-all").addEventListener("click", () => {
      grid.querySelectorAll(".export-modal-item").forEach((item) => item.classList.add("is-selected"));
      updateCount();
    });
    overlay.querySelector(".export-select-none").addEventListener("click", () => {
      grid.querySelectorAll(".export-modal-item").forEach((item) => item.classList.remove("is-selected"));
      updateCount();
    });

    function close() {
      overlay.hidden = true;
    }

    overlay.querySelector(".export-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    generateBtn.addEventListener("click", () => {
      const selected = [...grid.querySelectorAll(".export-modal-item.is-selected")].map((el) => el.dataset.name);
      if (selected.length === 0) return;
      close();
      onGenerate(new Set(selected));
    });

    return {
      open() {
        overlay.hidden = false;
      },
    };
  }

  function setupVendorTab({ field, tasks, prefix, singular, plural, title }) {
    const searchInput = document.getElementById(`${prefix}-search`);
    const listEl = document.getElementById(`${prefix}-list`);
    const metaEl = document.getElementById(`${prefix}-meta`);
    const summaryEl = document.getElementById(`${prefix}-summary`);
    const legendEl = document.getElementById(`${prefix}-stage-legend`);
    const expandAllBtn = document.getElementById(`${prefix}-expand-all-btn`);
    const collapseAllBtn = document.getElementById(`${prefix}-collapse-all-btn`);
    const exportBtn = document.getElementById(`${prefix}-export-btn`);
    const allGroups = buildGroups(tasks, field);

    for (const stage of STAGE_LEGEND) {
      const item = document.createElement("span");
      item.className = "legend-item legend-item--static";
      item.innerHTML = `<span class="legend-dot" style="background:var(${stage.color})"></span>${escapeHtml(stage.label)}`;
      legendEl.appendChild(item);
    }

    const collapsedCards = new Set();
    const expandedCards = new Set();
    let showAllItems = false;

    function renderSummary() {
      const withField = tasks.filter((t) => (t[field] || "").trim());
      const withoutCount = tasks.length - withField.length;
      const atrasadas = tasks.filter((t) => stageKeyFor(t.status) === "atrasado");
      const atrasadasPct = tasks.length ? Math.round((atrasadas.length / tasks.length) * 100) : 0;

      let criticalName = "—";
      let criticalCount = -1;
      let volumeName = "—";
      let volumeCount = -1;
      for (const group of allGroups) {
        const atrasadasN = group.tasks.filter((t) => stageKeyFor(t.status) === "atrasado").length;
        if (atrasadasN > criticalCount) { criticalCount = atrasadasN; criticalName = group.name; }
        if (group.tasks.length > volumeCount) { volumeCount = group.tasks.length; volumeName = group.name; }
      }

      summaryEl.innerHTML = `
        <div class="vendor-stat-card">
          <div class="vendor-stat-label">${escapeHtml(plural)} ativos</div>
          <div class="vendor-stat-value">${allGroups.length}</div>
          <div class="vendor-stat-sub">${withoutCount ? `+${withoutCount} sem ${escapeHtml(singular)}` : "todas as tarefas atribuídas"}</div>
        </div>
        <div class="vendor-stat-card">
          <div class="vendor-stat-label">Tarefas atrasadas</div>
          <div class="vendor-stat-value vendor-stat-value--danger">${atrasadas.length}</div>
          <div class="vendor-stat-sub">${atrasadasPct}% do total de ${tasks.length} tarefas</div>
        </div>
        <div class="vendor-stat-card">
          <div class="vendor-stat-label">${escapeHtml(singular)} mais crítico</div>
          <div class="vendor-stat-value vendor-stat-value--name">${escapeHtml(criticalName)}</div>
          <div class="vendor-stat-sub">${Math.max(criticalCount, 0)} tarefa(s) atrasada(s)</div>
        </div>
        <div class="vendor-stat-card">
          <div class="vendor-stat-label">Maior volume</div>
          <div class="vendor-stat-value vendor-stat-value--name">${escapeHtml(volumeName)}</div>
          <div class="vendor-stat-sub">${Math.max(volumeCount, 0)} tarefa(s) no cronograma</div>
        </div>
      `;
    }

    function renderCard(group) {
      const counts = {};
      for (const stage of STAGE_LEGEND) counts[stage.key] = 0;
      for (const task of group.tasks) {
        const key = stageKeyFor(task.status);
        if (key in counts) counts[key]++;
      }
      const total = group.tasks.length;
      const atrasadasCount = counts.atrasado || 0;
      const orderedStages = STAGE_LEGEND.filter((s) => counts[s.key] > 0)
        .sort((a, b) => counts[b.key] - counts[a.key]);

      const isOpen = !collapsedCards.has(group.name);
      const showAll = showAllItems || expandedCards.has(group.name);
      const visibleTasks = showAll ? group.tasks : group.tasks.slice(0, VENDOR_PREVIEW_LIMIT);
      const remaining = group.tasks.length - visibleTasks.length;

      const card = document.createElement("div");
      card.className = "vendor-card";

      const head = document.createElement("div");
      head.className = "vendor-card-head";
      head.innerHTML = `
        <span class="tree-toggle ${isOpen ? "is-open" : ""}">▸</span>
        <span class="vendor-card-name">${escapeHtml(group.name)}</span>
        <span class="vendor-card-count">${total} tarefa(s) no cronograma</span>
        ${atrasadasCount ? `<span class="vendor-card-badge">${atrasadasCount} atrasada${atrasadasCount > 1 ? "s" : ""}</span>` : ""}
      `;
      head.addEventListener("click", () => {
        if (isOpen) collapsedCards.add(group.name); else collapsedCards.delete(group.name);
        renderList();
      });
      card.appendChild(head);

      if (isOpen) {
        const bar = document.createElement("div");
        bar.className = "vendor-card-bar";
        bar.innerHTML = orderedStages.map((s) => {
          const width = Math.max((counts[s.key] / total) * 100, 0.6);
          return `<span style="width:${width}%;background:var(${s.color})" title="${escapeHtml(s.label)}: ${counts[s.key]}"></span>`;
        }).join("");
        card.appendChild(bar);

        const list = document.createElement("div");
        list.className = "vendor-task-list";
        list.innerHTML = visibleTasks.map((task) => {
          const stage = STAGE_LEGEND.find((s) => s.key === stageKeyFor(task.status));
          const crumb = fmtBreadcrumb(task);
          return `
            <div class="vendor-task-row">
              ${crumb ? `<div class="vendor-task-crumb">${escapeHtml(crumb)}</div>` : ""}
              <div class="vendor-task-top">
                <span class="vendor-task-name">${escapeHtml(taskLabel(task))}</span>
                ${statusPillHtml(stage)}
              </div>
              <div class="vendor-task-meta">
                ${task.responsavel && field !== "responsavel" ? `<span class="status-row-meta-item">${ICON_PERSON}${escapeHtml(task.responsavel)}</span>` : ""}
                ${task.fornecedor && field !== "fornecedor" ? `<span class="status-row-meta-item">${ICON_TAG}${escapeHtml(task.fornecedor)}</span>` : ""}
                ${task.data_inicio || task.data_fim ? `<span class="status-row-meta-item">${ICON_CALENDAR}${fmtTaskRange(task)}</span>` : ""}
              </div>
            </div>
          `;
        }).join("");
        card.appendChild(list);

        if (remaining > 0) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "vendor-more-btn";
          more.textContent = `Ver todas (${remaining} mais)`;
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            expandedCards.add(group.name);
            renderList();
          });
          card.appendChild(more);
        }
      }

      return card;
    }

    function renderList() {
      const term = searchInput.value.trim().toLowerCase();
      const groups = term
        ? allGroups
            .map((g) => ({
              name: g.name,
              tasks: g.tasks.filter((t) =>
                `${g.name} ${taskLabel(t)} ${fmtBreadcrumb(t)} ${t.responsavel} ${t.fornecedor}`
                  .toLowerCase()
                  .includes(term)
              ),
            }))
            .filter((g) => g.tasks.length > 0)
        : allGroups;

      metaEl.textContent = `Exibindo ${term ? groups.length : "todos os"} ${plural}`;
      listEl.innerHTML = "";

      if (groups.length === 0) {
        listEl.innerHTML = `<p class="empty-note">Nenhum ${escapeHtml(singular)} corresponde ao filtro atual.</p>`;
        return;
      }

      const frag = document.createDocumentFragment();
      for (const group of groups) frag.appendChild(renderCard(group));
      listEl.appendChild(frag);
    }

    searchInput.addEventListener("input", renderList);
    expandAllBtn.addEventListener("click", () => {
      showAllItems = !showAllItems;
      expandAllBtn.classList.toggle("is-active", showAllItems);
      renderList();
    });
    collapseAllBtn.addEventListener("click", () => {
      for (const group of allGroups) collapsedCards.add(group.name);
      renderList();
    });

    function printSelectedGroups(selectedNames) {
      const groups = allGroups.filter((g) => selectedNames.has(g.name));
      const wasShowAll = showAllItems;
      const wasCollapsed = new Set(collapsedCards);
      showAllItems = true;
      collapsedCards.clear();

      const frag = document.createDocumentFragment();
      for (const group of groups) frag.appendChild(renderCard(group));
      listEl.innerHTML = "";
      listEl.appendChild(frag);

      window.print();

      showAllItems = wasShowAll;
      collapsedCards.clear();
      for (const name of wasCollapsed) collapsedCards.add(name);
      renderList();
    }

    const exportModal = buildExportModal({ prefix, title, plural, allGroups, onGenerate: printSelectedGroups });
    exportBtn.addEventListener("click", () => exportModal.open());

    renderSummary();
    renderList();
  }

  // Constrói, a partir da lista plana de tarefas (com datas), a árvore
  // Eixo > Grupo > Marco > Tarefa. Cada nível é inferido pelo padrão da
  // planilha: uma linha "grupo"/"marco" em branco com `tarefa` igual ao
  // nome referenciado pelas linhas filhas é o próprio nó de rollup.
  function minMaxDates(tasks) {
    const starts = tasks.map((t) => t.data_inicio).filter(Boolean).sort();
    const ends = tasks.map((t) => t.data_fim).filter(Boolean).sort();
    return { data_inicio: starts[0] || null, data_fim: ends[ends.length - 1] || null };
  }

  function collectLeafTasks(nodes) {
    const out = [];
    for (const node of nodes) {
      if (node.type === "task") out.push(node.task);
      else out.push(...collectLeafTasks(node.children));
    }
    return out;
  }

  function buildLevel(rows, levelField, parentKey) {
    const groupNames = new Set(rows.map((t) => t[levelField]).filter(Boolean));
    const directRows = rows.filter((t) => !t[levelField]);
    const nodes = [];
    const selfRowsByName = new Map();

    for (const row of directRows) {
      if (groupNames.has(row.tarefa) && !selfRowsByName.has(row.tarefa)) {
        selfRowsByName.set(row.tarefa, row);
        continue;
      }
      nodes.push({ type: "task", key: `${parentKey}>t:${row.tarefa}:${row.data_inicio}:${nodes.length}`, task: row });
    }

    for (const name of groupNames) {
      const selfRow = selfRowsByName.get(name) || null;
      const childRows = rows.filter((t) => t[levelField] === name);
      const nodeType = levelField === "grupo" ? "grupo" : "marco";
      const key = `${parentKey}>${nodeType[0]}:${name}`;
      const children = levelField === "grupo"
        ? buildLevel(childRows, "marco", key)
        : childRows.map((t) => ({ type: "task", key: `${key}>t:${t.tarefa}:${t.data_inicio}`, task: t }));
      const range = selfRow && selfRow.data_inicio && selfRow.data_fim
        ? { data_inicio: selfRow.data_inicio, data_fim: selfRow.data_fim }
        : minMaxDates(collectLeafTasks(children));
      nodes.push({ type: nodeType, key, name, self: selfRow, range, children });
    }
    return nodes;
  }

  function buildGanttTree(tasks, eixoNames) {
    const byEixo = groupBy(tasks, (t) => t.eixo || "Sem eixo definido");
    const allNames = eixoNames && eixoNames.size ? eixoNames : new Set(byEixo.keys());
    const order = eixoDisplayOrder(allNames);
    return order.map((eixo) => {
      const rawEixoTasks = byEixo.get(eixo) || [];
      const key = `e:${eixo}`;
      // A linha "resumo" do eixo (grupo/marco em branco, tarefa == nome do eixo)
      // representa o próprio eixo, não uma tarefa filha — não deve duplicar o nome.
      let selfRow = null;
      const eixoTasks = [];
      for (const row of rawEixoTasks) {
        if (!selfRow && !row.grupo && !row.marco && row.tarefa === eixo) {
          selfRow = row;
          continue;
        }
        eixoTasks.push(row);
      }
      return { type: "eixo", key, name: eixo, self: selfRow, children: buildLevel(eixoTasks, "grupo", key) };
    });
  }

  function toggleGanttNode(key) {
    if (ganttOpenState.has(key)) ganttOpenState.delete(key); else ganttOpenState.add(key);
    renderGantt(lastGanttTasks, lastGanttEixoNames);
  }

  function collectGanttKeysByDepth(tree) {
    const eixoKeys = [];
    const grupoKeys = [];
    const marcoKeys = [];
    function walk(nodes) {
      for (const node of nodes) {
        if (node.type === "task") continue;
        if (node.type === "grupo") grupoKeys.push(node.key);
        if (node.type === "marco") marcoKeys.push(node.key);
        walk(node.children);
      }
    }
    for (const eixoNode of tree) {
      eixoKeys.push(eixoNode.key);
      walk(eixoNode.children);
    }
    return { eixoKeys, grupoKeys, marcoKeys };
  }

  function setGanttViewLevel(level) {
    const tree = buildGanttTree(lastGanttTasks, lastGanttEixoNames);
    const { eixoKeys, grupoKeys, marcoKeys } = collectGanttKeysByDepth(tree);
    ganttOpenState.clear();
    if (level === "grupo" || level === "marco" || level === "tarefas") {
      eixoKeys.forEach((k) => ganttOpenState.add(k));
    }
    if (level === "marco" || level === "tarefas") {
      grupoKeys.forEach((k) => ganttOpenState.add(k));
    }
    if (level === "tarefas") {
      marcoKeys.forEach((k) => ganttOpenState.add(k));
    }
    renderGantt(lastGanttTasks, lastGanttEixoNames);
  }

  function collapseAllGantt() {
    ganttOpenState.clear();
    renderGantt(lastGanttTasks, lastGanttEixoNames);
  }

  function setupGanttTools() {
    const monthlyBtn = document.getElementById("view-monthly");
    const weeklyBtn = document.getElementById("view-weekly");
    monthlyBtn.addEventListener("click", () => {
      ganttViewMode = "monthly";
      monthlyBtn.classList.add("is-active");
      weeklyBtn.classList.remove("is-active");
      renderGantt(lastGanttTasks, lastGanttEixoNames);
    });
    weeklyBtn.addEventListener("click", () => {
      ganttViewMode = "weekly";
      weeklyBtn.classList.add("is-active");
      monthlyBtn.classList.remove("is-active");
      renderGantt(lastGanttTasks, lastGanttEixoNames);
    });

    const dropdown = document.getElementById("view-dropdown");
    const dropdownBtn = document.getElementById("view-dropdown-btn");
    const dropdownMenu = document.getElementById("view-dropdown-menu");
    const dropdownLabel = document.getElementById("view-dropdown-label");
    const levelLabels = { eixos: "Eixos", grupo: "Grupo", marco: "Marco", tarefas: "Tarefas" };
    dropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownMenu.hidden = !dropdownMenu.hidden;
    });
    dropdownMenu.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const level = btn.dataset.level;
        dropdownLabel.textContent = levelLabels[level];
        dropdownMenu.hidden = true;
        setGanttViewLevel(level);
      });
    });
    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target)) dropdownMenu.hidden = true;
    });

    document.getElementById("collapse-all-btn").addEventListener("click", collapseAllGantt);
  }

  function pseudoTaskFor(node, eixoName) {
    return node.self || {
      tarefa: node.name,
      eixo: eixoName,
      data_inicio: node.range.data_inicio,
      data_fim: node.range.data_fim,
      status: "",
    };
  }

  function renderTreeRow({ label, depth, hasChildren, isOpen, range, colorVar, dataTask, onToggle, rowClass }) {
    const row = document.createElement("div");
    row.className = `gantt-row ${rowClass}`;

    const name = document.createElement("div");
    name.className = "task-name tree-name";
    name.style.paddingLeft = `${14 + depth * 18}px`;
    const toggleHtml = hasChildren
      ? `<span class="tree-toggle ${isOpen ? "is-open" : ""}">▸</span>`
      : '<span class="tree-toggle tree-toggle--spacer"></span>';
    name.innerHTML = `${toggleHtml}<span class="tree-label">${escapeHtml(label)}</span>`;
    row.appendChild(name);

    const track = document.createElement("div");
    track.className = "bar-track";
    if (range.data_inicio && range.data_fim) {
      const left = range.left;
      const right = range.left + range.width;

      const startLabel = document.createElement("span");
      startLabel.className = "bar-date bar-date--start";
      startLabel.style.left = left + "%";
      startLabel.textContent = fmtDateBR(range.data_inicio);
      track.appendChild(startLabel);

      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.left = left + "%";
      bar.style.width = range.width + "%";
      bar.style.setProperty("--bar-color", `var(${colorVar})`);
      bar.dataset.task = JSON.stringify(dataTask);
      track.appendChild(bar);

      const endLabel = document.createElement("span");
      endLabel.className = "bar-date bar-date--end";
      endLabel.style.left = right + "%";
      endLabel.textContent = fmtDateBR(range.data_fim);
      track.appendChild(endLabel);
    }
    row.appendChild(track);

    if (hasChildren) {
      row.classList.add("is-toggleable");
      row.addEventListener("click", onToggle);
    }
    return row;
  }

  function renderGanttChildren(container, nodes, depth, eixoName, pct) {
    for (const node of nodes) {
      if (node.type === "task") {
        const left = pct(new Date(node.task.data_inicio));
        const width = Math.max(0.6, pct(new Date(node.task.data_fim)) - left);
        container.appendChild(renderTreeRow({
          label: taskLabel(node.task),
          depth,
          hasChildren: false,
          isOpen: false,
          range: { data_inicio: node.task.data_inicio, data_fim: node.task.data_fim, left, width },
          colorVar: stageColorVar(node.task.status),
          dataTask: node.task,
          rowClass: `gantt-row--task${node.task.tarefa ? "" : " is-placeholder"}`,
        }));
        continue;
      }

      const isOpen = ganttOpenState.has(node.key);
      const hasChildren = node.children.length > 0;
      let range = { data_inicio: node.range.data_inicio, data_fim: node.range.data_fim, left: 0, width: 0 };
      if (range.data_inicio && range.data_fim) {
        range.left = pct(new Date(range.data_inicio));
        range.width = Math.max(0.6, pct(new Date(range.data_fim)) - range.left);
      }
      const pseudoTask = pseudoTaskFor(node, eixoName);

      const wrap = document.createElement("div");
      wrap.className = `tree-branch tree-branch--${node.type}`;
      wrap.appendChild(renderTreeRow({
        label: node.name,
        depth,
        hasChildren,
        isOpen,
        range,
        colorVar: stageColorVar(pseudoTask.status),
        dataTask: pseudoTask,
        onToggle: () => toggleGanttNode(node.key),
        rowClass: `gantt-row--${node.type}`,
      }));

      if (isOpen && hasChildren) {
        renderGanttChildren(wrap, node.children, depth + 1, eixoName, pct);
      }
      container.appendChild(wrap);
    }
  }

  function renderGantt(tasks, eixoNames) {
    lastGanttTasks = tasks;
    lastGanttEixoNames = eixoNames || null;
    const container = document.getElementById("gantt-body");
    const monthsEl = document.getElementById("gantt-months");
    container.innerHTML = "";
    monthsEl.innerHTML = "";

    const hasEixoNames = eixoNames && eixoNames.size > 0;
    if (tasks.length === 0 && !hasEixoNames) {
      container.innerHTML = '<p class="empty-note">Nenhuma tarefa corresponde ao filtro atual.</p>';
      return;
    }

    const datedTasks = tasks.filter((t) => t.data_inicio && t.data_fim);
    let pct = () => 0;
    if (datedTasks.length > 0) {
      const starts = datedTasks.map((t) => new Date(t.data_inicio));
      const ends = datedTasks.map((t) => new Date(t.data_fim));
      let minDate = new Date(Math.min(...starts));
      let maxDate = new Date(Math.max(...ends));
      minDate.setDate(minDate.getDate() - 2);
      maxDate.setDate(maxDate.getDate() + 2);
      const totalDays = Math.max(1, (maxDate - minDate) / 86400000);
      pct = (date) => ((date - minDate) / 86400000 / totalDays) * 100;

      if (ganttViewMode === "weekly") {
        const cursor = new Date(minDate);
        while (cursor <= maxDate) {
          const left = Math.max(0, pct(cursor));
          const label = document.createElement("div");
          label.className = "gantt-month-label";
          label.style.left = left + "%";
          label.textContent = cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
          monthsEl.appendChild(label);
          cursor.setDate(cursor.getDate() + 7);
        }
      } else {
        const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        while (cursor <= maxDate) {
          const left = Math.max(0, pct(cursor));
          const label = document.createElement("div");
          label.className = "gantt-month-label";
          label.style.left = left + "%";
          label.textContent = cursor.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
          monthsEl.appendChild(label);
          cursor.setMonth(cursor.getMonth() + 1);
        }
      }
    }

    const tree = buildGanttTree(tasks, eixoNames);

    tree.forEach((eixoNode, index) => {
      const colorVar = eixoColorVar(eixoNode.name);
      const groupEl = document.createElement("div");
      groupEl.className = "eixo-group";
      groupEl.style.setProperty("--eixo-color", `var(${colorVar})`);

      const isOpen = ganttOpenState.has(eixoNode.key);
      const grupoCount = eixoNode.children.filter((c) => c.type === "grupo").length;
      const hasContent = eixoNode.children.length > 0;
      const countLabel = grupoCount > 0
        ? `${grupoCount} grupo(s)`
        : hasContent ? `${eixoNode.children.length} tarefa(s)` : "sem tarefas cadastradas";
      const badgeColor = eixoStageColorVar(collectLeafTasks(eixoNode.children));

      const head = document.createElement("div");
      head.className = `eixo-head${hasContent ? "" : " is-empty"}`;
      head.innerHTML = `<span class="tree-toggle ${isOpen ? "is-open" : ""}">▸</span><span class="eixo-badge" style="background:var(${badgeColor})">${index + 1}</span>${escapeHtml(eixoNode.name)} <span class="eixo-count">${countLabel}</span>`;
      head.addEventListener("click", () => toggleGanttNode(eixoNode.key));
      groupEl.appendChild(head);

      if (isOpen) {
        const body = document.createElement("div");
        body.className = "eixo-body";
        if (eixoNode.children.length === 0) {
          body.innerHTML = '<p class="empty-note">Nenhuma tarefa cadastrada neste eixo ainda.</p>';
        } else {
          renderGanttChildren(body, eixoNode.children, 1, eixoNode.name, pct);
        }
        groupEl.appendChild(body);
      }

      container.appendChild(groupEl);
    });
  }

  function isUndated(t) {
    return !t.data_inicio || !t.data_fim;
  }

  // Percorre a árvore (mesma classificação usada no Gantt) para listar, com
  // Eixo/Grupo corretos, toda linha sem data — sejam tarefas-folha ou as
  // próprias linhas-resumo de grupo/marco/eixo.
  function collectUndatedRows(nodes, eixoName, grupoName) {
    const out = [];
    for (const node of nodes) {
      if (node.type === "task") {
        if (isUndated(node.task)) {
          out.push({
            linha: node.task.linha,
            data_inicio: node.task.data_inicio,
            data_fim: node.task.data_fim,
            eixo: eixoName,
            grupo: grupoName || "—",
            tarefa: taskLabel(node.task),
          });
        }
        continue;
      }
      if (node.self && isUndated(node.self)) {
        out.push({
          linha: node.self.linha,
          data_inicio: node.self.data_inicio,
          data_fim: node.self.data_fim,
          eixo: eixoName,
          grupo: node.type === "grupo" ? node.name : grupoName || "—",
          tarefa: node.type === "grupo" ? "(resumo do grupo)" : node.name,
        });
      }
      const childGrupoName = node.type === "grupo" ? node.name : grupoName;
      out.push(...collectUndatedRows(node.children, eixoName, childGrupoName));
    }
    return out;
  }

  function buildUndatedReport(allTasks, eixoNames) {
    const tree = buildGanttTree(allTasks, eixoNames);
    const rows = [];
    for (const eixoNode of tree) {
      if (eixoNode.self && isUndated(eixoNode.self)) {
        rows.push({
          linha: eixoNode.self.linha,
          data_inicio: eixoNode.self.data_inicio,
          data_fim: eixoNode.self.data_fim,
          eixo: eixoNode.name,
          grupo: "—",
          tarefa: "(resumo do eixo)",
        });
      }
      rows.push(...collectUndatedRows(eixoNode.children, eixoNode.name, ""));
    }
    return rows;
  }

  function renderWaitingList(allTasks, eixoNames, sheetUrl) {
    const alertEl = document.getElementById("waiting-alert");
    const bar = document.getElementById("waiting-alert-bar");
    const summaryEl = document.getElementById("waiting-alert-summary");
    const linkEl = document.getElementById("waiting-alert-link");
    const detailEl = document.getElementById("waiting-alert-detail");
    const rowsEl = document.getElementById("waiting-alert-rows");

    const rows = buildUndatedReport(allTasks, eixoNames);

    if (rows.length === 0) {
      alertEl.hidden = true;
      return;
    }

    alertEl.hidden = false;
    summaryEl.textContent = `${rows.length} tarefa(s) aguardando definição de datas. Clique aqui para ver detalhes`;
    linkEl.href = sheetUrl || "#";

    rowsEl.innerHTML = rows
      .map((r) => {
        const missing = [];
        if (!r.data_inicio) missing.push("J (Data Início)");
        if (!r.data_fim) missing.push("K (Data Fim)");
        return `
          <div class="dq-alert-row dq-alert-row--waiting">
            <span>${r.linha ?? "—"}</span>
            <span class="dq-alert-muted">${escapeHtml(r.eixo)}</span>
            <span class="dq-alert-muted">${escapeHtml(r.grupo)}</span>
            <span>${escapeHtml(r.tarefa)}</span>
            <span class="dq-alert-missing">${missing.join(", ")}</span>
          </div>
        `;
      })
      .join("");

    let isOpen = false;
    bar.onclick = (e) => {
      if (e.target === linkEl) return;
      isOpen = !isOpen;
      detailEl.hidden = !isOpen;
      bar.classList.toggle("is-open", isOpen);
    };
  }

  function initTooltip() {
    const tooltip = document.getElementById("tooltip");
    document.addEventListener("mousemove", (e) => {
      const bar = e.target.closest(".bar");
      if (!bar) {
        tooltip.style.display = "none";
        return;
      }
      const task = JSON.parse(bar.dataset.task);
      tooltip.innerHTML = `
        <div class="t-title">${escapeHtml(taskLabel(task))}</div>
        <dl>
          <dt>Eixo</dt><dd>${escapeHtml(task.eixo)}</dd>
          ${task.grupo ? `<dt>Grupo</dt><dd>${escapeHtml(task.grupo)}</dd>` : ""}
          <dt>Início</dt><dd>${fmtDateBR(task.data_inicio)}</dd>
          <dt>Fim</dt><dd>${fmtDateBR(task.data_fim)}</dd>
          ${task.duracao != null ? `<dt>Duração</dt><dd>${task.duracao} dia(s)</dd>` : ""}
          ${task.responsavel ? `<dt>Responsável</dt><dd>${escapeHtml(task.responsavel)}</dd>` : ""}
          <dt>Status</dt><dd>${escapeHtml(task.status || "—")}</dd>
          ${task.prioridade ? `<dt>Prioridade</dt><dd>${escapeHtml(task.prioridade)}</dd>` : ""}
        </dl>
      `;
      tooltip.style.display = "block";
      const x = Math.min(e.clientX + 14, window.innerWidth - 320);
      const y = Math.min(e.clientY + 14, window.innerHeight - 160);
      tooltip.style.left = x + "px";
      tooltip.style.top = y + "px";
    });
  }

  main();
})();
