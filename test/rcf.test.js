// Autor: JeanCarloEM.com
// Site do Autor: https://jeancarloem.com
// Licenca: Mozilla Public License 2.0
// Site da Licenca: https://www.mozilla.org/MPL/2.0/
// Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
// Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

process.env.MIN_DELAY_MS = "0";
process.env.MAX_DELAY_MS = "0";
process.env.MEDIA_CONTEXT_READY_TIMEOUT_MS = "60";
process.env.MEDIA_CONTEXT_STABLE_MS = "0";
process.env.MEDIA_SEND_RETRY_DELAY_MS = "0";
process.env.MEDIA_SEND_RETRIES = "3";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  analyzeGuiTemplateMedia,
  applyListFilter,
  applyTemplate,
  buildSendPlan,
  buildPuppeteerConfig,
  createMessageMediaFromFile,
  createRuntimeScriptSnapshot,
  createStatusReporter,
  destroyWhatsAppClient,
  decodeHtmlEntities,
  evaluateExpression,
  evaluateFilterExpression,
  formatBrowserStartupError,
  formatTemplateSyntaxIssues,
  formatNameForMessage,
  getBrowserExecutableNames,
  getExistingBrowserConnectionConfig,
  getInstalledBrowserCandidates,
  getLinuxBrowserCandidates,
  getMacBrowserCandidates,
  getTemplateFingerprint,
  getWhatsAppClientId,
  getWindowsBrowserCandidates,
  hasRuntimeScriptsChanged,
  isOggAudioOnly,
  isTransientMediaSendError,
  inspectTemplateSyntax,
  loadAlreadySent,
  loadClientes,
  loadCsv,
  loadTemplate,
  loadSentRecords,
  materializeGuiExecutionPaths,
  normalizeTemplateText,
  normalizeYesNoAnswer,
  parseExecutionOptions,
  parseExpression,
  parseTemplateParts,
  resolveLocalMediaPath,
  resolveExecutionPaths,
  resolveCheckInputPath,
  resolveListCsvPath,
  resolveListSelection,
  resolveModelTemplatePath,
  processCampaign,
  resetSentLog,
  renderGuiHtml,
  sendRenderedTemplate,
  splitTemplateVariants,
  toBoolean,
  sanitizePhone,
  validateGuiPayload,
  validateGuiTemplateBaseDir,
  validateRuntimeFiles,
  resolveSessionByIdentifier,
  removeSession,
  listPersistedSessions,
  registerGuiInstance,
  waitForWhatsAppMediaContext,
} = require("../main");
const {
  MAIN_TARBALL_URL,
  safeTarPath,
  shouldSkip,
} = require("../scripts/update-project");
const {
  splitLeadingLegalHeader,
  shouldExcludeEntry: shouldExcludeDistEntry,
  shouldExcludeRootFile,
} = require("../scripts/build-dist");

const COMPLEX_CLIENTS_CSV = path.join(__dirname, "clientes-complexos.csv");
const COMPLEX_EXPECTED_JSON = path.join(__dirname, "expressions-complexas.expected.json");
const PROJECT_ROOT = path.resolve(__dirname, "..");

function createFixture(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whatsapp-rcf-"));
  const paths = {
    root,
    csv: path.join(root, "clientes.csv"),
    template: path.join(root, "texto.md"),
    listsDir: path.join(root, "listas"),
    modelsDir: path.join(root, "modelos"),
    logsDir: path.join(root, "logs"),
    sent: path.join(root, "logs", "enviados.csv"),
    errors: path.join(root, "logs", "erros.csv"),
    messageCache: path.join(root, "logs", "mensagens.json"),
    skipped: path.join(root, "logs", "pulos.csv"),
    warnings: path.join(root, "logs", "avisos.csv"),
    auth: path.join(root, ".wwebjs_auth"),
    sessionsFile: path.join(root, ".wwebjs_sessions.json"),
    mediaCacheDir: path.join(root, "media-cache"),
  };

  fs.writeFileSync(
    paths.csv,
    files.csv ?? "nome,telefone,conta\nMaria,(19) 99824-0000,12345\n",
    "utf8",
  );
  fs.writeFileSync(
    paths.template,
    files.template ?? "Olá ${nome}, conta ${conta}. ${extra}",
    "utf8",
  );

  return { root, paths };
}

function withEnv(values, fn) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createFakeOggAudio() {
  return Buffer.concat([
    Buffer.from("OggS", "ascii"),
    Buffer.alloc(24, 0),
    Buffer.from("OpusHead", "ascii"),
    Buffer.from("audio ficticio", "ascii"),
  ]);
}

function createFakeOggVideo() {
  return Buffer.concat([
    Buffer.from("OggS", "ascii"),
    Buffer.alloc(24, 0),
    Buffer.from("theora", "ascii"),
    Buffer.from("video ficticio", "ascii"),
  ]);
}

function loadComplexExpressionFixture() {
  const clientes = loadCsv(COMPLEX_CLIENTS_CSV);
  const expected = JSON.parse(fs.readFileSync(COMPLEX_EXPECTED_JSON, "utf8"));
  const byName = new Map(clientes.map((cliente) => [cliente.nome, cliente]));

  return { byName, clientes, expected };
}

test("normaliza telefone e adiciona código do Brasil quando necessário", () => {
  assert.equal(sanitizePhone("(19) 99824-0000"), "5519998240000");
  assert.equal(sanitizePhone("+55 19 99824-0000"), "5519998240000");
  assert.equal(sanitizePhone(""), "");
});

test("capitaliza nome e limita em no máximo duas palavras", () => {
  assert.equal(formatNameForMessage("maria eduarda silva extra"), "Maria Eduarda");
  assert.equal(formatNameForMessage("JOÃO"), "João");
  assert.equal(formatNameForMessage("ana-maria exemplo"), "Ana-Maria Exemplo");
});

test("gera candidatos de navegador para Windows, macOS e Linux", () => {
  assert.ok(getWindowsBrowserCandidates().some((candidate) => candidate.endsWith("chrome.exe")));
  assert.ok(getMacBrowserCandidates().some((candidate) => candidate.includes("Google Chrome.app")));
  assert.ok(getLinuxBrowserCandidates().some((candidate) => candidate.includes("google-chrome")));
  assert.ok(getInstalledBrowserCandidates("darwin").some((candidate) => candidate.includes("Applications")));
  assert.ok(getBrowserExecutableNames("linux").includes("chromium-browser"));
});

test("usa navegador existente quando BROWSER_URL está configurado", () => {
  withEnv(
    {
      BROWSER_URL: "http://127.0.0.1:9222",
      BROWSER_WS_ENDPOINT: "",
      CONNECT_EXISTING_BROWSER: "",
      PUPPETEER_BROWSER_URL: "",
      PUPPETEER_BROWSER_WS_ENDPOINT: "",
    },
    () => {
      assert.deepEqual(getExistingBrowserConnectionConfig(), {
        browserURL: "http://127.0.0.1:9222",
      });
      assert.deepEqual(buildPuppeteerConfig(), {
        browserURL: "http://127.0.0.1:9222",
      });
    },
  );
});

test("CONNECT_EXISTING_BROWSER usa a porta local padrão", () => {
  withEnv(
    {
      BROWSER_URL: "",
      BROWSER_WS_ENDPOINT: "",
      CONNECT_EXISTING_BROWSER: "true",
      PUPPETEER_BROWSER_URL: "",
      PUPPETEER_BROWSER_WS_ENDPOINT: "",
    },
    () => {
      assert.deepEqual(getExistingBrowserConnectionConfig(), {
        browserURL: "http://127.0.0.1:9222",
      });
    },
  );
});

