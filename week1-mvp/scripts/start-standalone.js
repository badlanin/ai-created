const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const standaloneDir = path.join(rootDir, ".next", "standalone");

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function applyCliOption(names, environmentName) {
  const optionIndex = process.argv.findIndex((argument) =>
    names.includes(argument),
  );
  const optionValue = process.argv[optionIndex + 1];
  if (optionIndex !== -1 && optionValue) {
    process.env[environmentName] = optionValue;
  }
}

applyCliOption(["-p", "--port"], "PORT");
applyCliOption(["-H", "--hostname"], "HOSTNAME");

copyDirectory(
  path.join(rootDir, ".next", "static"),
  path.join(standaloneDir, ".next", "static"),
);
copyDirectory(path.join(rootDir, "public"), path.join(standaloneDir, "public"));

const serverPath = path.join(standaloneDir, "server.js");
if (!fs.existsSync(serverPath)) {
  throw new Error('Standalone build not found. Run "npm run build" first.');
}

require(serverPath);
