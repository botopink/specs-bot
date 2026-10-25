#!/bin/bash

# Script para sincronizar a branch do data/ com a branch do projeto principal
# Uso: ./scripts/sync-data-branch.sh [branch-name]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

DATA_DIR="./data"

# Obter branch atual do projeto principal
get_main_branch() {
    git rev-parse --abbrev-ref HEAD
}

# Verificar se data/ é um repositório git
check_data_repo() {
    if [ ! -d "$DATA_DIR/.git" ]; then
        echo -e "${RED}Erro: $DATA_DIR não é um repositório git${NC}"
        echo "Inicialize com: cd $DATA_DIR && git init"
        exit 1
    fi
}

# Sincronizar branch
sync_branch() {
    local target_branch=$1
    
    check_data_repo
    
    cd "$DATA_DIR"
    
    # Verificar se a branch existe no data/
    if git show-ref --verify --quiet "refs/heads/$target_branch"; then
        echo -e "${GREEN}✓ Branch '$target_branch' existe no data/${NC}"
        git checkout "$target_branch"
    else
        echo -e "${YELLOW}⚠ Branch '$target_branch' não existe no data/, criando...${NC}"
        git checkout -b "$target_branch"
    fi
    
    echo -e "${GREEN}✓ Data/ sincronizado com branch: $target_branch${NC}"
}

# Main
if [ -z "$1" ]; then
    # Se nenhum argumento, usar branch do projeto principal
    MAIN_BRANCH=$(get_main_branch)
    echo -e "${YELLOW}Sincronizando data/ com branch do projeto: $MAIN_BRANCH${NC}"
    sync_branch "$MAIN_BRANCH"
else
    # Usar branch especificada
    echo -e "${YELLOW}Sincronizando data/ com branch: $1${NC}"
    sync_branch "$1"
fi
