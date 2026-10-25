# Specs Bot — Plano v2

> Revisão do `PLAN.md` / `CLI.md` contra os dados reais em `botopink-lang/specs` (2026-10-25).
> Premissas confirmadas pelo mantenedor:
> 1. **Projeto separado** — o specs-bot é o **dono** das specs; os agentes não acessam os arquivos, só a abstração.
> 2. **Agentes leem e escrevem** — a escrita é tão central quanto a leitura.
> 3. **Só inglês** — português apenas quando o mantenedor pede tradução.

---

## 0. O que muda em relação ao v1

O v1 acertou a direção (repositório de dados próprio + API como única porta), mas foi escrito sobre um modelo de
dados imaginado e não tratou o isolamento nem quem hoje depende de `specs/`.

| # | v1 | Encontrado nos dados reais | v2 |
|---|---|---|---|
| 1 | `data/` dentro do specs-bot; branch do `data/` espelha a do projeto | Spec é estado global, compartilhado por 3 máquinas; branches de código são por tarefa. Espelhar branches dividiria a verdade. | Repo de dados **`specs-data`**, uma branch (`main`), fora do alcance dos agentes (seção 3). Sem `sync-data-branch.sh`. |
| 2 | Nada sobre impedir acesso direto | É o objetivo principal do projeto separado. | Isolamento em camadas (seção 3). |
| 3 | API orientada a arquivos (`GET /specs/:path`, `view <path>`) | Expor caminhos vaza o formato e permite contornar as regras. | API **orientada a domínio**: step, pendente, assunto, front, documento, seção. Caminho de arquivo nunca aparece na interface. |
| 4 | Specs em `fronts/{id}/`, versão no frontmatter | Real: `<versão>/machine-N/<front>/<grupo>/…md`; só 2 de 597 `.md` têm frontmatter. | Migração preserva a árvore; metadados derivados do caminho. |
| 5 | Regras `CONTEXT → MUST … \| …` + regex | As 956 linhas são prosa em tabela `\| # \| Id \| Rule in force \| Binds \| Cell \|`. | Valida a estrutura da linha, não o texto. |
| 6 | Pendentes `Q1`, `Q2` | Ids `810-d`, `b162-place-repeat`; blocos `#### <id> · <título>` sob `##`. | Parser por bloco. |
| 7 | `cancel` apaga | Número nunca reutilizado; superada vira `Overtaken by N`; milestone fechado é congelado. | `supersede`, `withdraw`, `close`; nada é apagado. |
| 8 | Bilíngue sincronizado | EN é a fonte. | Só EN; `translate` sob pedido. |
| 9 | Conversas inventadas | `conversation-chat/<machine-N\|all>/<YYYYMMDD-HHMM>-<slug>-<id>.md`, frontmatter `from/to/purpose/subject/read/in-reply-to`. | Entram no `specs-data` com o modelo real. |
| 10 | "Locking não é necessário" | 3 máquinas + mantenedor escrevem ao mesmo tempo. | Servidor único serializa escritas + versão (ETag) por entidade. |
| 11 | Escrita = decisões | Mais alterados em out/2026: `status.md` (673 commits), pendentes (581+121), front READMEs/tracks (centenas), `decisions-taken.md` (360+78). | A operação de escrita **mais usada é editar seção de documento** (status, README de front); ela é de primeira classe. |
| 12 | Documento duplicado/contraditório | Seções 6–10 em dobro; npm vs bun; Fastify vs Hono. | Uma decisão por item (seção 9). |

---

## 1. Objetivo

O specs-bot é **a única porta** para specs, decisões, formas aposentadas e conversas do botopink:

1. **Ler** sem abrir arquivos de 1000+ linhas: busca, um step, um pendente, uma seção de um documento.
2. **Escrever** por operações de domínio validadas: abrir/responder pendente, superar decisão, editar seção de
   status/README, registrar forma aposentada, mandar mensagem.
3. **Garantir** as regras que hoje são convenção (`AGENTS.md`, `land-check.py`): número livre, ids nunca
   reutilizados, milestones congelados, sem hash de commit nem caminho de scratch no texto, `Steps:`/`Binds:` coerentes.
4. **Exportar** o que o botopink-lang precisa (ledgers por repositório, CI).

---

## 2. Arquitetura

```
                 HTTP + token por máquina
machine-1 ─ CLI ─┐
machine-2 ─ CLI ─┼──────────► specs-bot API ──► core ──► specs-data (git, só o servidor acessa)
machine-3 ─ CLI ─┤                  │
mantenedor ─ site┘                  └──► export ──► ledgers / snapshot para CI
```

