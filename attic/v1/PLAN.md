# Specs Bot — Plano de Implementação

> Aplicação para administrar specs do projeto botopink-lang.  
> Localização: `/home/ericfillipe/develop/specs-bot`  

---

## 1. Visão Geral

O **specs-bot** é uma aplicação dividida em **4 componentes independentes**:

| Componente | Descrição | Tecnologia |
|---|---|---|
| **data** | Repositório git com os dados (specs, decisões, fronts) | Git + Markdown |
| **api** | API REST com toda a lógica de negócio | Bun + Hono/Elysia |
| **site** | Interface web para navegar e visualizar | Bun + Next.js 15 |
| **cli** | Cliente HTTP do terminal para o Claude | Bun + Commander.js |

**Fluxo de dados:**
```
CLI (terminal) ──HTTP──► API ──► data/ (git repo)
                              ▲
Site (web UI) ──HTTP─────────┘
```

---

## 2. Estrutura do Projeto

```
specs-bot/
├── PLAN.md                    # este arquivo
├── README.md                  # documentação geral
│
├── data/                      # REPOSITÓRIO GIT PRÓPRIO
│   ├── .git/                  # git interno
│   ├── decisions-pending.md
│   ├── decisions-taken.md
│   ├── decisions-taken-steps.md
│   ├── decisoes-pendentes.md
│   ├── retired.md
│   ├── conversations/         # histórico de conversas
│   │   ├── README.md          # documentação do sistema de conversas
│   │   ├── status.md          # status geral das conversas
│   │   ├── TEMPLATE.md        # template para novas conversas
│   │   └── *.md               # conversas (machine no frontmatter)
│   └── fronts/                # specs organizados por front
│       ├── 165-rakun-workspace/
│       │   ├── README.md
│       │   ├── context.md
│       │   ├── track.md
│       │   └── examples/
│       │       └── *.bp
│       ├── 150-rakun/
│       │   ├── README.md
│       │   ├── 04-rakun/
│       │   │   ├── modules.md
│       │   │   └── track.md
│       │   └── ...
│       └── ...
│
├── api/                       # API REST (backend)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # entry point (servidor HTTP)
│       ├── routes/
│       │   ├── search.ts      # GET /api/search
│       │   ├── specs.ts       # GET /api/specs, GET /api/specs/:path
│       │   ├── decisions.ts   # GET /api/decisions, GET /api/decisions/:id
│       │   ├── fronts.ts      # GET /api/fronts, GET /api/fronts/:id
│       │   ├── register.ts    # POST /api/register/*
│       │   ├── update.ts      # PATCH /api/update/*
│       │   ├── cancel.ts      # DELETE /api/cancel/*
│       │   ├── history.ts     # GET /api/history
│       │   ├── stats.ts       # GET /api/stats
│       │   └── links.ts       # GET /api/links/:path
│       ├── services/
│       │   ├── parser/
│       │   │   ├── markdown.ts      # parser de MD → AST estruturado
│       │   │   ├── decisions.ts     # parser específico de decisões
│       │   │   ├── fronts.ts        # parser de fronts/milestones
│       │   │   ├── specs.ts         # parser de specs
│       │   │   └── conversations.ts # parser de conversas
│       │   ├── indexer/
│       │   │   ├── scanner.ts       # scan recursivo data/**/*.md
│       │   │   ├── metadata.ts      # extrai metadados
│       │   │   └── search-index.ts  # índice de busca full-text (MiniSearch)
│       │   ├── git.ts               # operações git (commits, history)
│       │   └── validator.ts         # validações de campos e formatos
│       ├── models/
│       │   ├── spec.ts              # tipos: Spec, Decision, Front, Milestone
│       │   ├── decision.ts          # tipos: PendingDecision, TakenDecision
│       │   └── milestone.ts         # tipos: Milestone, Machine, Front
│       └── utils/
│           ├── links.ts             # resolve links entre specs
│           └── slug.ts              # geração de slugs/IDs
│
├── site/                      # Web UI (frontend)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx               # home: busca + visão geral
│       ├── specs/
│       │   ├── page.tsx           # lista de specs
│       │   └── [...path]/
│       │       └── page.tsx       # spec individual
│       ├── decisions/
│       │   ├── page.tsx           # dashboard de decisões
│       │   ├── pending/
│       │   │   └── page.tsx       # decisões pendentes
│       │   ├── taken/
│       │   │   ├── page.tsx       # decisões tomadas
│       │   │   └── [id]/
│       │   │       └── page.tsx   # decisão individual
│       │   └── retired/
│       │       └── page.tsx       # formas aposentadas
│       ├── search/
│       │   └── page.tsx           # resultados de busca
│       └── history/
│           └── page.tsx           # histórico de operações
│
└── cli/                       # CLI (cliente HTTP)
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts               # entry point (bin: specs-bot)
        ├── commands/
        │   ├── search.ts          # specs-bot search <query>
        │   ├── view.ts            # specs-bot view <path>
        │   ├── list.ts            # specs-bot list [--front] [--version]
        │   ├── register.ts        # specs-bot register decision|front|spec
        │   ├── update.ts          # specs-bot update decision|front|spec
        │   ├── cancel.ts          # specs-bot cancel decision|front|spec
        │   ├── history.ts         # specs-bot history [entity] [id]
        │   ├── stats.ts           # specs-bot stats
        │   └── links.ts           # specs-bot links <spec>
        ├── output/
        │   ├── toon.ts            # output TOON (padrão, para LLM)
        │   ├── text.ts            # output texto (para humanos)
        │   └── json.ts            # output JSON (para parsing)
        └── client.ts              # cliente HTTP para API
```

