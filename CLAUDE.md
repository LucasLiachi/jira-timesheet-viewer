# Jira Timesheet Viewer

Extensão de navegador (Chrome/Edge, Manifest V3) de **pesquisa e visualização**: dado um período (data início/fim), mostra quais issues do Jira estão atribuídas a você nesse período, agrupadas por dia de apontamento — o que foi logado em cada dia, e ao final, o que não foi logado no período todo.

Não é uma ferramenta de **criação** de apontamento — ela lê worklogs, não cria (inclusive a descrição do worklog, quando existe). Cada issue da lista é clicável e abre a tela normal do Jira (`/browse/{key}`), onde o usuário loga horas exatamente como sempre fez. A busca sempre traz tudo que é do usuário no período; a curadoria é por três filtros, nesta ordem abaixo do calendário: **projetos** e **status** são multi-select (botão + popover com checkboxes) — projetos estreita a JQL da própria busca, status sub-filtra a lista já trazida sem nova chamada de rede — e **work item** é um campo de texto simples, filtrando por chave ou resumo, também client-side, por último. Depois de todos os filtros, um botão **`Open summary in new tab`** abre uma página própria da extensão (sem nova busca) com um resumo somente-leitura do que está agrupado por dia na tela, pulando dias/itens sem apontamento. Ver [.claude/plano-jira-timesheet-viewer.md](.claude/plano-jira-timesheet-viewer.md) §11 para o histórico de escopo (foi cortado, depois parcialmente retomado, tudo a pedido do usuário) e o que ainda fica de fora (Planning, barra de progresso vs. meta, acordeão/abas, CSV).

Nada aqui cria, edita ou apaga issues no Jira. O plano de desenvolvimento completo está em [.claude/plano-jira-timesheet-viewer.md](.claude/plano-jira-timesheet-viewer.md). Para testar localmente ou empacotar para a Chrome Web Store, ver [README.md](README.md).

## Estado atual

Escopo de pesquisa/visualização com leitura de worklogs implementado (Fases 0–2 do plano): conexão via popup guardada em `chrome.storage.session` (memória do navegador, nunca disco — dura até o navegador fechar); calendário no side panel para escolher um período (clique no dia inicial, depois no final); filtro de projetos (multi-select, abaixo do calendário — continua afetando a JQL da busca mesmo estando depois das datas na tela); filtro de status (multi-select, abaixo do de projetos, sub-filtro client-side); filtro de work item (campo de texto, por último, filtra por chave ou resumo, também client-side); e lista **agrupada por dia** — issues logadas em cada dia com as horas e a descrição do worklog daquele dia (se houver), dias sem apontamento aparecem explicitamente, e ao final uma seção com tudo que não tem apontamento nenhum no período. Clique na issue abre no Jira, reaproveitando a mesma aba. Depois de todos os filtros, o botão `Open summary in new tab` abre `src/summary/summary.html` numa aba nova (via `chrome.storage.session` como entrega único-uso, sem nova busca) com o mesmo agrupamento por dia, mas só os dias/itens com apontamento de verdade. Fase 3 (Start Date) e Fase 4 (cache) são opcionais e não foram feitas; Fase 5 (polish/store assets) está parcial. Instruções de teste local e empacotamento estão no [README.md](README.md).

**Ainda fora de escopo**: comparação planejado vs. logado (Planning), barra de progresso por dia vs. meta de horas, acordeão colapsável/abas, CSV export. Isso foi cortado uma vez a pedido do usuário e continua fora — não reintroduzir sem pedirem de novo. Ver `plano-jira-timesheet-viewer.md` §11 para a linha do tempo completa de decisões de escopo, todas a pedido explícito do usuário.

Antes de gerar ou reescrever qualquer arquivo, rode `git status` / olhe o disco para confirmar o que já existe: retomar uma fase no meio é o caso comum, e regenerar arquivos por cima descarta edição do usuário silenciosamente. **Cuidado especial com `scripts/scaffold.py --force`** — ele já sobrescreveu o `.gitignore` real deste projeto uma vez (corrigido; ver comentário no próprio script). Rodar o scaffold de novo num diretório não-vazio deve ser conferido arquivo a arquivo, não assumido como seguro.

## Skill do projeto

A skill **`jira-timesheet-viewer`** (`.claude/skills/jira-timesheet-viewer/`) é a fonte de verdade técnica e é carregada automaticamente pelo Claude Code quando o pedido for sobre construir, retomar, debugar ou estender esta extensão. Ela contém o que este arquivo não repete:

