# RCF - Requirements & Control Framework

## Projeto

Disparador Local de Mensagens WhatsApp.

## Objetivo

Realizar envio automatizado de mensagens personalizadas pelo WhatsApp Web,
usando um CSV local de destinatários e um template Markdown local, com operação
local, auditável e assistida por uma interface gráfica leve no navegador.

## Escopo

- Operação local e sob demanda.
- Sem uso da API Oficial da Meta.
- Comunicação externa somente com WhatsApp Web e URLs de anexos declaradas explicitamente no template.
- Sessão persistida localmente.
- Auditoria local em arquivos dentro de `./logs`.
- Compatibilidade com Windows, macOS e Linux quando Node.js, dependências e navegador Chromium compatível estiverem disponíveis.
- Entrada por CLI preservada para automação e entrada por GUI como experiência principal para uso assistido.

## Regras de Negócio

### RN001 - Origem dos Dados

Os destinatários devem ser carregados por padrão de `./clientes.csv`.

Opcionalmente, a execução pode receber um nome de lista sem extensão, fazendo os destinatários serem carregados de `./listas/NOME.csv`.

Se o parâmetro de lista contiver operadores de comparação ou funções lógicas, ele deve ser interpretado como filtro aplicado ao `./clientes.csv` padrão. Exemplos:

```text
coluna=valor
coluna!=valor
valor>=10,5 && status=ativo
($.isnum(valor) && valor>0) || $.istrue(vigente)
```

O nome da coluna do filtro deve ser insensível a maiúsculas e minúsculas. O filtro deve aceitar `=`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `^^`, `!`, parênteses, operações `+`, `-`, `*` e `/`, valores numéricos com `.` ou `,` decimal e funções `$.vazio()`, `$.isnum()`, `$.isfloat()`, `$.isint()`, `$.isbool()`, `$.istrue()` e `$.istring()`.

O CSV deve conter obrigatoriamente apenas as colunas `nome` e `telefone`. Colunas adicionais devem ficar disponíveis automaticamente como variáveis no template.

O carregamento do CSV deve aceitar codificações comuns em arquivos salvos por Excel, Bloco de Notas e planilhas, incluindo UTF-8 com ou sem BOM, UTF-16 e ANSI/Windows-1252, preservando acentuação, `ç` e símbolos compatíveis.

O parser deve inferir delimitadores comuns de arquivo e campo, incluindo vírgula, ponto e vírgula, tabulação e `|`, além de texto delimitado por aspas duplas ou simples.

### RN002 - Template de Mensagem

O template padrão deve ser carregado de `./texto.md`.

Opcionalmente, a execução pode receber um nome de modelo sem extensão, fazendo o template ser carregado de `./modelos/NOME.md`.

Quando a GUI fornecer conteúdo via textarea ou arquivo `.md`, esse conteúdo deve substituir o uso de `texto.md` somente naquela execução.

O conteúdo textual deve ser preservado conforme definido no arquivo, após substituição de variáveis e interpretação dos anexos Markdown.

Quebras de linha de Windows (`CRLF`), Linux/macOS (`LF`), `CR` isolado e separadores Unicode devem ser normalizados para `LF` antes do envio, por ser o formato mais estável para WhatsApp Web. Recuos, espaços e tabulações intencionais do texto devem ser preservados.

Entidades HTML numéricas e nomeadas comuns, como `&#x20;`, `&#32;`, `&nbsp;`, `&amp;`, `&lt;` e `&ccedil;`, devem ser convertidas para caracteres Unicode reais antes do envio e antes da interpretação de anexos. O WhatsApp não deve receber essas entidades cruas.

### RN003 - Variáveis do Template

Variáveis devem usar o padrão `${nome}`, `${telefone}`, `${conta}` ou qualquer outra coluna existente no CSV.

O nome da variável dentro de `${}` deve ser insensível a maiúsculas e minúsculas.

Dentro de `${...}`, também devem ser aceitas expressões matemáticas simples com colunas do CSV, por exemplo `${(valor+taxa)*2}`.

O marcador `$diatarde$` deve ser substituído no momento do envio por `bom dia` ou `boa tarde`. A partir das 12h, usar `boa tarde`; antes disso, `bom dia`. Se o marcador estiver no início da frase ou logo após ponto seguido de espaços, a primeira letra deve ser maiúscula.

Antes do envio efetivo, o sistema deve verificar potenciais erros de sintaxe no modelo, incluindo `${...}` aberto sem fechamento, expressão inválida dentro de `${...}`, `{...}` sem `$` e chave `}` solta. Quando houver aviso, a GUI deve exibir confirmação explícita e a CLI deve perguntar `sim` ou `não`, sem diferenciar maiúsculas/minúsculas ou acentuação. O padrão deve ser abortar.

