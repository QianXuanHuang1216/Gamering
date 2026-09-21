// node:test 专用 ESM loader：把 Next 的 `@/` 前缀映射到仓库根。
// 仅做前缀改写，其余走默认 resolve；不影响其他测试文件。
import { pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function withExtension(p) {
  if (existsSync(p) && statSync(p).isFile()) return p;
  if (existsSync(p + ".js")) return p + ".js";
  if (existsSync(p + ".jsx")) return p + ".jsx";
  const idx = path.join(p, "index.js");
  if (existsSync(idx)) return idx;
  return p;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(pathToFileURL(withExtension(path.join(root, specifier.slice(2)))).href, context);
  }
  return next(specifier, context);
}
