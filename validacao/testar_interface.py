"""
Teste opcional de ponta a ponta: abre o painel num navegador headless, aplica filtros pela URL e confere
se os KPIs exibidos e os dados desenhados nos gráficos batem com o recálculo independente em Python.

Requisitos: pip install playwright pandas && playwright install chromium
Uso:        python validacao/testar_interface.py
"""
from __future__ import annotations

import functools
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path
from urllib.parse import urlencode

sys.argv = [sys.argv[0]]
VAL = Path(__file__).resolve().parent
RAIZ = VAL.parent
sys.path.insert(0, str(VAL))
import validar_kpis as V  # noqa: E402  (reaproveita só o recálculo Python, não o motor da interface)
from playwright.sync_api import sync_playwright  # noqa: E402

PORTA = 8799


def servir():
    class Silencioso(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Silencioso, directory=str(RAIZ))
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.ThreadingTCPServer(("127.0.0.1", PORTA), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()


def numero(txt: str) -> float:
    t = txt.replace("kWp", "").replace("%", "").replace("+", "").replace(".", "").replace(",", ".").strip()
    return float(t)


def main() -> int:
    servir()
    cenarios = json.loads((VAL / "cenarios.json").read_text(encoding="utf-8"))
    falhas = 0
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_page(viewport={"width": 1440, "height": 900})
        erros_js: list[str] = []
        pg.on("pageerror", lambda e: erros_js.append(str(e)))

        def passar_mouse(canvas: str) -> None:
            """Passa o mouse sobre o gráfico: o hover anima cores e foi onde o erro de animação aparecia."""
            pg.locator(canvas).scroll_into_view_if_needed()
            bb = pg.locator(canvas).bounding_box()
            for i in range(10):
                pg.mouse.move(bb["x"] + bb["width"] * (0.08 + 0.09 * i), bb["y"] + bb["height"] * 0.55)
                pg.wait_for_timeout(40)
            pg.wait_for_timeout(500)
        for c in cenarios:
            f = c["filtros"]
            pg.goto(f"http://127.0.0.1:{PORTA}/index.html?{urlencode(f)}")
            pg.wait_for_selector("#kpis .kpi")
            py = V.recalc(f)
            k = py["kpis"]
            vals = pg.eval_on_selector_all("#kpis .kpi .val", "els => els.map(e => e.textContent)")
            exib = {"meta": numero(vals[0]), "realizado": numero(vals[1]), "atingimento": numero(vals[2]) / 100,
                    "gap": numero(vals[3]), "contratos": numero(vals[4])}
            esperado = {"meta": round(k["meta"]), "realizado": round(k["realizado"]),
                        "atingimento": round(k["atingimento"] * 1000) / 1000, "gap": round(abs(k["gap"])),
                        "contratos": k["contratos"]}
            erros = [f"{n}: tela={exib[n]} python={esperado[n]}" for n in exib if abs(exib[n] - esperado[n]) > 1e-6]
            serie = pg.evaluate("""() => { const d = Chart.getChart('gMensal').data;
                return { labels: d.labels, real: d.datasets[0].data, fc: d.datasets[1].data, meta: d.datasets[2].data }; }""")
            n = len(py["serie"])
            for i, s in enumerate(py["serie"]):
                if abs(serie["real"][i] - s["realizado"]) > 0.11 or abs(serie["meta"][i] - s["meta"]) > 0.11:
                    erros.append(f"gráfico {s['mes']}: tela real={serie['real'][i]} meta={serie['meta'][i]} python={s}")
            if any(v is not None for v in serie["real"][n:]):
                erros.append("gráfico mostra realizado em mês futuro")
            if any(v is not None for v in serie["fc"][:n]):
                erros.append("gráfico mostra forecast declarado em mês fechado")
            if abs(sum(v for v in serie["fc"][n:]) - py["projecao"]["forecast"]) > 0.11:
                erros.append("forecast futuro do gráfico difere do KPI de projeção")
            passar_mouse("#gMensal")
            passar_mouse("#gRanking")
            erros += [f"erro de JavaScript: {e}" for e in erros_js]
            erros_js.clear()
            falhas += len(erros)
            print(("OK   " if not erros else "FALHA") + f" {c['nome']}")
            for e in erros:
                print("      " + e)
        # troca de filtros pela própria interface (período, parceiro, etapa e linha do tempo), com hover entre trocas
        pg.goto(f"http://127.0.0.1:{PORTA}/index.html")
        pg.wait_for_selector("#kpis .kpi")
        acoes = [("#fDe", "2025-01"), ("#fAte", "2026-06"), ("#fParceiro", "P07"), ("#fEtapa", "Proposta"),
                 ("#fParceiro", "P13"), ("#fEtapa", "Negociação"), ("#fParceiro", "Todos"), ("#fEtapa", "Todas")]
        for sel, val in acoes:
            pg.select_option(sel, val)
            passar_mouse("#gMensal")
        pg.click("#regua button[data-mes='2025-03']")
        pg.click("#regua button[data-mes='2025-09']")
        passar_mouse("#gMensal")
        bb = pg.locator("#gRanking").bounding_box()
        pg.mouse.click(bb["x"] + bb["width"] * 0.3, bb["y"] + 40)
        passar_mouse("#gRanking")
        print(("OK   " if not erros_js else "FALHA") + " troca de filtros pela interface com hover nos gráficos")
        for e in erros_js:
            print("      erro de JavaScript: " + e)
        falhas += len(erros_js)
        nav.close()
    print(f"\n{len(cenarios)} cenários + troca de filtros pela interface: {falhas} falhas (divergência numérica ou erro de JavaScript).")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
