# -*- coding: utf-8 -*-
"""检查 exe 里是否真的嵌入了新图标（按 PNG 字节特征搜索）。"""

import struct
import sys


def ico_pngs(path):
    data = open(path, 'rb').read()
    _, _, n = struct.unpack('<HHH', data[:6])
    out = []
    for i in range(n):
        off = 6 + 16 * i
        w = data[off] or 256
        size, addr = struct.unpack('<II', data[off + 8:off + 16])
        blob = data[addr:addr + size]
        out.append((w, blob))
    return out


def main(ico, exes):
    print('ico:', ico)
    for exe in exes:
        raw = open(exe, 'rb').read()
        print('\n==', exe, len(raw), 'bytes')
        for size, blob in ico_pngs(ico):
            # 取 PNG 中段作为特征，避开可能的头部重写
            needle = blob[40:120]
            print('  %4dpx  %6d bytes  %s' % (size, len(blob), 'FOUND' if needle in raw else 'missing'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