Caso a coluna não exista:

- Não lançar exceção.
- Substituir por string vazia.
- Registrar aviso em `./logs/avisos.csv`.

### RN004 - Formatação do Nome

Ao aplicar `${nome}`, o valor deve ser formatado para mensagem:

- Capitalizar as palavras.
- Manter no máximo duas palavras.
- Preservar nomes compostos com hífen.

### RN005 - Recursos Markdown Textuais

O template pode conter recursos textuais do Markdown aceitos pelo WhatsApp, como listas, blockquote, itálico, destaque e emojis. O sistema não deve sanitizar ou reescrever esse conteúdo textual além das variáveis previstas e da conversão de entidades HTML para caracteres reais.

### RN006 - Anexos via Markdown

A notação `![](CAMINHO_OU_URL)` deve ser interpretada como anexo.

O caminho pode ser relativo ao diretório do template em uso, absoluto ou URL `http/https`.

Para caminhos relativos, com ou sem `./` ou `.\`, o diretório do template em uso deve ser a referência primária. Se o arquivo não existir nessa referência, o sistema deve tentar a raiz do projeto antes de falhar. Caminhos absolutos devem ser preservados como referência direta.

Arquivos locais inexistentes devem falhar na pré-validação. URLs devem ser baixadas para uma pasta temporária e reutilizadas quando a mesma URL aparecer novamente.

### RN007 - Ordem e Legenda de Anexos

Quando um anexo estiver no início ou no final do template, o texto adjacente deve ser enviado como legenda do próprio anexo sempre que compatível com o WhatsApp Web.

Quando o anexo estiver no meio do texto, o sistema deve preservar a ordem do template enviando as partes separadamente.

Imagens devem ser enviadas como mídia; outros arquivos, como PDF ou ZIP, devem ser enviados como documento.

Arquivos `.ogg` devem ser inspecionados. Se forem contêiner OGG apenas de áudio, devem ser enviados como mensagem de voz separada no ponto exato da notação Markdown, usando recurso de áudio/voz do WhatsApp Web, MIME `audio/ogg` e sem envio como documento. Nesses casos, não devem absorver texto adjacente como legenda.

### RN008 - Tratamento de Telefone

Antes de qualquer validação ou envio:

- Remover todos os caracteres não numéricos.
- Manter apenas dígitos.
- Adicionar o código do Brasil, `55`, quando ausente.

### RN009 - Validação de Existência no WhatsApp

Nenhuma mensagem deve ser enviada sem validação prévia do número via `client.getNumberId()`.

Números inexistentes ou inválidos devem ser registrados em log e não devem interromper o lote.

### RN010 - Prevenção Inteligente de Reenvio

O controle de envio deve usar `./logs/enviados.csv` e `./logs/mensagens.json`.

O sistema deve registrar telefone, hash do template nativo e data/hora.

Se a mensagem nativa atual for menos de 10% diferente de uma mensagem já enviada para o mesmo telefone dentro da janela configurada, o registro deve ser pulado.

Se a mensagem nativa atual diferir 10% ou mais, deve ser considerada nova e pode ser enviada sem força manual.

Se a mensagem similar tiver sido enviada há mais de 48 horas, por padrão, pode ser reenviada.

Os limites devem ser configuráveis via `MESSAGE_DIFF_THRESHOLD_PERCENT` e `RESEND_AFTER_HOURS`.

### RN011 - Forçar ou Limpar Histórico

Deve existir opção para reenviar ignorando o histórico:

```text
--force-resend
--reenviar
```

Deve existir opção para limpar o histórico de enviados:

```text
--clear-sent
--reset-sent
--reset-enviados
```

Essas opções não devem permitir envio para telefones inválidos ou números inexistentes no WhatsApp.

### RN012 - Continuidade Operacional

Em caso de interrupção inesperada, queda do sistema, perda de conexão ou reinicialização, a execução deve poder ser retomada sem reenviar mensagens ainda bloqueadas pelo histórico inteligente.

### RN013 - Isolamento de Falhas

Erros individuais devem ser registrados e não devem interromper o lote.

### RN014 - Controle de Velocidade

Deve existir intervalo aleatório entre envios, configurável por `MIN_DELAY_MS` e `MAX_DELAY_MS`.

Valores padrão:

```text
8000 ms
20000 ms
```

### RN015 - Persistência de Sessão

A autenticação do WhatsApp deve permanecer armazenada localmente em `./.wwebjs_auth`.

Deve ser possível isolar uma sessão alternativa por `WA_CLIENT_ID`.

Ao alternar, encerrar ou remover uma sessão em uso, o navegador controlado deve ser encerrado de forma graciosa antes de qualquer reinício ou exclusão do diretório de autenticação, aguardando tempo suficiente para que o perfil local seja gravado. Se o encerramento seguro não puder ser confirmado, a exclusão da sessão ativa deve ser cancelada para evitar corrupção ou perda parcial de autenticação.

### RN016 - Operação Local e Privacidade

Dados de clientes não devem ser transmitidos para sistemas terceiros, exceto para o próprio WhatsApp durante o envio e para URLs de anexos explicitamente declaradas no template.

O projeto deve declarar de forma clara que se destina a comunicação legítima, proporcional e consentida com clientes reais, assinantes, contatos que autorizaram contato ou públicos próprios e legítimos.

O projeto deve se posicionar expressamente contra uso massivo, abusivo, enganoso, invasivo, como spam, scraping, assédio, fraude, envio sem consentimento ou qualquer prática que viole leis, termos de serviço, privacidade ou direitos de terceiros.

### RN017 - Integridade dos Dados de Entrada

O sistema não deve alterar `clientes.csv` nem `texto.md` durante validação ou envio.

### RN018 - Auditoria

Todo resultado deve possuir rastreabilidade local.

Arquivos mínimos:

```text
./logs/enviados.csv
./logs/erros.csv
./logs/pulos.csv
./logs/avisos.csv
./logs/mensagens.json
```

### RN019 - Saída de Console

O console deve exibir status compacto e legível, com progresso, enviados, pulos, erros e avisos. Quando suportado pelo terminal, deve usar cores e atualizar a linha de progresso sem inundar a tela.

Todo pulo deve apresentar motivo claro.

### RN020 - Pré-Validação Segura

O comando de checagem deve validar arquivos, estrutura de logs, template, anexos locais, sessão e navegador antes de qualquer envio:

```text
npm run check
```

Para validação automatizada e CI, deve existir modo de checagem com fixtures versionadas, sem depender de `clientes.csv` e `texto.md` reais:

```text
npm run check:test
node main.js --check --check-csv CAMINHO.csv --check-template CAMINHO.md
```

Os parâmetros `--check-csv` e `--check-template` devem aceitar paths relativos ou absolutos somente quando usados junto com `--check`.

Em caso de falha, o processamento deve ser interrompido antes do primeiro envio.

### RN021 - Navegador Compatível

O sistema deve usar navegador Chromium compatível, detectando automaticamente Chrome, Chromium ou Edge em Windows, macOS e Linux, ou aceitando configuração manual por `PUPPETEER_EXECUTABLE_PATH` e `CHROME_EXECUTABLE_PATH`.

Quando o navegador já estiver aberto, só deve ser reutilizado se tiver sido iniciado com depuração remota e informado por `BROWSER_URL`, `BROWSER_WS_ENDPOINT` ou `CONNECT_EXISTING_BROWSER`.

### RN022 - Interface Gráfica Local

Deve existir uma camada de UX no navegador para coletar parâmetros antes fornecidos por CLI, preservando compatibilidade funcional com o fluxo atual.

A GUI deve ser servida por servidor HTTP leve local, sem transmitir dados para serviços terceiros.

A interface local deve ser iniciada no começo do fluxo para exibir status de autenticação e carregamento do WhatsApp. O envio só pode ser liberado após o WhatsApp ficar pronto.

Quando possível, a GUI deve ser aberta como aba no mesmo navegador controlado pelo WhatsApp Web. Se o navegador controlado ainda não estiver disponível ou não permitir nova aba, a GUI pode ser aberta no navegador padrão, registrando esse fallback de forma clara.

Ao selecionar um arquivo `.md`, a GUI deve executar pré-análise assíncrona dos anexos locais referenciados no modelo, sem iniciar envio e sem bloquear a interface. Se algum anexo não for localizado, a tela deve exibir aviso curto em vermelho próximo ao seletor do arquivo e disponibilizar campo para informar a pasta local de referência dos anexos. Essa pasta deve ser validada como diretório local existente antes da execução.

Se a porta local configurada para a GUI estiver ocupada, o servidor deve tentar automaticamente portas próximas antes de falhar, registrando a porta efetivamente usada.

A GUI deve oferecer:

- Modelo por textarea.
- Modelo por arquivo `.md`.
- Bloqueio quando textarea e arquivo forem usados simultaneamente.
- Campo de filtro.
- Arquivo `.csv` opcional de clientes.
- Opções de reenviar ignorando histórico e limpar histórico.
- Validações locais leves antes do envio.
- Mensagens claras de erro e progresso.
- Tipografia baseada em Noto Sans, com fallbacks sans-serif comuns do sistema.
- Demonstração visual concisa da marcação textual crua e do resultado esperado.
- Lista recolhível e equilibrada com exatamente 60 sugestões profissionais de emojis.

Arquivos informados na GUI devem ser materializados temporariamente em área controlada pelo projeto ou sistema operacional, sem alterar `clientes.csv`, `texto.md` ou os modelos originais.

### RN023 - Scripts de Inicialização

Devem existir scripts de inicialização compatíveis com os sistemas operacionais suportados.

Os scripts devem detectar ambiente, verificar dependências, instalar apenas o que estiver ausente e iniciar o fluxo da aplicação.

Quando Node.js estiver ausente, o script deve orientar ou tentar instalação automática por gerenciador de pacotes disponível na plataforma. Quando a instalação automática não for compatível com o ambiente, deve falhar com instrução clara.

Os scripts devem verificar navegador compatível. Se Chrome, Edge ou Chromium não forem encontrados, devem tentar instalar automaticamente um Chrome compatível via instalador do Puppeteer.

Durante a instalação automática de dependências pelos scripts de inicialização, o download implícito de navegador pelo postinstall do Puppeteer deve ser desativado. A instalação ou validação de navegador deve ocorrer somente na etapa explícita de verificação de navegador, para evitar falhas por cache parcial, ambiente sem permissão ou divergência entre dependências e navegador local.

### RN024 - Sessões de WhatsApp

O sistema deve suportar múltiplas sessões independentes de WhatsApp por `LocalAuth`, com nome amigável, persistência local e seleção por `--session` ou pela GUI.

Quando houver apenas uma sessão, ela deve ser selecionada automaticamente. Quando houver múltiplas sessões e nenhuma for informada na CLI, deve ser exibido menu obrigatório. Identificação por nome deve ser insensível a maiúsculas/minúsculas; identificação por telefone pode usar os últimos dígitos desde que o resultado seja único.

Sessões nomeadas devem usar logs separados em `./logs/sessions/NOME_DA_SESSAO/`. A sessão padrão preserva os logs legados em `./logs/`.

A GUI deve permitir criar, renomear, alternar e remover sessões. A remoção pela GUI deve permitir escolher qualquer sessão existente, inclusive sessão não ativa ou ainda não autenticada, sem exigir alternância prévia para ela. Como a sessão do WhatsApp é definida na inicialização do `LocalAuth`, alternar, criar ou remover a sessão ativa pela GUI pode reiniciar automaticamente o processo, fechar o navegador controlado atual e reabrir a interface na sessão escolhida. Se a última sessão persistida for removida, a próxima abertura deve retornar ao fluxo inicial de autenticação.

### RN025 - Múltiplos Modelos

Um template pode conter múltiplos modelos separados por linha contendo ao menos três caracteres `^`, com espaços ou tabulações opcionais.

O separador só é válido se existir texto antes e depois dele e se todos os blocos, após `trim()`, possuírem tamanho mínimo configurável por `TEMPLATE_VARIANT_MIN_LENGTH`, padrão `96`.

Quando houver múltiplos modelos válidos, a distribuição deve ser circular entre destinatários. Quando houver apenas um modelo válido, o comportamento permanece igual ao fluxo anterior.

### RN026 - Cálculos e Formatação

Resultados numéricos em `${...}` devem usar padrão brasileiro: inteiros sem casas decimais; decimais arredondados para 2 casas e separador `,`.

O mecanismo de expressões deve oferecer as funções `$.round()`, `$.ceil()`, `$.floor()`, `$.int()`, `$.moeda()`, `$.digito1()`, `$.digito2()`, `$.numero()` e `$.decimal()`, aceitando colunas, números formatados, expressões e funções aninhadas.

### RN027 - Atualização

Devem existir scripts de atualização no root para Windows e macOS/Linux.

A atualização não deve depender da existência de `git` nem de diretório local `./.git`.

O atualizador deve consultar `https://github.com/JeanCarloEM/WhatSend`, baixar a release mais recente quando houver release publicada e, se não houver release, baixar a branch `main`.

