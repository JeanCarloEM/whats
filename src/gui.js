const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { PATHS, ROOT_DIR } = require("./config");
const { loadCsv } = require("./data");
const { initLogFiles, resetSentLog } = require("./logs");
const { parseExpression } = require("./expression");
const { processCampaign, validateRuntimeFiles } = require("./campaign");
const { parseListFilter } = require("./data");

const GUI_HOST = "127.0.0.1";
const GUI_PORT = Number.parseInt(process.env.GUI_PORT || "3137", 10);
const GUI_RUNTIME_DIR = path.join(ROOT_DIR, ".runtime", "gui");
const MAX_JSON_BODY_BYTES = 15 * 1024 * 1024;

function registerGuiClientHandlers(client, basePaths = PATHS, baseOptions = {}) {
  let serverPromise;

  client.on("qr", (qr) => {
    console.clear();
    console.log("Escaneie o QR Code no navegador do WhatsApp Web.");
    try {
      require("qrcode-terminal").generate(qr, { small: true });
    } catch (_) {
      console.log("QR Code recebido. Use a janela do navegador para autenticar.");
    }
  });

  client.on("ready", async () => {
    console.log("WhatsApp conectado. Iniciando interface local...");

    try {
      if (!serverPromise) {
        serverPromise = startGuiServer(client, basePaths, baseOptions);
      }

      const serverInfo = await serverPromise;
      await openGuiInBrowser(client, serverInfo.url);
      console.log(`Interface local disponível em ${serverInfo.url}`);
    } catch (err) {
      console.error("Falha ao iniciar a interface:", err.message);
      process.exitCode = 1;
    }
  });

  client.on("auth_failure", (msg) => {
    console.error("Falha de autenticação:", msg);
    process.exitCode = 1;
  });

  client.on("disconnected", (reason) => {
    console.error("Desconectado:", reason);
  });
}

