# Jira Timesheet Viewer

Extensão de navegador (Chrome/Edge, Manifest V3) de **pesquisa e visualização, versão 1.0.0**: dado um período (data início/fim), mostra quais issues do Jira estão atribuídas a você nesse período e o que você logou em cada dia, sem nunca criar ou editar nada no Jira.

Não é uma ferramenta de **criação** de apontamento — ela só lê worklogs, inclusive a descrição, quando existe. Cada issue da lista é clicável e abre a tela normal do Jira (`/browse/{key}`), onde o usuário loga horas exatamente como sempre fez; esse clique é o único "mecanismo de apontamento" que a extensão oferece.

A interface tem duas áreas de busca independentes, cada uma com seu próprio botão:

- **Timesheet** — busca baseada só em datas, sempre traz todos os worklogs do usuário no período. Dentro de cada dia, os worklogs aparecem ordenados por horário (`started`), cruzando issues diferentes — não agrupados por issue.
- **My Items** — busca baseada em data, restrita por um filtro de Projetos na própria consulta ao Jira, mais sub-filtros client-side (sem nova chamada de rede) de Status, Tipo do Item e um campo de texto livre.

Depois de qualquer busca, o botão **`Open summary in new tab`** abre uma página própria da extensão com um resumo somente-leitura do que está agrupado por dia na tela, pulando dias e itens sem apontamento — sem refazer a busca.

Para testar localmente ou empacotar, ver [README.md](README.md).

## O que está fora de escopo

Deliberadamente, não a esta altura: comparação planejado vs. logado (Planning), barra de progresso por dia vs. meta de horas, acordeão colapsável/abas, export CSV, descoberta automática de campo "Start Date", e cache de busca. Nenhuma dessas é uma fase futura planejada — são simplesmente não-objetivos do produto hoje. Não implementar nenhuma delas sem o usuário pedir explicitamente.

Antes de gerar ou reescrever qualquer arquivo, rode `git status` / olhe o disco para confirmar o que já existe — regenerar arquivos por cima descarta edição do usuário silenciosamente. **Cuidado especial com `scripts/scaffold.py --force`**, que sobrescreve `.gitignore` se rodado num diretório não-vazio sem conferência arquivo a arquivo.

## Skills do projeto

Duas skills, com responsabilidades separadas — implementar não é a mesma etapa que publicar.

| Skill | Responsabilidade |
|---|---|
| **`jira-timesheet-viewer`** (`.claude/skills/jira-timesheet-viewer/`) | Fonte de verdade técnica da extensão em si: non-negotiables, layout de pastas, método de trabalho, armadilhas conhecidas. Carregada automaticamente para qualquer pedido de construir, debugar ou estender a extensão. |
| **`ship-release`** (`.claude/skills/ship-release/`) | Entrega no GitHub depois que uma mudança já foi implementada e verificada: bump de versão, entrada no changelog publicado no Pages e, só após confirmação explícita do usuário, push + tag disparando o release automático. |

| Referência técnica | Cobre |
|---|---|
| `jira-timesheet-viewer/references/jira-api.md` | Auth, paginação `nextPageToken`, JQL (Timesheet e My Items), worklogs, rate limit, Cloud vs Data Center |
| `jira-timesheet-viewer/references/extension-arch.md` | Ciclo de vida do service worker MV3, protocolo de mensagens, `chrome.storage`, side panel, CSP |
| `jira-timesheet-viewer/references/ui-spec.md` | Layout do popup/side panel, strings finais em inglês, formatação de horas/datas |
| `jira-timesheet-viewer/scripts/scaffold.py` | Gera o esqueleto inicial (`python scripts/scaffold.py <target-dir>`) |

**Leia a referência antes de escrever o código que ela cobre.** Não duplique esse conteúdo aqui — se este arquivo e uma skill divergirem algum dia, a skill vence em detalhe técnico; este arquivo vence em regras de projeto e de publicação.

## Non-negotiables (resumo — detalhe completo na skill)

