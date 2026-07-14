/**
 * PM2 Ecosystem Config — AROS Platform
 * https://pm2.keymetrics.io/docs/usage/application-declaration/
 *
 * NOTE: tsx does not forward --env-file to the child process, so we parse
 * .env at require-time and inject vars into PM2's env_production block.
 */
const { readFileSync } = require("fs");
const { join } = require("path");

function loadDotEnv(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

const dotEnv = loadDotEnv(join(__dirname, "..", "..", ".env"));

module.exports = {
  apps: [
    {
      name: "aros-platform",
      script: "src/server.ts",
      interpreter: "node_modules/.bin/tsx",
      cwd: "/opt/aros-platform",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "512M",
      error_file: "/var/log/aros/error.log",
      out_file: "/var/log/aros/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        NODE_ENV: "development",
        PORT: 5457,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5457,
        ...dotEnv,
      },
      env_staging: {
        NODE_ENV: "staging",
        PORT: 5457,
      },
    },
  ],
};
