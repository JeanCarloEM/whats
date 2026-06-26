# WhatSender

[![CI](https://github.com/JeanCarloEM/whatsender/actions/workflows/ci.yml/badge.svg)](https://github.com/JeanCarloEM/whatsender/actions/workflows/ci.yml)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-brightgreen.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-LTS-339933.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](#requisitos)

Aplicativo local em Node.js para enviar mensagens personalizadas pelo WhatsApp Web usando CSV, modelo Markdown, interface grafica local, sessoes persistidas e logs auditaveis.

Todos os nomes, telefones, contas, caminhos e URLs deste README sao exemplos ficticios.

## Sumario

- [Visao geral](#visao-geral)
- [Requisitos](#requisitos)
- [Instalacao](#instalacao)
- [Uso rapido](#uso-rapido)
- [Arquivos de entrada](#arquivos-de-entrada)
- [GUI](#gui)
- [CLI](#cli)
- [Sessoes](#sessoes)
- [Logs e reenvio](#logs-e-reenvio)
- [Testes](#testes)
- [Documentacao](#documentacao)
- [Licenca e disclaimer](#licenca-e-disclaimer)

## Visao geral

O WhatSender usa `clientes.csv` como base de destinatarios e `texto.md` como modelo padrao. Antes de enviar, valida arquivos, anexos, logs, navegador e numeros do WhatsApp com `client.getNumberId()`.

Principais recursos:

- GUI local para configurar modelo, CSV, filtro, sessao e reenvio.
- CLI preservada para automacao.
- Variaveis `${campo}` insensiveis a maiusculas/minusculas.
- Apenas `nome` e `telefone` obrigatorios no CSV.
- Expressoes matematicas e filtros logicos com funcoes.
- Anexos via Markdown `![](CAMINHO_OU_URL)`, incluindo URL com cache temporario.
- `.ogg` apenas de audio enviado como mensagem de voz.
- Controle inteligente de reenvio por telefone, conteudo nativo e tempo.
- Compatibilidade com Windows, macOS e Linux quando as dependencias tambem forem compativeis.

O contrato funcional completo fica em [RCF.md](RCF.md).

## Requisitos

- Node.js LTS.
- npm.
- Google Chrome, Chromium ou Microsoft Edge.
- WhatsApp ativo no celular para autenticar a primeira sessao.

Os inicializadores tentam preparar dependencias e navegador automaticamente. Se nao houver Chrome, Chromium ou Edge, o projeto tenta instalar um Chrome compativel via Puppeteer.

## Instalacao

Windows:

```powershell
cd C:\caminho\ficticio\whatsender
.\start.cmd
```

macOS/Linux:

```bash
cd /caminho/ficticio/whatsender
sh ./start.sh
```

Instalacao manual:

```powershell
npm install
npm run browser:ensure
npm run check
```

`npm run check` exige os arquivos operacionais (`clientes.csv` e `texto.md`) e nao envia mensagens.
Para validar o RCF com fixtures versionadas, sem depender desses arquivos reais:

```powershell
npm run check:test
```

## Uso rapido

1. Crie `clientes.csv` na raiz.
2. Crie `texto.md` na raiz ou escolha um modelo em `modelos/`.
3. Rode `npm run check`.
4. Abra a GUI com `npm run start:gui` ou use `.\start.cmd`.
5. Escaneie o QR Code quando solicitado.
6. Execute o envio pela GUI ou por `npm start`.

## Arquivos de entrada

`clientes.csv` minimo:

```csv
nome,telefone
Pessoa Exemplo,11999999999
```

Colunas extras sao opcionais e podem ser usadas em `${campo}`:

```csv
nome,telefone,valor,status
Pessoa Exemplo,11999999999,"120,50",ativo
```

O CSV pode estar em UTF-8 ou ANSI/Windows-1252 e o parser tenta inferir delimitadores comuns de planilha, como `,`, `;`, tab e `|`, preservando acentos e `ç`.

`texto.md` exemplo:

```markdown
$diatarde$, ${nome}.

Seu valor atualizado e ${$.moeda(valor)}.

*Importante:* responda esta mensagem para confirmar.

![](anexos/exemplo.pdf)
```

Demonstracao de sintaxe textual:

| Marcacao crua | Resultado visual esperado no WhatsApp |
| --- | --- |
| `*negrito exemplo*` | <strong>negrito exemplo</strong> |
| `_italico exemplo_` | <em>italico exemplo</em> |
| `~taxado exemplo~` | <del>taxado exemplo</del> |
| `1. item` | lista enumerada |
| `- item` | lista simples |


## GUI

Execute:

```powershell
npm run start:gui
```

A interface local abre no inicio do fluxo, mostra autenticacao/carregamento do WhatsApp e libera o botao de envio somente quando o WhatsApp estiver pronto. Ela permite:

- selecionar, criar, renomear e remover sessoes;
- informar modelo por textarea ou arquivo `.md`;
- informar filtro;
- anexar CSV opcional;
- forcar reenvio ou limpar historico de enviados;
- acompanhar andamento sem inundar a tela.

## CLI

Comandos principais:

| Comando | Funcao |
| --- | --- |
| `.\start.cmd` | Prepara dependencias e abre a GUI no Windows. |
| `sh ./start.sh` | Prepara dependencias e abre a GUI no macOS/Linux. |
| `npm install` | Instala dependencias manualmente. |
| `npm run browser:ensure` | Verifica Chrome/Chromium/Edge e instala Chrome compativel se necessario. |
| `npm run check` | Valida a campanha real sem enviar. |
| `npm run check:test` | Valida com fixtures em `test/`, sem depender de `clientes.csv` real. |
| `node main.js --check --check-csv test/check-clientes.csv --check-template test/check-texto.md` | Valida usando paths especificos de CSV e Markdown. |
| `npm run start:gui` | Inicia a interface grafica local. |
| `npm start` | Envia via CLI usando `clientes.csv` e `texto.md`. |
| `npm start -- faturamento` | Usa `modelos/faturamento.md`. |
| `node main.js --check faturamento` | Valida um modelo especifico sem enviar. |
| `node main.js --lista base_exemplo` | Usa `listas/base_exemplo.csv`. |
| `node main.js faturamento base_exemplo` | Usa modelo e lista nomeados. |
| `node main.js --lista "status=ativo"` | Filtra `clientes.csv` por coluna. |
| `node main.js --lista "valor>=100 && status=ativo"` | Usa filtro composto com comparacao e logica. |
| `npm run start:force` | Ignora historico de enviados nesta execucao. |
| `npm run start:clear` | Limpa `logs/enviados.csv` antes de iniciar. |
| `npm run sent:clear` | Alias para limpar enviados. |
| `npm run start:reset` | Alias legado para limpar enviados. |
| `node main.js --new-session Comercial --gui` | Cria sessao nomeada e abre a GUI. |
| `node main.js --session Comercial --gui` | Abre a GUI usando uma sessao existente. |
| `node main.js --rename-session Comercial Financeiro` | Renomeia uma sessao. |
| `node main.js --remove-session Comercial` | Remove sessao e autenticacao local correspondente. |
| `npm test` | Roda a suite automatizada. |
| `.\atualizar.cmd` | Atualiza pelo GitHub Releases, ou por `main` se nao houver release, no Windows. |
| `sh ./atualizar.sh` | Atualiza pelo GitHub Releases, ou por `main` se nao houver release, no macOS/Linux. |

Use `npm run <script> -- argumento` quando passar parametros por scripts npm. Exemplo: `npm run start:force -- faturamento`.

## Sessoes

A sessao padrao usa `.wwebjs_auth/session`. Sessoes nomeadas usam perfis independentes e logs separados.

```powershell
node main.js --new-session Comercial --gui
node main.js --session Comercial --gui
node main.js --rename-session Comercial Financeiro
node main.js --remove-session Comercial
```

Na GUI, alternar, criar ou remover a sessao ativa reinicia automaticamente o client do WhatsApp. Se a ultima sessao for removida, a proxima abertura volta ao fluxo inicial com QR Code.

## Logs e reenvio

Os logs ficam em `logs/`:

- `enviados.csv`: telefones enviados.
- `erros.csv`: falhas e numeros invalidos.
- `pulos.csv`: registros pulados com motivo.
- `avisos.csv`: avisos de template.
- `mensagens.json`: versoes nativas usadas no controle inteligente.

Por padrao, uma mensagem igual ou menos de 10% diferente nao e reenviada para o mesmo telefone dentro de 48 horas. Ajustes:

```env
MESSAGE_DIFF_THRESHOLD_PERCENT=10
RESEND_AFTER_HOURS=48
MIN_DELAY_MS=1500
MAX_DELAY_MS=4000
```

## Testes

```powershell
npm test
```

Os testes cobrem parser, filtros, template, anexos, logs, sessoes e validacoes centrais do RCF. `npm run check` valida a campanha real sem enviar, mas depende dos arquivos operacionais locais.

## Documentacao

- [RCF.md](RCF.md): contrato funcional e nao funcional.
- [docs/usage.md](docs/usage.md): guia avancado de modelos, filtros, anexos, navegador e operacao.
- [AGENTS.md](AGENTS.md): instrucoes para manutencao assistida.

## Licenca e disclaimer

Autor: JeanCarloEM.com

Repositorio: <https://github.com/JeanCarloEM/whatsender>

Licenca: [Mozilla Public License 2.0](LICENSE), tambem disponivel em <https://www.mozilla.org/MPL/2.0/>.

Disclaimer:

Este software é fornecido estritamente como está e como disponível, sem garantias expressas, implícitas, legais, comerciais, técnicas, operacionais, de disponibilidade, segurança, conformidade, licitude, não infração ou adequação a qualquer finalidade. O projeto é destinado exclusivamente a usos legítimos, proporcionais e consentidos, como comunicação com clientes reais, assinantes, contatos que autorizaram contato ou públicos próprios e legítimos. O autor é expressamente contrário ao uso massivo, abusivo, enganoso, invasivo, como spam, scraping, assédio, fraude, envio sem consentimento ou qualquer prática que viole leis, termos de serviço, privacidade ou direitos de terceiros. O uso, configuração, conteúdo enviado, destinatários, credenciais, automações e consequências são de responsabilidade exclusiva do usuário. Nada constitui consultoria, serviço gerenciado, vínculo, autorização para uso indevido, promessa de resultado ou assunção de responsabilidade pelo autor, que não responderá por danos, perdas, bloqueios, sanções, incidentes, violações, reclamações ou responsabilidades civis, criminais, trabalhistas, administrativas, regulatórias, contratuais ou de qualquer outra natureza.