| Arquivo | Cobre |
|---|---|
| `SKILL.md` | Non-negotiables, layout de pastas, roadmap por fases, método de trabalho, armadilhas conhecidas |
| `references/jira-api.md` | Auth, paginação `nextPageToken`, JQL, worklogs, ADF, rate limit, Cloud vs Data Center |
| `references/extension-arch.md` | Ciclo de vida do service worker MV3, protocolo de mensagens, `chrome.storage`, side panel, CSP |
| `references/ui-spec.md` | Layout do popup/side panel, strings finais em inglês, formatação de horas/datas |
| `scripts/scaffold.py` | Gera o esqueleto inicial (`python scripts/scaffold.py <target-dir>`) |

**Leia a referência antes de escrever o código que ela cobre.** Não duplique esse conteúdo aqui — se este arquivo e a skill divergirem algum dia, a skill vence em detalhe técnico; este arquivo vence em regras de projeto e de publicação.

## Non-negotiables (resumo — detalhe completo na skill)

- **Credencial nunca em texto no repositório.** Token, e-mail ou `accountId` reais não podem aparecer em código, exemplo, commit ou fixture.
- **Dado de conexão corporativa nunca vai para disco.** URL do Jira, e-mail e API token são digitados na tela num formulário de conexão (popup, e side panel se aberto sem conexão ativa) e ficam em `chrome.storage.session` — memória do navegador, nunca `chrome.storage.local`, nunca disco. **Mudança deliberada em 2026-07-22:** a regra original era "nunca persiste em lugar nenhum" (nem `chrome.storage.session`); foi relaxada a pedido do usuário porque o service worker do MV3 morre a cada ~30s ocioso, e como a conexão vivia só numa variável em memória, isso forçava reconectar o tempo todo — fricção grande demais para o ganho de segurança. `chrome.storage.session` resolve isso (sobrevive ao worker reiniciar) mantendo a garantia que importava (nunca toca disco; some ao fechar o navegador). Se o usuário pedir para apertar essa regra de novo no futuro, é só voltar à variável em memória pura — ver histórico do `service-worker.js`. Só preferências não-sensíveis (horas de trabalho) persistem em `chrome.storage.local`.
- **O token nunca chega a um page context.** Popup e panel capturam a credencial só no formulário de conexão e a repassam uma vez ao service worker via `chrome.runtime` messaging; nenhuma outra tela a retém.
- **Fricção adicional de reconectar é resolvida fora da extensão, não persistindo mais dentro dela.** O caminho sancionado é o usuário guardar a credencial no próprio gerenciador de senhas (nativo ou de terceiros) e colar quando pedido — documentado em README.md "Usando um gerenciador de senhas" e no card de dica em `src/welcome/welcome.html`. Os campos do formulário já têm `autocomplete="username"`/`"current-password"` para isso. Se pedirem para reduzir fricção de novo, apontar para essa seção antes de considerar guardar mais dado em `chrome.storage`.
- **Todo texto de UI é em inglês** — botões, labels, estados vazios, erros, cabeçalhos de CSV. A conversa com o usuário é em português; o artefato não.
- **Somente leitura.** Só `GET` e o `POST /rest/api/3/search/jql` de consulta. Qualquer `POST/PUT/DELETE` que altere dados no Jira está fora de escopo, a menos que explicitamente pedido — e mesmo assim exige uma confirmação própria na UI.

## Stack

Vanilla JS (ES Modules) + HTML/CSS puro, sem build step. `chrome://extensions → Load unpacked` deve funcionar direto. Só migrar para Vite + React se o usuário pedir explicitamente ou a UI genuinamente exigir — e avisar antes de fazer, nunca decidir isso sozinho.

## Estrutura de pastas alvo

```
jira-timesheet-viewer/
├── manifest.json
├── src/
│   ├── background/service-worker.js   # único lugar com credenciais; CONNECT/SEARCH/GET_PROJECTS/DISCONNECT
│   ├── lib/                           # jira-client, jql, fields (stub), dates, messaging, settings, connect-form
│   ├── popup/                         # formulário de conexão + "Open My Items" (abre o side panel)
│   ├── panel/                         # calendar.js (grade) + multi-select.js (filtros de projeto/status) + panel.js (estado + lista + filtro de work item por texto + resumo)
│   ├── options/                       # só preferências — sem campos de credencial
│   ├── summary/                       # summary.html/css/js — resumo somente-leitura aberto numa aba nova
│   └── welcome/                       # página de instruções, aberta em chrome.runtime.onInstalled
├── icons/                             # 16, 32, 48, 128 (placeholders gerados por scripts/make_icons.py)
├── scripts/                           # make_icons.py, package_extension.py (dev-only, fora do pacote publicado)
└── .claude/
    ├── plano-jira-timesheet-viewer.md
    └── skills/jira-timesheet-viewer/
```

## Roadmap por fases