---

## 6. Fases de Implementação

### Fase 1 — Fundação (core)
- [ ] Setup monorepo (package.json, workspaces, tsconfig)
- [ ] Criar estrutura de pastas `data/fronts/{front-id}/`
- [ ] Migrar specs de `botopink-lang/specs/` para `data/fronts/` (reorganizar por front)
- [ ] Implementar parsers de markdown (decisions, specs)
- [ ] Implementar modelos de dados (types)
- [ ] Implementar scanner/indexer (lê estrutura por front)
- [ ] Implementar busca full-text (MiniSearch)
- [ ] Testes unitários dos parsers

### Fase 2 — CLI
- [ ] Setup do pacote CLI (Commander.js ou yargs)
- [ ] Comando `search`
- [ ] Comando `view`
- [ ] Comando `list`
- [ ] Comando `decisions`
- [ ] Comando `register decision`
- [ ] Comando `register decision-answer`
- [ ] Comando `register front`
- [ ] Comando `register spec`
- [ ] Comando `register retired`
- [ ] Comando `update decision`
- [ ] Comando `update front`
- [ ] Comando `update spec`
- [ ] Comando `update retired`
- [ ] Comando `cancel decision`
- [ ] Comando `cancel front`
- [ ] Comando `cancel spec`
- [ ] Comando `cancel retired`
- [ ] Comando `history` (geral e por entidade)
- [ ] Comando `stats`
- [ ] Comando `links`
- [ ] Output TOON (padrão), text e json
- [ ] Integração com git (commits automáticos)

### Fase 3 — Web
- [ ] Setup Next.js 15 com Tailwind
- [ ] Layout principal com navegação
- [ ] Página home com busca
- [ ] Páginas de specs (lista, overview, individual)
- [ ] Páginas de decisões (pending, taken, retired)
- [ ] Página de busca com resultados
- [ ] Renderização de markdown com syntax highlighting
- [ ] Dark/light mode

### Fase 4 — Integração e Polimento
- [ ] API routes para busca e listagem
- [ ] Cache do índice de busca
- [ ] Watch mode no indexer (detectar mudanças nos MD)
- [ ] README com instruções de uso
- [ ] Script de build/deploy

---

## 7. Decisões Técnicas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Monorepo | npm workspaces + Turborepo | Simplicidade, sem dependência extra |
| Parser MD | gray-matter + remark | Padrão da comunidade, AST rico |
| Busca | MiniSearch | Leve, sem deps externas, fuzzy built-in |
| Output CLI | TOON (@toon-format/toon) | ~40% menos tokens que JSON, ideal para LLMs |
| CLI | Commander.js | Leve, popular, TypeScript-friendly |
| CSS | Tailwind | Rápido, consistente, utility-first |
| Render MD | react-markdown + remark-gfm | Suporta GFM (tabelas), plugins |
| Syntax highlight | shiki | Mesma engine do VS Code, suporta `.bp` |
| Build | Turborepo | Cache incremental, pipeline claro |

---

## 8. Comandos de Desenvolvimento

```bash
# Install
bun install

# Dev (web)
bun run dev --workspace=packages/web

# Dev (cli)
bun run dev --workspace=packages/cli -- search "module"

# Build
bun run build

# Test
bun run test

# Lint
bun run lint
```

---

## 9. Notas Importantes

1. **Estrutura de pastas simplificada**: `data/fronts/{front-id}/{group-steps}.md` — cada front é uma pasta em `data/fronts/`, a versão é uma tag no metadata do arquivo.
2. **Os dados vivem em `data/`**: diretório próprio do projeto specs-bot, não é symlink. Os specs podem ser movidos/copiados de outras fontes para cá.
3. **O CLI é a interface primária do Claude**: output em TOON por padrão (~40% menos tokens que JSON), otimizado para leitura por LLM.
4. **Decisões são o coração**: o sistema de decisões (pending → taken → retired) é o fluxo principal.
5. **Bilíngue**: decisions-pending.md (EN) e decisoes-pendentes.md (PT) são mantidos em sincronia pelo `register`.
6. **Próximo número livre**: o CLI lê `decisions-taken-steps.md` para determinar o próximo número (atualmente 957).

---

## 10. Versionamento de Dados (data/)

A pasta `data/` é um **repositório git próprio** com commits automáticos gerenciados pelo CLI/ API. A branch do `data/` sempre segue a branch do projeto principal `specs-bot`.

### 10.1 Arquitetura

