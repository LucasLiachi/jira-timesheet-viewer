# Jira Timesheet Viewer — Plano de Desenvolvimento

> Extensão Chrome (Manifest V3) para **pesquisar e visualizar por data** os itens atribuídos ao usuário no Jira.
> Não é uma ferramenta de apontamento: para lançar horas, o clique num item leva à tela normal do Jira.
> Interface 100% em inglês. Documento de planejamento em português.

---

## ⚠️ Ação imediata de segurança

Os scripts Python legados (`lancamento.py`, `Consulta.py`) que continham e-mail corporativo e API token em texto puro foram **removidos** do repositório — não faziam parte do escopo do plugin (que é 100% JS) e eram só material de referência.

Se algum desses tokens antigos ainda estiver ativo, **revogue-o** em `id.atlassian.com → Security → API tokens` e gere um novo.

Todo o plano abaixo parte de um princípio mais forte do que "nunca hardcoded": **credencial corporativa (URL do Jira, e-mail, token) nunca vai para disco.** Ela é digitada na tela no momento do uso e fica em `chrome.storage.session` — memória do navegador, nunca `chrome.storage.local`, nunca em código. Ver seção 3 para o histórico dessa decisão (foi ajustada uma vez, em 2026-07-22, por causa da fricção real que a versão mais estrita causava).

---

## 0. Escopo atual: pesquisa e visualização por data, com leitura de apontamentos

O plugin: **dado um período (data início/fim), mostra quais issues estão atribuídas a você nesse período, agrupadas por dia de apontamento** — quais issues você logou horas em cada dia, quanto, com a descrição do apontamento se houver, e ao final quais issues do período **não** têm nenhum apontamento seu.

- Lê e agrega worklogs (seus, do período pesquisado) — mas só leitura, nunca cria ou edita.
- **Sempre busca todos os itens em que o usuário é responsável** no período (com ou sem due date) — não há mais um checkbox para isso; a curadoria acontece depois, via três filtros, nesta ordem na tela: projetos, status, work item:
  - **Filtro de projetos** (abaixo do calendário, acima do Status): multi-select com os projetos que o usuário acessa, estreita a própria busca no Jira (`project IN (...)` na JQL) — muda de seleção refaz a busca se já houver um período escolhido.
  - **Filtro de status** (abaixo do de projetos): multi-select com os status que aparecem no resultado, sub-filtra a lista já buscada — não faz nova chamada de rede.
  - **Filtro de work item** (por último): campo de texto simples, filtra a lista já buscada (após o filtro de status) por chave ou resumo da issue — também sem nova chamada de rede.
- Agrupa por dia (não por status como nas primeiras versões deste plano): cada dia do período vira uma seção com as issues logadas naquele dia, o total de horas do dia, e a descrição do worklog abaixo de cada item, se ele tiver uma.
- Ao final da lista, uma seção única com todas as issues atribuídas no período (após os filtros) que não têm apontamento nenhum — essa não é dividida por dia, porque por definição não há dia associado.
- **Apontar horas continua sendo feito no próprio Jira.** Cada item da lista é clicável e abre a issue em `{baseUrl}/browse/{KEY}` — a tela normal do Jira, onde o **Log work** já existe e funciona como sempre funcionou. O plugin lê o que já foi apontado e é a porta de entrada rápida para apontar o que falta; não substitui a tela do Jira.
- **Botão `Open summary in new tab`**, depois de todos os filtros: abre uma página própria da extensão (`src/summary/summary.html`) numa aba nova, com um resumo somente-leitura do que está visível na tela naquele momento — mesmo agrupamento por dia, mas **sem** os dias sem apontamento e **sem** a seção "Not logged in this period" (só o que tem worklog de verdade). O título traz o período e, se houver, quais filtros de projeto/status/work item estão de fato restringindo algo (filtro "tudo selecionado" não aparece como filtro aplicado). Não refaz busca nenhuma — é só uma segunda visualização dos mesmos dados já buscados, útil para copiar/revisar/imprimir fora do side panel estreito.

**O que ainda não existe** (e por quê): comparação planejado vs. logado, barra de progresso por dia vs. meta de horas, acordeão colapsável, export CSV. Ver seção 11 — esses continuam fora de escopo até serem pedidos.

---

## 1. Stack recomendada

