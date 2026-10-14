"""
Gerador da base FICTÍCIA do Cockpit de Performance Comercial — Vellora Energia (empresa fictícia).

Todos os nomes, números e eventos são sintéticos. Nenhum dado real é utilizado.
A base é reprodutível: a mesma semente gera sempre os mesmos arquivos.

Lógica da simulação (resumo):
  1. Cada parceiro tem uma capacidade comercial mensal (kWp esperado), tendência, sazonalidade
     e, quando credenciado durante o período, uma rampa de entrada.
  2. Oportunidades são criadas mês a mês e avançam pelas etapas do funil com probabilidades
     de conversão e durações sorteadas. O resultado (ganha/perdida/aberta) sai da simulação.
  3. O REALIZADO não é sorteado à parte: é a soma das oportunidades ganhas no mês.
  4. O forecast declarado pelo parceiro é registrado no 1º dia de cada mês (meses fechados e
     os 3 meses futuros), com viés próprio de cada parceiro.
  5. Metas são definidas a partir do histórico recente realizado, com piso de redução.

Uso:  python data/gerar_dados.py
"""
from __future__ import annotations

import csv
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np

import os
SEED = int(os.environ.get("SEED", 37))
rng = np.random.default_rng(SEED)
OUT = Path(__file__).resolve().parent

DATA_CORTE = date(2026, 9, 30)          # último dia com dados realizados
PRIMEIRO_MES = (2024, 10)               # 24 meses fechados: out/2024 a set/2026
N_FECHADOS = 24
N_FUTUROS = 3                           # out, nov, dez/2026 (somente meta e forecast)
MES_INICIO_SIM = -4                     # criação de oportunidades começa 4 meses antes (aquecimento)

ETAPAS = ["Prospecção", "Qualificação", "Proposta", "Negociação", "Contrato"]
SLA = {"Prospecção": 20, "Qualificação": 20, "Proposta": 25, "Negociação": 30}
CONV_BASE = [0.62, 0.66, 0.60, 0.72]    # P→Q, Q→Pr, Pr→N, N→Contrato
DUR_MED = [8, 10, 14, 16]               # mediana de dias em cada etapa (lognormal)
SAZON = {1: .85, 2: .88, 3: 1.0, 4: .98, 5: 1.0, 6: .97, 7: 1.02, 8: 1.05, 9: 1.06, 10: 1.08, 11: 1.06, 12: .95}

MOTIVOS = {
    "Prospecção": [("Sem interesse do cliente", .55), ("Fora do perfil", .45)],
    "Qualificação": [("Crédito reprovado", .45), ("Fora do perfil", .25), ("Sem interesse do cliente", .30)],
    "Proposta": [("Preço", .45), ("Concorrência", .30), ("Inviabilidade técnica", .25)],
    "Negociação": [("Preço", .35), ("Concorrência", .30), ("Crédito reprovado", .20), ("Desistência do cliente", .15)],
}


def add_months(y: int, m: int, k: int) -> tuple[int, int]:
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def mes_str(k: int) -> str:
    y, m = add_months(*PRIMEIRO_MES, k)
    return f"{y:04d}-{m:02d}"


def mes_inicio(k: int) -> date:
    y, m = add_months(*PRIMEIRO_MES, k)
    return date(y, m, 1)


def dias_no_mes(k: int) -> int:
    return (mes_inicio(k + 1) - mes_inicio(k)).days


# ---------------------------------------------------------------- parceiros (fictícios)
NOMES = ["Aroeira", "Buriti", "Cambará", "Embaúba", "Figueira", "Guapuruvu", "Ingá", "Jatobá",
         "Jequitibá", "Louro", "Manacá", "Murici", "Oiti", "Pitanga", "Quaresmeira", "Sapucaia",
         "Tarumã", "Umbu", "Vinhático", "Ypê"]
REGIOES = ["Sudeste", "Sul", "Centro-Oeste", "Nordeste"]

