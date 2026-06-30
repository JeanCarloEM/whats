// Autor: JeanCarloEM.com
// Site do Autor: https://jeancarloem.com
// Licenca: Mozilla Public License 2.0
// Site da Licenca: https://www.mozilla.org/MPL/2.0/
// Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
// Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { fileURLToPath } = require("url");
const { MessageMedia } = require("whatsapp-web.js");

const { PATHS, ROOT_DIR, readIntegerEnv } = require("./config");
const { hashValue } = require("./utils");
const { parseTemplateParts } = require("./template");

const CAPTION_POSITION = Symbol("captionPosition");
const MEDIA_SEND_RETRIES = Math.max(1, readIntegerEnv("MEDIA_SEND_RETRIES", 5));
const MEDIA_SEND_RETRY_DELAY_MS = readIntegerEnv("MEDIA_SEND_RETRY_DELAY_MS", 1200);
const MEDIA_CONTEXT_READY_TIMEOUT_MS = readIntegerEnv("MEDIA_CONTEXT_READY_TIMEOUT_MS", 15000);
const MEDIA_CONTEXT_STABLE_MS = readIntegerEnv("MEDIA_CONTEXT_STABLE_MS", 500);
const AUDIO_OGG_MARKERS = [
  Buffer.from("OpusHead", "ascii"),
  Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]),
  Buffer.from("Speex   ", "ascii"),
  Buffer.from("fLaC", "ascii"),
];
const NON_AUDIO_OGG_MARKERS = [
  Buffer.from("theora", "ascii"),
  Buffer.from("fishead", "ascii"),
  Buffer.from("video", "ascii"),
];

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

function extensionFromContentType(contentType) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const map = {
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "text/plain": ".txt",
  };

  return map[type] || "";
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);
    return ext && ext.length <= 12 ? ext : "";
  } catch {
    return "";
  }
}

function findCachedDownload(cacheDir, url) {
  if (!fs.existsSync(cacheDir)) {
    return undefined;
  }

  const hash = hashValue(url);
  const entry = fs
    .readdirSync(cacheDir, { withFileTypes: true })
    .find((dirent) => dirent.isFile() && dirent.name.startsWith(hash));

  return entry ? path.join(cacheDir, entry.name) : undefined;
}

function resolveLocalMediaPath(source, templatePath, baseDir, fallbackDirs = [ROOT_DIR]) {
  const candidates = buildLocalMediaCandidates(source, templatePath, baseDir, fallbackDirs);

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    if (!fs.statSync(filePath).isFile()) {
      throw new Error(`Anexo não é um arquivo: ${source}`);
    }

    assertReadableFile(filePath, source);
    return filePath;
  }

  throw new Error(
    `Anexo não encontrado: ${source}. Locais verificados: ${candidates.join("; ")}`,
  );
}

function buildLocalMediaCandidates(source, templatePath, baseDir, fallbackDirs = [ROOT_DIR]) {
  const rawSource = normalizeLocalMediaSource(source);

  if (path.isAbsolute(rawSource)) {
    return [path.normalize(rawSource)];
  }

  const dirs = [
    baseDir,
    templatePath ? path.dirname(templatePath) : "",
    ...fallbackDirs,
  ];
  const uniqueDirs = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!dir) {
      continue;
    }

    const normalized = path.resolve(dir);
    const key = process.platform === "win32"
      ? normalized.toLocaleLowerCase("pt-BR")
      : normalized;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueDirs.push(normalized);
    }
  }

  return uniqueDirs.map((dir) => path.resolve(dir, rawSource));
}

function normalizeLocalMediaSource(source) {
  const rawSource = String(source || "")
    .trim()
    .replace(/^["'](.+)["']$/, "$1")
    .trim();

  if (/^file:\/\//iu.test(rawSource)) {
    try {
      return fileURLToPath(rawSource);
    } catch {
      return rawSource;
    }
  }

  return rawSource;
}

function assertReadableFile(filePath, source) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (err) {
    throw new Error(
      `Anexo não pôde ser lido: ${source}. Caminho resolvido: ${filePath}. ${err.message}`,
    );
  }
}

function getMediaFallbackDirs(paths = PATHS) {
  return [
    paths.root,
    ROOT_DIR,
  ].filter(Boolean);
}

async function resolveMediaPath(source, paths = PATHS, downloadCache = new Map()) {
  if (!source) {
    throw new Error("Anexo sem caminho definido.");
  }

  if (!isUrl(source)) {
    return resolveLocalMediaPath(
      source,
      paths.template,
      paths.templateBaseDir,
      getMediaFallbackDirs(paths),
    );
  }

  if (downloadCache.has(source)) {
    return downloadCache.get(source);
  }

  const downloadedPath = await downloadMediaUrl(source, paths.mediaCacheDir);
  downloadCache.set(source, downloadedPath);
  return downloadedPath;
}

async function downloadMediaUrl(url, cacheDir = PATHS.mediaCacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachedPath = findCachedDownload(cacheDir, url);

  if (cachedPath) {
    return cachedPath;
  }

  const extFromUrl = extensionFromUrl(url);
  const pendingPath = path.join(cacheDir, `${hashValue(url)}${extFromUrl}`);

  if (fs.existsSync(pendingPath)) {
    return pendingPath;
  }

  const response = await fetchUrlBuffer(url);
  const ext = extFromUrl || extensionFromContentType(response.contentType);
  const filePath = path.join(cacheDir, `${hashValue(url)}${ext}`);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, response.body);
  }

  return filePath;
}

