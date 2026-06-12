#!/usr/bin/env python3
import math
import re
from typing import Dict, List

# -----------------------------
# Editable hardcoded settings
# -----------------------------
CANVAS_WIDTH = 93
CANVAS_HEIGHT = 20

BEACH_CHAR = "░"
SEA_CHAR = "~"
COAST_CHAR = "|"

COAST_BASE = None          # None means auto: max(1.0, CANVAS_WIDTH * 0.3)
COAST_SLOPE = 1.0
COAST_AMPLITUDE = 1.2
COAST_WAVELENGTH = 6.0
COAST_PHASE = 0.0

TEXT = "alimbo"           # ASCII letters only
TEXT_X = 31
TEXT_Y = 6
FONT_SIZE = 1              # >= 1
LETTER_SPACING = 1         # >= 0

FONT_5X7: Dict[str, List[str]] = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}


def ensure_single_char(value: str, name: str) -> str:
    if len(value) != 1:
        raise ValueError(f"{name} must be exactly one character")
    return value


def build_background(
    width: int,
    height: int,
    beach_char: str,
    sea_char: str,
    coast_char: str,
    coast_base: float,
    coast_slope: float,
    coast_amplitude: float,
    coast_wavelength: float,
    coast_phase: float,
) -> List[List[str]]:
    grid: List[List[str]] = [[sea_char for _ in range(width)] for _ in range(height)]

    for y in range(height):
        wave = coast_amplitude * math.sin((2.0 * math.pi * y / coast_wavelength) + coast_phase)
        coast_x = int(round(coast_base + (coast_slope * y) + wave))
        coast_x = max(0, min(width - 1, coast_x))

        for x in range(coast_x):
            grid[y][x] = beach_char
        grid[y][coast_x] = coast_char

    return grid


def carve_text_with_spaces(
    grid: List[List[str]],
    text: str,
    origin_x: int,
    origin_y: int,
    font_size: int,
    letter_spacing: int,
) -> None:
    height = len(grid)
    width = len(grid[0]) if height > 0 else 0

    cursor_x = origin_x
    glyph_w = 5
    glyph_h = 7

    for raw_ch in text:
        ch = raw_ch.upper()
        glyph = FONT_5X7[ch]

        for gy in range(glyph_h):
            for gx in range(glyph_w):
                if glyph[gy][gx] != "1":
                    continue
                for sy in range(font_size):
                    for sx in range(font_size):
                        px = cursor_x + (gx * font_size) + sx
                        py = origin_y + (gy * font_size) + sy
                        if 0 <= px < width and 0 <= py < height:
                            grid[py][px] = " "

        cursor_x += (glyph_w + letter_spacing) * font_size


def validate_settings() -> None:
    if CANVAS_WIDTH <= 0 or CANVAS_HEIGHT <= 0:
        raise ValueError("width and height must be positive")
    if FONT_SIZE <= 0:
        raise ValueError("font-size must be >= 1")
    if LETTER_SPACING < 0:
        raise ValueError("letter-spacing must be >= 0")
    if COAST_WAVELENGTH == 0:
        raise ValueError("coast-wavelength must not be 0")

    ensure_single_char(BEACH_CHAR, "beach-char")
    ensure_single_char(SEA_CHAR, "sea-char")
    ensure_single_char(COAST_CHAR, "coast-char")

    if not re.fullmatch(r"[A-Za-z]+", TEXT or ""):
        raise ValueError("text must contain only ASCII letters A-Z/a-z")


def main() -> None:
    validate_settings()

    coast_base = COAST_BASE
    if coast_base is None:
        coast_base = max(1.0, (CANVAS_WIDTH * 0.3))

    grid = build_background(
        width=CANVAS_WIDTH,
        height=CANVAS_HEIGHT,
        beach_char=BEACH_CHAR,
        sea_char=SEA_CHAR,
        coast_char=COAST_CHAR,
        coast_base=coast_base,
        coast_slope=COAST_SLOPE,
        coast_amplitude=COAST_AMPLITUDE,
        coast_wavelength=COAST_WAVELENGTH,
        coast_phase=COAST_PHASE,
    )

    carve_text_with_spaces(
        grid=grid,
        text=TEXT,
        origin_x=TEXT_X,
        origin_y=TEXT_Y,
        font_size=FONT_SIZE,
        letter_spacing=LETTER_SPACING,
    )

    for row in grid:
        print("".join(row))


if __name__ == "__main__":
    main()
