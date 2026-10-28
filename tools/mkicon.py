# -*- coding: utf-8 -*-
"""Hitouch 图标。

底板：深墨 squircle（渐变 + 顶部柔光 + 冷蓝氛围光 + 受光内描边）。
主体：一枚实心、端头全圆、横梁穿出两柱的 H。
      无斜撑、无装饰弧、无描边 —— 只有一块实心的白。
小尺寸（48/32/16）单独重绘并加粗，保证缩到任务栏仍是一块干净的白。
"""

import struct, zlib, binascii, math

BASE = 1024
SS = 2

TOP = (29, 34, 42)          # #1D222A
BOT = (9, 10, 13)           # #090A0D
BLUE = (47, 123, 246)
WHITE = (255, 255, 255)

BIG = dict(
    pad=30,
    corner=0.175,
    stem=114.0,
    beam=94.0,
    xl=290.0, xr=734.0,
    yt=212.0, yb=812.0,
    beam_y=496.0,
    rbr=0.40,          # 笔画圆角 = 笔画宽 × rbr
)

SMALL = dict(
    # 所有关键量都是 64 的倍数 —— 在 16 / 32 / 48 px 下正好落在整像素上
    pad=40,
    corner=0.220,
    stem=128.0,
    beam=128.0,
    xl=256.0, xr=768.0,
    yt=192.0, yb=832.0,
    beam_y=512.0,
    rbr=0.34,
    flat=True,         # 小尺寸不叠渐变，避免像素发灰
)


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def lerp(a, b, t):
    return a + (b - a) * t


def sd_rrect(px, py, cx, cy, hx, hy, r):
    qx = abs(px - cx) - (hx - r)
    qy = abs(py - cy) - (hy - r)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def render(cfg):
    R = BASE * SS
    K = float(SS)
    buf = bytearray(R * R * 4)

    def blend(x, y, c, a):
        if a <= 0.0 or x < 0 or y < 0 or x >= R or y >= R:
            return
        if a > 1.0:
            a = 1.0
        i = (y * R + x) * 4
        da = buf[i + 3] / 255.0
        oa = a + da * (1.0 - a)
        if oa <= 0.0:
            return
        for k in range(3):
            buf[i + k] = int(round((c[k] * a + buf[i + k] * da * (1.0 - a)) / oa))
        buf[i + 3] = int(round(oa * 255))

    # ---------- 底板 ----------
    pad = cfg['pad']
    hx = hy = (BASE - 2.0 * pad) / 2.0
    rad = (BASE - 2.0 * pad) * cfg['corner']
    ccx = ccy = BASE / 2.0
    y0, y1 = pad, BASE - pad
    glow_cy = ccy - 0.30 * BASE
    glow_r = 0.54 * BASE

    for y in range(max(0, int((ccy - hy) * K) - 2), min(R, int((ccy + hy) * K) + 2)):
        py = (y + 0.5) / K
        for x in range(max(0, int((ccx - hx) * K) - 2), min(R, int((ccx + hx) * K) + 2)):
            px = (x + 0.5) / K
            d = sd_rrect(px, py, ccx, ccy, hx, hy, rad)
            a = clamp(0.5 - d * K)
            if a <= 0.0:
                continue

            t = clamp((py - y0) / (y1 - y0))
            tt = t ** 1.18
            cr = lerp(TOP[0], BOT[0], tt)
            cg = lerp(TOP[1], BOT[1], tt)
            cb = lerp(TOP[2], BOT[2], tt)

            if t < 0.55:
                w = 1.0 - t / 0.55
                f = 0.055 * (w ** 1.7)
                cr += (255 - cr) * f
                cg += (255 - cg) * f
                cb += (255 - cb) * f

            gd = math.hypot(px - ccx, py - glow_cy) / glow_r
            if gd < 1.0:
                f = 0.048 * (1.0 - gd) ** 2
                cr += (BLUE[0] - cr) * f
                cg += (BLUE[1] - cg) * f
                cb += (BLUE[2] - cb) * f

            if d > -3.0:
                edge = clamp(1.0 - abs(d + 1.5) / 1.5)
                edge *= 0.30 + 0.70 * (1.0 - t)
                f = 0.08 * edge
                cr += (255 - cr) * f
                cg += (255 - cg) * f
                cb += (255 - cb) * f

            i = (y * R + x) * 4
            buf[i] = int(clamp(cr, 0, 255))
            buf[i + 1] = int(clamp(cg, 0, 255))
            buf[i + 2] = int(clamp(cb, 0, 255))
            buf[i + 3] = int(round(a * 255))

    # ---------- 笔画：圆角矩形填白，带极轻的垂直渐变 ----------
    yt, yb = cfg['yt'], cfg['yb']

    def white_at(py):
        if cfg.get('flat'):
            return (255.0, 255.0, 255.0)
        t = clamp((py - yt) / max(1.0, yb - yt))
        v = lerp(255.0, 243.0, t ** 1.4)
        return (v, v, min(255.0, v + 2.0))

    def rrect(cx, cy, hw, hh, r):
        minx = max(0, int((cx - hw - 2) * K) - 1)
        maxx = min(R, int((cx + hw + 2) * K) + 2)
        miny = max(0, int((cy - hh - 2) * K) - 1)
        maxy = min(R, int((cy + hh + 2) * K) + 2)
        for y in range(miny, maxy):
            py = (y + 0.5) / K
            for x in range(minx, maxx):
                px = (x + 0.5) / K
                d = sd_rrect(px, py, cx, cy, hw, hh, r)
                a = clamp(0.5 - d * K)
                if a > 0.0:
                    blend(x, y, white_at(py), a)

    s = cfg['stem']
    bw = cfg['beam']
    xl, xr = cfg['xl'], cfg['xr']
    cap = s / 2.0
    cy = (yt + yb) / 2.0
    hh = (yb - yt) / 2.0

    # 两竖
    rrect(xl, cy, cap, hh, s * cfg['rbr'])
    rrect(xr, cy, cap, hh, s * cfg['rbr'])

    # 横梁：贯穿两柱，比竖柱略细，位置上提一点
    rrect((xl + xr) / 2.0, cfg['beam_y'], (xr - xl) / 2.0 + cap, bw / 2.0, bw * cfg['rbr'])

    return buf, R


