/**
 * Renders the Savespace logo (resources/logo.svg) into the app's icons using Electron's own
 * graphics engine, so the shape is exact:
 *   resources/trayTemplate.png (+ @2x)  – monochrome menu-bar template image
 *   build/icon.png                      – 1024×1024 app icon (gradient squircle + white logo)
 * Run: npm run icons
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'resources/logo.svg'), 'utf8')
const d = /\sd="([^"]+)"/.exec(svg)[1]
const [, , vw, vh] = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number)

const page = `<!doctype html><canvas id="c"></canvas><script>
const d = ${JSON.stringify(d)}, VW = ${vw}, VH = ${vh};
function logo(ctx, x, y, h, color) {
  const s = h / VH, p = new Path2D(d);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.miterLimit = 10;
  ctx.fill(p); ctx.stroke(p); ctx.restore();
  return VW * s;
}
window.tray = (size) => {
  const c = document.getElementById('c'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, size, size);
  const h = size * 0.86, w = VW * h / VH;
  logo(ctx, (size - w) / 2, (size - h) / 2, h, '#000');
  return c.toDataURL('image/png');
};
window.appIcon = () => {
  const S = 1024, c = document.getElementById('c'); c.width = S; c.height = S;
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, S, S);
  // macOS-style rounded square with an 10% margin (Apple's icon grid)
  const m = S * 0.1, r = S * 0.225, x = m, y = m, w = S - 2 * m;
  const sq = new Path2D(); sq.roundRect(x, y, w, w, r);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#05070b'; ctx.fill(sq); ctx.restore();
  ctx.save(); ctx.clip(sq);
  const glow = (cx, cy, rad, col) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(5,7,11,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, w); };
  glow(x + w * 0.15, y + w * 0.1, w * 0.85, 'rgba(31,79,216,0.95)');  // blue
  glow(x + w * 0.95, y + w * 0.2, w * 0.8, 'rgba(15,155,142,0.85)');  // teal
  glow(x + w * 0.2, y + w * 0.95, w * 0.8, 'rgba(22,163,74,0.85)');   // green
  glow(x + w * 0.9, y + w * 0.95, w * 0.7, 'rgba(14,116,144,0.8)');   // deep teal
  ctx.restore();
  const h = w * 0.56, lw = VW * h / VH;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
  logo(ctx, (S - lw) / 2, (S - h) / 2, h, '#ffffff'); ctx.restore();
  return c.toDataURL('image/png');
};
</script>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;base64,' + Buffer.from(page).toString('base64'))
  const save = async (expr, file) => {
    const url = await win.webContents.executeJavaScript(expr)
    fs.writeFileSync(path.join(root, file), Buffer.from(url.split(',')[1], 'base64'))
    console.log('wrote', file)
  }
  await save('tray(18)', 'resources/trayTemplate.png')
  await save('tray(36)', 'resources/trayTemplate@2x.png')
  await save('appIcon()', 'build/icon.png')
  app.exit(0)
})