```
specs-bot/
├── data/                      # REPO GIT PRÓPRIO (branch = branch do projeto)
│   ├── .git/                  # git interno
│   ├── decisions-pending.md
│   ├── decisions-taken.md
│   ├── decisions-taken-steps.md
│   ├── decisoes-pendentes.md
│   ├── retired.md
│   ├── conversations/         # histórico de conversas
│   │   ├── README.md
│   │   ├── status.md
│   │   ├── TEMPLATE.md
│   │   └── *.md               # conversas (machine no frontmatter)
│   └── fronts/
│       └── ...
├── scripts/
│   ├── setup.sh               # setup inicial do ambiente
│   ├── sync-data-branch.sh    # sincroniza branch do data/ com projeto
│   └── data-git.sh            # git push/pull/status/checkout para data/
├── api/
├── site/
├── cli/
└── PLAN.md
```

### 10.2 Sincronização de Branches

O `data/` sempre usa a **mesma branch** do projeto principal `specs-bot`. Isso garante que:

- Dados de desenvolvimento ficam isolados em `develop`
- Dados de produção ficam em `main`
- Features específicas têm seus próprios dados em feature branches
- Rollback de dados é simples via `git checkout`

**Fluxo:**
```bash
# Projeto principal está em develop
$ git branch
* develop

# data/ também está em develop
$ cd data && git branch
* develop

# Trocar para feature branch
$ git checkout feature/new-spec
$ ./scripts/sync-data-branch.sh
# data/ agora também está em feature/new-spec
```

### 10.3 Scripts Disponíveis

#### setup.sh
Configura o ambiente inicial:
```bash
./scripts/setup.sh
```
- Cria diretório `data/` se não existir
- Inicializa git em `data/` se necessário
- Sincroniza branch do `data/` com projeto principal
- Builda e inicia containers Docker

#### sync-data-branch.sh
Sincroniza a branch do `data/` com a branch do projeto:
```bash
# Sincroniza com branch atual do projeto
./scripts/sync-data-branch.sh

# Sincroniza com branch específica
./scripts/sync-data-branch.sh feature/new-spec
```

#### data-git.sh
Gerencia git no `data/`:
```bash
# Ver status do git em data/
./scripts/data-git.sh status

# Trocar branch do data/
./scripts/data-git.sh checkout develop

# Push data/ para remote
./scripts/data-git.sh push

# Pull data/ do remote
./scripts/data-git.sh pull
```

### 10.4 Docker Compose

O projeto usa Docker Compose para orquestrar os serviços:

```bash
# Iniciar todos os serviços
docker compose up -d

# Ver logs
docker compose logs -f

# Parar serviços
docker compose down

# Usar CLI
docker compose run --rm cli search "module"
docker compose run --rm cli register decision --id Q1 ...
```

**Serviços:**
- **api**: Backend na porta 4000 (Bun + Hono/Elysia)
- **site**: Frontend na porta 3000 (Next.js)
- **cli**: Cliente HTTP (execução sob demanda via `docker compose run`)

**Volumes:**
- `./data:/data` - Dados montados como volume read-write

### 10.5 Commits Automáticos

A API executa **git commit automático** após cada operação de escrita:

| Operação | Arquivos Afetados | Mensagem de Commit |
|---|---|---|
| `register decision` | decisions-pending.md, decisoes-pendentes.md | `register: add pending decision {id}` |
| `register decision-answer` | decisions-taken-steps.md, decisions-taken.md, decisions-pending.md, decisoes-pendentes.md | `register: answer decision {pending-id} as step {stepId}` |
| `register front` | fronts/{id}/README.md | `register: add front {id}` |
| `register spec` | fronts/{front-id}/{spec}.md | `register: add spec {title} to front {front-id}` |
| `register retired` | retired.md | `register: add retired form "{retired}"` |
| `update decision` | decisions-pending.md ou decisions-taken.md + steps | `update: decision {id} ({changedFields})` |
| `update front` | fronts/{id}/README.md | `update: front {id} ({changedFields})` |
| `update spec` | fronts/{front-id}/{spec}.md | `update: spec {path} ({changedFields})` |
| `update retired` | retired.md | `update: retired form "{retired}" ({changedFields})` |
| `cancel decision` | decisions-pending.md ou decisions-taken.md + steps, retired.md | `cancel: decision {id} - {reason}` |
| `cancel front` | fronts/{id}/ (remove) | `cancel: front {id} - {reason}` |
| `cancel spec` | fronts/{front-id}/{spec}.md (remove) | `cancel: spec {path} - {reason}` |
| `cancel retired` | retired.md | `cancel: retired form "{retired}" - {reason}` |
| `register conversation` | conversations/{id}.md, status.md | `register: add conversation {id} (machine: {machine})` |
| `update conversation` | conversations/{id}.md | `update: conversation {id} ({changedFields})` |
| `cancel conversation` | conversations/{id}.md, status.md | `cancel: conversation {id} - {reason}` |

### 10.3 Output com Hash do Commit

Todas as operações de escrita retornam o hash do commit no output TOON:

```bash
specs-bot register decision --id Q1 --title "..." --section "Machine 1"
```