Arquivos operacionais locais devem ser preservados durante a atualização, incluindo `clientes.csv`, `texto.md`, `.env`, logs, sessões do WhatsApp, runtime local e `node_modules`.

Depois de atualizar os arquivos do projeto, o atualizador deve sincronizar dependências npm e revalidar navegador compatível.

### RN028 - Integração Contínua

Quando o projeto estiver hospedado no GitHub, deve existir workflow de CI para push e pull request.

Todos os jobs do workflow devem possuir `timeout-minutes` explícito de no máximo 5 minutos.

O workflow deve executar testes, checagem RCF com fixtures, geração de `./dist`, validação do `./dist` e publicação do diretório `dist/` como artefato da execução.

### RN029 - Reutilização de Instância Local

Ao iniciar a GUI, o sistema deve registrar em diretório temporário do sistema operacional a instância ativa por contexto de execução, incluindo PID, porta, URL local, sessão/perfil do WhatsApp, data de início e assinatura dos scripts de execução.

Uma nova abertura da GUI para o mesmo contexto deve verificar se a instância registrada ainda está ativa, responde como a mesma aplicação e usa a mesma sessão. Se os scripts não tiverem mudado desde o registro, a nova execução deve reutilizar a instância existente e apenas reabrir a URL da interface local, preservando a sessão autenticada do WhatsApp.