function fetchUrlBuffer(url, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Redirecionamentos demais ao baixar: ${url}`));
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const request = transport.get(parsed, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        resolve(fetchUrlBuffer(new URL(location, parsed).toString(), redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Falha ao baixar anexo (${statusCode}): ${url}`));
        return;
      }

      const chunks = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks),
          contentType: response.headers["content-type"],
        });
      });
    });

    request.on("error", reject);
    request.setTimeout(60000, () => {
      request.destroy(new Error(`Tempo esgotado ao baixar anexo: ${url}`));
    });
  });
}

function shouldSendAsDocument(media) {
  return !String(media.mimetype || "").startsWith("image/");
}

function createMessageMediaFromFile(filePath) {
  const normalizedPath = path.normalize(filePath);
  const filename = path.basename(normalizedPath);
  let stat;

  try {
    stat = fs.statSync(normalizedPath);
    const data = fs.readFileSync(normalizedPath).toString("base64");
    return new MessageMedia(
      inferMediaMimeType(normalizedPath),
      data,
      filename,
      stat.size,
    );
  } catch (err) {
    throw new Error(`Falha ao ler anexo: ${normalizedPath}. ${err.message}`);
  }
}

function inferMediaMimeType(filePath) {
  const ext = path.extname(filePath).toLocaleLowerCase("pt-BR");
  const types = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".webp": "image/webp",
    ".zip": "application/zip",
  };

  return types[ext] || "application/octet-stream";
}

function isOggSource(source) {
  if (!source) {
    return false;
  }

  try {
    const value = isUrl(source) ? new URL(source).pathname : source;
    return path.extname(value).toLocaleLowerCase("pt-BR") === ".ogg";
  } catch {
    return path.extname(String(source)).toLocaleLowerCase("pt-BR") === ".ogg";
  }
}

function isOggAudioOnly(filePath) {
  if (path.extname(filePath).toLocaleLowerCase("pt-BR") !== ".ogg") {
    return false;
  }

  const buffer = readFilePrefix(filePath, 256 * 1024);

  if (buffer.length < 4 || buffer.subarray(0, 4).toString("ascii") !== "OggS") {
    return false;
  }

  if (NON_AUDIO_OGG_MARKERS.some((marker) => bufferIncludes(buffer, marker))) {
    return false;
  }

  return AUDIO_OGG_MARKERS.some((marker) => bufferIncludes(buffer, marker));
}