Nada de Python aqui — extensão Chrome é **Manifest V3 + JavaScript**. Para uma ferramenta de busca de 1 tela, somente leitura:

| Camada | Escolha | Por quê |
|---|---|---|
| Manifest | **MV3** | obrigatório desde 2024 |
| Lógica | **Vanilla JS (ES Modules)** | zero build; `chrome://extensions → Load unpacked` e pronto |
| UI | **HTML + CSS puro** | popup compacto + side panel; não precisa de React |
| Rede | `fetch` no **service worker** | com `host_permissions`, o MV3 ignora CORS |
| Storage | `chrome.storage.local` (preferências) + `chrome.storage.session` (conexão) | preferência = disco; conexão = memória do navegador, nunca disco |
| Datas | **`Intl` + strings ISO** | evita libs; timezone vem da conta Jira conectada |

> Se depois crescer (gráficos, filtros complexos), migre para **Vite + @crxjs/vite-plugin + React**. Mas não comece por aí.

### Popup vs Side Panel

O popup do Chrome trava em ~360×480px — compacto demais para uma lista de issues confortável.

**Decisão adotada:** popup é só o formulário de conexão + um botão "Open My Items" que abre o `chrome.sidePanel`. A pesquisa e a lista vivem no side panel, que tem mais espaço vertical.

---

## 2. Arquitetura de arquivos (como foi implementado)

```
jira-timesheet-viewer/
├── manifest.json
├── src/
│   ├── background/
│   │   └── service-worker.js      # único ponto que fala com o Jira; CONNECT / GET_CONNECTION_STATUS / DISCONNECT / SEARCH / GET_PROJECTS
│   ├── lib/
│   │   ├── jira-client.js         # fetch + auth + retry/429 + searchAll (paginação) + fetchIssueWorklogs + fetchAllProjects + mapWithLimit
│   │   ├── jql.js                 # builder de JQL do My Items
│   │   ├── fields.js              # (stub) descoberta de customfield IDs — não iniciado
│   │   ├── dates.js               # helpers ISO / epoch ms, timezone-safe
│   │   ├── messaging.js           # wrapper de request/response tipado
│   │   ├── settings.js            # preferências não-sensíveis (chrome.storage.local)
│   │   └── connect-form.js        # formulário de conexão compartilhado (popup + panel)
│   ├── popup/                     # conexão + botão "Open My Items"
│   ├── panel/                     # calendar.js (grade do mês) + multi-select.js (popover de projeto/status) + panel.js (estado + lista + resumo)
│   ├── options/                   # só preferências — sem campos de credencial
│   ├── summary/                   # summary.html/css/js — resumo somente-leitura aberto numa aba nova pelo painel
│   └── welcome/                   # página de instruções, aberta em chrome.runtime.onInstalled
└── icons/ (16, 32, 48, 128)
```

**Regra de ouro:** o token vive só em `chrome.storage.session` (memória do navegador) e numa variável em memória no service worker como cache — nunca em disco. Popup e panel se comunicam por `chrome.runtime.sendMessage` e nunca veem a credencial diretamente; só o formulário de conexão a captura, e só para repassá-la uma vez ao service worker.

---

## 3. Autenticação — duas opções

### Opção A — API Token (Basic Auth) — adotada

Basic Auth com token de API, com uma diferença deliberada e não-negociável: **nenhum dado da conexão corporativa vai para disco.**

`chrome.storage.local` **não é criptografado** — qualquer processo com acesso ao perfil do navegador consegue ler, e sobrevive indefinidamente a reinícios do navegador. `chrome.storage.session` é diferente: só existe em memória, nunca é escrito no perfil em disco, e é apagado pelo próprio Chrome quando o navegador fecha.

- **URL do Jira, e-mail e API token são digitados na tela**, num formulário de conexão embutido no popup (e replicado no side panel, caso ele seja aberto sem uma conexão ativa).
- Esses valores trafegam do popup para o service worker numa única mensagem (`CONNECT`) e ficam guardados em `chrome.storage.session`, com uma cópia em memória no service worker como cache de leitura rápida.
- Quando o service worker é encerrado pelo MV3 (~30s ocioso), a cópia em memória some, mas o service worker a recarrega de `chrome.storage.session` na próxima mensagem — sem pedir para o usuário reconectar. Só ao fechar o navegador de verdade (ou clicar em Disconnect) é que a conexão precisa ser refeita.
- Só preferências não-sensíveis (horas de trabalho) continuam em `chrome.storage.local`.