| Fase | Entrega | Status |
|---|---|---|
| 0 | Scaffold + manifest + formulário de conexão no popup | **Feito** |
| 1 | `jira-client.js` (auth, paginação, retry 429) | **Feito** |
| 2 | My Items — calendário + filtro de projetos + filtro de status + filtro de work item (texto) + lista agrupada por dia (com descrição do worklog) + não-logados + clique abre no Jira + resumo em nova aba | **Feito** — este é o escopo inteiro da extensão hoje |
| 3 | Start Date discovery (customfield) | Não iniciado, opcional |
| 4 | Cache em `chrome.storage.local` com TTL | Não iniciado — mais valioso agora, já que `SEARCH` faz uma chamada de worklog por issue |
| 5 | Polish (ícones finais, privacy policy, screenshot) | Parcial — dark mode via `prefers-color-scheme` já existe |

Planning (planejado vs. logado), barra de progresso vs. meta de horas, acordeão/abas e CSV export **não são fases futuras desta lista** — continuam fora de escopo a pedido do usuário, documentado em `plano-jira-timesheet-viewer.md` §11. Não reintroduzir sem pedirem de novo.

## Verificação antes de reportar uma fase como pronta

```bash
find src -name '*.js' -exec node --check {} \;                 # sem erro de sintaxe
python -c "import json;m=json.load(open('manifest.json'));print(m['manifest_version'], list(m))"
grep -rniE 'ATATT|api[_-]?token\s*[:=]\s*["'\''][^"'\'']{12,}' src manifest.json || echo "clean"
```

Depois, pedir para o usuário carregar como unpacked e exercitar a única coisa que a fase adicionou. Reportar o que foi verificado mecanicamente versus o que ainda depende dos olhos do usuário.

## Responsabilidades para publicar na Chrome Web Store

Isto é sobre o processo de **submissão/loja**, que a skill não cobre (ela cobre a extensão em si). Regras vigentes da Chrome Web Store Developer Program Policy:

- **Single purpose.** A extensão deve ter um propósito único e estreito ("buscar e ver issues do Jira atribuídas ao usuário, por período, com o que já foi apontado"). Não empacotar funcionalidade não relacionada — se algo for genuinamente separado, vira outra extensão.
- **Permissões mínimas + justificativa.** Pedir só `storage`, `sidePanel` e `host_permissions` para `https://*.atlassian.net/*` (ou origem específica de Data Center). `alarms` só volta ao manifest quando algum código realmente chamar `chrome.alarms` (ver roadmap). Evitar `<all_urls>` — permissão ampla é motivo de rejeição na revisão. No Developer Dashboard, cada permissão precisa de um campo de justificativa textual explicando por que é necessária, incluindo `storage` — que agora guarda preferências, a conexão em `chrome.storage.session`, e a entrega único-uso do resumo para a aba de `src/summary/`.
- **Sem código remoto.** Manifest V3 proíbe carregar lógica executável de fora do pacote (`eval`, scripts de CDN, lógica remota). Todo o JS precisa estar no pacote submetido e ser "facilmente discernível" a partir do código enviado. Buscar dados remotos (a própria API do Jira) é permitido; buscar e executar *código* remoto não.
- **CSP sem inline scripts.** Nenhum `<script>` inline, nenhum `onclick=` no HTML — já é a convenção adotada pela skill.
- **Política de privacidade obrigatória.** Como a extensão manuseia dados do usuário (e-mail, token, dados do Jira), é exigida uma privacy policy pública, com URL persistente acessível sem login, data de vigência e e-mail de contato válido, descrevendo que categorias de dado são coletadas, por quê, com quem são compartilhadas e como o usuário pode pedir acesso/exclusão. **A partir de 1º de agosto de 2026 o Google passa a fiscalizar essa regra com mais rigor** — vale preparar a privacy policy antes de publicar, não deixar para a submissão final.
- **Uso de dados limitado ao propósito divulgado.** Nada de repassar dados do usuário para anúncios ou data brokers — nem que seja hipotético, isso barra a extensão na revisão.
- **Assets da ficha da loja.** Ícones 16/48/128 (e idealmente 32), pelo menos uma screenshot (1280×800 ou 640×400), descrição detalhada, categoria e e-mail de suporte — planejar isso na Fase 5 (Polish).

Sources: [Chrome Web Store policy updates 2026](https://developer.chrome.com/blog/cws-policy-updates-2026) · [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) · [Privacy Policies requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)

## Comunicação

O usuário trabalha em português — explicações, resumos e perguntas em português. Código, comentários, mensagens de commit, nomes de arquivo e toda string de UI ficam em inglês. Quando houver um trade-off real (Basic Auth vs OAuth, popup vs side panel, vanilla vs framework), apresentar a troca e deixar o usuário escolher em vez de decidir silenciosamente.

