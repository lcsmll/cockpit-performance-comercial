# Dicionário de dados e fórmulas dos indicadores

> Todos os dados deste projeto são **fictícios**, gerados por simulação em `data/gerar_dados.py` (semente fixa, resultado reprodutível). A empresa "Vellora Energia" e os parceiros não existem.

Unidade de volume comercial: **kWp** (potência de pico contratada de sistemas de geração distribuída). Datas em ISO (`AAAA-MM-DD`), meses em `AAAA-MM`. Arquivos CSV em UTF-8, separador vírgula, decimal ponto.

**Data de corte: 30/09/2026.** Há 24 meses fechados (out/2024 a set/2026), com meta e realizado, e 3 meses futuros (out/2026 a dez/2026), que têm apenas meta e forecast.

## 1. Tabelas

### `parceiros.csv` (20 linhas)

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_parceiro` | texto | Chave do parceiro (P01 a P20). |
| `nome_parceiro` | texto | Nome fictício. |
| `regiao` | texto | Região de atuação fictícia. Informativa, não entra em cálculos. |
| `data_credenciamento` | data | Primeiro dia do mês em que o parceiro passou a vender. Quatro parceiros entram durante o período. |

### `metas.csv` (uma linha por parceiro-mês)

| Coluna | Tipo | Descrição |
|---|---|---|
| `mes` | mês | Mês da meta (fechado ou futuro). |
| `id_parceiro` | texto | Chave do parceiro. |
| `meta_kwp` | inteiro | Meta de kWp contratado no mês. Só existe a partir do credenciamento. |

### `forecast.csv` (uma linha por parceiro-mês)

| Coluna | Tipo | Descrição |
|---|---|---|
| `mes` | mês | Mês a que a previsão se refere. |
| `id_parceiro` | texto | Chave do parceiro. |
| `forecast_kwp` | inteiro | kWp que o parceiro declarou que fecharia no mês. |
| `data_registro` | data | Quando a previsão foi registrada: 1º dia do mês de referência. |
| `horizonte` | texto | `mes_fechado` (previsão de um mês que já tem realizado, usada para medir viés) ou `mes_futuro` (previsão em aberto). |

### `oportunidades.csv` (uma linha por oportunidade)

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_oportunidade` | texto | Chave da oportunidade. |
| `id_parceiro` | texto | Parceiro responsável. |
| `data_criacao` | data | Entrada no funil (etapa Prospecção). |
| `segmento` | texto | Residencial, Comercial ou Rural. |
| `kwp` | decimal | Potência da proposta. |
| `status` | texto | `Aberta`, `Ganha` ou `Perdida` na data de corte. |
| `etapa` | texto | Etapa atual (aberta), etapa em que foi perdida (perdida) ou `Contrato` (ganha). Como o funil é sequencial, a oportunidade passou por todas as etapas anteriores. |
| `data_entrada_etapa` | data | Entrada na etapa registrada em `etapa`. Base dos dias parados. |
| `data_ganho` | data | Assinatura do contrato. Preenchida só em `Ganha`. **Define o mês do realizado.** |
| `data_perda` | data | Data da perda. Só em `Perdida`. |
| `motivo_perda` | texto | Motivo declarado. Só em `Perdida`. |
| `previsao_fechamento` | data | Data prevista de assinatura. Só em `Aberta`. |
| `pendencia` | texto | Pendência que impede o avanço (documentação, crédito, vistoria, parecer de acesso). Só em `Aberta`, quando houver. |

Oportunidades criadas entre jun e set/2024 existem para que os primeiros meses fechados tenham fechamentos. As que foram concluídas antes de out/2024 ficaram fora da base.

### `parametros_etapas.csv`

| Coluna | Descrição |
|---|---|
| `ordem` | Posição no funil (1 Prospecção, 2 Qualificação, 3 Proposta, 4 Negociação, 5 Contrato). |
| `etapa` | Nome da etapa. |
| `sla_dias` | Prazo de permanência considerado normal (20, 20, 25 e 30 dias). |
| `probabilidade_ganho` | Probabilidade de virar contrato a partir da etapa, calibrada no histórico de oportunidades concluídas (16%, 26%, 42%, 71%). O script de validação confere a aderência ao histórico. |

### `parametros_gerais.csv`

Data de corte, primeiro e último mês fechado, meses futuros, nome da empresa fictícia e semente da simulação.

## 2. Indicadores

Notação: *P* = parceiros filtrados que já estavam credenciados no fim do período; *M* = meses fechados do período; *F* = meses futuros (out a dez/2026); *M+1* = primeiro mês futuro.

### Resultado (meses fechados, filtros de período e parceiro)

| Indicador | Fórmula | Leitura |
|---|---|---|
| Meta | Σ `meta_kwp` em *P* × *M* | Volume comprometido para o período. |
| Realizado | Σ `kwp` das oportunidades `Ganha` com `data_ganho` em *M*, parceiros *P* | Só contratos assinados. Nenhuma projeção entra aqui. |
| Atingimento | Realizado ÷ Meta | 100% = meta cumprida. |
| Gap | Meta − Realizado | Negativo = meta superada. |
| Contratos ganhos | Contagem das oportunidades do Realizado | kWp por contrato = Realizado ÷ contratos. |
| Viés do forecast | (Σ forecast − Σ realizado) ÷ Σ realizado, nos parceiro-meses de *M* com forecast registrado | Positivo = parceiro promete mais do que entrega. No nível do parceiro exige pelo menos 3 meses com forecast. |
| Erro absoluto médio do forecast (WAPE) | Σ \|forecast − realizado\| por parceiro-mês ÷ Σ realizado | Mede imprecisão, independentemente do sinal. Calculado por parceiro-mês, por isso é maior que o erro do total do canal. |
| Últ. 3m vs 3m ant. | Realizado dos 3 últimos meses de *M* ÷ realizado dos 3 anteriores − 1 | Exige 6 meses no período. Sensível a contratos grandes. |

