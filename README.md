# Disparador Local de Mensagens WhatsApp

Aplicativo local em Node.js para enviar mensagens personalizadas pelo WhatsApp Web usando:

- `clientes.csv` como base de destinatários.
- `texto.md` como modelo da mensagem.
- interface gráfica local no navegador para configurar a execução.
- sessão local persistida em `.wwebjs_auth`.
- logs locais em `logs/`.

O envio só acontece depois da pré-validação dos arquivos e da validação do número no WhatsApp via `client.getNumberId()`.

Todos os nomes, telefones, contas e caminhos abaixo são meramente ilustrativos.

## RCF Implementado

O contrato funcional completo está em [RCF.md](RCF.md). Em resumo, o projeto:

- usa `clientes.csv` e `texto.md`, ou arquivos em `listas/` e `modelos/`, como entradas da campanha;
- oferece GUI local para coletar modelo, CSV, filtro e opções de execução;
- valida CSV, template, logs, anexos locais, sessão e navegador antes de enviar;
- substitui variáveis `${coluna}` a partir das colunas do CSV sem diferenciar maiúsculas e minúsculas;
- permite expressões matemáticas simples dentro de `${...}`;
- exige apenas `nome` e `telefone`; outras colunas são opcionais;
- formata `${nome}` com capitalização e no máximo duas palavras;
- permite filtros de lista com comparadores, operadores lógicos, funções e matemática;
- substitui `$diatarde$` por `bom dia` ou `boa tarde` conforme o horário do envio;
- interpreta `![](CAMINHO_OU_URL)` como anexo local ou remoto;
- baixa anexos remotos uma única vez para cache temporário;
- envia anexos no início ou final com o texto como legenda quando possível;
- envia `.ogg` de áudio como mensagem de voz separada;
- valida o número no WhatsApp com `client.getNumberId()` antes do envio;
- evita reenvio com base no telefone, versão nativa da mensagem e prazo configurável;
- permite forçar reenvio ou limpar histórico sem burlar validação de telefone;
- registra enviados, erros, pulos, avisos e versões de mensagem em `logs/`;
- mantém status compacto e colorido no console durante o processamento;
- permite sessão alternativa por `WA_CLIENT_ID`;
- permite conectar a navegador já aberto quando ele foi iniciado com depuração remota;
- roda em Windows, macOS e Linux quando há Node.js LTS e navegador Chromium compatível.

## Requisitos

- Windows, macOS ou Linux.
- Node.js LTS.
- Google Chrome, Chromium ou Microsoft Edge instalado.
- WhatsApp ativo no celular para escanear o QR Code na primeira execução.

As dependências usadas pelo projeto (`csv-parse`, `dotenv`, `qrcode-terminal`, `puppeteer-core` e `whatsapp-web.js`) são bibliotecas Node compatíveis com as principais plataformas. A automação do WhatsApp Web depende de um navegador Chromium compatível disponível no sistema.

## Instalação

### Modo recomendado

```powershell
cd C:\caminho\do\projeto
.\start.cmd
```

Em macOS/Linux:

```bash
cd /caminho/do/projeto
sh ./start.sh
```

Esses scripts verificam Node.js e npm, tentam instalar Node.js LTS quando ele estiver ausente, instalam dependências do projeto apenas quando necessário e iniciam a interface gráfica.

Eles também verificam Chrome, Chromium ou Edge. Se nenhum navegador compatível for encontrado, tentam instalar automaticamente um Chrome compatível via Puppeteer.

### Instalação manual

Na pasta do projeto:

```powershell
npm install
```

Valide a instalação sem iniciar envio:

```powershell
npm run check
```

Se estiver tudo certo, a saída será parecida com:

```text
Pré-validação RCF concluída. Clientes: 1.
```

## Arquivos de Configuração

### `clientes.csv`

O arquivo deve existir na raiz do projeto e conter obrigatoriamente apenas as colunas `nome` e `telefone`:

```csv
nome,telefone
Pessoa Exemplo,11999999999
```

Colunas extras também podem ser usadas no template. Exemplo:

```csv
nome,telefone,conta,agencia
Pessoa Exemplo,11999999999,00000,0001
```

