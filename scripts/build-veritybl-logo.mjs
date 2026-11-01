/**
 * Crop user artwork + build animated logo-veritybl.gif
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
const srcScreen =
  process.env.VERITYBL_SCREEN_SRC ||
  "C:\\Users\\User\\.cursor\\projects\\c-Users-User-Desktop-skribbl-game\\assets\\image-2ead882b-f797-4abd-aae9-d935f2f01a7f.png";

fs.mkdirSync(assetsDir, { recursive: true });

const outDirPy = assetsDir.replace(/\\/g, "\\\\");
const srcDrawPy = srcDraw.replace(/\\/g, "\\\\");
const srcScreenPy = srcScreen.replace(/\\/g, "\\\\");

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

draw = crop_content(Image.open(r"${srcDrawPy}"), 16)
draw.save(out_dir + "/frame-draw.png")

screen = Image.open(r"${srcScreenPy}").convert("RGBA")
sw, sh = screen.size
header = screen.crop((int(sw*0.22), int(sh*0.02), int(sw*0.78), int(sh*0.12)))
header = crop_content(header, 6)
header.save(out_dir + "/frame-mascot-strip.png")

target_h = max(draw.height, header.height, 72)

def scale_to_h(im, th):
    r = th / im.height
    nw = max(1, int(im.width * r))
    return im.resize((nw, th), Image.Resampling.LANCZOS)

d1 = scale_to_h(draw, target_h)
d2 = scale_to_h(draw, int(target_h * 1.05))
canvas2 = Image.new("RGBA", d1.size, (0,0,0,0))
canvas2.paste(d2, ((d1.width-d2.width)//2, (d1.height-d2.height)//2), d2)

gif_path = out_dir + "/logo-veritybl.gif"
frames = [
    d1.convert("P", palette=Image.ADAPTIVE, colors=128),
    canvas2.convert("P", palette=Image.ADAPTIVE, colors=128),
]
frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=700, loop=0, disposal=2)
print("Wrote", gif_path)
`;

const pyPath = path.join(assetsDir, "_build_logo.py");
fs.writeFileSync(pyPath, py);
execSync(`python "${pyPath}"`, { stdio: "inherit", cwd: root });
try {
  fs.unlinkSync(pyPath);
} catch (_) {}