test("aceita WA_CLIENT_ID para sessão separada e rejeita valor inválido", () => {
  withEnv({ WA_CLIENT_ID: "campanha_teste-01", WWEBJS_CLIENT_ID: "" }, () => {
    assert.equal(getWhatsAppClientId(), "campanha_teste-01");
  });

  withEnv({ WA_CLIENT_ID: "campanha teste", WWEBJS_CLIENT_ID: "" }, () => {
    assert.throws(() => getWhatsAppClientId(), /WA_CLIENT_ID inválido/);
  });
});

test("explica perfil de navegador já em uso", () => {
  const message = formatBrowserStartupError(
    new Error(
      "The browser is already running for C:\\LOCAL\\whatsapp\\.wwebjs_auth\\session. Use a different `userDataDir` or stop the running browser first.",
    ),
  );

  assert.match(message, /perfil local do WhatsApp Web já está em uso/);
  assert.match(message, /depuração remota/);
});

test("atualizador não depende de .git e preserva arquivos operacionais", () => {
  assert.match(MAIN_TARBALL_URL, /JeanCarloEM\/WhatSend\/tar\.gz\/refs\/heads\/main/);
  assert.equal(shouldSkip("clientes.csv"), true);
  assert.equal(shouldSkip("texto.md"), true);
  assert.equal(shouldSkip(".env"), true);
  assert.equal(shouldSkip("logs/enviados.csv"), true);
  assert.equal(shouldSkip(".wwebjs_auth/session"), true);
  assert.equal(shouldSkip("src/app.js"), false);
  assert.equal(safeTarPath("JeanCarloEM-WhatSend-abc123/src/app.js"), "src/app.js");
  assert.equal(safeTarPath("JeanCarloEM-WhatSend-abc123/../segredo.txt"), "");
});

test("build dist preserva cabeçalho legal e limita exclusão operacional à raiz", () => {
  const source = [
    "// Autor: Exemplo",
    "// Licenca: MPL-2.0",
    "",
    "// Comentário comum minificável",
    "const valor = 1 + 1;",
    "",
  ].join("\n");
  const { body, header } = splitLeadingLegalHeader(source);

  assert.equal(header, "// Autor: Exemplo\n// Licenca: MPL-2.0\n\n");
  assert.equal(body, "// Comentário comum minificável\nconst valor = 1 + 1;\n");
  assert.equal(shouldExcludeRootFile("clientes.csv"), true);
  assert.equal(shouldExcludeRootFile("texto.md"), true);
  assert.equal(shouldExcludeDistEntry("clientes.csv"), false);
  assert.equal(shouldExcludeDistEntry("texto.md"), false);
});

test("scripts start instalam dependências sem acionar download implícito do Puppeteer", () => {
  const startBat = fs.readFileSync(path.join(PROJECT_ROOT, "start.bat"), "utf8");
  const startSh = fs.readFileSync(path.join(PROJECT_ROOT, "start.sh"), "utf8");

  assert.match(startBat, /PUPPETEER_SKIP_DOWNLOAD=true/);
  assert.match(startBat, /PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true/);
  assert.match(startBat, /set "PUPPETEER_SKIP_DOWNLOAD="/);
  assert.match(startSh, /export PUPPETEER_SKIP_DOWNLOAD=true/);
  assert.match(startSh, /export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true/);
  assert.match(startSh, /unset PUPPETEER_SKIP_DOWNLOAD/);
});

test("status interativo renderiza sem erro", () => {
  const originalWrite = process.stdout.write;
  const originalIsTTY = process.stdout.isTTY;

  process.stdout.write = () => true;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });

  try {
    const status = createStatusReporter(1);
    assert.doesNotThrow(() => {
      status.current("Teste");
      status.sent("OK");
      status.finish();
    });
  } finally {
    process.stdout.write = originalWrite;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  }
});

test("exige somente nome e telefone como colunas obrigatórias do RCF no CSV", () => {
  const { paths } = createFixture({ csv: "nome,telefone\nMaria,19998240000\n" });

  assert.equal(loadCsv(paths.csv).length, 1);

  fs.writeFileSync(paths.csv, "nome,conta\nMaria,12345\n", "utf8");
  assert.throws(() => loadCsv(paths.csv), /colunas obrigatórias ausentes: telefone/);
});

test("aceita colunas obrigatórias do CSV sem diferenciar maiúsculas e minúsculas", () => {
  const { paths } = createFixture({
    csv: "Nome,Telefone,Conta\nMaria,19998240000,12345\n",
  });

  assert.equal(loadCsv(paths.csv).length, 1);
});

test("permite coluna opcional sem valor na linha do CSV", () => {
  const { paths } = createFixture({
    csv: "nome,telefone,conta\nMaria,19998240000\n",
  });

  const rows = loadCsv(paths.csv);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].nome, "Maria");
  assert.equal(rows[0].telefone, "19998240000");
});

test("CSV detecta delimitador de planilha brasileira e preserva UTF-8", () => {
  const { paths } = createFixture({
    csv:
      "nome;telefone;observacao;valor\n" +
      "João Ação;11999999999;Acentuação com ç;120,50\n" +
      "Maria;21988887777;Texto comum;80\n",
  });

  const rows = loadCsv(paths.csv);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].nome, "João Ação");
  assert.equal(rows[0].observacao, "Acentuação com ç");
  assert.equal(rows[0].valor, "120,50");
});

test("CSV aceita ANSI Windows-1252 comum no Excel e Bloco de Notas", () => {
  const { paths } = createFixture();
  const ansiCsv = Buffer.from(
    "nome;telefone;observacao\nJo\xe3o A\xe7\xe3o;11999999999;A\xe7\xfacar e cora\xe7\xe3o\n",
    "latin1",
  );

  fs.writeFileSync(paths.csv, ansiCsv);

  const rows = loadCsv(paths.csv);

  assert.equal(rows[0].nome, "João Ação");
  assert.equal(rows[0].observacao, "Açúcar e coração");
});

test("CSV aceita tabulação e aspas simples como delimitadores textuais", () => {
  const { paths } = createFixture({
    csv:
      "nome\ttelefone\tobservacao\n" +
      "'Pessoa Teste'\t'11999999999'\t'Texto com vírgula, ponto e ç'\n",
  });

  const rows = loadCsv(paths.csv);

  assert.equal(rows[0].nome, "Pessoa Teste");
  assert.equal(rows[0].telefone, "11999999999");
  assert.equal(rows[0].observacao, "Texto com vírgula, ponto e ç");
});

test("substitui variável ausente por vazio e permite registrar aviso", () => {
  const missing = [];
  const result = applyTemplate("Olá ${nome}. ${inexistente}", { nome: "ana maria silva" }, {
    onMissingVariable: (field) => missing.push(field),
  });

  assert.equal(result, "Olá Ana Maria. ");
  assert.deepEqual(missing, ["inexistente"]);
});

test("resolve variáveis do template sem diferenciar maiúsculas e minúsculas", () => {
  const result = applyTemplate(
    "Olá ${NOME}, conta ${CoNtA}. ${EXTRA}",
    { conta: "12345", extra: "ok", nome: "ana maria silva" },
  );

  assert.equal(result, "Olá Ana Maria, conta 12345. ok");
});

