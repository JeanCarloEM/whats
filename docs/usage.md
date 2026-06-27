# Guia Avancado de Uso

Este guia complementa o [README](../README.md) com detalhes operacionais. O contrato de regras permanece em [RCF.md](../RCF.md).

## Modelos

O modelo padrao e `texto.md`. Modelos alternativos ficam em `modelos/` e sao selecionados pelo nome sem extensao:

```powershell
npm start -- faturamento
node main.js faturamento
```

Regras aplicadas ao modelo:

- `${campo}` busca qualquer coluna do CSV sem diferenciar maiusculas/minusculas.
- `${nome}` e capitalizado e limitado a duas palavras.
- `${(valor+taxa)*2}` executa conta simples.
- `$diatarde$` vira `bom dia` antes das 12h e `boa tarde` a partir das 12h.
- `![](CAMINHO_OU_URL)` vira anexo no ponto em que aparece.
- Quebras Windows (`CRLF`), Linux/macOS (`LF`), `CR` isolado e separadores Unicode sao normalizados para `LF` antes do envio; recuos, espacos e tabulacoes intencionais sao preservados.
- Entidades HTML numericas e nomeadas comuns, como `&#x20;`, `&#32;`, `&nbsp;`, `&amp;`, `&lt;` e `&ccedil;`, sao convertidas para caracteres Unicode reais antes do envio e antes da interpretacao de anexos.

Antes do envio efetivo, o modelo e analisado por potenciais erros de sintaxe. Exemplos: `{nome}` sem `$`, `${valor+}` com expressão inválida, `${nome` sem fechamento e `}` solto. Na GUI, a tela abre uma confirmação; na CLI, o terminal pergunta `sim` ou `não`, aceitando variações de maiúsculas/minúsculas e acentos. Se a resposta for vazia, inválida ou negativa, o envio é abortado.

Funcoes de formatacao em `${...}`:

```markdown
${$.moeda(valor)}
${$.decimal(valor)}
${$.numero(quantidade)}
${$.digito1(conta)}
${$.digito2(conta)}
${$.round(valor)}
${$.ceil(valor)}
${$.floor(valor)}
${$.int(valor)}
```

Um arquivo pode conter multiplas variacoes separadas por uma linha com `^^^`. Quando todos os blocos atingem o tamanho minimo configurado, a distribuicao entre destinatarios e circular.

## Emojis profissionais

Lista complementar de 60 emojis sugeridos para uso moderado em mensagens profissionais:

`⚠️` alerta, `✅` concluido, `❌` erro, `📋` lista, `👍` ok, `ℹ️` informacao, `📌` destaque, `⏰` prazo, `⏱️` economia de tempo, `📎` anexo, `💬` resposta, `🚀` lancamento, `🎯` objetivo, `💡` ideia, `🏷️` preco baixo, `💸` baixo custo, `♻️` economia de recursos, `📦` entrega, `📈` resultado, `🤝` parceria/tamo junto, `🆗` aprovado, `☑️` confirmado, `🔔` lembrete, `📣` anuncio, `📢` comunicado, `📲` contato, `📞` ligacao, `✉️` email, `📝` cadastro, `📄` documento, `🧾` comprovante, `💳` pagamento, `💰` valor, `🎁` brinde, `🔥` oferta, `⭐` favorito, `🛒` compra, `🛍️` pedido, `🚚` frete, `🔒` seguro, `🔐` acesso, `🛠️` suporte, `🧩` solucao, `📊` relatorio, `📉` reducao, `🧮` calculo, `📅` agenda, `🗓️` data, `⌛` aguardando, `🔄` atualizacao, `⬆️` aumento, `⬇️` desconto, `➡️` proximo passo, `✨` novidade, `🎉` comemoracao, `🏆` conquista, `💎` premium, `🙏` agradecimento, `🙂` cordialidade, `😔` atencao empatica.

## Listas e filtros

A lista padrao e `clientes.csv`. Listas alternativas ficam em `listas/`:

```powershell
node main.js --lista base_exemplo
node main.js faturamento base_exemplo
```

O carregamento do CSV tenta aceitar exportações comuns do Excel, Bloco de Notas e planilhas em geral. A leitura detecta UTF-8 com ou sem BOM, UTF-16 e ANSI/Windows-1252, preservando acentuação, `ç` e símbolos comuns. O parser também infere delimitadores frequentes: vírgula, ponto e vírgula, tabulação e `|`, com texto delimitado por aspas duplas ou simples.

Se o parametro tiver expressao de filtro, ele sera aplicado sobre `clientes.csv`:

```powershell
node main.js --lista "status=ativo"
node main.js --lista "valor>=10,5 && status!=cancelado"
node main.js --lista "($.isnum(valor) && valor>0) || $.istrue(vigente)"
```

Comparadores aceitos:

```text
=  !=  <  <=  >  >=
```

Operadores logicos:

```text
&&  ||  ^^  !
```

Tambem sao aceitos parenteses, `+`, `-`, `*`, `/` e funcoes:

