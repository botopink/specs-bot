# Specs Bot CLI - Documentação Completa

> Interface de linha de comando para administrar specs do projeto botopink-lang.  
> Otimizada para uso por LLMs (output TOON por padrão).

---

## Índice

- [Instalação](#instalação)
- [Comandos de Busca e Visualização](#comandos-de-busca-e-visualização)
  - [search](#search)
  - [view](#view)
  - [list](#list)
  - [stats](#stats)
  - [links](#links)
  - [history](#history)
  - [conversations](#conversations)
- [Comandos de Registro](#comandos-de-registro)
  - [register decision](#register-decision)
  - [register decision-answer](#register-decision-answer)
  - [register front](#register-front)
  - [register spec](#register-spec)
  - [register retired](#register-retired)
  - [register conversation](#register-conversation)
- [Comandos de Atualização](#comandos-de-atualização)
  - [update decision](#update-decision)
  - [update front](#update-front)
  - [update spec](#update-spec)
  - [update retired](#update-retired)
  - [update conversation](#update-conversation)
- [Comandos de Cancelamento](#comandos-de-cancelamento)
  - [cancel decision](#cancel-decision)
  - [cancel front](#cancel-front)
  - [cancel spec](#cancel-spec)
  - [cancel retired](#cancel-retired)
  - [cancel conversation](#cancel-conversation)
- [Formato de Output](#formato-de-output)
- [Formato de Regras (Steps)](#formato-de-regras-steps)
- [Validações e Erros](#validações-e-erros)
- [Exemplos Práticos](#exemplos-práticos)

---

## Entrada de Dados via Arquivo

Flags que aceitam conteúdo longo podem receber valores de duas formas:

### 1. Valor inline (curto)

```bash
specs-bot register spec \
  --front 165-rakun \
  --title "Module System" \
  --type context \
  --content "# Module System\n\nThis is the content..."
```

### 2. Via arquivo (longo) usando `@filename`

```bash
specs-bot register spec \
  --front 165-rakun \
  --title "Module System" \
  --type context \
  --content @./module-system.md
```

O CLI lê o conteúdo do arquivo e o usa como valor da flag.

**Flags que aceitam `@filename`:**
- `--content` (register spec, update spec)
- `--measured` (register decision, update decision)
- `--options` (register decision, update decision)
- `--rule` (register decision-answer, update decision)
- `--description` (register front, update front)

**Regras:**
- Prefixo `@` indica que o valor é um caminho de arquivo
- Arquivo deve existir e ser legível
- Conteúdo é lido como UTF-8
- Campos obrigatórios são validados antes de ler arquivos
- Erros de arquivo geram mensagens claras

**Exemplos:**

```bash
# Registrar spec com conteúdo de arquivo
specs-bot register spec \
  --front 165-rakun-workspace \
  --title "Track" \
  --type track \
  --group 04-rakun \
  --content @./track-content.md

# Registrar decisão com observação longa
specs-bot register decision \
  --id Q10 \
  --title "How to handle imports?" \
  --section "Blocking now" \
  --measured @./observation.md \
  --options @./options.md

# Atualizar spec com novo conteúdo
specs-bot update spec \
  --path fronts/165-rakun/README.md \
  --content @./updated-readme.md

# Registrar resposta com regra complexa
specs-bot register decision-answer \
  --pending-id Q1 \
  --rule @./new-rule.txt \
  --binds "front 165, front 144"
```

**Erros comuns:**

```bash
# Arquivo não encontrado
$ specs-bot register spec --content @./missing.md ...
✗ File not found: ./missing.md

# Arquivo não legível
$ specs-bot register spec --content @./private.md ...
✗ Cannot read file: ./private.md (permission denied)

# Campo obrigatório faltando (validado antes de ler arquivo)
$ specs-bot register spec --content @./content.md --type context
✗ Missing required field: --front
```

---

## Instalação

```bash
# Instalar dependências
npm install

# Build do CLI
npm run build --workspace=packages/cli

# Usar globalmente (opcional)
npm link --workspace=packages/cli
```

**Uso básico:**
```bash
specs-bot <comando> <subcomando> [opções]
```

---

## Comandos de Busca e Visualização

### search

Busca full-text em todos os specs e decisões.

**Sintaxe:**
```bash
specs-bot search <query> [opções]
```

**Opções:**
- `--front <front-id>` - Filtrar por front específica
- `--type <type>` - Filtrar por tipo (spec|decision|front)
- `--version <version>` - Filtrar por versão
- `--group <group>` - Filtrar por grupo
- `--format <format>` - Formato de output (toon|json|text)

**Exemplos:**
```bash
# Busca simples
specs-bot search "module system"

# Busca com filtro de front
specs-bot search "opaque type" --front 165-rakun-workspace

# Busca apenas em decisões
specs-bot search "component" --type decision

# Busca com filtro de versão
specs-bot search "workspace" --version 1.0.12-beta

# Output em JSON
specs-bot search "module" --format json
```

**Output TOON (padrão):**
```
results[3]{file,title,snippet,score}:
  fronts/165-rakun/README.md,Module System,"Defines the module...",0.95
  fronts/150-rakun/04-rakun/modules.md,Module Types,"Module types are...",0.87
  decisions-taken.md,Decision 814,"MUST use explicit module paths",0.82
```

---

### view

Visualiza um spec ou decisão específica.

**Sintaxe:**
```bash
specs-bot view <path|decision> [opções]
```

**Opções:**
- `--format <format>` - Formato de output (toon|json|text)
- `--section <section>` - Para decisões pendentes: filtra por seção

**Exemplos:**
```bash
# Ver um spec
specs-bot view fronts/165-rakun-workspace/README.md

# Ver outro spec
specs-bot view fronts/150-rakun/04-rakun/track.md

# Ver decisão tomada
specs-bot view decision 814

# Ver decisões pendentes de uma seção
specs-bot view decision pending --section "Blocking now"
```

**Output TOON (spec):**
```
spec{
  id: "165-rakun-workspace-readme"
  title: "Rakun Workspace"
  frontId: "165-rakun-workspace"
  versions[1]: "1.0.12-beta"
  type: "overview"
  sections[3]{heading,level}:
    "Overview",1
    "Architecture",2
    "Examples",2
  references[2]: "150-rakun","144-backends-tooling"
}
```

---

### list

Lista specs, decisões ou fronts com filtros.

**Sintaxe:**
```bash
specs-bot list [tipo] [opções]
```

**Tipos:**
- (nenhum) - Lista specs
- `decisions` - Lista decisões
- `fronts` - Lista fronts

**Opções:**
- `--front <front-id>` - Filtrar por front
- `--version <version>` - Filtrar por versão
- `--status <status>` - Para decisões: pending|taken|retired
- `--topic <topic>` - Para decisões tomadas: filtra por tópico
- `--format <format>` - Formato de output (toon|json|text)

**Exemplos:**
```bash
# Listar todos os specs
specs-bot list

# Listar specs de uma front
specs-bot list --front 165-rakun-workspace

# Listar specs de uma versão
specs-bot list --version 1.0.12-beta

# Listar decisões pendentes
specs-bot list decisions --status pending

# Listar decisões tomadas por tópico
specs-bot list decisions --status taken --topic module-system

# Listar todas as fronts
specs-bot list fronts
```

**Output TOON (specs):**
```
specs[5]{id,title,frontId,type,versions}:
  165-rakun-readme,"Rakun Overview",165-rakun-workspace,overview,"1.0.12-beta"
  165-rakun-context,"Rakun Context",165-rakun-workspace,context,"1.0.12-beta"
  165-rakun-track,"Rakun Track",165-rakun-workspace,track,"1.0.12-beta"
  150-rakun-modules,"Module System",150-rakun,context,"1.0.11-beta"
  150-rakun-track,"Rakun Track",150-rakun,track,"1.0.11-beta"
```

---

### stats

Mostra estatísticas do sistema.

**Sintaxe:**
```bash
specs-bot stats [opções]
```

**Opções:**
- `--format <format>` - Formato de output (toon|json|text)

**Exemplos:**
```bash
specs-bot stats
```

**Output TOON:**
```
stats{
  totalSpecs: 342
  totalFronts: 28
  decisions{
    taken: 956
    pending: 12
    retired: 87
  }
  versions[3]: "1.0.12-beta","1.0.11-beta","1.0.10-beta"
}
```

---

### links

Mostra referências cruzadas de um spec.

**Sintaxe:**
```bash
specs-bot links <path> [opções]
```

**Opções:**
- `--format <format>` - Formato de output (toon|json|text)

**Exemplos:**
```bash
specs-bot links fronts/165-rakun-workspace/README.md
```

**Output TOON:**
```
links{
  spec: "fronts/165-rakun-workspace/README.md"
  references[3]{type,target}:
    spec,"fronts/150-rakun/04-rakun/modules.md"
    decision,"814"
    front,"144-backends-tooling"
  referencedBy[2]{type,source}:
    spec,"fronts/170-workspace-advanced/README.md"
    decision,"820"
}
```

---

### history

Visualiza o histórico de operações (commits) no repositório de dados.

**Sintaxe:**
```bash
specs-bot history [entity] [id] [opções]
```

**Entidades:**
- (nenhum) - Histórico geral de todas as operações
- `decision` - Histórico de uma decisão específica
- `front` - Histórico de uma front específica
- `spec` - Histórico de um spec específico
- `retired` - Histórico de uma forma aposentada específica

**Opções:**
- `--limit <n>` - Número máximo de entradas (padrão: 50)
- `--since <date>` - Filtrar desde data (YYYY-MM-DD)
- `--until <date>` - Filtrar até data (YYYY-MM-DD)
- `--operation <op>` - Filtrar por tipo de operação (register|update|cancel)
- `--diff` - Mostrar diff das mudanças
- `--format <format>` - Formato de output (toon|json|text)

**Exemplos:**

```bash
# Histórico geral (últimas 50 operações)
specs-bot history

# Histórico com limite
specs-bot history --limit 100

# Histórico por tipo de operação
specs-bot history --operation register
specs-bot history --operation update
specs-bot history --operation cancel

# Histórico por período
specs-bot history --since 2026-01-01
specs-bot history --since 2026-01-01 --until 2026-01-31

# Histórico de uma decisão específica
specs-bot history decision Q1
specs-bot history decision 814

# Histórico de uma front
specs-bot history front 165-rakun-workspace

# Histórico de um spec
specs-bot history spec fronts/165-rakun/README.md

# Histórico de uma forma aposentada
specs-bot history retired "old syntax"

# Histórico com diff (mostra mudanças)
specs-bot history decision Q1 --diff
specs-bot history --last 5 --diff
```

**Output TOON (histórico geral):**
```
history[5]{hash,operation,entity,id,timestamp,message}:
  a1b2c3d,register,decision,Q1,2026-01-15T10:30:45Z,"register: add pending decision Q1"
  b2c3d4e,register,decision,Q2,2026-01-15T11:15:22Z,"register: add pending decision Q2"
  c3d4e5f,update,decision,Q1,2026-01-15T14:20:10Z,"update: decision Q1 (title,section)"
  d4e5f6g,cancel,decision,Q2,2026-01-15T15:45:33Z,"cancel: decision Q2 - No longer relevant"
  e5f6g7h,register,front,170-workspace,2026-01-16T09:00:00Z,"register: add front 170-workspace"
```

**Output TOON (histórico de entidade):**
```
history{
  entity: "decision"
  id: "Q1"
  entries[3]{hash,operation,timestamp,message,diff}:
    a1b2c3d,register,2026-01-15T10:30:45Z,"register: add pending decision Q1",null
    c3d4e5f,update,2026-01-15T14:20:10Z,"update: decision Q1 (title,section)","- title: Old title\n+ title: New title"
    f6g7h8i,update,2026-01-16T08:00:00Z,"update: decision Q1 (measured)","- measured: null\n+ measured: New observation"
}
```

**Output TOON (com diff):**
```
history[2]{hash,operation,timestamp,message,diff}:
  a1b2c3d,register,2026-01-15T10:30:45Z,"register: add pending decision Q1","+ decisions-pending.md:\n  + Q1: Should X use Y?"
  c3d4e5f,update,2026-01-15T14:20:10Z,"update: decision Q1 (title)","- title: Old title\n+ title: New title"
```

---

### conversations

Lista e filtra conversas do histórico.

**Sintaxe:**
```bash
specs-bot conversations [opções]
specs-bot conversations status
specs-bot conversations view <id>
```

**Opções:**
- `--machine <machine>` - Filtrar por máquina (machine-1|machine-2|machine-3|all)
- `--status <status>` - Filtrar por status (active|completed|blocked)
- `--limit <n>` - Número máximo de resultados (padrão: 50)
- `--format <format>` - Formato de output (toon|json|text)

**Exemplos:**

```bash
# Listar todas as conversas
specs-bot conversations

# Filtrar por máquina
specs-bot conversations --machine machine-1

# Filtrar por status
specs-bot conversations --status active

# Combinar filtros
specs-bot conversations --machine machine-2 --status completed

# Ver status geral das conversas
specs-bot conversations status

# Ver conversa específica
specs-bot conversations view conv-2026-01-15-module-system
```

**Output TOON (lista de conversas):**
```
conversations[3]{id,machine,status,title,timestamp}:
  conv-2026-01-15-module,machine-1,active,"Module System Discussion",2026-01-15T10:30:00Z
  conv-2026-01-14-types,machine-2,completed,"Type System Design",2026-01-14T14:20:00Z
  conv-2026-01-13-api,all,active,"API Architecture",2026-01-13T09:00:00Z
```

**Output TOON (status):**
```
status{
  total: 45
  active: 12
  completed: 28
  blocked: 5
  byMachine{machine-1,machine-2,machine-3,all}:
    15,12,10,8
  lastUpdated: "2026-01-15T16:30:00Z"
}
```

**Output TOON (conversa individual):**
```
conversation{
  id: "conv-2026-01-15-module"
  machine: "machine-1"
  status: "active"
  title: "Module System Discussion"
  timestamp: "2026-01-15T10:30:00Z"
  participants[2]: "claude","eric"
  summary: "Discussão sobre implementação do sistema de módulos..."
  sections[3]{heading,level}:
    "Context",2
    "Options",2
    "Decision",2
  references[2]: "165-rakun-workspace","814"
}
```

---

## Comandos de Registro

### register decision

Registra uma nova decisão pendente.

**Sintaxe:**
```bash
specs-bot register decision [opções]
```

**Opções obrigatórias:**
- `--id <id>` - ID único da decisão (ex: Q1, 814-a, etc.)
- `--title <title>` - Título da questão
- `--section <section>` - Seção (To review|Blocking now|Machine 1|Machine 2)

**Opções opcionais:**
- `--measured <text>` - Observação/métrica
- `--options <text>` - Opções consideradas (A) ... B) ...)
- `--recommendation <text>` - Recomendação
- `--blocks <text>` - O que bloqueia

**Exemplos:**
```bash
# Decisão simples
specs-bot register decision \
  --id Q1 \
  --title "Should X use Y?" \
  --section "Machine 1"

# Decisão completa
specs-bot register decision \
  --id Q2 \
  --title "How to handle module imports?" \
  --section "Blocking now" \
  --measured "Observed that wildcard imports cause conflicts" \
  --options "A) Explicit paths B) Wildcard imports C) Auto-import" \
  --recommendation "A" \
  --blocks "step 3 of front 165"

# Decisão com conteúdo longo via arquivo
specs-bot register decision \
  --id Q3 \
  --title "Error handling strategy" \
  --section "To review" \
  --measured @./observations.md \
  --options @./options.md \
  --recommendation "A"
```

**Ações:**
1. Adiciona entrada em `decisions-pending.md` (EN)
2. Adiciona entrada em `decisoes-pendentes.md` (PT)
3. Valida formato e campos

**Output TOON:**
```
registered{
  type: "decision"
  id: "Q1"
  status: "pending"
  files[2]: "decisions-pending.md","decisoes-pendentes.md"
}
```

---

### register decision-answer

Responde uma decisão pendente (move para decisions-taken-steps.md).

**Sintaxe:**
```bash
specs-bot register decision-answer [opções]
```

**Opções obrigatórias:**
- `--pending-id <id>` - ID da decisão pendente
- `--rule <rule>` - Regra decidida (deve seguir formato de regras)
- `--binds <binds>` - Fronts afetadas (comma-separated)

**Exemplos:**
```bash
# Resposta simples
specs-bot register decision-answer \
  --pending-id Q1 \
  --rule "Module imports → MUST use explicit paths | No wildcard imports" \
  --binds "front 165"

# Resposta com múltiplas fronts
specs-bot register decision-answer \
  --pending-id Q2 \
  --rule "Component props → SHOULD be typed with interfaces | Avoid inline types" \
  --binds "front 165, front 144, front 170"
```

**Ações:**
1. Adiciona row em `decisions-taken-steps.md` com próximo número livre
2. Adiciona regra em `decisions-taken.md` no tópico correto
3. Remove entrada de `decisions-pending.md` e `decisoes-pendentes.md`
4. Atualiza "next free number" (957 → 958)

**Validações:**
- `--rule` deve seguir formato: `[CONTEXT] → [MUST|SHOULD|CAN] [action] | [constraint]`
- `--pending-id` deve existir em `decisions-pending.md`
- `--binds` deve conter front IDs válidos

**Output TOON:**
```
registered{
  type: "decision-answer"
  stepId: 957
  pendingId: "Q1"
  rule: "Module imports → MUST use explicit paths | No wildcard imports"
  binds[2]: "front 165","front 144"
  files[4]:
    "decisions-taken-steps.md"
    "decisions-taken.md"
    "decisions-pending.md"
    "decisoes-pendentes.md"
}
```

---

### register front

Registra uma nova front.

**Sintaxe:**
```bash
specs-bot register front [opções]
```

**Opções obrigatórias:**
- `--id <id>` - ID no formato `{number}-{name}` (ex: 165-rakun-workspace)
- `--name <name>` - Nome legível

**Opções opcionais:**
- `--machine <machine>` - machine-1|machine-2
- `--description <text>` - Descrição

**Exemplos:**
```bash
# Front simples
specs-bot register front \
  --id 165-rakun-workspace \
  --name "Rakun Workspace"

# Front completa
specs-bot register front \
  --id 170-workspace-advanced \
  --name "Workspace Advanced" \
  --machine machine-2 \
  --description "Advanced workspace features"
```

**Ações:**
1. Cria diretório `data/fronts/{front-id}/`
2. Cria README.md inicial
3. Atualiza índice de fronts

**Validações:**
- `--id` deve seguir formato `{number}-{name}`
- `--id` não deve existir
- `--machine` deve ser machine-1|machine-2 (se fornecido)

**Output TOON:**
```
registered{
  type: "front"
  id: "165-rakun-workspace"
  name: "Rakun Workspace"
  machine: "machine-1"
  path: "data/fronts/165-rakun-workspace/"
}
```

---

### register spec

Registra um novo spec.

**Sintaxe:**
```bash
specs-bot register spec [opções]
```

**Opções obrigatórias:**
- `--front <front-id>` - Front ID
- `--title <title>` - Título do spec
- `--type <type>` - overview|status|context|track|surface|other

**Opções opcionais:**
- `--group <group>` - Subgrupo (04-rakun, 05-jhonstart, etc.)
- `--versions <versions>` - Versões (comma-separated)
- `--content <markdown>` - Conteúdo inicial (markdown)

**Exemplos:**
```bash
# Spec simples
specs-bot register spec \
  --front 165-rakun-workspace \
  --title "Module System" \
  --type context

# Spec completo
specs-bot register spec \
  --front 165-rakun-workspace \
  --title "Track" \
  --type track \
  --group 04-rakun \
  --versions "1.0.12-beta,1.0.11-beta" \
  --content "# Track\n\nTechnical details..."
```

**Ações:**
1. Cria arquivo `data/fronts/{front-id}/{group}/{title}.md`
2. Adiciona frontmatter com metadata
3. Atualiza índice de specs

**Validações:**
- `--front` deve existir
- `--type` deve ser overview|status|context|track|surface|other
- `--group` é opcional mas deve existir se fornecido

**Output TOON:**
```
registered{
  type: "spec"
  id: "165-rakun-workspace-module-system"
  title: "Module System"
  frontId: "165-rakun-workspace"
  type: "context"
  path: "data/fronts/165-rakun-workspace/module-system.md"
}
```

---

### register retired

Registra uma forma aposentada.

**Sintaxe:**
```bash
specs-bot register retired [opções]
```

**Opções obrigatórias:**
- `--retired <text>` - Forma antiga
- `--replaced-by <text>` - Forma nova
- `--decisions <ids>` - Decisões relacionadas (comma-separated)

**Opções opcionais:**
- `--since <version>` - Desde quando

**Exemplos:**
```bash
# Forma aposentada simples
specs-bot register retired \
  --retired "old syntax" \
  --replaced-by "new syntax" \
  --decisions "814,815,816"

# Forma aposentada com versão
specs-bot register retired \
  --retired "implicit imports" \
  --replaced-by "explicit imports" \
  --decisions "814,820" \
  --since "v1.0.10-beta"
```

**Ações:**
1. Adiciona entrada em `retired.md`
2. Atualiza índice de formas aposentadas

**Output TOON:**
```
registered{
  type: "retired"
  retired: "old syntax"
  replacedBy: "new syntax"
  decisions[3]: 814,815,816
  since: "v1.0.10-beta"
  file: "retired.md"
}
```

---

### register conversation

Registra uma nova conversa no histórico.

**Sintaxe:**
```bash
specs-bot register conversation [opções]
```

**Opções obrigatórias:**
- `--machine <machine>` - Máquina (machine-1|machine-2|machine-3|all)
- `--title <title>` - Título da conversa
- `--content <markdown>` - Conteúdo da conversa (markdown)

**Opções opcionais:**
- `--status <status>` - Status inicial (active|completed|blocked, padrão: active)
- `--participants <list>` - Participantes (comma-separated)
- `--summary <text>` - Resumo da conversa
- `--references <ids>` - Referências a specs/decisões (comma-separated)

**Exemplos:**
```bash
# Conversa simples
specs-bot register conversation \
  --machine machine-1 \
  --title "Module System Discussion" \
  --content @./conversation.md

# Conversa completa
specs-bot register conversation \
  --machine machine-2 \
  --title "Type System Design" \
  --content @./type-discussion.md \
  --status active \
  --participants "claude,eric" \
  --summary "Discussão sobre design do sistema de tipos" \
  --references "165-rakun,814"

# Conversa inline
specs-bot register conversation \
  --machine all \
  --title "Quick Discussion" \
  --content "# Discussion\n\nWe discussed..." \
  --participants "claude"
```

**Ações:**
1. Cria arquivo em `conversations/{id}.md` com frontmatter (machine, status, participants, timestamp)
2. Atualiza `conversations/status.md`
3. Commit automático

**Validações:**
- `--machine` deve ser machine-1|machine-2|machine-3|all
- `--status` deve ser active|completed|blocked (se fornecido)
- `--content` é obrigatório

**Output TOON:**
```
registered{
  type: "conversation"
  id: "conv-2026-01-15-module-system"
  machine: "machine-1"
  status: "active"
  participants[2]: "claude","eric"
  commit{
    hash: "a1b2c3d"
    message: "register: add conversation conv-2026-01-15-module-system (machine: machine-1)"
    timestamp: "2026-01-15T10:30:45Z"
  }
  files[2]: "conversations/conv-2026-01-15-module-system.md","conversations/status.md"
}
```

---

## Comandos de Atualização

### update decision

Atualiza uma decisão existente (pendente ou tomada).

**Sintaxe:**
```bash
specs-bot update decision [opções]
```

**Opções obrigatórias:**
- `--id <id>` - ID da decisão (Q1 para pendente, 814 para tomada)

**Opções opcionais (pendente):**
- `--title <title>` - Novo título
- `--section <section>` - Nova seção
- `--measured <text>` - Nova observação
- `--options <text>` - Novas opções
- `--recommendation <text>` - Nova recomendação
- `--blocks <text>` - Novo bloqueio

**Opções opcionais (tomada):**
- `--rule <rule>` - Nova regra (deve seguir formato)
- `--binds <binds>` - Novas fronts afetadas

**Exemplos:**
```bash
# Atualizar decisão pendente
specs-bot update decision \
  --id Q1 \
  --title "Updated title" \
  --section "Blocking now" \
  --measured "New observation"

# Atualizar decisão tomada
specs-bot update decision \
  --id 814 \
  --rule "Updated rule → MUST use explicit paths | No wildcards" \
  --binds "front 165, front 170"
```

**Ações:**
- **Pendente**: Atualiza `decisions-pending.md` e `decisoes-pendentes.md`
- **Tomada**: Atualiza `decisions-taken.md` e `decisions-taken-steps.md`

**Validações:**
- `--id` deve existir
- `--rule` deve seguir formato (se fornecido)
- `--binds` deve conter front IDs válidos (se fornecido)

**Output TOON:**
```
updated{
  type: "decision"
  id: "Q1"
  status: "pending"
  changedFields[3]: "title","section","measured"
  files[2]: "decisions-pending.md","decisoes-pendentes.md"
}
```

---

### update front

Atualiza uma front existente.

**Sintaxe:**
```bash
specs-bot update front [opções]
```

**Opções obrigatórias:**
- `--id <id>` - Front ID

**Opções opcionais:**
- `--name <name>` - Novo nome
- `--machine <machine>` - Nova machine
- `--description <text>` - Nova descrição

**Exemplos:**
```bash
specs-bot update front \
  --id 165-rakun-workspace \
  --name "New Name" \
  --machine machine-2 \
  --description "Updated description"
```

**Output TOON:**
```
updated{
  type: "front"
  id: "165-rakun-workspace"
  changedFields[2]: "name","machine"
}
```

---

### update spec

Atualiza um spec existente.

**Sintaxe:**
```bash
specs-bot update spec [opções]
```

**Opções obrigatórias:**
- `--path <path>` - Caminho do spec

**Opções opcionais:**
- `--title <title>` - Novo título
- `--type <type>` - Novo tipo
- `--group <group>` - Novo grupo
- `--versions <versions>` - Novas versões (substitui)
- `--content <markdown>` - Novo conteúdo (substitui)

**Exemplos:**
```bash
specs-bot update spec \
  --path fronts/165-rakun/README.md \
  --title "New Title" \
  --type track \
  --versions "1.0.13-beta"
```

**Output TOON:**
```
updated{
  type: "spec"
  path: "fronts/165-rakun/README.md"
  changedFields[3]: "title","type","versions"
}
```

---

### update retired

Atualiza uma forma aposentada.

**Sintaxe:**
```bash
specs-bot update retired [opções]
```

**Opções obrigatórias:**
- `--retired <text>` - Forma antiga (identificador)

**Opções opcionais:**
- `--replaced-by <text>` - Nova forma de substituição
- `--decisions <ids>` - Novas decisões (substitui)
- `--since <version>` - Nova data

**Exemplos:**
```bash
specs-bot update retired \
  --retired "old syntax" \
  --replaced-by "newer syntax" \
  --decisions "814,815,820"
```

**Output TOON:**
```
updated{
  type: "retired"
  retired: "old syntax"
  changedFields[2]: "replacedBy","decisions"
  file: "retired.md"
}
```

---

## Comandos de Cancelamento

### cancel decision

Cancela uma decisão (pendente ou tomada).

**Sintaxe:**
```bash
specs-bot cancel decision [opções]
```

**Opções obrigatórias:**
- `--id <id>` - ID da decisão
- `--reason <text>` - Motivo do cancelamento

**Opções opcionais (para decisões tomadas):**
- `--superseded-by <id>` - ID da decisão que substitui

**Exemplos:**
```bash
# Cancelar decisão pendente
specs-bot cancel decision \
  --id Q1 \
  --reason "No longer relevant"

# Cancelar decisão tomada (move para retired)
specs-bot cancel decision \
  --id 814 \
  --reason "Superseded by decision 820" \
  --superseded-by 820
```

**Ações:**
- **Pendente**: Remove de `decisions-pending.md` e `decisoes-pendentes.md`
- **Tomada**: Move para `retired.md`, remove de `decisions-taken.md` e `decisions-taken-steps.md`

**Output TOON:**
```
cancelled{
  type: "decision"
  id: "Q1"
  status: "pending"
  reason: "No longer relevant"
  files[2]: "decisions-pending.md","decisoes-pendentes.md"
}
```

---

### cancel front

Cancela uma front (remove specs associados).

**Sintaxe:**
```bash
specs-bot cancel front [opções]
```

**Opções obrigatórias:**
- `--id <id>` - Front ID
- `--reason <text>` - Motivo

**Exemplos:**
```bash
specs-bot cancel front \
  --id 165-rakun-workspace \
  --reason "Merged into front 170"
```

**Ações:**
1. Remove diretório `data/fronts/{front-id}/`
2. Remove specs do índice
3. Atualiza referências

**Output TOON:**
```
cancelled{
  type: "front"
  id: "165-rakun-workspace"
  reason: "Merged into front 170"
  specsRemoved: 5
}
```

---

### cancel spec

Cancela um spec.

**Sintaxe:**
```bash
specs-bot cancel spec [opções]
```

**Opções obrigatórias:**
- `--path <path>` - Caminho do spec
- `--reason <text>` - Motivo

**Exemplos:**
```bash
specs-bot cancel spec \
  --path fronts/165-rakun/README.md \
  --reason "Content moved to spec X"
```

**Output TOON:**
```
cancelled{
  type: "spec"
  path: "fronts/165-rakun/README.md"
  reason: "Content moved to spec X"
}
```

---

### cancel retired

Cancela uma forma aposentada.

**Sintaxe:**
```bash
specs-bot cancel retired [opções]
```

**Opções obrigatórias:**
- `--retired <text>` - Forma antiga
- `--reason <text>` - Motivo

**Exemplos:**
```bash
specs-bot cancel retired \
  --retired "old syntax" \
  --reason "Reverted, syntax still valid"
```

**Output TOON:**
```
cancelled{
  type: "retired"
  retired: "old syntax"
  reason: "Reverted, syntax still valid"
  file: "retired.md"
}
```

---

## Formato de Output

O CLI suporta três formatos de output:

### TOON (padrão)

Formato compacto otimizado para LLMs (~40% menos tokens que JSON).

```bash
specs-bot search "module"
```

**Características:**
- Arrays tabulares: `field1,field2,field3:` seguido de rows
- Objetos: `key: value` com indentação
- Strings: quoted apenas quando necessário
- Comprimento explícito: `[N]`

### JSON

Formato tradicional para parsing.

```bash
specs-bot search "module" --format json
```

### Text

Formato legível para humanos.

```bash
specs-bot search "module" --format text
```

---

## Formato de Regras (Steps)

Todas as regras em `decisions-taken-steps.md` devem seguir o formato:

```
[CONTEXT] → [MUST|SHOULD|CAN] [action] | [constraint]
```

**Exemplos:**
```
Module imports → MUST use explicit paths | No wildcard imports
Component props → SHOULD be typed with interfaces | Avoid inline types
Error handling → MUST use Result type | No try/catch blocks
Variable naming → CAN use camelCase | Prefer descriptive names
```

**Validação:**
```typescript
const STEP_PATTERN = /^(.+?)\s*→\s*(MUST|SHOULD|CAN|SHALL)\s+(.+?)(?:\s*\|\s*(.+))?$/;
```

**Erro de validação:**
```
✗ Invalid rule format. Expected: [CONTEXT] → [MUST|SHOULD|CAN] [action] | [constraint]
  Got: "use explicit paths"
  Example: "Module imports → MUST use explicit paths | No wildcard imports"
```

---

## Validações e Erros

### Validações Automáticas

1. **IDs únicos**: Não permite duplicatas
2. **Formato de regras**: Valida formato `[CONTEXT] → [MUST|SHOULD|CAN] [action] | [constraint]`
3. **Front IDs válidos**: Verifica se fronts existem
4. **Seções válidas**: To review|Blocking now|Machine 1|Machine 2
5. **Tipos válidos**: overview|status|context|track|surface|other
6. **Machines válidas**: machine-1|machine-2

### Mensagens de Erro

**ID duplicado:**
```
✗ Decision ID "Q1" already exists in decisions-pending.md
  Use a different ID or update the existing decision with: specs-bot update decision --id Q1
```

**Front inexistente:**
```
✗ Front "999-nonexistent" does not exist
  Available fronts: 165-rakun-workspace, 150-rakun, 144-backends-tooling
```

**Formato de regra inválido:**
```
✗ Invalid rule format. Expected: [CONTEXT] → [MUST|SHOULD|CAN] [action] | [constraint]
  Got: "use explicit paths"
  Example: "Module imports → MUST use explicit paths | No wildcard imports"
```

**Decisão pendente não encontrada:**
```
✗ Pending decision "Q999" not found in decisions-pending.md
  Use specs-bot list decisions --status pending to see available decisions
```

---

## Exemplos Práticos

### Fluxo Completo de Decisão

```bash
# 1. Registrar decisão pendente
specs-bot register decision \
  --id Q10 \
  --title "How to handle module imports?" \
  --section "Blocking now" \
  --measured "Observed conflicts with wildcard imports" \
  --options "A) Explicit paths B) Wildcard imports" \
  --recommendation "A" \
  --blocks "step 3 of front 165"

# 2. Listar decisões pendentes
specs-bot list decisions --status pending

# 3. Responder decisão
specs-bot register decision-answer \
  --pending-id Q10 \
  --rule "Module imports → MUST use explicit paths | No wildcard imports" \
  --binds "front 165, front 144"

# 4. Ver decisão tomada
specs-bot view decision 957

# 5. Atualizar decisão (se necessário)
specs-bot update decision \
  --id 957 \
  --rule "Module imports → MUST use explicit paths | No wildcard or glob imports"

# 6. Cancelar decisão (se necessário)
specs-bot cancel decision \
  --id 957 \
  --reason "Superseded by decision 960" \
  --superseded-by 960
```

### Fluxo de Front e Specs

```bash
# 1. Criar front
specs-bot register front \
  --id 175-new-feature \
  --name "New Feature" \
  --machine machine-2 \
  --description "New feature implementation"

# 2. Criar specs
specs-bot register spec \
  --front 175-new-feature \
  --title "Overview" \
  --type overview \
  --content "# New Feature\n\nOverview of the feature..."

specs-bot register spec \
  --front 175-new-feature \
  --title "Technical Details" \
  --type context \
  --group 01-implementation \
  --content "# Technical Details\n\n..."

# 3. Listar specs da front
specs-bot list --front 175-new-feature

# 4. Atualizar spec
specs-bot update spec \
  --path fronts/175-new-feature/overview.md \
  --content "# Updated Overview\n\n..."

# 5. Cancelar front (se necessário)
specs-bot cancel front \
  --id 175-new-feature \
  --reason "Feature cancelled"
```

### Busca e Navegação

```bash
# 1. Buscar termo
specs-bot search "module system"

# 2. Ver resultado
specs-bot view fronts/165-rakun/README.md

# 3. Ver referências
specs-bot links fronts/165-rakun/README.md

# 4. Ver decisão referenciada
specs-bot view decision 814

# 5. Listar specs relacionados
specs-bot list --front 165-rakun
```

### Auditoria e Histórico

```bash
# 1. Ver últimas operações
specs-bot history

# 2. Ver histórico de uma decisão
specs-bot history decision Q1

# 3. Ver histórico com diff
specs-bot history decision Q1 --diff

# 4. Ver operações de um período
specs-bot history --since 2026-01-01 --until 2026-01-31

# 5. Ver apenas cancelamentos
specs-bot history --operation cancel

# 6. Ver histórico de uma front
specs-bot history front 165-rakun-workspace

# 7. Reverter operação (via git)
cd data && git revert a1b2c3d
```

---

## Notas Importantes

1. **Output padrão**: TOON é o formato padrão para todos os comandos
2. **Bilíngue**: `decisions-pending.md` (EN) e `decisoes-pendentes.md` (PT) são mantidos em sincronia automaticamente
3. **Próximo número livre**: O CLI determina automaticamente o próximo número livre em `decisions-taken-steps.md`
4. **Validações**: Todas as operações validam campos obrigatórios e formatos
5. **Rollback**: Operações de cancelamento são reversíveis apenas via git
6. **Performance**: Operações em grandes volumes podem levar alguns segundos

---

**Versão**: 1.0.0  
**Licença**: MIT  
**Repositório**: /home/ericfillipe/develop/specs-bot