def downsample(buf, R, target):
    f = R // target
    out = bytearray(target * target * 4)
    n = f * f
    for y in range(target):
        for x in range(target):
            r_ = g_ = b_ = a_ = 0.0
            for dy in range(f):
                row = ((y * f + dy) * R + x * f) * 4
                for dx in range(f):
                    i = row + dx * 4
                    av = buf[i + 3]
                    a_ += av
                    r_ += buf[i] * av
                    g_ += buf[i + 1] * av
                    b_ += buf[i + 2] * av
            o = (y * target + x) * 4
            if a_ <= 0:
                out[o], out[o + 1], out[o + 2], out[o + 3] = 0, 0, 0, 0
                continue
            out[o] = int(round(r_ / a_))
            out[o + 1] = int(round(g_ / a_))
            out[o + 2] = int(round(b_ / a_))
            out[o + 3] = int(round(a_ / n))
    return bytes(out)


def png(w, h, rgba):
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', binascii.crc32(t + d) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


if __name__ == '__main__':
    imgs = {}

    buf, R = render(BIG)
    for sz in (512, 256, 128, 64):
        imgs[sz] = png(sz, sz, downsample(buf, R, sz))
        print('big  ->', sz, flush=True)

    buf2, R2 = render(SMALL)
    for sz in (48, 32, 16):
        imgs[sz] = png(sz, sz, downsample(buf2, R2, sz))
        print('small->', sz, flush=True)

    order = [256, 128, 64, 48, 32, 16]
    head = struct.pack('<HHH', 0, 1, len(order))
    offset = 6 + 16 * len(order)
    entries = b''
    blobs = b''
    for sz in order:
        d = imgs[sz]
        entries += struct.pack('<BBBBHHII', 0 if sz >= 256 else sz, 0 if sz >= 256 else sz,
                               0, 0, 1, 32, len(d), offset)
        blobs += d
        offset += len(d)

    ico = head + entries + blobs
    open('build/icon.ico', 'wb').write(ico)
    open('src/icon.ico', 'wb').write(ico)
    open('build/icon.png', 'wb').write(imgs[256])
    for sz, d in imgs.items():
        open('build/icon-%d.png' % sz, 'wb').write(d)
    print('icon.ico', len(ico), 'bytes')
