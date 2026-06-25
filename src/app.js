const path = require("path");

const { PATHS, ROOT_DIR } = require("./config");
const { parseExecutionOptions, printHelp } = require("./cli");
const { resolveExecutionPaths } = require("./data");
const { resetSentLog } = require("./logs");
const { formatBrowserStartupError } = require("./browser");
const { validateRuntimeFiles } = require("./campaign");
const { createWhatsAppClient, registerClientHandlers } = require("./whatsapp");
const { registerGuiClientHandlers } = require("./gui");

async function main() {
  try {
    const options = parseExecutionOptions();

    if (options.help) {
      printHelp();
      return;
    }

    if (options.gui) {
      const client = createWhatsAppClient(PATHS);
      registerGuiClientHandlers(client, PATHS, options);
      await client.initialize();
      return;
    }

    const executionPaths = resolveExecutionPaths(PATHS, options);
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