function readFilePrefix(filePath, maxBytes) {
  const fd = fs.openSync(filePath, "r");

  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(size);
    const bytesRead = fs.readSync(fd, buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function bufferIncludes(buffer, marker) {
  return buffer.indexOf(marker) !== -1;
}

function normalizeCaption(value) {
  return String(value || "").trim();
}

function buildSendPlan(parts) {
  const plan = [];
  const mediaCaptions = new Map();
  const consumedText = new Set();
  const firstTextIndex = parts.findIndex((part) => part.type === "text");
  const lastTextIndex = parts.findLastIndex((part) => part.type === "text");

  if (
    firstTextIndex > 0 &&
    parts
      .slice(0, firstTextIndex)
      .every((part) => part.type === "media" && !isOggSource(part.source))
  ) {
    mediaCaptions.set(firstTextIndex - 1, {
      position: "after",
      value: normalizeCaption(parts[firstTextIndex].value),
    });
    consumedText.add(firstTextIndex);
  }

  if (
    lastTextIndex >= 0 &&
    lastTextIndex < parts.length - 1 &&
    !consumedText.has(lastTextIndex) &&
    parts
      .slice(lastTextIndex + 1)
      .every((part) => part.type === "media" && !isOggSource(part.source))
  ) {
    mediaCaptions.set(lastTextIndex + 1, {
      position: "before",
      value: normalizeCaption(parts[lastTextIndex].value),
    });
    consumedText.add(lastTextIndex);
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part.type === "text") {
      if (!consumedText.has(index)) {
        plan.push(part);
      }

      continue;
    }

    const plannedPart = {
      ...part,
      ...(mediaCaptions.has(index)
        ? { caption: mediaCaptions.get(index).value }
        : {}),
    };

    if (mediaCaptions.has(index)) {
      Object.defineProperty(plannedPart, CAPTION_POSITION, {
        value: mediaCaptions.get(index).position,
      });
    }

    plan.push(plannedPart);
  }

  return plan;
}

function validateTemplateMediaReferences(template, paths = PATHS) {
  const issues = [];

  for (const part of parseTemplateParts(template)) {
    if (part.type !== "media" || isUrl(part.source)) {
      continue;
    }

    try {
      resolveLocalMediaPath(
        part.source,
        paths.template,
        paths.templateBaseDir,
        getMediaFallbackDirs(paths),
      );
    } catch (err) {
      issues.push(err.message);
    }
  }

  return issues;
}

async function sendRenderedTemplate(client, chatId, renderedTemplate, paths = PATHS) {
  const parts = buildSendPlan(parseTemplateParts(renderedTemplate));
  const downloadCache = new Map();

  for (const part of parts) {
    if (part.type === "text") {
      await client.sendMessage(chatId, part.value);
      continue;
    }

    const filePath = await resolveMediaPath(part.source, paths, downloadCache);

    if (isOggAudioOnly(filePath)) {
      await sendOggVoiceMessage(client, chatId, filePath, part);
      continue;
    }

    const media = createMessageMediaFromFile(filePath);
    const options = {
      sendMediaAsDocument: shouldSendAsDocument(media),
      waitUntilMsgSent: true,
    };

    if (part.caption) {
      options.caption = part.caption;
    }

    await sendMediaMessageWithRetry(client, chatId, () => createMessageMediaFromFile(filePath), options, {
      label: path.basename(filePath),
    });
  }
}

async function sendOggVoiceMessage(client, chatId, filePath, part) {
  const caption = normalizeCaption(part.caption);
  const captionPosition = part[CAPTION_POSITION];
  const filename = path.basename(filePath);

  if (caption && captionPosition === "before") {
    await client.sendMessage(chatId, caption);
  }

  try {
    await sendMediaMessageWithRetry(
      client,
      chatId,
      () => createOggVoiceMedia(createMessageMediaFromFile(filePath)),
      {
        sendAudioAsVoice: true,
        sendMediaAsDocument: false,
        waitUntilMsgSent: true,
      },
      {
        label: filename,
      },
    );
  } catch (voiceErr) {
    await sendMediaMessageWithRetry(
      client,
      chatId,
      () => createMessageMediaFromFile(filePath),
      {
        sendAudioAsVoice: false,
        sendMediaAsDocument: false,
        waitUntilMsgSent: true,
      },
      {
        label: filename,
        previousError: voiceErr,
      },
    );
  }

  if (caption && captionPosition === "after") {
    await client.sendMessage(chatId, caption);
  }
}

async function sendMediaMessageWithRetry(client, chatId, mediaFactory, options = {}, context = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MEDIA_SEND_RETRIES; attempt += 1) {
    try {
      await waitForWhatsAppMediaContext(client);
      return await client.sendMessage(chatId, mediaFactory(), options);
    } catch (err) {
      lastError = err;

      if (attempt >= MEDIA_SEND_RETRIES || !isTransientMediaSendError(err)) {
        break;
      }

      await delay(MEDIA_SEND_RETRY_DELAY_MS * attempt);
      await waitForWhatsAppMediaContext(client);
    }
  }

  const previous = context.previousError
    ? ` Tentativa como áudio de voz falhou antes: ${context.previousError.message || context.previousError}.`
    : "";
  const label = context.label ? ` (${context.label})` : "";
  throw new Error(`Falha ao enviar anexo${label}: ${lastError.message || lastError}.${previous}`);
}

function isTransientMediaSendError(err) {
  const message = err && err.message ? err.message : String(err || "");
  return /Protocol error|Runtime\.callFunctionOn|Promise was collected|Execution context was destroyed|detached Frame|Target closed|Session closed|Navigation|Timeout|ERR_|window\.require is not a function|sendIq called before startComms/iu.test(message);
}

async function waitForWhatsAppMediaContext(client, timeoutMs = MEDIA_CONTEXT_READY_TIMEOUT_MS) {
  const page = client && client.pupPage;

  if (!page || typeof page.evaluate !== "function") {
    return true;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      if (typeof page.isClosed === "function" && page.isClosed()) {
        throw new Error("Página do WhatsApp Web fechada.");
      }

      const ready = await page.evaluate(() => {
        try {
          return Boolean(
            window.WWebJS &&
              window.WWebJS.getChat &&
              window.WWebJS.sendMessage &&
              typeof window.require === "function" &&
              window.require("WAWebCollections"),
          );
        } catch (_) {
          return false;
        }
      });

      if (ready) {
        if (MEDIA_CONTEXT_STABLE_MS > 0) {
          await delay(MEDIA_CONTEXT_STABLE_MS);
        }

        return true;
      }
    } catch (_) {
      // Navegação ou frame destacado durante a espera: tenta novamente até o timeout.
    }

    await delay(300);
  }

  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function createOggVoiceMedia(media) {
  return new MessageMedia(
    "audio/ogg",
    media.data,
    media.filename || "audio.ogg",
    media.filesize,
  );
}

module.exports = {
  buildLocalMediaCandidates,
  createMessageMediaFromFile,
  buildSendPlan,
  createOggVoiceMedia,
  downloadMediaUrl,
  getMediaFallbackDirs,
  inferMediaMimeType,
  isOggAudioOnly,
  isOggSource,
  isUrl,
  isTransientMediaSendError,
  resolveLocalMediaPath,
  resolveMediaPath,
  sendRenderedTemplate,
  sendMediaMessageWithRetry,
  waitForWhatsAppMediaContext,
  validateTemplateMediaReferences,
};