**São dois projetos, e só dois:**

| Projeto | O que é | Quem acessa |
|---|---|---|
| `specs-bot` | a **ferramenta**: cria, edita, valida e consulta specs (API + CLI + site) | todos (agentes usam a CLI) |
| `specs-data` | o **repositório** onde as specs ficam guardadas (Markdown + git) | só o processo da API |

O botopink-lang deixa de guardar specs; ele só consome (CLI dos agentes, ledgers exportados).
`core/api/cli/site` abaixo são pacotes internos do `specs-bot`, não projetos separados.

```
specs-bot/                       (projeto 1 — a ferramenta)
├── packages/
│   ├── core/     parsers, writers, índice, regras, git      (biblioteca)
│   ├── api/      Hono — único processo que abre specs-data
│   ├── cli/      `specs-bot` — cliente HTTP fino, saída toon/json/text
│   └── site/     UI do mantenedor (fase 5)
└── deploy/       unit systemd / compose do servidor

specs-data/                      (projeto 2 — o repositório das specs, histórico migrado)
├── specs/                       a árvore atual, sem reorganizar
└── conversation-chat/
```

- **Uma máquina é o host** (decisão do mantenedor): ela roda a API e guarda o `specs-data`. As outras máquinas
  falam com ela por HTTP na rede privada (LAN ou Tailscale), configuração no `.env` do repositório `projects` (seção 2.1).
  Se o host também roda agentes, eles usam a CLI como qualquer outra máquina; a camada 2 da seção 3 (usuário do
  SO separado) é o que os impede de abrir os arquivos ali. Escritas são serializadas no processo
  (uma fila), então não há corrida entre máquinas.
- **A CLI não tem lógica de domínio**: monta a requisição, lê `@arquivo`, formata a saída. Tudo é validado no servidor.
- **Formato de armazenamento é detalhe interno**: começa como o Markdown atual (preserva histórico e diffs legíveis);
  como os agentes só veem a API, dá para mudar depois sem mexer neles.

### 2.1 Configuração do cliente — `.env` no `projects`

A CLI procura, do diretório atual para cima, o `.env` na raiz do `botopink/projects` (funciona também dentro de
`.tasks/<tarefa>/`, que fica sob a raiz). Nada de configuração global por usuário.

```dotenv
# projects/.env — versionado, igual em todas as máquinas
SPECS_BOT_API_URL=http://192.168.1.15:7165/api
SPECS_BOT_TIMEOUT_MS=10000
```

```dotenv
# projects/.env.local — no .gitignore, um por máquina
SPECS_BOT_TOKEN=<token desta máquina>
```

- `.env.local` sobrescreve `.env`; variável de ambiente do processo sobrescreve os dois.
- A máquina é identificada pelo token, não por uma variável. Assim uma máquina não consegue se passar por outra.
- Se faltar `SPECS_BOT_API_URL`, a CLI falha dizendo qual arquivo esperava. Se faltar o token, a leitura funciona e a escrita é recusada.
- O servidor tem a própria configuração no host (`specs-bot/.env`: porta, caminho do `specs-data`, tokens válidos), fora do `projects`.

---

## 3. Isolamento — como impedir o acesso direto

| Camada | Mecanismo | Impede |
|---|---|---|
| 1. Não estar lá | `specs-data` não existe em nenhum checkout das máquinas; `specs/` sai do botopink-lang. | Ler/editar por engano ou por hábito. |
| 2. Dono do SO | No servidor, `specs-data` pertence ao usuário `specs-bot` (dir `0700`); a API roda como esse usuário (systemd). Se o servidor for também uma máquina de agente, o agente roda como outro usuário. | `cat`, `python`, `git` do agente no mesmo host. |
| 3. Permissões do Claude Code | `deny` em `.claude/settings.json` do botopink-lang para Read/Edit/Write no caminho de dados e Bash `git -C *specs-data*`; `allow` para `specs-bot *`. | Defesa extra; sozinha é contornável. |
| 4. Token por máquina | Cada máquina tem um token (`SPECS_BOT_TOKEN` no `.env.local` do `projects`, fora do git); o servidor sabe quem escreve e preenche o "by" (`machine-1`, `the coordinator †`, `the maintainer`). | Escrita anônima; permite regras por papel (ex.: só o mantenedor marca `review`). |
| 5. Git do `specs-data` | Repos públicos na org (decisão do mantenedor, 2026-10-25): `botopink/specs-bot` e `botopink/specs-data`. Push só do host, com deploy key de escrita; ruleset na `main` bloqueando push de qualquer outro ator (os agentes usam o `gh` da conta do mantenedor, que tem escrita). | Commit manual nos dados. **Não impede leitura**: sendo público, um agente lê as specs pelo GitHub; a leitura direta passa a ser barrada só por regra (`AGENTS.md`, `deny` no Claude Code), não por acesso. |

