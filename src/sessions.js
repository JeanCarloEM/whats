const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { PATHS, ROOT_DIR } = require("./config");
const { ensureDirectory, sanitizePhone, stripWrappingQuotes } = require("./utils");

const SESSIONS_FILE = path.join(ROOT_DIR, ".wwebjs_sessions.json");
const DEFAULT_SESSION_ID = "default";

function loadSessionStore(filePath = SESSIONS_FILE) {
  if (!fs.existsSync(filePath)) {
    return { sessions: {}, version: 1 };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      sessions:
        parsed.sessions && typeof parsed.sessions === "object"
          ? parsed.sessions
          : {},
      version: 1,
    };
  } catch {
    return { sessions: {}, version: 1 };
  }
}

function saveSessionStore(store, filePath = SESSIONS_FILE) {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ sessions: store.sessions || {}, version: 1 }, null, 2)}\n`,
    "utf8",
  );
}

function normalizeSessionId(value) {
  const raw = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return raw || DEFAULT_SESSION_ID;
}

function sessionDirectoryName(sessionId) {
  return sessionId === DEFAULT_SESSION_ID ? "session" : `session-${sessionId}`;
}

function discoverSessionIds(authDir = PATHS.auth) {
  if (!fs.existsSync(authDir) || !fs.statSync(authDir).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(authDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      if (entry.name === "session") {
        return DEFAULT_SESSION_ID;
      }

      if (entry.name.startsWith("session-")) {
        return entry.name.slice("session-".length);
      }

      return "";
    })
    .filter(Boolean);
}

function listSessions(paths = PATHS) {
  const store = loadSessionStore();
  const ids = new Set([
    ...Object.keys(store.sessions || {}),
    ...discoverSessionIds(paths.auth),
  ]);

  if (ids.size === 0) {
    ids.add(DEFAULT_SESSION_ID);
  }

  return [...ids].sort(sortDefaultFirst).map((id) => normalizeSessionRecord(id, store.sessions[id]));
}

function sortDefaultFirst(a, b) {
  if (a === DEFAULT_SESSION_ID) return -1;
  if (b === DEFAULT_SESSION_ID) return 1;
  return a.localeCompare(b, "pt-BR");
}

function normalizeSessionRecord(id, record = {}) {
  const sessionId = normalizeSessionId(id);
  const phone = sanitizePhone(record.phone || "");
  const name = String(record.name || "").trim() || defaultSessionName(sessionId);

  return {
    createdAt: record.createdAt || new Date().toISOString(),
    displayName: formatSessionDisplayName({ id: sessionId, name, phone }),
    id: sessionId,
    name,
    phone,
    updatedAt: record.updatedAt || "",
  };
}

function defaultSessionName(sessionId) {
  return sessionId === DEFAULT_SESSION_ID ? "Principal" : sessionId;
}

function formatSessionDisplayName(session) {
  const name = String(session.name || defaultSessionName(session.id)).trim();
  const phone = sanitizePhone(session.phone || "");
  const suffix = phone ? phone.slice(-4) : "";
  return suffix ? `${name} (${suffix})` : name;
}

function resolveSessionByIdentifier(identifier, sessions = listSessions()) {
  const raw = stripWrappingQuotes(identifier);

  if (!raw) {
    return null;
  }

  const normalized = raw.toLocaleLowerCase("pt-BR");
  const digits = raw.replace(/\D/g, "");

  const matches = sessions.filter((session) => {
    const nameMatch = session.name.toLocaleLowerCase("pt-BR") === normalized;
    const idMatch = session.id.toLocaleLowerCase("pt-BR") === normalized;
    const phoneMatch = digits && session.phone && session.phone.endsWith(digits);
    return nameMatch || idMatch || phoneMatch;
  });

  if (matches.length > 1) {
    const options = matches.map((session) => `- ${session.displayName}`).join("\n");
    throw new Error(`Sessão ambígua: ${raw}\nOpções:\n${options}`);
  }

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error(`Sessão não encontrada: ${raw}`);
}

async function selectSessionForExecution(options = {}, paths = PATHS) {
  if (options.newSessionName) {
    return createSession(options.newSessionName);
  }

  const sessions = listSessions(paths);

  if (options.session) {
    return resolveSessionByIdentifier(options.session, sessions);
  }

  if (sessions.length <= 1) {
    return sessions[0];
  }

  return promptSessionSelection(sessions);
}

function createSession(name) {
  const store = loadSessionStore();
  const existingIds = new Set([
    ...Object.keys(store.sessions || {}),
    ...discoverSessionIds(PATHS.auth),
  ]);
  const sessionId = uniqueSessionId(normalizeSessionId(name), existingIds);
  const now = new Date().toISOString();
  const session = normalizeSessionRecord(sessionId, {
    createdAt: now,
    name: String(name || "").trim() || sessionId,
    updatedAt: now,
  });

  store.sessions[session.id] = session;
  saveSessionStore(store);
  return session;
}

function renameSession(identifier, newName) {
  const store = loadSessionStore();
  const sessions = listSessions();
  const session = resolveSessionByIdentifier(identifier, sessions);
  const current = normalizeSessionRecord(session.id, store.sessions[session.id]);

  store.sessions[session.id] = {
    ...current,
    name: String(newName || "").trim() || current.name,
    updatedAt: new Date().toISOString(),
  };
  saveSessionStore(store);
  return normalizeSessionRecord(session.id, store.sessions[session.id]);
}

function uniqueSessionId(baseId, sessions) {
  let id = baseId === DEFAULT_SESSION_ID ? "sessao" : baseId;
  let counter = 2;

  while (sessions.has ? sessions.has(id) : sessions[id]) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }

  return id;
}

function promptSessionSelection(sessions) {
  console.log("\nSelecione uma sessão:\n");
  sessions.forEach((session, index) => {
    console.log(`${index + 1} - ${session.displayName}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("\nOpção: ", (answer) => {
      rl.close();
      const index = Number.parseInt(answer, 10) - 1;

      if (!Number.isInteger(index) || index < 0 || index >= sessions.length) {
        reject(new Error("Opção de sessão inválida."));
        return;
      }

      resolve(sessions[index]);
    });
  });
}

