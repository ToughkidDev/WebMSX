# Creates a Nextor FDISK style SD card image: MBR + one FAT16 partition using the whole device (gzip compressed)
# Mirrors Nextor 2.1 FDISK (v2.1.0, source/kernel/bank5/fdisk.c + fdisk2.c), as in the MegaFlashROM SCC+ SD firmware kernel:
# AddAutoPartition, CreatePartition, CreateFatFileSystem, CreateFatBootSector. Partition type 6 (FAT16), no active flag
import gzip, os, struct, sys

def make(path, device_sectors, serial):
    # Auto partition: all space available minus the extra MBR sector
    size_k = (device_sectors - 1) // 2
    assert size_k > 32768                       # FAT16
    part_type = 0x06                            # PARTYPE_FAT16 (Nextor 2.1 kernels do not accept 0x0E)
    first_abs = 1
    part_sectors = size_k * 2

    # CalculateFatFileSystemParametersFat16
    size_m = size_k >> 10
    for limit, power in ((128, 2), (256, 3), (512, 4), (1024, 5), (2048, 6)):
        if size_m <= limit: break
    else: power = 7
    spc = 1 << power
    data = size_k * 2 - 512 // 16 - 1
    clusters = data >> power
    spf = (clusters + 2) >> 8
    if (clusters + 2) & 0xff: spf += 1
    clusters = (data - 2 * spf) >> power
    data = clusters << power
    if clusters > 65524:
        diff = clusters - 65524; clusters = 65524; spf = 256; data -= diff << power
    total = data + 1 + spf * 2 + 32

    mbr = bytearray(512)
    mbr[0:3] = b'\xEB\xFE\x90'
    mbr[3:11] = b'NEXTOR20'
    mbr[0x1BE:0x1CE] = struct.pack('<B3sB3sII', 0x00, b'\0\0\0', part_type, b'\0\0\0', first_abs, part_sectors)
    mbr[510:512] = b'\x55\xAA'

    boot = bytearray(512)
    boot[0:3] = b'\xEB\xFE\x90'
    boot[3:11] = b'NEXTOR20'
    struct.pack_into('<HBHBHHBHHH', boot, 11, 512, spc, 1, 2, 512, total if total < 0x10000 else 0, 0xF0, spf, 0, 0)
    struct.pack_into('<IIBBBI', boot, 0x1C, 0, total, 0, 0, 0x29, serial)
    boot[0x2B:0x36] = b'NEXTOR 2.0 '
    boot[0x36:0x3E] = b'FAT16   '
    boot[510:512] = b'\x55\xAA'

    fat0 = bytearray(512); fat0[0:4] = b'\xF0\xFF\xFF\xFF'

    sectors = {0: mbr, first_abs: boot, first_abs + 1: fat0, first_abs + 1 + spf: fat0}
    zero = bytes(512 * 2048)
    with gzip.open(path, 'wb', compresslevel=9) as f:
        s = 0
        while s < device_sectors:
            if s in sectors:
                f.write(sectors[s]); s += 1; continue
            nxt = min([k for k in sectors if k > s] + [device_sectors])
            n = min(nxt - s, 2048)
            f.write(zero[:n * 512]); s += n
    print(path, 'sectors', device_sectors, 'part', first_abs, part_sectors, 'spc', spc, 'spf', spf, 'clusters', clusters, 'fsTotal', total, 'bytes', os.path.getsize(path))

DEVICE = 1024 * 1024 * 1024 // 512              # 1 GiB
make(sys.argv[1], DEVICE, 0x1A2B3C4D)
make(sys.argv[2], DEVICE, 0x5E6F7A8B)