test("substitui $diatarde$ conforme horário e início de frase", () => {
  const morning = new Date(2026, 5, 23, 9, 0, 0);
  const afternoon = new Date(2026, 5, 23, 13, 0, 0);

  assert.equal(
    applyTemplate("$diatarde$, ${nome}. tudo bem? $diatarde$.", { nome: "maria" }, { now: morning }),
    "Bom dia, Maria. tudo bem? bom dia.",
  );
  assert.equal(
    applyTemplate("Olá, $diatarde$. Depois.   $diatarde$!", {}, { now: afternoon }),
    "Olá, boa tarde. Depois.   Boa tarde!",
  );
});

test("normaliza quebras Windows/Linux para envio sem remover recuos", () => {
  const { paths } = createFixture({
    template: "Linha 1\r\n  Linha recuada\rLinha antiga\u2028Linha unicode\u2029${nome}",
  });
  const loaded = loadTemplate(paths.template);
  const applied = applyTemplate(loaded, { nome: "joão ação" });

  assert.equal(
    loaded,
    "Linha 1\n  Linha recuada\nLinha antiga\nLinha unicode\n${nome}",
  );
  assert.equal(
    applied,
    "Linha 1\n  Linha recuada\nLinha antiga\nLinha unicode\nJoão Ação",
  );
  assert.equal(
    normalizeTemplateText("\ufeffA\r\n\tB\rC\u2028D"),
    "A\n\tB\nC\nD",
  );
});

test("converte entidades HTML para caracteres reais antes do envio", () => {
  const result = applyTemplate(
    "A&#x20;B C&#32;D OK&#x21;\n${extra}\n${nome}",
    {
      extra: "&#231; &amp; &lt;ok&gt;&nbsp;fim",
      nome: "jo&#xE3;o teste",
    },
  );

  assert.equal(result, "A B C D OK!\nç & <ok> fim\nJoão Teste");
  assert.equal(decodeHtmlEntities("Fim&#x21"), "Fim!");
  assert.equal(decodeHtmlEntities("Valor inválido &#xD800; preservado"), "Valor inválido &#xD800; preservado");
});

