# Jira Timesheet Viewer

Extensão de navegador (Chrome/Edge, Manifest V3) de **pesquisa e visualização**: mostra rapidamente quais issues do Jira estão sob sua responsabilidade num período, agrupadas pelo dia em que você apontou horas nelas. Ela **lê** apontamentos (worklogs) — não cria nem edita nenhum. Para lançar horas, clique na issue e faça isso na tela normal do Jira, como sempre.

Nada aqui cria, edita ou apaga issues ou worklogs no Jira. Detalhes de arquitetura e decisões de projeto estão em [CLAUDE.md](CLAUDE.md) e no plano completo em [.claude/plano-jira-timesheet-viewer.md](.claude/plano-jira-timesheet-viewer.md) (seção 11 tem a linha do tempo de escopo e o que ainda fica de fora).

## O que ela faz

1. Você escolhe um período num pequeno calendário (clique no dia inicial, depois no dia final). A busca sempre traz tudo que é seu no período, com ou sem due date.
2. Abaixo do calendário, a interface é dividida em duas áreas independentes com botões de busca próprios:
   - **Timesheet**: Busca os seus apontamentos de horas. É afetada **apenas pelo período de datas** selecionado no calendário e lista tudo o que você apontou, sem restrições.
   - **My Items**: Busca os itens atribuídos a você no período. É afetada pelas datas e pelo filtro de **Projetos** (que restringe a busca na API do Jira), além de sub-filtros locais (Status, Item Type e Busca por texto) que reorganizam a lista já trazida sem nova chamada de rede.
3. A lista de Timesheet aparece agrupada por dia do período — cada dia mostra as issues em que você logou horas naquele dia específico, com o total de itens e horas do dia, e a descrição do apontamento logo abaixo de cada item (quando existir). Dias sem nenhum apontamento aparecem assim mesmo, em vez de sumirem da lista.
4. Na área de My Items, a seção de issues mostra as tarefas atribuídas a você. Há também um switch para **Unlogged only** que mostra apenas as que não tiveram apontamento.
5. Clicar numa issue abre ela na aba normal do Jira (`/browse/CHAVE`, reaproveitando a mesma aba entre cliques) — é lá que você faz o apontamento, com o **Log work** de sempre.
6. Depois de todos os filtros, o botão **Open summary in new tab** abre uma aba nova só com um resumo do que está agrupado por dia na tela — sem refazer a busca, sem os dias/itens sem apontamento, com o período e os filtros de fato aplicados no topo. É uma segunda visualização somente-leitura dos mesmos dados, pensada para copiar, revisar ou imprimir fora do side panel estreito.

## Segurança — o que você precisa saber antes de conectar