### Projeção (meses futuros, filtro de parceiro; independe dos filtros de período e de etapa)

| Indicador | Fórmula | Leitura |
|---|---|---|
| Meta do trimestre | Σ `meta_kwp` em *P* × *F* | |
| Forecast declarado | Σ `forecast_kwp` em *P* × *F* | Previsão dos parceiros, **nunca somada ao realizado**. |
| Cobertura da meta | Forecast declarado ÷ Meta do trimestre | Quanto da meta os parceiros dizem que vão entregar. |
| Pipeline ponderado | Σ (`kwp` × `probabilidade_ganho` da etapa) das oportunidades abertas com previsão de fechamento no mês e posterior à data de corte | Estimativa estatística, independente do que o parceiro declarou. Previsões vencidas não entram. |
| Lastro do forecast M+1 | Pipeline ponderado de *M+1* ÷ Forecast declarado de *M+1* | Abaixo de 100% significa que parte do número comprometido depende de oportunidades que ainda não estão no funil ou de taxas de conversão acima do histórico. Só o M+1 é usado porque o ciclo de venda é curto e o pipeline cobre pouco dos meses seguintes. |

### Funil

| Indicador | Fórmula | Leitura |
|---|---|---|
| Coorte | Oportunidades com `data_criacao` em *M*, parceiros *P* | |
| Atingiram a etapa *e* | Oportunidades da coorte com `ordem(etapa)` ≥ ordem de *e* | |
| Conversão *e* → *e+1* | Atingiram *e+1* ÷ Atingiram *e* | A etapa com menor taxa é destacada. |
| Conversão total | Atingiram Contrato ÷ Atingiram Prospecção | |
| % da coorte em aberto | Abertas da coorte ÷ coorte | Oportunidades abertas contam só até a etapa atual, o que subestima as taxas finais de coortes recentes. |
| Pipeline aberto por etapa | Contagem, Σ kWp e Σ ponderado das abertas na data de corte, filtros de parceiro e etapa | Foto da data de corte. |
| Motivos de perda | Contagem das perdidas da coorte por `motivo_perda` | |

### Sinais de risco por oportunidade aberta (filtros de parceiro e etapa)

| Sinal | Regra |
|---|---|
| Parada acima do prazo | Dias desde `data_entrada_etapa` até a data de corte > `sla_dias` da etapa. |
| Previsão vencida | `previsao_fechamento` ≤ data de corte. |
| Pendência em aberto | `pendencia` preenchida. |

A lista de riscos é ordenada pelo kWp ponderado, que aproxima o volume em jogo. **Negociações prioritárias**: abertas em Negociação, sem nenhum sinal de risco e com previsão para *M+1*.

### Alertas por parceiro

| Código | Alerta | Regra | Filtros que afetam |
|---|---|---|---|
| A1 | Abaixo da meta | Atingimento do período < 80% | Período, parceiro |
| A2 | Queda de resultado | Últ. 3m vs 3m ant. ≤ −25% **e** atingimento dos últimos 3 meses < 85% | Período (≥ 6 meses), parceiro |
| A3 | Forecast otimista | Viés do forecast do período > +25% | Período, parceiro |
| A4 | Forecast sem lastro | Lastro do forecast M+1 < 60% | Parceiro |
| A5 | Pipeline envelhecido | ≥ 40% do kWp aberto com algum sinal de risco, com pelo menos 5 abertas | Parceiro |
| — | Em rampa | Credenciado há menos de 6 meses no fim do período. A1 a A3 não se aplicam. | Período, parceiro |

As regras comparam os percentuais na precisão exibida na tela (0,1 p.p.), para que a tela nunca mostre "80,0%" junto de um alerta de "abaixo de 80%".

**Gargalo de conversão** (usado nas recomendações): parceiro cuja conversão em uma etapa fica 10 p.p. ou mais abaixo da média do canal, com pelo menos 40 oportunidades na base da etapa.

## 3. Como os filtros agem

| Filtro | Afeta | Não afeta |
|---|---|---|
| Período (De / Até ou linha do tempo) | Resultado, série mensal, ranking e tabela, coorte do funil, A1 a A3, conclusões | Projeção, pipeline aberto, riscos (são fotos da data de corte) |
| Parceiro | Todos os blocos. Ranking e tabela continuam mostrando o canal inteiro, com o parceiro destacado | — |
| Etapa | Pipeline aberto, lista de riscos e negociações prioritárias | Resultado, projeção, coorte do funil, alertas |

## 4. Premissas da simulação

* Capacidade, tendência e viés de forecast próprios por parceiro, sazonalidade mensal e rampa de entrada para parceiros novos.
* Probabilidades de avanço por etapa e durações sorteadas (lognormal). O realizado é a soma das oportunidades ganhas: não existe "realizado sorteado" separado do funil.
* Algumas situações foram embutidas para o painel ter o que diagnosticar: um parceiro em queda (Ingá), um com forecast otimista (Manacá), um com negociações travadas por parecer de acesso (Oiti), um com gargalo na qualificação (Jequitibá) e quatro credenciados no período. O restante das variações vem do acaso da simulação.
* Metas: média dos últimos 6 meses realizados × 1,05, ajustada pela sazonalidade, sem cair mais de 8% de um mês para o outro.