Os nomes das colunas obrigatórias são insensíveis a maiúsculas e minúsculas. Assim, `Nome` e `Telefone` também são aceitos.

Quando `${nome}` for usado na mensagem, o sistema formata o valor automaticamente:

- `pessoa exemplo` vira `Pessoa Exemplo`.
- `pessoa exemplo sobrenome extra` vira `Pessoa Exemplo`.

### `texto.md`

O arquivo deve existir na raiz do projeto e contém a mensagem enviada.

Variáveis usam o formato `${nome}`, `${telefone}`, `${conta}` ou qualquer outra coluna do CSV:

```markdown
Boa tarde ${nome}!

Relativo à sua conta ${conta}, podemos falar agora?
```

O nome da variável dentro de `${}` é insensível a maiúsculas e minúsculas. Assim, `${nome}`, `${NOME}` e `${NoMe}` usam a mesma coluna `nome`.

Se uma variável não existir no CSV, ela será substituída por vazio e registrada em `logs/avisos.csv`.

Também é possível usar conta simples dentro de `${...}`. As colunas são resolvidas sem diferenciar maiúsculas e minúsculas:

```markdown
Valor atualizado: ${(valor+taxa)*2}
Saldo estimado: ${(credito-debito)/parcelas}
```

As operações aceitas são `+`, `-`, `*`, `/` e parênteses. Números podem usar `.` ou `,` como separador decimal.

Resultados decimais calculados são formatados no padrão brasileiro, com arredondamento para 2 casas:

```markdown
${10 / 3}
${100 * 0.157}
${$.moeda(1000 * 1.15)}
${$.decimal(valor)}
${$.numero(quantidade)}
${$.digito2(conta)}
```

Funções disponíveis: `$.round()`, `$.ceil()`, `$.floor()`, `$.int()`, `$.moeda()`, `$.digito1()`, `$.digito2()`, `$.numero()` e `$.decimal()`.

O marcador `$diatarde$` é substituído no momento do envio:

- antes das 12h: `bom dia`;
- a partir das 12h: `boa tarde`.

Se o marcador estiver no início da frase ou logo após um ponto, mesmo com espaços no meio, o texto começa com maiúscula:

```markdown
$diatarde$, ${NOME}!

Retornamos sobre a conta ${CONTA}. $diatarde$, podemos seguir?
```

Exemplo completo e genérico de `texto.md`:

```markdown
![](./teste-img.png)
Olá ${nome}! Tudo bem? 👋

Este é um modelo genérico para demonstrar os recursos aceitos no `texto.md`.

Aqui você pode usar variáveis do CSV, como:

- Nome: ${nome}
- Telefone: ${telefone}
- Conta ou referência: ${conta}

Você também pode destacar uma informação com *texto em destaque* e usar _texto em itálico_ quando quiser dar outro tom à mensagem.

> Dica: revise os dados antes do envio e rode `npm run check` para validar a campanha.

Exemplo de próximos passos:

1. Conferir as informações principais ✅
2. Responder esta mensagem se houver interesse 💬
3. Ignorar caso o assunto não seja relevante 🙂

Obrigado, ${nome}!
```

Anexos podem ser indicados com a notação Markdown:

```markdown
Segue a imagem:

![](anexos/exemplo.png)

Segue também o documento:

![](C:\caminho\ficticio\arquivo.pdf)

Arquivo remoto:

![](https://exemplo.invalid/arquivo.zip)
```

O caminho pode ser relativo ao arquivo de mensagem em uso, absoluto ou uma URL `http`/`https`. URLs são baixadas para uma pasta temporária e reutilizadas quando o mesmo endereço aparecer novamente. Imagens são enviadas como mídia; outros tipos, como PDF ou ZIP, são enviados como documento.

Arquivos `.ogg` são inspecionados. Quando o arquivo for um contêiner OGG apenas de áudio, como Opus ou Vorbis, ele será enviado como mensagem de voz separada no ponto exato em que apareceu no Markdown:

```markdown
Texto antes do áudio.

![](audios/exemplo.ogg)

Texto depois do áudio.
```

