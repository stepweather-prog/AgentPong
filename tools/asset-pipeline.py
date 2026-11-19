# AgentPong asset pipeline (Blender headless) — v2, после ручного удаления фона
# Usage:
#   blender -b -P tools/asset-pipeline.py -- probe     — техосмотр (только числа)
#   blender -b -P tools/asset-pipeline.py -- process   — webp-конверт + сплит листов 3x3
import bpy, os, sys
import numpy as np

ROOT = r"D:\stepweather-prog\AgentPong\Asset"

POSES   = [f"агент {i}.png" for i in range(1, 9)]
SHEETS  = [f"агент понг спрайт лист{i}.png" for i in range(1, 5)]
DIALOGS = ["диалоговое окно 1.png", "диалоговое окно 2.png"]


def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return img, buf.reshape(h, w, 4)


def save_webp(img, path):
    img.alpha_mode = 'STRAIGHT'
    img.filepath_raw = path
    img.file_format = 'WEBP'
    img.save()


def from_rgba(arr):
    h, w = arr.shape[:2]
    new = bpy.data.images.new("tmp", w, h, alpha=True)
    new.alpha_mode = 'STRAIGHT'
    buf = np.empty(w * h * 4, dtype=np.float32)
    buf[:] = arr.reshape(-1, 4).astype(np.float32).ravel()
    new.pixels.foreach_set(buf)
    # Blender хранит ряды снизу вверх; foreach_set использует ту же конвенцию,
    # что и foreach_get, поэтому замкнутый круг get->set безопасен.
    return new


def crop(a, pad=4):
    """Обрезка прозрачных полей (a: h,w,4)."""
    mask = a[:, :, 3] > 0.01
    if not mask.any():
        return a
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    h, w = a.shape[:2]
    r0 = max(0, rows[0] - pad); r1 = min(h - 1, rows[-1] + pad)
    c0 = max(0, cols[0] - pad); c1 = min(w - 1, cols[-1] + pad)
    return a[r0:r1 + 1, c0:c1 + 1]


def process():
    out = {}
    # позы и диалоговые окна: crop + webp
    for sub, names, prefix in (("agent", POSES, "agent"), ("ui", DIALOGS, "dialog")):
        d = os.path.join(ROOT, sub)
        os.makedirs(d, exist_ok=True)
        for i, rel in enumerate(names, 1):
            img, a = load_rgba(os.path.join(ROOT, rel))
            b = crop(a)
            dst = os.path.join(d, f"{prefix}-{i:02d}.webp")
            save_webp(from_rgba(b), dst)
            out[dst] = b.shape
            bpy.data.images.remove(img)
    # листы 3x3 -> 9 кадров; общий bbox по всем ячейкам листа,
    # чтобы кадры остались выровнены для анимации
    fd = os.path.join(ROOT, "frames")
    for i, rel in enumerate(SHEETS, 1):
        sd = os.path.join(fd, f"sheet-{i:02d}")
        os.makedirs(sd, exist_ok=True)
        img, a = load_rgba(os.path.join(ROOT, rel))
        H, W = a.shape[:2]
        rows = [slice(int(round(H * k / 3)), int(round(H * (k + 1) / 3))) for k in range(3)]
        cols = [slice(int(round(W * k / 3)), int(round(W * (k + 1) / 3))) for k in range(3)]
        cells = [[a[rows[r], cols[c]] for c in range(3)] for r in range(3)]
        h0, h1, w0, w1 = 10 ** 6, -1, 10 ** 6, -1
        for r in range(3):
            for c in range(3):
                m = cells[r][c][:, :, 3] > 0.01
                if not m.any():
                    continue
                rr = np.where(m.any(axis=1))[0]
                cc = np.where(m.any(axis=0))[0]
                h0 = min(h0, rr[0]); h1 = max(h1, rr[-1])
                w0 = min(w0, cc[0]); w1 = max(w1, cc[-1])
        if h1 < 0:  # пустой лист — не режем
            h0, h1, w0, w1 = 0, cells[0][0].shape[0] - 1, 0, cells[0][0].shape[1] - 1
        pad = 4
        n = 0
        for r in range(3):
            for c in range(3):
                n += 1
                cell = cells[r][c]
                ch, cw = cell.shape[:2]
                b = cell[max(0, h0 - pad):min(ch, h1 + pad + 1),
                         max(0, w0 - pad):min(cw, w1 + pad + 1)]
                dst = os.path.join(sd, f"sheet-{i:02d}-frame-{n:02d}.webp")
                save_webp(from_rgba(b), dst)
                out[dst] = b.shape
        bpy.data.images.remove(img)
    for dst, shape in sorted(out.items()):
        print(f"[out] {os.path.relpath(dst, ROOT):42s} {shape[1]}x{shape[0]}  {os.path.getsize(dst) // 1024} KB")


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
mode = args[0] if args else 'probe'
if mode == 'probe':
    probe()
elif mode == 'process':
    process()
