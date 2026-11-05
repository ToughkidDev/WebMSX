// Copyright 2015 by Paulo Augusto Peccin. See license.txt distributed with this file.

// SD Card in SPI mode (SDHC, block addressed). Byte level transfers. Ported from openMSX SdCard (GPL-2.0)
// Write response delay: transfers before the Data Response token after a written block (default 1)
// Storage provider: function returning an object with totalSectors, readSector(sector, dest), writeSector(sector, src), or null if no card inserted
// Used by the MegaFlashROM SCC+ SD and the MSX++ (OCM-PLD) Internal MegaSD

(function() {
"use strict";

    var SD_COMMAND = 0, SD_READ = 1, SD_MULTI_READ = 2, SD_WRITE = 3, SD_MULTI_WRITE = 4;
    var SD_DRT_ACCEPTED = 0x05, SD_DRT_WRITE_ERROR = 0x0d;
    var SD_START_BLOCK_TOKEN = 0xfe, SD_START_BLOCK_TOKEN_MBW = 0xfc, SD_STOP_TRAN_TOKEN = 0xfd;
    var SD_DATA_ERROR_TOKEN_ERROR = 0x01, SD_DATA_ERROR_TOKEN_OUT_OF_RANGE = 0x08;
    var SD_R1_BUSY = 0x00, SD_R1_IDLE = 0x01, SD_R1_ILLEGAL_COMMAND = 0x04, SD_R1_PARAMETER_ERROR = 0x80;

    wmsx.SDCardSPI = function(storageProvider) {
        this.storageProvider = storageProvider;
        this.cmdBuf = [ 0, 0, 0, 0, 0, 0 ];
        this.sectorBuf = new Uint8Array(512);
        this.reset();
    };

    wmsx.SDCardSPI.prototype.reset = function() {
        this.cmdIdx = 0;
        this.responseQueue = [];
        this.transferDelayCounter = 0;
        this.mode = SD_COMMAND;
        this.currentSector = 0;
        this.currentByteInSector = 0;
    };

    wmsx.SDCardSPI.prototype.storage = function() {
        return this.storageProvider() || null;
    };

    wmsx.SDCardSPI.prototype.nbSectors = function() {
        var storage = this.storage();
        return storage ? storage.totalSectors : 0;
    };

    wmsx.SDCardSPI.prototype.readCurrentByteFromCurrentSector = function() {
        var result;
        if (this.currentByteInSector === -1) {
            var storage = this.storage();
            result = storage && storage.readSector(this.currentSector, this.sectorBuf) ? SD_START_BLOCK_TOKEN : SD_DATA_ERROR_TOKEN_ERROR;
        } else
            result = this.sectorBuf[this.currentByteInSector];
        this.currentByteInSector++;
        if (this.currentByteInSector === 512) this.responseQueue.push(0x00, 0x00);      // 2 CRCs (dummy)
        return result;
    };

    wmsx.SDCardSPI.prototype.writeCurrentSector = function() {
        var storage = this.storage();
        return !!storage && storage.writeSector(this.currentSector, this.sectorBuf);
    };

    wmsx.SDCardSPI.prototype.transfer = function(value, cs) {
        if (!this.storage()) return 0xff;           // no card inserted
        if (cs) return 0xff;                        // /CS is true: not for this chip

        // process output
        var retval = 0xff;
        if (this.transferDelayCounter > 0)
            --this.transferDelayCounter;
        else {
            if (this.responseQueue.length === 0) {
                switch (this.mode) {
                    case SD_READ:
                        retval = this.readCurrentByteFromCurrentSector();
                        if (this.currentByteInSector === 512) this.mode = SD_COMMAND;
                        break;
                    case SD_MULTI_READ:
                        if (this.currentSector >= this.nbSectors())
                            retval = SD_DATA_ERROR_TOKEN_OUT_OF_RANGE;
                        else {
                            retval = this.readCurrentByteFromCurrentSector();
                            if (this.currentByteInSector === 512) {
                                this.currentSector++;
                                this.currentByteInSector = -1;
                            }
                        }
                        break;
                }
            } else
                retval = this.responseQueue.shift();
        }

        // process input
        var response;
        switch (this.mode) {
            case SD_WRITE:
                if (this.currentByteInSector === -1) {
                    if (value === SD_START_BLOCK_TOKEN) this.currentByteInSector++;
                    break;
                }
                if (this.currentByteInSector < 512) this.sectorBuf[this.currentByteInSector] = value;
                this.currentByteInSector++;
                if (this.currentByteInSector === 512 + 2) {
                    response = this.writeCurrentSector() ? SD_DRT_ACCEPTED : SD_DRT_WRITE_ERROR;
                    this.mode = SD_COMMAND;
                    this.transferDelayCounter = this.writeResponseDelay;
                    this.responseQueue.push(response);
                }
                break;
            case SD_MULTI_WRITE:
                if (this.currentByteInSector === -1) {
                    if (value === SD_STOP_TRAN_TOKEN) this.mode = SD_COMMAND;
                    if (value === SD_START_BLOCK_TOKEN_MBW) this.currentByteInSector++;
                    break;
                }
                if (this.currentByteInSector < 512) this.sectorBuf[this.currentByteInSector] = value;
                this.currentByteInSector++;
                if (this.currentByteInSector === 512 + 2) {
                    response = SD_DRT_ACCEPTED;
                    if (this.currentSector >= this.nbSectors())
                        response = SD_DRT_WRITE_ERROR;
                    else {
                        if (this.writeCurrentSector()) {
                            this.currentByteInSector = -1;
                            this.currentSector++;
                        } else
                            response = SD_DRT_WRITE_ERROR;
                    }
                    this.transferDelayCounter = this.writeResponseDelay;
                    this.responseQueue.push(response);
                }
                break;
            default:
                if ((this.cmdIdx === 0 && (value >> 6) === 1) || this.cmdIdx > 0) {     // command start or in progress
                    this.cmdBuf[this.cmdIdx] = value;
                    ++this.cmdIdx;
                    if (this.cmdIdx === 6) {
                        this.executeCommand();
                        this.cmdIdx = 0;
                    }
                }
                break;
        }

        return retval;
    };

    wmsx.SDCardSPI.prototype.executeCommand = function() {
        // it takes 2 transfers (2x8 cycles) before a reply can be given to a command
        this.transferDelayCounter = 2;
        var q = this.responseQueue;
        var command = this.cmdBuf[0] & 0x3f;
        switch (command) {
            case 0:  // GO_IDLE_STATE
                q.length = 0;
                this.mode = SD_COMMAND;
                q.push(SD_R1_IDLE);
                break;
            case 8:  // SEND_IF_COND
                q.push(SD_R1_IDLE, 0x02, 0x00, 0x01, this.cmdBuf[4]);
                break;
            case 9:  // SEND_CSD (CSD version 2.0, SDHC)
                var cSize = (((this.nbSectors() * 512) / (512 * 1024)) | 0) - 1;
                if (cSize < 0) cSize = 0;
                q.push(SD_R1_BUSY, SD_START_BLOCK_TOKEN, 0x40, 0x0e, 0x00, 0x32, 0x00, 0x00, 0x00,
                    (cSize >> 16) & 0x3f, (cSize >> 8) & 0xff, cSize & 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01);
                break;
            case 10: // SEND_CID
                q.push(SD_R1_BUSY, SD_START_BLOCK_TOKEN, 0xaa, 0x77, 0x6d, 0x6d, 0x75, 0x63, 0x6f, 0x4d,     // "wmmucoM"
                    0x01, 0x12, 0x34, 0x56, 0x78, 0x00, 0xe6, 0x01);
                break;
            case 12: // STOP TRANSMISSION
                q.push(SD_R1_IDLE);
                this.mode = SD_COMMAND;
                break;
            case 16: // SET_BLOCK_LEN
                q.push(SD_R1_IDLE);
                break;
            case 17: // READ_SINGLE_BLOCK
            case 18: // READ_MULTIPLE_BLOCK
            case 24: // WRITE_BLOCK
            case 25: // WRITE_MULTIPLE_BLOCK
                // SDHC so the address is the sector
                this.currentSector = ((this.cmdBuf[1] << 24) | (this.cmdBuf[2] << 16) | (this.cmdBuf[3] << 8) | this.cmdBuf[4]) >>> 0;
                if (this.currentSector >= this.nbSectors())
                    q.push(SD_R1_PARAMETER_ERROR);
                else {
                    q.push(SD_R1_BUSY);
                    this.mode = command === 17 ? SD_READ : command === 18 ? SD_MULTI_READ : command === 24 ? SD_WRITE : SD_MULTI_WRITE;
                    this.currentByteInSector = -1;      // wait for token
                }
                break;
            case 41: // ACMD 41: SD_SEND_OP_COND
                q.push(SD_R1_BUSY);
                break;
            case 55: // APP_CMD
                q.push(SD_R1_IDLE);
                break;
            case 58: // READ_OCR
                q.push(SD_R1_BUSY, 0x40, 0x00, 0x00, 0x00);
                break;
            default:
                q.push(SD_R1_ILLEGAL_COMMAND);
                break;
        }
    };

    wmsx.SDCardSPI.prototype.saveState = function() {
        return {
            m: this.mode, cb: this.cmdBuf.slice(0), ci: this.cmdIdx,
            sb: wmsx.Util.storeInt8BitArrayToStringBase64(this.sectorBuf),
            td: this.transferDelayCounter, rq: this.responseQueue.slice(0),
            cs: this.currentSector, cbs: this.currentByteInSector
        };
    };

    wmsx.SDCardSPI.prototype.loadState = function(s) {
        this.mode = s.m; this.cmdBuf = s.cb.slice(0); this.cmdIdx = s.ci;
        this.sectorBuf = wmsx.Util.restoreStringBase64ToInt8BitArray(s.sb, this.sectorBuf);
        this.transferDelayCounter = s.td; this.responseQueue = s.rq.slice(0);
        this.currentSector = s.cs; this.currentByteInSector = s.cbs;
    };

    // Hard Disk drive as SD card storage
    wmsx.SDCardSPI.hardDiskStorage = function(diskDriveSocket) {
        var HARD_DISK_DRIVE = 2;
        return {
            isInserted: function() {
                var drive = diskDriveSocket.getDrive();
                return !!drive && drive.isDiskInserted(HARD_DISK_DRIVE);
            },
            get totalSectors() {
                return diskDriveSocket.getDrive().getTotalSectorsAvailable(HARD_DISK_DRIVE) || 0;
            },
            readSector: function(sector, dest) {
                var drive = diskDriveSocket.getDrive();
                drive.motorFlash(HARD_DISK_DRIVE);
                return drive.readSectorToArray(HARD_DISK_DRIVE, sector, dest);
            },
            writeSector: function(sector, src) {
                var drive = diskDriveSocket.getDrive();
                drive.motorFlash(HARD_DISK_DRIVE);
                return drive.writeSectorFromArray(HARD_DISK_DRIVE, sector, src);
            }
        };
    };

})();