O site e o mantenedor também passam pela API. Em emergência, o mantenedor edita `specs-data` direto no servidor e
roda `specs-bot admin reindex`; o `check` aponta o que ficou inconsistente.

---

## 4. Modelo de domínio

```ts
interface Doc {            // qualquer .md de milestone: README, status, track, deep dive
  ref: string;             // "1.0.12-beta/m1/150-rakun/04-rakun/track"  (id estável, não caminho)
  version: string; frozen: boolean;
  machine?: 'machine-1' | 'machine-2' | 'machine-3';
  front?: { num: number; slug: string }; group?: string;
  kind: 'readme' | 'overview' | 'status' | 'fronts' | 'track' | 'closure' | 'other';
  title: string;
  sections: { anchor: string; level: number; heading: string; etag: string }[];
  refs: { steps: number[]; questions: string[]; fronts: number[]; docs: string[] };
}

interface StepRow {        // decisions-taken-steps.md
  num: number; answers?: string; by?: string; date?: string;
  process: boolean; fable: boolean;           // (process) / †
  rule: string; binds: string; cell?: string; section: string;
  status: 'in-force' | 'overtaken' | 'replaced' | 'reversed'; supersededBy?: number;
}

interface PendingQuestion { id: string; title: string; section: string; body: string; etag: string; }
interface ReviewItem { step: number; answered: string; summary: string; reviewed: boolean; }
interface Subject { slug: string; summary: string; paragraphs: string[]; steps: number[]; binds: string; }
interface RetiredRow { area: string; retired: string; replacedBy: string; decisions: string; note: string; }
interface ChatMessage { id: string; from: string; to: string; purpose: string; subject: string;
                        read: boolean; inReplyTo?: string; at: string; body: string; }
```

**Regra de ouro**: `serialize(parse(arquivo)) === arquivo` byte a byte para todos os arquivos migrados; writers
alteram o mínimo e reemitem o resto intacto.

---

## 5. Operações (CLI → API)

Escritas: **dry-run por padrão** (devolve o diff), `--apply` grava. Toda escrita leva o `etag` que o agente leu
(a CLI guarda o último lido); se a entidade mudou, o servidor responde 409 com a versão atual.

### 5.1 Leitura

| CLI | O que devolve |
|---|---|
| `search <q> [--version --front --machine --kind --type]` | top N: ref#âncora + trecho |
| `step <n>` | linha inteira, quem a supera, assuntos que a citam |
| `pending [id] [--section]` | lista ou bloco inteiro |
| `review [--open]` | tabela "To review" |
| `subject [slug]` | assuntos de `decisions-taken.md` |
| `front <num>` | resumo: docs, grupos, pendentes e steps que a citam |
| `doc <ref> [--section <âncora>] [--outline]` | documento, uma seção, ou só o sumário |
| `status [--front]` | o status do milestone (seções relevantes) |
| `retired [q]` | formas aposentadas |
| `chat [--to me --unread]` / `chat <id>` | mensagens |
| `links <ref\|step>` · `next` · `history <ref\|step\|id>` | referências · número livre · histórico |

### 5.2 Escrita

