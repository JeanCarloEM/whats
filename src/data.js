const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const { PATHS, REQUIRED_COLUMNS } = require("./config");
const {
  collectReferencedFields,
  evaluateFilterExpression,
  expressionLooksLikeFilter,
  parseExpression,
} = require("./expression");
const {
  buildCaseInsensitiveDataMap,
  getRecordValue,
  normalizeFieldName,
  stripWrappingQuotes,
} = require("./utils");

const CSV_DELIMITER_CANDIDATES = [",", ";", "\t", "|"];
const CSV_QUOTE_CANDIDATES = ['"', "'"];
const WINDOWS_1252_EXTRA_CHARS = {
  0x80: "\u20ac",
  0x82: "\u201a",
  0x83: "\u0192",
  0x84: "\u201e",
  0x85: "\u2026",
  0x86: "\u2020",
  0x87: "\u2021",
  0x88: "\u02c6",
  0x89: "\u2030",
  0x8a: "\u0160",
  0x8b: "\u2039",
  0x8c: "\u0152",
  0x8e: "\u017d",
  0x91: "\u2018",
  0x92: "\u2019",
  0x93: "\u201c",
  0x94: "\u201d",
  0x95: "\u2022",
  0x96: "\u2013",
  0x97: "\u2014",
  0x98: "\u02dc",
  0x99: "\u2122",
  0x9a: "\u0161",
  0x9b: "\u203a",
  0x9c: "\u0153",
  0x9e: "\u017e",
  0x9f: "\u0178",
};

function readTextFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} não encontrado: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} não é um arquivo: ${filePath}`);
  }

  return decodeTextBuffer(fs.readFileSync(filePath));
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16Be(buffer.subarray(2));
  }

  if (looksLikeUtf16Le(buffer)) {
    return buffer.toString("utf16le");
  }

  if (looksLikeUtf16Be(buffer)) {
    return decodeUtf16Be(buffer);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (_) {
    return decodeWindows1252(buffer);
  }
}

function looksLikeUtf16Le(buffer) {
  if (buffer.length < 4) {
    return false;
  }

  let nulls = 0;
  let samples = 0;

  for (let index = 1; index < Math.min(buffer.length, 200); index += 2) {
    samples += 1;

    if (buffer[index] === 0) {
      nulls += 1;
    }
  }

  return samples > 0 && nulls / samples > 0.6;
}

function looksLikeUtf16Be(buffer) {
  if (buffer.length < 4) {
    return false;
  }

  let nulls = 0;
  let samples = 0;

  for (let index = 0; index < Math.min(buffer.length, 200); index += 2) {
    samples += 1;

    if (buffer[index] === 0) {
      nulls += 1;
    }
  }

  return samples > 0 && nulls / samples > 0.6;
}

function decodeUtf16Be(buffer) {
  const swapped = Buffer.alloc(buffer.length);

  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] || 0;
    swapped[index + 1] = buffer[index] || 0;
  }

  return swapped.toString("utf16le");
}

function decodeWindows1252(buffer) {
  let result = "";

  for (const byte of buffer) {
    result += WINDOWS_1252_EXTRA_CHARS[byte] || String.fromCharCode(byte);
  }

  return result;
}

function loadTemplate(filePath = PATHS.template) {
  return readTextFile(filePath, "Template");
}

function loadCsv(filePath = PATHS.csv) {
  const csv = readTextFile(filePath, "CSV de clientes");
  const csvFormat = detectCsvFormat(csv);
  const rows = csvFormat.rows;

  if (rows.length === 0) {
    throw new Error("CSV inválido: arquivo vazio.");
  }

  const header = rows[0].map((column) => String(column).trim());
  const normalizedHeader = header.map(normalizeFieldName);
  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !normalizedHeader.includes(normalizeFieldName(column)),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `CSV inválido: colunas obrigatórias ausentes: ${missingColumns.join(", ")}.`,
    );
  }

  try {
    return parse(csv, {
      columns: (columns) => columns.map((column) => String(column).trim()),
      delimiter: csvFormat.delimiter,
      quote: csvFormat.quote,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    });
  } catch (err) {
    throw new Error(`CSV inválido: ${err.message}`);
  }
}

function detectCsvFormat(csv) {
  const attempts = [];

  for (const delimiter of CSV_DELIMITER_CANDIDATES) {
    for (const quote of CSV_QUOTE_CANDIDATES) {
      try {
        const rows = parse(csv, {
          bom: true,
          delimiter,
          quote,
          relax_column_count: true,
          relax_quotes: true,
          skip_empty_lines: true,
          trim: true,
        });

        attempts.push({
          delimiter,
          quote,
          rows,
          score: scoreCsvParse(rows, delimiter, quote),
        });
      } catch (_) {
        // Formatos incompatíveis são ignorados e outros candidatos são testados.
      }
    }
  }

  attempts.sort((a, b) => b.score - a.score);

  const best = attempts[0];

  if (!best || best.rows.length === 0) {
    throw new Error("CSV inválido: arquivo vazio ou formato não reconhecido.");
  }

  return best;
}

function scoreCsvParse(rows, delimiter, quote) {
  if (!rows.length) {
    return -Infinity;
  }

  const header = rows[0].map((column) => String(column).trim());
  const normalizedHeader = header.map(normalizeFieldName);
  const requiredMatches = REQUIRED_COLUMNS.filter((column) =>
    normalizedHeader.includes(normalizeFieldName(column)),
  ).length;
  const expectedLength = header.length;
  const consistentRows = rows.filter((row) => row.length === expectedLength).length;
  const nonEmptyHeaderColumns = header.filter(Boolean).length;
  const firstLines = String(rows.slice(0, 5).flat().join("\n"));
  const delimiterHits = (firstLines.match(new RegExp(escapeRegExp(delimiter), "g")) || []).length;
  const wrappedQuoteCells = rows
    .slice(1, 10)
    .flat()
    .filter((cell) => hasWrappingQuote(cell, quote)).length;

  return (
    requiredMatches * 1000 +
    Math.min(nonEmptyHeaderColumns, 20) * 10 +
    consistentRows * 4 +
    delimiterHits -
    wrappedQuoteCells * 20 -
    (expectedLength <= 1 ? 100 : 0)
  );
}

function hasWrappingQuote(value, quote) {
  const text = String(value || "").trim();

  if (text.length < 2) {
    return false;
  }

  const otherQuote = quote === "'" ? '"' : "'";
  return text.startsWith(otherQuote) && text.endsWith(otherQuote);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function loadClientes(paths = PATHS) {
  const clientes = loadCsv(paths.csv);

  if (!paths.listFilter) {
    return clientes;
  }

  return applyListFilter(clientes, paths.listFilter);
}

function applyListFilter(clientes, filter) {
  if (!filter) {
    return clientes;
  }

  if (filter.field) {
    const hasColumn = clientes.some((cliente) =>
      buildCaseInsensitiveDataMap(cliente).has(normalizeFieldName(filter.field)),
    );

    if (!hasColumn) {
      throw new Error(`Filtro de lista inválido: coluna não encontrada: ${filter.field}.`);
    }

    return clientes.filter((cliente) => {
      const value = String(getRecordValue(cliente, filter.field) ?? "").trim();
      const expectedValue = String(filter.expectedValue ?? "").trim();

      if (filter.operator === "!=") {
        return value !== expectedValue;
      }

      return value === expectedValue;
    });
  }

  const ast = parseExpression(filter.expression);
  validateListFilterColumns(clientes, ast);

  return clientes.filter((cliente) => evaluateFilterExpression(ast, cliente));
}

function validateListFilterColumns(clientes, ast) {
  const identifiers = collectReferencedFields(ast);
  const availableColumns = new Set();

  for (const cliente of clientes) {
    for (const key of buildCaseInsensitiveDataMap(cliente).keys()) {
      availableColumns.add(key);
    }
  }

  for (const column of identifiers) {
    if (!availableColumns.has(normalizeFieldName(column))) {
      throw new Error(`Filtro de lista inválido: coluna não encontrada: ${column}.`);
    }
  }
}

function resolveModelTemplatePath(templateName, paths = PATHS) {
  const rawName = String(templateName || "")
    .trim()
    .replace(/^["'](.+)["']$/, "$1")
    .trim();

  if (!rawName) {
    return paths.template;
  }

  if (path.isAbsolute(rawName) || rawName.includes("/") || rawName.includes("\\")) {
    throw new Error(
      "Modelo inválido. Informe apenas o nome do arquivo dentro de ./modelos, sem caminho.",
    );
  }

  const ext = path.extname(rawName);

  if (ext && ext.toLocaleLowerCase("pt-BR") !== ".md") {
    throw new Error("Modelo inválido. Use o nome do arquivo sem extensão .md.");
  }

  const modelBaseName = ext ? rawName.slice(0, -ext.length) : rawName;

  if (!modelBaseName || modelBaseName === "." || modelBaseName === "..") {
    throw new Error("Modelo inválido. Informe um nome de arquivo válido.");
  }

  const modelsDir = paths.modelsDir || path.resolve(path.dirname(paths.template), "modelos");
  return path.resolve(modelsDir, `${modelBaseName}.md`);
}

function isListFilterExpression(value) {
  try {
    return expressionLooksLikeFilter(stripWrappingQuotes(value));
  } catch (_) {
    return false;
  }
}

function parseListFilter(value) {
  const expression = stripWrappingQuotes(value);

  if (!isListFilterExpression(expression)) {
    return null;
  }

  const legacyFilter = parseLegacyListFilter(expression);

  if (legacyFilter) {
    return legacyFilter;
  }

  parseExpression(expression);
  return { expression };
}

function parseLegacyListFilter(expression) {
  let quote = "";

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quote) {
      if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "!" && expression[index + 1] === "=") {
      return buildLegacyListFilter(expression, index, "!=");
    }

    if (char === "=") {
      return buildLegacyListFilter(expression, index, "=");
    }
  }

  return null;
}

function buildLegacyListFilter(expression, index, operator) {
  if (/[()<>+\-*/]|\|\||&&|\^\^|\$\./u.test(expression)) {
    return null;
  }

  const operatorLength = operator.length;
  const field = stripWrappingQuotes(expression.slice(0, index));
  const expectedValue = stripWrappingQuotes(expression.slice(index + operatorLength));

  if (!field) {
    throw new Error("Filtro de lista inválido. Informe a coluna antes do operador.");
  }

  return {
    expectedValue,
    expression,
    field,
    operator,
  };
}

function resolveListCsvPath(listName, paths = PATHS) {
  const rawName = stripWrappingQuotes(listName);

  if (!rawName) {
    return paths.csv;
  }

  if (path.isAbsolute(rawName) || rawName.includes("/") || rawName.includes("\\")) {
    throw new Error(
      "Lista inválida. Informe apenas o nome do arquivo dentro de ./listas, sem caminho.",
    );
  }

  const ext = path.extname(rawName);

  if (ext && ext.toLocaleLowerCase("pt-BR") !== ".csv") {
    throw new Error("Lista inválida. Use o nome do arquivo sem extensão .csv.");
  }

  const listBaseName = ext ? rawName.slice(0, -ext.length) : rawName;

  if (!listBaseName || listBaseName === "." || listBaseName === "..") {
    throw new Error("Lista inválida. Informe um nome de arquivo válido.");
  }

  const listsDir = paths.listsDir || path.resolve(path.dirname(paths.csv), "listas");
  return path.resolve(listsDir, `${listBaseName}.csv`);
}

function resolveListSelection(listArg, paths = PATHS) {
  if (!listArg) {
    return {};
  }

  const filter = parseListFilter(listArg);

  if (filter) {
    return {
      csv: paths.csv,
      listFilter: filter,
    };
  }

  return {
    csv: resolveListCsvPath(listArg, paths),
    listName: stripWrappingQuotes(listArg),
  };
}

function resolveCheckInputPath(filePath, extension, label) {
  const rawPath = stripWrappingQuotes(filePath);

  if (!rawPath) {
    return undefined;
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(process.cwd(), rawPath);

  if (path.extname(resolvedPath).toLocaleLowerCase("pt-BR") !== extension) {
    throw new Error(`${label} inválido. Use um arquivo ${extension}.`);
  }

  return resolvedPath;
}

function resolveExecutionPaths(paths = PATHS, options = {}) {
  const checkCsvPath =
    options.check && options.checkCsvPath
      ? resolveCheckInputPath(options.checkCsvPath, ".csv", "CSV de check")
      : undefined;
  const checkTemplatePath =
    options.check && options.checkTemplatePath
      ? resolveCheckInputPath(options.checkTemplatePath, ".md", "Template de check")
      : undefined;
  const basePaths = {
    ...paths,
    ...(checkCsvPath ? { csv: checkCsvPath } : {}),
    ...(checkTemplatePath
      ? {
          template: checkTemplatePath,
          templateBaseDir: path.dirname(checkTemplatePath),
        }
      : {}),
  };
  const listSelection = resolveListSelection(options.listArg, basePaths);

  return {
    ...basePaths,
    ...listSelection,
    template:
      checkTemplatePath
        ? checkTemplatePath
        : options.templateName
          ? resolveModelTemplatePath(options.templateName, basePaths)
          : basePaths.template,
  };
}

module.exports = {
  applyListFilter,
  isListFilterExpression,
  loadClientes,
  loadCsv,
  loadTemplate,
  parseListFilter,
  readTextFile,
  resolveCheckInputPath,
  resolveExecutionPaths,
  resolveListCsvPath,
  resolveListSelection,
  resolveModelTemplatePath,
};
