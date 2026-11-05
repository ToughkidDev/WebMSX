// Based on megasd.v, SD/MMC card interface, Revision 2.00
// Copyright (c) 2022 t.hara
// All rights reserved.
// JavaScript port for WebMSX by ToughkidDEV
//
// Redistribution and use of this source code or any derivative works, are
// permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice,
//    this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
// 3. Redistributions may not be sold, nor may they be used in a commercial
//    product or activity without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
// TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
// PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
// EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
// OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
// WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
// OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
// ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//

// MSX++ (OCM-PLD) Internal MegaSD at Slot 3-2: ESE-RAM 1024 KB with the SD card interface
// The ESE-RAM starts with the MegaSD disk driver of the OCM-SDBIOS (MEGASDHC.ROM or NEXTOR.ROM, blocks 01-08 of OCM-BIOS.DAT)
// 0x4000 - 0xbfff: 4 8K banks set at 0x6000-0x7fff. Bank bit 7 enables writes. Bank 0 = $40-$7F selects the SD card registers at 0x4000-0x5fff:
//   0x4000-0x57ff: data register (0x4000-0x4fff /CS low, 0x5000-0x57ff /CS high). Reads return the previous transfer and start a new one
//   0x5800-0x5fff: mode register (write: bit 7 low speed, bit 0 = 1 disables data transfers). 0x5800-0x5bff read: status
// SD card: the Hard Disk drive image if inserted, else the OCM_SD_URL image. Transfers are instantaneous

wmsx.CartridgeOCMMegaSD = function(rom) {
"use strict";

    function init(self) {
        self.rom = rom;
        var content = rom.content;
        self.preLoadedContentSize = Math.min(content.length, RAM_SIZE);
        self.bytes = ram;
        loadInitialContent();
    }

    this.connect = function(machine) {
        hardDiskStorage = wmsx.SDCardSPI.hardDiskStorage(machine.getDiskDriveSocket());
    };

    // ESE-RAM is loaded with the OCM-SDBIOS content at every power on, as the IPL-ROM does
    this.powerOn = function() {
        loadInitialContent();
        this.reset();
    };

    this.reset = function() {
        bank0 = bank1 = bank2 = bank3 = 0;
        lowSpeedMode = false;
        dataEnabled = true;
        readBusy = false;
        mmcData = 0xff;
        sdCard.reset();
    };

    this.read = function(address) {
        if (address < 0x4000 || address >= 0xc000) return 0xff;

        // SD card registers
        if (address < 0x6000 && (bank0 & 0xc0) === 0x40) {
            if (address >= 0x5800) {
                if (address < 0x5c00) {
                    readBusy = true;
                    return (DATA_ACTIVE << 7) | powerOnReset;
                }
                readBusy = false;
                return mmcData;
            }
            readBusy = false;
            var result = mmcData;
            transfer(0xff, address);
            return result;
        }

        return ram[(bankForAddress(address) << 13) | (address & 0x1fff)];
    };

    this.write = function(address, value) {
        if (address < 0x4000 || address >= 0xc000) return;

        // Bank registers
        if ((address & 0xe000) === 0x6000) {
            switch ((address >> 11) & 3) {
                case 0: bank0 = value; break;
                case 1: bank1 = value & 0x7f; break;
                case 2: bank2 = value; break;
                default: bank3 = value;
            }
            return;
        }

        // SD card registers
        if (address < 0x6000 && (bank0 & 0xc0) === 0x40) {
            if (address >= 0x5800) {
                lowSpeedMode = (value & 0x80) !== 0;
                dataEnabled = (value & 0x01) === 0;
                powerOnReset = 0;
            } else
                transfer(value, address);
            return;
        }

        // RAM writes enabled by bank bit 7
        var bank = bankForAddress(address);
        if (bank & 0x80) ram[((bank & 0x7f) << 13) | (address & 0x1fff)] = value;
    };

    function bankForAddress(address) {
        switch (address >> 13) {
            case 2: return bank0;
            case 3: return bank1;
            case 4: return bank2;
            default: return bank3;
        }
    }

    function transfer(value, address) {
        if (!dataEnabled) return;
        var epcMode = (bank0 & 0xf0) === 0x60;                  // EPCS serial flash (not emulated)
        var cs = epcMode || (address & 0x1000) !== 0;
        mmcData = epcMode ? 0xff : sdCard.transfer(value, cs);
    }

    function loadInitialContent() {
        ram.fill(0xff);
        var content = rom.content;
        if (content && content.length) ram.set(content.length > RAM_SIZE ? content.slice(0, RAM_SIZE) : content);
    }

    function sdCardStorage() {
        if (hardDiskStorage && hardDiskStorage.isInserted()) return hardDiskStorage;
        return wmsx.SparseDiskImage.sdCards[OCM_SD_CARD] || null;
    }


    var RAM_SIZE = 1024 * 1024;
    var OCM_SD_CARD = 2;                // Index in the loaded SD card images
    var DATA_ACTIVE = 0;                // Transfers are instantaneous

    var ram = new Uint8Array(RAM_SIZE);
    var bank0 = 0, bank1 = 0, bank2 = 0, bank3 = 0;
    var lowSpeedMode = false, dataEnabled = true, readBusy = false, powerOnReset = 1;
    var mmcData = 0xff;

    var hardDiskStorage = null;
    var sdCard = new wmsx.SDCardSPI(sdCardStorage, 0);          // Data Response right after the CRC, as expected by the OCM-MegaSDHC driver

    this.rom = null;
    this.format = wmsx.SlotFormats.OCMMegaSD;
    this.preLoadedContentSize = 0;


    // Savestate  -------------------------------------------

    this.saveState = function() {
        return {
            f: this.format.name,
            r: this.rom.saveState(),
            b: wmsx.Util.compressInt8BitArrayToStringBase64(ram),
            b0: bank0, b1: bank1, b2: bank2, b3: bank3,
            ls: lowSpeedMode, de: dataEnabled, rb: readBusy, por: powerOnReset, md: mmcData,
            sd: sdCard.saveState()
        };
    };

    this.loadState = function(s) {
        this.format = wmsx.SlotFormats[s.f];
        this.rom = wmsx.ROM.loadState(s.r);
        rom = this.rom;
        ram = wmsx.Util.uncompressStringBase64ToInt8BitArray(s.b, ram);
        this.bytes = ram;
        bank0 = s.b0; bank1 = s.b1; bank2 = s.b2; bank3 = s.b3;
        lowSpeedMode = s.ls; dataEnabled = s.de; readBusy = s.rb; powerOnReset = s.por; mmcData = s.md;
        sdCard.loadState(s.sd);
    };

    this.eval = function(str) {
        return eval(str);
    };


    if (rom) init(this);

};

wmsx.CartridgeOCMMegaSD.prototype = wmsx.Slot.base;

wmsx.CartridgeOCMMegaSD.recreateFromSaveState = function(state, previousSlot) {
    var cart = previousSlot || new wmsx.CartridgeOCMMegaSD();
    cart.loadState(state);
    return cart;
};