| CLI | Efeito |
|---|---|
| `doc edit <ref> --section <âncora> --text @f` | substitui uma seção (o caso mais comum: status, README de front) |
| `doc append <ref> --section <âncora> --text @f` · `doc add-section <ref> --after <âncora> --heading … --text @f` | acrescenta |
| `doc new <ref> --title … --text @f` | novo deep dive numa front |
| `status set <item> --state done\|analysis\|pending\|open [--note]` | item do checklist de `status.md` (se a estrutura permitir; senão `doc edit`) |
| `pending add --id --section --title --text @f` · `pending edit <id>` · `pending withdraw <id> --reason` | pendentes |
| `answer <id> --rule @f --binds "…" [--cell --process] [--subject <slug> --text @f]` | nova linha `N` em `steps`, remove o pendente, atualiza número livre, opcionalmente o parágrafo do assunto + `Steps:`/`Binds:`; o "by" vem do token (`†` para fable) |
| `supersede <n> --by <m> --kind overtaken\|replaced\|reversed` | marca a linha |
| `review <n>` | `[x]` em "To review" (só mantenedor) |
| `retired add --area --retired --replaced-by --decisions [--note]` | linha na tabela |
| `chat send --to --purpose --subject --text @f [--in-reply-to]` · `chat read <id>` | conversas |
| `translate [--apply]` | só sob pedido: atualiza `decisoes-pendentes.md` a partir do que mudou no EN |
| `front new` · `front close <num> --reason` · `milestone freeze <v>` | estrutura (mantenedor) |

### 5.3 Ligação com o código

Hoje um commit "landed" junta spec e código no mesmo repo. Separados, a ligação vira metadado:

- Toda escrita aceita `--landed <repo>@<sha>` (repetível). Vai **na mensagem do commit** do `specs-data`, nunca no
  texto (o `land-check.py` proíbe hash de commit em `specs/`).
- `history` e o site mostram esses vínculos; `specs-bot landed <repo>@<sha>` lista o que aquele commit fechou.

### 5.4 Commits no `specs-data`

Um commit por operação, autor = máquina do token, mensagem no estilo atual
(`spec(1.0.12-beta): question 956-a`, `spec: row 957 answers 956-a`), trailers `Landed:`/`Op:`. Push assíncrono para o remoto.

### 5.5 Regras validadas no servidor (antes de gravar)

Número livre consistente; número de linha sequencial; id pendente único e nunca usado; milestone congelado não muda;
sem hash de commit nem caminho de scratch (regras do `land-check.py`/`scratch-refs.py`); `Steps:` não cita linha
inexistente; link interno resolve; seção alvo existe. Falhou → 422 com o motivo e o que fazer.
`specs-bot check` roda tudo sobre o repo inteiro.

### 5.6 Eventos em tempo real (WebSocket)

As máquinas se comunicam pelo host: toda escrita publica um evento num barramento interno da API, e o WebSocket
o entrega na hora a quem está conectado. Não há conexão máquina a máquina.

- **Endpoint**: `ws://<host>:7165/api/ws`.
  - Token igual ao HTTP: `Authorization: Bearer <token>` ou `?token=` (para navegador).
  - Token desconhecido: fecha com código **4401**.
  - Sem token: ouvinte anônimo, só leitura.
  - Filtro na URL: `?types=write,chat&to=machine-2`.
- **Servidor → cliente** (JSON, um por mensagem):
  - `{"type":"hello","party":…}` ao conectar, sempre a primeira mensagem.
  - `write`: `op, party, commit, refs[], summary, at`. É uma escrita gravada; `refs` usa os nomes da API, nunca caminhos.
  - `chat`: `id, from, to, purpose, subject, at`. Uma mensagem nova; com `to`, chegam as para a máquina e as para `all`.
  - `presence`: `party, online, at`. Uma máquina entrou ou saiu; várias conexões da mesma máquina contam como uma.
- **Cliente → servidor**:
  - `{"type":"subscribe","types":[…],"to":"…"}` troca o filtro e é respondido com `subscribed`.
  - `{"type":"ping"}` é respondido com `pong`.
- **Heartbeat**: ping do protocolo a cada 30 s. Quem não responde até o seguinte é desconectado (4408).
- **`GET /api/presence`**: as máquinas online agora, com `since` e número de conexões.
- **CLI**:
  - `specs-bot watch [--type write,chat,presence] [--to <party> | --all] [--once] [--timeout <s>]`. Por padrão, o
    chat é filtrado para a própria máquina.
  - `--once` termina no primeiro evento (exit 0); é como um agente espera a próxima mensagem para ele.
  - Saídas: `--timeout` estourado → exit 5; token recusado → exit 1; queda com `--once` → exit 3.
  - Sem `--once`, reconecta com espera crescente de 1 s a 30 s.
  - `specs-bot online` lista a presença.

---

## 6. Migração do botopink-lang

1. **Extrair com histórico**: `git filter-repo --path specs/` (e o submódulo `repository/conversation-chat`) para
   o `specs-data`. Os 1634 commits de outubro continuam navegáveis.