**Output:**
```
registered{
  type: "decision"
  id: "Q1"
  status: "pending"
  commit{
    hash: "a1b2c3d"
    message: "register: add pending decision Q1"
    timestamp: "2026-01-15T10:30:45Z"
  }
  files[2]: "decisions-pending.md","decisoes-pendentes.md"
}
```

### 10.4 Rollback e Histórico

```bash
# Ver histórico de mudanças
git log --oneline --all

# Reverter para commit anterior
git revert a1b2c3d

# Ver diff de uma operação
git show a1b2c3d

# Ver histórico de um arquivo
git log --oneline decisions-pending.md
```

### 10.5 Configuração Git

O `data/.git/config` deve ter:

```ini
[user]
  name = "Specs Bot CLI"
  email = "specs-bot@localhost"

[commit]
  gpgsign = false

[core]
  autocrlf = input
```

### 10.6 Vantagens

1. **Audit trail completo**: cada mudança é rastreável
2. **Rollback fácil**: `git revert` para desfazer operações
3. **Histórico granular**: uma operação = um commit
4. **LLM-friendly**: não precisa gerenciar git manualmente
5. **Mensagens padronizadas**: formato consistente para debugging
6. **Isolamento**: dados separados do código da aplicação
7. **Backup**: git push para remoto opcional
8. **Comando history**: interface amigável para consultar histórico sem usar git diretamente

### 10.7 Considerações

- **Performance**: commits são rápidos (<100ms para arquivos pequenos)
- **Conflitos**: CLI opera em arquivos específicos, minimizando conflitos
- **Locking**: não necessário (operações são atômicas via git)
- **Backup**: opcional push para remoto (GitHub, GitLab, etc.)
- **Cleanup**: git gc periódico para manter performance

---

---

## 3. API (Backend)

A API é o **coração do sistema**. Contém toda a lógica de negócio: parsers, busca, validações, commits git.

### 3.1 Endpoints

**Base URL:** `http://localhost:4000/api`

#### Busca e Visualização

```
GET  /api/search?q=<query>&front=<id>&type=<type>&version=<v>
GET  /api/specs?front=<id>&version=<v>&group=<g>
GET  /api/specs/:path                    # path = fronts/165-rakun/README.md
GET  /api/decisions?status=pending|taken|retired&topic=<t>
GET  /api/decisions/:id
GET  /api/decisions/pending/:id
GET  /api/fronts
GET  /api/fronts/:id
GET  /api/stats
GET  /api/links/:path
GET  /api/history?entity=<e>&id=<id>&operation=<op>&since=<d>&until=<d>&limit=<n>
GET  /api/history/:entity/:id?diff=true
GET  /api/conversations?machine=<m>&status=<s>
GET  /api/conversations/:id
GET  /api/conversations/status
```

#### Escrita (Register/Update/Cancel)

```
POST   /api/register/decision
POST   /api/register/decision-answer
POST   /api/register/front
POST   /api/register/spec
POST   /api/register/retired

PATCH  /api/update/decision/:id
PATCH  /api/update/front/:id
PATCH  /api/update/spec/:path
PATCH  /api/update/retired/:id

POST   /api/register/conversation
PATCH  /api/update/conversation/:id

DELETE /api/cancel/decision/:id
DELETE /api/cancel/front/:id
DELETE /api/cancel/spec/:path
DELETE /api/cancel/retired/:id
DELETE /api/cancel/conversation/:id
```

### 3.2 Parser de Markdown

Cada tipo de arquivo tem um parser específico:

| Arquivo | Parser | Saída |
|---|---|---|
| `decisions-pending.md` | `decisions.parsePending()` | `PendingDecision[]` (seções, tabelas, entradas) |
| `decisions-taken.md` | `decisions.parseTaken()` | `TakenDecision[]` (regras por tópico, steps, binds) |
| `decisions-taken-steps.md` | `decisions.parseSteps()` | `DecisionStep[]` (rows numeradas, 1–956+) |
| `decisoes-pendentes.md` | `decisions.parsePendingPt()` | `PendingDecision[]` (versão PT) |
| `retired.md` | `decisions.parseRetired()` | `RetiredForm[]` (tabelas de formas aposentadas) |
| `fronts/{front-id}/**/*.md` | `specs.parseSpec()` | `Spec` (frontId do caminho em data/fronts/, versions do metadata) |
| `conversations/*.md` | `conversations.parseChat()` | `Conversation` (machine, status, timestamp, participants no frontmatter) |
| `conversations/status.md` | `conversations.parseStatus()` | `ChatStatus` (resumo geral de todas as máquinas) |

O parser de specs identifica blocos `<!-- notrans -->` e marca os parágrafos seguintes como não traduzíveis.

### 3.3 Indexer / Busca

- **Scanner**: varre `data/fronts/{front-id}/**/*.md`, extrai metadata de cada arquivo
- **Metadata**: título (primeiro `#`), frontId (nome da pasta), group (subpasta), versions (tag no arquivo), type
- **Índice full-text**: usa **MiniSearch** (leve, portável, sem dependências externas)
  - Indexa: título, headings, conteúdo, decision IDs, front numbers
  - Suporta: busca fuzzy, filtros por front/version/group/type

### 3.4 Modelo de Dados