**Histórico da decisão (2026-07-22):** a versão original desta regra era mais estrita — nada de credencial em `chrome.storage`, nem `.session`, só uma variável em memória no service worker. Na prática isso significava reconectar a cada ~30s de inatividade (o tempo que o MV3 leva para matar o service worker), porque a variável em memória some junto com o worker. O usuário reportou essa fricção como grande demais pelo ganho de segurança marginal de `.session` sobre uma variável em memória (ambos nunca tocam disco; a diferença é só sobreviver ao reinício do worker vs. não sobreviver). A regra foi relaxada para `chrome.storage.session`, mantendo a garantia que importa — nunca em disco, apagado ao fechar o navegador — e descartando a garantia que só causava fricção sem proteção real adicional.

### Opção B — OAuth 2.0 3LO

Via `chrome.identity.launchWebAuthFlow`, com scopes `read:jira-work read:jira-user offline_access`. Mais correto, mas exige registrar um app no developer console da Atlassian — provavelmente barrado pela TI. **Deixar para uma v2, se algum dia fizer sentido.**

---

## 4. Mapeamento dos campos (o que a busca usa hoje)

| O que se quer | Como acessar | Nativo? |
|---|---|---|
| **Responsável** | campo `assignee` / JQL `assignee = currentUser()` | ✅ sim |
| **Data limite (Due Date)** | campo `duedate` / JQL `duedate` | ✅ sim |
| **Status** | `status.name`, `status.statusCategory.key` | ✅ sim |
| **Estimativa original** | `timetracking.originalEstimateSeconds` | ✅ sim |
| **Worklog (horas)** | `GET /rest/api/2/issue/{id}/worklog` → `timeSpentSeconds`, filtrado por `author.accountId` | ✅ sim |
| **Worklog date** | worklog `started` (ISO com offset) → bucket de dia via timezone da conta | ✅ sim |

**Data Início (Start Date)** seria customfield (varia por instância) — não implementado ainda; opcional, ver Fase 3 no roadmap.

**Descrição do worklog** (`comment`) é lida via v2 (string plana, sem ADF) e aparece abaixo do item, dentro do agrupamento por dia — só quando o worklog daquele dia tiver uma descrição não-vazia.

**Projetos** (`GET /rest/api/3/project/search`) — usado só para popular o filtro de projetos antes da busca; não faz parte dos `fields` da busca de issues.

---

## 5. Endpoints e JQL

```javascript
// src/lib/jql.js
export function buildMyItemsJql({ from, to, projectKeys = [] }) {
  const clauses = ['assignee = currentUser()'];
  if (projectKeys.length > 0) {
    clauses.push(`project IN (${projectKeys.map((k) => `"${k}"`).join(', ')})`);
  }
  clauses.push(`((duedate >= "${from}" AND duedate <= "${to}") OR duedate IS EMPTY)`);
  return `${clauses.join(' AND ')} ORDER BY duedate ASC, priority DESC`;
}
```

`projectKeys` vem do filtro de projetos do painel — vazio quando o usuário nunca abriu o filtro ou marcou "Select all" (sem restrição, busca todos os projetos); uma lista de chaves quando ele desmarcou algum. Zero projetos marcados explicitamente é tratado no painel, não aqui — o painel nem chama `SEARCH` nesse caso (ver §6).

**Endpoint:** `POST /rest/api/3/search/jql` com paginação por `nextPageToken`. O endpoint antigo `GET /rest/api/3/search` foi descontinuado.

```javascript
const body = {
  jql,
  fields: ['summary', 'status', 'duedate', 'timetracking'],
  maxResults: 100,
  ...(nextPageToken && { nextPageToken }),
};
```

Isso traz a lista de issues. Depois, **para cada issue**, busca os worklogs do período (filtro server-side por `startedAfter`/`startedBefore` em epoch ms, não trazer tudo e descartar no cliente):

```javascript
// src/lib/jira-client.js — v2, não v3: v3 devolve comment como ADF, v2 como string
export async function fetchIssueWorklogs(client, issueId, fromMs, toMs) {
  // GET /rest/api/2/issue/{issueId}/worklog?startedAfter=...&startedBefore=...
  // pagina por startAt/maxResults até esgotar `total`
}
```

