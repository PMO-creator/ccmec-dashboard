(function () {
  "use strict";

  const DATA_URL = "data/master_data.json";

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
    return task.tarefa || task.marco || task.grupo || task.eixo || "(sem descrição)";
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

  async function main() {
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

    const withDates = allTasks.filter((t) => t.data_inicio && t.data_fim);
    const withoutDates = allTasks.filter((t) => !(t.data_inicio && t.data_fim));
    const eixoSet = new Set(allTasks.map((t) => t.eixo || "Sem eixo definido"));

    document.getElementById("stat-total").textContent = allTasks.length;
    document.getElementById("stat-com-datas").textContent =
      `${withDates.length} (${Math.round((withDates.length / allTasks.length) * 100)}%)`;
    document.getElementById("stat-sem-datas").textContent = withoutDates.length;
    document.getElementById("stat-eixos").textContent = eixoSet.size;

    const activeEixos = new Set(eixoSet);
    let searchTerm = "";

    const legendEl = document.getElementById("legend");
    const order = eixoDisplayOrder(eixoSet);
    for (const eixo of order) {
      const colorVar = eixoColorVar(eixo);
      const btn = document.createElement("button");
      btn.className = "legend-item";
      btn.type = "button";
      btn.dataset.eixo = eixo;
      btn.innerHTML = `<span class="legend-dot" style="background:var(${colorVar})"></span>${escapeHtml(eixo)}`;
      btn.addEventListener("click", () => {
        if (activeEixos.has(eixo)) activeEixos.delete(eixo); else activeEixos.add(eixo);
        btn.classList.toggle("is-off", !activeEixos.has(eixo));
        applyFilters();
      });
      legendEl.appendChild(btn);
    }

    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", () => {
      searchTerm = searchInput.value.trim().toLowerCase();
      applyFilters();
    });

    function matches(task) {
      const eixo = task.eixo || "Sem eixo definido";
      if (!activeEixos.has(eixo)) return false;
      if (!searchTerm) return true;
      const hay = `${task.tarefa} ${task.responsavel} ${task.grupo} ${task.marco} ${task.eixo}`.toLowerCase();
      return hay.includes(searchTerm);
    }

    function applyFilters() {
      renderGantt(withDates.filter(matches));
      renderTable(withoutDates.filter(matches));
    }

    applyFilters();
    initTooltip();
  }

  function renderGantt(tasks) {
    const container = document.getElementById("gantt-body");
    const monthsEl = document.getElementById("gantt-months");
    container.innerHTML = "";
    monthsEl.innerHTML = "";

    if (tasks.length === 0) {
      container.innerHTML = '<p class="empty-note">Nenhuma tarefa com datas definidas corresponde ao filtro atual.</p>';
      return;
    }

    const starts = tasks.map((t) => new Date(t.data_inicio));
    const ends = tasks.map((t) => new Date(t.data_fim));
    let minDate = new Date(Math.min(...starts));
    let maxDate = new Date(Math.max(...ends));
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);
    const totalDays = Math.max(1, (maxDate - minDate) / 86400000);

    function pct(date) {
      return ((date - minDate) / 86400000 / totalDays) * 100;
    }

    // Month gridlines
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

    const byEixo = groupBy(tasks, (t) => t.eixo || "Sem eixo definido");
    const order = eixoDisplayOrder(new Set(byEixo.keys()));

    for (const eixo of order) {
      const eixoTasks = byEixo.get(eixo);
      if (!eixoTasks) continue;
      const colorVar = eixoColorVar(eixo);

      const groupEl = document.createElement("div");
      groupEl.className = "eixo-group";
      groupEl.style.setProperty("--eixo-color", `var(${colorVar})`);

      const head = document.createElement("div");
      head.className = "eixo-head";
      head.innerHTML = `<span class="eixo-dot"></span>${escapeHtml(eixo)} <span class="eixo-count">${eixoTasks.length} tarefa(s)</span>`;
      groupEl.appendChild(head);

      const byGrupo = groupBy(eixoTasks, (t) => t.grupo || "");
      for (const [grupo, grupoTasks] of byGrupo) {
        if (grupo) {
          const gLabel = document.createElement("div");
          gLabel.className = "grupo-label";
          gLabel.textContent = grupo;
          groupEl.appendChild(gLabel);
        }
        for (const task of grupoTasks) {
          const row = document.createElement("div");
          row.className = "gantt-row";

          const name = document.createElement("div");
          name.className = "task-name";
          name.textContent = taskLabel(task);
          row.appendChild(name);

          const track = document.createElement("div");
          track.className = "bar-track";
          const left = pct(new Date(task.data_inicio));
          const width = Math.max(0.6, pct(new Date(task.data_fim)) - left);
          const bar = document.createElement("div");
          bar.className = "bar";
          bar.style.left = left + "%";
          bar.style.width = width + "%";
          bar.style.setProperty("--bar-color", `var(${colorVar})`);
          bar.dataset.task = JSON.stringify(task);
          track.appendChild(bar);
          row.appendChild(track);

          groupEl.appendChild(row);
        }
      }

      container.appendChild(groupEl);
    }
  }

  function renderTable(tasks) {
    const tbody = document.getElementById("table-body");
    const countEl = document.getElementById("table-count");
    tbody.innerHTML = "";
    countEl.textContent = tasks.length;

    if (tasks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-note">Nenhuma tarefa corresponde ao filtro atual.</td></tr>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const task of tasks) {
      const tr = document.createElement("tr");
      const eixo = task.eixo || "Sem eixo definido";
      const colorVar = eixoColorVar(eixo);
      const sClass = statusClass(task.status);
      tr.innerHTML = `
        <td><span class="eixo-chip"><span class="legend-dot" style="background:var(${colorVar})"></span>${escapeHtml(eixo)}</span></td>
        <td>${escapeHtml(task.grupo)}</td>
        <td>${escapeHtml(taskLabel(task))}</td>
        <td>${escapeHtml(task.responsavel)}</td>
        <td><span class="status-badge"><span class="status-dot ${sClass}"></span>${escapeHtml(task.status || "—")}</span></td>
        <td>${escapeHtml(task.prioridade || "—")}</td>
      `;
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
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