```typescript
// models/spec.ts
interface Spec {
  id: string;              // slug do caminho
  title: string;           // primeiro heading
  filePath: string;        // caminho relativo em data/fronts/
  frontId: string;         // "165-rakun-workspace" (pasta em data/fronts/)
  versions: string[];      // ["1.0.12-beta", "1.0.11-beta"] (marcação no metadata)
  machine?: string;        // "machine-1" | "machine-2" (metadata)
  group?: string;          // "04-rakun", "05-jhonstart" (subpasta)
  type: 'overview' | 'status' | 'context' | 'track' | 'surface' | 'other';
  sections: Section[];
  references: string[];    // links para outros specs/decisões
  examples: string[];      // arquivos de exemplo referenciados
}
```

**Marcação de tradução por parágrafo**: A tradução é controlada por parágrafo individual, não por arquivo. Parágrafos com código, tabelas técnicas ou exemplos `.bp` são marcados com `<!-- notrans -->` e não são traduzidos. O parser identifica esses blocos e os exclui da tradução.

### 3.5 Modelo de Conversas

```typescript
// models/conversation.ts
interface Conversation {
  id: string;              // slug do arquivo
  machine: 'machine-1' | 'machine-2' | 'machine-3' | 'all';  // frontmatter
  title: string;           // título da conversa
  timestamp: string;       // ISO 8601
  status: 'active' | 'completed' | 'blocked';
  participants: string[];  // participantes da conversa
  summary: string;         // resumo da conversa
  filePath: string;        // caminho relativo em data/conversations/
  sections: Section[];     // seções da conversa
  references: string[];    // links para specs/decisões relacionadas
}

interface ChatStatus {
  totalConversations: number;
  active: number;
  completed: number;
  blocked: number;
  byMachine: {
    'machine-1': number;
    'machine-2': number;
    'machine-3': number;
    'all': number;
  };
  lastUpdated: string;     // ISO 8601
}
```

**Exemplo de frontmatter em uma conversa:**
```markdown
---
machine: machine-1
status: active
participants: [claude, eric]
timestamp: 2026-01-15T10:30:00Z
---

# Conversa sobre Module System

Resumo: Discutimos a implementação do sistema de módulos...
```

### 3.5 Formato de Regras (Steps)

Todas as regras em `decisions-taken-steps.md` devem seguir o formato:

```
[CONTEXT] → [MUST|SHOULD|CAN] [action] | [constraint]
```

**Exemplos:**
```
Module imports → MUST use explicit paths | No wildcard imports
Component props → SHOULD be typed with interfaces | Avoid inline types
Error handling → MUST use Result type | No try/catch blocks
```

**Validação:**
```typescript
const STEP_PATTERN = /^(.+?)\s*→\s*(MUST|SHOULD|CAN|SHALL)\s+(.+?)(?:\s*\|\s*(.+))?$/;
```

### 3.6 Stack Técnica

- **Bun** 20+
- **Fastify** ou **Express** (framework HTTP)
- **TypeScript** strict
- **MiniSearch** para busca full-text
- **simple-git** para operações git
- **gray-matter** + **remark** para parser de markdown
- **Zod** para validação de schemas

---

## 4. Site (Frontend)

Interface web para navegar e visualizar specs, decisões e fronts. Consome a API via HTTP.

### 4.1 Páginas

| Rota | Descrição |
|---|---|
| `/` | Home: barra de busca + resumo (últimas decisões, milestones) |
| `/specs` | Lista todos os specs com filtro por versão/milestone |
| `/specs/[...path]` | Spec individual renderizado (MD → React), versão como filtro |
| `/decisions` | Dashboard de decisões (gráficos, contagens) |
| `/decisions/pending` | Decisões pendentes com filtros por seção |
| `/decisions/taken` | Regras em vigor, navegáveis por tópico |
| `/decisions/taken/[id]` | Decisão individual com binds e contexto |
| `/decisions/retired` | Formas aposentadas em tabela |
| `/search?q=` | Resultados de busca full-text |
| `/history` | Histórico de operações |
| `/conversations` | Lista de conversas com filtro por máquina |
| `/conversations/status` | Status geral das conversas |
| `/conversations/[id]` | Conversa individual |

### 4.2 Funcionalidades

- **Busca full-text** com destaque de termos
- **Navegação por front** → group → spec (estrutura de pastas)
- **Filtro por versão/milestone** (tag no metadata, não pasta)
- **Grafo de referências** entre specs e decisões (links cruzados)
- **Renderização de Markdown** com syntax highlighting para `.bp` examples
- **Tabelas interativas** para decisões pendentes e aposentadas
- **Visualização de histórico** com diff
- **Navegação por conversas** organizadas por máquina
- **Status de conversas** (ativa, completada, bloqueada)
- **Filtros**: por tipo, versão, front, group, machine, status de conversa
- **Dark/light mode**
- **Responsive**

### 4.3 Stack Técnica

- **Next.js 15** (App Router)
- **TypeScript** strict
- **Tailwind CSS** para estilização
- **react-markdown** + **remark-gfm** para renderizar MD
- **shiki** para syntax highlighting de código
- **SWR** ou **React Query** para cache de API

