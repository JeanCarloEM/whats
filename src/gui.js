// Autor: JeanCarloEM.com
// Site do Autor: https://jeancarloem.com
// Licenca: Mozilla Public License 2.0
// Site da Licenca: https://www.mozilla.org/MPL/2.0/
// Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
// Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { PATHS, ROOT_DIR } = require("./config");
const {
  AUTHOR,
  AUTHOR_URL,
  COMPLIANCE_NOTICE,
  DISCLAIMER,
  LICENSE_LOCAL_PATH,
  LICENSE_NAME,
  LICENSE_URL,
  REPOSITORY_URL,
} = require("./notice");
const { loadCsv, normalizeTextContent } = require("./data");
const { initLogFiles, resetSentLog } = require("./logs");
const { processCampaign, validateRuntimeFiles } = require("./campaign");
const { isUrl, validateTemplateMediaReferences } = require("./media");
const { parseListFilter } = require("./data");
const { inspectTemplateSyntax, parseTemplateParts } = require("./template");
const {
  createSession,
  listPersistedSessions,
  listSessions,
  renameSession,
  removeSession,
  resolveSessionByIdentifier,
  updateSessionPhone,
} = require("./sessions");
const { destroyWhatsAppClient, readClientPhone } = require("./whatsapp");

const GUI_HOST = "127.0.0.1";
const GUI_PORT = Number.parseInt(process.env.GUI_PORT || "3137", 10);
const GUI_PORT_ATTEMPTS = 20;
const GUI_RUNTIME_DIR = path.join(ROOT_DIR, ".runtime", "gui");
const MAX_JSON_BODY_BYTES = 15 * 1024 * 1024;

function registerGuiClientHandlers(client, basePaths = PATHS, baseOptions = {}) {
  const serverInfo = baseOptions.guiServerInfo;
  const state = serverInfo ? serverInfo.state : createGuiState(basePaths);

  client.on("qr", (qr) => {
    state.status = "autenticando";
    pushGuiLog(state, {
      message: "QR Code recebido. Escaneie no WhatsApp Web para continuar.",
      type: "warning",
    });
    console.log("Escaneie o QR Code no navegador do WhatsApp Web.");
    try {
      require("qrcode-terminal").generate(qr, { small: true });
    } catch (_) {
      console.log("QR Code recebido. Use a janela do navegador para autenticar.");
    }
  });

  client.on("loading_screen", (percent) => {
    state.status = "carregando_whatsapp";
    pushGuiLog(state, {
      message: `WhatsApp Web carregando${percent ? `: ${percent}%` : "."}`,
      type: "info",
    });
  });

  client.on("authenticated", () => {
    state.status = "autenticado";
    pushGuiLog(state, {
      message: "Sessão autenticada. Aguardando WhatsApp ficar pronto.",
      type: "info",
    });
  });

  client.on("ready", () => {
    state.status = "conectado";
    state.whatsappReady = true;
    updateSessionPhone(basePaths.activeSession, readClientPhone(client), basePaths);
    state.sessions = listSessions(basePaths);
    state.activeSession =
      state.sessions.find((session) => {
        return (
          basePaths.activeSession && session.id === basePaths.activeSession.id
        );
      }) || state.activeSession;
    pushGuiLog(state, {
      message: "WhatsApp conectado. A execução já pode ser configurada.",
      type: "sent",
    });
    console.log("WhatsApp conectado.");
  });

  client.on("auth_failure", (msg) => {
    state.status = "falha_autenticacao";
    state.lastError = String(msg || "Falha de autenticação.");
    pushGuiLog(state, {
      message: `Falha de autenticação: ${state.lastError}`,
      type: "error",
    });
    console.error("Falha de autenticação:", msg);
    process.exitCode = 1;
  });

  client.on("disconnected", (reason) => {
    state.status = "desconectado";
    state.whatsappReady = false;
    pushGuiLog(state, {
      message: `WhatsApp desconectado: ${reason}`,
      type: "error",
    });
    console.error("Desconectado:", reason);
  });
}

function startGuiServer(client, basePaths = PATHS, baseOptions = {}) {
  const state = createGuiState(basePaths);
  return listenGuiServer(client, basePaths, baseOptions, state, GUI_PORT, 0);
}

function createGuiHttpServer(client, basePaths, baseOptions, state) {
  let server;

  server = http.createServer((req, res) => {
    routeGuiRequest(req, res, {
      baseOptions,
      basePaths,
      client,
      server,
      state,
    }).catch((err) => {
      sendJson(res, 500, {
        error: err.message || String(err),
        ok: false,
      });
    });
  });

  return server;
}

function listenGuiServer(client, basePaths, baseOptions, state, port, attempt) {
  const server = createGuiHttpServer(client, basePaths, baseOptions, state);

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE" && attempt < GUI_PORT_ATTEMPTS - 1) {
        server.close(() => {
          listenGuiServer(
            client,
            basePaths,
            baseOptions,
            state,
            port + 1,
            attempt + 1,
          ).then(resolve, reject);
        });
        return;
      }

      reject(err);
    });

    server.listen(port, GUI_HOST, () => {
      if (attempt > 0) {
        const message = `Porta ${GUI_PORT} ocupada. Interface local aberta na porta ${server.address().port}.`;
        console.log(message);
        pushGuiLog(state, {
          message,
          type: "warning",
        });
      }

      resolve({
        server,
        state,
        url: `http://${GUI_HOST}:${server.address().port}/`,
      });
    });
  });
}

function createGuiState(paths = PATHS) {
  return {
    activeSession: paths.activeSession || null,
    busy: false,
    finishedAt: null,
    lastError: "",
    log: [],
    startedAt: null,
    status: "iniciando_whatsapp",
    sessions: listSessions(paths),
    whatsappReady: false,
  };
}