A URL do Jira, o e-mail e o API token **nunca são salvos em disco** — ficam em `chrome.storage.session`, uma área de memória do próprio navegador que é apagada quando você fecha o Chrome/Edge por completo. Isso significa que você conecta uma vez por sessão do navegador, não uma vez a cada uso — a extensão não pede a credencial de novo só porque ficou parada um tempo. Clicar em **Disconnect** (no popup ou em Settings) limpa isso na hora, se você quiser encerrar antes. Detalhes em [CLAUDE.md](CLAUDE.md#non-negotiables-resumo--detalhe-completo-na-skill).

## Usando um gerenciador de senhas

A extensão em si nunca guarda a credencial em disco (seção acima) — isso é deliberado e não muda. Mas nada te impede de guardar você mesmo o token num cofre de senhas, para não precisar ir buscar no Jira toda vez que o navegador reiniciar. Duas formas de fazer isso, com expectativas diferentes:

**1. Deixar o navegador oferecer salvar (pode ou não funcionar)**

Os campos do formulário de conexão já têm as dicas padrão (`autocomplete="username"` no e-mail, `autocomplete="current-password"` no token) para que o gerenciador de senhas nativo do Chrome/Edge reconheça o formulário. Depois de clicar **Connect**, veja se aparece um aviso de "Salvar senha?" no canto superior do navegador, ou um ícone de chave dentro do campo do token da próxima vez que abrir o formulário.

Não temos garantia de que isso aparece: o formulário fica dentro de uma página da própria extensão (popup/side panel), e o Chrome não documenta claramente se o heurístico de "login bem-sucedido" (normalmente ligado a navegação de página) dispara nesse contexto. É seguro tentar — só não conte com isso funcionar sempre. Se não aparecer nada, use a opção 2.

**2. Guardar manualmente num cofre e colar (sempre funciona)**

Extensões de terceiros (1Password, Bitwarden, LastPass, Dashlane, etc.) **não conseguem** preencher automaticamente dentro do popup ou side panel desta extensão — por design do Chrome, o script de autofill de uma extensão não tem acesso à página de outra extensão. Autofill automático de um cofre de terceiros aqui dentro não vai funcionar, e não é um bug da nossa extensão.

O caminho que sempre funciona é copiar e colar:

1. Crie manualmente uma entrada no seu gerenciador de senhas (nativo do navegador, ou 1Password/Bitwarden/etc.) para o Jira — por exemplo, um login com `usuário = seu e-mail` e `senha = o API token`, e a URL base num campo extra ou nas notas.
2. Quando a extensão pedir para conectar, abra o cofre (o popup da extensão do gerenciador, o app, ou o site) e copie os três valores para os campos do formulário.
3. Como você só reconecta uma vez por sessão do navegador (não a cada uso — ver seção de segurança acima), isso já reduz bastante a fricção mesmo sendo copiar e colar.

Isso é uma escolha sua, fora da extensão — ela continua sem persistir nada em disco, e o cofre de senhas é quem guarda o segredo de forma criptografada, do seu lado.

## Testar localmente

### O que é realmente necessário

| Requisito | Por quê | Obrigatório? |
|---|---|---|
| **Google Chrome ou Microsoft Edge** (qualquer versão recente com Manifest V3 e `chrome.sidePanel`, ~114+) | É o único runtime que executa a extensão — o navegador carrega e interpreta o JS diretamente, sem nenhum passo de build | **Sim** |
| Conta no Jira Cloud + [API token](https://id.atlassian.com/manage-profile/security/api-tokens) | Para conectar de verdade e ver dados reais | **Sim**, para usar além da tela de conexão |
| Git | Para clonar o repositório | **Sim**, ou baixe o ZIP do GitHub |
| Python 3 + Pillow | Só para **regenerar** os ícones (`scripts/make_icons.py`) | Não — os PNGs já vêm prontos em `icons/` |
| Python 3 (stdlib) | Só para **empacotar** o zip de publicação (`scripts/package_extension.py`) | Não — só na hora de publicar, não para testar |
| **Node.js / npm** | — | **Não é usado em lugar nenhum do projeto.** Não há build step, bundler, transpiler ou dependência de pacote. Node só apareceria se alguém quisesse rodar `node --check *.js` como lint de sintaxe fora do navegador — conveniência de desenvolvimento, nunca um requisito para carregar ou usar a extensão |

Ou seja: para testar o MVP, **só precisa do navegador** (mais uma conta Jira para ver dados reais). Nenhuma instalação de ambiente de build é necessária — é exatamente o ponto de ser "vanilla JS sem build step".

### Passo a passo

1. Clone este repositório (ou baixe e extraia o ZIP do GitHub).
2. Abra `chrome://extensions` (ou `edge://extensions`) e ative o **Developer mode** (canto superior direito).
3. Clique em **Load unpacked** e selecione a pasta raiz deste repositório (a que contém `manifest.json`).
4. Uma aba de instruções (`src/welcome/welcome.html`) abre automaticamente na primeira instalação — ela explica como gerar o token e conectar.
5. Clique no ícone da extensão na barra de ferramentas, preencha a URL do Jira, e-mail e token, e clique em **Connect**.
6. Clique em **Open My Items** para abrir o side panel e usar o calendário.

Se o passo 3 der erro do tipo "manifest.json inválido" ou similar, confira se você selecionou a pasta certa (raiz do repositório, não `src/`) e se o Developer mode está mesmo ativo.

Depois de editar `src/background/service-worker.js`, clique no ícone de recarregar no card da extensão em `chrome://extensions`. Editar só popup/panel/options basta reabrir aquela tela (fechar e abrir de novo o popup, ou dar refresh no side panel/options).

Sem build step — é JS puro (ES Modules), então qualquer edição é só salvar e recarregar. Não existe `npm install` a rodar.

## Configuração

Preferências não-sensíveis (horas de trabalho por dia, etc.) ficam na página de **Settings** (clique no ícone ⚙︎ no popup ou no painel). Não há nenhum campo de credencial lá — isso é proposital, veja a seção de segurança acima.

## Empacotar para publicação

```bash
python scripts/package_extension.py
```

Gera `dist/jira-timesheet-viewer-v{versão}.zip` com exatamente o que o Chrome carrega (`manifest.json`, `src/`, `icons/`) — nada de `.claude/`, `scripts/` ou documentação. Esse arquivo é o que se envia em [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole).

**Antes de publicar de verdade**, veja a seção "Responsabilidades para publicar na Chrome Web Store" em [CLAUDE.md](CLAUDE.md) — em especial:
- os ícones em `icons/*.png` são placeholders gerados por `scripts/make_icons.py`; troque por arte de verdade antes de submeter;
- é exigida uma privacy policy pública (fiscalização mais rígida a partir de 1º de agosto de 2026);
- prepare pelo menos uma screenshot (1280×800 ou 640×400) e uma descrição para a ficha da loja.

## Estado do projeto

Escopo de pesquisa/visualização com leitura de worklogs implementado: conexão guardada em `chrome.storage.session` (memória do navegador, nunca disco), calendário de período, separação das seções em **Timesheet** (busca baseada estritamente em datas, exibindo apontamentos) e **My Items** (busca baseada em datas e projetos, com filtros locais/client-side de status, tipo e texto livre para os seus itens), cada uma com seu próprio botão de busca. Há lista agrupada por dia de apontamento (com descrição do worklog), clique para abrir no Jira, e um botão de resumo somente-leitura numa aba nova. Deliberadamente **ainda não inclui** comparação planejado vs. logado, barra de progresso vs. meta de horas, acordeão/abas ou export CSV — isso foi cortado do escopo a pedido do usuário (ver plano, seção 11), não é um "ainda não chegou lá". O roadmap do que falta (opcional: Start Date, cache) está em [.claude/plano-jira-timesheet-viewer.md](.claude/plano-jira-timesheet-viewer.md).

## Licença

MIT — veja [LICENSE](LICENSE).