test("detecta possíveis erros confirmáveis de sintaxe no modelo", () => {
  const issues = inspectTemplateSyntax(
    "Olá {nome}\nValor ${valor+}\nFechamento solto }\nAberto ${conta",
  );

  assert.ok(issues.some((issue) => issue.code === "BRACES_WITHOUT_DOLLAR"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_TEMPLATE_EXPRESSION"));
  assert.ok(issues.some((issue) => issue.code === "UNCLOSED_TEMPLATE_EXPRESSION"));
  assert.match(formatTemplateSyntaxIssues(issues), /possíveis erros de sintaxe/);
  assert.equal(normalizeYesNoAnswer("SIM"), "yes");
  assert.equal(normalizeYesNoAnswer("sím"), "yes");
  assert.equal(normalizeYesNoAnswer("NÃO"), "no");
  assert.equal(normalizeYesNoAnswer(""), "");
  assert.equal(normalizeYesNoAnswer("talvez"), "invalid");
});

test("interpreta notação markdown de anexo preservando a ordem", () => {
  const parts = parseTemplateParts("Antes\r\n![](arquivo.pdf)\r\nDepois");

  assert.deepEqual(parts, [
    { type: "text", value: "Antes\n" },
    { type: "media", source: "arquivo.pdf", raw: "![](arquivo.pdf)" },
    { type: "text", value: "\nDepois" },
  ]);
});

test("converte entidade HTML em caminho de anexo antes de interpretar markdown", () => {
  const parts = parseTemplateParts("![](https://exemplo.test/arquivo.pdf?x=1&amp;y=2)");

  assert.deepEqual(parts, [
    {
      raw: "![](https://exemplo.test/arquivo.pdf?x=1&y=2)",
      source: "https://exemplo.test/arquivo.pdf?x=1&y=2",
      type: "media",
    },
  ]);
});

test("combina anexo no início ou final com legenda", () => {
  assert.deepEqual(
    buildSendPlan(parseTemplateParts("Texto\n![](arquivo.pdf)")),
    [
      {
        caption: "Texto",
        source: "arquivo.pdf",
        type: "media",
        raw: "![](arquivo.pdf)",
      },
    ],
  );

  assert.deepEqual(
    buildSendPlan(parseTemplateParts("![](arquivo.pdf)\nTexto")),
    [
      {
        caption: "Texto",
        source: "arquivo.pdf",
        type: "media",
        raw: "![](arquivo.pdf)",
      },
    ],
  );
});

test("pré-validação cria arquivos de auditoria sem iniciar WhatsApp", () => {
  const { paths } = createFixture();
  const result = validateRuntimeFiles(paths, { checkBrowser: false });

  assert.equal(result.clientesCount, 1);
  assert.equal(fs.existsSync(paths.sent), true);
  assert.equal(fs.existsSync(paths.errors), true);
  assert.equal(fs.existsSync(paths.skipped), true);
  assert.equal(fs.existsSync(paths.warnings), true);
});

test("GUI bloqueia textarea e arquivo de modelo usados ao mesmo tempo", () => {
  const { paths } = createFixture();
  const result = validateGuiPayload(
    {
      templateFile: {
        content: "Olá ${nome}",
        name: "modelo.md",
      },
      templateText: "Olá ${nome}",
    },
    paths,
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /apenas uma fonte de modelo/);
});

test("GUI retorna avisos confirmáveis para sintaxe suspeita do modelo", () => {
  const { paths } = createFixture();
  const result = validateGuiPayload(
    {
      templateText: "Olá {nome}\nValor ${valor+}",
    },
    paths,
  );

  assert.equal(result.ok, true);
  assert.ok(result.syntaxIssues.some((issue) => issue.code === "BRACES_WITHOUT_DOLLAR"));
  assert.ok(result.syntaxIssues.some((issue) => issue.code === "INVALID_TEMPLATE_EXPRESSION"));
});

test("GUI materializa entradas temporárias sem alterar arquivos padrão", () => {
  const { paths } = createFixture({
    csv: "nome,telefone,status\nBase,11999999999,inativo\n",
    template: "Mensagem original ${nome}",
  });
  const originalCsv = fs.readFileSync(paths.csv, "utf8");
  const originalTemplate = fs.readFileSync(paths.template, "utf8");

  const guiPaths = materializeGuiExecutionPaths(
    {
      csvFile: {
        content: "nome,telefone,status\nTela,11988888888,ativo\n",
        name: "clientes.csv",
      },
      filter: "status=ativo",
      templateText: "Mensagem da tela ${NOME}",
    },
    paths,
  );

  assert.notEqual(guiPaths.csv, paths.csv);
  assert.notEqual(guiPaths.template, paths.template);
  assert.equal(fs.readFileSync(paths.csv, "utf8"), originalCsv);
  assert.equal(fs.readFileSync(paths.template, "utf8"), originalTemplate);
  assert.deepEqual(loadClientes(guiPaths).map((cliente) => cliente.nome), ["Tela"]);
  assert.equal(applyTemplate(fs.readFileSync(guiPaths.template, "utf8"), { nome: "tela exemplo" }), "Mensagem da tela Tela Exemplo");
});

test("GUI usa diretório do arquivo de modelo informado como base dos anexos", () => {
  const { root, paths } = createFixture();
  const sourceDir = path.join(root, "campanhas", "junho");
  const sourceTemplatePath = path.join(sourceDir, "modelo.md");
  const mediaPath = path.join(sourceDir, "rendefacil-lilhian.ogg");

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(sourceTemplatePath, "Olá\n![](rendefacil-lilhian.ogg)", "utf8");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const guiPaths = materializeGuiExecutionPaths(
    {
      templateFile: {
        content: "Olá\n![](rendefacil-lilhian.ogg)",
        name: sourceTemplatePath,
        path: sourceTemplatePath,
      },
    },
    paths,
  );

  assert.equal(guiPaths.templateBaseDir, sourceDir);
  assert.doesNotThrow(() => validateRuntimeFiles(guiPaths, { checkBrowser: false }));
});

test("GUI pré-analisa anexos do modelo e aceita pasta de referência", () => {
  const { root, paths } = createFixture();
  const referenceDir = path.join(root, "referencias");
  const mediaName = "audio-referencia-unico.ogg";
  const mediaPath = path.join(referenceDir, mediaName);
  const templateFile = {
    content: `Olá\n![](./${mediaName})`,
    name: "modelo.md",
    path: "modelo.md",
  };

  fs.mkdirSync(referenceDir, { recursive: true });

  const missing = analyzeGuiTemplateMedia({ templateFile }, paths);
  assert.equal(missing.ok, true);
  assert.equal(missing.localMediaCount, 1);
  assert.equal(missing.needsTemplateBaseDir, true);
  assert.match(missing.mediaIssues.join("\n"), /Anexo não encontrado/);

  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const resolved = analyzeGuiTemplateMedia(
    {
      templateBaseDir: referenceDir,
      templateFile,
    },
    paths,
  );

  assert.equal(resolved.ok, true);
  assert.equal(resolved.localMediaCount, 1);
  assert.deepEqual(resolved.mediaIssues, []);
  assert.equal(resolved.needsTemplateBaseDir, false);
});

test("GUI valida pasta de referência dos anexos como diretório local existente", () => {
  const { root } = createFixture();
  const errors = [];
  const filePath = path.join(root, "arquivo.txt");
  fs.writeFileSync(filePath, "x", "utf8");

  assert.equal(validateGuiTemplateBaseDir(root, errors), root);
  assert.deepEqual(errors, []);

  const missingErrors = [];
  assert.equal(validateGuiTemplateBaseDir(path.join(root, "nao-existe"), missingErrors), "");
  assert.match(missingErrors.join("\n"), /não encontrada/);

  const fileErrors = [];
  assert.equal(validateGuiTemplateBaseDir(filePath, fileErrors), "");
  assert.match(fileErrors.join("\n"), /não é um diretório/);

  const urlErrors = [];
  assert.equal(validateGuiTemplateBaseDir("https://exemplo.test/anexos", urlErrors), "");
  assert.match(urlErrors.join("\n"), /não URL/);
});

test("resolve modelo opcional dentro de ./modelos", () => {
  const { paths } = createFixture();

  assert.equal(parseExecutionOptions(["--check", "faturamento"]).templateName, "faturamento");
  assert.equal(
    resolveModelTemplatePath("faturamento", paths),
    path.join(paths.modelsDir, "faturamento.md"),
  );
  assert.equal(
    resolveExecutionPaths(paths, { templateName: "faturamento" }).template,
    path.join(paths.modelsDir, "faturamento.md"),
  );
  assert.throws(() => resolveModelTemplatePath("../segredo", paths), /Modelo inválido/);
});

test("anexos relativos usam a pasta do modelo como referência primária", () => {
  const { root, paths } = createFixture();
  const modelDir = path.join(root, "modelos", "campanha");
  const templatePath = path.join(modelDir, "mensagem.md");
  const mediaPath = path.join(modelDir, "rendefacil-lilhian.ogg");

  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(templatePath, "Olá\n![](rendefacil-lilhian.ogg)", "utf8");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const executionPaths = {
    ...paths,
    template: templatePath,
    templateBaseDir: modelDir,
  };

  assert.equal(
    resolveLocalMediaPath(
      "rendefacil-lilhian.ogg",
      executionPaths.template,
      executionPaths.templateBaseDir,
      [executionPaths.root],
    ),
    mediaPath,
  );
  assert.doesNotThrow(() => validateRuntimeFiles(executionPaths, { checkBrowser: false }));
});

test("anexos relativos com ./ podem cair para a raiz quando não estão ao lado do modelo", () => {
  const { root, paths } = createFixture();
  const modelDir = path.join(root, "modelos", "campanha");
  const templatePath = path.join(modelDir, "mensagem.md");
  const mediaPath = path.join(root, "rendefacil-lilhian.ogg");

  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(templatePath, "Olá\n![](./rendefacil-lilhian.ogg)", "utf8");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const executionPaths = {
    ...paths,
    template: templatePath,
    templateBaseDir: modelDir,
  };

  assert.equal(
    resolveLocalMediaPath(
      "./rendefacil-lilhian.ogg",
      executionPaths.template,
      executionPaths.templateBaseDir,
      [executionPaths.root],
    ),
    mediaPath,
  );
  assert.doesNotThrow(() => validateRuntimeFiles(executionPaths, { checkBrowser: false }));
});

test("anexo OGG externo relativo com .. e espaços resolve fora do repositório", async () => {
  const { root, paths } = createFixture();
  const externalDir = path.join(root, "..", "audios externos");
  const mediaPath = path.join(externalDir, "audio externo.ogg");
  const relativeSource = path.relative(path.dirname(paths.template), mediaPath);

  fs.mkdirSync(externalDir, { recursive: true });
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  assert.equal(
    resolveLocalMediaPath(
      relativeSource,
      paths.template,
      path.dirname(paths.template),
      [paths.root],
    ),
    mediaPath,
  );

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    `Antes\n![](${relativeSource})\nDepois`,
    paths,
  );

  assert.deepEqual(calls.map((call) => call.text || call.filename), [
    "Antes\n",
    "audio externo.ogg",
    "\nDepois",
  ]);
  assert.equal(calls[1].options.sendAudioAsVoice, true);
  assert.equal(calls[1].mimetype, "audio/ogg");
});

test("runtime detecta alteração em scripts e registra instância sem expor token", () => {
  const { root, paths } = createFixture();
  const srcDir = path.join(root, "src");
  const mainPath = path.join(root, "main.js");
  const scriptPath = path.join(srcDir, "app.js");

  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(mainPath, "require('./src/app')\n", "utf8");
  fs.writeFileSync(scriptPath, "module.exports = 1;\n", "utf8");

  const scriptSnapshot = createRuntimeScriptSnapshot(root);
  const future = new Date(Date.now() + 5000);
  fs.writeFileSync(scriptPath, "module.exports = 2;\n", "utf8");
  fs.utimesSync(scriptPath, future, future);

  assert.equal(hasRuntimeScriptsChanged({ scriptSnapshot }, root), true);

  const registration = registerGuiInstance(
    { url: "http://127.0.0.1:3137/" },
    {
      ...paths,
      activeSession: { id: "default" },
      authSessionDir: path.join(paths.auth, "session"),
    },
    { token: "segredo-local" },
  );

  try {
    assert.equal(fs.existsSync(registration.recordPath), true);
    assert.equal(registration.record.port, 3137);
    assert.deepEqual(registration.record.profiles, ["default"]);
    assert.equal(registration.publicRecord.token, undefined);
  } finally {
    registration.stop();
  }

  assert.equal(fs.existsSync(registration.recordPath), false);
});

test("permite CSV e template por path somente para npm run check", () => {
  const { paths } = createFixture();
  const csvPath = path.join(paths.root || path.dirname(paths.csv), "check.csv");
  const templatePath = path.join(paths.root || path.dirname(paths.template), "check.md");

  fs.writeFileSync(csvPath, "nome,telefone\nCheck,11999999999\n", "utf8");
  fs.writeFileSync(templatePath, "Modelo check ${nome}", "utf8");

  const options = parseExecutionOptions([
    "--check",
    "--check-csv",
    csvPath,
    "--check-template",
    templatePath,
  ]);
  const resolved = resolveExecutionPaths(paths, options);

  assert.equal(options.checkCsvPath, csvPath);
  assert.equal(options.checkTemplatePath, templatePath);
  assert.equal(resolved.csv, csvPath);
  assert.equal(resolved.template, templatePath);
  assert.equal(resolved.templateBaseDir, path.dirname(templatePath));
  assert.equal(resolveCheckInputPath(csvPath, ".csv", "CSV de check"), csvPath);
  assert.throws(
    () => parseExecutionOptions(["--check-csv", csvPath]),
    /apenas junto com --check/,
  );
  assert.throws(
    () => resolveCheckInputPath(templatePath, ".csv", "CSV de check"),
    /CSV de check inválido/,
  );
});

test("resolve lista opcional dentro de ./listas", () => {
  const { paths } = createFixture();

  assert.equal(parseExecutionOptions(["--lista", "origem"]).listArg, "origem");
  assert.equal(parseExecutionOptions(["--modelo", "faturamento", "origem"]).listArg, "origem");
  assert.equal(parseExecutionOptions(["status=ativo"]).listArg, "status=ativo");
  assert.equal(parseExecutionOptions(["faturamento", "origem"]).listArg, "origem");
  assert.equal(
    resolveListCsvPath("origem", paths),
    path.join(paths.listsDir, "origem.csv"),
  );
  assert.equal(
    resolveExecutionPaths(paths, { listArg: "origem" }).csv,
    path.join(paths.listsDir, "origem.csv"),
  );
  assert.throws(() => resolveListCsvPath("../clientes", paths), /Lista inválida/);
});

test("interpreta parâmetro de lista com = ou != como filtro sobre clientes.csv", () => {
  const { paths } = createFixture({
    csv: "nome,telefone,status\nMaria,19998240000,ativo\nJoão,19998240001,inativo\n",
  });
  const filteredPaths = resolveExecutionPaths(paths, { listArg: '"STATUS"="ativo"' });
  const negativePaths = resolveExecutionPaths(paths, { listArg: "'status'!='inativo'" });

  assert.equal(filteredPaths.csv, paths.csv);
  assert.equal(filteredPaths.listFilter.expression, '"STATUS"="ativo"');
  assert.deepEqual(loadClientes(filteredPaths).map((cliente) => cliente.nome), ["Maria"]);
  assert.deepEqual(loadClientes(negativePaths).map((cliente) => cliente.nome), ["Maria"]);
});

test("filtra clientes por coluna insensível a maiúsculas e minúsculas", () => {
  const clientes = [
    { Nome: "Maria", Status: "ativo" },
    { Nome: "João", Status: "inativo" },
  ];

  assert.deepEqual(
    applyListFilter(clientes, { ast: parseExpression("status=ativo"), expression: "status=ativo" }),
    [clientes[0]],
  );
  assert.deepEqual(
    applyListFilter(clientes, { ast: parseExpression("STATUS!=ativo"), expression: "STATUS!=ativo" }),
    [clientes[1]],
  );
});

test("filtra clientes com operadores lógicos, comparação numérica e funções", () => {
  const { paths } = createFixture({
    csv: [
      "nome,telefone,status,valor,conta,tipo",
      "Maria,19998240000,ativo,\"10,50\",123,VIP",
      "João,19998240001,inativo,7,,Comum",
      "Ana,19998240002,válido,20,456,Comum",
      "Bia,19998240003,cancelado,20,789,Comum",
    ].join("\n"),
  });
  const selected = resolveExecutionPaths(paths, {
    listArg: '((status=true && valor>=10,5) || tipo=VIP) && !$.vazio(conta)',
  });

  assert.deepEqual(loadClientes(selected).map((cliente) => cliente.nome), ["Maria", "Ana"]);
});

test("valida coluna entre aspas em filtro composto", () => {
  const { paths } = createFixture({
    csv: "nome,telefone,status,valor\nMaria,19998240000,ativo,10\nJoão,19998240001,inativo,20\n",
  });
  const selected = resolveExecutionPaths(paths, {
    listArg: '"STATUS"="ativo" && valor>=10',
  });
  const invalid = resolveExecutionPaths(paths, {
    listArg: '"SITUACAO"="ativo" && valor>=10',
  });

  assert.deepEqual(loadClientes(selected).map((cliente) => cliente.nome), ["Maria"]);
  assert.throws(() => loadClientes(invalid), /coluna não encontrada: SITUACAO/);
});

test("suporta XOR, negação e coluna explícita no filtro", () => {
  const clientes = [
    { nome: "Maria", valor: "3", status: "ativo" },
    { nome: "João", valor: "8", status: "ativo" },
    { nome: "Ana", valor: "8", status: "inativo" },
  ];
  const filter = {
    ast: parseExpression("($.istrue(status) ^^ ($valor>=5)) && !(3>=$valor)"),
    expression: "($.istrue(status) ^^ ($valor>=5)) && !(3>=$valor)",
  };

  assert.deepEqual(applyListFilter(clientes, filter), [clientes[2]]);
});

test("avalia funções de tipo e conversão booleana/númerica", () => {
  const data = {
    ativo: "vigente",
    inteiro: "10",
    texto: "ABC",
    valor: "1.234,50",
  };

  assert.equal(toBoolean(evaluateExpression("$.isbool(ativo)", data).value), true);
  assert.equal(toBoolean(evaluateExpression("$.istrue(ativo)", data).value), true);
  assert.equal(toBoolean(evaluateExpression("$.isint(inteiro)", data).value), true);
  assert.equal(toBoolean(evaluateExpression("$.isfloat(valor)", data).value), true);
  assert.equal(toBoolean(evaluateExpression("$.istring(texto)", data).value), true);
});

test("permite matemática em filtros e no template", () => {
  const clientes = [
    { nome: "Maria", taxa: "2", valor: "10,5" },
    { nome: "João", taxa: "1", valor: "4" },
  ];
  const filter = {
    ast: parseExpression("(valor + taxa * 2)>=14,5"),
    expression: "(valor + taxa * 2)>=14,5",
  };

  assert.deepEqual(applyListFilter(clientes, filter), [clientes[0]]);
  assert.equal(applyTemplate("Total: ${(valor+taxa)*2}", clientes[0]), "Total: 25");
});

test("formata resultados numéricos de template no padrão brasileiro", () => {
  assert.equal(applyTemplate("Resultado: ${10 / 3}", {}), "Resultado: 3,33");
  assert.equal(applyTemplate("Resultado: ${100 * 0.157}", {}), "Resultado: 15,70");
  assert.equal(applyTemplate("Resultado: ${1234.567}", {}), "Resultado: 1234,57");
  assert.equal(applyTemplate("Resultado: ${10 / 2}", {}), "Resultado: 5");
});

test("funções numéricas e bancárias formatam valores de forma determinística", () => {
  const data = {
    conta: "00123456",
    quantidade: "1234567",
    valor: "1.234,567",
  };

  assert.equal(applyTemplate("${$.round(10.5)}", data), "11");
  assert.equal(applyTemplate("${$.ceil(10.1)}", data), "11");
  assert.equal(applyTemplate("${$.floor(10.9)}", data), "10");
  assert.equal(applyTemplate("${$.int(-10.9)}", data), "-10");
  assert.equal(
    applyTemplate("${$.moeda(1000 * 1.15)}", data).replace(/\s/u, " "),
    "R$ 1.150,00",
  );
  assert.equal(applyTemplate("${$.decimal(${valor})}", data), "1.234,57");
  assert.equal(applyTemplate("${$.numero(${quantidade})}", data), "1.234.567");
  assert.equal(applyTemplate("${$.digito2(${conta})}", data), "1.234-56");
});

test("divide múltiplos modelos válidos por separador ^^^", () => {
  const blockA = "A".repeat(96);
  const blockB = "B".repeat(100);

  assert.deepEqual(splitTemplateVariants(`${blockA}\n\n^^^\n\n${blockB}`), [
    blockA,
    blockB,
  ]);
  assert.deepEqual(splitTemplateVariants("curto\n^^^\noutro curto"), [
    "curto\n^^^\noutro curto",
  ]);
});

test("resolve sessão por nome ou últimos dígitos e rejeita ambiguidade", () => {
  const sessions = [
    { displayName: "Comercial (1234)", id: "comercial", name: "Comercial", phone: "551199991234" },
    { displayName: "Financeiro (5678)", id: "financeiro", name: "Financeiro", phone: "551188885678" },
    { displayName: "Suporte (1234)", id: "suporte", name: "Suporte", phone: "552197771234" },
  ];

  assert.equal(resolveSessionByIdentifier("financeiro", sessions).id, "financeiro");
  assert.equal(resolveSessionByIdentifier("5678", sessions).id, "financeiro");
  assert.throws(() => resolveSessionByIdentifier("1234", sessions), /Sessão ambígua/);
});

test("CLI aceita remover sessão por parâmetro", () => {
  assert.equal(
    parseExecutionOptions(["--remove-session", "Comercial"]).removeSession,
    "Comercial",
  );
  assert.equal(
    parseExecutionOptions(["--remover-sessao=1234"]).removeSession,
    "1234",
  );
});

test("remove sessão apaga auth local e volta ao estado inicial quando não resta persistência", () => {
  const { paths } = createFixture();
  const sessionDir = path.join(paths.auth, "session-comercial");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "marker.txt"), "ok", "utf8");
  fs.writeFileSync(
    paths.sessionsFile,
    JSON.stringify({
      sessions: {
        comercial: {
          id: "comercial",
          name: "Comercial",
          phone: "551199991234",
        },
      },
      version: 1,
    }),
    "utf8",
  );

  const result = removeSession("Comercial", paths);

  assert.equal(result.removed.id, "comercial");
  assert.equal(fs.existsSync(sessionDir), false);
  assert.deepEqual(listPersistedSessions(paths), []);
  assert.equal(result.remainingSessions.length, 1);
  assert.equal(result.remainingSessions[0].id, "default");
});

