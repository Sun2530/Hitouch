# -*- coding: utf-8 -*-
"""把各尺寸图标按整数倍放大后拼成一张对比图（白底 / 深底两行）。"""

import zlib, struct, binascii


def read_png(path):
    data = open(path, 'rb').read()
    pos = 8
    w = h = 0
    idat = b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h = struct.unpack('>II', body[:8])
        elif typ == b'IDAT':
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4
    out = bytearray(w * h * 4)
    for y in range(h):
        line = raw[y * (stride + 1):(y + 1) * (stride + 1)]
        assert line[0] == 0
        out[y * stride:(y + 1) * stride] = line[1:]
    return w, h, bytes(out)


def write_png(path, w, h, rgba):
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', binascii.crc32(t + d) & 0xffffffff)

    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b''))


SIZES = [(16, 6), (32, 3), (48, 2), (64, 1), (128, 1)]  # (原尺寸, 放大倍数)
CELL = 96
PAD = 14
ROWS = [(250, 250, 251), (32, 32, 36)]

W = (CELL + PAD) * len(SIZES) + PAD
H = (CELL + PAD) * len(ROWS) + PAD
canvas = bytearray(W * H * 4)
for i in range(W * H):
    canvas[i * 4:i * 4 + 4] = bytes(ROWS[0]) + b'\xff'

# 第二行深底
y0 = PAD + CELL + PAD
for y in range(y0, y0 + CELL):
    for x in range(PAD, W - PAD):
        i = (y * W + x) * 4
        canvas[i:i + 4] = bytes(ROWS[1]) + b'\xff'

for si, (size, scale) in enumerate(SIZES):
    sw, sh, src = read_png('build/icon-%d.png' % size)
    dw = size * scale
    ox = PAD + si * (CELL + PAD) + (CELL - dw) // 2
    for row in range(len(ROWS)):
        oy = PAD + row * (CELL + PAD) + (CELL - dw) // 2
        for y in range(dw):
            sy = y * sh // dw
            for x in range(dw):
                sx = x * sw // dw
                sidx = (sy * sw + sx) * 4
                a = src[sidx + 3] / 255.0
                if a <= 0:
                    continue
                di = ((oy + y) * W + (ox + x)) * 4
                for k in range(3):
                    canvas[di + k] = int(round(src[sidx + k] * a + canvas[di + k] * (1 - a)))
                canvas[di + 3] = 255

write_png('build/preview-sizes.png', W, H, bytes(canvas))
print('preview-sizes.png', W, 'x', H)
