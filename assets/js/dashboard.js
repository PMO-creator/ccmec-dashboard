(function () {
  "use strict";

  const DATA_URL = "data/master_data.json";

  const STATUS_BUCKETS = [
    { key: "good", label: "Concluído", color: "--status-good" },
    { key: "serious", label: "Em andamento", color: "--status-serious" },
    { key: "warning", label: "Risco de atraso", color: "--status-warning" },
    { key: "critical", label: "Atrasado", color: "--status-critical" },
    { key: "neutral", label: "A definir / outros", color: "--status-neutral" },
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

  function statusClass(status) {
    const s = (status || "").toLowerCase();
    if (s.includes("conclu")) return "good";
    if (s.includes("atras") || s.includes("critic")) return "critical";
    if (s.includes("risco") || s.includes("alerta") || s.includes("atenção")) return "warning";
    if (s.includes("andamento") || s.includes("execu")) return "serious";
    return "neutral";
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
    const stateEl = document.getElementById("app-state");
    let payload;
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload = await res.json();
    } catch (err) {
      stateEl.textContent = `Não foi possível carregar os dados (${DATA_URL}). Detalhe: ${err.message}`;
      return;
    }

    const tasks = payload.tasks || [];
    render(payload, tasks);
  }

  function render(payload, allTasks) {
    document.getElementById("app-state").remove();

    const generated = new Date(payload.generated_at);
    document.getElementById("generated-at").textContent = isNaN(generated)
      ? "—"
      : generated.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

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
    setupGroupTab({
      field: "fornecedor",
      tasks: allTasks,
      searchId: "fornecedores-search",
      listId: "fornecedores-list",
      countId: "fornecedores-count",
      emptyLabel: "fornecedor",
    });
    setupGroupTab({
      field: "responsavel",
      tasks: allTasks,
      searchId: "responsaveis-search",
      listId: "responsaveis-list",
      countId: "responsaveis-count",
      emptyLabel: "responsável",
    });
  }

  function renderStatusReport(allTasks) {
    const summaryEl = document.getElementById("status-summary-row");
    const byEixoEl = document.getElementById("status-by-eixo");
    summaryEl.innerHTML = "";
    byEixoEl.innerHTML = "";

    const counts = Object.fromEntries(STATUS_BUCKETS.map((b) => [b.key, 0]));
    for (const task of allTasks) counts[statusClass(task.status)]++;

    for (const bucket of STATUS_BUCKETS) {
      const tile = document.createElement("div");
      tile.className = "status-tile";
      tile.style.borderLeftColor = `var(${bucket.color})`;
      tile.innerHTML = `
        <div class="label">${escapeHtml(bucket.label)}</div>
        <div class="value">${counts[bucket.key]}</div>
      `;
      summaryEl.appendChild(tile);
    }

    const eixoSet = new Set(allTasks.map((t) => t.eixo || "Sem eixo definido"));
    const order = eixoDisplayOrder(eixoSet);
    const byEixo = groupBy(allTasks, (t) => t.eixo || "Sem eixo definido");

    if (allTasks.length === 0) {
      byEixoEl.innerHTML = '<p class="empty-note">Nenhuma tarefa carregada.</p>';
      return;
    }

    for (const eixo of order) {
      const eixoTasks = byEixo.get(eixo);
      if (!eixoTasks) continue;
      const colorVar = eixoColorVar(eixo);
      const eixoCounts = Object.fromEntries(STATUS_BUCKETS.map((b) => [b.key, 0]));
      for (const task of eixoTasks) eixoCounts[statusClass(task.status)]++;
      const total = eixoTasks.length;
      const done = eixoCounts.good;

      const row = document.createElement("div");
      row.className = "eixo-progress-row";
      const segments = STATUS_BUCKETS.map((b) => {
        const pct = total ? (eixoCounts[b.key] / total) * 100 : 0;
        if (pct === 0) return "";
        return `<span class="seg" style="width:${pct}%;background:var(${b.color})" title="${escapeHtml(b.label)}: ${eixoCounts[b.key]}"></span>`;
      }).join("");
      row.innerHTML = `
        <div class="eixo-progress-name"><span class="legend-dot" style="background:var(${colorVar})"></span>${escapeHtml(eixo)}</div>
        <div class="eixo-progress-bar">${segments}</div>
        <div class="eixo-progress-count">${done}/${total} concluída(s)</div>
      `;
      byEixoEl.appendChild(row);
    }
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
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function setupGroupTab({ field, tasks, searchId, listId, countId, emptyLabel }) {
    const searchInput = document.getElementById(searchId);
    const listEl = document.getElementById(listId);
    const countEl = document.getElementById(countId);
    const allGroups = buildGroups(tasks, field);

    function renderGroups(term) {
      const q = term.trim().toLowerCase();
      const groups = q
        ? allGroups
            .map((g) => ({
              name: g.name,
              tasks: g.tasks.filter(
                (t) => `${g.name} ${taskLabel(t)} ${t.eixo}`.toLowerCase().includes(q)
              ),
            }))
            .filter((g) => g.tasks.length > 0)
        : allGroups;

      countEl.textContent = groups.length;
      listEl.innerHTML = "";

      if (groups.length === 0) {
        listEl.innerHTML = `<p class="empty-note">Nenhum ${emptyLabel} corresponde ao filtro atual.</p>`;
        return;
      }

      const frag = document.createDocumentFragment();
      for (const group of groups) {
        const counts = Object.fromEntries(STATUS_BUCKETS.map((b) => [b.key, 0]));
        for (const task of group.tasks) counts[statusClass(task.status)]++;
        const total = group.tasks.length;

        const card = document.createElement("div");
        card.className = "group-card";

        const segments = STATUS_BUCKETS.map((b) => {
          const width = total ? (counts[b.key] / total) * 24 : 0;
          if (width === 0) return "";
          return `<span class="seg" style="width:${width}px;background:var(${b.color})" title="${escapeHtml(b.label)}: ${counts[b.key]}"></span>`;
        }).join("");

        const head = document.createElement("div");
        head.className = "group-card-head";
        head.innerHTML = `
          <span class="group-card-name">${escapeHtml(group.name)}</span>
          <span class="group-card-meta">
            <span class="status-breakdown">${segments}</span>
            <span class="group-card-count">${total} tarefa(s)</span>
            <span class="group-card-caret">▸</span>
          </span>
        `;
        head.addEventListener("click", () => card.classList.toggle("is-open"));

        const body = document.createElement("div");
        body.className = "group-card-body";
        body.innerHTML = group.tasks
          .map((task) => {
            const sClass = statusClass(task.status);
            return `
              <div class="group-task-row">
                <span class="group-task-name">${escapeHtml(taskLabel(task))} <span class="group-task-eixo">— ${escapeHtml(task.eixo || "Sem eixo")}</span></span>
                <span class="status-badge"><span class="status-dot ${sClass}"></span>${escapeHtml(task.status || "—")}</span>
                <span class="group-task-dates">${fmtTaskRange(task)}</span>
              </div>
            `;
          })
          .join("");

        card.appendChild(head);
        card.appendChild(body);
        frag.appendChild(card);
      }
      listEl.appendChild(frag);
    }

    searchInput.addEventListener("input", () => renderGroups(searchInput.value));
    renderGroups("");
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
