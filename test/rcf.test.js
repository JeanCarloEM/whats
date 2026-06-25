process.env.MIN_DELAY_MS = "0";
process.env.MAX_DELAY_MS = "0";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyListFilter,
  applyTemplate,
  buildSendPlan,
  buildPuppeteerConfig,
  createStatusReporter,
  evaluateExpression,
  evaluateFilterExpression,
  formatBrowserStartupError,
  formatNameForMessage,
  getBrowserExecutableNames,
  getExistingBrowserConnectionConfig,
  getInstalledBrowserCandidates,
  getLinuxBrowserCandidates,
  getMacBrowserCandidates,
  getTemplateFingerprint,
  getWhatsAppClientId,
  getWindowsBrowserCandidates,
  isOggAudioOnly,
  loadAlreadySent,
  loadClientes,
  loadCsv,
  loadSentRecords,
  materializeGuiExecutionPaths,
  parseExecutionOptions,
  parseExpression,
  parseTemplateParts,
  resolveExecutionPaths,
  resolveListCsvPath,
  resolveListSelection,
  resolveModelTemplatePath,
  processCampaign,
  resetSentLog,
  sendRenderedTemplate,
  toBoolean,
  sanitizePhone,
  validateGuiPayload,
  validateRuntimeFiles,
} = require("../main");

const COMPLEX_CLIENTS_CSV = path.join(__dirname, "clientes-complexos.csv");
const COMPLEX_EXPECTED_JSON = path.join(__dirname, "expressions-complexas.expected.json");

function createFixture(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whatsapp-rcf-"));
  const paths = {
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

test("interpreta notação markdown de anexo preservando a ordem", () => {
  const parts = parseTemplateParts("Antes\n![](arquivo.pdf)\nDepois");

  assert.deepEqual(parts, [
    { type: "text", value: "Antes\n" },
    { type: "media", source: "arquivo.pdf", raw: "![](arquivo.pdf)" },
    { type: "text", value: "\nDepois" },
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
  assert.equal(
    applyTemplate("Total: ${(valor+taxa)*2}", clientes[0]),
    "Total: 25",
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
      { caption: "Modelo Maria", sendMediaAsDocument: true },
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
  });
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
