@echo off
REM Autor: JeanCarloEM.com
REM Site do Autor: https://jeancarloem.com
REM Licenca: Mozilla Public License 2.0
REM Site da Licenca: https://www.mozilla.org/MPL/2.0/
REM Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
REM Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

setlocal EnableExtensions

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Tentando instalar Node.js LTS...
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  ) else (
    where choco >nul 2>nul
    if not errorlevel 1 (
      choco install nodejs-lts -y
    ) else (
      echo Nao foi possivel instalar automaticamente. Instale Node.js LTS e execute novamente.
      exit /b 1
    )
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ainda nao esta disponivel no PATH. Abra um novo terminal e execute novamente.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm nao encontrado. Reinstale Node.js LTS ou ajuste o PATH.
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias do projeto...
  set "PUPPETEER_SKIP_DOWNLOAD=true"
  set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"
  if exist package-lock.json (
    call npm ci
  ) else (
    call npm install
  )
) else (
  call npm ls --depth=0 >nul 2>nul
  if errorlevel 1 (
    echo Ajustando dependencias ausentes...
    set "PUPPETEER_SKIP_DOWNLOAD=true"
    set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"
    call npm install
  )
)

if errorlevel 1 (
  echo Falha ao preparar dependencias.
  exit /b 1
)

set "PUPPETEER_SKIP_DOWNLOAD="
set "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="

echo Verificando navegador compativel...
call node scripts\ensure-browser.js
if errorlevel 1 (
  echo Falha ao preparar navegador compativel.
  exit /b 1
)

call npm run start:gui -- %*
