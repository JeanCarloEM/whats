const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { MessageMedia } = require("whatsapp-web.js");

const { PATHS } = require("./config");
const { hashValue } = require("./utils");
const { parseTemplateParts } = require("./template");

const CAPTION_POSITION = Symbol("captionPosition");
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

function resolveLocalMediaPath(source, templatePath, baseDir) {
  const filePath = path.isAbsolute(source)
    ? source
    : path.resolve(baseDir || path.dirname(templatePath), source);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Anexo não encontrado: ${source}`);
  }

  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`Anexo não é um arquivo: ${source}`);
  }

  return filePath;
}

async function resolveMediaPath(source, paths = PATHS, downloadCache = new Map()) {
  if (!source) {
    throw new Error("Anexo sem caminho definido.");
  }

  if (!isUrl(source)) {
    return resolveLocalMediaPath(source, paths.template, paths.templateBaseDir);
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
      resolveLocalMediaPath(part.source, paths.template, paths.templateBaseDir);
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
    const media = MessageMedia.fromFilePath(filePath);

    if (isOggAudioOnly(filePath)) {
      await sendOggVoiceMessage(client, chatId, media, part);
      continue;
    }

    const options = {
      sendMediaAsDocument: shouldSendAsDocument(media),
    };

    if (part.caption) {
      options.caption = part.caption;
    }

    await client.sendMessage(chatId, media, options);
  }
}

async function sendOggVoiceMessage(client, chatId, media, part) {
  const caption = normalizeCaption(part.caption);
  const captionPosition = part[CAPTION_POSITION];

  if (caption && captionPosition === "before") {
    await client.sendMessage(chatId, caption);
  }

  await client.sendMessage(chatId, media, {
    sendAudioAsVoice: true,
    sendMediaAsDocument: false,
  });

  if (caption && captionPosition === "after") {
    await client.sendMessage(chatId, caption);
  }
}

module.exports = {
  buildSendPlan,
  downloadMediaUrl,
  isOggAudioOnly,
  isOggSource,
  isUrl,
  resolveMediaPath,
  sendRenderedTemplate,
  validateTemplateMediaReferences,
};