Nesse caso, o `.ogg` não absorve o texto adjacente como legenda. Se o `.ogg` não for identificado como apenas áudio, ele segue como anexo comum.

Se o anexo estiver no início ou no final do `texto.md`, o texto adjacente será enviado como legenda do próprio anexo, evitando uma mensagem de texto separada:

```markdown
Mensagem enviada como legenda do anexo.

![](anexos/exemplo.pdf)
```

Quando o anexo estiver no meio do texto, o sistema envia as partes separadamente para preservar a ordem definida no arquivo.

### Modelos em `modelos/`

Por padrão, o sistema usa `texto.md`. Também é possível escolher outro arquivo Markdown dentro de `modelos/`, passando apenas o nome sem extensão:

```powershell
node main.js faturamento
```

Com `npm start`, passe o argumento depois de `--`:

```powershell
npm start -- faturamento
```

Esse comando usa:

```text
modelos/faturamento.md
```

As mesmas regras de `texto.md` se aplicam ao modelo selecionado: variáveis, `$diatarde$`, anexos, URLs, logs e controle inteligente de reenvio. Quando o modelo usar `./` ou `.\` em anexos, o caminho é resolvido a partir da pasta onde o próprio modelo está.

Um mesmo arquivo também pode conter múltiplos modelos separados por uma linha com `^^^`. Quando todos os blocos tiverem tamanho mínimo válido, o envio usa distribuição circular entre os destinatários.

```markdown
Texto modelo A com pelo menos o tamanho mínimo configurado.

^^^

Texto modelo B com pelo menos o tamanho mínimo configurado.
```

O tamanho mínimo padrão de cada bloco é `96` caracteres e pode ser alterado por `TEMPLATE_VARIANT_MIN_LENGTH`.

### Listas em `listas/`

Por padrão, o sistema usa `clientes.csv`. Também é possível escolher outro CSV dentro de `listas/`, passando apenas o nome sem extensão:

```powershell
node main.js --lista base_exemplo
```

Esse comando usa:

```text
listas/base_exemplo.csv
```

Também é possível combinar modelo e lista:

```powershell
node main.js faturamento base_exemplo
```

Se o valor da lista contiver um filtro, ele será aplicado sobre o `clientes.csv` padrão, não tratado como arquivo:

```powershell
node main.js --lista "status=ativo"
node main.js faturamento "status!=inativo"
node main.js --lista "valor>=10,5 && status=ativo"
node main.js --lista "($.isnum(valor) && valor>0) || $.istrue(vigente)"
```

O nome da coluna é insensível a maiúsculas e minúsculas. O valor comparado é tratado automaticamente como texto, número ou booleano quando possível. Aspas ao redor do filtro inteiro ou das partes são aceitas, por exemplo:

```powershell
node main.js --lista '"STATUS"="ativo"'
```

Comparadores aceitos:

```text
=  !=  <  <=  >  >=
```

Operadores lógicos aceitos:

```text
&&  ||  ^^  !
```

Também são aceitos parênteses e operações matemáticas simples:

```powershell
node main.js --lista "(valor+taxa*2)>=100 && !(status=cancelado)"
```

Funções lógicas disponíveis:

```text
$.vazio(coluna)
$.isnum(coluna)
$.isfloat(coluna)
$.isint(coluna)
$.isbool(coluna)
$.istrue(coluna)
$.istring(coluna)
```

Valores booleanos são reconhecidos sem diferenciar maiúsculas, minúsculas ou acentos quando aplicável. Exemplos aceitos incluem `sim`, `não`, `true`, `false`, `1`, `0`, `ativo`, `inativo`, `habilitado`, `desabilitado`, `aprovado`, `reprovado`, `vigente`, `cancelado`, `suspenso`, `inapto`, `vencido`, `valido`, `válido` e `inválido`.

### `.env` opcional

O projeto tenta encontrar automaticamente Chrome, Chromium ou Edge no Windows, macOS e Linux. Se precisar indicar o navegador manualmente, crie um arquivo `.env`:

```env
PUPPETEER_EXECUTABLE_PATH=C:\caminho\para\chrome.exe
```

Exemplos ilustrativos por sistema:

```env
# Windows
PUPPETEER_EXECUTABLE_PATH=C:\caminho\para\chrome.exe

