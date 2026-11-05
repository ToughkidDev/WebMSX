# Adds files and folders to the FAT16 partition of a Nextor SD card image (made by mknextorsd.py), as 8.3 names in upper case
# Usage: addfiles.py <sd.img> <file or folder>[=<target folder>] ...
#   addfiles.py ocmsd.img OCM-BIOS.DAT os/NEXTOR.SYS utils=UTILS help=HELP
# A folder argument copies its files into the target folder (created if needed), or into the root if no target is given
import os, struct, sys, time


class Fat16:
    def __init__(self, sd):
        self.sd = sd
        self.ps = struct.unpack_from('<I', sd, 0x1be + 8)[0] * 512
        b = self.ps
        self.spc = sd[b + 13]
        res = struct.unpack_from('<H', sd, b + 14)[0]
        self.fats = sd[b + 16]
        self.rootEntries = struct.unpack_from('<H', sd, b + 17)[0]
        self.spf = struct.unpack_from('<H', sd, b + 22)[0]
        total = struct.unpack_from('<H', sd, b + 19)[0] or struct.unpack_from('<I', sd, b + 32)[0]
        self.fatStart = b + res * 512
        self.rootStart = self.fatStart + self.fats * self.spf * 512
        self.dataStart = self.rootStart + self.rootEntries * 32
        self.clusterSize = self.spc * 512
        self.maxCluster = (total - (self.dataStart - b) // 512) // self.spc + 1
        self.nextFree = 2

    def get(self, n):
        return struct.unpack_from('<H', self.sd, self.fatStart + n * 2)[0]

    def set(self, n, v):
        for f in range(self.fats): struct.pack_into('<H', self.sd, self.fatStart + f * self.spf * 512 + n * 2, v)

    def alloc(self, count):
        clusters = []
        n = self.nextFree
        while len(clusters) < count:
            assert n <= self.maxCluster, "SD partition full"
            if self.get(n) == 0: clusters.append(n)
            n += 1
        self.nextFree = n
        for i, c in enumerate(clusters): self.set(c, clusters[i + 1] if i + 1 < len(clusters) else 0xffff)
        return clusters

    def offset(self, c):
        return self.dataStart + (c - 2) * self.clusterSize

    def chain(self, first):
        res = []
        while 2 <= first < 0xfff8:
            res.append(first)
            first = self.get(first)
        return res

    # Directory entries slots: (offset) list. dirCluster 0 = root
    def slots(self, dirCluster):
        if dirCluster == 0: return [self.rootStart + i * 32 for i in range(self.rootEntries)]
        return [self.offset(c) + i * 32 for c in self.chain(dirCluster) for i in range(self.clusterSize // 32)]

    def find(self, dirCluster, name11):
        for e in self.slots(dirCluster):
            if self.sd[e] == 0: return None
            if self.sd[e:e + 11] == name11: return e
        return None

    def newEntry(self, dirCluster, entry):
        for e in self.slots(dirCluster):
            if self.sd[e] in (0x00, 0xe5):
                self.sd[e:e + 32] = entry
                return
        assert dirCluster != 0, "Root directory full"
        last = self.chain(dirCluster)[-1]
        c = self.alloc(1)[0]
        self.set(last, c)
        off = self.offset(c)
        self.sd[off:off + self.clusterSize] = bytes(self.clusterSize)
        self.sd[off:off + 32] = entry


def name83(name):
    base, _, ext = name.upper().rpartition('.') if '.' in name else (name.upper(), '', '')
    return (base[:8].ljust(8) + ext[:3].ljust(3)).encode('ascii')


def entry(name11, attr, cluster, size, mtime):
    t = time.localtime(mtime)
    e = bytearray(32)
    e[0:11] = name11
    e[11] = attr
    struct.pack_into('<HH', e, 22, (t.tm_hour << 11) | (t.tm_min << 5) | (t.tm_sec // 2), ((max(t.tm_year, 1980) - 1980) << 9) | (t.tm_mon << 5) | t.tm_mday)
    struct.pack_into('<HI', e, 26, cluster, size)
    return e


def makeDir(fat, parent, name, mtime):
    name11 = name83(name)
    e = fat.find(parent, name11)
    if e is not None: return struct.unpack_from('<H', fat.sd, e + 26)[0]
    c = fat.alloc(1)[0]
    off = fat.offset(c)
    fat.sd[off:off + fat.clusterSize] = bytes(fat.clusterSize)
    fat.sd[off:off + 32] = entry(b'.          ', 0x10, c, 0, mtime)
    fat.sd[off + 32:off + 64] = entry(b'..         ', 0x10, parent, 0, mtime)
    fat.newEntry(parent, entry(name11, 0x10, c, 0, mtime))
    return c


def addFile(fat, dirCluster, path):
    content = open(path, 'rb').read()
    name11 = name83(os.path.basename(path))
    assert fat.find(dirCluster, name11) is None, "File exists: " + os.path.basename(path)
    first = 0
    if content:
        clusters = fat.alloc((len(content) + fat.clusterSize - 1) // fat.clusterSize)
        first = clusters[0]
        for i, c in enumerate(clusters):
            chunk = content[i * fat.clusterSize:(i + 1) * fat.clusterSize]
            off = fat.offset(c)
            fat.sd[off:off + len(chunk)] = chunk
    fat.newEntry(dirCluster, entry(name11, 0x20, first, len(content), os.path.getmtime(path)))


def main():
    img = sys.argv[1]
    sd = bytearray(open(img, 'rb').read())
    fat = Fat16(sd)
    count = 0
    for arg in sys.argv[2:]:
        src, _, target = arg.partition('=')
        dirCluster = makeDir(fat, 0, target, os.path.getmtime(src)) if target else 0
        files = sorted(os.path.join(src, f) for f in os.listdir(src)) if os.path.isdir(src) else [src]
        for f in files:
            if os.path.isfile(f) and not os.path.basename(f).startswith('__'):
                addFile(fat, dirCluster, f)
                count += 1
    open(img, 'wb').write(sd)
    print('added', count, 'files to', img)


main()
