# Relatório de validação dos KPIs

Base fictícia. Gerado por `validacao/validar_kpis.py`.

## Integridade e coerência interna

| Teste | Resultado | Detalhe |
|---|---|---|
| IDs de oportunidade únicos | OK |  |
| Todo parceiro das tabelas existe no cadastro | OK |  |
| Uma meta por parceiro-mês | OK |  |
| Um forecast por parceiro-mês | OK |  |
| Metas cobrem só meses fechados e futuros | OK |  |
| Nenhum realizado em mês futuro (realizado e projeção separados) | OK |  |
| Nenhum ganho fora da janela de meses fechados | OK |  |
| Forecast de meses futuros marcado como 'mes_futuro' | OK |  |
| Status coerente com etapa (ganha = Contrato; aberta/perdida ≠ Contrato) | OK |  |
| Datas em ordem: criação ≤ entrada na etapa ≤ ganho/perda | OK |  |
| Abertas têm previsão de fechamento; concluídas não | OK |  |
| Perdidas têm motivo de perda | OK |  |
| kWp positivo | OK |  |
| Nenhuma oportunidade criada após a data de corte | OK |  |
| Meta só existe após o credenciamento | OK |  |
| Probabilidade de 'Prospecção' aderente ao histórico (±3 p.p.) | OK | parâmetro 0.16 vs empírico 0.166 |
| Probabilidade de 'Qualificação' aderente ao histórico (±3 p.p.) | OK | parâmetro 0.26 vs empírico 0.267 |
| Probabilidade de 'Proposta' aderente ao histórico (±3 p.p.) | OK | parâmetro 0.42 vs empírico 0.427 |
| Probabilidade de 'Negociação' aderente ao histórico (±3 p.p.) | OK | parâmetro 0.71 vs empírico 0.710 |
| [Padrão: últimos 12 meses, todos os parceiros] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Padrão: últimos 12 meses, todos os parceiros] soma da série mensal = total do período | OK |  |
| [Padrão: últimos 12 meses, todos os parceiros] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Padrão: últimos 12 meses, todos os parceiros] série do app não mistura realizado em meses futuros | OK |  |
| [Histórico completo (24 meses)] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Histórico completo (24 meses)] soma da série mensal = total do período | OK |  |
| [Histórico completo (24 meses)] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Histórico completo (24 meses)] série do app não mistura realizado em meses futuros | OK |  |
| [Último trimestre] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Último trimestre] soma da série mensal = total do período | OK |  |
| [Último trimestre] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Último trimestre] série do app não mistura realizado em meses futuros | OK |  |
| [Parceiro Ingá (P07), 12 meses] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Parceiro Ingá (P07), 12 meses] soma da série mensal = total do período | OK |  |
| [Parceiro Ingá (P07), 12 meses] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Parceiro Ingá (P07), 12 meses] série do app não mistura realizado em meses futuros | OK |  |
| [Parceiro Oiti (P13), etapa Negociação] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Parceiro Oiti (P13), etapa Negociação] soma da série mensal = total do período | OK |  |
| [Parceiro Oiti (P13), etapa Negociação] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Parceiro Oiti (P13), etapa Negociação] série do app não mistura realizado em meses futuros | OK |  |
| [Parceiro Ypê (P20), credenciado no período] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Parceiro Ypê (P20), credenciado no período] soma da série mensal = total do período | OK |  |
| [Parceiro Ypê (P20), credenciado no período] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Parceiro Ypê (P20), credenciado no período] série do app não mistura realizado em meses futuros | OK |  |
| [Etapa Proposta, 2025] soma das linhas de parceiro = total (meta e realizado) | OK |  |
| [Etapa Proposta, 2025] soma da série mensal = total do período | OK |  |
| [Etapa Proposta, 2025] funil monotônico (cada etapa ≤ anterior) | OK |  |
| [Etapa Proposta, 2025] série do app não mistura realizado em meses futuros | OK |  |

## Interface × recálculo independente

| Cenário | Valores comparados | Iguais | Divergências |
|---|---|---|---|
| Padrão: últimos 12 meses, todos os parceiros | 229 | 229 | 0 |
| Histórico completo (24 meses) | 253 | 253 | 0 |
| Último trimestre | 211 | 211 | 0 |
| Parceiro Ingá (P07), 12 meses | 77 | 77 | 0 |
| Parceiro Oiti (P13), etapa Negociação | 77 | 77 | 0 |
| Parceiro Ypê (P20), credenciado no período | 95 | 95 | 0 |
| Etapa Proposta, 2025 | 221 | 221 | 0 |

## Números de referência por cenário (recálculo Python)

| Cenário | Meta | Realizado | Atingimento | Viés forecast | Forecast próx. 3 meses | Cobertura | Lastro M+1 |
|---|---|---|---|---|---|---|---|
| Padrão: últimos 12 meses, todos os parceiros | 37.275 kWp | 36.454 kWp | 97,8% | 12,2% | 12.225 kWp | 111,5% | 89,3% |
| Histórico completo (24 meses) | 70.815 kWp | 67.408 kWp | 95,2% | 10,3% | 12.225 kWp | 111,5% | 89,3% |
| Último trimestre | 10.140 kWp | 10.928 kWp | 107,8% | 0,9% | 12.225 kWp | 111,5% | 89,3% |
| Parceiro Ingá (P07), 12 meses | 2.655 kWp | 2.123 kWp | 80,0% | 25,5% | 370 kWp | 81,3% | 103,8% |
| Parceiro Oiti (P13), etapa Negociação | 2.575 kWp | 2.511 kWp | 97,5% | 9,1% | 805 kWp | 118,4% | 78,8% |
| Parceiro Ypê (P20), credenciado no período | 315 kWp | 406 kWp | 128,8% | 20,8% | 565 kWp | 213,2% | 66,6% |
| Etapa Proposta, 2025 | 34.390 kWp | 32.100 kWp | 93,3% | 9,6% | 11.660 kWp | 109,0% | 90,4% |
