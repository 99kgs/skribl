/**
 * Crop logo PNG (transparent). Animation is CSS wobble in index.html.
 * Run: node scripts/build-veritybl-logo.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const assetsDir = path.join(root, "img", "veritybl");

const srcDraw =
  process.env.VERITYBL_DRAW_SRC ||
  "C:\\Users\\User\\.cursor\\projects\\c-Users-User-Desktop-skribbl-game\\assets\\veritybl-37470b51-e6fc-4278-81e6-7ba8eb72ddaa.png";

fs.mkdirSync(assetsDir, { recursive: true });

const outDirPy = assetsDir.replace(/\\/g, "\\\\");
const srcDrawPy = srcDraw.replace(/\\/g, "\\\\");

const py = `
from PIL import Image

out_dir = r"${outDirPy}"

def crop_content(im, pad=12):
    im = im.convert("RGBA")
    def is_bg(px):
        if len(px) == 4 and px[3] < 8:
            return True
        r,g,b = px[:3]
        return r > 240 and g > 240 and b > 240
    w,h = im.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if not is_bg(im.getpixel((x,y))):
                xs.append(x); ys.append(y)
    if not xs:
        return im
    x0,y0,x1,y1 = min(xs)-pad, min(ys)-pad, max(xs)+pad, max(ys)+pad
    x0=max(0,x0); y0=max(0,y0); x1=min(w-1,x1); y1=min(h-1,y1)
    return im.crop((x0,y0,x1+1,y1+1))

def knock_out_white(im, threshold=235):
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                px[x, y] = (0, 0, 0, 0)
            elif r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (0, 0, 0, 0)
    return im

draw = knock_out_white(crop_content(Image.open(r"${srcDrawPy}"), 16))
draw.save(out_dir + "/frame-draw.png")
print("Wrote", out_dir + "/frame-draw.png")
`;

const pyPath = path.join(assetsDir, "_build_logo.py");
fs.writeFileSync(pyPath, py);
execSync(`python "${pyPath}"`, { stdio: "inherit", cwd: root });
try {
  fs.unlinkSync(pyPath);
} catch (_) {}
