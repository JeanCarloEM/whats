const path = require("path");

const { PATHS, ROOT_DIR } = require("./config");
const { parseExecutionOptions, printHelp } = require("./cli");
const { printStartupNotice } = require("./notice");
const { resolveExecutionPaths } = require("./data");
const { resetSentLog } = require("./logs");
const { formatBrowserStartupError } = require("./browser");
const { validateRuntimeFiles } = require("./campaign");
const { createWhatsAppClient, registerClientHandlers } = require("./whatsapp");
const {
  applySessionToPaths,
  listSessions,
  renameSession,
  removeSession,
  selectSessionForExecution,
} = require("./sessions");
const {
  openGuiWhenBrowserIsAvailable,
  registerGuiClientHandlers,
  startGuiServer,
} = require("./gui");

async function main() {
  try {
    const options = parseExecutionOptions();

    if (options.help) {
      printHelp();
      return;
    }

    printStartupNotice();

    if (options.renameSession) {
      const renamed = renameSession(
        options.renameSession.from,
        options.renameSession.to,
        PATHS,
      );
      console.log(`Sessão renomeada: ${renamed.displayName}`);
      return;
    }

    if (options.removeSession) {
      const result = removeSession(options.removeSession, PATHS);
      console.log(`Sessão removida: ${result.removed.displayName}`);

      if (!options.gui) {
        if (result.remainingPersisted.length === 0) {
          console.log("Nenhuma sessão persistida restante. A próxima execução iniciará como primeira autenticação.");
        }
        return;
      }

      if (result.remainingPersisted.length > 0) {
        options.session = result.remainingPersisted[0].id;
      } else {
        delete options.session;
        delete options.newSessionName;
      }
    }

    const selectedSession =
      (options.gui || options.check) && !options.session && !options.newSessionName
        ? listSessions(PATHS)[0]
        : await selectSessionForExecution(options, PATHS);
    const sessionPaths = applySessionToPaths(PATHS, selectedSession);
    console.log(`Sessão selecionada: ${selectedSession.displayName}`);

    if (options.gui) {
      const client = createWhatsAppClient(sessionPaths);
      const guiServerInfo = await startGuiServer(client, sessionPaths, options);
      console.log(`Interface local disponível em ${guiServerInfo.url}`);
      openGuiWhenBrowserIsAvailable(client, guiServerInfo.url, guiServerInfo.state);
      registerGuiClientHandlers(client, sessionPaths, {
        ...options,
        guiServerInfo,
      });
      await client.initialize();
      return;
    }

    const executionPaths = resolveExecutionPaths(sessionPaths, options);
    const validation = validateRuntimeFiles(executionPaths);
    console.log(
      `Pré-validação RCF concluída. Clientes: ${validation.clientesCount}.`,
    );

    if (options.templateName) {
      console.log(
        `Modelo selecionado: ${path.relative(ROOT_DIR, executionPaths.template)}`,
      );
    }

    if (executionPaths.listFilter) {
      const filterDescription =
        executionPaths.listFilter.expression ||
        `${executionPaths.listFilter.field}${executionPaths.listFilter.operator}${executionPaths.listFilter.expectedValue}`;
      console.log(`Filtro de lista: ${filterDescription}`);
    } else if (options.listArg) {
      console.log(
        `Lista selecionada: ${path.relative(ROOT_DIR, executionPaths.csv)}`,
      );
    }

    if (options.check) {
      return;
    }

    if (options.resetSent) {
      resetSentLog(executionPaths.sent);
      console.log("Lista de enviados resetada: logs/enviados.csv");
    }

    if (options.forceResend) {
      console.log("Reenvio forçado ativo: logs/enviados.csv será ignorado.");
    }

    const client = createWhatsAppClient(executionPaths);
    registerClientHandlers(client, executionPaths, options);
    await client.initialize();
  } catch (err) {
    console.error(formatBrowserStartupError(err, PATHS));
    process.exitCode = 1;
  }
}

module.exports = {
  main,
};