test("remove sessão ainda não autenticada sem exigir pasta LocalAuth", () => {
  const { paths } = createFixture();
  fs.writeFileSync(
    paths.sessionsFile,
    JSON.stringify({
      sessions: {
        teste: {
          id: "teste",
          name: "Teste",
        },
      },
      version: 1,
    }),
    "utf8",
  );

  const result = removeSession("Teste", paths);

  assert.equal(result.removed.id, "teste");
  assert.deepEqual(listPersistedSessions(paths), []);
  assert.equal(result.remainingSessions[0].id, "default");
});

test("encerramento do WhatsApp aguarda destroy antes de liberar sessão", async () => {
  let destroyed = false;
  const result = await destroyWhatsAppClient(
    {
      async destroy() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        destroyed = true;
      },
    },
    { graceMs: 0, timeoutMs: 200 },
  );

  assert.equal(destroyed, true);
  assert.equal(result.destroyed, true);
  assert.equal(result.timedOut, false);
});

test("GUI permite escolher sessão a remover sem alternar para ela", () => {
  const html = renderGuiHtml();

  assert.match(html, /Qual sessão deseja remover/);
  assert.match(html, /askSessionToRemove/);
  assert.match(html, /sessionToRemove\.id/);
  assert.doesNotMatch(
    html,
    /postJson\("\/api\/sessions\/remove", \{\s*sessionId: activeSessionId/s,
  );
});

test("parser avalia filtros complexos contra fixture versionada", () => {
  const { clientes, expected } = loadComplexExpressionFixture();

  for (const testCase of expected.filterCases) {
    const ast = parseExpression(testCase.expression);
    const selected = applyListFilter(clientes, {
      ast,
      expression: testCase.expression,
    }).map((cliente) => cliente.nome);

    assert.deepEqual(
      selected,
      testCase.expectedNames,
      `Filtro complexo falhou: ${testCase.name}`,
    );

    const directSelected = clientes
      .filter((cliente) => evaluateFilterExpression(ast, cliente))
      .map((cliente) => cliente.nome);

    assert.deepEqual(
      directSelected,
      testCase.expectedNames,
      `Avaliação direta falhou: ${testCase.name}`,
    );
  }
});

test("parser avalia expressões complexas por cliente da fixture", () => {
  const { byName, expected } = loadComplexExpressionFixture();

  for (const testCase of expected.evaluationCases) {
    const cliente = byName.get(testCase.rowName);
    assert.ok(cliente, `Cliente não encontrado na fixture: ${testCase.rowName}`);

    const result = evaluateExpression(testCase.expression, cliente).value;

    if (typeof testCase.expectedValue === "number") {
      assert.ok(
        Math.abs(result - testCase.expectedValue) < 0.000000001,
        `Expressão ${testCase.name}: esperado ${testCase.expectedValue}, recebido ${result}`,
      );
    } else {
      assert.equal(result, testCase.expectedValue, `Expressão falhou: ${testCase.name}`);
    }
  }
});

test("template aplica expressões matemáticas usando fixture complexa", () => {
  const { byName, expected } = loadComplexExpressionFixture();

  for (const testCase of expected.templateCases) {
    const cliente = byName.get(testCase.rowName);
    assert.ok(cliente, `Cliente não encontrado na fixture: ${testCase.rowName}`);
    assert.equal(
      applyTemplate(testCase.template, cliente),
      testCase.expectedText,
      `Template falhou: ${testCase.name}`,
    );
  }
});

test("parser rejeita filtros inválidos usando fixture complexa", () => {
  const { clientes, expected } = loadComplexExpressionFixture();

  for (const testCase of expected.invalidFilterCases) {
    assert.throws(
      () => {
        const ast = parseExpression(testCase.expression);
        applyListFilter(clientes, {
          ast,
          expression: testCase.expression,
        });
      },
      new RegExp(testCase.expectedErrorPattern),
      `Filtro inválido deveria falhar: ${testCase.name}`,
    );
  }
});

test("usa modelo selecionado e resolve anexos relativos à pasta do modelo", async () => {
  const { paths } = createFixture({
    template: "Mensagem padrão ${nome}",
  });
  fs.mkdirSync(paths.modelsDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.modelsDir, "faturamento.md"),
    "Modelo ${NOME}\n![](./boleto.pdf)",
    "utf8",
  );
  fs.writeFileSync(path.join(paths.modelsDir, "boleto.pdf"), "pdf fictício", "utf8");

  const executionPaths = resolveExecutionPaths(paths, { templateName: "faturamento" });
  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage(to, content, options) {
      calls.push([
        "sendMessage",
        to,
        typeof content === "string" ? content : content.filename,
        options,
      ]);
    },
  };

  validateRuntimeFiles(executionPaths, { checkBrowser: false });
  await processCampaign(client, executionPaths);

  assert.deepEqual(calls, [
    ["getNumberId", "5519998240000"],
    [
      "sendMessage",
      "5519998240000@c.us",
      "boleto.pdf",
      { caption: "Modelo Maria", sendMediaAsDocument: true, waitUntilMsgSent: true },
    ],
  ]);
});

