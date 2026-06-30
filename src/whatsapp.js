// Autor: JeanCarloEM.com
// Site do Autor: https://jeancarloem.com
// Licenca: Mozilla Public License 2.0
// Site da Licenca: https://www.mozilla.org/MPL/2.0/
// Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
// Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const { PATHS, readIntegerEnv } = require("./config");
const { buildPuppeteerConfig, getWhatsAppClientId } = require("./browser");
const { processCampaign } = require("./campaign");
const { updateSessionPhone } = require("./sessions");

const CLIENT_DESTROY_TIMEOUT_MS = readIntegerEnv("CLIENT_DESTROY_TIMEOUT_MS", 10000);
const CLIENT_SHUTDOWN_GRACE_MS = readIntegerEnv("CLIENT_SHUTDOWN_GRACE_MS", 700);

function createWhatsAppClient(paths = PATHS) {
  return new Client({
    authStrategy: new LocalAuth({
      dataPath: paths.auth,
      clientId: paths.sessionClientId || getWhatsAppClientId(),
    }),

    puppeteer: buildPuppeteerConfig(),
  });
}

async function destroyWhatsAppClient(client, options = {}) {
  if (!client || typeof client.destroy !== "function") {
    return { destroyed: false, skipped: true, timedOut: false };
  }

  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : CLIENT_DESTROY_TIMEOUT_MS;
  const graceMs = Number.isFinite(options.graceMs)
    ? options.graceMs
    : CLIENT_SHUTDOWN_GRACE_MS;
  let timedOut = false;

  try {
    await Promise.race([
      client.destroy(),
      delay(timeoutMs).then(() => {
        timedOut = true;
      }),
    ]);

    if (timedOut) {
      return { destroyed: false, skipped: false, timedOut: true };
    }

    if (graceMs > 0) {
      await delay(graceMs);
    }

    return { destroyed: true, skipped: false, timedOut: false };
  } catch (err) {
    return {
      destroyed: false,
      error: err,
      skipped: false,
      timedOut: false,
    };
  }
}

function registerClientShutdownHandlers(client) {
  let shuttingDown = false;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Encerrando WhatsApp com segurança (${signal}).`);
    await destroyWhatsAppClient(client);
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    process.exit();
  };

  for (const signal of signals) {
    try {
      process.once(signal, () => {
        shutdown(signal).catch(() => {
          process.exitCode = signal === "SIGINT" ? 130 : 143;
          process.exit();
        });
      });
    } catch {
      // Alguns sinais podem não existir em todos os ambientes.
    }
  }
}

function registerClientHandlers(client, paths = PATHS, options = {}) {
  client.on("qr", (qr) => {
    console.clear();
    console.log("Escaneie o QR Code:");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", async () => {
    console.log("WhatsApp conectado.");
    updateSessionPhone(paths.activeSession, readClientPhone(client), paths);

    try {
      await processCampaign(client, paths, options);
      console.log("Processamento concluído.");
    } catch (err) {
      console.error("Processamento interrompido:", err.message);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function readClientPhone(client) {
  const wid =
    client &&
    client.info &&
    client.info.wid &&
    (client.info.wid.user || client.info.wid._serialized);

  return String(wid || "").replace(/\D/g, "");
}

module.exports = {
  createWhatsAppClient,
  destroyWhatsAppClient,
  readClientPhone,
  registerClientHandlers,
  registerClientShutdownHandlers,
};
