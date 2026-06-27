// Autor: JeanCarloEM.com
// Site do Autor: https://jeancarloem.com
// Licenca: Mozilla Public License 2.0
// Site da Licenca: https://www.mozilla.org/MPL/2.0/
// Resumo da Licenca: uso, copia, modificacao e distribuicao permitidos conforme os termos da MPL-2.0.
// Disclaimer: fornecido "AS IS", sem garantias de qualquer tipo.

const childProcess = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const OWNER = "JeanCarloEM";
const REPO = "WhatSend";
const ROOT_DIR = path.resolve(__dirname, "..");
const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const MAIN_TARBALL_URL = `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/heads/main`;

const PROTECTED_ROOT_ENTRIES = new Set([
  ".env",
  ".git",
  ".runtime",
  ".wwebjs_auth",
  ".wwebjs_cache",
  ".wwebjs_sessions.json",
  "clientes.csv",
  "logs",
  "node_modules",
  "texto.md",
]);

function requestBuffer(url, options = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Redirecionamentos demais ao baixar: ${url}`));
  }

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: options.accept || "application/octet-stream",
          "User-Agent": `${REPO}-updater`,
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const location = res.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          res.resume();
          resolve(requestBuffer(new URL(location, url).toString(), options, redirectCount + 1));
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            body: Buffer.concat(chunks),
            statusCode,
          });
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error(`Tempo esgotado ao acessar: ${url}`));
    });
  });
}

async function resolveUpdateSource() {
  const response = await requestBuffer(`${GITHUB_API}/releases/latest`, {
    accept: "application/vnd.github+json",
  });

  if (response.statusCode === 200) {
    const release = JSON.parse(response.body.toString("utf8"));

    if (release.tarball_url) {
      return {
        label: `release ${release.tag_name || "mais recente"}`,
        url: release.tarball_url,
      };
    }
  }

  if (response.statusCode === 404) {
    return {
      label: "branch main (nenhuma release publicada)",
      url: MAIN_TARBALL_URL,
    };
  }

  throw new Error(
    `Falha ao consultar releases do GitHub (${response.statusCode}): ${response.body.toString("utf8").slice(0, 300)}`,
  );
}

async function downloadTarball(source) {
  const response = await requestBuffer(source.url);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Falha ao baixar ${source.label} (${response.statusCode}).`);
  }

  return response.body;
}

function readTarString(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/u, "")
    .trim();
}

function readTarSize(buffer, start) {
  const value = readTarString(buffer, start, 12).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function isEmptyTarBlock(buffer, offset) {
  for (let index = offset; index < offset + 512; index += 1) {
    if (buffer[index] !== 0) {
      return false;
    }
  }

  return true;
}

function safeTarPath(name) {
  const normalized = name.replace(/\\/gu, "/").replace(/^\/+/u, "");
  const withoutRoot = normalized.split("/").slice(1).join("/");

  if (!withoutRoot || withoutRoot.includes("..")) {
    return "";
  }

  return withoutRoot;
}

function extractTarGz(tarGzBuffer, destinationDir) {
  const tar = zlib.gunzipSync(tarGzBuffer);

  for (let offset = 0; offset < tar.length;) {
    if (offset + 512 > tar.length || isEmptyTarBlock(tar, offset)) {
      break;
    }

    const rawName = readTarString(tar, offset, 100);
    const prefix = readTarString(tar, offset + 345, 155);
    const type = String.fromCharCode(tar[offset + 156] || 0);
    const size = readTarSize(tar, offset + 124);
    const fullName = prefix ? `${prefix}/${rawName}` : rawName;
    const relativePath = safeTarPath(fullName);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (relativePath) {
      const targetPath = path.join(destinationDir, relativePath);

      if (type === "5") {
        fs.mkdirSync(targetPath, { recursive: true });
      } else if (type === "0" || type === "\0" || type === "") {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, tar.subarray(contentStart, contentEnd));
      }
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }
}

function shouldSkip(relativePath) {
  const firstPart = relativePath.split(/[\\/]/u)[0];
  return PROTECTED_ROOT_ENTRIES.has(firstPart);
}

function copyTree(sourceDir, targetDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const relativePath = path.relative(sourceDir, sourcePath);

    copyEntry(sourcePath, path.join(targetDir, entry.name), relativePath);
  }
}

function copyEntry(sourcePath, targetPath, relativePath) {
  if (shouldSkip(relativePath)) {
    console.log(`Preservando arquivo/pasta local: ${relativePath}`);
    return;
  }

  const stat = fs.statSync(sourcePath);

  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });

    for (const entry of fs.readdirSync(sourcePath)) {
      copyEntry(
        path.join(sourcePath, entry),
        path.join(targetPath, entry),
        path.join(relativePath, entry),
      );
    }

    return;
  }

  if (!stat.isFile()) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function run(command, args, options = {}) {
  console.log(`> ${[command, ...args].join(" ")}`);
  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PUPPETEER_SKIP_DOWNLOAD: "true",
    },
    shell: process.platform === "win32",
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Comando falhou: ${command} ${args.join(" ")}`);
  }
}

async function updateProject() {
  const source = await resolveUpdateSource();
  console.log(`Fonte da atualização: ${source.label}`);

  const tarball = await downloadTarball(source);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${REPO}-update-`));
  const extractDir = path.join(tempDir, "source");

  fs.mkdirSync(extractDir, { recursive: true });
  extractTarGz(tarball, extractDir);
  copyTree(extractDir, ROOT_DIR);

  run("npm", ["install"]);
  run("node", ["scripts/ensure-browser.js"]);

  console.log("Atualização concluída.");
}

if (require.main === module) {
  updateProject().catch((err) => {
    console.error(`Atualização falhou: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAIN_TARBALL_URL,
  PROTECTED_ROOT_ENTRIES,
  copyTree,
  extractTarGz,
  resolveUpdateSource,
  safeTarPath,
  shouldSkip,
  updateProject,
};