async function routeGuiRequest(req, res, context) {
  const url = new URL(req.url, `http://${GUI_HOST}`);

  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, renderGuiHtml());
    return;
  }

  if (req.method === "GET" && url.pathname === "/license") {
    sendText(res, readOptionalFile(path.join(ROOT_DIR, "LICENSE")) || "LICENSE não encontrada.");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runtime/identity") {
    sendJson(res, 200, {
      ok: true,
      runtime: context.baseOptions.guiRuntime
        ? context.baseOptions.guiRuntime.publicRecord
        : context.state.runtime || null,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    context.state.sessions = listSessions(context.basePaths);
    sendJson(res, 200, {
      ok: true,
      state: context.state,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runtime/shutdown") {
    const payload = await readJsonBody(req);
    const runtime = context.baseOptions.guiRuntime;

    if (!runtime || payload.token !== runtime.record.token) {
      sendJson(res, 403, {
        error: "Encerramento local não autorizado.",
        ok: false,
      });
      return;
    }

    sendJson(res, 202, {
      message: "Encerrando instância local.",
      ok: true,
    });
    setTimeout(() => {
      shutdownCurrentGuiProcess(context, payload.reason).catch((err) => {
        context.state.lastError = err.message || String(err);
        context.state.status = "erro";
      });
    }, 50);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sessions/switch") {
    const payload = await readJsonBody(req);
    const sessionId = String(payload.sessionId || "").trim();

    if (!sessionId) {
      sendJson(res, 400, {
        error: "Selecione uma sessão.",
        ok: false,
      });
      return;
    }

    if (context.state.busy) {
      sendJson(res, 409, {
        error: "Não é possível alternar sessão durante um processamento.",
        ok: false,
      });
      return;
    }

    sendJson(res, 202, {
      message: "Alternando sessão. A janela será reaberta.",
      ok: true,
    });
    scheduleGuiRestart(context, sessionId);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sessions/create") {
    const payload = await readJsonBody(req);
    const name = String(payload.name || "").trim();

    if (!name) {
      sendJson(res, 400, {
        error: "Informe um nome para a nova sessão.",
        ok: false,
      });
      return;
    }

    if (context.state.busy) {
      sendJson(res, 409, {
        error: "Não é possível criar sessão durante um processamento.",
        ok: false,
      });
      return;
    }

    const session = createSession(name, context.basePaths);
    context.state.sessions = listSessions(context.basePaths);
    sendJson(res, 201, {
      message: "Sessão criada. Alternando para autenticação.",
      ok: true,
      session,
    });
    scheduleGuiRestart(context, session.id);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sessions/rename") {
    const payload = await readJsonBody(req);
    const sessionId = String(payload.sessionId || "").trim();
    const name = String(payload.name || "").trim();

    if (!sessionId || !name) {
      sendJson(res, 400, {
        error: "Informe a sessão e o novo nome.",
        ok: false,
      });
      return;
    }

    const session = renameSession(sessionId, name, context.basePaths);
    context.state.sessions = listSessions(context.basePaths);

    if (context.state.activeSession && context.state.activeSession.id === session.id) {
      context.state.activeSession = session;
    }

    sendJson(res, 200, {
      message: "Sessão renomeada.",
      ok: true,
      session,
      sessions: context.state.sessions,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sessions/remove") {
    const payload = await readJsonBody(req);
    const sessionId = String(payload.sessionId || "").trim();

    if (!sessionId) {
      sendJson(res, 400, {
        error: "Informe a sessão que será removida.",
        ok: false,
      });
      return;
    }

    if (context.state.busy) {
      sendJson(res, 409, {
        error: "Não é possível remover sessão durante um processamento.",
        ok: false,
      });
      return;
    }

    const targetSession = resolveSessionByIdentifier(
      sessionId,
      listSessions(context.basePaths),
    );
    const activeRemoved =
      context.state.activeSession &&
      context.state.activeSession.id === targetSession.id;

    if (!activeRemoved) {
      const result = removeSession(targetSession.id, context.basePaths);
      context.state.sessions = listSessions(context.basePaths);
      sendJson(res, 200, {
        activeRemoved: false,
        message: "Sessão removida.",
        ok: true,
        remainingPersisted: result.remainingPersisted,
        removed: result.removed,
        sessions: context.state.sessions,
      });
      return;
    }

    const remainingPersisted = listPersistedSessions(context.basePaths).filter(
      (session) => session.id !== targetSession.id,
    );

    sendJson(res, 200, {
      activeRemoved: true,
      message: "Sessão ativa será removida após fechar o WhatsApp com segurança.",
      ok: true,
      remainingPersisted,
      removed: targetSession,
      sessions: listSessions(context.basePaths),
    });

    scheduleActiveSessionRemoval(context, targetSession.id, remainingPersisted[0]);

    return;
  }

  if (req.method === "POST" && url.pathname === "/api/validate") {
    const payload = await readJsonBody(req);
    const result = validateGuiPayload(payload, context.basePaths);
    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/template/analyze") {
    const payload = await readJsonBody(req);
    const result = analyzeGuiTemplateMedia(payload, context.basePaths);
    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    const payload = await readJsonBody(req);
    const validation = validateGuiPayload(payload, context.basePaths);

    if (!validation.ok) {
      sendJson(res, 400, validation);
      return;
    }

    if (
      validation.syntaxIssues &&
      validation.syntaxIssues.length > 0 &&
      !payload.confirmTemplateSyntaxIssues
    ) {
      sendJson(res, 409, {
        error: "Confirme os possíveis erros de sintaxe do modelo antes de enviar.",
        ok: false,
        syntaxIssues: validation.syntaxIssues,
      });
      return;
    }

    if (context.state.busy) {
      sendJson(res, 409, {
        error: "Já existe um processamento em andamento.",
        ok: false,
      });
      return;
    }

    if (!context.state.whatsappReady) {
      sendJson(res, 409, {
        error: "Aguarde o WhatsApp conectar antes de executar.",
        ok: false,
      });
      return;
    }

    runGuiCampaign(payload, context).catch((err) => {
      context.state.busy = false;
      context.state.finishedAt = new Date().toISOString();
      context.state.lastError = err.message || String(err);
      context.state.status = "erro";
      pushGuiLog(context.state, {
        message: `Processamento interrompido: ${context.state.lastError}`,
        type: "error",
      });
    });

    sendJson(res, 202, {
      message: "Processamento iniciado.",
      ok: true,
    });
    return;
  }

  sendJson(res, 404, {
    error: "Rota não encontrada.",
    ok: false,
  });
}

async function runGuiCampaign(payload, context) {
  const { state } = context;
  state.busy = true;
  state.finishedAt = null;
  state.lastError = "";
  state.log = [];
  state.startedAt = new Date().toISOString();
  state.status = "validando";

  const executionPaths = materializeGuiExecutionPaths(payload, context.basePaths);
  const options = {
    ...context.baseOptions,
    forceResend: Boolean(payload.forceResend),
    onProgress: (event) => pushGuiLog(state, event),
    resetSent: Boolean(payload.resetSent),
  };

  pushGuiLog(state, {
    message: "Validando arquivos e parâmetros.",
    type: "info",
  });

  const validation = validateRuntimeFiles(executionPaths, {
    checkBrowser: false,
  });

  pushGuiLog(state, {
    message: `Pré-validação RCF concluída. Clientes: ${validation.clientesCount}.`,
    type: "info",
  });

  if (options.resetSent) {
    resetSentLog(executionPaths.sent);
    pushGuiLog(state, {
      message: "Lista de enviados resetada.",
      type: "warning",
    });
  }

  if (options.forceResend) {
    pushGuiLog(state, {
      message: "Reenvio forçado ativo: histórico será ignorado nesta execução.",
      type: "warning",
    });
  }

  state.status = "executando";
  await processCampaign(context.client, executionPaths, options);
  state.busy = false;
  state.finishedAt = new Date().toISOString();
  state.status = "concluido";
  state.whatsappReady = true;
}

function materializeGuiExecutionPaths(payload, basePaths = PATHS) {
  fs.mkdirSync(GUI_RUNTIME_DIR, { recursive: true });

  const paths = {
    ...basePaths,
    mediaCacheDir: path.join(os.tmpdir(), "whatsapp-rcf-media"),
  };

  const templateText = String(payload.templateText || "");
  const templateFileContent = payload.templateFile
    ? String(payload.templateFile.content || "")
    : "";

  if (templateText.trim() || templateFileContent.trim()) {
    const explicitTemplateBaseDir = resolveGuiTemplateBaseDir(payload.templateBaseDir);
    const templatePath = path.join(GUI_RUNTIME_DIR, "template.md");
    fs.writeFileSync(
      templatePath,
      normalizeTextContent(templateText.trim() ? templateText : templateFileContent),
      "utf8",
    );
    paths.template = templatePath;

    if (explicitTemplateBaseDir) {
      paths.templateBaseDir = explicitTemplateBaseDir;
    } else if (templateText.trim()) {
      paths.templateBaseDir = ROOT_DIR;
    } else {
      const providedTemplatePath = resolveGuiProvidedFilePath(payload.templateFile);
      if (providedTemplatePath) {
        paths.templateBaseDir = path.dirname(providedTemplatePath);
      } else {
        delete paths.templateBaseDir;
      }
    }
  }

  if (payload.csvFile && String(payload.csvFile.content || "").trim()) {
    const csvPath = path.join(GUI_RUNTIME_DIR, "clientes.csv");
    fs.writeFileSync(csvPath, normalizeTextContent(payload.csvFile.content || ""), "utf8");
    paths.csv = csvPath;
  }

  const filter = String(payload.filter || "").trim();

  if (filter) {
    paths.listFilter = parseListFilter(filter);
  }

  return paths;
}

function validateGuiPayload(payload = {}, basePaths = PATHS) {
  const errors = [];
  const templateText = String(payload.templateText || "");
  const templateFile = payload.templateFile || null;
  const csvFile = payload.csvFile || null;
  const filter = String(payload.filter || "").trim();
  validateGuiTemplateBaseDir(payload.templateBaseDir, errors);

  if (templateText.trim() && templateFile && String(templateFile.content || "").trim()) {
    errors.push("Use apenas uma fonte de modelo: textarea ou arquivo .md.");
  }

  if (templateFile) {
    validateNamedTextFile(templateFile, ".md", "Arquivo de modelo", errors);
  }

  if (csvFile) {
    validateNamedTextFile(csvFile, ".csv", "Arquivo de clientes", errors);
  }

  const templateCandidate =
    templateText.trim() ||
    (templateFile && String(templateFile.content || "").trim()) ||
    readOptionalFile(basePaths.template);

  const syntaxIssues = inspectTemplateSyntax(templateCandidate);

  if (filter) {
    try {
      const parsed = parseListFilter(filter);

      if (!parsed) {
        errors.push("Filtro inválido: informe uma expressão comparável, como status=ativo.");
      }
    } catch (err) {
      errors.push(`Filtro inválido: ${err.message}`);
    }
  }

  if (csvFile && String(csvFile.content || "").trim()) {
    const tmpPath = path.join(GUI_RUNTIME_DIR, "prevalidate-clientes.csv");
    try {
      fs.mkdirSync(GUI_RUNTIME_DIR, { recursive: true });
      fs.writeFileSync(tmpPath, normalizeTextContent(csvFile.content || ""), "utf8");
      loadCsv(tmpPath);
    } catch (err) {
      errors.push(err.message);
    }
  }

  return errors.length
    ? { errors, ok: false, syntaxIssues }
    : {
        message: syntaxIssues.length
          ? "Validação preliminar aprovada com avisos de sintaxe no modelo."
          : "Validação preliminar aprovada.",
        ok: true,
        syntaxIssues,
      };
}

function analyzeGuiTemplateMedia(payload = {}, basePaths = PATHS) {
  const errors = [];
  const templateText = String(payload.templateText || "");
  const templateFile = payload.templateFile || null;
  const templateFileContent = templateFile ? String(templateFile.content || "") : "";
  const templateCandidate =
    templateText.trim() ||
    templateFileContent.trim() ||
    "";
  const explicitTemplateBaseDir = validateGuiTemplateBaseDir(
    payload.templateBaseDir,
    errors,
  );

  if (!templateCandidate.trim()) {
    return {
      errors,
      mediaIssues: [],
      ok: errors.length === 0,
    };
  }

  const providedTemplatePath = resolveGuiProvidedFilePath(templateFile);
  const templatePath = providedTemplatePath || path.join(GUI_RUNTIME_DIR, "template.md");
  const templateBaseDir =
    explicitTemplateBaseDir ||
    (templateText.trim()
      ? ROOT_DIR
      : providedTemplatePath
        ? path.dirname(providedTemplatePath)
        : undefined);
  const mediaIssues = validateTemplateMediaReferences(
    normalizeTextContent(templateCandidate),
    {
      ...basePaths,
      root: basePaths.root || ROOT_DIR,
      template: templatePath,
      ...(templateBaseDir ? { templateBaseDir } : {}),
    },
  );
  const localMediaCount = parseTemplateParts(templateCandidate)
    .filter((part) => part.type === "media" && !isUrl(part.source))
    .length;

  return {
    errors,
    localMediaCount,
    mediaIssues,
    ok: errors.length === 0,
    needsTemplateBaseDir: mediaIssues.length > 0 && !explicitTemplateBaseDir,
  };
}

function validateNamedTextFile(file, extension, label, errors) {
  const name = String(file.name || "").trim();
  const content = String(file.content || "");

  if (!name) {
    errors.push(`${label}: nome ausente.`);
    return;
  }

  if (path.extname(name).toLocaleLowerCase("pt-BR") !== extension) {
    errors.push(`${label}: use um arquivo ${extension}.`);
  }

  if (!content.trim()) {
    errors.push(`${label}: arquivo vazio.`);
  }
}

function resolveGuiProvidedFilePath(file) {
  if (!file) {
    return "";
  }

  for (const key of ["path", "fullPath", "name"]) {
    const rawPath = String(file[key] || "").trim();

    if (!rawPath || /^([a-z]:)?[\\/]+fakepath[\\/]/iu.test(rawPath)) {
      continue;
    }

    if (path.isAbsolute(rawPath)) {
      return path.normalize(rawPath);
    }

    if (rawPath.includes("/") || rawPath.includes("\\")) {
      return path.resolve(ROOT_DIR, rawPath);
    }
  }

  return "";
}

function resolveGuiTemplateBaseDir(value) {
  const rawValue = String(value || "")
    .trim()
    .replace(/^["'](.+)["']$/, "$1")
    .trim();

  if (!rawValue) {
    return "";
  }

  return path.isAbsolute(rawValue)
    ? path.normalize(rawValue)
    : path.resolve(ROOT_DIR, rawValue);
}

function validateGuiTemplateBaseDir(value, errors = []) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  if (rawValue.includes("\0")) {
    errors.push("Pasta de referência dos anexos inválida.");
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(rawValue)) {
    errors.push("Pasta de referência dos anexos deve ser um diretório local, não URL.");
    return "";
  }

  const resolvedPath = resolveGuiTemplateBaseDir(rawValue);

  if (!fs.existsSync(resolvedPath)) {
    errors.push(`Pasta de referência dos anexos não encontrada: ${resolvedPath}`);
    return "";
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    errors.push(`Pasta de referência dos anexos não é um diretório: ${resolvedPath}`);
    return "";
  }

  return resolvedPath;
}

function readOptionalFile(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  } catch (_) {
    return "";
  }
}

function pushGuiLog(state, event) {
  const entry = {
    at: new Date().toISOString(),
    message: event.message || "",
    type: event.type || "info",
    ...(event.current ? { current: event.current } : {}),
    ...(event.total ? { total: event.total } : {}),
  };

  state.log.push(entry);

  if (state.log.length > 300) {
    state.log.splice(0, state.log.length - 300);
  }
}

function scheduleGuiRestart(context, sessionId) {
  context.state.status = "reiniciando_sessao";
  context.state.whatsappReady = false;
  pushGuiLog(context.state, {
    message: "Reiniciando para alternar a sessão do WhatsApp.",
    type: "warning",
  });

  setTimeout(() => {
    restartGuiProcess(context, sessionId).catch((err) => {
      context.state.status = "erro";
      context.state.lastError = err.message;
      pushGuiLog(context.state, {
        message: `Falha ao alternar sessão: ${err.message}`,
        type: "error",
      });
    });
  }, 250);
}

function scheduleActiveSessionRemoval(context, sessionId, nextSession) {
  context.state.status = "reiniciando_sessao";
  context.state.whatsappReady = false;
  pushGuiLog(context.state, {
    message: "Fechando WhatsApp antes de remover a sessão ativa.",
    type: "warning",
  });

  setTimeout(() => {
    restartGuiProcess(context, nextSession ? nextSession.id : "", {
      beforeSpawn: async () => {
        removeSession(sessionId, context.basePaths);
      },
      destroyFailureMessage:
        "A sessão ativa não foi removida porque o navegador não fechou com segurança.",
    }).catch((err) => {
      context.state.status = "erro";
      context.state.lastError = err.message;
      pushGuiLog(context.state, {
        message: `Falha ao remover sessão ativa: ${err.message}`,
        type: "error",
      });
    });
  }, 250);
}

async function restartGuiProcess(context, sessionId, options = {}) {
  const args = [path.join(ROOT_DIR, "main.js"), "--gui"];

  if (sessionId) {
    args.push("--session", sessionId);
  }

  const destroyResult = await destroyWhatsAppClient(context.client);

  if (!destroyResult.destroyed && options.beforeSpawn) {
    throw new Error(
      options.destroyFailureMessage ||
        "O navegador não fechou com segurança; operação cancelada para preservar a sessão.",
    );
  }

  if (options.beforeSpawn) {
    await options.beforeSpawn();
  }

  await closeServer(context.server);

  const child = childProcess.spawn(process.execPath, args, {
    cwd: ROOT_DIR,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
  process.exit(0);
}

async function shutdownCurrentGuiProcess(context, reason) {
  context.state.status = "encerrando";
  context.state.whatsappReady = false;
  pushGuiLog(context.state, {
    message:
      reason === "scripts_changed"
        ? "Encerrando instância para carregar scripts atualizados."
        : "Encerrando instância local.",
    type: "warning",
  });

  await destroyWhatsAppClient(context.client);

  await closeServer(context.server);

  if (
    context.baseOptions.guiRuntime &&
    typeof context.baseOptions.guiRuntime.stop === "function"
  ) {
    context.baseOptions.guiRuntime.stop();
  }

  process.exit(0);
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_JSON_BODY_BYTES) {
        req.destroy(new Error("Payload grande demais."));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`JSON inválido: ${err.message}`));
      }
    });

    req.on("error", reject);
  });
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(html);
}