Como isso é uma chamada por issue, o service worker paraleliza com `mapWithLimit(issues, 5, fn)` — 5 concorrentes é o ponto de equilíbrio: mais que isso tende a esbarrar no rate limit do Jira Cloud (ver §10). Cada worklog é filtrado por `author.accountId === accountId` (worklog de outra pessoa na mesma issue não conta) e agregado por dia (bucket timezone-safe via `isoDateInTimeZone`, usando o timezone da conta conectada — nunca `America/Sao_Paulo` fixo, isso já foi um bug corrigido), somando `timeSpentSeconds` e coletando `comment` (string plana, v2) quando não-vazio.

O resultado que o `SEARCH` devolve por issue: `{ key, summary, statusName, statusCategory, due, estimateSeconds, logsByDay }`, onde `logsByDay` é um mapa `{ 'YYYY-MM-DD': { seconds, comments: string[] } }` — `comments` pode ter mais de uma entrada se houver mais de um worklog seu naquele dia com descrições diferentes. O painel monta o agrupamento por dia, o subfiltro de status e as descrições inteiramente a partir disso — sem pedir de novo ao service worker por dia.

### Filtro de projetos

```javascript
// src/lib/jira-client.js
export async function fetchAllProjects(client) {
  // GET /rest/api/3/project/search?startAt=...&maxResults=50&orderBy=name
  // pagina por startAt até isLast, devolve [{ key, name }]
}
```

Novo message type `GET_PROJECTS` (sem payload) → `{ projects: [{ key, name }] }`. O painel busca isso **uma vez, sob demanda**, na primeira vez que o usuário abre o filtro de projetos (não busca sozinho ao conectar) — e cacheia em memória pelo resto da sessão do painel.

Bug real encontrado e corrigido em 2026-07-23: um segundo clique no botão `Projects` (ou um clique fora incidental) enquanto o `GET_PROJECTS` ainda estava em voo fechava o popover de volta antes da lista chegar; quando a promise resolvia, o popover já estava fechado e as opções carregadas nunca apareciam — parecia "o filtro não funciona" de fora, mas os dados chegavam normalmente. Corrigido ignorando toggles/cliques-fora enquanto `state.projectsLoading` é `true`, e também separando as três mensagens possíveis do popover vazio: `Loading…` (buscando), `Could not load projects: {mensagem real do erro}` (falhou — antes era um texto genérico, agora mostra a causa) e `No projects found.` (sucesso, mas devolveu zero projetos).

Um segundo bug, mais sério, apareceu logo depois do primeiro estar corrigido: com `GET_PROJECTS` devolvendo zero projetos (sem erro — sucesso, lista vazia), o código fazia `new Set([])` e guardava isso em `selectedProjects`. Um `Set` vazio não-nulo é exatamente o mesmo formato usado para "o usuário desmarcou todos os projetos de propósito" — e essa condição faz `runSearch()`/`renderList()` pularem a chamada de rede e mostrarem `Select at least one project to search.` para **qualquer** período escolhido dali em diante, sem nenhum checkbox disponível para desfazer isso. Na prática: o filtro de projetos vazio quebrou a busca por data inteira, não só a si mesmo. Corrigido só criando o `Set` quando `projectOptions.length > 0`; com zero projetos disponíveis, `selectedProjects` fica `null` (mesmo estado de "nunca abri esse filtro" = sem restrição).

---

## 6. UI

### Popup (320×~260)

- Nome do usuário conectado (ou formulário de conexão, se não conectado)
- Botão **`Open My Items`** → abre o side panel
- Links pequenos: `How it works` (página de instruções) e `Settings`

### Side Panel — tela única