parceiros = []
for i, nome in enumerate(NOMES):
    pid = f"P{i + 1:02d}"
    p = {
        "id": pid,
        "nome": f"Parceiro {nome}",
        "regiao": REGIOES[i % 4],
        "cap": float(rng.uniform(70, 230)),      # kWp/mês esperado no início
        "g": float(rng.uniform(-0.004, 0.018)),  # tendência mensal
        "inicio": MES_INICIO_SIM,                # mês de credenciamento (índice)
        "vies": float(rng.normal(0.02, 0.04)),   # viés do forecast declarado
        "mix": [.80, .19, .01],                  # residencial / comercial / rural
        "conv": list(CONV_BASE),
        "dur": list(DUR_MED),
    }
    parceiros.append(p)

P = {p["id"]: p for p in parceiros}
# Narrativas embutidas (para que o painel tenha o que diagnosticar):
P["P03"].update(cap=300, g=0.014)                                   # maior parceiro, crescendo
P["P05"].update(cap=180, mix=[.50, .38, .12])                       # carteira concentrada em grandes projetos
P["P07"].update(cap=230, g=0.006, queda_desde=15, queda=0.10)       # queda a partir de jan/2026
P["P11"].update(vies=0.42)                                          # forecast sistematicamente otimista
P["P13"].update(cap=170, trava_desde=17)                            # negociação travada (parecer de acesso)
P["P09"].update(conv=[0.62, 0.42, 0.60, 0.72])                      # gargalo na qualificação
for pid, ini in [("P17", 6), ("P18", 10), ("P19", 14), ("P20", 18)]:  # credenciados no período
    P[pid].update(inicio=ini, cap=float(rng.uniform(110, 170)), g=0.01)


def mu(p: dict, k: int) -> float:
    """kWp esperado de oportunidades GANHAS originadas no mês k (base da taxa de criação)."""
    if k < p["inicio"]:
        return 0.0
    val = p["cap"] * (1 + p["g"]) ** (k - MES_INICIO_SIM)
    if "queda_desde" in p and k >= p["queda_desde"]:
        val *= (1 - p["queda"]) ** (k - p["queda_desde"] + 1)
    if p["inicio"] > MES_INICIO_SIM:                       # rampa de 4 meses após credenciamento
        idade = k - p["inicio"]
        val *= min(1.0, 0.30 + 0.175 * idade)
    y, m = add_months(*PRIMEIRO_MES, k)
    return val * SAZON[m]


def sortear_kwp(mix) -> tuple[str, float]:
    seg = rng.choice(["Residencial", "Comercial", "Rural"], p=mix)
    med, sig = {"Residencial": (9, .35), "Comercial": (42, .35), "Rural": (120, .30)}[seg]
    return str(seg), round(float(rng.lognormal(math.log(med), sig)), 1)


def media_kwp(mix) -> float:
    meds = [(9, .35), (42, .35), (120, .30)]
    return sum(w * md * math.exp(s * s / 2) for w, (md, s) in zip(mix, meds))


