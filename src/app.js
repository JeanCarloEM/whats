// Autor: JeanCarloEM.com
// Site do Autor: https://jeancarloem.com
// Licenca: Mozilla Public License 2.0
// Site da Licenca: https://www.mozilla.org/MPL/2.0/
// Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
// Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

const path = require("path");
const readline = require("readline");

const { PATHS, ROOT_DIR } = require("./config");
const { parseExecutionOptions, printHelp } = require("./cli");
const { printStartupNotice } = require("./notice");
const { loadTemplate, resolveExecutionPaths } = require("./data");
const { resetSentLog } = require("./logs");
const { formatBrowserStartupError } = require("./browser");
const { validateRuntimeFiles } = require("./campaign");
const {
  createWhatsAppClient,
  registerClientHandlers,
  registerClientShutdownHandlers,
} = require("./whatsapp");
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
const {
  prepareGuiInstance,
  registerGuiInstance,
} = require("./runtime");
const { inspectTemplateSyntax } = require("./template");

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
      const guiInstance = await prepareGuiInstance(sessionPaths, options);

      if (guiInstance.action === "reuse") {
        console.log(`Interface local reutilizada em ${guiInstance.record.url}`);
        return;
      }

      if (guiInstance.action === "replace") {
        console.log("Instância anterior encerrada porque os scripts foram alterados.");
      }

      const client = createWhatsAppClient(sessionPaths);
      registerClientShutdownHandlers(client);
      const guiServerInfo = await startGuiServer(client, sessionPaths, options);
      const guiRuntime = registerGuiInstance(guiServerInfo, sessionPaths);
      options.guiRuntime = guiRuntime;
      guiServerInfo.state.runtime = guiRuntime.publicRecord;
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

    await confirmTemplateSyntaxBeforeSend(executionPaths);

    if (options.resetSent) {
      resetSentLog(executionPaths.sent);
      console.log("Lista de enviados resetada: logs/enviados.csv");
    }

    if (options.forceResend) {
      console.log("Reenvio forçado ativo: logs/enviados.csv será ignorado.");
    }

    const client = createWhatsAppClient(executionPaths);
    registerClientShutdownHandlers(client);
    registerClientHandlers(client, executionPaths, options);
    await client.initialize();
  } catch (err) {
    console.error(formatBrowserStartupError(err, PATHS));
    process.exitCode = 1;
  }
}

async function confirmTemplateSyntaxBeforeSend(executionPaths) {
  const template = loadTemplate(executionPaths.template);
  const issues = inspectTemplateSyntax(template);

  if (issues.length === 0) {
    return;
  }

  console.warn(formatTemplateSyntaxIssues(issues));

  const confirmed = await askYesNo(
    "Foram encontrados possíveis erros no modelo. Deseja enviar mesmo assim? Digite sim ou não [não]: ",
  );

  if (!confirmed) {
    throw new Error("Envio abortado: possíveis erros de sintaxe no modelo não foram confirmados.");
  }
}

function formatTemplateSyntaxIssues(issues) {
  return [
    "Atenção: possíveis erros de sintaxe no modelo selecionado:",
    ...issues.map((issue, index) => {
      const snippet = issue.snippet ? ` Trecho: ${issue.snippet}` : "";
      return `${index + 1}. Linha ${issue.line}, coluna ${issue.column}: ${issue.message}${snippet}`;
    }),
  ].join("\n");
}

function askYesNo(question) {
  if (!process.stdin.isTTY) {
    return Promise.resolve(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(question, (answer) => {
        const normalized = normalizeYesNoAnswer(answer);

        if (!normalized) {
          rl.close();
          resolve(false);
          return;
        }

        if (normalized === "yes") {
          rl.close();
          resolve(true);
          return;
        }

        if (normalized === "no") {
          rl.close();
          resolve(false);
          return;
        }

        console.log("Responda com sim ou não.");
        ask();
      });
    };

    ask();
  });
}

function normalizeYesNoAnswer(answer) {
  const value = String(answer || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "");

  if (!value) {
    return "";
  }

  if (["s", "sim", "y", "yes"].includes(value)) {
    return "yes";
  }

  if (["n", "nao", "no"].includes(value)) {
    return "no";
  }

  return "invalid";
}

module.exports = {
  askYesNo,
  confirmTemplateSyntaxBeforeSend,
  formatTemplateSyntaxIssues,
  main,
  normalizeYesNoAnswer,
};
