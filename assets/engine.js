/*
 * Motor de cálculo do Cockpit de Performance Comercial (dados fictícios).
 * Funções puras: recebem a base carregada e os filtros, devolvem todos os números que a tela exibe.
 * O mesmo arquivo roda no navegador (window.Engine) e no Node (require), o que permite que o script
 * de validação compare exatamente o que a interface mostra com um recálculo independente em Python.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Limiares das regras de alerta (documentados em docs/dicionario_de_dados.md)
  const LIMIARES = {
    ATINGIMENTO_MIN: 0.80,     // A1 abaixo da meta
    QUEDA_TENDENCIA: -0.25,    // A2 queda: últimos 3 meses vs 3 anteriores
    QUEDA_ATING_3M: 0.85,      // A2 só dispara se o atingimento dos últimos 3 meses também for baixo
    VIES_MAX: 0.25,            // A3 forecast otimista
    LASTRO_MIN: 0.60,          // A4 forecast sem lastro no pipeline (mês M+1)
    RISCO_PIPE_MAX: 0.40,      // A5 pipeline envelhecido (participação do kWp aberto com sinal de risco)
    RISCO_MIN_OPS: 5,          // A5 exige ao menos 5 oportunidades abertas
    RAMPA_MESES: 6,            // parceiro credenciado há menos de 6 meses: em rampa, sem A1–A3
    COORTE_MIN: 40,            // mínimo de oportunidades para comparar conversão de um parceiro
    GARGALO_PP: 0.10           // desvio mínimo (pontos percentuais) para apontar gargalo de conversão
  };

  const NOMES_ALERTA = {
    A1: "Abaixo da meta",
    A2: "Queda de resultado",
    A3: "Forecast otimista",
    A4: "Forecast sem lastro",
    A5: "Pipeline envelhecido",
    RAMPA: "Em rampa"
  };
  const NOMES_RISCO = {
    SLA: "Parada acima do prazo da etapa",
    VENCIDA: "Previsão de fechamento vencida",
    PENDENCIA: "Pendência em aberto"
  };

  // ------------------------------------------------------------------ utilidades
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const head = rows.shift().map(h => h.replace(/^\uFEFF/, ""));
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? "" : r[i]])));
  }

  const mesKey = iso => iso.slice(0, 7);
  function addMes(m, k) {
    const [y, mm] = m.split("-").map(Number);
    const t = y * 12 + (mm - 1) + k;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  }
  function difMeses(a, b) { // b - a em meses
    const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
    return (yb * 12 + mb) - (ya * 12 + ma);
  }
  function rangeMeses(a, b) { const out = []; for (let m = a; m <= b; m = addMes(m, 1)) out.push(m); return out; }
  const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const soma = arr => arr.reduce((s, v) => s + v, 0);
  const div = (a, b) => (b > 0 ? a / b : null);
  const r1 = v => Math.round(v * 10) / 10;
  // regras de alerta comparam o percentual na precisão exibida (0,1 p.p.), para a tela nunca contradizer a regra
  const rp = v => (v === null ? null : Math.floor(v * 1000 + 0.5) / 1000);

  // ------------------------------------------------------------------ carga
  function load(texts) {
    const db = {};
    const pg = Object.fromEntries(parseCSV(texts.parametros_gerais).map(r => [r.parametro, r.valor]));
    db.empresa = pg.empresa;
    db.dataCorte = pg.data_corte;
    db.mesesFechados = rangeMeses(pg.primeiro_mes_fechado, pg.ultimo_mes_fechado);
    db.mesesFuturos = rangeMeses(pg.primeiro_mes_futuro, pg.ultimo_mes_futuro);

    db.etapas = parseCSV(texts.parametros_etapas).map(r => ({
      ordem: +r.ordem, etapa: r.etapa, sla: r.sla_dias === "" ? null : +r.sla_dias, prob: +r.probabilidade_ganho
    })).sort((a, b) => a.ordem - b.ordem);
    db.etapaPorNome = Object.fromEntries(db.etapas.map(e => [e.etapa, e]));

    db.parceiros = parseCSV(texts.parceiros).map(r => ({
      id: r.id_parceiro, nome: r.nome_parceiro, regiao: r.regiao, mesCred: mesKey(r.data_credenciamento)
    }));
    db.parceiroPorId = Object.fromEntries(db.parceiros.map(p => [p.id, p]));

    const k = (m, p) => m + "|" + p;
    db.meta = new Map();
    parseCSV(texts.metas).forEach(r => db.meta.set(k(r.mes, r.id_parceiro), +r.meta_kwp));
    db.forecast = new Map();
    parseCSV(texts.forecast).forEach(r => db.forecast.set(k(r.mes, r.id_parceiro), +r.forecast_kwp));

    db.ops = parseCSV(texts.oportunidades).map(r => {
      const e = db.etapaPorNome[r.etapa];
      const o = {
        id: r.id_oportunidade, pid: r.id_parceiro, criacao: r.data_criacao, mesCriacao: mesKey(r.data_criacao),
        segmento: r.segmento, kwp: +r.kwp, status: r.status, etapa: r.etapa, ordem: e.ordem,
        entradaEtapa: r.data_entrada_etapa, ganho: r.data_ganho, perda: r.data_perda,
        motivoPerda: r.motivo_perda, previsao: r.previsao_fechamento, pendencia: r.pendencia
      };
      if (o.status === "Ganha") o.mesGanho = mesKey(o.ganho);
      if (o.status === "Aberta") {
        o.dias = diasEntre(o.entradaEtapa, db.dataCorte);
        o.mesPrevisao = mesKey(o.previsao);
        o.riscos = [];
        if (e.sla !== null && o.dias > e.sla) o.riscos.push("SLA");
        if (o.previsao <= db.dataCorte) o.riscos.push("VENCIDA");
        if (o.pendencia) o.riscos.push("PENDENCIA");
        o.ponderado = o.kwp * e.prob;
        // pipeline ponderado só considera previsão válida (posterior à data de corte)
        o.previsaoValida = o.previsao > db.dataCorte;
      }
      return o;
    });

    db.real = new Map(); db.contratos = new Map();
    db.ops.forEach(o => {
      if (o.status !== "Ganha") return;
      const key = k(o.mesGanho, o.pid);
      db.real.set(key, (db.real.get(key) || 0) + o.kwp);
      db.contratos.set(key, (db.contratos.get(key) || 0) + 1);
    });
    db.key = k;
    return db;
  }

  // ------------------------------------------------------------------ cálculo
  function filtrosPadrao(db) {
    const fe = db.mesesFechados;
    return { de: fe[fe.length - 12], ate: fe[fe.length - 1], parceiro: "Todos", etapa: "Todas" };
  }

  function compute(db, filtros) {
    const f = Object.assign(filtrosPadrao(db), filtros || {});
    if (f.de > f.ate) [f.de, f.ate] = [f.ate, f.de];
    const meses = db.mesesFechados.filter(m => m >= f.de && m <= f.ate);
    const futuros = db.mesesFuturos;
    const m1 = futuros[0];
    const K = db.key;
    const get = (map, m, p) => map.get(K(m, p)) || 0;

    // parceiros considerados: credenciados até o fim do período e dentro do filtro
    const ids = db.parceiros
      .filter(p => (f.parceiro === "Todos" || p.id === f.parceiro) && p.mesCred <= f.ate)
      .map(p => p.id);
    const idSet = new Set(ids);

    const abertasP = db.ops.filter(o => o.status === "Aberta" && idSet.has(o.pid));
    const abertasPE = abertasP.filter(o => f.etapa === "Todas" || o.etapa === f.etapa);

    // ---------------- linhas por parceiro
    const linhas = ids.map(pid => {
      const p = db.parceiroPorId[pid];
      const meta = soma(meses.map(m => get(db.meta, m, pid)));
      const real = soma(meses.map(m => get(db.real, m, pid)));
      const contratos = soma(meses.map(m => get(db.contratos, m, pid)));
      const mesesF = meses.filter(m => db.forecast.has(K(m, pid)));
      const fcH = soma(mesesF.map(m => db.forecast.get(K(m, pid))));
      const realPar = soma(mesesF.map(m => get(db.real, m, pid)));
      const erroAbs = soma(mesesF.map(m => Math.abs(db.forecast.get(K(m, pid)) - get(db.real, m, pid))));
      let tendencia = null, ating3 = null;
      if (meses.length >= 6) {
        const u3 = meses.slice(-3), a3 = meses.slice(-6, -3);
        const ru = soma(u3.map(m => get(db.real, m, pid))), ra = soma(a3.map(m => get(db.real, m, pid)));
        tendencia = ra > 0 ? ru / ra - 1 : null;
        ating3 = div(ru, soma(u3.map(m => get(db.meta, m, pid))));
      }
      const emRampa = difMeses(p.mesCred, f.ate) < LIMIARES.RAMPA_MESES;
      const metaProx = soma(futuros.map(m => get(db.meta, m, pid)));
      const fcProx = soma(futuros.map(m => get(db.forecast, m, pid)));
      const fcM1 = get(db.forecast, m1, pid);
      const ab = abertasP.filter(o => o.pid === pid);
      const pondM1 = soma(ab.filter(o => o.previsaoValida && o.mesPrevisao === m1).map(o => o.ponderado));
      const kwpAberto = soma(ab.map(o => o.kwp));
      const kwpRisco = soma(ab.filter(o => o.riscos.length).map(o => o.kwp));
      const linha = {
        id: pid, nome: p.nome, regiao: p.regiao, mesCred: p.mesCred, emRampa,
        meta, realizado: r1(real), atingimento: div(real, meta), gap: r1(meta - real), contratos,
        forecastHist: fcH, realPareado: r1(realPar), vies: mesesF.length >= 3 ? div(fcH - realPar, realPar) : null,
        erroAbs: r1(erroAbs), mesesComForecast: mesesF.length,
        tendencia, ating3,
        metaProx, forecastProx: fcProx, cobertura: div(fcProx, metaProx),
        forecastM1: fcM1, pondM1: r1(pondM1), lastroM1: div(pondM1, fcM1),
        abertasQtd: ab.length, kwpAberto: r1(kwpAberto), riscoPipe: div(kwpRisco, kwpAberto),
        alertas: []
      };
      const A = linha.alertas;
      const at = rp(linha.atingimento), td = rp(tendencia), a3 = rp(ating3), vs = rp(linha.vies), ls = rp(linha.lastroM1), rk = rp(linha.riscoPipe);
      if (emRampa) A.push("RAMPA");
      else {
        if (at !== null && at < LIMIARES.ATINGIMENTO_MIN) A.push("A1");
        if (td !== null && td <= LIMIARES.QUEDA_TENDENCIA && a3 !== null && a3 < LIMIARES.QUEDA_ATING_3M) A.push("A2");
        if (vs !== null && vs > LIMIARES.VIES_MAX) A.push("A3");
      }
      if (ls !== null && ls < LIMIARES.LASTRO_MIN) A.push("A4");
      if (ab.length >= LIMIARES.RISCO_MIN_OPS && rk !== null && rk >= LIMIARES.RISCO_PIPE_MAX) A.push("A5");
      return linha;
    });

    // ---------------- KPIs do período (somados direto da base, não das linhas)
    const somaMapa = (map, ms) => soma(ms.map(m => soma(ids.map(pid => get(map, m, pid)))));
    const meta = somaMapa(db.meta, meses);
    const realizado = r1(somaMapa(db.real, meses));
    const pares = [];
    meses.forEach(m => ids.forEach(pid => {
      if (db.forecast.has(K(m, pid))) pares.push([db.forecast.get(K(m, pid)), get(db.real, m, pid)]);
    }));
    const fcPar = soma(pares.map(x => x[0])), rPar = soma(pares.map(x => x[1]));
    const kpis = {
      meta, realizado, atingimento: div(realizado, meta), gap: r1(meta - realizado),
      contratos: somaMapa(db.contratos, meses),
      vies: div(fcPar - rPar, rPar),
      wape: div(soma(pares.map(x => Math.abs(x[0] - x[1]))), rPar),
      parceirosAtivos: ids.length
    };

    // ---------------- projeção (meses futuros; não depende do filtro de período nem de etapa)
    const pondPorMes = futuros.map(m => r1(soma(abertasP.filter(o => o.previsaoValida && o.mesPrevisao === m).map(o => o.ponderado))));
    const projecao = {
      meses: futuros,
      meta: somaMapa(db.meta, futuros),
      forecast: somaMapa(db.forecast, futuros),
      forecastM1: somaMapa(db.forecast, [m1]),
      pondM1: pondPorMes[0],
      pondHorizonte: r1(soma(pondPorMes))
    };
    projecao.cobertura = div(projecao.forecast, projecao.meta);
    projecao.lastroM1 = div(projecao.pondM1, projecao.forecastM1);

    // ---------------- série mensal
    const serie = meses.map(m => {
      const comF = ids.filter(pid => db.forecast.has(K(m, pid)));
      const mt = soma(ids.map(pid => get(db.meta, m, pid)));
      const rl = r1(soma(ids.map(pid => get(db.real, m, pid))));
      return { mes: m, tipo: "fechado", meta: mt, realizado: rl, atingimento: div(rl, mt),
               forecastRegistrado: comF.length ? soma(comF.map(pid => db.forecast.get(K(m, pid)))) : null };
    }).concat(futuros.map((m, i) => ({
      mes: m, tipo: "futuro", meta: soma(ids.map(pid => get(db.meta, m, pid))),
      forecast: soma(ids.map(pid => get(db.forecast, m, pid))), pipelinePonderado: pondPorMes[i]
    })));

    // ---------------- funil
    const coorte = db.ops.filter(o => idSet.has(o.pid) && o.mesCriacao >= f.de && o.mesCriacao <= f.ate);
    const atingiu = db.etapas.map(e => coorte.filter(o => o.ordem >= e.ordem).length);
    const conversao = db.etapas.slice(0, -1).map((e, i) => ({
      de: e.etapa, para: db.etapas[i + 1].etapa, base: atingiu[i], avancaram: atingiu[i + 1], taxa: div(atingiu[i + 1], atingiu[i])
    }));
    const perdidas = coorte.filter(o => o.status === "Perdida");
    const motivos = {};
    perdidas.forEach(o => { const m = motivos[o.motivoPerda] || (motivos[o.motivoPerda] = { motivo: o.motivoPerda, qtd: 0, kwp: 0 }); m.qtd++; m.kwp += o.kwp; });
    const funil = {
      coorteQtd: coorte.length,
      coorteAbertaPct: div(coorte.filter(o => o.status === "Aberta").length, coorte.length),
      atingiu: db.etapas.map((e, i) => ({ etapa: e.etapa, qtd: atingiu[i] })),
      conversao,
      conversaoGlobal: div(atingiu[atingiu.length - 1], atingiu[0]),
      motivosPerda: Object.values(motivos).map(m => ({ ...m, kwp: r1(m.kwp) })).sort((a, b) => b.qtd - a.qtd),
      pipelineAberto: db.etapas.slice(0, -1).map(e => {
        const ab = abertasPE.filter(o => o.etapa === e.etapa);
        return { etapa: e.etapa, qtd: ab.length, kwp: r1(soma(ab.map(o => o.kwp))), ponderado: r1(soma(ab.map(o => o.ponderado))),
                 emRisco: ab.filter(o => o.riscos.length).length };
      })
    };

    // gargalo de conversão por parceiro (somente sem filtro de parceiro)
    funil.gargalos = [];
    if (f.parceiro === "Todos") {
      ids.forEach(pid => {
        const c = coorte.filter(o => o.pid === pid);
        db.etapas.slice(0, -1).forEach((e, i) => {
          const base = c.filter(o => o.ordem >= e.ordem).length;
          if (base < LIMIARES.COORTE_MIN || conversao[i].taxa === null) return;
          const taxa = c.filter(o => o.ordem >= e.ordem + 1).length / base;
          const desvio = taxa - conversao[i].taxa;
          if (desvio <= -LIMIARES.GARGALO_PP) funil.gargalos.push({ id: pid, nome: db.parceiroPorId[pid].nome, de: e.etapa, para: db.etapas[i + 1].etapa, taxa, media: conversao[i].taxa, desvio, base });
        });
      });
      funil.gargalos.sort((a, b) => a.desvio - b.desvio);
    }

    // ---------------- riscos e oportunidades prioritárias (pipeline aberto na data de corte)
    const nomeP = pid => db.parceiroPorId[pid].nome;
    const riscos = abertasPE.filter(o => o.riscos.length).map(o => ({
      id: o.id, parceiro: nomeP(o.pid), pid: o.pid, etapa: o.etapa, kwp: o.kwp, ponderado: r1(o.ponderado), dias: o.dias,
      sla: db.etapaPorNome[o.etapa].sla, previsao: o.previsao, pendencia: o.pendencia, riscos: o.riscos
    })).sort((a, b) => b.ponderado - a.ponderado || b.kwp - a.kwp);
    const resumoRiscos = Object.keys(NOMES_RISCO).map(cod => {
      const l = riscos.filter(r => r.riscos.includes(cod));
      return { codigo: cod, nome: NOMES_RISCO[cod], qtd: l.length, kwp: r1(soma(l.map(r => r.kwp))) };
    });
    const pendencias = {};
    riscos.filter(r => r.pendencia).forEach(r => { const p = pendencias[r.pendencia] || (pendencias[r.pendencia] = { pendencia: r.pendencia, qtd: 0, kwp: 0 }); p.qtd++; p.kwp += r.kwp; });
    const prioritarias = abertasPE
      .filter(o => o.etapa === "Negociação" && !o.riscos.length && o.mesPrevisao === m1)
      .sort((a, b) => b.kwp - a.kwp)
      .map(o => ({ id: o.id, parceiro: nomeP(o.pid), pid: o.pid, etapa: o.etapa, kwp: o.kwp, ponderado: r1(o.ponderado), dias: o.dias, previsao: o.previsao }));

    const res = {
      filtros: f, meses, kpis, projecao, serie, parceiros: linhas, funil,
      riscos, resumoRiscos, pendencias: Object.values(pendencias).map(p => ({ ...p, kwp: r1(p.kwp) })).sort((a, b) => b.kwp - a.kwp),
      prioritarias, totalAbertas: abertasPE.length, kwpAberto: r1(soma(abertasPE.map(o => o.kwp))),
      dataCorte: db.dataCorte
    };
    res.conclusoes = conclusoes(res, db);
    return res;
  }

  // ------------------------------------------------------------------ formatação pt-BR
  const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt = {
    kwp: v => (v === null || v === undefined ? "–" : nf0.format(Math.round(v)) + " kWp"),
    num: v => (v === null || v === undefined ? "–" : nf0.format(Math.round(v))),
    pct: v => (v === null || v === undefined ? "–" : nf1.format(v * 100) + "%"),
    pctSinal: v => (v === null || v === undefined ? "–" : (v > 0 ? "+" : "") + nf1.format(v * 100) + "%"),
    pct0: v => (v === null || v === undefined ? "–" : nf0.format(v * 100) + "%"),
    pp: v => nf1.format(Math.abs(v * 100)) + " p.p.",
    mes: m => { const n = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]; const [y, mm] = m.split("-"); return n[+mm - 1] + "/" + y.slice(2); },
    data: iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "–"
  };
  const lista = arr => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " e " + arr[arr.length - 1];

  // ------------------------------------------------------------------ conclusões e recomendações (regras sobre os dados)
  function conclusoes(r, db) {
    const out = [];
    const k = r.kpis, f = r.filtros;
    const periodo = `${fmt.mes(f.de)} a ${fmt.mes(f.ate)}`;
    const umParceiro = f.parceiro !== "Todos";
    const ativos = r.parceiros.filter(p => !p.emRampa);

    // 1. Resultado
    if (k.meta > 0) {
      let t = `De ${periodo}, o realizado foi ${fmt.kwp(k.realizado)}, ${fmt.pct(k.atingimento)} da meta de ${fmt.kwp(k.meta)}`;
      t += k.gap > 0 ? ` (faltaram ${fmt.kwp(k.gap)}).` : ` (superou em ${fmt.kwp(-k.gap)}).`;
      if (!umParceiro) {
        const abaixo = ativos.filter(p => p.alertas.includes("A1"));
        t += ` ${abaixo.length} de ${ativos.length} parceiros fora de rampa ${abaixo.length === 1 ? "ficou" : "ficaram"} abaixo de ${fmt.pct0(LIMIARES.ATINGIMENTO_MIN)} de atingimento.`;
      }
      out.push({ tipo: "diagnostico", titulo: "Resultado", texto: t });
    }

    // 2. Concentração do gap
    if (!umParceiro && k.gap > 0) {
      const comGap = r.parceiros.filter(p => p.gap > 0).sort((a, b) => b.gap - a.gap);
      const top = comGap.slice(0, 3);
      const somaGapPos = soma(comGap.map(p => p.gap));
      if (top.length) out.push({ tipo: "diagnostico", titulo: "Onde está o gap",
        texto: `${lista(top.map(p => p.nome))} concentram ${fmt.pct(soma(top.map(p => p.gap)) / somaGapPos)} da soma dos gaps individuais (${fmt.kwp(somaGapPos)}).` });
    }

    // 3. Funil
    const conv = r.funil.conversao.filter(c => c.taxa !== null);
    if (conv.length) {
      const pior = conv.slice().sort((a, b) => a.taxa - b.taxa)[0];
      let t = `Na coorte criada no período (${fmt.num(r.funil.coorteQtd)} oportunidades), a menor conversão entre etapas é ${pior.de} → ${pior.para}: ${fmt.pct(pior.taxa)}. Conversão total até contrato: ${fmt.pct(r.funil.conversaoGlobal)}.`;
      if (r.funil.coorteAbertaPct > 0.15) t += ` ${fmt.pct(r.funil.coorteAbertaPct)} da coorte ainda está em aberto, o que reduz as taxas das etapas finais.`;
      out.push({ tipo: "diagnostico", titulo: "Funil", texto: t });
    }

    // 4. Forecast
    const pj = r.projecao;
    let tf = `O forecast declarado para ${fmt.mes(pj.meses[0])}–${fmt.mes(pj.meses[pj.meses.length - 1])} soma ${fmt.kwp(pj.forecast)}, ${fmt.pct(pj.cobertura)} da meta do trimestre. Para ${fmt.mes(pj.meses[0])}, o pipeline ponderado sustenta ${fmt.pct(pj.lastroM1)} do forecast.`;
    if (k.vies !== null) tf += ` No período analisado, o forecast registrado no início de cada mês ficou ${fmt.pctSinal(k.vies)} em relação ao realizado.`;
    out.push({ tipo: "diagnostico", titulo: "Forecast", texto: tf });

    // 5. Riscos
    if (r.riscos.length) {
      const top = r.resumoRiscos.slice().sort((a, b) => b.kwp - a.kwp)[0];
      out.push({ tipo: "diagnostico", titulo: "Riscos no pipeline",
        texto: `${fmt.num(r.riscos.length)} de ${fmt.num(r.totalAbertas)} oportunidades abertas têm ao menos um sinal de risco, somando ${fmt.kwp(soma(r.riscos.map(x => x.kwp)))}. O sinal com mais volume é "${top.nome.toLowerCase()}" (${fmt.kwp(top.kwp)}).` });
    }

    // ---- recomendações (cada uma aponta a regra que a originou)
    const com = cod => r.parceiros.filter(p => p.alertas.includes(cod));
    const nomes = arr => lista(arr.map(p => p.nome));
    const a4 = com("A4"), a3 = com("A3");
    if (a4.length || a3.length) {
      const partes = [];
      if (a4.length) partes.push(`${nomes(a4)} ${a4.length > 1 ? "têm" : "tem"} forecast de ${fmt.mes(pj.meses[0])} com menos de ${fmt.pct0(LIMIARES.LASTRO_MIN)} de lastro no pipeline ponderado`);
      if (a3.length) partes.push(`${nomes(a3)} ${a3.length > 1 ? "registraram" : "registrou"} forecast mais de ${fmt.pct0(LIMIARES.VIES_MAX)} acima do realizado no período`);
      out.push({ tipo: "recomendacao", titulo: "Revisar o forecast antes do fechamento", texto: partes.join("; ") + ". Sugere-se validar oportunidade a oportunidade o que sustenta o número comprometido." });
    }
    com("A2").forEach(p => {
      const criadasU3 = db.ops.filter(o => o.pid === p.id && r.meses.slice(-3).includes(o.mesCriacao)).length;
      const criadasA3 = db.ops.filter(o => o.pid === p.id && r.meses.slice(-6, -3).includes(o.mesCriacao)).length;
      const varOrig = criadasA3 > 0 ? criadasU3 / criadasA3 - 1 : null;
      out.push({ tipo: "recomendacao", titulo: `Entender a queda do ${p.nome}`,
        texto: `Realizado dos últimos 3 meses ${fmt.pctSinal(p.tendencia)} frente aos 3 anteriores, com atingimento de ${fmt.pct(p.ating3)} no trimestre. A criação de oportunidades variou ${fmt.pctSinal(varOrig)} no mesmo intervalo${varOrig !== null && varOrig < -0.15 ? ", o que aponta para originação de leads como primeira hipótese" : ", o que sugere investigar conversão e ciclo antes da originação"}.` });
    });
    const a5 = com("A5");
    if (a5.length) {
      const detalhes = a5.map(p => {
        const pend = {};
        r.riscos.filter(x => x.pid === p.id && x.pendencia).forEach(x => { pend[x.pendencia] = (pend[x.pendencia] || 0) + x.kwp; });
        const principal = Object.entries(pend).sort((a, b) => b[1] - a[1])[0];
        return `${p.nome} (${fmt.pct(p.riscoPipe)} do kWp aberto em risco${principal ? `; principal pendência: ${principal[0].toLowerCase()}` : ""})`;
      });
      out.push({ tipo: "recomendacao", titulo: "Destravar pipeline envelhecido", texto: `${lista(detalhes)}. Sugere-se uma revisão dedicada das oportunidades paradas, começando pelas de maior kWp ponderado.` });
    }
    if (r.funil.gargalos.length) {
      const g = r.funil.gargalos[0];
      out.push({ tipo: "recomendacao", titulo: `Apoiar a etapa ${g.de} no ${g.nome}`,
        texto: `A conversão ${g.de} → ${g.para} do parceiro é ${fmt.pct(g.taxa)}, ${fmt.pp(g.desvio)} abaixo da média do canal (${fmt.pct(g.media)}), com base em ${fmt.num(g.base)} oportunidades.` });
    }
    if (r.prioritarias.length) {
      const kw = soma(r.prioritarias.map(o => o.kwp));
      out.push({ tipo: "recomendacao", titulo: "Proteger as negociações do mês",
        texto: `${r.prioritarias.length} negociações sem sinal de risco têm previsão para ${fmt.mes(pj.meses[0])}, somando ${fmt.kwp(kw)}. As maiores merecem acompanhamento semanal até a assinatura.` });
    }
    return out;
  }

  return { load, compute, filtrosPadrao, rp, parseCSV, fmt, LIMIARES, NOMES_ALERTA, NOMES_RISCO, addMes, rangeMeses };
});