---

## 5. CLI (Cliente HTTP)

O CLI é um **cliente HTTP leve** que consome a API. Não tem lógica de negócio própria — apenas formata o output e gerencia a interação com o terminal.

### 5.1 Arquitetura

```
CLI (terminal) ──HTTP──► API (http://localhost:4000/api) ──► data/ (git repo)
```

**Responsabilidades do CLI:**
- Parsear argumentos da linha de comando
- Fazer requisições HTTP para a API
- Formatar output (TOON/JSON/text)
- Ler arquivos quando usado `@filename`
- Exibir erros de forma amigável

**Responsabilidades da API:**
- Parsers de markdown
- Busca full-text
- Validações de campos
- Commits git
- Lógica de negócio

### 5.2 Configuração

O CLI precisa saber a URL da API:

```bash
# Via variável de ambiente
export SPECS_BOT_API=http://localhost:4000/api

# Ou via flag global
specs-bot --api http://localhost:4000/api search "module"

# Ou via arquivo de config (~/.specs-bot.json)
{
  "api": "http://localhost:4000/api"
}
```

### 5.3 Comandos

O CLI mapeia comandos para endpoints da API:

```bash
# Busca e visualização
specs-bot search "module"          # GET /api/search?q=module
specs-bot view decision 814        # GET /api/decisions/814
specs-bot list --front 165-rakun   # GET /api/specs?front=165-rakun
specs-bot stats                    # GET /api/stats
specs-bot history                  # GET /api/history
specs-bot links <path>             # GET /api/links/<path>

# Registro (POST)
specs-bot register decision ...    # POST /api/register/decision
specs-bot register spec ...        # POST /api/register/spec
specs-bot register front ...       # POST /api/register/front

# Atualização (PATCH)
specs-bot update decision Q1 ...   # PATCH /api/update/decision/Q1
specs-bot update spec <path> ...   # PATCH /api/update/spec/<path>

# Cancelamento (DELETE)
specs-bot cancel decision Q1 ...   # DELETE /api/cancel/decision/Q1
specs-bot cancel front 165 ...     # DELETE /api/cancel/front/165

# Conversas
specs-bot conversations            # GET /api/conversations
specs-bot conversations --machine machine-1  # GET /api/conversations?machine=machine-1
specs-bot conversations --status active      # GET /api/conversations?status=active
specs-bot conversations status     # GET /api/conversations/status
specs-bot conversations view <id>  # GET /api/conversations/:id
specs-bot conversations register --machine machine-1 --title "..." --content @file.md
specs-bot conversations update <id> --status completed
specs-bot conversations cancel <id>
```

### 5.4 Fluxo de Execução

```bash
# Exemplo: specs-bot register decision --id Q1 --title "..." --section "Machine 1"

1. CLI parseia argumentos
2. CLI monta JSON: { id: "Q1", title: "...", section: "Machine 1" }
3. CLI faz POST para http://localhost:4000/api/register/decision
4. API valida campos obrigatórios
5. API escreve nos arquivos MD
6. API faz git commit
7. API retorna: { type: "decision", id: "Q1", commit: { hash: "a1b2c3d", ... } }
8. CLI formata output em TOON
9. CLI exibe no terminal
```

### 5.5 Formato de Output

O CLI usa **TOON (Token-Oriented Object Notation)** como formato padrão de output, otimizado para LLMs com ~40% menos tokens que JSON.

- **`--format toon`** (padrão): formato compacto, estruturado, ideal para leitura por LLM
- **`--format json`**: JSON estruturado para parsing tradicional
- **`--format text`**: texto legível para humanos

**Dependência**: `@toon-format/toon` (TypeScript, MIT)

### 5.6 Entrada de Dados via Arquivo

Flags que aceitam conteúdo longo podem receber valores de duas formas:

**1. Valor inline (curto):**
```bash
specs-bot register spec \
  --front 165-rakun \
  --title "Module System" \
  --type context \
  --content "# Module System\n\nThis is the content..."
```

**2. Via arquivo (longo) usando `@filename`:**
```bash
specs-bot register spec \
  --front 165-rakun \
  --title "Module System" \
  --type context \
  --content @./module-system.md
```

O CLI lê o conteúdo do arquivo e o envia para a API. Campos obrigatórios continuam sendo validados pela API.

**Flags que aceitam `@filename`:**
- `--content` (register spec, update spec)
- `--measured` (register decision, update decision)
- `--options` (register decision, update decision)
- `--rule` (register decision-answer, update decision)
- `--description` (register front, update front)

### 5.7 Tratamento de Erros

O CLI captura erros HTTP e os exibe de forma amigável:

```bash
# Erro 400 (Bad Request)
$ specs-bot register decision --id Q1
✗ Missing required field: --title
  Use --title "..." to provide the decision title

# Erro 404 (Not Found)
$ specs-bot view decision 999
✗ Decision 999 not found
  Use specs-bot list decisions --status taken to see available decisions

# Erro 409 (Conflict)
$ specs-bot register decision --id Q1
✗ Decision ID "Q1" already exists
  Use specs-bot update decision --id Q1 to modify the existing decision

# Erro 500 (Internal Server Error)
$ specs-bot register decision ...
✗ Internal server error
  Check the API logs for details
```

