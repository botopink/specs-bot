#!/bin/bash

# Script de inicialização do ambiente de desenvolvimento
# Configura a branch do data/ e inicia os containers

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Specs Bot - Setup Inicial${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. Verificar se data/ existe
if [ ! -d "./data" ]; then
    echo -e "${YELLOW}⚠ Criando diretório data/...${NC}"
    mkdir -p ./data
fi

# 2. Inicializar git no data/ se necessário
if [ ! -d "./data/.git" ]; then
    echo -e "${YELLOW}⚠ Inicializando git em data/...${NC}"
    cd data
    git init
    git config user.name "Specs Bot API"
    git config user.email "specs-bot@localhost"
    
    # Criar commit inicial se não houver arquivos
    if [ -z "$(git ls-files)" ]; then
        echo "# Specs Bot Data" > README.md
        git add README.md
        git commit -m "Initial commit"
    fi
    cd ..
fi

# 3. Sincronizar branch do data/ com projeto principal
echo -e "${YELLOW}⚠ Sincronizando branch do data/...${NC}"
./scripts/sync-data-branch.sh

# 4. Verificar se docker está instalado
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker não encontrado. Instale o Docker primeiro.${NC}"
    exit 1
fi

# 5. Build e start dos containers
echo -e "${YELLOW}⚠ Buildando containers...${NC}"
docker compose build

echo -e "${YELLOW}⚠ Iniciando containers...${NC}"
docker compose up -d

# 6. Aguardar serviços estarem prontos
echo -e "${YELLOW}⚠ Aguardando serviços...${NC}"
sleep 5

# 7. Verificar health
echo -e "${BLUE}Verificando saúde dos serviços...${NC}"
docker compose ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup completo!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Serviços disponíveis:${NC}"
echo "  - API:  http://localhost:4000/api"
echo "  - Site: http://localhost:3000"
echo ""
echo -e "${BLUE}Comandos úteis:${NC}"
echo "  - Ver logs: docker compose logs -f"
echo "  - Parar: docker compose down"
echo "  - CLI: docker compose run --rm cli <command>"
echo ""
echo -e "${YELLOW}Branch atual do data/: $(cd data && git rev-parse --abbrev-ref HEAD)${NC}"
