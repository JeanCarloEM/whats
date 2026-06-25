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

### RN002 - Template de Mensagem

O template padrão deve ser carregado de `./texto.md`.

Opcionalmente, a execução pode receber um nome de modelo sem extensão, fazendo o template ser carregado de `./modelos/NOME.md`.

Quando a GUI fornecer conteúdo via textarea ou arquivo `.md`, esse conteúdo deve substituir o uso de `texto.md` somente naquela execução.

O conteúdo textual deve ser preservado conforme definido no arquivo, após substituição de variáveis e interpretação dos anexos Markdown.

### RN003 - Variáveis do Template

Variáveis devem usar o padrão `${nome}`, `${telefone}`, `${conta}` ou qualquer outra coluna existente no CSV.

O nome da variável dentro de `${}` deve ser insensível a maiúsculas e minúsculas.

Dentro de `${...}`, também devem ser aceitas expressões matemáticas simples com colunas do CSV, por exemplo `${(valor+taxa)*2}`.

O marcador `$diatarde$` deve ser substituído no momento do envio por `bom dia` ou `boa tarde`. A partir das 12h, usar `boa tarde`; antes disso, `bom dia`. Se o marcador estiver no início da frase ou logo após ponto seguido de espaços, a primeira letra deve ser maiúscula.

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

O template pode conter recursos textuais do Markdown aceitos pelo WhatsApp, como listas, blockquote, itálico, destaque e emojis. O sistema não deve sanitizar ou reescrever esse conteúdo textual além das variáveis previstas.

### RN006 - Anexos via Markdown

A notação `![](CAMINHO_OU_URL)` deve ser interpretada como anexo.

O caminho pode ser relativo ao diretório do template em uso, absoluto ou URL `http/https`.

Arquivos locais inexistentes devem falhar na pré-validação. URLs devem ser baixadas para uma pasta temporária e reutilizadas quando a mesma URL aparecer novamente.

### RN007 - Ordem e Legenda de Anexos

Quando um anexo estiver no início ou no final do template, o texto adjacente deve ser enviado como legenda do próprio anexo sempre que compatível com o WhatsApp Web.

Quando o anexo estiver no meio do texto, o sistema deve preservar a ordem do template enviando as partes separadamente.

Imagens devem ser enviadas como mídia; outros arquivos, como PDF ou ZIP, devem ser enviados como documento.

Arquivos `.ogg` devem ser inspecionados. Se forem contêiner OGG apenas de áudio, devem ser enviados como mensagem de voz separada no ponto exato da notação Markdown, usando recurso de áudio/voz do WhatsApp Web. Nesses casos, não devem absorver texto adjacente como legenda.

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

### RN016 - Operação Local e Privacidade

Dados de clientes não devem ser transmitidos para sistemas terceiros, exceto para o próprio WhatsApp durante o envio e para URLs de anexos explicitamente declaradas no template.

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

Em caso de falha, o processamento deve ser interrompido antes do primeiro envio.

### RN021 - Navegador Compatível

O sistema deve usar navegador Chromium compatível, detectando automaticamente Chrome, Chromium ou Edge em Windows, macOS e Linux, ou aceitando configuração manual por `PUPPETEER_EXECUTABLE_PATH` e `CHROME_EXECUTABLE_PATH`.

Quando o navegador já estiver aberto, só deve ser reutilizado se tiver sido iniciado com depuração remota e informado por `BROWSER_URL`, `BROWSER_WS_ENDPOINT` ou `CONNECT_EXISTING_BROWSER`.

### RN022 - Interface Gráfica Local

Deve existir uma camada de UX no navegador para coletar parâmetros antes fornecidos por CLI, preservando compatibilidade funcional com o fluxo atual.

A GUI deve ser servida por servidor HTTP leve local, sem transmitir dados para serviços terceiros.

A autenticação do WhatsApp deve ocorrer primeiro. Após a conexão bem-sucedida, a aplicação deve abrir uma página local para seleção dos parâmetros de envio.

A GUI deve oferecer:

- Modelo por textarea.
- Modelo por arquivo `.md`.
- Bloqueio quando textarea e arquivo forem usados simultaneamente.
- Campo de filtro.
- Arquivo `.csv` opcional de clientes.
- Opções de reenviar ignorando histórico e limpar histórico.
- Validações locais leves antes do envio.
- Mensagens claras de erro e progresso.

Arquivos informados na GUI devem ser materializados temporariamente em área controlada pelo projeto ou sistema operacional, sem alterar `clientes.csv`, `texto.md` ou os modelos originais.

### RN023 - Scripts de Inicialização

Devem existir scripts de inicialização compatíveis com os sistemas operacionais suportados.

Os scripts devem detectar ambiente, verificar dependências, instalar apenas o que estiver ausente e iniciar o fluxo da aplicação.

Quando Node.js estiver ausente, o script deve orientar ou tentar instalação automática por gerenciador de pacotes disponível na plataforma. Quando a instalação automática não for compatível com o ambiente, deve falhar com instrução clara.

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