- Um calendário compacto (grade de mês, navegação `‹ mês ›`)
- Clique no dia inicial, depois no dia final → dispara a busca automaticamente
- **Filtro de projetos** (`Projects`, botão que abre um popover com checkboxes + "Select all"), **abaixo do calendário, acima do Status** — mesmo estando depois do calendário na tela, continua afetando a JQL da própria busca (`project IN (...)`), não é um sub-filtro client-side; mudar a seleção refaz a busca automaticamente se já houver um período escolhido. Carrega a lista de projetos sob demanda na primeira vez que o botão é aberto.
- **Filtro de status** (`Status`, mesmo padrão de botão + popover), **abaixo do de projetos**, no lugar do antigo checkbox `Include issues without a due date` — populado com os status que aparecem no resultado já buscado, sub-filtra a lista sem nova chamada de rede. Reseta para "todos marcados" a cada busca nova.
- **Filtro de work item**, **por último, abaixo do de Status** — um campo de texto simples (não checkbox, já que issues não são um conjunto pequeno e enumerável como projetos/status), placeholder `Search by key or summary…`. Filtra a lista já sub-filtrada por status, por chave ou resumo (substring, case-insensitive), a cada tecla digitada — sem nova chamada de rede.
- Lista abaixo, **agrupada por dia do período** (mais antigo primeiro), cada dia com:
  - Cabeçalho: `{data} · {n} items · {total}h` (ou `{data} · No worklogs` se ninguém logou nada naquele dia — dias vazios aparecem explicitamente, não somem)
  - Uma linha por issue logada naquele dia: `Key · Summary · Status · Due · {horas logadas naquele dia}`
  - Abaixo da linha, a descrição do worklog daquele dia — só quando existir; pode ter mais de uma linha se houver mais de um apontamento com descrições diferentes no mesmo dia
- Ao final, uma seção `Not logged in this period ({n})` com todas as issues do período (após os filtros) sem nenhum apontamento — aqui a coluna de horas mostra a estimativa original, não horas logadas (que seriam sempre zero), e não há descrição (não há worklog)
- Badge de atraso (`duedate < today AND status != Done`) em qualquer linha, dia-agrupada ou não-logada
- **Linha clicável → abre `{baseUrl}/browse/{KEY}`, reaproveitando a mesma aba entre cliques.** É aqui que o usuário faz o apontamento, na tela normal do Jira.

Os filtros de projetos e status usam o mesmo componente (`src/panel/multi-select.js`): um botão + popover com checkboxes e "Select all", nunca uma lista de opções direta na tela. Zero itens marcados explicitamente = "não mostrar nada" nos dois casos (não é tratado como "sem filtro") — o filtro de projetos nem chama a rede nesse caso; o de status simplesmente não mostra nenhum item. O filtro de work item é diferente: um `<input type="text">` comum, sem popover — não há uma lista de opções para enumerar.

### Resumo em nova aba (`Open summary in new tab`)

Botão depois de todos os três filtros, desabilitado enquanto não há uma lista de dias válida na tela (sem período escolhido, carregando, ou algum dos filtros bloqueando tudo) — mesma condição que libera a lista principal. Ao clicar:

1. O painel monta um payload só com o que já está calculado em memória (nenhuma chamada nova ao Jira): `{ rangeLabel, filters: string[], days: [{ label, items: [{ key, summary, statusName, statusCategory, due, hours, comments }] }] }`. `days` reaproveita a mesma lógica de agrupamento da lista principal (`getVisibleItems()` + o mesmo filtro por `logsByDay[day].seconds > 0`), mas **pula dias sem nenhum item logado** e nunca inclui a seção "Not logged in this period" — o resumo é um registro do que foi feito, não um caçador de lacunas como o painel ao vivo.
2. Grava esse payload em `chrome.storage.session` (chave `summaryPayload`) — a mesma área de memória-só, nunca-disco que já guarda a conexão, só que aqui é uma entrega único-uso, não uma sessão persistente.
3. Abre `src/summary/summary.html` numa aba nova via `chrome.tabs.create` (sempre uma aba nova, diferente do clique numa issue que reaproveita a aba — aqui cada resumo é um documento novo, não uma navegação repetida ao mesmo recurso).
4. `summary.js`, ao carregar, lê e imediatamente **remove** essa chave do `chrome.storage.session` — reabrir a URL da página sem passar pelo botão mostra um estado vazio, não um resumo antigo.

O título da página traz o período (`rangeLabel`) e, abaixo, uma linha só com os filtros que **de fato restringem algo** (`Projects: ...` só se menos que todos os projetos estiverem marcados; `Status: ...` da mesma forma; `Search: "..."` só se o campo de texto não estiver vazio) — filtro "tudo selecionado" não aparece como se tivesse sido aplicado. O layout reaproveita as mesmas classes CSS visuais do agrupamento por dia do painel (`item-group-header`, `item-row`, `status-chip`, `item-worklog-comment`), mas como página própria (`src/summary/summary.css`), não link para o `panel.css` — mesma convenção de cada superfície ter seu próprio CSS que já vale para `welcome.html`/`options.css`. Não é clicável (não abre issues no Jira) — é puramente um resumo para ler/copiar/imprimir fora do side panel estreito.

