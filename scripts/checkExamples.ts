import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "barrel-package-check-"));
const generatedDirectories = new Set(["node_modules", "out", ".vite", ".git"]);

function run(args: ReadonlyArray<string>, cwd: string): void {
  const pnpm = process.env["npm_execpath"];
  if (!pnpm) throw new Error("Run this check with pnpm check:examples");

  execFileSync(process.execPath, [pnpm, ...args], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  });
}

try {
  run(["pack", "--pack-destination", workspace], root);

  const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("SDK package version is missing");
  }

  const { version } = manifest;
  const archive = join(workspace, `barrel-kit-sdk-electron-${version}.tgz`);

  for (const name of ["electron-forge-app", "electron-builder-app"]) {
    const example = join(workspace, name);
    cpSync(join(root, "examples", name), example, {
      recursive: true,
      filter: (source) => !generatedDirectories.has(basename(source)),
    });

    console.log(`Validating packed SDK in ${name}`);
    run(["add", archive], example);
    run(["typecheck"], example);
    run(["package"], example);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
