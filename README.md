# CCMEC — Dashboard Cronograma 2026

Dashboard estático (HTML/CSS/JS puro) que exibe o cronograma do projeto CCMEC em
formato Gantt, lendo dados da planilha Google Sheets **"CCMEC - CRONOGRAMA
2026"** (aba `master data`).

## Como funciona

```
Google Sheets  --(service account, somente leitura)-->  GitHub Actions (a cada 5 min)
                                                              |
                                                              v
                                                  data/master_data.json (commitado)
                                                              |
                                                              v
                                              GitHub Pages (index.html + fetch)
```

- A chave da conta de serviço **nunca é commitada**. Ela vive apenas como um
  **GitHub Secret** (`GOOGLE_SERVICE_ACCOUNT_JSON`), usado só durante a execução
  do workflow do GitHub Actions.
- O workflow ([`.github/workflows/update-data.yml`](.github/workflows/update-data.yml))
  roda a cada 5 minutos (mínimo permitido pelo GitHub), busca os dados atuais da
  planilha e commita `data/master_data.json` no repositório.
- O dashboard (`index.html`) é 100% estático e só faz `fetch('data/master_data.json')`
  — nenhuma credencial chega ao navegador de quem acessa o link.

## Configuração (uma vez só)

### 1. Criar o Secret no GitHub

No repositório: **Settings → Secrets and variables → Actions → New repository secret**

- Nome: `GOOGLE_SERVICE_ACCOUNT_JSON`
- Valor: cole o **conteúdo completo** do arquivo JSON da conta de serviço (todo o JSON, não o caminho do arquivo)

### 2. Habilitar GitHub Pages

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`**

O link público será algo como `https://<usuario>.github.io/<repositorio>/`.

### 3. Conferir permissões do workflow

**Settings → Actions → General → Workflow permissions → Read and write permissions**

(necessário para o workflow conseguir commitar `data/master_data.json` automaticamente)

## Rodando localmente (opcional, para desenvolvimento)

Nunca comite o arquivo JSON da conta de serviço. Para testar a busca de dados
localmente:

```powershell
$env:GOOGLE_SERVICE_ACCOUNT_JSON = Get-Content -Raw ".\caminho\para\sua-chave.json"
py -3 -m pip install -r scripts/requirements.txt
py -3 scripts/fetch_sheet_data.py
```

Para visualizar o dashboard localmente (precisa de um servidor, `file://` não
funciona por causa de CORS):

```bash
py -3 -m http.server 5173
```

Depois abra `http://localhost:5173`.

## Estrutura

```
index.html                       Dashboard (Gantt + tabela + filtros)
assets/css/dashboard.css         Estilos (paleta categórica por Eixo, dark mode)
assets/js/dashboard.js           Lógica de renderização, filtros e tooltip
scripts/fetch_sheet_data.py      Busca e transforma os dados do Sheets
scripts/requirements.txt         Dependências Python do script acima
data/master_data.json            Dados gerados (atualizado pelo Actions)
.github/workflows/update-data.yml Workflow de atualização periódica
```

## Ajustando a fonte de dados

O `spreadsheetId` e a aba (`master data`) estão fixos no topo de
[`scripts/fetch_sheet_data.py`](scripts/fetch_sheet_data.py), junto com o
mapeamento de colunas (`COLUMNS` e `AREA_COLUMNS`). Se a estrutura da planilha
mudar (colunas adicionadas/renomeadas), ajuste esse mapeamento.

## Frequência de atualização

Os dados atualizam a cada ~5 minutos automaticamente (mínimo técnico do GitHub
Actions para jobs agendados). Para forçar uma atualização imediata, vá em
**Actions → Atualizar dados do dashboard → Run workflow**.