test("carrega enviados ignorando o cabeçalho de auditoria", () => {
  const { paths } = createFixture();
  fs.mkdirSync(paths.logsDir, { recursive: true });
  fs.writeFileSync(
    paths.sent,
    "telefone;mensagem_hash;data_hora\n5519998240000;abc;2026-06-23\n",
  );

  assert.deepEqual([...loadAlreadySent(paths.sent)], ["5519998240000"]);
  assert.deepEqual(loadSentRecords(paths.sent), [
    {
      dataHora: "2026-06-23",
      mensagemHash: "abc",
      telefone: "5519998240000",
    },
  ]);
});

test("não envia duplicado e não revalida número já enviado", async () => {
  const { paths } = createFixture();
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const template = fs.readFileSync(paths.template, "utf8");
  const { hash } = getTemplateFingerprint(template);
  fs.writeFileSync(
    paths.sent,
    `telefone;mensagem_hash;data_hora\n5519998240000;${hash};${new Date().toISOString()}\n`,
  );

  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage(to, message) {
      calls.push(["sendMessage", to, message]);
    },
  };

  await processCampaign(client, paths);

  assert.deepEqual(calls, []);
  assert.match(fs.readFileSync(paths.skipped, "utf8"), /JA_ENVIADO_MENSAGEM_SIMILAR/);
  assert.match(fs.readFileSync(paths.skipped, "utf8"), /Mensagem similar/);
});

