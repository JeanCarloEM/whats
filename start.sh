#!/usr/bin/env sh
# Autor: JeanCarloEM.com
# Site do Autor: https://jeancarloem.com
# Licenca: Mozilla Public License 2.0
# Site da Licenca: https://www.mozilla.org/MPL/2.0/
# Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
# Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

set -eu

cd "$(dirname "$0")"

install_node() {
  echo "Node.js nao encontrado. Tentando instalar Node.js LTS..."

  if command -v brew >/dev/null 2>&1; then
    brew install node
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y nodejs npm
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
    return
  fi

  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --needed nodejs npm
    return
  fi

  echo "Nao foi possivel instalar automaticamente. Instale Node.js LTS e execute novamente."
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  install_node
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ainda nao esta disponivel no PATH. Abra um novo terminal e execute novamente."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm nao encontrado. Reinstale Node.js LTS ou ajuste o PATH."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Instalando dependencias do projeto..."
  export PUPPETEER_SKIP_DOWNLOAD=true
  export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
else
  if ! npm ls --depth=0 >/dev/null 2>&1; then
    echo "Ajustando dependencias ausentes..."
    export PUPPETEER_SKIP_DOWNLOAD=true
    export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
    npm install
  fi
fi

unset PUPPETEER_SKIP_DOWNLOAD
unset PUPPETEER_SKIP_CHROMIUM_DOWNLOAD

echo "Verificando navegador compativel..."
node scripts/ensure-browser.js

npm run start:gui -- "$@"
