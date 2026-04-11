#!/usr/bin/env python3
"""Full-screen animated noise splash with floating highlight blobs.

The terminal fills with random characters in dim gray. Several invisible
"light" blobs drift around, pulsing in size. Characters near a blob are
bright and shuffle rapidly (morphing); characters far away are dim and
nearly static. Press any key to dismiss.
"""

import os
import sys
import math
import random
import select
import termios
import tty
import fcntl
import struct
import signal

CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+=-~.:;|/\\<>'

# 256-color grayscale stops
C_DIM = 236
C_LO  = 240
C_MID = 245
C_HI  = 250
C_MAX = 255

_resize = False


def _on_winch(*_):
    global _resize
    _resize = True


def term_size():
    try:
        p = fcntl.ioctl(sys.stdout.fileno(), termios.TIOCGWINSZ, b'\0' * 8)
        rows, cols = struct.unpack('HH', p[:4])
        return cols, rows
    except Exception:
        return 80, 24


class Blob:
    """Floating highlight source with pulsing radius."""

    __slots__ = ('x', 'y', 'base_r', 'r', 'vx', 'vy',
                 'phase', 'pspeed', 'pamp')

    def __init__(self, w, h):
        self.x = random.uniform(0, w)
        self.y = random.uniform(0, h)
        self.base_r = random.uniform(8, 18)
        self.r = self.base_r
        self.vx = random.uniform(-0.7, 0.7) or 0.3
        self.vy = random.uniform(-0.35, 0.35) or 0.15
        self.phase = random.uniform(0, math.tau)
        self.pspeed = random.uniform(0.04, 0.09)
        self.pamp = random.uniform(0.2, 0.35)

    def tick(self, w, h):
        self.x += self.vx
        self.y += self.vy

        if self.x <= 0 or self.x >= w - 1:
            self.vx = -self.vx
            self.x = max(0.0, min(float(w - 1), self.x))
        if self.y <= 0 or self.y >= h - 1:
            self.vy = -self.vy
            self.y = max(0.0, min(float(h - 1), self.y))

        # Organic drift
        if random.random() < 0.025:
            self.vx += random.uniform(-0.15, 0.15)
            self.vy += random.uniform(-0.08, 0.08)
            spd = math.hypot(self.vx, self.vy)
            if spd > 1.2:
                self.vx *= 1.2 / spd
                self.vy *= 1.2 / spd
            if spd < 0.12:
                self.vx *= 2
                self.vy *= 2

        self.phase += self.pspeed
        self.r = self.base_r * (1.0 + self.pamp * math.sin(self.phase))


class Splash:
    def __init__(self):
        self._init_grid()
        self.frame = 0

    def _init_grid(self):
        self.cols, self.rows = term_size()
        self.gh = max(1, self.rows - 2)
        self.gw = self.cols
        ch = CHARS
        self.grid = [[random.choice(ch) for _ in range(self.gw)]
                      for _ in range(self.gh)]
        n = max(3, min(7, (self.gw * self.gh) // 1500))
        self.blobs = [Blob(self.gw, self.gh) for _ in range(n)]
        self._clear = True

    def handle_resize(self):
        self._init_grid()

    def tick(self):
        self.frame += 1
        for b in self.blobs:
            b.tick(self.gw, self.gh)

    def render(self):
        out = self._clear
        if out:
            self._clear = False

        gh, gw = self.gh, self.gw
        grid = self.grid

        # ---- brightness map (sparse, blob-local) ----
        bright = [[0.0] * gw for _ in range(gh)]

        for blob in self.blobs:
            bx, by, br = blob.x, blob.y, blob.r
            r2 = br * br
            ri = int(br) + 2
            y0 = max(0, int(by) - ri)
            y1 = min(gh, int(by) + ri + 1)
            x0 = max(0, int(bx - br) - 2)
            x1 = min(gw, int(bx + br) + 2)

            for r in range(y0, y1):
                dy = (r - by) * 2.0   # aspect-ratio correction
                dy2 = dy * dy
                if dy2 >= r2:
                    continue
                brow = bright[r]
                for c in range(x0, x1):
                    dx = c - bx
                    d2 = dx * dx + dy2
                    if d2 < r2:
                        b = 1.0 - d2 / r2
                        if b > brow[c]:
                            brow[c] = b

        # Fade-in over first ~15 frames
        cap = min(1.0, self.frame / 15.0)

        # ---- combined shuffle + render pass ----
        choice = random.choice
        rand = random.random
        chars = CHARS

        buf_parts = ['\033[2J' if out else '', '\033[H']

        for r in range(gh):
            brow = bright[r]
            grow = grid[r]
            parts = [f'\033[{r + 1};1H']
            prev = -1

            for c in range(gw):
                b = brow[c]

                # Morph: shuffle chars based on brightness
                if b > 0.5:
                    if rand() < 0.35:
                        grow[c] = choice(chars)
                elif b > 0.2:
                    if rand() < 0.06:
                        grow[c] = choice(chars)
                elif rand() < 0.008:
                    grow[c] = choice(chars)

                # Color from capped brightness
                bc = min(b, cap)
                if bc > 0.7:
                    g = C_MAX
                elif bc > 0.45:
                    g = C_HI
                elif bc > 0.25:
                    g = C_MID
                elif bc > 0.1:
                    g = C_LO
                else:
                    g = C_DIM

                if g != prev:
                    parts.append(f'\033[38;5;{g}m')
                    prev = g
                parts.append(grow[c])

            buf_parts.append(''.join(parts))

        # Hint
        msg = 'press any key'
        mx = max(1, (self.cols - len(msg)) // 2)
        buf_parts.append(f'\033[{self.rows};{mx}H\033[38;5;238m{msg}\033[0m')

        sys.stdout.write(''.join(buf_parts))
        sys.stdout.flush()


def main():
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return

    cols, rows = term_size()
    if cols < 20 or rows < 8:
        return

    splash = Splash()

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)

    def cleanup():
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stdout.write('\033[?25h\033[?1049l')
        sys.stdout.flush()

    sys.stdout.write('\033[?1049h\033[?25l\033[2J')
    sys.stdout.flush()

    signal.signal(signal.SIGWINCH, _on_winch)

    try:
        tty.setcbreak(fd)
        global _resize

        while True:
            if _resize:
                _resize = False
                splash.handle_resize()

            splash.render()
            splash.tick()

            if select.select([sys.stdin], [], [], 0.055)[0]:
                data = os.read(fd, 4096)
                # Only dismiss on real keypresses, not escape sequences
                # (mouse scroll/click/movement, arrow keys, etc.)
                if data and data[0:1] != b'\x1b':
                    return

    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        cleanup()


if __name__ == '__main__':
    main()