function sendText(res, text) {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(text);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function openGuiInBrowser(client, url) {
  if (client && client.pupBrowser && typeof client.pupBrowser.newPage === "function") {
    try {
      const page = await client.pupBrowser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return "controlled";
    } catch (_) {
      // Se a aba no browser controlado falhar, tenta o navegador padrão.
    }
  }

  openSystemBrowser(url);
  return "system";
}

function openGuiWhenBrowserIsAvailable(client, url, state, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs || 20000;
  const intervalMs = options.intervalMs || 250;

  pushGuiLog(state, {
    message: "Interface local iniciada. Abrindo junto ao navegador do WhatsApp quando possível.",
    type: "info",
  });

  const timer = setInterval(async () => {
    if (state.guiOpened) {
      clearInterval(timer);
      return;
    }

    if (client && client.pupBrowser) {
      state.guiOpened = true;
      clearInterval(timer);

      try {
        const target = await openGuiInBrowser(client, url);
        pushGuiLog(state, {
          message:
            target === "controlled"
              ? "Interface aberta no mesmo navegador controlado pelo WhatsApp."
              : "Interface aberta no navegador padrão.",
          type: target === "controlled" ? "info" : "warning",
        });
      } catch (err) {
        state.guiOpened = false;
        pushGuiLog(state, {
          message: `Não foi possível abrir no navegador controlado: ${err.message}`,
          type: "warning",
        });
      }

      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      state.guiOpened = true;
      clearInterval(timer);
      openSystemBrowser(url);
      pushGuiLog(state, {
        message: "Interface aberta no navegador padrão. O navegador do WhatsApp ainda não estava disponível.",
        type: "warning",
      });
    }
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return timer;
}

function openSystemBrowser(url) {
  const platform = os.platform();
  const command =
    platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];

  const child = childProcess.spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

function renderGuiHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Disparador WhatsApp</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #667085;
      --line: #d8dde6;
      --accent: #087f5b;
      --accent-strong: #046c4e;
      --danger: #b42318;
      --warn: #a15c07;
      --info: #175cd3;
      --ok: #067647;
      --focus: rgba(8, 127, 91, 0.18);
      --font-sans: "Noto Sans", "Segoe UI", Roboto, Helvetica, Arial, system-ui, -apple-system, BlinkMacSystemFont, "Liberation Sans", sans-serif;
      --shadow: 0 14px 36px rgba(21, 30, 43, 0.07);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.52 var(--font-sans);
    }

    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 34px;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: 27px;
      line-height: 1.15;
    }

    h2 {
      margin: 0 0 14px;
      font-size: 16px;
    }

    p {
      margin: 0;
      color: var(--muted);
    }

    .status-pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--accent-strong);
      background: #eefbf4;
      padding: 7px 12px;
      white-space: nowrap;
      font-weight: 700;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.72);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      gap: 16px;
      align-items: start;
    }

    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 17px;
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-weight: 700;
      margin-bottom: 8px;
    }

    textarea,
    input[type="text"],
    input[type="file"],
    select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      font: inherit;
      padding: 11px 12px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    textarea:focus,
    input[type="text"]:focus,
    input[type="file"]:focus,
    select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--focus);
      outline: none;
    }

    textarea {
      min-height: 205px;
      resize: vertical;
      font-family: var(--font-sans);
      font-size: 14px;
    }

    .hint {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }

    .hint strong {
      color: var(--text);
    }

    .field-message {
      border-radius: 8px;
      display: none;
      font-size: 13px;
      margin-top: 8px;
      padding: 9px 10px;
    }

    .field-message.error {
      display: block;
      background: #fff1f0;
      border: 1px solid #fecdca;
      color: var(--danger);
    }

    .field-message.ok {
      display: block;
      background: #ecfdf3;
      border: 1px solid #abefc6;
      color: var(--ok);
    }

    .field-message.info {
      display: block;
      background: #eff8ff;
      border: 1px solid #b2ddff;
      color: #175cd3;
    }

    .template-base-dir {
      display: none;
      margin-top: 10px;
    }

    .template-base-dir.visible {
      display: block;
    }

    .syntax-demo {
      border: 1px solid var(--line);
      border-radius: 8px;
      display: grid;
      gap: 0;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      margin-top: 10px;
      overflow: hidden;
    }

    .syntax-demo div {
      padding: 9px 10px;
      background: #fff;
    }

    .syntax-demo div:nth-child(odd) {
      background: #f8fafc;
      border-right: 1px solid var(--line);
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }

    details.hint {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 11px;
      background: #fbfcfe;
    }

    details.hint summary {
      cursor: pointer;
      font-weight: 700;
    }

    .compliance-notice {
      background: #fff1f0;
      border: 1px solid #fecdca;
      border-left: 4px solid var(--danger);
      border-radius: 8px;
      color: #7a271a;
      display: grid;
      gap: 8px;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.45;
      margin: 12px 0;
      padding: 11px 12px;
    }

    .compliance-notice p {
      margin: 0;
    }

    .compliance-notice strong {
      color: #7a271a;
      font-weight: 900;
    }

    .emoji-list {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }

    .emoji-list span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 9px;
      background: #fff;
      white-space: nowrap;
      font-size: 12px;
    }

    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }

    .session-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      gap: 10px;
      align-items: end;
    }

    .checks label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-weight: 600;
    }

    button {
      appearance: none;
      border: 0;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 800;
      min-height: 44px;
      padding: 0 18px;
    }

    button:hover { background: var(--accent-strong); }
    button:disabled { cursor: not-allowed; opacity: 0.55; }

    .icon-button {
      min-width: 44px;
      padding: 0 12px;
      font-size: 18px;
      line-height: 1;
    }

    .danger-button {
      background: var(--danger);
    }

    .danger-button:hover {
      background: #912018;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 15px;
    }

    .message {
      border-radius: 8px;
      margin-top: 14px;
      padding: 10px 12px;
      display: none;
    }

    .message.error {
      display: block;
      background: #fff1f0;
      color: var(--danger);
      border: 1px solid #fecdca;
    }

    .message.ok {
      display: block;
      background: #ecfdf3;
      color: var(--ok);
      border: 1px solid #abefc6;
    }

    .log {
      display: grid;
      gap: 8px;
      max-height: 520px;
      overflow: auto;
      padding-right: 4px;
    }

    .log-row {
      border: 1px solid var(--line);
      border-left: 4px solid var(--info);
      border-radius: 8px;
      padding: 9px 10px;
      background: #fff;
      font-size: 13px;
    }

    .log-row.sent { border-left-color: var(--ok); }
    .log-row.skip, .log-row.warning, .log-row.wait { border-left-color: var(--warn); }
    .log-row.error { border-left-color: var(--danger); }

    .log-time {
      color: var(--muted);
      display: block;
      font-size: 12px;
      margin-bottom: 2px;
    }

    @media (max-width: 860px) {
      header,
      .layout,
      .split {
        grid-template-columns: 1fr;
        display: grid;
      }

      header {
        align-items: start;
      }

      .syntax-demo {
        grid-template-columns: 1fr;
      }

      .syntax-demo div:nth-child(odd) {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Disparador WhatsApp</h1>
        <p>Acompanhe a conexão do WhatsApp e configure a execução local.</p>
      </div>
      <div class="status-pill" id="statusPill">Aguardando</div>
    </header>

    <div class="layout">
      <form id="runForm">
        <section>
          <h2>Sessão</h2>
          <div class="session-row">
            <div>
              <label for="sessionSelect">WhatsApp</label>
              <select id="sessionSelect"></select>
            </div>
            <button id="newSessionButton" class="icon-button" type="button" title="Criar sessão" aria-label="Criar sessão">+</button>
            <button id="renameSessionButton" class="icon-button" type="button" title="Renomear sessão" aria-label="Renomear sessão">✎</button>
            <button id="removeSessionButton" class="icon-button danger-button" type="button" title="Remover sessão" aria-label="Remover sessão">−</button>
          </div>
          <div class="hint">Ao alternar, criar ou remover a sessão ativa, o WhatsApp é reiniciado automaticamente. Se a última sessão for removida, a próxima abertura volta ao QR Code.</div>
        </section>

        <section>
          <h2>Licença</h2>
          <p><strong>Autor:</strong> <a href="${AUTHOR_URL}" target="_blank" rel="noreferrer">${AUTHOR}</a></p>
          <p><strong>Repositório:</strong> <a href="${REPOSITORY_URL}" target="_blank" rel="noreferrer">${REPOSITORY_URL}</a></p>
          <p><strong>Licença:</strong> <a href="/license" target="_blank" rel="noreferrer">${LICENSE_NAME}</a> <span class="hint">(${LICENSE_LOCAL_PATH}; <a href="${LICENSE_URL}" target="_blank" rel="noreferrer">${LICENSE_URL}</a>)</span></p>
          <div class="compliance-notice" role="note" aria-label="Aviso legal">${renderComplianceNoticeHtml()}</div>
          <div class="hint">${DISCLAIMER}</div>
        </section>

        <section>
          <h2>Modelo de mensagem</h2>
          <label for="templateText">Texto do modelo</label>
          <textarea id="templateText" spellcheck="false" placeholder="$diatarde$, \${nome}.&#10;&#10;Seu valor atualizado é \${(valor+taxa)}."></textarea>
          <div class="hint">\${campo} aceita colunas/expressões. Pode usar emoji, listas 1., 2., - e *, e marcação textual com o marcador colado na palavra. Anexos em ![](arquivo.pdf) usam a pasta do modelo quando disponível; se o navegador ocultar a pasta, use a raiz do projeto ou fullpath.</div>
          <div class="syntax-demo" aria-label="Demonstração de sintaxe textual">
            <div>*negrito exemplo*</div>
            <div><strong>negrito exemplo</strong></div>
            <div>_itálico exemplo_</div>
            <div><em>itálico exemplo</em></div>
            <div>~taxado exemplo~</div>
            <div><s>taxado exemplo</s></div>
          </div>
          <details class="hint">
            <summary>Emojis profissionais</summary>
            <div class="emoji-list">
              <span>⚠️ alerta</span>
              <span>✅ concluído</span>
              <span>❌ erro</span>
              <span>📋 lista</span>
              <span>👍 ok</span>
              <span>ℹ️ informação</span>
              <span>📌 destaque</span>
              <span>⏰ prazo</span>
              <span>⏱️ economia de tempo</span>
              <span>📎 anexo</span>
              <span>💬 resposta</span>
              <span>🚀 lançamento</span>
              <span>🎯 objetivo</span>
              <span>💡 ideia</span>
              <span>🏷️ preço baixo</span>
              <span>💸 baixo custo</span>
              <span>♻️ economia de recursos</span>
              <span>📦 entrega</span>
              <span>📈 crescimento</span>
              <span>🤝 parceria</span>
              <span>🆗 aprovado</span>
              <span>☑️ confirmado</span>
              <span>🔔 lembrete</span>
              <span>📣 anúncio</span>
              <span>📢 comunicado</span>
              <span>📲 contato</span>
              <span>📞 ligação</span>
              <span>✉️ email</span>
              <span>📝 cadastro</span>
              <span>📄 documento</span>
              <span>🧾 comprovante</span>
              <span>💳 pagamento</span>
              <span>💰 valor</span>
              <span>🎁 brinde</span>
              <span>🔥 oferta</span>
              <span>⭐ favorito</span>
              <span>🛒 compra</span>
              <span>🛍️ pedido</span>
              <span>🚚 frete</span>
              <span>🔒 seguro</span>
              <span>🔐 acesso</span>
              <span>🛠️ suporte</span>
              <span>🧩 solução</span>
              <span>📊 relatório</span>
              <span>📉 redução</span>
              <span>🧮 cálculo</span>
              <span>📅 agenda</span>
              <span>🗓️ data</span>
              <span>⌛ aguardando</span>
              <span>🔄 atualização</span>
              <span>⬆️ aumento</span>
              <span>⬇️ desconto</span>
              <span>➡️ próximo passo</span>
              <span>✨ novidade</span>
              <span>🎉 comemoração</span>
              <span>🏆 conquista</span>
              <span>💎 premium</span>
              <span>🙏 agradecimento</span>
              <span>🙂 cordialidade</span>
              <span>😔 atenção empática</span>
            </div>
          </details>
          <div style="height:14px"></div>
          <label for="templateFile">Ou arquivo .md</label>
          <input id="templateFile" type="file" accept=".md,text/markdown,text/plain">
          <div id="templateMediaStatus" class="field-message"></div>
          <div id="templateBaseDirBox" class="template-base-dir">
            <label for="templateBaseDir">Pasta de referência dos anexos</label>
            <input id="templateBaseDir" type="text" placeholder="C:/LOCAL/whatsapp/anexos">
            <div class="hint">Use quando o navegador não conseguir informar a pasta real do .md. Deve ser um diretório local existente.</div>
          </div>
        </section>

        <section>
          <div class="split">
            <div>
              <h2>Filtro</h2>
              <label for="filter">Expressão</label>
              <input id="filter" type="text" placeholder="status=ativo && valor>=100">
              <div class="hint">Suporta =, !=, &lt;, &lt;=, &gt;, &gt;=, &&, ||, ^^, !, funções $.isnum(campo) e matemática simples.</div>
            </div>
            <div>
              <h2>Base de clientes</h2>
              <label for="csvFile">Arquivo .csv opcional</label>
              <input id="csvFile" type="file" accept=".csv,text/csv,text/plain">
              <div class="hint">CSV com cabeçalho; colunas obrigatórias: nome e telefone. Outras colunas podem ser usadas em \${campo}.</div>
            </div>
          </div>
        </section>

        <section>
          <h2>Execução</h2>
          <div class="checks">
            <label><input id="forceResend" type="checkbox"> Reenviar ignorando histórico</label>
            <label><input id="resetSent" type="checkbox"> Limpar histórico antes de enviar</label>
          </div>
          <div class="actions">
            <button id="runButton" type="submit">Executar</button>
            <p id="summary">Usa os arquivos padrão quando nenhum substituto é informado.</p>
          </div>
          <div id="message" class="message"></div>
        </section>
      </form>

      <aside>
        <section>
          <h2>Andamento</h2>
          <div class="log" id="log"></div>
        </section>
      </aside>
    </div>
  </main>

  <script>
    const form = document.getElementById("runForm");
    const button = document.getElementById("runButton");
    const message = document.getElementById("message");
    const log = document.getElementById("log");
    const statusPill = document.getElementById("statusPill");
    const sessionSelect = document.getElementById("sessionSelect");
    const newSessionButton = document.getElementById("newSessionButton");
    const renameSessionButton = document.getElementById("renameSessionButton");
    const removeSessionButton = document.getElementById("removeSessionButton");
    const templateFileInput = document.getElementById("templateFile");
    const templateBaseDirInput = document.getElementById("templateBaseDir");
    const templateBaseDirBox = document.getElementById("templateBaseDirBox");
    const templateMediaStatus = document.getElementById("templateMediaStatus");
    let activeSessionId = "";
    let lastSessionCount = 0;
    let knownSessions = [];
    let pollTimer = null;
    let templateAnalysisTimer = null;
    let templateAnalysisToken = 0;

    function showMessage(text, type) {
      message.textContent = text;
      message.className = "message " + type;
    }

    function clearMessage() {
      message.textContent = "";
      message.className = "message";
    }

    function setTemplateMediaStatus(text, type) {
      templateMediaStatus.textContent = text || "";
      templateMediaStatus.className = text ? "field-message " + type : "field-message";
    }

    function setTemplateBaseDirVisible(visible) {
      templateBaseDirBox.classList.toggle("visible", Boolean(visible));
    }

    function resetTemplateMediaAnalysis() {
      templateAnalysisToken += 1;
      setTemplateMediaStatus("", "");
      if (!templateBaseDirInput.value.trim()) {
        setTemplateBaseDirVisible(false);
      }
    }

    function readFile(input) {
      const file = input.files && input.files[0];
      if (!file) return Promise.resolve(null);

      return file.arrayBuffer().then((buffer) => ({
        content: decodeUploadedText(buffer),
        name: file.name,
        path: file.path || file.webkitRelativePath || file.name,
      }));
    }

    function decodeUploadedText(buffer) {
      const bytes = new Uint8Array(buffer);
      let text = "";

      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        text = new TextDecoder("utf-8").decode(bytes.slice(3));
        return normalizeUploadedText(text);
      }

      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        text = new TextDecoder("utf-16le").decode(bytes.slice(2));
        return normalizeUploadedText(text);
      }

      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (_) {
        try {
          text = new TextDecoder("windows-1252").decode(bytes);
        } catch (err) {
          text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
        }
      }

      return normalizeUploadedText(text);
    }

    function normalizeUploadedText(text) {
      return String(text || "")
        .replace(/^\\ufeff/u, "")
        .replace(/\\r\\n/g, "\\n")
        .replace(/\\r/g, "\\n")
        .replace(/[\\u2028\\u2029]/gu, "\\n");
    }

    function validateLocal(payload) {
      const errors = [];

      if (payload.templateText.trim() && payload.templateFile && payload.templateFile.content.trim()) {
        errors.push("Escolha textarea ou arquivo .md, não ambos.");
      }

      if (payload.templateFile && !payload.templateFile.name.toLowerCase().endsWith(".md")) {
        errors.push("O arquivo de modelo precisa ser .md.");
      }

      if (payload.csvFile && !payload.csvFile.name.toLowerCase().endsWith(".csv")) {
        errors.push("A base de clientes precisa ser .csv.");
      }

      return errors;
    }

    function scheduleTemplateMediaAnalysis() {
      window.clearTimeout(templateAnalysisTimer);
      templateAnalysisTimer = window.setTimeout(() => {
        analyzeTemplateMedia().catch((err) => {
          setTemplateBaseDirVisible(true);
          setTemplateMediaStatus(err.message, "error");
        });
      }, 350);
    }

    async function analyzeTemplateMedia() {
      const token = ++templateAnalysisToken;
      const templateFile = await readFile(templateFileInput);

      if (token !== templateAnalysisToken) return;

      if (!templateFile || !String(templateFile.content || "").trim()) {
        resetTemplateMediaAnalysis();
        return;
      }

      setTemplateMediaStatus("Analisando anexos do modelo...", "info");

      const result = await postJson("/api/template/analyze", {
        templateBaseDir: templateBaseDirInput.value,
        templateFile,
        templateText: "",
      });

      if (token !== templateAnalysisToken) return;

      if (result.mediaIssues && result.mediaIssues.length) {
        setTemplateBaseDirVisible(true);
        setTemplateMediaStatus(
          "Anexo não localizado. Informe a pasta de referência dos anexos ou use fullpath no modelo.",
          "error",
        );
        return;
      }

      if (result.localMediaCount > 0) {
        setTemplateMediaStatus("Anexos locais localizados.", "ok");
        setTemplateBaseDirVisible(Boolean(templateBaseDirInput.value.trim()));
        return;
      }

      setTemplateMediaStatus("", "");
      setTemplateBaseDirVisible(Boolean(templateBaseDirInput.value.trim()));
    }

    function formatSyntaxIssue(issue, index) {
      const location = "Linha " + issue.line + ", coluna " + issue.column;
      const snippet = issue.snippet ? "\\nTrecho: " + issue.snippet : "";
      return (index + 1) + ". " + location + ": " + issue.message + snippet;
    }

    function confirmTemplateSyntaxIssues(issues) {
      if (!issues || !issues.length) return true;

      return window.confirm(
        "Atenção: foram encontrados possíveis erros de sintaxe no modelo selecionado.\\n\\n" +
        issues.map(formatSyntaxIssue).join("\\n\\n") +
        "\\n\\nO padrão seguro é abortar. Deseja enviar mesmo assim?"
      );
    }

    async function buildPayload() {
      return {
        csvFile: await readFile(document.getElementById("csvFile")),
        filter: document.getElementById("filter").value,
        forceResend: document.getElementById("forceResend").checked,
        resetSent: document.getElementById("resetSent").checked,
        templateBaseDir: templateBaseDirInput.value,
        templateFile: await readFile(templateFileInput),
        templateText: document.getElementById("templateText").value,
      };
    }

    async function postJson(url, payload) {
      const response = await fetch(url, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error((data.errors || [data.error || "Falha na requisição."]).join("\\n"));
      }
      return data;
    }

    function renderStatus(state) {
      const ready = Boolean(state.whatsappReady);
      statusPill.textContent = state.busy ? "Executando" : statusLabel(state.status, ready);
      button.disabled = Boolean(state.busy) || !ready;
      renderSessions(state);

      log.innerHTML = "";
      for (const item of state.log || []) {
        const row = document.createElement("div");
        row.className = "log-row " + (item.type || "info");
        const time = document.createElement("span");
        time.className = "log-time";
        time.textContent = new Date(item.at).toLocaleTimeString();
        const text = document.createElement("div");
        const prefix = item.current && item.total ? "[" + item.current + "/" + item.total + "] " : "";
        text.textContent = prefix + item.message;
        row.append(time, text);
        log.append(row);
      }
      log.scrollTop = log.scrollHeight;
    }

    function renderSessions(state) {
      const sessions = state.sessions || [];
      const active = state.activeSession && state.activeSession.id;
      knownSessions = sessions;
      activeSessionId = active || "";
      lastSessionCount = sessions.length;
      sessionSelect.innerHTML = "";
      for (const session of sessions) {
        const option = document.createElement("option");
        option.value = session.id;
        option.textContent = session.displayName;
        option.selected = session.id === active;
        sessionSelect.append(option);
      }
      sessionSelect.disabled = sessions.length <= 1 || Boolean(state.busy);
      newSessionButton.disabled = Boolean(state.busy);
      renameSessionButton.disabled = !active || Boolean(state.busy);
      removeSessionButton.disabled = sessions.length === 0 || Boolean(state.busy);
    }

    function askSessionToRemove() {
      if (!knownSessions.length) return null;

      const activeIndex = knownSessions.findIndex((session) => session.id === activeSessionId);
      const lines = knownSessions.map((session, index) => {
        const marker = session.id === activeSessionId ? " (ativa)" : "";
        return (index + 1) + " - " + session.displayName + marker;
      });
      const answer = window.prompt(
        "Qual sessão deseja remover? Informe o número, nome ou id.\\n\\n" + lines.join("\\n"),
        activeIndex >= 0 ? String(activeIndex + 1) : "1",
      );

      if (!answer || !answer.trim()) return null;

      const trimmed = answer.trim();
      const index = Number.parseInt(trimmed, 10);

      if (String(index) === trimmed && index >= 1 && index <= knownSessions.length) {
        return knownSessions[index - 1];
      }

      const normalized = trimmed.toLocaleLowerCase("pt-BR");
      const digits = trimmed.replace(/\\D/g, "");
      return knownSessions.find((session) => {
        return (
          session.id.toLocaleLowerCase("pt-BR") === normalized ||
          session.name.toLocaleLowerCase("pt-BR") === normalized ||
          (digits && session.phone && session.phone.endsWith(digits))
        );
      }) || { id: trimmed, displayName: trimmed };
    }

    function statusLabel(status, ready) {
      if (ready && status === "conectado") return "WhatsApp conectado";
      const labels = {
        autenticado: "Sessão autenticada",
        autenticando: "Autenticando",
        carregando_whatsapp: "Carregando WhatsApp",
        concluido: "Concluído",
        desconectado: "Desconectado",
        erro: "Erro",
        executando: "Executando",
        falha_autenticacao: "Falha de autenticação",
        iniciando_whatsapp: "Iniciando WhatsApp",
        reiniciando_sessao: "Reiniciando sessão",
        validando: "Validando",
      };
      return labels[status] || "Aguardando";
    }

    async function refreshStatus() {
      const response = await fetch("/api/status", { cache: "no-store" });
      const data = await response.json();
      renderStatus(data.state);
    }

    function startStatusPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        refreshStatus().catch((err) => {
          showMessage("Não foi possível atualizar o status: " + err.message, "error");
        });
      }, 1200);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      button.disabled = true;

      try {
        const payload = await buildPayload();
        const localErrors = validateLocal(payload);
        if (localErrors.length) throw new Error(localErrors.join("\\n"));

        const validation = await postJson("/api/validate", payload);

        if (!confirmTemplateSyntaxIssues(validation.syntaxIssues)) {
          showMessage("Envio abortado por possíveis erros de sintaxe no modelo.", "error");
          button.disabled = false;
          return;
        }

        if (validation.syntaxIssues && validation.syntaxIssues.length) {
          payload.confirmTemplateSyntaxIssues = true;
        }

        await postJson("/api/run", payload);
        showMessage("Processamento iniciado.", "ok");
        await refreshStatus();
        startStatusPolling();
      } catch (err) {
        showMessage(err.message, "error");
        button.disabled = false;
      }
    });

    templateFileInput.addEventListener("change", () => {
      if (!templateFileInput.files || !templateFileInput.files.length) {
        resetTemplateMediaAnalysis();
        return;
      }

      scheduleTemplateMediaAnalysis();
    });

    templateBaseDirInput.addEventListener("input", () => {
      if (!templateFileInput.files || !templateFileInput.files.length) {
        setTemplateBaseDirVisible(Boolean(templateBaseDirInput.value.trim()));
        return;
      }

      scheduleTemplateMediaAnalysis();
    });

    sessionSelect.addEventListener("change", async () => {
      const sessionId = sessionSelect.value;
      if (!sessionId || sessionId === activeSessionId) return;

      const selectedText = sessionSelect.options[sessionSelect.selectedIndex].textContent;
      const confirmed = window.confirm("Alternar para " + selectedText + "? O WhatsApp será reiniciado.");

      if (!confirmed) {
        sessionSelect.value = activeSessionId;
        return;
      }

      try {
        await postJson("/api/sessions/switch", { sessionId });
        showMessage("Alternando sessão. A interface será reaberta.", "ok");
      } catch (err) {
        showMessage(err.message, "error");
        sessionSelect.value = activeSessionId;
      }
    });

    newSessionButton.addEventListener("click", async () => {
      const name = window.prompt("Nome da nova sessão:");
      if (!name || !name.trim()) return;

      try {
        await postJson("/api/sessions/create", { name: name.trim() });
        showMessage("Sessão criada. Reiniciando para autenticar.", "ok");
      } catch (err) {
        showMessage(err.message, "error");
      }
    });

    renameSessionButton.addEventListener("click", async () => {
      if (!activeSessionId) return;
      const currentText = sessionSelect.options[sessionSelect.selectedIndex]?.textContent || "";
      const name = window.prompt("Novo nome da sessão:", currentText.replace(/\\s*\\(\\d{4}\\)\\s*$/, ""));
      if (!name || !name.trim()) return;

      try {
        const data = await postJson("/api/sessions/rename", {
          name: name.trim(),
          sessionId: activeSessionId,
        });
        showMessage(data.message || "Sessão renomeada.", "ok");
        await refreshStatus();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });

    removeSessionButton.addEventListener("click", async () => {
      const sessionToRemove = askSessionToRemove();
      if (!sessionToRemove) return;
      const currentText = sessionToRemove.displayName || sessionToRemove.id;
      const activeHint = sessionToRemove.id === activeSessionId
        ? " O WhatsApp será fechado antes da remoção para preservar os dados da sessão."
        : "";
      const confirmed = window.confirm(
        "Remover a sessão " + currentText + "? A autenticação local dessa sessão será apagada." + activeHint
      );

      if (!confirmed) return;

      try {
        const data = await postJson("/api/sessions/remove", {
          sessionId: sessionToRemove.id,
        });
        showMessage(data.message || "Sessão removida.", "ok");
        if (!data.activeRemoved) {
          await refreshStatus();
        }
      } catch (err) {
        showMessage(err.message, "error");
      }
    });

    refreshStatus().catch((err) => {
      showMessage("Não foi possível carregar o status: " + err.message, "error");
    });
    startStatusPolling();
  </script>
</body>
</html>`;
}

function renderComplianceNoticeHtml() {
  return COMPLIANCE_NOTICE
    .split("\n")
    .map((line) => `<p>${formatComplianceNoticeLine(line)}</p>`)
    .join("");
}

function formatComplianceNoticeLine(line) {
  const highlights = [
    "não é afiliado, patrocinado, endossado ou mantido",
    "Use-o por sua conta e risco",
    "restrições, bloqueio ou banimento",
    "O autor não se responsabiliza",
    "disclaimer abaixo",
  ];
  let html = escapeHtml(line);

  for (const phrase of highlights) {
    const escapedPhrase = escapeHtml(phrase);
    html = html.split(escapedPhrase).join(`<strong>${escapedPhrase}</strong>`);
  }

  return html;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  analyzeGuiTemplateMedia,
  materializeGuiExecutionPaths,
  openGuiWhenBrowserIsAvailable,
  registerGuiClientHandlers,
  renderGuiHtml,
  resolveGuiProvidedFilePath,
  resolveGuiTemplateBaseDir,
  startGuiServer,
  validateGuiPayload,
  validateGuiTemplateBaseDir,
};