# macOS
PUPPETEER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# Linux
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

Também é possível ajustar o intervalo aleatório entre envios:

```env
MIN_DELAY_MS=8000
MAX_DELAY_MS=20000
```

Também é possível ajustar a regra inteligente de reenvio:

```env
MESSAGE_DIFF_THRESHOLD_PERCENT=10
RESEND_AFTER_HOURS=48
```

Por padrão, se o `texto.md` nativo mudar 10% ou mais em relação à versão já enviada para um telefone, o sistema considera uma nova mensagem e permite o envio. Se a mensagem for igual ou muito parecida, ela também pode ser reenviada automaticamente depois de 48 horas.

### Navegador já aberto

Se aparecer uma mensagem parecida com:

```text
The browser is already running for .wwebjs_auth\session. Use a different userDataDir or stop the running browser first.
```

isso significa que o perfil local salvo em `.wwebjs_auth/session` já está aberto por outro navegador. Há três caminhos:

1. Feche a janela aberta pelo disparador e rode `npm start` novamente.
2. Use uma sessão separada, que pode pedir novo QR Code:

```env
WA_CLIENT_ID=campanha_teste
```

3. Reutilize um navegador já aberto somente se ele tiver sido iniciado com depuração remota.

Exemplo ilustrativo no Windows:

```powershell
& "C:\caminho\para\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\pasta\chrome-whatsapp"
```

Exemplo ilustrativo em macOS/Linux:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="/caminho/chrome-whatsapp"
```

Para manter o WhatsApp autenticado nesse modo, reutilize a mesma pasta informada em `--user-data-dir` nas próximas execuções.

Depois configure:

```env
BROWSER_URL=http://127.0.0.1:9222
```

Também é aceito:

```env
BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/exemplo
```

Atalho opcional para usar `http://127.0.0.1:9222`:

```env
CONNECT_EXISTING_BROWSER=true
```

Uma janela comum do Chrome, Chromium ou Edge aberta sem depuração remota não pode ser controlada pelo Puppeteer.

## Sessões

A sessão padrão continua funcionando sem configuração. Para criar uma sessão nova:

```powershell
node main.js --new-session Comercial --gui
```

Para escolher uma sessão:

```powershell
node main.js --session Comercial --gui
node main.js --session 1234 --gui
```

Se houver múltiplas sessões e nenhuma for informada, a CLI mostra um menu obrigatório. Sessões nomeadas usam logs em `logs/sessions/NOME/`; a sessão padrão mantém `logs/`.

Na GUI, o seletor de sessão permite alternar entre sessões existentes. A troca reinicia automaticamente o client do WhatsApp e reabre a interface na sessão escolhida, pois o perfil do `LocalAuth` é definido antes de abrir o WhatsApp Web. Também é possível criar e renomear sessões diretamente pela tela.

Para renomear:

```powershell
node main.js --rename-session Comercial Financeiro
```

## Execução

Faça uma validação antes de enviar:

```powershell
npm run check
```

### Interface gráfica

Inicie o fluxo assistido:

```powershell
npm run start:gui
```

Ou use os inicializadores:

```powershell
.\start.cmd
```

Em macOS/Linux:

```bash
sh ./start.sh
```

A interface local sobe no início do fluxo e tenta abrir como uma aba no mesmo navegador controlado pelo WhatsApp Web. Se isso não for possível, ela abre no navegador padrão e informa o fallback no andamento.

A tela mostra o status de carregamento/autenticação do WhatsApp e só libera o botão "Executar" depois que o WhatsApp estiver conectado. Nela é possível configurar:

- modelo por textarea;
- modelo por arquivo `.md`;
- filtro;
- CSV opcional de clientes;
- reenvio forçado;
- limpeza do histórico de enviados.

Textarea e arquivo `.md` são mutuamente exclusivos. A tela faz validações leves antes de enviar os dados ao backend local, e o backend reaproveita a mesma pré-validação RCF antes do primeiro envio.

Quando um modelo for informado pela GUI, ele substitui `texto.md` apenas naquela execução. Caminhos relativos de anexos digitados na tela são resolvidos a partir da raiz do projeto.