2. **Consumidores de `specs/` no botopink-lang** (todos precisam de destino):

   | Consumidor | Destino |
   |---|---|
   | `scripts/decisions-split.py` (gera `repository/<repo>/decisions-taken.md`) | `specs-bot export ledgers <repo>` escreve o ledger no repo de código; o script Python continua sendo quem gera (sobre o export) até valer a pena portar |
   | `scripts/language-gap-markers.sh` e outra lógica em shell | portar para TS ou Python ao mexer nela (nenhuma lógica nova em shell) |
   | `scripts/decision-cells.py` | continua lendo os ledgers gerados (não mexe) |
   | `scripts/land-check.py` / `scratch-refs.py` (checks em `specs/`) | regras viram validação do servidor (5.5); remover a parte de specs |
   | `scripts/language-gap-markers.sh` (lê `specs/<v>/language-gaps.md`) | `specs-bot doc <ref> --raw` |
   | `scripts/gate.sh`, `.github/workflows/hook-integrity.yml` | CI faz checkout read-only do `specs-data` (deploy key) ou usa `export snapshot` |
   | `AGENTS.md` (meta + ~10 `repository/*/AGENTS.md`) citando `specs/…` | trocar por "use `specs-bot`" + refs; manter a tabela de conceitos |
3. **Corte**: remover `specs/` do botopink-lang, deixar `specs/README.md` com uma linha apontando para o specs-bot,
   e um check no `gate.sh` que falha se `specs/` reaparecer.
4. **Ensaio antes do corte**: rodar a API sobre uma cópia, refazer 10 commits reais recentes via CLI e comparar os diffs.

---

## 7. Fases

### Fase 0 — Limpeza e base
- [x] v1 arquivado em `attic/v1/` (PLAN, CLI, compose, Dockerfiles, scripts)
- [x] `git init`; bun workspaces (`core`, `api`, `cli`); Bun 1.3.14 fixado em `mise.toml`; tsconfig strict; `bun test`
- [x] `specs-data` de desenvolvimento em `~/develop/specs-data`: `git filter-repo --path specs/` sobre um clone do `projects`, 2380 commits, branch `main`
- [x] Host = esta máquina, `192.168.1.15:7165`; API Hono com `GET /api/health`; config em `specs-bot/.env` (modelo em `.env.example`)
- [x] Repos públicos `github.com/botopink/specs-bot` e `github.com/botopink/specs-data` (criados com `gh`)
- [x] Serviço systemd de usuário `deploy/specs-bot.service` (`systemctl --user status specs-bot`); vira usuário de SO próprio na fase 4

### Fase 1 — Core: parse + round-trip + índice
- [x] Parsers: steps, pending, review, taken, retired, docs (seções por heading), chat (`conversation-chat` entrou no `specs-data` como subtree, com histórico)
- [x] Round-trip byte a byte em 100% dos arquivos (os 6 de decisão, 591 docs, 118 mensagens)
- [x] Índice MiniSearch por seção (9277 unidades, ~1,2 s no boot, <10 ms por busca); atualização incremental após escrita fica para a fase 3
- [x] `check`: 0 erros e 75 avisos nos dados reais (22 `|` sem escape, 2 assuntos sem lead, 5 links quebrados na 1.0.5, 46 `in-reply-to` com caminho antigo)
- [x] Modelo de leitura único em `core` (`loadModel`), compartilhado pela API e pelo site

### Fase 2 — API + CLI de leitura
- [x] Hono com tokens por máquina (`Authorization: Bearer`, `whoami`); endpoints da 5.1: overview, next, search, steps, pending, review, subjects, retired, fronts, docs (inteiro, `outline`, `section`), chat, check
- [x] CLI `specs-bot` (TS, commander): config do `.env`/`.env.local` do `projects` subindo diretórios; toon/json/text; binário único com `bun build --compile`
- [x] Medido: `step 814` = 1,5 KB contra 1,2 MB do arquivo de steps; TOON 7–40% menor que JSON (mais em listas)
- [x] **Saída**: "o que diz a 814 e quem a supera" = `specs-bot step 814`; "o que bloqueia a máquina 1" = `specs-bot pending --section "machine 1"`
- [x] Binário instalado no host; `.env` no `projects`; a machine-2 compilou o seu

