"""
Validação independente dos KPIs do Cockpit de Performance Comercial (dados fictícios).

O script faz duas coisas:
  1. Testes de integridade da base (chaves, datas, etapas, separação entre realizado e projeção).
  2. Recalcula, com pandas e sem reaproveitar código da interface, os indicadores de cada cenário em
     validacao/cenarios.json. Se existir validacao/kpis_app.json (gerado por exportar_kpis_app.js a
     partir do motor usado na tela), compara os dois resultados número a número.

Uso:
    node validacao/exportar_kpis_app.js     # opcional, gera os números da interface
    python validacao/validar_kpis.py        # imprime o relatório e grava relatorio_validacao.md
Requisitos: Python 3.10+, pandas.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
DADOS = RAIZ / "data"
VAL = Path(__file__).resolve().parent
TOL_KWP = 0.11       # tolerância de arredondamento (kWp, 1 casa decimal)
TOL_PCT = 1e-6


def rp(v):
    """Percentual na precisão exibida (0,1 p.p.), usado nas regras de alerta."""
    import math
    return None if v is None else math.floor(v * 1000 + 0.5) / 1000

# Limiares das regras (mesmos valores documentados no dicionário de dados)
L = dict(ATING=0.80, QUEDA=-0.25, ATING3=0.85, VIES=0.25, LASTRO=0.60, RISCO=0.40, RISCO_MIN=5, RAMPA=6)

# ---------------------------------------------------------------- carga
parc = pd.read_csv(DADOS / "parceiros.csv")
metas = pd.read_csv(DADOS / "metas.csv")
fc = pd.read_csv(DADOS / "forecast.csv")
ops = pd.read_csv(DADOS / "oportunidades.csv", keep_default_na=False)
etp = pd.read_csv(DADOS / "parametros_etapas.csv", keep_default_na=False)
pg = pd.read_csv(DADOS / "parametros_gerais.csv").set_index("parametro")["valor"]

CORTE = pd.Timestamp(pg["data_corte"])
FECHADOS = pd.period_range(pg["primeiro_mes_fechado"], pg["ultimo_mes_fechado"], freq="M").strftime("%Y-%m").tolist()
FUTUROS = pd.period_range(pg["primeiro_mes_futuro"], pg["ultimo_mes_futuro"], freq="M").strftime("%Y-%m").tolist()
ORDEM = dict(zip(etp.etapa, etp.ordem))
PROB = dict(zip(etp.etapa, etp.probabilidade_ganho.astype(float)))
SLA = {e: (int(s) if s != "" else None) for e, s in zip(etp.etapa, etp.sla_dias)}

ops["kwp"] = ops.kwp.astype(float)
ops["ordem"] = ops.etapa.map(ORDEM)
ops["mes_criacao"] = ops.data_criacao.str[:7]
ops["mes_ganho"] = ops.data_ganho.str[:7]
parc["mes_cred"] = parc.data_credenciamento.str[:7]

ab = ops[ops.status == "Aberta"].copy()
ab["dias"] = (CORTE - pd.to_datetime(ab.data_entrada_etapa)).dt.days
ab["r_sla"] = ab.apply(lambda r: SLA[r.etapa] is not None and r.dias > SLA[r.etapa], axis=1)
ab["r_venc"] = pd.to_datetime(ab.previsao_fechamento) <= CORTE
ab["r_pend"] = ab.pendencia != ""
ab["em_risco"] = ab.r_sla | ab.r_venc | ab.r_pend
ab["pond"] = ab.kwp * ab.etapa.map(PROB)
ab["mes_prev"] = ab.previsao_fechamento.str[:7]
ab["prev_valida"] = pd.to_datetime(ab.previsao_fechamento) > CORTE

ganhas = ops[ops.status == "Ganha"]
real_pm = ganhas.groupby(["mes_ganho", "id_parceiro"]).kwp.sum()
real_pm.index.names = ["mes", "id_parceiro"]

# ---------------------------------------------------------------- 1. integridade
testes: list[tuple[str, bool, str]] = []


def teste(nome: str, ok: bool, detalhe: str = "") -> None:
    testes.append((nome, bool(ok), detalhe))


teste("IDs de oportunidade únicos", ops.id_oportunidade.is_unique)
teste("Todo parceiro das tabelas existe no cadastro",
      set(ops.id_parceiro) | set(metas.id_parceiro) | set(fc.id_parceiro) <= set(parc.id_parceiro))
teste("Uma meta por parceiro-mês", not metas.duplicated(["mes", "id_parceiro"]).any())
teste("Um forecast por parceiro-mês", not fc.duplicated(["mes", "id_parceiro"]).any())
teste("Metas cobrem só meses fechados e futuros", set(metas.mes) <= set(FECHADOS + FUTUROS))
teste("Nenhum realizado em mês futuro (realizado e projeção separados)",
      not ganhas.mes_ganho.isin(FUTUROS).any() and (pd.to_datetime(ganhas.data_ganho) <= CORTE).all())
teste("Nenhum ganho fora da janela de meses fechados", ganhas.mes_ganho.isin(FECHADOS).all())
teste("Forecast de meses futuros marcado como 'mes_futuro'",
      (fc[fc.mes.isin(FUTUROS)].horizonte == "mes_futuro").all() and (fc[fc.mes.isin(FECHADOS)].horizonte == "mes_fechado").all())
teste("Status coerente com etapa (ganha = Contrato; aberta/perdida ≠ Contrato)",
      (ops[ops.status == "Ganha"].etapa == "Contrato").all() and (ops[ops.status != "Ganha"].etapa != "Contrato").all())
teste("Datas em ordem: criação ≤ entrada na etapa ≤ ganho/perda",
      (ops.data_criacao <= ops.data_entrada_etapa).all()
      and (ops[ops.status == "Ganha"].data_entrada_etapa <= ops[ops.status == "Ganha"].data_ganho).all()
      and (ops[ops.status == "Perdida"].data_entrada_etapa <= ops[ops.status == "Perdida"].data_perda).all())
teste("Abertas têm previsão de fechamento; concluídas não", (ab.previsao_fechamento != "").all()
      and (ops[ops.status != "Aberta"].previsao_fechamento == "").all())
teste("Perdidas têm motivo de perda", (ops[ops.status == "Perdida"].motivo_perda != "").all())
teste("kWp positivo", (ops.kwp > 0).all())
teste("Nenhuma oportunidade criada após a data de corte", (pd.to_datetime(ops.data_criacao) <= CORTE).all())
teste("Meta só existe após o credenciamento",
      metas.merge(parc, on="id_parceiro").pipe(lambda d: (d.mes >= d.mes_cred).all()))

# probabilidades de etapa x taxa empírica de ganho a partir de cada etapa (oportunidades concluídas)
conc = ops[ops.status.isin(["Ganha", "Perdida"])]
for e in etp.etapa[:-1]:
    base = conc[conc.ordem >= ORDEM[e]]
    emp = (base.status == "Ganha").mean()
    teste(f"Probabilidade de '{e}' aderente ao histórico (±3 p.p.)", abs(emp - PROB[e]) <= 0.03,
          f"parâmetro {PROB[e]:.2f} vs empírico {emp:.3f}")


# ---------------------------------------------------------------- 2. recálculo por cenário
def recalc(fl: dict) -> dict:
    de, ate = sorted([fl["de"], fl["ate"]])
    meses = [m for m in FECHADOS if de <= m <= ate]
    pids = parc[(parc.mes_cred <= ate) & ((fl["parceiro"] == "Todos") | (parc.id_parceiro == fl["parceiro"]))].id_parceiro.tolist()

    mt = metas[metas.mes.isin(meses) & metas.id_parceiro.isin(pids)]
    gn = ganhas[ganhas.mes_ganho.isin(meses) & ganhas.id_parceiro.isin(pids)]
    fh = fc[fc.mes.isin(meses) & fc.id_parceiro.isin(pids)].copy()
    fh["real"] = [real_pm.get((m, p), 0.0) for m, p in zip(fh.mes, fh.id_parceiro)]

    k = {
        "meta": float(mt.meta_kwp.sum()),
        "realizado": round(float(gn.kwp.sum()), 1),
        "contratos": int(len(gn)),
    }
    k["atingimento"] = k["realizado"] / k["meta"] if k["meta"] else None
    k["gap"] = round(k["meta"] - k["realizado"], 1)
    k["vies"] = (fh.forecast_kwp.sum() - fh.real.sum()) / fh.real.sum() if fh.real.sum() else None
    k["wape"] = (fh.forecast_kwp - fh.real).abs().sum() / fh.real.sum() if fh.real.sum() else None

    abp = ab[ab.id_parceiro.isin(pids)]
    abpe = abp if fl["etapa"] == "Todas" else abp[abp.etapa == fl["etapa"]]
    m1 = FUTUROS[0]
    fut_meta = metas[metas.mes.isin(FUTUROS) & metas.id_parceiro.isin(pids)].meta_kwp.sum()
    fut_fc = fc[fc.mes.isin(FUTUROS) & fc.id_parceiro.isin(pids)].forecast_kwp.sum()
    fc_m1 = fc[(fc.mes == m1) & fc.id_parceiro.isin(pids)].forecast_kwp.sum()
    pond_m1 = abp[abp.prev_valida & (abp.mes_prev == m1)].pond.sum()
    proj = {"meta": float(fut_meta), "forecast": float(fut_fc), "cobertura": fut_fc / fut_meta if fut_meta else None,
            "pondM1": round(float(pond_m1), 1), "lastroM1": pond_m1 / fc_m1 if fc_m1 else None}

    # série mensal (meses fechados)
    serie = []
    for m in meses:
        serie.append({"mes": m, "meta": float(mt[mt.mes == m].meta_kwp.sum()),
                      "realizado": round(float(gn[gn.mes_ganho == m].kwp.sum()), 1)})

    # parceiros
    linhas = {}
    for pid in pids:
        cred = parc.set_index("id_parceiro").mes_cred[pid]
        rampa = (pd.Period(ate, "M") - pd.Period(cred, "M")).n < L["RAMPA"]
        meta_p = mt[mt.id_parceiro == pid].meta_kwp.sum()
        real_p = gn[gn.id_parceiro == pid].kwp.sum()
        f_p = fh[fh.id_parceiro == pid]
        vies = (f_p.forecast_kwp.sum() - f_p.real.sum()) / f_p.real.sum() if len(f_p) >= 3 and f_p.real.sum() else None
        tend = at3 = None
        if len(meses) >= 6:
            u3, a3 = meses[-3:], meses[-6:-3]
            ru = gn[(gn.id_parceiro == pid) & gn.mes_ganho.isin(u3)].kwp.sum()
            ra = gn[(gn.id_parceiro == pid) & gn.mes_ganho.isin(a3)].kwp.sum()
            mu3 = mt[(mt.id_parceiro == pid) & mt.mes.isin(u3)].meta_kwp.sum()
            tend = ru / ra - 1 if ra else None
            at3 = ru / mu3 if mu3 else None
        a_p = abp[abp.id_parceiro == pid]
        fcm1 = fc[(fc.mes == m1) & (fc.id_parceiro == pid)].forecast_kwp.sum()
        pm1 = a_p[a_p.prev_valida & (a_p.mes_prev == m1)].pond.sum()
        lastro = pm1 / fcm1 if fcm1 else None
        risco = a_p[a_p.em_risco].kwp.sum() / a_p.kwp.sum() if a_p.kwp.sum() else None
        ating = real_p / meta_p if meta_p else None
        al = []
        ating_r, tend_r, at3_r, vies_r, lastro_r, risco_r = map(rp, (real_p / meta_p if meta_p else None, tend, at3, vies, lastro, risco))
        if rampa:
            al.append("RAMPA")
        else:
            if ating_r is not None and ating_r < L["ATING"]:
                al.append("A1")
            if tend_r is not None and tend_r <= L["QUEDA"] and at3_r is not None and at3_r < L["ATING3"]:
                al.append("A2")
            if vies_r is not None and vies_r > L["VIES"]:
                al.append("A3")
        if lastro_r is not None and lastro_r < L["LASTRO"]:
            al.append("A4")
        if len(a_p) >= L["RISCO_MIN"] and risco_r is not None and risco_r >= L["RISCO"]:
            al.append("A5")
        linhas[pid] = {"meta": float(meta_p), "realizado": round(float(real_p), 1), "atingimento": ating, "vies": vies,
                       "tendencia": tend, "lastroM1": lastro, "riscoPipe": risco, "alertas": al}

    # funil por coorte de criação
    co = ops[ops.id_parceiro.isin(pids) & (ops.mes_criacao >= de) & (ops.mes_criacao <= ate)]
    ating_et = [int((co.ordem >= o).sum()) for o in etp.ordem]
    conv = [{"de": etp.etapa[i], "base": ating_et[i], "taxa": ating_et[i + 1] / ating_et[i] if ating_et[i] else None}
            for i in range(len(etp) - 1)]
    pipe = []
    for e in etp.etapa[:-1]:
        x = abpe[abpe.etapa == e]
        pipe.append({"etapa": e, "qtd": int(len(x)), "kwp": round(float(x.kwp.sum()), 1),
                     "ponderado": round(float(x.pond.sum()), 1), "emRisco": int(x.em_risco.sum())})
    riscos = abpe[abpe.em_risco]
    res_r = [{"codigo": "SLA", "qtd": int(riscos.r_sla.sum()), "kwp": round(float(riscos[riscos.r_sla].kwp.sum()), 1)},
             {"codigo": "VENCIDA", "qtd": int(riscos.r_venc.sum()), "kwp": round(float(riscos[riscos.r_venc].kwp.sum()), 1)},
             {"codigo": "PENDENCIA", "qtd": int(riscos.r_pend.sum()), "kwp": round(float(riscos[riscos.r_pend].kwp.sum()), 1)}]
    prior = abpe[(abpe.etapa == "Negociação") & ~abpe.em_risco & (abpe.mes_prev == m1)]
    return {"kpis": k, "projecao": proj, "serie": serie, "parceiros": linhas, "conversao": conv,
            "pipelineAberto": pipe, "resumoRiscos": res_r, "qtdRiscos": int(len(riscos)), "qtdPrioritarias": int(len(prior))}


def igual(a, b, tol) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) <= tol


def main() -> int:
    cenarios = json.loads((VAL / "cenarios.json").read_text(encoding="utf-8"))
    app_path = VAL / "kpis_app.json"
    app = {c["nome"]: c for c in json.loads(app_path.read_text(encoding="utf-8"))} if app_path.exists() else {}
    comparacoes: list[tuple[str, int, int, list[str]]] = []
    resumos = []

    for c in cenarios:
        py = recalc(c["filtros"])
        k = py["kpis"]
        resumos.append((c["nome"], k, py["projecao"]))

        # coerências internas (independem da interface)
        teste(f"[{c['nome']}] soma das linhas de parceiro = total (meta e realizado)",
              igual(sum(p["meta"] for p in py["parceiros"].values()), k["meta"], TOL_KWP)
              and igual(sum(p["realizado"] for p in py["parceiros"].values()), k["realizado"], TOL_KWP * len(py["parceiros"])))
        teste(f"[{c['nome']}] soma da série mensal = total do período",
              igual(sum(s["meta"] for s in py["serie"]), k["meta"], TOL_KWP)
              and igual(sum(s["realizado"] for s in py["serie"]), k["realizado"], TOL_KWP * len(py["serie"])))
        teste(f"[{c['nome']}] funil monotônico (cada etapa ≤ anterior)",
              all(py["conversao"][i]["base"] >= py["conversao"][i + 1]["base"] for i in range(len(py["conversao"]) - 1)))

        if c["nome"] not in app:
            continue
        a = app[c["nome"]]
        dif: list[str] = []

        def cmp(rotulo, va, vb, tol):
            if not igual(va, vb, tol):
                dif.append(f"{rotulo}: app={va} python={vb}")
            return 1

        total = 0
        for chave, tol in [("meta", TOL_KWP), ("realizado", TOL_KWP), ("contratos", 0), ("atingimento", TOL_PCT),
                           ("gap", TOL_KWP), ("vies", TOL_PCT), ("wape", TOL_PCT)]:
            total += cmp(f"kpi.{chave}", a["kpis"][chave], k[chave], tol)
        for chave, tol in [("meta", TOL_KWP), ("forecast", TOL_KWP), ("cobertura", TOL_PCT), ("pondM1", TOL_KWP), ("lastroM1", 1e-3)]:
            total += cmp(f"projecao.{chave}", a["projecao"][chave], py["projecao"][chave], tol)
        serie_app = {s["mes"]: s for s in a["serie"] if s["tipo"] == "fechado"}
        for s in py["serie"]:
            total += cmp(f"serie.{s['mes']}.meta", serie_app[s["mes"]]["meta"], s["meta"], TOL_KWP)
            total += cmp(f"serie.{s['mes']}.realizado", serie_app[s["mes"]]["realizado"], s["realizado"], TOL_KWP)
        teste(f"[{c['nome']}] série do app não mistura realizado em meses futuros",
              all("realizado" not in s for s in a["serie"] if s["tipo"] == "futuro"))
        parc_app = {p["id"]: p for p in a["parceiros"]}
        total += cmp("parceiros.qtd", len(parc_app), len(py["parceiros"]), 0)
        for pid, p in py["parceiros"].items():
            pa = parc_app.get(pid)
            if pa is None:
                dif.append(f"parceiro {pid} ausente no app")
                continue
            for chave, tol in [("meta", TOL_KWP), ("realizado", TOL_KWP), ("atingimento", TOL_PCT), ("vies", TOL_PCT),
                               ("tendencia", TOL_PCT), ("lastroM1", 1e-3), ("riscoPipe", TOL_PCT)]:
                total += cmp(f"{pid}.{chave}", pa[chave], p[chave], tol)
            total += 1
            if sorted(pa["alertas"]) != sorted(p["alertas"]):
                dif.append(f"{pid}.alertas: app={pa['alertas']} python={p['alertas']}")
        for i, cv in enumerate(py["conversao"]):
            total += cmp(f"conversao.{cv['de']}.base", a["conversao"][i]["base"], cv["base"], 0)
            total += cmp(f"conversao.{cv['de']}.taxa", a["conversao"][i]["taxa"], cv["taxa"], TOL_PCT)
        for i, pp in enumerate(py["pipelineAberto"]):
            for chave, tol in [("qtd", 0), ("kwp", TOL_KWP), ("ponderado", TOL_KWP), ("emRisco", 0)]:
                total += cmp(f"pipeline.{pp['etapa']}.{chave}", a["pipelineAberto"][i][chave], pp[chave], tol)
        for i, rr in enumerate(py["resumoRiscos"]):
            total += cmp(f"riscos.{rr['codigo']}.qtd", a["resumoRiscos"][i]["qtd"], rr["qtd"], 0)
            total += cmp(f"riscos.{rr['codigo']}.kwp", a["resumoRiscos"][i]["kwp"], rr["kwp"], TOL_KWP)
        total += cmp("qtdRiscos", a["qtdRiscos"], py["qtdRiscos"], 0)
        total += cmp("qtdPrioritarias", a["qtdPrioritarias"], py["qtdPrioritarias"], 0)
        comparacoes.append((c["nome"], total, total - len(dif), dif))

    # ---------------------------------------------------------------- relatório
    pct = lambda v: "–" if v is None else f"{v * 100:.1f}%".replace(".", ",")
    kw = lambda v: f"{v:,.0f}".replace(",", ".") + " kWp"
    linhas = ["# Relatório de validação dos KPIs", "",
              "Base fictícia. Gerado por `validacao/validar_kpis.py`.", "",
              "## Integridade e coerência interna", "", "| Teste | Resultado | Detalhe |", "|---|---|---|"]
    linhas += [f"| {n} | {'OK' if ok else 'FALHOU'} | {d} |" for n, ok, d in testes]
    linhas += ["", "## Interface × recálculo independente", ""]
    if comparacoes:
        linhas += ["| Cenário | Valores comparados | Iguais | Divergências |", "|---|---|---|---|"]
        linhas += [f"| {n} | {t} | {i} | {len(d)} |" for n, t, i, d in comparacoes]
        for n, t, i, d in comparacoes:
            if d:
                linhas += ["", f"Divergências em **{n}**:"] + [f"- {x}" for x in d[:30]]
    else:
        linhas.append("Arquivo `kpis_app.json` não encontrado: rode `node validacao/exportar_kpis_app.js` para comparar.")
    linhas += ["", "## Números de referência por cenário (recálculo Python)", "",
               "| Cenário | Meta | Realizado | Atingimento | Viés forecast | Forecast próx. 3 meses | Cobertura | Lastro M+1 |",
               "|---|---|---|---|---|---|---|---|"]
    for n, k, pj in resumos:
        linhas.append(f"| {n} | {kw(k['meta'])} | {kw(k['realizado'])} | {pct(k['atingimento'])} | {pct(k['vies'])} | "
                      f"{kw(pj['forecast'])} | {pct(pj['cobertura'])} | {pct(pj['lastroM1'])} |")

    (VAL / "relatorio_validacao.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    falhas = [t for t in testes if not t[1]]
    div_total = sum(len(d) for *_, d in comparacoes)
    print("\n".join(linhas))
    print(f"\nResumo: {len(testes) - len(falhas)}/{len(testes)} testes OK; "
          f"{sum(t for _, t, _, _ in comparacoes)} valores comparados com a interface, {div_total} divergências.")
    return 1 if falhas or div_total else 0


if __name__ == "__main__":
    sys.exit(main())