# ---------------------------------------------------------------- simulação de oportunidades
ops = []
seq = 0
for p in parceiros:
    win_rate = math.prod(p["conv"])
    for k in range(MES_INICIO_SIM, N_FECHADOS):
        alvo = mu(p, k)
        if alvo <= 0:
            continue
        lam = alvo / (win_rate * media_kwp(p["mix"]))
        n = rng.poisson(lam)
        ini = mes_inicio(k)
        for _ in range(n):
            criacao = ini + timedelta(days=int(rng.integers(0, dias_no_mes(k))))
            if criacao > DATA_CORTE:
                continue
            seq += 1
            seg, kwp = sortear_kwp(p["mix"])
            conv = list(p["conv"])
            dur = list(p["dur"])
            if "trava_desde" in p and k >= p["trava_desde"] - 2:
                dur[3] = 70
                conv[3] = 0.45
            # avança pelas etapas
            t = criacao
            etapa_idx = 0
            status = None
            data_fim = None
            while True:
                d = max(1, int(round(rng.lognormal(math.log(dur[etapa_idx]), 0.5))))
                avanca = rng.random() < conv[etapa_idx]
                if not avanca:
                    d = max(1, int(d * rng.uniform(0.4, 1.2)))
                fim = t + timedelta(days=d)
                if fim > DATA_CORTE:
                    status = "Aberta"
                    break
                if not avanca:
                    status = "Perdida"
                    data_fim = fim
                    break
                etapa_idx += 1
                t = fim
                if etapa_idx == 4:
                    status = "Ganha"
                    data_fim = t
                    break
            etapa = ETAPAS[etapa_idx]
            reg = {
                "id_oportunidade": f"OP{seq:05d}",
                "id_parceiro": p["id"],
                "data_criacao": criacao.isoformat(),
                "segmento": seg,
                "kwp": kwp,
                "status": status,
                "etapa": etapa,
                "data_entrada_etapa": t.isoformat(),
                "data_ganho": data_fim.isoformat() if status == "Ganha" else "",
                "data_perda": data_fim.isoformat() if status == "Perdida" else "",
                "motivo_perda": "",
                "previsao_fechamento": "",
                "pendencia": "",
            }
            if status == "Perdida":
                nomes, pesos = zip(*MOTIVOS[etapa])
                reg["motivo_perda"] = str(rng.choice(nomes, p=pesos))
            if status == "Aberta":
                # previsão registrada pelo parceiro ao entrar na etapa atual:
                # tempo típico restante até o contrato, com incerteza
                restante = sum(DUR_MED[etapa_idx:]) * float(rng.lognormal(0, 0.30))
                prev = t + timedelta(days=max(3, int(round(restante))))
                reg["previsao_fechamento"] = prev.isoformat()
                idade = (DATA_CORTE - t).days
                atraso = idade > SLA[etapa]
                opcoes = {
                    "Prospecção": [],
                    "Qualificação": [("Análise de crédito", .12)],
                    "Proposta": [("Documentação do cliente", .15), ("Vistoria técnica", .08)],
                    "Negociação": [("Parecer de acesso da distribuidora", .12), ("Análise de crédito", .08),
                                   ("Documentação do cliente", .08)],
                }[etapa]
                if "trava_desde" in p and etapa == "Negociação":
                    opcoes = [("Parecer de acesso da distribuidora", .70), ("Documentação do cliente", .10)]
                fator = 1.8 if atraso else 1.0
                r = rng.random()
                acum = 0.0
                for nome_pend, prob in opcoes:
                    acum += prob * fator
                    if r < acum:
                        reg["pendencia"] = nome_pend
                        break
            ops.append(reg)

# ---------------------------------------------------------------- realizado por parceiro-mês (derivado)
def mes_de(iso: str) -> str:
    return iso[:7]


realizado = {}
for o in ops:
    if o["status"] == "Ganha":
        chave = (mes_de(o["data_ganho"]), o["id_parceiro"])
        realizado[chave] = realizado.get(chave, 0.0) + o["kwp"]

# ---------------------------------------------------------------- probabilidades por etapa (calibradas no histórico)
concluidas = [o for o in ops if o["status"] in ("Ganha", "Perdida")]
prob = {}
for i, e in enumerate(ETAPAS[:4]):
    atingiu = [o for o in concluidas if ETAPAS.index(o["etapa"]) >= i]
    ganhas = [o for o in atingiu if o["status"] == "Ganha"]
    prob[e] = round(len(ganhas) / len(atingiu), 2)

# ---------------------------------------------------------------- metas
metas = []
meta_ant = {}
for k in range(N_FECHADOS + N_FUTUROS):
    ms = mes_str(k)
    y, m = add_months(*PRIMEIRO_MES, k)
    for p in parceiros:
        cred_k = p["inicio"]
        if k < max(cred_k, 0):
            continue
        hist = [realizado.get((mes_str(j), p["id"]), 0.0) for j in range(k - 6, k) if j >= 0 and j >= cred_k + 1]
        if k >= N_FECHADOS:  # metas futuras usam os últimos 6 meses fechados
            hist = [realizado.get((mes_str(j), p["id"]), 0.0) for j in range(N_FECHADOS - 6, N_FECHADOS)
                    if j >= cred_k + 1]
        if len(hist) >= 3:
            base = float(np.mean(hist)) * 1.05 * SAZON[m] / np.mean([SAZON[add_months(*PRIMEIRO_MES, j)[1]] for j in range(k - 6, k)])
        else:
            base = mu(p, k - 2) * 1.05   # parceiro novo: meta segue a rampa, defasada pelo ciclo de venda
        if p["id"] in meta_ant:
            base = max(base, meta_ant[p["id"]] * 0.92)  # meta não cai mais de 8% de um mês para o outro
        meta = max(10, int(round(base / 5.0)) * 5)
        meta_ant[p["id"]] = meta
        metas.append({"mes": ms, "id_parceiro": p["id"], "meta_kwp": meta})