### 5.8 Stack Técnica

- **Bun** 20+
- **Commander.js** para parsear argumentos
- **TypeScript** strict
- **@toon-format/toon** para output TOON
- **node-fetch** ou **axios** para HTTP

---

## 6. Fases de Implementação

### Fase 1 — Data + API Core
- [ ] Inicializar repositório git em `data/`
- [ ] Criar estrutura de pastas `data/fronts/{front-id}/`
- [ ] Migrar specs de `botopink-lang/specs/` para `data/fronts/` (reorganizar por front)
- [ ] Setup API (Bun + Fastify/Express)
- [ ] Implementar parsers de markdown (decisions, specs)
- [ ] Implementar modelos de dados (types)
- [ ] Implementar scanner/indexer (lê estrutura por front)
- [ ] Implementar busca full-text (MiniSearch)
- [ ] Implementar operações git (commits automáticos)
- [ ] Testes unitários dos parsers

### Fase 2 — API Endpoints
- [ ] Endpoint `GET /api/search`
- [ ] Endpoint `GET /api/specs`
- [ ] Endpoint `GET /api/specs/:path`
- [ ] Endpoint `GET /api/decisions`
- [ ] Endpoint `GET /api/decisions/:id`
- [ ] Endpoint `GET /api/fronts`
- [ ] Endpoint `GET /api/stats`
- [ ] Endpoint `GET /api/history`
- [ ] Endpoint `GET /api/links/:path`
- [ ] Endpoints `POST /api/register/*`
- [ ] Endpoints `PATCH /api/update/*`
- [ ] Endpoints `DELETE /api/cancel/*`
- [ ] Validações de campos obrigatórios
- [ ] Validação de formato de regras

### Fase 3 — CLI
- [ ] Setup do pacote CLI (Commander.js)
- [ ] Cliente HTTP para API
- [ ] Comando `search`
- [ ] Comando `view`
- [ ] Comando `list`
- [ ] Comando `register decision|front|spec|retired`
- [ ] Comando `register decision-answer`
- [ ] Comando `update decision|front|spec|retired`
- [ ] Comando `cancel decision|front|spec|retired`
- [ ] Comando `history` (geral e por entidade)
- [ ] Comando `stats`
- [ ] Comando `links`
- [ ] Output TOON (padrão), text e json
- [ ] Suporte a `@filename` para conteúdo longo

### Fase 4 — Site (Frontend)
- [ ] Setup Next.js 15 com Tailwind
- [ ] Layout principal com navegação
- [ ] Página home com busca
- [ ] Páginas de specs (lista, overview, individual)
- [ ] Páginas de decisões (pending, taken, retired)
- [ ] Página de busca com resultados
- [ ] Página de histórico
- [ ] Renderização de markdown com syntax highlighting
- [ ] Dark/light mode
- [ ] Responsive

### Fase 5 — Integração e Polimento
- [ ] Cache do índice de busca
- [ ] Watch mode no indexer (detectar mudanças nos MD)
- [ ] README com instruções de uso
- [ ] Script de build/deploy
- [ ] Documentação da API (OpenAPI/Swagger)

---

## 7. Decisões Técnicas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Arquitetura | 4 componentes separados (data, api, site, cli) | Separação clara de responsabilidades |
| API | Hono ou Elysia | Leve, popular, TypeScript-friendly |
| Parser MD | gray-matter + remark | Padrão da comunidade, AST rico |
| Busca | MiniSearch | Leve, sem deps externas, fuzzy built-in |
| Output CLI | TOON (@toon-format/toon) | ~40% menos tokens que JSON, ideal para LLMs |
| CLI | Commander.js | Leve, popular, TypeScript-friendly |
| CSS | Tailwind | Rápido, consistente, utility-first |
| Render MD | react-markdown + remark-gfm | Suporta GFM (tabelas), plugins |
| Syntax highlight | shiki | Mesma engine do VS Code, suporta `.bp` |
| Git | simple-git | API simples, bem mantida |
| Validação | Zod | Type-safe, boa DX |

---

## 8. Comandos de Desenvolvimento

```bash
# ============================================
# DATA
# ============================================
cd data
git init
git add .
git commit -m "Initial commit"

# ============================================
# API
# ============================================
cd api
bun install
bun run dev          # http://localhost:4000/api

# ============================================
# SITE
# ============================================
cd site
bun install
bun run dev          # http://localhost:3000

# ============================================
# CLI
# ============================================
cd cli
bun install
bun run build
bun link             # torna specs-bot disponível globalmente

# Testar CLI
export SPECS_BOT_API=http://localhost:4000/api
specs-bot search "module"
specs-bot list --front 165-rakun
specs-bot stats
```

---

## 9. Notas Importantes