### Fase 3 — Escrita
- [x] Motor: plano de mudança (texto esperado antes/depois), diff LCS, regras do `land-check` (hash de commit, scratch), etags; `Writer` com fila, recusa se o arquivo mudou, gravação atômica, desfaz se o `check` ganhar erro, 1 commit por operação (autor = máquina, trailers `Op`/`Party`/`Landed`)
- [x] Documentos: `edit` (com etag), `append`, `add-section`, `new-doc`
- [x] Decisões: `pending-add/edit/withdraw`, `answer` (próximo número nos dois arquivos, pergunta sai, decisão de máquina vai para "To review", `--subject`), `supersede`, `reviewed` (só o mantenedor), `retire`
- [x] Conversa: `send` (arquivo pela convenção do `conversation-chat`, id por autor), `mark-read`
- [x] API `POST /api/write/<op>` (token obrigatório, dry-run por padrão, troca o modelo da API e do site, publica `write`/`chat` no WebSocket)
- [x] Ensaio sobre clone real: 956-b aberta e respondida como 957, mensagem enviada; `check` sem erro novo; achou 2 bugs (seção ambígua, diff de duas regiões) — corrigidos
- [ ] Atualizar o índice de busca de forma incremental (hoje reconstrói ~1 s depois de cada escrita, em segundo plano)
- [ ] `status.md` do `conversation-chat` (gerado por `scripts/status.sh`) — gerar pelo specs-bot

### Fase 4 — Migração e isolamento
- [x] **Corte feito (2026-10-25)**: `feat` do `projects` em `700099f0` — `specs/` e `repository/conversation-chat` removidos; `specs-data` conferido idêntico byte a byte antes; gate com os 7 checks verdes e CI verde no commit do corte; aviso às máquinas por `specs-bot send` (mt-0057)
- [x] `export ledger` / `export language-gaps` (API + CLI); `decisions-split.py` lê de `$SPECS_ROOT`, `specs/` local ou `specs-bot export` (mesma saída nos três); `language-gap-markers.sh` → `.py` (mesma saída; marcadores dos exemplos de spec contados pelo `check` do specs-bot); `scratch-refs.py` sem `specs/` não faz nada; CI faz checkout do `specs-data`
- [x] `.env` no `projects` com `SPECS_BOT_API_URL`; `.env.local` no `.gitignore`; tokens de maintainer e machine-2
- [x] `AGENTS.md` com § Specs — through specs-bot; `.claude/settings.json` libera `specs-bot`, bloqueia clonar/ler o `specs-data`
- [x] `conversation-chat` arquivado no GitHub (README aponta para o `specs-data`)
- [x] Push do `specs-data` depois de cada escrita (fila em segundo plano, estado no `/api/health`) — hoje com a chave SSH do usuário do host
- [ ] **Deploy key** de escrita só do host + ruleset na `main` do `specs-data` bloqueando os demais — bloqueado: a org `botopink` está com deploy keys desativadas (o mantenedor liga em Settings → Member privileges)
- [ ] **Usuário de SO `specs-bot`** dono do `specs-data`, serviço do sistema (precisa de `sudo` do mantenedor)
- [ ] Rede: TLS se a API sair da LAN
- [ ] Ledgers: o `HEADER` gerado ainda diz "Generated from botopink/projects · specs/…" — trocar exige regenerar os 14 ledgers dos repositórios

### Fase 5 — Site e extras
- [ ] UI do mantenedor: busca, pendentes, review, status, chat, histórico com vínculos `Landed`
- [ ] `translate`
- [ ] Docker só se o servidor precisar

---

## 8. Riscos e perguntas abertas

| Item | Pergunta / risco | Proposta |
|---|---|---|
| Host fora do ar | Desligado, sem rede ou reiniciando: agentes param de ler/escrever spec | A CLI guarda as últimas respostas de leitura e as devolve marcadas `stale` quando o host não responde (é saída da API, não arquivo da spec, então não fura o isolamento); escrita falha com erro claro e o agente tenta de novo depois. Sem cópia dos arquivos nas máquinas. |
| Round-trip | Tabelas com `\|` escapado, linhas enormes | Fase 1 não termina sem 100% |
| `status.md` sem estrutura fixa | `status set` pode não ser mecânico | Começar com `doc edit` por seção; `status set` só se o formato permitir |
| Agentes criativos | Tentam ler os arquivos por outro caminho | Camadas 1 e 2 da seção 3 tornam isso impossível, não só proibido |
| Ledger dos repos | `decisions-split.py` é Python e o CI depende dele | TS ou Python, nunca lógica em shell (decisão do mantenedor, 2026-10-25): na fase 4 o script Python roda sobre o export; portar para TS só se valer a pena, conferindo byte a byte |
