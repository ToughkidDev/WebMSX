// Sparse Disk Image. Keeps only the non-zero 512 bytes sectors in memory, so very big mostly empty images can be used
// Loaded from an URL, raw or GZIP compressed. GZIP images are decompressed as a stream (DecompressionStream)

wmsx.SparseDiskImage = function(name, totalSectors) {
"use strict";

    this.name = name;
    this.totalSectors = totalSectors;
    this.sectors = new Map();
    this.modified = false;

    this.readSector = function(sector, dest) {
        if (sector >= this.totalSectors) return false;
        var data = this.sectors.get(sector);
        if (data) dest.set(data);
        else dest.fill(0);
        return true;
    };

    this.writeSector = function(sector, src) {
        if (sector >= this.totalSectors) return false;
        if (wmsx.SparseDiskImage.isZero(src, 0)) this.sectors.delete(sector);
        else this.sectors.set(sector, new Uint8Array(src));
        this.modified = true;
        return true;
    };

};

// Loaded MegaFlashROM SCC+ SD card images
wmsx.SparseDiskImage.sdCards = [ null, null ];

wmsx.SparseDiskImage.isZero = function(bytes, start) {
    for (var i = start, end = start + 512; i < end; ++i) if (bytes[i] !== 0) return false;
    return true;
};

wmsx.SparseDiskImage.loadFromURL = function(url) {
    wmsx.Util.log("Reading Sparse Disk Image from: " + url);

    var name = wmsx.Util.leafFilename(url).replace(/\.gz$/i, "");
    var absURL = new URL(url, window.location.href).href;
    var startTime = Date.now();

    function makeImage(res) {
        var image = new wmsx.SparseDiskImage(name, res.totalSectors);
        for (var i = 0; i < res.entries.length; ++i) image.sectors.set(res.entries[i][0], res.entries[i][1]);
        wmsx.Util.log("Sparse Disk Image loaded: " + name + ", " + res.totalSectors + " sectors, " + image.sectors.size + " non-empty, " + (Date.now() - startTime) + "ms");
        return image;
    }

    function scanInMainThread() {
        return wmsx.SparseDiskImage.scan(absURL).catch(function(error) {
            if (error.message !== "NO_DECOMPRESSION_STREAM") throw error;
            // No stream decompression available: read whole content then decompress
            return fetch(absURL).then(function(response) {
                if (!response.ok) throw new Error("" + response.status + " " + response.statusText);
                return response.arrayBuffer();
            }).then(function(buffer) {
                var content = new Uint8Array(buffer);
                return wmsx.SparseDiskImage.scanContent(wmsx.Util.checkContentIsGZIP(content) || content);
            });
        });
    }

    // Decompress and scan in a Worker if possible, so several images load in parallel
    return new Promise(function(resolve, reject) {
        var worker;
        try {
            var code = "self.onmessage = function(e) { (" + wmsx.SparseDiskImage.scan.toString() + ")(e.data).then(" +
                "function(r) { self.postMessage(r, r.entries.map(function(x) { return x[1].buffer; })); }, " +
                "function(err) { self.postMessage({ error: String(err && err.message || err) }); }); };";
            worker = new Worker(URL.createObjectURL(new Blob([ code ], { type: "text/javascript" })));
        } catch (e) {
            worker = null;
        }
        if (!worker) return scanInMainThread().then(resolve, reject);

        worker.onmessage = function(e) {
            worker.terminate();
            if (e.data.error) scanInMainThread().then(resolve, reject);
            else resolve(e.data);
        };
        worker.onerror = function(e) {
            e.preventDefault();
            worker.terminate();
            scanInMainThread().then(resolve, reject);
        };
        worker.postMessage(absURL);
    }).then(makeImage);
};

// Self-contained (also runs in a Worker): fetches and decompresses (GZIP) an image as a stream,
// keeping only the non-zero sectors. Returns a Promise of { totalSectors, entries: [ [ sector, Uint8Array(512) ], ... ] }
wmsx.SparseDiskImage.scan = function(url) {
    var staging = new Uint8Array(1024 * 1024);
    var staging32 = new Uint32Array(staging.buffer);
    var stagingLen = 0;
    var entries = [];
    var sector = 0;

    function isZero32(start) {
        for (var i = start, end = start + 128; i < end; ++i) if (staging32[i] !== 0) return false;
        return true;
    }

    function flushStaging(final) {
        if (final) {
            // Pad the last partial sector with zeros
            var padded = (stagingLen + 511) & ~511;
            staging.fill(0, stagingLen, padded);
            stagingLen = padded;
        }
        var full = stagingLen & ~511;
        for (var pos = 0; pos < full; pos += 512, ++sector)
            if (!isZero32(pos >> 2)) entries.push([ sector, staging.slice(pos, pos + 512) ]);
        var rest = stagingLen - full;
        if (rest > 0) staging.copyWithin(0, full, stagingLen);
        stagingLen = rest;
    }

    function consume(chunk) {
        var pos = 0;
        while (pos < chunk.length) {
            var n = Math.min(chunk.length - pos, staging.length - stagingLen);
            staging.set(chunk.subarray(pos, pos + n), stagingLen);
            stagingLen += n; pos += n;
            if (stagingLen === staging.length) flushStaging(false);
        }
    }

    function finish() {
        flushStaging(true);
        return { totalSectors: sector, entries: entries };
    }

    function pump(reader, onChunk) {
        return reader.read().then(function(res) {
            if (res.done) return;
            onChunk(res.value);
            return pump(reader, onChunk);
        });
    }

    return fetch(url).then(function(response) {
        if (!response.ok) throw new Error("" + response.status + " " + response.statusText);
        var reader = response.body.getReader();
        return reader.read().then(function(first) {
            var chunk = first.done ? new Uint8Array(0) : first.value;
            var gzip = chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b;      // Content may already be decoded by the server

            // Not compressed: consume as is
            if (!gzip) {
                consume(chunk);
                return pump(reader, consume).then(finish);
            }

            if (typeof DecompressionStream === "undefined") throw new Error("NO_DECOMPRESSION_STREAM");

            // Stream decompression
            var ds = new DecompressionStream("gzip");
            var writer = ds.writable.getWriter();
            var feed = writer.write(chunk).then(function() {
                return pump(reader, function(c) { writer.write(c); });
            }).then(function() {
                return writer.close();
            });
            return Promise.all([ feed, pump(ds.readable.getReader(), consume) ]).then(finish);
        });
    });
};

// Scans an already uncompressed content
wmsx.SparseDiskImage.scanContent = function(content) {
    var entries = [];
    var totalSectors = Math.ceil(content.length / 512);
    for (var s = 0; s < totalSectors; ++s) {
        var data = new Uint8Array(512);
        data.set(content.subarray(s * 512, Math.min(s * 512 + 512, content.length)));
        if (!wmsx.SparseDiskImage.isZero(data, 0)) entries.push([ s, data ]);
    }
    return { totalSectors: totalSectors, entries: entries };
};
