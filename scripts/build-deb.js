// Builds dist/friends_<version>_amd64.deb: Electron + this app in /opt/friends,
// a `friends` command, a launcher entry and icons. No extra packages needed:
// only Electron (a dev dependency, already downloaded by `npm install`),
// npm, and dpkg-deb. Install with: sudo apt install ./dist/friends_*.deb
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const electronDist = path.join(root, "node_modules", "electron", "dist");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

if (!fs.existsSync(path.join(electronDist, "electron"))) {
  console.error("Electron isn't downloaded yet. Run: node node_modules/electron/install.js");
  process.exit(1);
}

const out = path.join(root, "dist");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "friends-deb-"));
const pkgRoot = path.join(work, "pkg");
const opt = path.join(pkgRoot, "opt", "friends");
const app = path.join(opt, "resources", "app");

try {
  // Electron itself, with our name on the program
  fs.cpSync(electronDist, opt, { recursive: true });
  fs.renameSync(path.join(opt, "electron"), path.join(opt, "friends"));
  fs.rmSync(path.join(opt, "resources", "default_app.asar"), { force: true });

  // The app, with only its runtime dependencies
  fs.mkdirSync(app, { recursive: true });
  for (const dir of ["electron", "server", "src"]) fs.cpSync(path.join(root, dir), path.join(app, dir), { recursive: true });
  fs.mkdirSync(path.join(app, "build"));
  fs.copyFileSync(path.join(root, "build", "icon.png"), path.join(app, "build", "icon.png"));
  const appPkg = { ...pkg, scripts: undefined, devDependencies: undefined, build: undefined };
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify(appPkg, null, 2));
  fs.copyFileSync(path.join(root, "package-lock.json"), path.join(app, "package-lock.json"));
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: app });
  fs.rmSync(path.join(app, "package-lock.json"));

  // Command, launcher and icons
  fs.mkdirSync(path.join(pkgRoot, "usr", "bin"), { recursive: true });
  fs.symlinkSync("/opt/friends/friends", path.join(pkgRoot, "usr", "bin", "friends"));
  const apps = path.join(pkgRoot, "usr", "share", "applications");
  fs.mkdirSync(apps, { recursive: true });
  fs.writeFileSync(
    path.join(apps, "friends.desktop"),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Friends",
      "Comment=A personal AI chat app, with voice and a 3D companion",
      "Exec=/opt/friends/friends",
      "Icon=friends",
      "Terminal=false",
      "Categories=Network;InstantMessaging;Chat;",
      "StartupWMClass=Friends",
      "StartupNotify=true",
      "",
    ].join("\n")
  );
  for (const size of [512, 256, 128, 64]) {
    const dir = path.join(pkgRoot, "usr", "share", "icons", "hicolor", `${size}x${size}`, "apps");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, "friends.png");
    if (size === 512) fs.copyFileSync(path.join(root, "build", "icon.png"), target);
    else run("convert", [path.join(root, "build", "icon.png"), "-resize", `${size}x${size}`, target]);
  }

  // Package metadata; the sandbox helper needs its setuid bit, which only root can set
  const debian = path.join(pkgRoot, "DEBIAN");
  fs.mkdirSync(debian);
  const kb = Math.ceil(Number(execFileSync("du", ["-sk", pkgRoot]).toString().split("\t")[0]));
  fs.writeFileSync(
    path.join(debian, "control"),
    [
      "Package: friends",
      `Version: ${pkg.version}`,
      "Section: net",
      "Priority: optional",
      "Architecture: amd64",
      `Installed-Size: ${kb}`,
      `Maintainer: ${pkg.author}`,
      `Homepage: ${pkg.homepage}`,
      "Depends: libgtk-3-0t64 | libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0t64 | libatspi2.0-0, libuuid1, libsecret-1-0, libasound2t64 | libasound2",
      "Description: Friends, a personal AI chat app",
      " Chat, voice conversation and a 3D companion robot, running on this",
      " computer. Your chats, settings and keys stay in ~/.config/friends.",
      "",
    ].join("\n")
  );
  const script = (body) => `#!/bin/sh\nset -e\n${body}\n`;
  fs.writeFileSync(path.join(debian, "postinst"), script("chmod 4755 /opt/friends/chrome-sandbox\ncommand -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true\ncommand -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true"), { mode: 0o755 });

  fs.mkdirSync(out, { recursive: true });
  const deb = path.join(out, `friends_${pkg.version}_amd64.deb`);
  run("dpkg-deb", ["--root-owner-group", "-Zzstd", "-z10", "--build", pkgRoot, deb]);
  console.log(`\nBuilt ${deb}\nInstall with: sudo apt install ${deb}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