1. **Arquitetura em 4 partes**: data (git repo), api (backend), site (frontend), cli (terminal)
2. **API é o coração**: toda a lógica de negócio está na API, CLI e site são apenas clientes
3. **Estrutura de pastas simplificada**: `data/fronts/{front-id}/{group-steps}.md` — cada front é uma pasta em `data/fronts/`, a versão é uma tag no metadata do arquivo.
4. **Os dados vivem em `data/`**: diretório próprio do projeto specs-bot, não é symlink. Os specs podem ser movidos/copiados de outras fontes para cá.
5. **O CLI é a interface primária do Claude**: output em TOON por padrão (~40% menos tokens que JSON), otimizado para leitura por LLM.
6. **Decisões são o coração**: o sistema de decisões (pending → taken → retired) é o fluxo principal.
7. **Bilíngue**: decisions-pending.md (EN) e decisoes-pendentes.md (PT) são mantidos em sincronia pelo `register`.
8. **Próximo número livre**: a API lê `decisions-taken-steps.md` para determinar o próximo número (atualmente 957).
9. **Conversas**: histórico de conversas em `data/conversations/`, com máquina definida no frontmatter de cada arquivo.

---

## 10. Versionamento de Dados (data/)

A pasta `data/` é um **repositório git próprio** com commits automáticos gerenciados pela API.

### 10.1 Arquitetura

```
specs-bot/
├── data/                      # REPO GIT PRÓPRIO
│   ├── .git/                  # git interno
│   ├── decisions-pending.md
│   ├── decisions-taken.md
│   ├── decisions-taken-steps.md
│   ├── decisoes-pendentes.md
│   ├── retired.md
│   └── fronts/
│       └── ...
├── api/
├── site/
└── cli/
```

### 10.2 Commits Automáticos

A API executa **git commit automático** após cada operação de escrita:

| Operação | Arquivos Afetados | Mensagem de Commit |
|---|---|---|
| `register decision` | decisions-pending.md, decisoes-pendentes.md | `register: add pending decision {id}` |
| `register decision-answer` | decisions-taken-steps.md, decisions-taken.md, decisions-pending.md, decisoes-pendentes.md | `register: answer decision {pending-id} as step {stepId}` |
| `register front` | fronts/{id}/README.md | `register: add front {id}` |
| `register spec` | fronts/{front-id}/{spec}.md | `register: add spec {title} to front {front-id}` |
| `register retired` | retired.md | `register: add retired form "{retired}"` |
| `update decision` | decisions-pending.md ou decisions-taken.md + steps | `update: decision {id} ({changedFields})` |
| `update front` | fronts/{id}/README.md | `update: front {id} ({changedFields})` |
| `update spec` | fronts/{front-id}/{spec}.md | `update: spec {path} ({changedFields})` |
| `update retired` | retired.md | `update: retired form "{retired}" ({changedFields})` |
| `cancel decision` | decisions-pending.md ou decisions-taken.md + steps, retired.md | `cancel: decision {id} - {reason}` |
| `cancel front` | fronts/{id}/ (remove) | `cancel: front {id} - {reason}` |
| `cancel spec` | fronts/{front-id}/{spec}.md (remove) | `cancel: spec {path} - {reason}` |
| `cancel retired` | retired.md | `cancel: retired form "{retired}" - {reason}` |
| `register conversation` | conversations/{id}.md, status.md | `register: add conversation {id} (machine: {machine})` |
| `update conversation` | conversations/{id}.md | `update: conversation {id} ({changedFields})` |
| `cancel conversation` | conversations/{id}.md, status.md | `cancel: conversation {id} - {reason}` |

### 10.3 Output com Hash do Commit

Todas as operações de escrita retornam o hash do commit no output:

```json
{
  "type": "decision",
  "id": "Q1",
  "status": "pending",
  "commit": {
    "hash": "a1b2c3d",
    "message": "register: add pending decision Q1",
    "timestamp": "2026-01-15T10:30:45Z"
  },
  "files": ["decisions-pending.md", "decisoes-pendentes.md"]
}
```

### 10.4 Rollback e Histórico

```bash
# Ver histórico de mudanças
cd data && git log --oneline --all

# Reverter para commit anterior
cd data && git revert a1b2c3d

# Ver diff de uma operação
cd data && git show a1b2c3d

# Ver histórico de um arquivo
cd data && git log --oneline decisions-pending.md
```

### 10.5 Configuração Git

O `data/.git/config` deve ter:

```ini
[user]
  name = "Specs Bot API"
  email = "specs-bot@localhost"

[commit]
  gpgsign = false

[core]
  autocrlf = input
```

### 10.6 Vantagens

1. **Audit trail completo**: cada mudança é rastreável
2. **Rollback fácil**: `git revert` para desfazer operações
3. **Histórico granular**: uma operação = um commit
4. **Mensagens padronizadas**: formato consistente para debugging
5. **Isolamento**: dados separados do código da aplicação
6. **Backup**: git push para remoto opcional
7. **Comando history**: interface amigável para consultar histórico sem usar git diretamente

### 10.7 Considerações

- **Performance**: commits são rápidos (<100ms para arquivos pequenos)
- **Conflitos**: API opera em arquivos específicos, minimizando conflitos
- **Locking**: não necessário (operações são atômicas via git)
- **Backup**: opcional push para remoto (GitHub, GitLab, etc.)
- **Cleanup**: git gc periódico para manter performance
