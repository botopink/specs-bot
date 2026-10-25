#!/bin/bash

# Script para trocar a branch do data/ e fazer push/pull
# Uso: ./scripts/data-git.sh [push|pull|status|checkout <branch>]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

DATA_DIR="./data"

check_data_repo() {
    if [ ! -d "$DATA_DIR/.git" ]; then
        echo -e "${RED}Erro: $DATA_DIR não é um repositório git${NC}"
        exit 1
    fi
}

case "$1" in
    "push")
        check_data_repo
        cd "$DATA_DIR"
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        echo -e "${YELLOW}Pushing data/ branch: $BRANCH${NC}"
        git push origin "$BRANCH"
        echo -e "${GREEN}✓ Push completo${NC}"
        ;;
    
    "pull")
        check_data_repo
        cd "$DATA_DIR"
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        echo -e "${YELLOW}Pulling data/ branch: $BRANCH${NC}"
        git pull origin "$BRANCH"
        echo -e "${GREEN}✓ Pull completo${NC}"
        ;;
    
    "status")
        check_data_repo
        cd "$DATA_DIR"
        echo -e "${BLUE}Data/ Git Status:${NC}"
        echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
        echo ""
        git status
        ;;
    
    "checkout")
        if [ -z "$2" ]; then
            echo -e "${RED}Erro: especifique a branch${NC}"
            echo "Uso: $0 checkout <branch-name>"
            exit 1
        fi
        check_data_repo
        cd "$DATA_DIR"
        
        if git show-ref --verify --quiet "refs/heads/$2"; then
            git checkout "$2"
            echo -e "${GREEN}✓ Checkout para branch: $2${NC}"
        else
            echo -e "${YELLOW}⚠ Branch '$2' não existe, criando...${NC}"
            git checkout -b "$2"
            echo -e "${GREEN}✓ Branch '$2' criada${NC}"
        fi
        ;;
    
    *)
        echo "Uso: $0 [push|pull|status|checkout <branch>]"
        echo ""
        echo "Comandos:"
        echo "  push              - Push data/ para remote"
        echo "  pull              - Pull data/ do remote"
        echo "  status            - Mostrar status do git em data/"
        echo "  checkout <branch> - Trocar branch do data/"
        exit 1
        ;;
esac