# ---------------------------------------------------------------- forecast declarado (1º dia do mês)
forecast = []
for k in range(N_FECHADOS + N_FUTUROS):
    ms = mes_str(k)
    for p in parceiros:
        if k < max(p["inicio"] + 1, 0):
            continue
        # o parceiro estima com base no que espera fechar (aprox. o volume originado 1-2 meses antes)
        esperado = 0.5 * mu(p, k - 1) + 0.5 * mu(p, k - 2)
        if esperado <= 0:
            continue
        f = esperado * (1 + p["vies"]) * rng.lognormal(0, 0.08)
        if "queda_desde" in p and k >= p["queda_desde"]:
            f *= 1.15  # parceiro demora a reconhecer a queda
        forecast.append({
            "mes": ms,
            "id_parceiro": p["id"],
            "forecast_kwp": int(round(f / 5.0)) * 5,
            "data_registro": mes_inicio(k).isoformat(),
            "horizonte": "mes_fechado" if k < N_FECHADOS else "mes_futuro",
        })

# ---------------------------------------------------------------- escrita
def escrever(nome: str, linhas: list[dict], campos: list[str]) -> None:
    with open(OUT / nome, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos)
        w.writeheader()
        for ln in linhas:
            w.writerow({c: ln[c] for c in campos})


escrever("parceiros.csv",
         [{"id_parceiro": p["id"], "nome_parceiro": p["nome"], "regiao": p["regiao"],
           "data_credenciamento": mes_inicio(p["inicio"]).isoformat()} for p in parceiros],
         ["id_parceiro", "nome_parceiro", "regiao", "data_credenciamento"])
escrever("metas.csv", metas, ["mes", "id_parceiro", "meta_kwp"])
escrever("forecast.csv", forecast, ["mes", "id_parceiro", "forecast_kwp", "data_registro", "horizonte"])
# Oportunidades concluídas antes do 1º mês fechado pertencem só ao aquecimento da simulação
inicio_janela = mes_inicio(0).isoformat()
ops_saida = [o for o in ops if not ((o["data_ganho"] and o["data_ganho"] < inicio_janela)
                                     or (o["data_perda"] and o["data_perda"] < inicio_janela))]
escrever("oportunidades.csv", ops_saida, list(ops[0].keys()))
escrever("parametros_etapas.csv",
         [{"ordem": i + 1, "etapa": e, "sla_dias": SLA.get(e, ""), "probabilidade_ganho": prob.get(e, 1.0)}
          for i, e in enumerate(ETAPAS)],
         ["ordem", "etapa", "sla_dias", "probabilidade_ganho"])
escrever("parametros_gerais.csv", [
    {"parametro": "empresa", "valor": "Vellora Energia (empresa fictícia)"},
    {"parametro": "data_corte", "valor": DATA_CORTE.isoformat()},
    {"parametro": "primeiro_mes_fechado", "valor": mes_str(0)},
    {"parametro": "ultimo_mes_fechado", "valor": mes_str(N_FECHADOS - 1)},
    {"parametro": "primeiro_mes_futuro", "valor": mes_str(N_FECHADOS)},
    {"parametro": "ultimo_mes_futuro", "valor": mes_str(N_FECHADOS + N_FUTUROS - 1)},
    {"parametro": "semente_aleatoria", "valor": SEED},
], ["parametro", "valor"])

ops = ops_saida
print(f"oportunidades: {len(ops)} | ganhas: {sum(o['status']=='Ganha' for o in ops)} | "
      f"abertas: {sum(o['status']=='Aberta' for o in ops)}")
print("probabilidades por etapa:", prob)