test("force resend ignora histórico de enviados nessa execução", async () => {
  const { paths } = createFixture();
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const template = fs.readFileSync(paths.template, "utf8");
  const { hash } = getTemplateFingerprint(template);
  fs.writeFileSync(
    paths.sent,
    `telefone;mensagem_hash;data_hora\n5519998240000;${hash};${new Date().toISOString()}\n`,
  );

  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage(to, message) {
      calls.push(["sendMessage", to, message]);
    },
  };

  await processCampaign(client, paths, { forceResend: true });

  assert.deepEqual(calls, [
    ["getNumberId", "5519998240000"],
    ["sendMessage", "5519998240000@c.us", "Olá Maria, conta 12345. "],
  ]);
});

test("resetSentLog limpa a lista de enviados preservando cabeçalho", () => {
  const { paths } = createFixture();
  fs.mkdirSync(paths.logsDir, { recursive: true });
  fs.writeFileSync(
    paths.sent,
    "telefone;mensagem_hash;data_hora\n5519998240000;abc;2026-06-23\n",
  );

  resetSentLog(paths.sent);

  assert.equal(
    fs.readFileSync(paths.sent, "utf8"),
    "telefone;mensagem_hash;data_hora\n",
  );
});

test("mensagem nativa diferente em mais de 10% permite novo envio", async () => {
  const { paths } = createFixture({
    template: "Mensagem totalmente nova para ${nome}.",
  });
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const previous = getTemplateFingerprint("Conteúdo anterior bem diferente.");

  fs.writeFileSync(
    paths.sent,
    `telefone;mensagem_hash;data_hora\n5519998240000;${previous.hash};${new Date().toISOString()}\n`,
  );
  fs.writeFileSync(
    paths.messageCache,
    JSON.stringify({
      messages: {
        [previous.hash]: {
          content: previous.content,
          createdAt: new Date().toISOString(),
          hash: previous.hash,
        },
      },
      version: 1,
    }),
  );

  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage(to, message) {
      calls.push(["sendMessage", to, message]);
    },
  };

  await processCampaign(client, paths);

  assert.deepEqual(calls, [
    ["getNumberId", "5519998240000"],
    ["sendMessage", "5519998240000@c.us", "Mensagem totalmente nova para Maria."],
  ]);
});

test("mensagem igual pode reenviar após o prazo configurado", async () => {
  const { paths } = createFixture();
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const template = fs.readFileSync(paths.template, "utf8");
  const { hash } = getTemplateFingerprint(template);
  const oldDate = new Date(Date.now() - 49 * 3600000).toISOString();

  fs.writeFileSync(
    paths.sent,
    `telefone;mensagem_hash;data_hora\n5519998240000;${hash};${oldDate}\n`,
  );

  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage(to, message) {
      calls.push(["sendMessage", to, message]);
    },
  };

  await processCampaign(client, paths);

  assert.deepEqual(calls, [
    ["getNumberId", "5519998240000"],
    ["sendMessage", "5519998240000@c.us", "Olá Maria, conta 12345. "],
  ]);
});

test("valida existência no WhatsApp antes de enviar", async () => {
  const { paths } = createFixture();
  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return null;
    },
    async sendMessage(to, message) {
      calls.push(["sendMessage", to, message]);
    },
  };

  validateRuntimeFiles(paths, { checkBrowser: false });
  await processCampaign(client, paths);

  assert.deepEqual(calls, [["getNumberId", "5519998240000"]]);
  assert.match(fs.readFileSync(paths.errors, "utf8"), /NAO_REGISTRADO/);
});

test("envia somente após validação positiva e registra variáveis ausentes", async () => {
  const { paths } = createFixture();
  const calls = [];
  const client = {
    async getNumberId(phone) {
      calls.push(["getNumberId", phone]);
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage(to, message) {
      calls.push(["sendMessage", to, message]);
    },
  };

  validateRuntimeFiles(paths, { checkBrowser: false });
  await processCampaign(client, paths);

  assert.deepEqual(calls, [
    ["getNumberId", "5519998240000"],
    ["sendMessage", "5519998240000@c.us", "Olá Maria, conta 12345. "],
  ]);
  assert.match(fs.readFileSync(paths.sent, "utf8"), /5519998240000/);
  assert.match(fs.readFileSync(paths.warnings, "utf8"), /VARIAVEL_AUSENTE;extra/);
});

test("erro de envio registra nome do cliente no detalhe", async () => {
  const { paths } = createFixture({
    template: "Olá ${nome}.",
  });
  const client = {
    async getNumberId(phone) {
      return { _serialized: `${phone}@c.us` };
    },
    async sendMessage() {
      throw new Error("Falha simulada no WhatsApp Web");
    },
  };

  validateRuntimeFiles(paths, { checkBrowser: false });
  await processCampaign(client, paths);

  const errors = fs.readFileSync(paths.errors, "utf8");
  assert.match(errors, /Cliente Maria: Falha simulada no WhatsApp Web/);
});

test("envia anexo local no ponto da notação markdown", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "arquivo.pdf");
  fs.writeFileSync(mediaPath, "conteúdo fictício", "utf8");

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    "Antes\n![](arquivo.pdf)\nDepois",
    paths,
  );

  assert.deepEqual(calls.map((call) => call.text || call.filename), [
    "Antes\n",
    "arquivo.pdf",
    "\nDepois",
  ]);
  assert.equal(calls[1].mimetype, "application/pdf");
  assert.equal(calls[1].options.sendMediaAsDocument, true);
  assert.equal(calls[1].options.waitUntilMsgSent, true);
});

