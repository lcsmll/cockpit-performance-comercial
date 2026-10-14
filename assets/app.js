/* Interface do cockpit. Todo número exibido vem de Engine.compute (assets/engine.js). */
(function () {
  "use strict";
  const E = window.Engine, F = E.fmt, L = E.LIMIARES, rp = E.rp;
  const $ = id => document.getElementById(id);
  const ARQUIVOS = ["parceiros", "metas", "forecast", "oportunidades", "parametros_etapas", "parametros_gerais"];
  let db, estado, ancora = null, verTodosRiscos = false, ordem = { chave: "atingimento", asc: true };
  const graficos = {};

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

  // ------------------------------------------------------------ carga
  async function iniciar() {
    try {
      const textos = {};
      await Promise.all(ARQUIVOS.map(async n => {
        const resp = await fetch(`data/${n}.csv`);
        if (!resp.ok) throw new Error(`data/${n}.csv respondeu ${resp.status}`);
        textos[n] = await resp.text();
      }));
      db = E.load(textos);
    } catch (e) {
      const st = $("estado");
      st.classList.add("erro");
      st.innerHTML = location.protocol === "file:"
        ? "O navegador bloqueia a leitura dos CSV quando a página é aberta direto do disco. Na pasta do projeto, rode <code>python -m http.server 8000</code> e abra <code>http://localhost:8000</code>."
        : `Não foi possível carregar a base: ${esc(e.message)}. Confira se a pasta <code>data/</code> foi publicada junto com o index.html.`;
      return;
    }
    estado = lerURL();
    montarFiltros();
    $("estado").hidden = true;
    document.querySelectorAll("main .secao").forEach(s => (s.hidden = false));
    $("dataCorte").textContent = `Dados até ${F.data(db.dataCorte)}`;
    $("corteFunil").textContent = F.data(db.dataCorte);
    $("mesM1").textContent = F.mes(db.mesesFuturos[0]);
    renderMetodo();
    render();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  }

  // ------------------------------------------------------------ estado e filtros
  function lerURL() {
    const p = new URLSearchParams(location.search), d = E.filtrosPadrao(db);
    const okMes = m => db.mesesFechados.includes(m);
    return {
      de: okMes(p.get("de")) ? p.get("de") : d.de,
      ate: okMes(p.get("ate")) ? p.get("ate") : d.ate,
      parceiro: db.parceiroPorId[p.get("parceiro")] ? p.get("parceiro") : "Todos",
      etapa: db.etapaPorNome[p.get("etapa")] && p.get("etapa") !== "Contrato" ? p.get("etapa") : "Todas"
    };
  }
  function gravarURL() {
    const d = E.filtrosPadrao(db), p = new URLSearchParams();
    Object.keys(estado).forEach(k => { if (estado[k] !== d[k]) p.set(k, estado[k]); });
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }
  function opcoes(sel, itens, valor) {
    sel.innerHTML = itens.map(([v, t]) => `<option value="${esc(v)}"${v === valor ? " selected" : ""}>${esc(t)}</option>`).join("");
  }
  function montarFiltros() {
    const meses = db.mesesFechados.map(m => [m, F.mes(m)]);
    opcoes($("fDe"), meses, estado.de);
    opcoes($("fAte"), meses, estado.ate);
    opcoes($("fParceiro"), [["Todos", "Todos os parceiros"]].concat(db.parceiros.map(p => [p.id, p.nome])), estado.parceiro);
    opcoes($("fEtapa"), [["Todas", "Todas as etapas"]].concat(db.etapas.filter(e => e.etapa !== "Contrato").map(e => [e.etapa, e.etapa])), estado.etapa);
    $("fDe").onchange = e => mudar({ de: e.target.value });
    $("fAte").onchange = e => mudar({ ate: e.target.value });
    $("fParceiro").onchange = e => mudar({ parceiro: e.target.value });
    $("fEtapa").onchange = e => mudar({ etapa: e.target.value });
    $("limpar").onclick = () => { ancora = null; mudar(E.filtrosPadrao(db)); };
  }
  function mudar(parcial) {
    Object.assign(estado, parcial);
    if (estado.de > estado.ate) [estado.de, estado.ate] = [estado.ate, estado.de];
    verTodosRiscos = false;
    $("fDe").value = estado.de; $("fAte").value = estado.ate;
    $("fParceiro").value = estado.parceiro; $("fEtapa").value = estado.etapa;
    gravarURL();
    render();
  }
  const alternarParceiro = pid => mudar({ parceiro: estado.parceiro === pid ? "Todos" : pid });

  // ------------------------------------------------------------ render principal
  function render() {
    const r = E.compute(db, estado);
    const rTodos = estado.parceiro === "Todos" ? r : E.compute(db, Object.assign({}, estado, { parceiro: "Todos" }));
    const hist = E.compute(db, Object.assign({}, estado, { de: db.mesesFechados[0], ate: db.mesesFechados[db.mesesFechados.length - 1] }));
    configurarChart();
    renderRegua(hist.serie);
    renderKpis(r);
    renderMensal(r);
    renderRanking(rTodos);
    renderTabela(rTodos);
    renderFunil(r);
    renderAtencao(r);
    renderConclusoes(r);
  }

  function nomeFiltro() {
    const p = estado.parceiro === "Todos" ? "todos os parceiros" : db.parceiroPorId[estado.parceiro].nome;
    return `${F.mes(estado.de)} a ${F.mes(estado.ate)}, ${p}`;
  }

  // ------------------------------------------------------------ régua do tempo
  function renderRegua(serie) {
    const el = $("regua");
    el.innerHTML = serie.map(s => {
      if (s.tipo === "futuro") return `<button type="button" class="fut" aria-disabled="true" title="${F.mes(s.mes)}: mês futuro, apenas meta e forecast">${F.mes(s.mes)}</button>`;
      const t = s.atingimento === null ? 0.1 : 0.2 + 0.8 * Math.max(0, Math.min(1, (s.atingimento - 0.6) / 0.6));
      const dentro = s.mes >= estado.de && s.mes <= estado.ate;
      const cls = ["fech", t > 0.55 ? "claro" : "", dentro ? "" : "fora", s.mes === ancora ? "sel" : ""].join(" ");
      return `<button type="button" class="${cls}" style="--t:${t.toFixed(3)}" data-mes="${s.mes}" aria-pressed="${dentro}"
        title="${F.mes(s.mes)}: realizado ${F.kwp(s.realizado)}, ${F.pct(s.atingimento)} da meta">${F.mes(s.mes)}</button>`;
    }).join("");
    el.querySelectorAll("button[data-mes]").forEach(b => b.onclick = () => {
      const m = b.dataset.mes;
      if (ancora === null) { ancora = m; mudar({ de: m, ate: m }); }
      else { const a = ancora; ancora = null; mudar({ de: a < m ? a : m, ate: a < m ? m : a }); }
    });
  }

  // ------------------------------------------------------------ KPIs
  function kpi(rot, val, det, cls) {
    return `<div class="kpi ${cls || ""}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="det">${det || ""}</div></div>`;
  }
  const kwpHtml = v => v === null ? "–" : `${F.num(v)}<small>kWp</small>`;
  function renderKpis(r) {
    const k = r.kpis, pj = r.projecao;
    $("notaPeriodo").textContent = `${nomeFiltro()} (${r.meses.length} ${r.meses.length === 1 ? "mês fechado" : "meses fechados"})`;
    const clsAt = k.atingimento === null ? "" : rp(k.atingimento) >= 1 ? "bom" : rp(k.atingimento) < L.ATINGIMENTO_MIN ? "ruim" : "";
    $("kpis").innerHTML = [
      kpi("Meta", kwpHtml(k.meta), "soma das metas mensais"),
      kpi("Realizado", kwpHtml(k.realizado), "contratos assinados no período"),
      kpi("Atingimento", F.pct(k.atingimento), "realizado ÷ meta", clsAt),
      kpi(k.gap >= 0 ? "Gap para a meta" : "Acima da meta", kwpHtml(Math.abs(k.gap)), "meta − realizado", k.gap > 0 ? "" : "bom"),
      kpi("Contratos ganhos", F.num(k.contratos), k.contratos ? `${F.num(k.realizado / k.contratos)} kWp por contrato` : ""),
      kpi("Viés do forecast", F.pctSinal(k.vies), `erro absoluto médio de ${F.pct(k.wape)}`, k.vies !== null && rp(k.vies) > L.VIES_MAX ? "ruim" : "")
    ].join("");
    const m0 = F.mes(pj.meses[0]), m2 = F.mes(pj.meses[pj.meses.length - 1]);
    $("tituloProj").textContent = `Projeção ${m0} a ${m2}`;
    $("kpisProj").innerHTML = [
      kpi("Meta do trimestre", kwpHtml(pj.meta), `${m0} a ${m2}`),
      kpi("Forecast declarado", kwpHtml(pj.forecast), "registrado pelos parceiros"),
      kpi("Cobertura da meta", F.pct(pj.cobertura), "forecast ÷ meta"),
      kpi(`Pipeline ponderado ${m0}`, kwpHtml(pj.pondM1), "kWp aberto × probabilidade da etapa"),
      kpi(`Lastro do forecast ${m0}`, F.pct(pj.lastroM1), "pipeline ponderado ÷ forecast", pj.lastroM1 !== null && rp(pj.lastroM1) < L.LASTRO_MIN ? "ruim" : "")
    ].join("");
  }

  // ------------------------------------------------------------ gráficos
  function configurarChart() {
    Chart.defaults.font.family = css("--fonte");
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--line");
    // Altera só a duração. Substituir o objeto Chart.defaults.animation inteiro apaga as chaves (type, easing, fn…)
    // que o Chart.js usa como lista de opções a copiar em cada animação; sem "type: color", animar uma cor
    // (ex.: hover da barra) não encontra interpolador e dispara "this._fn is not a function".
    Chart.defaults.animation.duration = 250;
  }
  // Movimento reduzido: desliga animações por gráfico, opção documentada do Chart.js, sem mexer nos defaults.
  const semAnimacao = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function hachura(cor, fundo) {
    const c = document.createElement("canvas"); c.width = c.height = 8;
    const x = c.getContext("2d");
    x.fillStyle = fundo; x.fillRect(0, 0, 8, 8);
    x.strokeStyle = cor; x.lineWidth = 2;
    x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
    return x.createPattern(c, "repeat");
  }
  function trocar(id, cfg) {
    if (semAnimacao()) cfg.options = Object.assign({}, cfg.options, { animation: false });
    if (graficos[id]) graficos[id].destroy();
    graficos[id] = new Chart($(id), cfg);
  }
  const eixoKwp = { ticks: { callback: v => F.num(v) }, grid: { color: () => css("--line") }, beginAtZero: true, title: { display: true, text: "kWp" } };

  function renderMensal(r) {
    const s = r.serie, real = css("--real"), proj = css("--proj"), meta = css("--meta");
    trocar("gMensal", {
      data: {
        labels: s.map(x => F.mes(x.mes)),
        datasets: [
          { type: "bar", label: "Realizado", data: s.map(x => x.tipo === "fechado" ? x.realizado : null), backgroundColor: real, borderRadius: 2, skipNull: true, order: 3 },
          { type: "bar", label: "Forecast declarado", data: s.map(x => x.tipo === "futuro" ? x.forecast : null), backgroundColor: hachura(proj, css("--proj-soft")), borderColor: proj, borderWidth: 1.5, borderRadius: 2, skipNull: true, order: 3 },
          { type: "line", label: "Meta", data: s.map(x => x.meta), borderColor: meta, backgroundColor: meta, borderWidth: 2, stepped: "middle", pointRadius: 0, pointHitRadius: 8, order: 1 },
          { type: "line", label: "Forecast registrado", data: s.map(x => x.tipo === "fechado" ? x.forecastRegistrado : null), showLine: false, pointRadius: 4.5, pointBorderWidth: 2, borderColor: proj, backgroundColor: css("--surface"), order: 0 },
          { type: "line", label: "Pipeline ponderado", data: s.map(x => x.tipo === "futuro" ? x.pipelinePonderado : null), showLine: false, pointStyle: "rectRot", pointRadius: 7, backgroundColor: proj, borderColor: css("--surface"), borderWidth: 1.5, order: 0 }
        ]
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: it => it.raw !== null,
            callbacks: {
              label: it => `${it.dataset.label}: ${F.kwp(it.raw)}`,
              footer: its => {
                const x = s[its[0].dataIndex];
                if (x.tipo === "futuro") return "Mês futuro: sem realizado";
                return `Atingimento: ${F.pct(x.atingimento)}`;
              }
            }
          }
        },
        scales: { x: { grid: { display: false } }, y: eixoKwp }
      }
    });
  }

  const linhasRef = {
    id: "linhasRef",
    afterDatasetsDraw(ch) {
      const { ctx, chartArea: a, scales: { x } } = ch;
      [[L.ATINGIMENTO_MIN, [4, 4]], [1, []]].forEach(([v, dash]) => {
        const px = x.getPixelForValue(v * 100);
        if (px < a.left || px > a.right) return;
        ctx.save(); ctx.strokeStyle = css("--ink"); ctx.setLineDash(dash); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore();
      });
    }
  };
  function renderRanking(r) {
    const lin = r.parceiros.filter(p => p.atingimento !== null).slice().sort((a, b) => b.atingimento - a.atingimento);
    $("wrapRanking").style.height = (lin.length * 24 + 60) + "px";
    const neutro = css("--neutro");
    const cor = p => p.emRampa ? css("--line") : rp(p.atingimento) < L.ATINGIMENTO_MIN ? css("--risk") : rp(p.atingimento) >= 1 ? css("--real") : neutro;
    const sel = estado.parceiro;
    trocar("gRanking", {
      type: "bar",
      data: {
        labels: lin.map(p => p.nome.replace("Parceiro ", "") + (p.emRampa ? " (em rampa)" : "")),
        datasets: [{ data: lin.map(p => p.atingimento * 100), backgroundColor: lin.map(p => cor(p)), borderRadius: 2,
          borderColor: lin.map(p => p.id === sel ? css("--ink") : "transparent"), borderWidth: lin.map(p => p.id === sel ? 2 : 0) }]
      },
      plugins: [linhasRef],
      options: {
        indexAxis: "y", maintainAspectRatio: false,
        onClick: (ev, els) => { if (els.length) alternarParceiro(lin[els[0].index].id); },
        onHover: (ev, els) => { ev.native.target.style.cursor = els.length ? "pointer" : "default"; },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: it => { const p = lin[it.dataIndex]; return `${F.pct(p.atingimento)} (${F.kwp(p.realizado)} de ${F.kwp(p.meta)})`; } } } },
        scales: {
          x: { beginAtZero: true, suggestedMax: 120, ticks: { callback: v => v + "%" }, grid: { color: () => css("--line") } },
          y: { grid: { display: false }, ticks: { autoSkip: false } }
        }
      }
    });
  }

  // ------------------------------------------------------------ tabela de parceiros
  const CURTO = { A1: "Abaixo da meta", A2: "Queda", A3: "Fc otimista", A4: "Sem lastro", A5: "Envelhecido", RAMPA: "Rampa" };
  const COLS = [
    { k: "nome", t: "Parceiro", f: (p) => esc(p.nome), esq: true },
    { k: "meta", t: "Meta", f: p => F.num(p.meta) },
    { k: "realizado", t: "Realizado", f: p => F.num(p.realizado) },
    { k: "atingimento", t: "Ating.", f: p => `<span class="${p.atingimento !== null && rp(p.atingimento) < L.ATINGIMENTO_MIN ? "neg" : rp(p.atingimento) >= 1 ? "pos" : ""}">${F.pct(p.atingimento)}</span>` },
    { k: "gap", t: "Gap", f: p => F.num(p.gap) },
    { k: "tendencia", t: "Últ. 3m vs 3m ant.", f: p => `<span class="${p.tendencia !== null && rp(p.tendencia) <= L.QUEDA_TENDENCIA ? "neg" : ""}">${F.pctSinal(p.tendencia)}</span>` },
    { k: "vies", t: "Viés forecast", f: p => F.pctSinal(p.vies) },
    { k: "forecastProx", t: "Forecast próx. 3m", f: p => F.num(p.forecastProx), proj: true },
    { k: "cobertura", t: "Cobertura", f: p => F.pct(p.cobertura), proj: true },
    { k: "lastroM1", t: "Lastro M+1", f: p => F.pct(p.lastroM1), proj: true },
    { k: "kwpAberto", t: "Pipeline aberto", f: p => F.num(p.kwpAberto) },
    { k: "riscoPipe", t: "Em risco", f: p => F.pct(p.riscoPipe) },
    { k: "alertas", t: "Alertas", f: p => p.alertas.map(a => `<span class="tag ${a}" title="${esc(E.NOMES_ALERTA[a])}">${CURTO[a]}</span>`).join("") || '<span class="fraco">–</span>', esq: true, semOrdem: true }
  ];
  function renderTabela(r) {
    const t = $("tParceiros");
    const lin = r.parceiros.slice().sort((a, b) => {
      const va = a[ordem.chave], vb = b[ordem.chave];
      if (va === null) return 1; if (vb === null) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb;
      return ordem.asc ? c : -c;
    });
    const k = r.kpis, pj = r.projecao;
    t.innerHTML = `<caption class="pular">Indicadores por parceiro, ${esc(nomeFiltro())}</caption><thead><tr>${COLS.map(c =>
      `<th scope="col" class="${c.esq ? "esq" : ""} ${c.proj ? "proj-col" : ""}"${ordem.chave === c.k ? ` aria-sort="${ordem.asc ? "ascending" : "descending"}"` : ""}>${c.semOrdem ? c.t : `<button type="button" data-k="${c.k}">${c.t}</button>`}</th>`).join("")}</tr></thead>
      <tbody>${lin.map(p => `<tr class="clic ${p.id === estado.parceiro ? "ativo" : ""}" data-id="${p.id}" tabindex="0">${COLS.map(c => `<td class="${c.esq ? "esq" : ""} ${c.proj ? "proj-cell" : ""}">${c.f(p)}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>Total do canal</td><td>${F.num(k.meta)}</td><td>${F.num(k.realizado)}</td><td>${F.pct(k.atingimento)}</td><td>${F.num(k.gap)}</td><td></td><td>${F.pctSinal(k.vies)}</td>
      <td class="proj-cell">${F.num(pj.forecast)}</td><td class="proj-cell">${F.pct(pj.cobertura)}</td><td class="proj-cell">${F.pct(pj.lastroM1)}</td><td>${F.num(r.kwpAberto)}</td><td></td><td></td></tr></tfoot>`;
    t.querySelectorAll("th button").forEach(b => b.onclick = () => {
      ordem = { chave: b.dataset.k, asc: ordem.chave === b.dataset.k ? !ordem.asc : b.dataset.k === "nome" || b.dataset.k === "regiao" };
      renderTabela(r);
    });
    t.querySelectorAll("tbody tr").forEach(tr => {
      tr.onclick = () => alternarParceiro(tr.dataset.id);
      tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternarParceiro(tr.dataset.id); } };
    });
  }

  // ------------------------------------------------------------ funil
  function renderFunil(r) {
    const fu = r.funil;
    $("notaFunil").textContent = `Conversão: oportunidades criadas de ${F.mes(estado.de)} a ${F.mes(estado.ate)}. Pipeline aberto: foto na data de corte${estado.etapa !== "Todas" ? `, só a etapa ${estado.etapa}` : ""}.`;
    const max = fu.atingiu[0].qtd || 1;
    const conv = fu.conversao.filter(c => c.taxa !== null);
    const pior = conv.length ? conv.reduce((a, b) => (b.taxa < a.taxa ? b : a)) : null;
    let html = "";
    fu.atingiu.forEach((e, i) => {
      const w = (e.qtd / max) * 100;
      html += `<div class="f-etapa ${i === fu.atingiu.length - 1 ? "ganho" : ""}"><span class="f-nome">${esc(e.etapa === "Contrato" ? "Contrato (ganho)" : e.etapa)}</span>
        <div class="f-barra-wrap"><div class="f-barra ${w < 18 ? "fora" : ""}" style="width:${Math.max(w, 0.5).toFixed(2)}%">${w >= 18 ? F.num(e.qtd) : ""}</div>${w < 18 ? `<span>${F.num(e.qtd)}</span>` : ""}</div></div>`;
      const c = fu.conversao[i];
      if (c) html += `<div class="f-conv ${pior && c.de === pior.de ? "pior" : ""}"><span></span><span>↓ <b>${F.pct(c.taxa)}</b> avançaram${pior && c.de === pior.de ? " (menor conversão)" : ""}</span></div>`;
    });
    html += `<p class="nota">Conversão total até contrato: <b>${F.pct(fu.conversaoGlobal)}</b>. ${F.pct(fu.coorteAbertaPct)} da coorte ainda está aberta e conta só até a etapa atual.</p>`;
    $("funil").innerHTML = html;

    const pa = fu.pipelineAberto.filter(x => estado.etapa === "Todas" || x.etapa === estado.etapa), tot = k => pa.reduce((s, x) => s + x[k], 0);
    $("tPipeline").innerHTML = `<thead><tr><th scope="col">Etapa</th><th scope="col">Qtd.</th><th scope="col">kWp</th><th scope="col">Prob. de ganho</th><th scope="col" class="proj-col">Ponderado</th><th scope="col">Com risco</th></tr></thead>
      <tbody>${pa.map(x => `<tr><td>${esc(x.etapa)}</td><td>${F.num(x.qtd)}</td><td>${F.num(x.kwp)}</td><td>${F.pct0(db.etapaPorNome[x.etapa].prob)}</td><td class="proj-cell">${F.num(x.ponderado)}</td><td>${F.num(x.emRisco)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td>${F.num(tot("qtd"))}</td><td>${F.num(tot("kwp"))}</td><td></td><td class="proj-cell">${F.num(tot("ponderado"))}</td><td>${F.num(tot("emRisco"))}</td></tr></tfoot>`;

    const mx = Math.max(1, ...fu.motivosPerda.map(m => m.qtd));
    $("motivos").innerHTML = fu.motivosPerda.length ? fu.motivosPerda.map(m =>
      `<div class="barra-l"><span>${esc(m.motivo)}</span><span class="b" style="width:${(m.qtd / mx * 100).toFixed(1)}%"></span><span class="n">${F.num(m.qtd)}</span></div>`).join("")
      : '<p class="vazio">Nenhuma perda na coorte selecionada.</p>';
  }

  // ------------------------------------------------------------ atenção
  const REGRAS = {
    A1: `Atingimento do período abaixo de ${F.pct0(L.ATINGIMENTO_MIN)}.`,
    A2: `Realizado dos últimos 3 meses ${F.pct0(-L.QUEDA_TENDENCIA)} ou mais abaixo dos 3 anteriores, com atingimento do trimestre abaixo de ${F.pct0(L.QUEDA_ATING_3M)}. Exige 6 meses no período.`,
    A3: `Forecast registrado no início dos meses mais de ${F.pct0(L.VIES_MAX)} acima do realizado no período.`,
    A4: `Pipeline ponderado com previsão para o próximo mês cobre menos de ${F.pct0(L.LASTRO_MIN)} do forecast declarado.`,
    A5: `${F.pct0(L.RISCO_PIPE_MAX)} ou mais do kWp aberto com sinal de risco (mínimo de ${L.RISCO_MIN_OPS} oportunidades).`,
    RAMPA: `Credenciado há menos de ${L.RAMPA_MESES} meses: alertas de meta, queda e viés não se aplicam.`
  };
  function valorAlerta(cod, p) {
    return { A1: F.pct(p.atingimento), A2: F.pctSinal(p.tendencia), A3: F.pctSinal(p.vies), A4: F.pct(p.lastroM1), A5: F.pct(p.riscoPipe), RAMPA: "desde " + F.mes(p.mesCred) }[cod];
  }
  function renderAtencao(r) {
    const grupos = ["A1", "A2", "A3", "A4", "A5", "RAMPA"].map(cod => ({ cod, ps: r.parceiros.filter(p => p.alertas.includes(cod)) }));
    const comAlerta = grupos.filter(g => g.ps.length);
    $("alertas").innerHTML = comAlerta.length ? comAlerta.map(g => `<div class="alerta-grupo"><h4><span>${esc(E.NOMES_ALERTA[g.cod])}</span><span class="tag ${g.cod}">${g.ps.length}</span></h4>
      <p class="regra">${esc(REGRAS[g.cod])}</p><ul>${g.ps.map(p => `<li><button type="button" data-id="${p.id}">${esc(p.nome)}: ${valorAlerta(g.cod, p)}</button></li>`).join("")}</ul></div>`).join("")
      : '<p class="vazio">Nenhuma regra de alerta disparou para o filtro atual.</p>';
    $("alertas").querySelectorAll("button[data-id]").forEach(b => b.onclick = () => alternarParceiro(b.dataset.id));

    $("resumoRiscos").innerHTML = r.resumoRiscos.map(x => `<div class="chip"><b>${F.num(x.qtd)}</b>${esc(x.nome)}<br><span class="fraco">${F.kwp(x.kwp)}</span></div>`).join("");
    const lim = verTodosRiscos ? r.riscos.length : 12;
    const lr = r.riscos.slice(0, lim);
    $("tRiscos").innerHTML = lr.length ? `<thead><tr><th scope="col">Oportunidade</th><th scope="col" class="esq">Parceiro</th><th scope="col" class="esq">Etapa</th><th scope="col">kWp</th><th scope="col" class="proj-col">Ponderado</th><th scope="col">Dias na etapa</th><th scope="col">Previsão</th><th scope="col" class="esq">Sinais</th></tr></thead>
      <tbody>${lr.map(o => `<tr><td>${o.id}</td><td class="esq">${esc(o.parceiro)}</td><td class="esq">${esc(o.etapa)}</td><td>${F.num(o.kwp)}</td><td class="proj-cell">${F.num(o.ponderado)}</td>
      <td class="${o.riscos.includes("SLA") ? "neg" : ""}">${o.dias} <span class="fraco">/ ${o.sla}</span></td><td class="${o.riscos.includes("VENCIDA") ? "neg" : ""}">${F.data(o.previsao)}</td>
      <td class="esq">${o.riscos.map(c => `<span class="tag ${c}">${c === "PENDENCIA" ? esc(o.pendencia) : c === "SLA" ? "Acima do prazo" : "Previsão vencida"}</span>`).join("")}</td></tr>`).join("")}</tbody>`
      : '<tbody><tr><td class="vazio">Nenhuma oportunidade aberta com sinal de risco neste filtro.</td></tr></tbody>';
    const mais = $("maisRiscos");
    mais.hidden = r.riscos.length <= 12;
    mais.textContent = verTodosRiscos ? "Mostrar só as 12 maiores" : `Mostrar todas (${F.num(r.riscos.length)})`;
    mais.onclick = () => { verTodosRiscos = !verTodosRiscos; renderAtencao(r); };

    const pr = r.prioritarias.slice(0, 8);
    $("tPrioritarias").innerHTML = pr.length ? `<thead><tr><th scope="col">Oportunidade</th><th scope="col" class="esq">Parceiro</th><th scope="col">kWp</th><th scope="col" class="proj-col">Ponderado</th><th scope="col">Dias na etapa</th><th scope="col">Previsão</th></tr></thead>
      <tbody>${pr.map(o => `<tr><td>${o.id}</td><td class="esq">${esc(o.parceiro)}</td><td>${F.num(o.kwp)}</td><td class="proj-cell">${F.num(o.ponderado)}</td><td>${o.dias}</td><td>${F.data(o.previsao)}</td></tr>`).join("")}</tbody>
      ${r.prioritarias.length > 8 ? `<tfoot><tr><td colspan="6" class="esq fraco">+ ${r.prioritarias.length - 8} negociações menores nas mesmas condições</td></tr></tfoot>` : ""}`
      : `<tbody><tr><td class="vazio">${estado.etapa !== "Todas" && estado.etapa !== "Negociação" ? "O filtro de etapa exclui negociações." : "Nenhuma negociação nessas condições."}</td></tr></tbody>`;
  }

  // ------------------------------------------------------------ conclusões
  function renderConclusoes(r) {
    const li = c => `<li><strong>${esc(c.titulo)}</strong><p>${esc(c.texto)}</p></li>`;
    const d = r.conclusoes.filter(c => c.tipo === "diagnostico"), rc = r.conclusoes.filter(c => c.tipo === "recomendacao");
    $("diag").innerHTML = d.map(li).join("") || '<li><p>Sem dados suficientes para o filtro atual.</p></li>';
    $("recs").innerHTML = rc.map(li).join("") || '<li><p>Nenhuma regra de ação disparou para o filtro atual.</p></li>';
  }

  function renderMetodo() {
    const linhas = [
      ["Meta", "Σ meta mensal dos parceiros e meses filtrados (kWp)."],
      ["Realizado", "Σ kWp das oportunidades com status Ganha cuja data de ganho cai nos meses filtrados."],
      ["Atingimento", "Realizado ÷ Meta."],
      ["Gap", "Meta − Realizado. Negativo significa que a meta foi superada."],
      ["Viés do forecast", "(Σ forecast registrado − Σ realizado) ÷ Σ realizado, nos parceiro-meses com forecast. Positivo = otimista."],
      ["Erro absoluto médio", "Σ |forecast − realizado| por parceiro-mês ÷ Σ realizado."],
      ["Forecast declarado", "Σ forecast dos meses futuros, registrado pelos parceiros no 1º dia de cada mês. Nunca somado ao realizado."],
      ["Cobertura da meta", "Forecast dos meses futuros ÷ Meta dos meses futuros."],
      ["Pipeline ponderado", "Σ (kWp da oportunidade aberta × probabilidade de ganho da etapa), só com previsão de fechamento posterior à data de corte."],
      ["Lastro do forecast M+1", "Pipeline ponderado com previsão no próximo mês ÷ forecast declarado do próximo mês."],
      ["Conversão entre etapas", "Oportunidades da coorte que atingiram a etapa seguinte ÷ que atingiram a etapa. Coorte = criadas no período."],
      ["Últ. 3m vs 3m ant.", "Realizado dos 3 últimos meses do período ÷ realizado dos 3 meses anteriores − 1. Exige 6 meses no período."],
      ["Em risco", "Oportunidade aberta parada além do prazo da etapa, com previsão vencida ou com pendência."]
    ];
    $("tMetodo").innerHTML = `<thead><tr><th scope="col">Indicador</th><th scope="col" class="esq">Fórmula</th></tr></thead><tbody>${linhas.map(l => `<tr><td>${l[0]}</td><td>${esc(l[1])}</td></tr>`).join("")}</tbody>`;
  }

  iniciar();
})();