Se os scripts tiverem mudado, a nova execução deve encerrar a instância registrada e seus processos filhos quando possível, removendo o registro temporário antes de iniciar uma nova instância.

### RN030 - Release Distribuível

O comando `npm run build:dist` deve gerar `./dist` de forma limpa, reproduzível e funcional, removendo conteúdo anterior antes de recriar a release.

A release deve incluir somente arquivos necessários à execução e documentação: `LICENSE`, `README*`, `RCF.md`, `docs/`, `main.js`, `src/`, `scripts/`, inicializadores, `package.json`, `package-lock.json`, arquivos `.env.*` não sensíveis e arquivos de configuração/formatação explicitamente permitidos.

Arquivos JavaScript distribuídos devem ser minificados por biblioteca Open Source mantida. Documentação, arquivos de configuração, scripts shell/batch e formatos em que a minificação possa alterar semântica não devem ser minificados.

Quando um arquivo minificado possuir cabeçalho inicial de licença, copyright, autoria, atribuição, disclaimer ou aviso legal equivalente, esse cabeçalho deve ser preservado integralmente no início do arquivo distribuído, sem minificação, reformatação ou alteração. A minificação deve ser aplicada somente ao restante do conteúdo.

A release não deve incluir `node_modules/`, `.git/`, diretórios iniciados por `.`, `AGENTS.md`, testes, caches, logs com conteúdo, sessões, `.wwebjs_sessions.json`, `.env` real ou qualquer arquivo operacional/sensível.

