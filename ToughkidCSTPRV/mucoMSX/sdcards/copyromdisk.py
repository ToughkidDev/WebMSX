# Copies the MegaFlashROM SCC+ SD ROM disk (FAT12, in the flash) to the FAT16 partition of a Nextor SD card image,
# keeping names, attributes and dates. Also adds an empty NEXTOR.DAT to the root directory, so that Nextor maps
# the SD card to drive A: at boot.
# Usage: copyromdisk.py <mfrsd.rom or mfrsd.rom.gz> <sd.img>
import gzip, struct, sys, time

ROM_DISK_OFFSET = 0x720000          # ROM disk position in the flash


def bpb(data, base):
    return {
        'spc': data[base + 13],
        'res': struct.unpack_from('<H', data, base + 14)[0],
        'fats': data[base + 16],
        'root': struct.unpack_from('<H', data, base + 17)[0],
        'spf': struct.unpack_from('<H', data, base + 22)[0],
    }


class Fat:
    def __init__(self, data, base, fat16):
        self.data, self.base, self.fat16 = data, base, fat16
        b = bpb(data, base)
        self.spc, self.fats, self.spf, self.rootEntries = b['spc'], b['fats'], b['spf'], b['root']
        self.fatStart = base + b['res'] * 512
        self.rootStart = self.fatStart + self.fats * self.spf * 512
        self.dataStart = self.rootStart + self.rootEntries * 32
        self.clusterSize = self.spc * 512

    def get(self, n):
        if self.fat16: return struct.unpack_from('<H', self.data, self.fatStart + n * 2)[0]
        v = struct.unpack_from('<H', self.data, self.fatStart + n * 3 // 2)[0]
        return (v >> 4) if n & 1 else (v & 0xfff)

    def set(self, n, value):            # FAT16 only
        for f in range(self.fats):
            struct.pack_into('<H', self.data, self.fatStart + f * self.spf * 512 + n * 2, value)

    def chain(self, first):
        end = 0xfff8 if self.fat16 else 0xff8
        res = []
        n = first
        while 2 <= n < end:
            res.append(n)
            n = self.get(n)
        return res

    def clusterOffset(self, n):
        return self.dataStart + (n - 2) * self.clusterSize

    def readChain(self, first):
        return b''.join(bytes(self.data[self.clusterOffset(c):self.clusterOffset(c) + self.clusterSize]) for c in self.chain(first))

    def entries(self, raw):
        res = []
        for i in range(0, len(raw), 32):
            e = raw[i:i + 32]
            if e[0] == 0: break
            if e[0] == 0xe5 or e[11] == 0x0f: continue          # deleted or long name
            res.append(bytearray(e))
        return res


def main():
    romPath, sdPath = sys.argv[1], sys.argv[2]
    rom = (gzip.open(romPath) if romPath.endswith('.gz') else open(romPath, 'rb')).read()
    src = Fat(bytearray(rom[ROM_DISK_OFFSET:ROM_DISK_OFFSET + 1440 * 512]), 0, False)

    sd = bytearray(open(sdPath, 'rb').read())
    partStart = struct.unpack_from('<I', sd, 0x1be + 8)[0] * 512
    dst = Fat(sd, partStart, True)
    totalClusters = (struct.unpack_from('<I', sd, partStart + 0x20)[0] - (dst.dataStart - partStart) // 512) // dst.spc

    nextFree = [2]
    while dst.get(nextFree[0]) != 0: nextFree[0] += 1

    def alloc(count):
        first = nextFree[0]
        assert first + count - 1 < totalClusters + 2, "SD partition full"
        for i in range(count):
            dst.set(first + i, first + i + 1 if i < count - 1 else 0xffff)
        nextFree[0] += count
        return first

    def writeData(first, payload):
        for i, c in enumerate(range(first, first + (len(payload) + dst.clusterSize - 1) // dst.clusterSize)):
            chunk = payload[i * dst.clusterSize:(i + 1) * dst.clusterSize]
            off = dst.clusterOffset(c)
            sd[off:off + len(chunk)] = chunk

    files = [0]

    def copyEntries(srcEntries, myCluster, parentCluster):
        out = []
        for e in srcEntries:
            name = bytes(e[0:11])
            first = struct.unpack_from('<H', e, 26)[0]
            if name == b'.          ':
                struct.pack_into('<H', e, 26, myCluster); out.append(e); continue
            if name == b'..         ':
                struct.pack_into('<H', e, 26, parentCluster); out.append(e); continue
            if e[11] & 0x08:                                    # volume label
                out.append(e); continue
            if e[11] & 0x10:                                    # subdirectory
                children = src.entries(src.readChain(first))
                count = max(1, (len(children) * 32 + dst.clusterSize - 1) // dst.clusterSize)
                newFirst = alloc(count)
                childOut = copyEntries(children, newFirst, myCluster)
                writeData(newFirst, b''.join(childOut))
                struct.pack_into('<H', e, 26, newFirst)
            else:
                size = struct.unpack_from('<I', e, 28)[0]
                if size == 0:
                    struct.pack_into('<H', e, 26, 0)
                else:
                    payload = src.readChain(first)[:size]
                    newFirst = alloc((size + dst.clusterSize - 1) // dst.clusterSize)
                    writeData(newFirst, payload)
                    struct.pack_into('<H', e, 26, newFirst)
                files[0] += 1
            out.append(e)
        return out

    rootSrc = src.entries(bytes(src.data[src.rootStart:src.rootStart + src.rootEntries * 32]))
    rootOut = copyEntries(rootSrc, 0, 0)

    # NEXTOR.DAT: makes Nextor map this device to the first drive at boot
    if not any(bytes(e[0:11]) == b'NEXTOR  DAT' for e in rootOut):
        t = time.localtime()
        dat = bytearray(32)
        dat[0:11] = b'NEXTOR  DAT'
        dat[11] = 0x20
        struct.pack_into('<HH', dat, 22, (t.tm_hour << 11) | (t.tm_min << 5) | (t.tm_sec // 2), ((t.tm_year - 1980) << 9) | (t.tm_mon << 5) | t.tm_mday)
        rootOut.append(dat)

    assert len(rootOut) <= dst.rootEntries
    root = b''.join(rootOut)
    sd[dst.rootStart:dst.rootStart + len(root)] = root

    open(sdPath, 'wb').write(sd)
    print('copied', files[0], 'files,', len(rootOut), 'root entries, clusters used', nextFree[0] - 2)


main()