Ainda sem abas, sem acordeão colapsável, sem barra de progresso vs. meta de horas, sem rodapé de total geral, sem Planning — isso continua fora de escopo (seção 11).

> Todos os textos de UI em inglês.

---

## 7. manifest.json

```json
{
  "manifest_version": 3,
  "name": "Jira Timesheet Viewer",
  "version": "0.1.0",
  "description": "Search and view your assigned Jira issues by date range.",
  "permissions": ["storage", "sidePanel"],
  "host_permissions": ["https://*.atlassian.net/*"],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" }
  },
  "side_panel": { "default_path": "src/panel/panel.html" },
  "options_page": "src/options/options.html",
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

Sem `alarms` — nenhum código usa `chrome.alarms` no escopo atual. Só volta ao manifest quando algo realmente chamar essa API (cache com refresh em segundo plano, se algum dia for feito).

---

## 8. Roadmap por fases (escopo de pesquisa/visualização)

| Fase | Entrega | Status |
|---|---|---|
| **0** | Scaffold + manifest + formulário de conexão no popup | **Feito** |
| **1** | `jira-client.js`: auth, paginação `nextPageToken`, retry/429 | **Feito** |
| **2** | My Items: calendário de período + filtro de projetos + filtro de status + filtro de work item (texto) + lista agrupada por dia (com descrição do worklog) + lista de não-logados + clique abre no Jira + resumo em nova aba | **Feito** |
| **3** | Start Date discovery (customfield) + coluna no grid | Não iniciado — opcional |
| **4** | Cache em `chrome.storage.local` com TTL | Não iniciado |
| **5** | Polimento: empty states, dark mode, ícones finais, privacy policy | Parcial — dark mode já existe |

**Total do escopo atual:** essencialmente entregue. O que resta é polimento e, opcionalmente, o Start Date.

---

## 9. manifest.json — permissões e Chrome Web Store

Ver `CLAUDE.md`, seção "Responsabilidades para publicar na Chrome Web Store", para a lista completa de exigências da loja (single purpose, permissões mínimas, privacy policy, assets da ficha).

---

## 10. Armadilhas conhecidas (para o escopo atual)

- **`duedate IS EMPTY`.** Muita issue não tem due date. A JQL sempre inclui (`OR duedate IS EMPTY`) — não existe mais checkbox pra isso; a curadoria é pelos filtros de projeto/status (seção 6).

- **Timezone dos worklogs.** `started` vem com offset (ex.: `2026-07-22T08:00:00.000-0300`). Agrupar por dia fatiando a string ISO na mão desloca lançamentos perto da meia-noite para o dia errado. `isoDateInTimeZone` (em `dates.js`) resolve isso corretamente usando o timezone da conta conectada (`me.timeZone`, não mais `America/Sao_Paulo` fixo) — nada além dele deve fatiar data de worklog.

- **Service worker morre.** MV3 mata o worker após ~30s de idle. Isso não derruba mais a conexão (ela vive em `chrome.storage.session`, recarregada no próximo request — seção 3) — mas qualquer *outro* estado só em memória no worker (cache futuro, filas, etc.) ainda some nesse reinício. Continuar tratando o worker como algo que pode sumir a qualquer momento.

- **`/rest/api/3/search/jql` limita `fields`.** Pedir só o que se usa (`summary`, `status`, `duedate`, `timetracking`); o payload cresce rápido.

- **Data Center vs Cloud.** Se houver instância Server/DC em algum projeto, o endpoint `search/jql` não existe — usaria `/rest/api/2/search`. Não implementado; hoje o plugin assume Jira Cloud.

---

## 11. Histórico de escopo: apontamento e Timesheet

**Linha do tempo, para quem for ler isso depois:**

1. Versões iniciais deste plano previam uma funcionalidade "Timesheet": worklogs agrupados por dia, comparação planejado vs. logado, export CSV.
2. Em 2026-07-22, a pedido do usuário, isso foi **cortado do escopo** — o plugin virou só pesquisa e visualização por data, sem ler worklogs, com o clique na issue como único "mecanismo de apontamento" (leva ao Jira). `fetchIssueWorklogs`, `mapWithLimit`, `dayBoundsMs`/`zonedDayStart` ficaram no código, prontos mas sem nenhuma chamada, documentados como "fora de escopo por enquanto".
3. Ainda em 2026-07-22, o usuário pediu de volta a leitura de worklogs — agrupamento por dia, com totalizador por item e por dia, mais uma lista final de issues sem apontamento no período (ver seção 0 e §5/§6). **Isso foi implementado**, reaproveitando exatamente o código que tinha sido deixado pronto no passo 2.
4. Também em 2026-07-23, o usuário pediu três ajustes sobre isso: filtro de status por checkbox (em popover, substituindo o checkbox de due date), filtro de projetos por checkbox antes do calendário, e a descrição do worklog aparecendo abaixo do item no agrupamento por dia. **Isso foi implementado** — ver §4, §5, §6.
5. Ainda em 2026-07-23, o usuário reportou que o filtro de projetos "não aparece as opções" e pediu para reposicioná-lo **depois do calendário** (abaixo dele, acima do Status) em vez de antes — e para adicionar um terceiro filtro, de **work item**, depois de todos os outros. O bug era uma corrida real: um segundo clique no botão (ou um clique fora incidental) enquanto `GET_PROJECTS` ainda estava em voo fechava o popover antes da lista chegar, e ela nunca aparecia — corrigido ignorando cliques de toggle/fechar-fora enquanto `projectsLoading` é `true` (ver `SKILL.md` "Known traps"). Perguntado ao usuário se "work item" significava um filtro por tipo (Task/Bug/Story/Epic, mesmo padrão de checkbox) ou uma busca por texto — escolheu **busca por texto** (chave ou resumo, client-side, igual ao filtro de status). **Isso foi implementado** — ver §5, §6.
6. Ainda em 2026-07-23 (mesma sessão), o usuário pediu para encerrar essa rodada com uma funcionalidade nova: um botão depois de todos os filtros que abre, numa aba nova, um resumo somente-leitura dos itens com apontamento dentro dos agrupamentos por dia já filtrados na tela — sem os itens/dias sem apontamento, com um título simples trazendo o período e os filtros de fato aplicados. **Isso foi implementado** como `src/summary/summary.html`/`.css`/`.js`, alimentado via `chrome.storage.session` (entrega único-uso, não uma sessão) — ver §5, §6.

**O que continua fora de escopo, mesmo agora:**

- **Comparação planejado vs. logado** (Planning) — `originalEstimateSeconds` distribuído entre Start→Due e comparado com o total logado.
- **Barra de progresso por dia vs. meta de horas de trabalho** (ex.: verde ≥ 8h, âmbar abaixo) — o painel de Options já tem o campo `Working hours per day`, mas nada o consome ainda.
- **Acordeão colapsável, abas, rodapé com total geral, export CSV.**
- **Start Date discovery** (Fase 3) — continua opcional, não pedido ainda.

Se algum desses for pedido, o ponto de partida é o mesmo princípio: estender o que `SEARCH` já devolve (`logsByDay` por issue) em vez de inventar um novo message type, e não reinventar a parte de rede/timezone que já existe.

**Não usar `POST /worklog`, `PUT /issue` ou `DELETE` neste projeto.** Mesmo com leitura de worklogs implementada, criar ou editar apontamentos continua fora de escopo a menos que o usuário peça explicitamente — e mesmo assim, precisaria de uma tela de confirmação própria (ver `SKILL.md`, "Non-negotiables").

---

## 12. Próximo passo sugerido

O escopo de pesquisa/visualização com leitura de worklogs por dia (Fases 0–2) já está implementado. Próximos passos possíveis, em ordem de valor:
1. Testar localmente com uma conta Jira real (ver `README.md`) — em especial conferir o agrupamento por dia com dados reais de worklog.
2. Fase 5 (polimento): ícones finais, privacy policy, screenshot — necessários antes de publicar na Chrome Web Store.
3. Se fizer falta, Fase 3 (Start Date) ou Fase 4 (cache — agora mais valioso, já que `SEARCH` faz uma chamada de rede por issue).
4. Só depois disso — e só se o usuário pedir — o que ainda está fora de escopo na seção 11 (Planning, barra de progresso, acordeão/abas, CSV).