Os arquivos operacionais `clientes.csv` e `texto.md` localizados na raiz do projeto nunca devem ser copiados para a raiz de `./dist`. Essa regra deve proteger os arquivos reais do usuário sem bloquear automaticamente arquivos homônimos em outros diretórios que sejam necessários à documentação, testes internos de empacotamento ou funcionamento distribuível.

Os diretórios operacionais `logs/`, `modelos/` e `listas/` devem existir na release apenas como diretórios vazios de topo, sem copiar arquivos nem subdiretórios do ambiente local.

O comando `npm run build:dist` deve validar ao final da geração que cabeçalhos legais foram preservados e que `clientes.csv` e `texto.md` da raiz não foram incluídos. O comando `npm run validate:dist` deve validar a estrutura final, ausência de arquivos sensíveis, preservação de cabeçalhos legais e funcionamento da aplicação usando uma cópia temporária do conteúdo de `./dist`, com dependências instaladas a partir do próprio `package-lock.json` distribuído.

## Requisitos Não Funcionais

### RNF001 - Plataforma

Compatível com Windows, macOS e Linux, desde que Node.js LTS, dependências e navegador Chromium compatível estejam disponíveis.

### RNF002 - Execução

Compatível com Node.js LTS e CommonJS.

### RNF003 - Offline Parcial

Operação offline para leitura, validação, renderização do template e logs, exceto comunicação com WhatsApp Web e download de anexos remotos.

### RNF004 - Escala

Suportar lotes grandes com processamento independente por destinatário.

### RNF005 - Manutenibilidade

As regras críticas devem possuir cobertura automatizada por `node:test`.

### RNF006 - Extensibilidade

O desenho deve permitir evolução futura para múltiplos templates, campanhas, anexos avançados, agendamento e dry-run.

### RNF007 - UX

A interface deve ser simples, responsiva, minimalista, clara e suficiente para usuários com familiaridade básica com fórmulas, planilhas ou programação leve.

Microajustes visuais devem preservar contraste, espaçamento consistente, leitura clara e visual profissional, sem transformar a GUI em landing page.
