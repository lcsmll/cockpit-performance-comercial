// Executa o MESMO motor de cálculo usado pela interface (assets/engine.js) para um conjunto de
// cenários de filtro e grava os resultados em validacao/kpis_app.json.
// Uso:  node validacao/exportar_kpis_app.js
const fs = require("fs");
const path = require("path");
const raiz = path.resolve(__dirname, "..");
const Engine = require(path.join(raiz, "assets", "engine.js"));
const cenarios = require(path.join(__dirname, "cenarios.json"));

const nomes = ["parceiros", "metas", "forecast", "oportunidades", "parametros_etapas", "parametros_gerais"];
const textos = Object.fromEntries(nomes.map(n => [n, fs.readFileSync(path.join(raiz, "data", n + ".csv"), "utf8")]));
const db = Engine.load(textos);

const saida = cenarios.map(c => {
  const r = Engine.compute(db, c.filtros);
  return {
    nome: c.nome,
    filtros: r.filtros,
    kpis: r.kpis,
    projecao: r.projecao,
    serie: r.serie,
    parceiros: r.parceiros.map(p => ({
      id: p.id, meta: p.meta, realizado: p.realizado, atingimento: p.atingimento, vies: p.vies,
      tendencia: p.tendencia, lastroM1: p.lastroM1, riscoPipe: p.riscoPipe, alertas: p.alertas
    })),
    conversao: r.funil.conversao.map(c => ({ de: c.de, taxa: c.taxa, base: c.base })),
    pipelineAberto: r.funil.pipelineAberto,
    resumoRiscos: r.resumoRiscos,
    qtdRiscos: r.riscos.length,
    qtdPrioritarias: r.prioritarias.length
  };
});
fs.writeFileSync(path.join(__dirname, "kpis_app.json"), JSON.stringify(saida, null, 1));
console.log(`kpis_app.json gravado com ${saida.length} cenários.`);
