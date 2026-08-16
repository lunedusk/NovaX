const fs = require("fs");
const path = require("path");

const oldVer = process.env. OLD_VER;
const newVer = process.env.NEW_VER;

if (!oldVer || !newVer) {
  console.error("OLD_VER and NEW_VER must be set");
  process.exit(1);
}

const escaped = oldVer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regex = new RegExp("(?<!\\d)" + escaped + "(?!\\d)", "g");

const SKIP_DIRS = new Set(["node_modules", ".git", "slim_build", "bundled_build"]);

function findDocFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findDocFiles(fullPath));
    } else if (/\.mdx?$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

for (const file of findDocFiles(".")) {
  const content = fs.readFileSync(file, "utf8");
  if (regex.test(content)) {
    const updated = content.replace(regex, newVer);
    fs.writeFileSync(file, updated);
    console.log("Updated", file);
  }
}