- **Credencial nunca em texto no repositório.** Token, e-mail ou `accountId` reais não podem aparecer em código, exemplo, commit ou fixture.
- **Dado de conexão corporativa, por padrão, nunca vai para disco.** URL do Jira, e-mail e API token são digitados na tela num formulário de conexão (popup, e side panel se aberto sem conexão ativa) e ficam em `chrome.storage.session` — memória do navegador, sobrevive ao service worker reiniciar (MV3 mata o worker a cada ~30s ocioso), mas some ao fechar o navegador. Nunca disco, a menos que o usuário opte explicitamente pela exceção abaixo.
- **Exceção opt-in: persistência criptografada entre reinícios do navegador.** Checkbox desmarcado por padrão, "Stay connected on this device", no formulário de conexão. Quando marcado, o token é cifrado (AES-GCM, chave `extractable:false` guardada como `CryptoKey` no IndexedDB do service worker — `src/lib/secure-store.js`) e só o ciphertext vai para `chrome.storage.local` (`persistedConnection`); o token em texto puro nunca toca disco. `DISCONNECT` apaga tanto essa entrada quanto o IndexedDB inteiro (crypto-erase). **Limite honesto, não esconder se perguntado:** protege contra leitura via JS de outro contexto, mas não contra alguém com acesso de sistema-de-arquivos à pasta inteira do profile do Chrome copiada para outra máquina — nível equivalente ao gerenciador de senhas nativo do Chrome, não uma garantia mais forte que isso. Não adicionar um terceiro mecanismo de persistência, nem ligar este por padrão, sem checar com o usuário de novo.
- **O token nunca chega a um page context.** Popup e panel capturam a credencial só no formulário de conexão e a repassam uma vez ao service worker via `chrome.runtime` messaging; nenhuma outra tela a retém.
- **Todo texto de UI é em inglês** — botões, labels, estados vazios, erros. A conversa com o usuário é em português; o artefato não.
- **Somente leitura.** Só `GET` e o `POST /rest/api/3/search/jql` de consulta. Qualquer `POST/PUT/DELETE` que altere dados no Jira está fora de escopo, a menos que explicitamente pedido — e mesmo assim exige uma confirmação própria na UI.

## Stack

Vanilla JS (ES Modules) + HTML/CSS puro, sem build step. `chrome://extensions → Load unpacked` deve funcionar direto. Só migrar para Vite + React se o usuário pedir explicitamente ou a UI genuinamente exigir — e avisar antes de fazer, nunca decidir isso sozinho.

## Estrutura de pastas

```
jira-timesheet-viewer/
├── manifest.json
├── src/
│   ├── background/service-worker.js   # único lugar com credenciais; CONNECT/SEARCH/GET_PROJECTS/DISCONNECT
│   ├── lib/                           # jira-client, jql (Timesheet + My Items), dates, messaging, settings, connect-form, secure-store
│   ├── popup/                         # formulário de conexão + "Open My Items" (abre o side panel)
│   ├── panel/                         # calendar.js + multi-select.js (filtros de projeto/status/tipo) + panel.js (Timesheet + My Items + resumo)
│   ├── options/                       # só preferências (horas de trabalho) — sem campos de credencial
│   ├── summary/                       # summary.html/css/js — resumo somente-leitura aberto numa aba nova
│   └── welcome/                       # página de instruções, aberta em chrome.runtime.onInstalled
├── icons/                             # 16, 32, 48, 128
├── docs/                              # GitHub Pages: privacy policy + histórico de versões (changelog.html)
├── .github/workflows/release.yml      # tag vX.Y.Z → build do zip → GitHub Release
├── scripts/                           # make_icons.py, package_extension.py (dev-only, fora do pacote publicado)
└── .claude/skills/                    # jira-timesheet-viewer (implementação) + ship-release (entrega)
```

## Verificação antes de reportar uma mudança como pronta

```bash
find src -name '*.js' -exec node --check {} \;                 # sem erro de sintaxe
python -c "import json;m=json.load(open('manifest.json'));print(m['manifest_version'], list(m))"
grep -rniE 'ATATT|api[_-]?token\s*[:=]\s*["'\''][^"'\'']{12,}' src manifest.json || echo "clean"
```

Depois, pedir para o usuário carregar como unpacked e exercitar o que foi adicionado ou mudado. Reportar o que foi verificado mecanicamente versus o que ainda depende dos olhos do usuário.

## Fluxo de trabalho e entrega (release)

Todo trabalho segue três etapas, cada uma com dono claro:

1. **Usuário explica o que espera** — em português, na conversa.
2. **Implementação** — feita pela skill `jira-timesheet-viewer`: código, verificação mecânica (sintaxe, manifest, grep de credencial), e pedido para o usuário testar como unpacked.
3. **Entrega no GitHub** — feita pela skill `ship-release`, só depois que (2) está pronto e o usuário pede para publicar: bump de versão, entrada nova em `docs/changelog.html`, commit, confirmação explícita do usuário, e só então push + tag na `main`.

O pipeline técnico da etapa 3:

```
push da tag vX.Y.Z
        │
        ▼
.github/workflows/release.yml dispara
        │
        ├─ checkout do repo
        ├─ python scripts/package_extension.py   (mesmo script usado pro Chrome Web Store)
        │  → gera dist/jira-timesheet-viewer-vX.Y.Z.zip
        └─ publica GitHub Release da tag, com o zip anexado e release notes automáticas
```

`docs/changelog.html` é publicado pelo GitHub Pages diretamente da pasta `docs/` na `main` — mesmo mecanismo que já serve `docs/index.html` (a privacy policy); não existe um segundo workflow para isso. A página **não** é gerada pela Action — é escrita à mão pela skill `ship-release`, com bullets legíveis por humano, antes do push.

**Push na `main` e push de tag sempre exigem confirmação explícita do usuário antes de rodar.** São ações públicas e difíceis de reverter — a tag dispara a Action imediatamente e publica um artefato real, baixável por qualquer pessoa. O usuário autorizou o formato deste fluxo ao pedir a skill, mas isso não substitui confirmar cada execução específica — ver `ship-release/SKILL.md`.

## Responsabilidades para publicar na Chrome Web Store

Isto é sobre o processo de **submissão/loja**, que a skill não cobre (ela cobre a extensão em si). Regras vigentes da Chrome Web Store Developer Program Policy:

- **Single purpose.** A extensão deve ter um propósito único e estreito ("buscar e ver issues do Jira atribuídas ao usuário, por período, com o que já foi apontado"). Não empacotar funcionalidade não relacionada — se algo for genuinamente separado, vira outra extensão.
- **Permissões mínimas + justificativa.** Pedir só `storage`, `sidePanel` e `host_permissions` para `https://*.atlassian.net/*` (ou origem específica de Data Center). `alarms` só entra no manifest quando algum código realmente chamar `chrome.alarms`. Evitar `<all_urls>` — permissão ampla é motivo de rejeição na revisão. No Developer Dashboard, cada permissão precisa de um campo de justificativa textual explicando por que é necessária, incluindo `storage` — que guarda preferências, a conexão em `chrome.storage.session`, e a entrega único-uso do resumo para `src/summary/`.
- **Sem código remoto.** Manifest V3 proíbe carregar lógica executável de fora do pacote (`eval`, scripts de CDN, lógica remota). Todo o JS precisa estar no pacote submetido. Buscar dados remotos (a própria API do Jira) é permitido; buscar e executar *código* remoto não.
- **CSP sem inline scripts.** Nenhum `<script>` inline, nenhum `onclick=` no HTML — já é a convenção adotada pela skill.
- **Política de privacidade obrigatória.** Como a extensão manuseia dados do usuário (e-mail, token, dados do Jira), é exigida uma privacy policy pública, com URL persistente acessível sem login, data de vigência e e-mail de contato válido — já publicada em `docs/index.html`.
- **Uso de dados limitado ao propósito divulgado.** Nada de repassar dados do usuário para anúncios ou data brokers — nem que seja hipotético, isso barra a extensão na revisão.
- **Assets da ficha da loja.** Ícones 16/48/128/32, screenshot (1280×800 ou 640×400), descrição detalhada, categoria e e-mail de suporte — ver `store-assets/`.

Sources: [Chrome Web Store policy updates 2026](https://developer.chrome.com/blog/cws-policy-updates-2026) · [Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) · [Privacy Policies requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)

## Comunicação

O usuário trabalha em português — explicações, resumos e perguntas em português. Código, comentários, mensagens de commit, nomes de arquivo e toda string de UI ficam em inglês. Quando houver um trade-off real (Basic Auth vs OAuth, popup vs side panel, vanilla vs framework), apresentar a troca e deixar o usuário escolher em vez de decidir silenciosamente.