function applySessionToPaths(paths = PATHS, session) {
  const selected = session || normalizeSessionRecord(DEFAULT_SESSION_ID);
  const isDefault = selected.id === DEFAULT_SESSION_ID;
  const logsDir = isDefault
    ? paths.logsDir
    : path.join(paths.logsDir, "sessions", selected.id);

  ensureDirectory(logsDir);

  return {
    ...paths,
    activeSession: selected,
    authSessionDir: path.join(paths.auth, sessionDirectoryName(selected.id)),
    errors: path.join(logsDir, "erros.csv"),
    logsDir,
    messageCache: path.join(logsDir, "mensagens.json"),
    sent: path.join(logsDir, "enviados.csv"),
    sessionClientId: isDefault ? undefined : selected.id,
    skipped: path.join(logsDir, "pulos.csv"),
    warnings: path.join(logsDir, "avisos.csv"),
  };
}

function updateSessionPhone(session, phone) {
  if (!session) {
    return;
  }

  const store = loadSessionStore();
  const current = normalizeSessionRecord(session.id, store.sessions[session.id]);
  const now = new Date().toISOString();

  store.sessions[session.id] = {
    ...current,
    phone: sanitizePhone(phone || current.phone || ""),
    updatedAt: now,
  };
  saveSessionStore(store);
}

module.exports = {
  DEFAULT_SESSION_ID,
  applySessionToPaths,
  createSession,
  formatSessionDisplayName,
  listSessions,
  normalizeSessionId,
  renameSession,
  resolveSessionByIdentifier,
  selectSessionForExecution,
  sessionDirectoryName,
  updateSessionPhone,
};
