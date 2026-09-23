"""
Busca a aba "master data" da planilha CCMEC - CRONOGRAMA 2026 e gera
data/master_data.json, consumido estaticamente pelo dashboard.

Credencial: le a variavel de ambiente GOOGLE_SERVICE_ACCOUNT_JSON (conteudo
JSON completo da service account). Nunca le de arquivo em disco no CI -
isso evita que a chave precise existir como arquivo dentro do repositorio.

Uso local (opcional, para testar antes de configurar o GitHub Actions):
    set GOOGLE_SERVICE_ACCOUNT_JSON=<conteudo do json>   (PowerShell: $env:GOOGLE_SERVICE_ACCOUNT_JSON)
    py -3 scripts/fetch_sheet_data.py
"""
import json
import os
import sys
from datetime import datetime, timezone

import truststore

truststore.inject_into_ssl()

from google.oauth2 import service_account
from googleapiclient.discovery import build

SPREADSHEET_ID = "1QAFhpV61xjHTMSjjOxl5fwDSrXoHVjPBUfzs2iHLhjg"
SHEET_TAB = "master data"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "master_data.json")

# Colunas da linha de cabecalho (indice -> chave), conforme layout atual da aba.
COLUMNS = {
    1: "eixo",
    2: "grupo",
    3: "marco",
    4: "tarefa",
    5: "fornecedor",
    6: "responsavel",
    7: "prioridade",
    8: "status",
    9: "data_inicio",
    10: "data_fim",
    11: "duracao",
    12: "predecessores",
    15: "complexidade",
    17: "progresso",
    18: "encaminhamentos",
}

AREA_COLUMNS = {
    20: "FOYER",
    21: "ÁREA 0 (pinguela)",
    22: "ÁREA 1 (diversidade)",
    23: "ÁREA 2 (oralidade e tecnologias)",
    24: "ÁREA 3 (aturá e feira)",
    25: "ÁREA 4 (crises)",
    26: "ÁREA 5 (bem viver)",
    27: "MEZANINO",
    28: "EXPOSIÇÃO TEMPORÁRIA",
    29: "LOJA",
    30: "ÁREA EXTERNA DO MUSEU",
    31: "ÁREAS COMUNS",
}

HEADER_ROW_INDEX = 1  # linha 2 da planilha (0-indexed) tem os titulos das colunas
FIRST_DATA_ROW_INDEX = 2


def cell(row, idx):
    return row[idx].strip() if idx < len(row) and isinstance(row[idx], str) else ""


def parse_date_br(value):
    """Converte 'dd/mm/aaaa' para 'aaaa-mm-dd'. Trata datas vazias/epoch (30/12/1899) como None."""
    if not value:
        return None
    if value == "30/12/1899":
        return None
    try:
        return datetime.strptime(value, "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_duracao(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def load_credentials():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        raise SystemExit(
            "Variavel de ambiente GOOGLE_SERVICE_ACCOUNT_JSON nao definida. "
            "Defina com o conteudo do JSON da service account antes de rodar este script."
        )
    info = json.loads(raw)
    return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)


def fetch_rows(creds):
    service = build("sheets", "v4", credentials=creds)
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"{SHEET_TAB}!A1:AW1000")
        .execute()
    )
    return result.get("values", [])


def build_tasks(rows):
    tasks = []
    for offset, row in enumerate(rows[FIRST_DATA_ROW_INDEX:]):
        if not any(cell(row, idx) for idx in COLUMNS):
            continue

        task = {key: cell(row, idx) for idx, key in COLUMNS.items()}
        task["linha"] = FIRST_DATA_ROW_INDEX + offset + 1  # numero da linha na planilha (1-indexed)
        task["data_inicio"] = parse_date_br(task["data_inicio"])
        task["data_fim"] = parse_date_br(task["data_fim"])
        task["duracao"] = parse_duracao(task["duracao"])
        task["areas"] = [name for idx, name in AREA_COLUMNS.items() if cell(row, idx)]

        tasks.append(task)
    return tasks


def main():
    creds = load_credentials()
    rows = fetch_rows(creds)
    if not rows:
        raise SystemExit("Nenhum dado retornado pela planilha.")

    tasks = build_tasks(rows)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_sheet": SPREADSHEET_ID,
        "source_tab": SHEET_TAB,
        "sheet_url": f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit",
        "task_count": len(tasks),
        "tasks": tasks,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"OK: {len(tasks)} tarefas gravadas em {OUTPUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
