const { isListFilterExpression } = require("./data");
const { stripWrappingQuotes } = require("./utils");

function readOptionValue(argv, index) {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Opção ${argv[index]} requer um valor.`);
  }

  return { nextIndex: index + 1, value };
}

function readListOptionValue(argv, index) {
  const first = argv[index + 1];

  if (!first || first.startsWith("--")) {
    throw new Error(`Opção ${argv[index]} requer um valor.`);
  }

  const operator = stripWrappingQuotes(argv[index + 2] || "");
  const third = argv[index + 3];

  if (
    ["=", "!=", "<", ">", "<=", ">="].includes(operator) &&
    third &&
    !third.startsWith("--")
  ) {
    return {
      nextIndex: index + 3,
      value: `${first}${operator}${third}`,
    };
  }

  return { nextIndex: index + 1, value: first };
}

function parseExecutionOptions(argv = process.argv.slice(2)) {
  const positionalArgs = [];
  const options = {
    check: false,
    forceResend: false,
    gui: false,
    help: false,
    listArg: undefined,
    resetSent: false,
    templateName: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--check") {
      options.check = true;
      continue;
    }

    if (["--gui", "--interface", "--tela"].includes(arg)) {
      options.gui = true;
      continue;
    }

    if (["--force-resend", "--reenviar", "--no-skip-sent"].includes(arg)) {
      options.forceResend = true;
      continue;
    }

    if (["--help", "-h"].includes(arg)) {
      options.help = true;
      continue;
    }

    if (
      [
        "--reset-sent",
        "--reset-enviados",
        "--clear-sent",
        "--clear-enviados",
        "--limpar-enviados",
      ].includes(arg)
    ) {
      options.resetSent = true;
      continue;
    }

    if (arg.startsWith("--modelo=") || arg.startsWith("--model=")) {
      options.templateName = arg.slice(arg.indexOf("=") + 1);
      continue;
    }

    if (["--modelo", "--model"].includes(arg)) {
      const result = readOptionValue(argv, index);
      options.templateName = result.value;
      index = result.nextIndex;
      continue;
    }

    if (
      arg.startsWith("--lista=") ||
      arg.startsWith("--list=") ||
      arg.startsWith("--csv=")
    ) {
      options.listArg = arg.slice(arg.indexOf("=") + 1);
      continue;
    }

    if (["--lista", "--list", "--csv"].includes(arg)) {
      const result = readListOptionValue(argv, index);
      options.listArg = result.value;
      index = result.nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Opção desconhecida: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  applyPositionalExecutionArgs(options, positionalArgs);
  return options;
}

function applyPositionalExecutionArgs(options, positionalArgs) {
  if (positionalArgs.length > 2) {
    throw new Error(
      `Use no máximo um modelo e uma lista por execução. Recebidos: ${positionalArgs.join(", ")}`,
    );
  }

  if (positionalArgs.length === 0) {
    return;
  }

  for (const arg of positionalArgs) {
    if (!options.listArg && isListFilterExpression(arg)) {
      options.listArg = arg;
      continue;
    }

    if (!options.templateName) {
      options.templateName = arg;
      continue;
    }

    if (!options.listArg) {
      options.listArg = arg;
      continue;
    }

    throw new Error(
      `Argumento posicional inesperado: ${arg}. Use no máximo um modelo e uma lista.`,
    );
  }
}

function printHelp() {
  console.log(`Uso:
  npm start
  node main.js [opções] [modelo] [lista]

Opções:
  --check             Valida arquivos e configuração sem enviar.
  --gui               Abre a interface gráfica local após autenticar.
  --force-resend      Ignora logs/enviados.csv nesta execução e reenvia.
  --lista VALOR       Usa ./listas/VALOR.csv ou filtra clientes.csv se contiver = ou !=.
  --modelo VALOR      Usa ./modelos/VALOR.md.
  --reset-sent        Limpa logs/enviados.csv antes de iniciar.
  --clear-sent        Alias de --reset-sent.
  --reenviar          Alias de --force-resend.
  --reset-enviados    Alias de --reset-sent.
  --help              Mostra esta ajuda.

Modelo e lista:
  O primeiro argumento posicional é o modelo em ./modelos.
  O segundo argumento posicional é a lista em ./listas.
  Se a lista contiver = ou !=, ela vira filtro sobre ./clientes.csv.

Exemplos:
  node main.js faturamento lista_exemplo
  node main.js --lista lista_exemplo
  node main.js faturamento "status=ativo"`);
}

module.exports = {
  parseExecutionOptions,
  printHelp,
};