### Linha de comando

O modo CLI continua disponível para automação:

```powershell
npm start
```

Na primeira execução, escaneie o QR Code exibido no terminal. Depois disso, a sessão fica salva em `.wwebjs_auth`.

Durante o envio, o console exibe uma linha de status compacta com progresso, enviados, pulados, erros e avisos. A linha é atualizada no lugar para evitar excesso de mensagens na tela.

Quando um registro é pulado, o console mostra o motivo. O caso mais comum é o telefone já existir em `logs/enviados.csv`.

### Comandos

| Comando | Função |
| --- | --- |
| `.\start.cmd` | Prepara dependências e inicia a GUI no Windows. |
| `sh ./start.sh` | Prepara dependências e inicia a GUI no macOS/Linux. |
| `npm run start:gui` | Autentica e abre a interface gráfica local. |
| `npm run browser:ensure` | Verifica navegador compatível e instala Chrome via Puppeteer se necessário. |
| `npm start` | Valida e inicia o envio via CLI. |
| `npm start -- faturamento` | Usa `modelos/faturamento.md` no lugar de `texto.md`. |
| `node main.js --lista base_exemplo` | Usa `listas/base_exemplo.csv` no lugar de `clientes.csv`. |
| `node main.js faturamento base_exemplo` | Usa modelo e lista nomeados. |
| `node main.js --lista "status=ativo"` | Usa `clientes.csv` filtrando a coluna `status`. |
| `node main.js --lista "valor>=10 && status=ativo"` | Usa filtro composto sobre `clientes.csv`. |
| `npm run check` | Valida arquivos e configuração sem enviar. |
| `node main.js --check faturamento` | Valida `modelos/faturamento.md` sem enviar. |
| `npm test` | Roda a suíte automatizada. |
| `npm run start:force` | Reenvia ignorando o histórico de enviados. |
| `npm run start:clear` | Limpa `logs/enviados.csv` antes de iniciar. |
| `npm run sent:clear` | Alias para limpar enviados. |
| `npm run start:reset` | Alias legado para limpar enviados. |
| `.\atualizar.cmd` | Atualiza repositório, dependências e navegador no Windows. |
| `sh ./atualizar.sh` | Atualiza repositório, dependências e navegador no macOS/Linux. |

Para reenviar mesmo quando o telefone consta como enviado:

```powershell
npm run start:force
```

Alias em português:

```powershell
node main.js --reenviar
```

Para limpar a lista de enviados antes de iniciar uma nova campanha:

```powershell
npm run start:clear
```

Também existem os aliases:

```powershell
npm run sent:clear
npm run start:reset
```

Alias em português:

```powershell
node main.js --reset-enviados
```

O sistema também evita reenvio de forma inteligente:

- se a mesma mensagem, ou uma mensagem menos de 10% diferente, foi enviada para o telefone há menos de 48 horas, ele pula;
- se o arquivo de mensagem em uso mudou 10% ou mais, ele considera uma mensagem nova e envia sem precisar forçar;
- se passaram mais de 48 horas, ele permite reenviar mesmo que a mensagem seja igual.

Esses limites podem ser ajustados no `.env`. Telefones inválidos ou números não encontrados no WhatsApp continuam sem envio.

## Logs

Os logs ficam em `logs/`:

- `enviados.csv`: números já enviados, usado para evitar duplicidade.
- `erros.csv`: falhas de envio, números inválidos ou números sem WhatsApp.
- `mensagens.json`: cache local das versões nativas dos arquivos de mensagem usadas para comparar mudanças.
- `pulos.csv`: registros pulados com o motivo.
- `avisos.csv`: avisos, como variáveis ausentes no template.

Se a execução for interrompida, rode `npm start` novamente. O sistema consulta `logs/enviados.csv` e `logs/mensagens.json` para decidir se deve pular, reenviar por mudança de conteúdo ou reenviar por expiração do prazo.

## Testes

Para rodar os testes automatizados:

```powershell
npm test
```

Os testes verificam regras centrais do RCF, incluindo normalização de telefone, CSV obrigatório, deduplicação, validação antes do envio e logs.