function startGuiServer(client, basePaths = PATHS, baseOptions = {}) {
  const state = createGuiState();
  const server = http.createServer((req, res) => {
    routeGuiRequest(req, res, {
      baseOptions,
      basePaths,
      client,
      state,
    }).catch((err) => {
      sendJson(res, 500, {
        error: err.message || String(err),
        ok: false,
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(GUI_PORT, GUI_HOST, () => {
      server.off("error", reject);
      resolve({
        server,
        state,
        url: `http://${GUI_HOST}:${server.address().port}/`,
      });
    });
  });
}

function createGuiState() {
  return {
    busy: false,
    finishedAt: null,
    lastError: "",
    log: [],
    startedAt: null,
    status: "aguardando",
  };
}

async function routeGuiRequest(req, res, context) {
  const url = new URL(req.url, `http://${GUI_HOST}`);

  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, renderGuiHtml());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      ok: true,
      state: context.state,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/validate") {
    const payload = await readJsonBody(req);
    const result = validateGuiPayload(payload, context.basePaths);
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

    if (context.state.busy) {
      sendJson(res, 409, {
        error: "Já existe um processamento em andamento.",
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
    const templatePath = path.join(GUI_RUNTIME_DIR, "template.md");
    fs.writeFileSync(templatePath, templateText.trim() ? templateText : templateFileContent, "utf8");
    paths.template = templatePath;
    paths.templateBaseDir = ROOT_DIR;
  }

  if (payload.csvFile && String(payload.csvFile.content || "").trim()) {
    const csvPath = path.join(GUI_RUNTIME_DIR, "clientes.csv");
    fs.writeFileSync(csvPath, String(payload.csvFile.content || ""), "utf8");
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

  validateTemplateSyntax(templateCandidate, errors);

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
      fs.writeFileSync(tmpPath, String(csvFile.content || ""), "utf8");
      loadCsv(tmpPath);
    } catch (err) {
      errors.push(err.message);
    }
  }

  return errors.length
    ? { errors, ok: false }
    : { message: "Validação preliminar aprovada.", ok: true };
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

function validateTemplateSyntax(template, errors) {
  const value = String(template || "");
  const openings = (value.match(/\$\{/gu) || []).length;
  const closings = (value.match(/\}/gu) || []).length;

  if (openings > closings) {
    errors.push("Modelo inválido: existe variável ${...} sem fechamento.");
    return;
  }

  for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
    try {
      parseExpression(match[1].trim());
    } catch (err) {
      errors.push(`Modelo inválido em \${${match[1]}}: ${err.message}`);
    }
  }
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
      return;
    } catch (_) {
      // Se a aba no browser controlado falhar, tenta o navegador padrão.
    }
  }

  openSystemBrowser(url);
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
      --shadow: 0 18px 50px rgba(21, 30, 43, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 20px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
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
      padding: 8px 12px;
      white-space: nowrap;
      font-weight: 700;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      gap: 18px;
      align-items: start;
    }

    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 18px;
      margin-bottom: 18px;
    }

    label {
      display: block;
      font-weight: 700;
      margin-bottom: 8px;
    }

    textarea,
    input[type="text"],
    input[type="file"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      font: inherit;
      padding: 11px 12px;
    }

    textarea {
      min-height: 210px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
    }

    .hint {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
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

    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
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
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Disparador WhatsApp</h1>
        <p>WhatsApp conectado. Configure a execução local e acompanhe o andamento.</p>
      </div>
      <div class="status-pill" id="statusPill">Aguardando</div>
    </header>

    <div class="layout">
      <form id="runForm">
        <section>
          <h2>Modelo de mensagem</h2>
          <label for="templateText">Texto do modelo</label>
          <textarea id="templateText" spellcheck="false" placeholder="$diatarde$, \${nome}.&#10;&#10;Seu valor atualizado é \${(valor+taxa)}."></textarea>
          <div class="hint">\${campo} aceita colunas e expressões, como \${(valor+taxa)*2}; use +, -, *, / e parênteses.</div>
          <div style="height:14px"></div>
          <label for="templateFile">Ou arquivo .md</label>
          <input id="templateFile" type="file" accept=".md,text/markdown,text/plain">
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
    let pollTimer = null;

    function showMessage(text, type) {
      message.textContent = text;
      message.className = "message " + type;
    }

    function clearMessage() {
      message.textContent = "";
      message.className = "message";
    }

    function readFile(input) {
      const file = input.files && input.files[0];
      if (!file) return Promise.resolve(null);

      return file.text().then((content) => ({
        content,
        name: file.name,
      }));
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

      if ((payload.templateText.match(/\\$\\{/g) || []).length > (payload.templateText.match(/\\}/g) || []).length) {
        errors.push("Há uma variável \${...} sem fechamento no modelo.");
      }

      return errors;
    }

    async function buildPayload() {
      return {
        csvFile: await readFile(document.getElementById("csvFile")),
        filter: document.getElementById("filter").value,
        forceResend: document.getElementById("forceResend").checked,
        resetSent: document.getElementById("resetSent").checked,
        templateFile: await readFile(document.getElementById("templateFile")),
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
      statusPill.textContent = state.busy ? "Executando" : (state.status || "Aguardando");
      button.disabled = Boolean(state.busy);

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

    async function refreshStatus() {
      const response = await fetch("/api/status", { cache: "no-store" });
      const data = await response.json();
      renderStatus(data.state);
      if (!data.state.busy && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();
      button.disabled = true;

      try {
        const payload = await buildPayload();
        const localErrors = validateLocal(payload);
        if (localErrors.length) throw new Error(localErrors.join("\\n"));

        await postJson("/api/validate", payload);
        await postJson("/api/run", payload);
        showMessage("Processamento iniciado.", "ok");
        await refreshStatus();
        pollTimer = setInterval(refreshStatus, 1200);
      } catch (err) {
        showMessage(err.message, "error");
        button.disabled = false;
      }
    });

    refreshStatus();
  </script>
</body>
</html>`;
}

module.exports = {
  materializeGuiExecutionPaths,
  registerGuiClientHandlers,
  startGuiServer,
  validateGuiPayload,
};