test("envia anexo final com texto como legenda da mesma mensagem", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "arquivo.pdf");
  fs.writeFileSync(mediaPath, "conteúdo fictício", "utf8");

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    "Texto da mensagem\n![](arquivo.pdf)",
    paths,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, "arquivo.pdf");
  assert.equal(calls[0].options.caption, "Texto da mensagem");
  assert.equal(calls[0].options.sendMediaAsDocument, true);
  assert.equal(calls[0].options.waitUntilMsgSent, true);
});

test("envia anexo inicial com texto como legenda da mesma mensagem", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "imagem.png");
  fs.writeFileSync(mediaPath, "conteúdo fictício", "utf8");

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    "![](imagem.png)\nTexto da mensagem",
    paths,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, "imagem.png");
  assert.equal(calls[0].options.caption, "Texto da mensagem");
  assert.equal(calls[0].options.sendMediaAsDocument, false);
  assert.equal(calls[0].options.waitUntilMsgSent, true);
});

test("detecta OGG apenas de áudio", () => {
  const { paths } = createFixture();
  const audioPath = path.join(path.dirname(paths.template), "audio.ogg");
  const videoPath = path.join(path.dirname(paths.template), "video.ogg");
  const invalidPath = path.join(path.dirname(paths.template), "texto.ogg");

  fs.writeFileSync(audioPath, createFakeOggAudio());
  fs.writeFileSync(videoPath, createFakeOggVideo());
  fs.writeFileSync(invalidPath, "conteúdo sem ogg", "utf8");

  assert.equal(isOggAudioOnly(audioPath), true);
  assert.equal(isOggAudioOnly(videoPath), false);
  assert.equal(isOggAudioOnly(invalidPath), false);
});

test("envia OGG de áudio como mensagem de voz separada no ponto da notação", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "audio.ogg");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    "Antes\n![](audio.ogg)\nDepois",
    paths,
  );

  assert.deepEqual(calls.map((call) => call.text || call.filename), [
    "Antes\n",
    "audio.ogg",
    "\nDepois",
  ]);
  assert.deepEqual(calls[1].options, {
    sendAudioAsVoice: true,
    sendMediaAsDocument: false,
    waitUntilMsgSent: true,
  });
  assert.equal(calls[1].mimetype, "audio/ogg");
});

test("retry de OGG usa mídia nova e fallback para áudio comum após falha transitória de voz", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "audio.ogg");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const calls = [];
  const events = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });

      if (options && options.sendAudioAsVoice) {
        throw new Error("Protocol error (Runtime.callFunctionOn): Promise was collected");
      }
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    "Antes\n![](audio.ogg)\nDepois",
    paths,
    {
      onProgress: (event) => events.push(event.message),
    },
  );

  const mediaCalls = calls.filter((call) => call.filename === "audio.ogg");
  assert.equal(mediaCalls.length, 4);
  assert.deepEqual(mediaCalls.slice(0, 3).map((call) => call.options.sendAudioAsVoice), [
    true,
    true,
    true,
  ]);
  assert.equal(mediaCalls[3].options.sendAudioAsVoice, false);
  assert.equal(mediaCalls[3].options.sendMediaAsDocument, false);
  assert.equal(mediaCalls[3].options.waitUntilMsgSent, true);
  assert.match(events.join("\n"), /Enviando áudio audio\.ogg/);
  assert.match(events.join("\n"), /Retentando anexo audio\.ogg como áudio de voz/);
  assert.match(events.join("\n"), /Aguardando WhatsApp Web estabilizar/);
  assert.match(events.join("\n"), /tentando como áudio comum/);
});

test("erro de frame destacado é transitório e aguarda contexto do WhatsApp voltar", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "audio.ogg");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  let evaluates = 0;
  let sends = 0;
  const client = {
    pupPage: {
      async evaluate() {
        evaluates += 1;
        return true;
      },
      isClosed() {
        return false;
      },
    },
    async sendMessage() {
      sends += 1;

      if (sends === 1) {
        throw new Error("Attempted to use detached Frame 'ABC'.");
      }
    },
  };

  assert.equal(
    isTransientMediaSendError(new Error("Attempted to use detached Frame 'ABC'.")),
    true,
  );
  assert.equal(await waitForWhatsAppMediaContext(client), true);

  await sendRenderedTemplate(client, "5511999999999@c.us", "![](audio.ogg)", paths);

  assert.equal(sends, 2);
  assert.ok(evaluates >= 2);
});

test("envia OGG externo absoluto com espaços usando nome seguro de arquivo", async () => {
  const { root, paths } = createFixture();
  const externalDir = path.join(root, "..", "audios externos");
  const mediaPath = path.join(externalDir, "audio externo.ogg");

  fs.mkdirSync(externalDir, { recursive: true });
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const media = createMessageMediaFromFile(mediaPath);
  assert.equal(media.filename, "audio externo.ogg");
  assert.equal(media.mimetype, "audio/ogg");

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    `Antes\n![](${mediaPath})\nDepois`,
    paths,
  );

  assert.deepEqual(calls.map((call) => call.text || call.filename), [
    "Antes\n",
    "audio externo.ogg",
    "\nDepois",
  ]);
  assert.deepEqual(calls[1].options, {
    sendAudioAsVoice: true,
    sendMediaAsDocument: false,
    waitUntilMsgSent: true,
  });
  assert.equal(calls[1].mimetype, "audio/ogg");
});

test("não usa legenda automática para OGG de áudio no início ou final", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "audio.ogg");
  fs.writeFileSync(mediaPath, createFakeOggAudio());

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        mimetype: content && content.mimetype,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(
    client,
    "5511999999999@c.us",
    "Texto da mensagem\n![](audio.ogg)",
    paths,
  );

  assert.deepEqual(calls.map((call) => call.text || call.filename), [
    "Texto da mensagem\n",
    "audio.ogg",
  ]);
  assert.equal(calls[1].options.sendAudioAsVoice, true);
  assert.equal(calls[1].options.waitUntilMsgSent, true);
  assert.equal(calls[1].mimetype, "audio/ogg");
  assert.equal(calls[1].options.caption, undefined);
});

test("OGG que não é apenas áudio continua como documento", async () => {
  const { paths } = createFixture();
  const mediaPath = path.join(path.dirname(paths.template), "video.ogg");
  fs.writeFileSync(mediaPath, createFakeOggVideo());

  const calls = [];
  const client = {
    async sendMessage(to, content, options) {
      calls.push({
        filename: content && content.filename,
        options,
        text: typeof content === "string" ? content : undefined,
        to,
      });
    },
  };

  await sendRenderedTemplate(client, "5511999999999@c.us", "![](video.ogg)", paths);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, "video.ogg");
  assert.equal(calls[0].options.sendMediaAsDocument, true);
  assert.equal(calls[0].options.sendAudioAsVoice, undefined);
  assert.equal(calls[0].options.waitUntilMsgSent, true);
});

test("baixa URL de anexo uma única vez e reutiliza o cache", async () => {
  const { paths } = createFixture();
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.from("imagem fictícia"));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/anexo.png`;
    const client = {
      async sendMessage() {},
    };

    await sendRenderedTemplate(client, "5511999999999@c.us", `![](${url})`, paths);
    await sendRenderedTemplate(client, "5511999999999@c.us", `![](${url})`, paths);

    assert.equal(requests, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