```text
$.vazio(coluna)
$.isnum(coluna)
$.isfloat(coluna)
$.isint(coluna)
$.isbool(coluna)
$.istrue(coluna)
$.istring(coluna)
```

Numeros podem usar `.` ou `,` como separador decimal. Valores booleanos reconhecem variacoes comuns como `sim`, `nao`, `true`, `false`, `1`, `0`, `ativo`, `inativo`, `vigente`, `cancelado`, `valido` e `invalido`, com tratamento de acentos quando aplicavel.

## Anexos

A notacao Markdown de imagem e usada como marcador generico de anexo:

```markdown
Segue o documento:

![](anexos/exemplo.pdf)
```

O caminho pode ser:

- relativo ao arquivo de modelo em uso;
- absoluto;
- URL `http` ou `https`.

Quando o caminho for relativo, com ou sem `./` ou `.\`, a busca usa primeiro a pasta do `.md` selecionado. Se o arquivo não existir ali, o sistema faz uma segunda tentativa na raiz do projeto. Na GUI, isso funciona com o diretório real do `.md` quando ele estiver disponível; uploads feitos pelo navegador podem ocultar esse caminho por segurança, então o fallback para a raiz do projeto continua disponível.

Na GUI, ao escolher um arquivo `.md`, os anexos locais são analisados em segundo plano. Se algum não for localizado, a própria seção do arquivo exibe um alerta e abre um campo para informar a pasta local de referência dos anexos. O campo aceita apenas diretório local existente; URLs ou caminhos inexistentes são rejeitados antes do envio.

URLs sao baixadas uma vez para cache temporario e reutilizadas quando a mesma URL aparece novamente. Arquivos locais inexistentes falham na pre-validacao.

Quando o anexo aparece no inicio ou fim do modelo, o texto adjacente pode ser enviado como legenda do proprio anexo quando o WhatsApp Web permitir. Quando aparece no meio, a ordem do modelo e preservada com partes separadas.

Arquivos `.ogg` sao inspecionados. Se forem apenas audio, sao enviados como mensagem de voz separada exatamente naquela posicao do modelo.

## Navegador

O projeto detecta Chrome, Chromium ou Edge automaticamente. Para indicar manualmente:

```env
PUPPETEER_EXECUTABLE_PATH=C:\caminho\ficticio\chrome.exe
```

Para reutilizar um navegador ja aberto, ele precisa ter sido iniciado com depuracao remota:

```powershell
& "C:\caminho\ficticio\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\pasta\ficticia\chrome-whatsapp"
```

Depois configure:

```env
BROWSER_URL=http://127.0.0.1:9222
```

Uma janela comum aberta sem depuracao remota nao pode ser controlada pelo Puppeteer.

## Sessoes

Sessoes independentes podem ser controladas por CLI ou GUI:

```powershell
node main.js --new-session Comercial --gui
node main.js --session Comercial --gui
node main.js --remove-session Comercial
```

Se houver multiplas sessoes e a CLI nao receber `--session`, o terminal solicita uma escolha. A GUI permite alternar ao vivo reiniciando o client, porque o perfil do WhatsApp precisa ser definido antes de abrir o WhatsApp Web.

## Ambiente

Variaveis opcionais comuns:

```env
MIN_DELAY_MS=8000
MAX_DELAY_MS=20000
MESSAGE_DIFF_THRESHOLD_PERCENT=10
RESEND_AFTER_HOURS=48
TEMPLATE_VARIANT_MIN_LENGTH=96
GUI_PORT=3137
WA_CLIENT_ID=campanha_teste
```

Se `GUI_PORT` estiver ocupada, a interface tenta automaticamente portas próximas, como `3138` e `3139`, e informa a URL efetiva no console.

## Atualizacao

Os inicializadores de atualizacao nao dependem de `git` nem de existir `.git` na pasta local. Eles consultam `https://github.com/JeanCarloEM/WhatSend`, baixam a release mais recente quando houver release publicada e, se nao houver release, baixam a branch `main`.

```powershell
.\atualizar.cmd
```

```bash
sh ./atualizar.sh
```

Durante a copia, arquivos operacionais locais sao preservados, incluindo `clientes.csv`, `texto.md`, `.env`, `logs/`, `.wwebjs_auth/`, `.runtime/` e `node_modules/`. Depois disso, o script roda `npm install` com download automatico do Puppeteer desativado e valida o navegador com `scripts/ensure-browser.js`.

## Validacao

Use:

```powershell
npm run check
npm run check:test
npm test
```

`npm run check` valida a campanha real e depende dos arquivos locais operacionais. `npm run check:test` usa fixtures versionadas em `test/check-clientes.csv` e `test/check-texto.md`, sem alterar `clientes.csv` nem `texto.md`.

Tambem e possivel informar paths especificos para a validacao:

```powershell
node main.js --check --check-csv test/check-clientes.csv --check-template test/check-texto.md
```

Os parametros `--check-csv` e `--check-template` sao aceitos apenas junto com `--check`. O caminho pode ser relativo ao diretorio atual ou absoluto. `npm test` usa fixtures em `test/` e nao deve alterar arquivos operacionais reais.
