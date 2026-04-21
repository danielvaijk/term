#!/usr/bin/env python3
"""Full-screen animated noise splash driven by pre-extracted video frames.

The terminal fills with random characters in dim gray. Each animation
frame supplies a brightness map (from frames.gz) that determines which
characters are bright and morph rapidly. The video loops until a key
is pressed.
"""

import os
import sys
import gzip
import json
import random
import select
import termios
import tty
import fcntl
import struct
import signal

CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+=-~.:;|/\\<>'

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


def load_frames(path):
    """Load compressed frame data. Returns (header_dict, list_of_frames).

    Each frame is a flat bytes object of length cols*rows (0-255 grayscale).
    """
    with gzip.open(path, 'rb') as f:
        header = json.loads(f.readline())
        raw = f.read()

    cols = header['cols']
    rows = header['rows']
    n = header['n_frames']
    size = cols * rows

    frames = [raw[i * size:(i + 1) * size] for i in range(n)]
    return header, frames


class Splash:
    def __init__(self, header, frames):
        self.src_frames = frames
        self.src_cols = header['cols']
        self.src_rows = header['rows']
        self.src_fps = header.get('fps', 18)
        self.n_frames = len(frames)
        self._init_grid()
        self.frame_idx = 0
        self.tick_count = 0

    def _init_grid(self):
        self.cols, self.rows = term_size()
        self.gh = max(1, self.rows - 2)
        self.gw = self.cols
        self.grid = [[random.choice(CHARS) for _ in range(self.gw)]
                      for _ in range(self.gh)]
        self._clear = True

    def handle_resize(self):
        self._init_grid()

    def tick(self):
        self.tick_count += 1
        self.frame_idx = self.tick_count % self.n_frames

    def _build_brightness(self):
        """Map current video frame onto the terminal grid as brightness."""
        gh, gw = self.gh, self.gw
        bright = [[0.0] * gw for _ in range(gh)]

        src = self.src_frames[self.frame_idx]
        sw, sh = self.src_cols, self.src_rows

        # Map terminal (r, c) -> source pixel with nearest-neighbour scaling
        for r in range(gh):
            sy = r * sh // gh
            row_off = sy * sw
            brow = bright[r]
            for c in range(gw):
                sx = c * sw // gw
                px = src[row_off + sx]    # 0-255
                brow[c] = px / 255.0

        return bright

    def render(self):
        do_clear = self._clear
        if do_clear:
            self._clear = False

        gh, gw = self.gh, self.gw
        grid = self.grid
        bright = self._build_brightness()

        # Fade-in over first ~15 ticks
        cap = min(1.0, self.tick_count / 15.0)

        choice = random.choice
        rand = random.random
        chars = CHARS

        buf = ['\033[2J' if do_clear else '', '\033[H']

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

            buf.append(''.join(parts))

        msg = 'press any key'
        mx = max(1, (self.cols - len(msg)) // 2)
        buf.append(f'\033[{self.rows};{mx}H\033[38;5;238m{msg}\033[0m')

        sys.stdout.write(''.join(buf))
        sys.stdout.flush()


def main():
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        return

    cols, rows = term_size()
    if cols < 20 or rows < 8:
        return

    # Load frame data from the repo's data/ directory
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frames_path = os.path.join(repo_root, 'data', 'frames.gz')
    if not os.path.exists(frames_path):
        return

    header, frames = load_frames(frames_path)
    if not frames:
        return

    splash = Splash(header, frames)

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)

    def cleanup():
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stdout.write('\033[?25h\033[?1049l')
        sys.stdout.flush()

    sys.stdout.write('\033[?1049h\033[?25l\033[2J')
    sys.stdout.flush()

    signal.signal(signal.SIGWINCH, _on_winch)

    # Frame timing from source fps
    frame_time = 1.0 / header.get('fps', 18)

    try:
        tty.setcbreak(fd)
        global _resize

        while True:
            if _resize:
                _resize = False
                splash.handle_resize()

            splash.render()
            splash.tick()

            if select.select([sys.stdin], [], [], frame_time)[0]:
                data = os.read(fd, 4096)
                if data and data[0:1] != b'\x1b':
                    return

    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        cleanup()


if __name__ == '__main__':
    main()
