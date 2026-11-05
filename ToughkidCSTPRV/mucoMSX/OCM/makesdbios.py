# Splits an OCM-BIOS.DAT (OCM-SDBIOS, MSX-BIOS Configuration for OCM-PLD v3.4 or later) into the ROMs used by the WebMSX MSX++ (OCM-PLD) machine
# Usage: makesdbios.py <OCM-BIOS.DAT> <output folder>
# Blocks of 16KB, as loaded by the OCM-PLD IPL-ROM (OCM-SDBIOS Reference Tables by KdL):
#   01-08  3-2 (4000h) 128KB  MEGASDHC.ROM + NULL64KB.ROM / NEXTOR.ROM      -> MEGASD.ROM
#   09-10  0-0 (0000h)  32KB  MSX2P.ROM / MSXTR.ROM                         -> MSX2P.ROM
#   11     3-3 (4000h)  16KB  XBASIC2.ROM / XBASIC21.ROM                    -> XBASIC.ROM
#   12     0-2 (4000h)  16KB  MSX2PMUS.ROM / MSXTRMUS.ROM                   -> MSX2PMUS.ROM
#   13     3-1 (0000h)  16KB  MSX2PEXT.ROM / MSXTREXT.ROM                   -> MSX2PEXT.ROM
#   14-15  3-1 (4000h)  32KB  MSXKANJI.ROM / KNCUSTOM.ROM                   -> MSXKANJI.ROM
#   16     0-3 (4000h)  16KB  FREE16KB.ROM / MSXPPOPT.ROM / MSXTROPT.ROM    -> OPT.ROM
#   17-32  I/O         256KB  JIS1.ROM + JIS2.ROM                           -> not used, same as the WebMSX built-in Kanji font
import os, sys

BLOCKS = [
    ("MEGASD.ROM",    1,  8),
    ("MSX2P.ROM",     9, 10),
    ("XBASIC.ROM",   11, 11),
    ("MSX2PMUS.ROM", 12, 12),
    ("MSX2PEXT.ROM", 13, 13),
    ("MSXKANJI.ROM", 14, 15),
    ("OPT.ROM",      16, 16),
]

src, out = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
assert len(data) in (384 * 1024, 512 * 1024), "OCM-BIOS.DAT must be 384KB or 512KB"
assert data[8 * 16384:8 * 16384 + 2] == b'\xf3\xc3', "Main BIOS not found at block 09 (not an OCM-PLD v3.4 or later MSX-BIOS Configuration)"
os.makedirs(out, exist_ok=True)
for name, first, last in BLOCKS:
    part = data[(first - 1) * 16384:last * 16384]
    if not part: continue
    open(os.path.join(out, name), 'wb').write(part)
    print(name, len(part))
