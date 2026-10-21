// MegaFlashROM SCC+ SD Cartridge (Manuel Pazos)
// 8MB FlashROM (M29W640GB), SCC-I, PSG, internal Slot Expander, 512KB RAM Mapper and SD card interface (MegaSD, SPI)
// Subslot 0: Recovery (16K), Subslot 1: MegaFlashROM SCC+ (multiple mappers), Subslot 2: 512K RAM Mapper, Subslot 3: MegaSD
// SD card 1 uses the Hard Disk drive images. SD card 2 is empty
// Ported from the openMSX implementation
// 0x0000 - 0xffff

wmsx.CartridgeMegaFlashROMSCCPlusSD = function(rom) {
    "use strict";

    var self = this;

    function init() {
        self.rom = rom;
        bytes = new Uint8Array(FLASH_SIZE);
        wmsx.Util.arrayFill(bytes, 0xff);
        if (rom.content.length > 0) wmsx.Util.arrayCopy(rom.content, 0, bytes, 0, Math.min(rom.content.length, FLASH_SIZE));
        self.bytes = bytes;
    }

    this.getDataDesc = function() {
        return "Flash";
    };

    this.loadData = function(name, arrContent) {
        if (arrContent.length === 0 || arrContent.length > FLASH_SIZE) return null;

        wmsx.Util.arrayFill(bytes, 0xff);
        wmsx.Util.arrayCopy(arrContent, 0, bytes);
        flashContentName = name;
        flashModif = false;
        return arrContent;
    };

    this.getDataToSave = function() {
        flashModif = false;
        if (cartridgeSocket) cartridgeSocket.fireCartridgesModifiedStateUpdate();
        var content = new Uint8Array(bytes);
        return { fileName: flashContentName || "MegaFlashROMSCCPlusSD.rom", content: content, desc: this.getDataDesc() };
    };

    this.dataModified = function() {
        return flashModif;
    };

    this.connect = function(pMachine) {
        machine = pMachine;
        bus = machine.bus;
        cartridgeSocket = machine.getCartridgeSocket();
        diskDriveSocket = machine.getDiskDriveSocket();
        scc.setAudioSocket(machine.getAudioSocket());
        psg.setAudioSocket(machine.getAudioSocket());
        if (sccConnected) scc.connectAudio();                   // needed in LoadStates
        if (psgConnected) psg.connectAudio();

        // PSG ports
        bus.connectOutputDevice(0x10, outputPSGAddress);
        bus.connectOutputDevice(0x11, outputPSGData);
        if (configReg & 0x08) connectPSGNormalPorts();

        // Memory Mapper ports, shared with other Mappers
        for (var p = 0; p < 4; ++p) {
            mapperPrevInput[p] = bus.getInputDevice(0xfc + p);
            mapperPrevOutput[p] = bus.getOutputDevice(0xfc + p);
            bus.connectInputDevice(0xfc + p, mapperInputs[p]);
            bus.connectOutputDevice(0xfc + p, mapperOutputs[p]);
        }

        diskDriveSocket.hardDiskInterfaceConnected(this);
    };

    this.disconnect = function(pMachine) {
        scc.disconnectAudio();
        psg.disconnectAudio();

        bus.disconnectOutputDevice(0x10, outputPSGAddress);
        bus.disconnectOutputDevice(0x11, outputPSGData);
        disconnectPSGNormalPorts();

        for (var p = 0; p < 4; ++p) {
            if (bus.getInputDevice(0xfc + p) === mapperInputs[p]) bus.connectInputDevice(0xfc + p, mapperPrevInput[p]);
            if (bus.getOutputDevice(0xfc + p) === mapperOutputs[p]) bus.connectOutputDevice(0xfc + p, mapperPrevOutput[p]);
        }

        diskDriveSocket.hardDiskInterfaceDisconnected(this);
        machine = bus = null;
    };

    this.powerOn = function() {
        wmsx.Util.arrayFill(ram, 0);
        this.reset();
    };

    this.powerOff = function() {
        scc.disconnectAudio(); sccConnected = false;
        psg.disconnectAudio(); psgConnected = false;
    };

    this.reset = function() {
        mapperReg = 0;
        offsetReg = 0;
        updateConfigReg(3);
        subslotReg = 0;
        bankRegsSubSlot1[0] = 0; bankRegsSubSlot1[1] = 1; bankRegsSubSlot1[2] = 2; bankRegsSubSlot1[3] = 3;

        sccMode = 0;
        sccBanks[0] = 0; sccBanks[1] = 1; sccBanks[2] = 2; sccBanks[3] = 3;
        scc.reset(); sccConnected = false;
        scc.setSCCIMode(false);

        psgLatch = 0;
        psg.reset();

        flashReset();

        memMapperRegs[0] = 3; memMapperRegs[1] = 2; memMapperRegs[2] = 1; memMapperRegs[3] = 0;

        bankRegsSubSlot3[0] = 0; bankRegsSubSlot3[1] = 1; bankRegsSubSlot3[2] = 0; bankRegsSubSlot3[3] = 0;
        selectedCard = 0;
        sdCards[0].reset(); sdCards[1].reset();
    };

    this.read = function(address) {
        if (address === 0xffff && isSlotExpanderEnabled()) return subslotReg ^ 0xff;

        switch (getSubSlot(address)) {
            case 0: return flashRead(address & 0x3fff);
            case 1: return readSubSlot1(address);
            case 2: return isMemoryMapperEnabled() ? ram[calcMemMapperAddress(address)] : 0xff;
            case 3: return readSubSlot3(address);
        }
    };

    this.write = function(address, value) {
        if (address === 0xffff && isSlotExpanderEnabled()) subslotReg = value;

        switch (getSubSlot(address)) {
            case 0: writeToFlash(address & 0x3fff, value); break;
            case 1: writeSubSlot1(address, value); break;
            case 2: if (isMemoryMapperEnabled()) ram[calcMemMapperAddress(address)] = value; break;
            case 3: writeSubSlot3(address, value); break;
        }
    };

    function getSubSlot(address) {
        return isSlotExpanderEnabled() ? (subslotReg >> ((address >> 14) << 1)) & 3 : 1;
    }

    function writeToFlash(address, value) {
        if (configReg & 0x01) flashWrite(address, value);        // flash is write protected by not passing writes at all
    }


    // Config register  -------------------------------------------

    function isConfigRegDisabled()          { return (configReg & 0x80) !== 0; }
    function isMemoryMapperEnabled()        { return (configReg & 0x20) === 0; }
    function isDSKModeEnabled()             { return (configReg & 0x10) !== 0; }
    function isSlotExpanderEnabled()        { return (configReg & 0x04) === 0; }

    function updateConfigReg(value) {
        if ((value ^ configReg) & 0x08) {
            if (value & 0x08) connectPSGNormalPorts();
            else disconnectPSGNormalPorts();
        }
        configReg = value;
        flashVppWpPinLow = (configReg & 0x02) !== 0;
    }


    // Subslot 1: MegaFlashROM SCC+  -------------------------------------------

    function is64KMapperConfigured()                { return (mapperReg & 0xc0) === 0x40; }
    function isKonamiSCCMapperConfigured()          { return (mapperReg & 0xe0) === 0x00; }
    function isWritingKonamiBankRegisterDisabled()  { return (mapperReg & 0x08) !== 0; }
    function isMapperRegisterDisabled()             { return (mapperReg & 0x04) !== 0; }
    function areBankRegsAndOffsetRegsDisabled()     { return (mapperReg & 0x02) !== 0; }
    function areKonamiMapperLimitsEnabled()         { return (mapperReg & 0x01) !== 0; }

    function getSCCEnable() {
        if ((sccMode & 0x20) && (sccBanks[3] & 0x80)) return EN_SCCPLUS;
        if (!(sccMode & 0x20) && ((sccBanks[2] & 0x3f) === 0x3f)) return EN_SCC;
        return EN_NONE;
    }

    function getFlashAddrSubSlot1(address) {
        var is64K = is64KMapperConfigured();
        var page = is64K ? address >> 14 : (address >> 13) - 2;
        var size = is64K ? 0x4000 : 0x2000;

        if (page < 0 || page >= 4) return -1;           // outside 0x4000 - 0xbfff for non-64K mapper

        var bank = bankRegsSubSlot1[page];
        if (isDSKModeEnabled() && page === 0 && bank === 0) bank = 0x3fa;
        else if (isDSKModeEnabled() && page === 1 && bank === 1) bank = 0x3fb;
        else bank += offsetReg;

        return ((bank * size) + (address & (size - 1)) + 0x010000) & 0x7fffff;     // wrap at 8MB
    }

    function readSubSlot1(address) {
        if (isKonamiSCCMapperConfigured()) {
            var enable = getSCCEnable();
            if ((enable === EN_SCC && address >= 0x9800 && address < 0xa000) || (enable === EN_SCCPLUS && address >= 0xb800 && address < 0xc000))
                return scc.read(address);
        }
        var flashAddr = getFlashAddrSubSlot1(address);
        return flashAddr >= 0 ? flashRead(flashAddr) : 0xff;
    }

    function writeSubSlot1(address, value) {
        // address is calculated before writes to other regions take effect
        var flashAddr = getFlashAddrSubSlot1(address);

        // A single write can trigger behaviour in multiple overlapping regions
        if (!isConfigRegDisabled() && address === 0x7ffc) updateConfigReg(value);
        if (!isMapperRegisterDisabled() && address === 0x7fff) mapperReg = value;
        if (!areBankRegsAndOffsetRegsDisabled() && address === 0x7ffd) offsetReg = (offsetReg & 0x300) | value;
        if (!areBankRegsAndOffsetRegsDisabled() && address === 0x7ffe) offsetReg = (offsetReg & 0xff) | ((value & 0x03) << 8);

        if (isKonamiSCCMapperConfigured()) {
            if ((address & 0xfffe) === 0xbffe) {
                sccMode = value;
                scc.setSCCIMode((value & 0x20) !== 0);
            }
            var enable = getSCCEnable();
            var isRamSegment2 = ((sccMode & 0x24) === 0x24) || ((sccMode & 0x10) === 0x10);
            var isRamSegment3 = (sccMode & 0x10) === 0x10;
            if ((enable === EN_SCC && !isRamSegment2 && address >= 0x9800 && address < 0xa000) ||
                (enable === EN_SCCPLUS && !isRamSegment3 && address >= 0xb800 && address < 0xc000)) {
                if (!sccConnected) connectSCC();
                scc.write(address, value);
                return;         // when SCC registers are selected flashROM is not seen, so it does not accept commands
            }
        }

        var page8K = (address >> 13) - 2;
        if (!areBankRegsAndOffsetRegsDisabled() && page8K >= 0 && page8K < 4) {
            switch (mapperReg & 0xe0) {
                case 0x00:
                    // Konami SCC
                    if ((address & 0x1800) === 0x1000) {
                        sccBanks[page8K] = value;
                        bankRegsSubSlot1[page8K] = value & (areKonamiMapperLimitsEnabled() ? 0x3f : 0xff);
                        if (getSCCEnable() !== EN_NONE && !sccConnected) connectSCC();
                    }
                    break;
                case 0x20:
                    // Konami
                    if (isWritingKonamiBankRegisterDisabled() && address < 0x6000) break;
                    if (address < 0x5000 || (address >= 0x5800 && address < 0x6000)) break;      // only SCC range works
                    bankRegsSubSlot1[page8K] = value & (areKonamiMapperLimitsEnabled() ? 0x1f : 0xff);
                    break;
                case 0x40:
                case 0x60:
                    // 64KB
                    bankRegsSubSlot1[page8K] = value;
                    break;
                case 0x80:
                case 0xa0:
                    // ASCII-8
                    if (address >= 0x6000 && address < 0x8000) bankRegsSubSlot1[(address >> 11) & 0x03] = value;
                    break;
                case 0xc0:
                case 0xe0:
                    // ASCII-16. Uses all 4 bank registers, 9 bits
                    if (address >= 0x6000 && address < 0x6800) {
                        bankRegsSubSlot1[0] = (2 * value) & 0x1ff;
                        bankRegsSubSlot1[1] = (2 * value + 1) & 0x1ff;
                    }
                    if (address >= 0x7000 && address < 0x7800) {
                        bankRegsSubSlot1[2] = (2 * value) & 0x1ff;
                        bankRegsSubSlot1[3] = (2 * value + 1) & 0x1ff;
                    }
                    break;
            }
        }

        if (flashAddr >= 0) writeToFlash(flashAddr, value);
    }

    function connectSCC() {
        scc.connectAudio();
        sccConnected = true;
    }


    // Subslot 2: 512K Memory Mapper  -------------------------------------------

    function calcMemMapperAddress(address) {
        return ((memMapperRegs[address >> 14] & MAPPER_MASK) << 14) | (address & 0x3fff);
    }

    function mapperOutput(p) {
        return function(val, port) {
            mapperPrevOutput[p](val, port);
            memMapperRegs[p] = val & MAPPER_MASK;
        };
    }

    function mapperInput(p) {
        return function(port) {
            // Readback from the main Mapper, if present
            return mapperPrevInput[p] && mapperPrevInput[p] !== wmsx.DeviceMissing.inputPort
                ? mapperPrevInput[p](port)
                : memMapperRegs[p] | (~MAPPER_MASK & 0xff);
        };
    }


    // Subslot 3: MegaSD  -------------------------------------------

    function getFlashAddrSubSlot3(address) {
        var page8K = (address >> 13) - 2;
        return (bankRegsSubSlot3[page8K] & 0x7f) * 0x2000 + (address & 0x1fff) + 0x700000;
    }

    function readSubSlot3(address) {
        if ((bankRegsSubSlot3[0] & 0xc0) === 0x40 && address >= 0x4000 && address < 0x6000)
            return sdCards[selectedCard].transfer(0xff, (address & 0x1000) !== 0);       // transfer from SD card

        if (address >= 0x4000 && address < 0xc000) return flashRead(getFlashAddrSubSlot3(address));
        return 0xff;
    }

    function writeSubSlot3(address, value) {
        if ((bankRegsSubSlot3[0] & 0xc0) === 0x40 && address >= 0x4000 && address < 0x6000) {
            if (address >= 0x5800) selectedCard = value & 1;
            else sdCards[selectedCard].transfer(value, (address & 0x1000) !== 0);       // transfer to SD card
        } else {
            // write to flash first, before modifying bank regs
            if (address >= 0x4000 && address < 0xc000) writeToFlash(getFlashAddrSubSlot3(address), value);
            // ASCII-8 mapper
            if (address >= 0x6000 && address < 0x8000) bankRegsSubSlot3[(address >> 11) & 0x03] = value;
        }
    }


    // PSG (write only)  -------------------------------------------

    function outputPSGAddress(val) {
        psgLatch = val & 0x0f;
    }

    function outputPSGData(val) {
        if (!psgConnected) {
            psg.connectAudio();
            psgConnected = true;
        }
        psgRegister[psgLatch] = val;
        switch (psgLatch) {
            case 0: case 1:
                psg.setPeriodA(((psgRegister[1] & 0x0f) << 8) | psgRegister[0]); break;
            case 2: case 3:
                psg.setPeriodB(((psgRegister[3] & 0x0f) << 8) | psgRegister[2]); break;
            case 4: case 5:
                psg.setPeriodC(((psgRegister[5] & 0x0f) << 8) | psgRegister[4]); break;
            case 6:
                psg.setPeriodN(val & 0x1f); break;
            case 7:
                psg.setMixerControl(val); break;
            case 8:
                psg.setAmplitudeA(val); break;
            case 9:
                psg.setAmplitudeB(val); break;
            case 10:
                psg.setAmplitudeC(val); break;
            case 11: case 12:
                psg.setPeriodE((psgRegister[12] << 8) | psgRegister[11]); break;
            case 13:
                psg.setEnvelopeControl(val); break;
        }
    }

    // Cartridge PSG also mapped to ports 0xa0 - 0xa1, together with the main PSG
    function connectPSGNormalPorts() {
        if (!bus || psgNormalPrevA0) return;
        psgNormalPrevA0 = bus.getOutputDevice(0xa0);
        psgNormalPrevA1 = bus.getOutputDevice(0xa1);
        bus.connectOutputDevice(0xa0, outputPSGNormalA0);
        bus.connectOutputDevice(0xa1, outputPSGNormalA1);
    }

    function disconnectPSGNormalPorts() {
        if (!bus || !psgNormalPrevA0) return;
        if (bus.getOutputDevice(0xa0) === outputPSGNormalA0) bus.connectOutputDevice(0xa0, psgNormalPrevA0);
        if (bus.getOutputDevice(0xa1) === outputPSGNormalA1) bus.connectOutputDevice(0xa1, psgNormalPrevA1);
        psgNormalPrevA0 = psgNormalPrevA1 = null;
    }

    function outputPSGNormalA0(val, port) {
        psgNormalPrevA0(val, port);
        outputPSGAddress(val);
    }

    function outputPSGNormalA1(val, port) {
        psgNormalPrevA1(val, port);
        outputPSGData(val);
    }


    // FlashROM M29W640GB (8 x 8KB + 127 x 64KB sectors). Operations complete immediately  ---------------

    function flashReset() {
        flashCmd.length = 0;
        flashState = FLASH_READ;
    }

    function flashRead(address) {
        if (flashState === FLASH_READ) return bytes[address];
        if (flashState === FLASH_AUTOSELECT) return flashAutoSelect(address);
        return flashCFI(address);
    }

    function flashSectorBase(address) {
        return address < 0x10000 ? address & ~0x1fff : address & ~0xffff;
    }

    function flashSectorSize(address) {
        return address < 0x10000 ? 0x2000 : 0x10000;
    }

    function flashSectorWritable(address) {
        // Vpp/WP# pin low protects the first two sectors
        return !(flashVppWpPinLow && address < 0x4000);
    }

    function flashAutoSelect(address) {
        if (address & 1) return 0x00;
        switch ((address >> 1) & 0x7f) {
            case 0x00: return 0x20;                                         // STM
            case 0x01: return 0x7e;
            case 0x02: return flashSectorWritable(address) ? 0 : 1;
            case 0x03: return 0x08;
            case 0x0e: return 0x10;
            case 0x0f: return 0x00;
            default:   return 0x00;
        }
    }

    function flashCFI(address) {
        var value = FLASH_CFI[(address >> 1) & 0xff];
        if (value === undefined) value = 0;
        return (address & 1) ? (value >> 8) & 0xff : value & 0xff;
    }

    function flashPartialMatch(seq) {
        for (var i = 0, len = Math.min(seq.length, flashCmd.length); i < len; ++i)
            if (((flashCmd[i].a >> 1) & 0x7ff) !== FLASH_CMD_ADDR[i] || flashCmd[i].v !== seq[i]) return false;
        return true;
    }

    function flashWrite(address, value) {
        flashCmd.push({ a: address, v: value });

        var pending = false;
        if (flashState === FLASH_READ) {
            pending = flashCheckAutoSelect() || flashCheckErase() || flashCheckProgram() || flashCheckBufferProgram() ||
                flashCheckCFIQuery() || flashCheckLongReset() || flashCheckReset();
        } else if (flashState === FLASH_AUTOSELECT) {
            pending = flashCheckCFIQuery() || flashCheckLongReset() || flashCheckReset();
        } else {
            pending = flashCheckLongReset() || (flashCmd[0].v === 0xff ? (flashState = FLASH_READ, false) : false) || flashCheckReset();
        }
        if (!pending) flashCmd.length = 0;
    }

    function flashCheckReset() {
        if (flashCmd[0].v === 0xf0) flashState = FLASH_READ;
        return false;
    }

    function flashCheckLongReset() {
        if (flashPartialMatch(FLASH_SEQ_LONG_RESET)) {
            if (flashCmd.length < 3) return true;
            flashState = FLASH_READ;
        }
        return false;
    }

    function flashCheckAutoSelect() {
        if (flashPartialMatch(FLASH_SEQ_AUTOSELECT)) {
            if (flashCmd.length < 3) return true;
            flashState = FLASH_AUTOSELECT;
        }
        return false;
    }

    function flashCheckCFIQuery() {
        if (((flashCmd[0].a >> 1) & 0x7ff) === 0x55 && flashCmd[0].v === 0x98) flashState = FLASH_CFI;
        return false;
    }

    function flashCheckErase() {
        if (flashPartialMatch(FLASH_SEQ_ERASE)) {
            if (flashCmd.length < 6) return true;
            var last = flashCmd[5];
            if (last.v === 0x30) {
                // Sector erase
                if (flashSectorWritable(last.a)) flashErase(flashSectorBase(last.a), flashSectorSize(last.a));
            } else if (last.v === 0x10) {
                // Chip erase
                for (var a = 0; a < FLASH_SIZE; a += flashSectorSize(a))
                    if (flashSectorWritable(a)) flashErase(a, flashSectorSize(a));
            }
        }
        return false;
    }

    function flashErase(base, size) {
        for (var i = base, end = base + size; i < end; ++i) bytes[i] = 0xff;
        setFlashModified();
    }

    function flashCheckProgram() {
        if (flashPartialMatch(FLASH_SEQ_PROGRAM)) {
            if (flashCmd.length < 4) return true;
            var last = flashCmd[3];
            if (flashSectorWritable(last.a)) {
                bytes[last.a] &= last.v;
                setFlashModified();
            }
        }
        return false;
    }

    function flashCheckBufferProgram() {
        if (!flashPartialMatch(FLASH_SEQ_BUFFER) || (flashCmd.length > 2 && flashCmd[2].v !== 0x25)) return false;
        var len = flashCmd.length;
        if (len <= 3) return true;
        var sector = flashSectorBase(flashCmd[2].a);
        if (len === 4) return flashCmd[3].v < FLASH_BUFFER_SIZE && flashSectorBase(flashCmd[3].a) === sector;
        var count = flashCmd[3].v + 1;
        if (len <= 4 + count) {
            if ((flashCmd[len - 1].a & ~(FLASH_BUFFER_SIZE - 1)) === (flashCmd[4].a & ~(FLASH_BUFFER_SIZE - 1))) return true;
        } else {
            var last = flashCmd[len - 1];
            if (last.v === 0x29 && flashSectorBase(last.a) === sector && flashSectorWritable(sector)) {
                for (var i = 4; i < len - 1; ++i) bytes[flashCmd[i].a] = flashCmd[i].v;
                setFlashModified();
            }
        }
        return false;
    }

    function setFlashModified() {
        if (flashModif) return;
        flashModif = true;
        if (cartridgeSocket) cartridgeSocket.fireCartridgesModifiedStateUpdate();
    }


    // SD Card in SPI mode  -------------------------------------------

    function SDCard(driveNum) {
        this.driveNum = driveNum;
        this.cmdBuf = [ 0, 0, 0, 0, 0, 0 ];
        this.sectorBuf = new Uint8Array(512);
        this.reset();
    }

    SDCard.prototype.reset = function() {
        this.cmdIdx = 0;
        this.responseQueue = [];
        this.transferDelayCounter = 0;
        this.mode = SD_COMMAND;
        this.currentSector = 0;
        this.currentByteInSector = 0;
    };

    SDCard.prototype.drive = function() {
        return this.driveNum >= 0 && diskDriveSocket ? diskDriveSocket.getDrive() : null;
    };

    SDCard.prototype.isInserted = function() {
        var drive = this.drive();
        return !!drive && drive.isDiskInserted(this.driveNum);
    };

    SDCard.prototype.nbSectors = function() {
        return this.drive().getTotalSectorsAvailable(this.driveNum) || 0;
    };

    SDCard.prototype.readCurrentByteFromCurrentSector = function() {
        var result;
        if (this.currentByteInSector === -1) {
            var drive = this.drive();
            drive.motorFlash(this.driveNum);
            result = drive.readSectorToArray(this.driveNum, this.currentSector, this.sectorBuf) ? SD_START_BLOCK_TOKEN : SD_DATA_ERROR_TOKEN_ERROR;
        } else
            result = this.sectorBuf[this.currentByteInSector];
        this.currentByteInSector++;
        if (this.currentByteInSector === 512) this.responseQueue.push(0x00, 0x00);      // 2 CRCs (dummy)
        return result;
    };

    SDCard.prototype.transfer = function(value, cs) {
        if (!this.isInserted()) return 0xff;        // no card inserted
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
                    this.drive().motorFlash(this.driveNum);
                    response = this.drive().writeSectorFromArray(this.driveNum, this.currentSector, this.sectorBuf) ? SD_DRT_ACCEPTED : SD_DRT_WRITE_ERROR;
                    this.mode = SD_COMMAND;
                    this.transferDelayCounter = 1;
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
                        this.drive().motorFlash(this.driveNum);
                        if (this.drive().writeSectorFromArray(this.driveNum, this.currentSector, this.sectorBuf)) {
                            this.currentByteInSector = -1;
                            this.currentSector++;
                        } else
                            response = SD_DRT_WRITE_ERROR;
                    }
                    this.transferDelayCounter = 1;
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

    SDCard.prototype.executeCommand = function() {
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

    SDCard.prototype.saveState = function() {
        return {
            m: this.mode, cb: this.cmdBuf.slice(0), ci: this.cmdIdx,
            sb: wmsx.Util.storeInt8BitArrayToStringBase64(this.sectorBuf),
            td: this.transferDelayCounter, rq: this.responseQueue.slice(0),
            cs: this.currentSector, cbs: this.currentByteInSector
        };
    };

    SDCard.prototype.loadState = function(s) {
        this.mode = s.m; this.cmdBuf = s.cb.slice(0); this.cmdIdx = s.ci;
        this.sectorBuf = wmsx.Util.restoreStringBase64ToInt8BitArray(s.sb, this.sectorBuf);
        this.transferDelayCounter = s.td; this.responseQueue = s.rq.slice(0);
        this.currentSector = s.cs; this.currentByteInSector = s.cbs;
    };


    var machine, bus, cartridgeSocket, diskDriveSocket;

    var bytes;
    this.bytes = null;

    var subslotReg = 0;
    var configReg = 3;
    var mapperReg = 0, offsetReg = 0;
    var bankRegsSubSlot1 = [ 0, 1, 2, 3 ];

    var scc = new wmsx.SCCIAudio();
    var sccMode = 0, sccBanks = [ 0, 1, 2, 3 ], sccConnected = false;

    var psg = new wmsx.PSGAudio(true);
    var psgLatch = 0, psgRegister = wmsx.Util.arrayFill(new Array(16), 0), psgConnected = false;
    var psgNormalPrevA0 = null, psgNormalPrevA1 = null;

    var ram = new Uint8Array(512 * 1024);
    var memMapperRegs = [ 3, 2, 1, 0 ];
    var mapperPrevInput = new Array(4), mapperPrevOutput = new Array(4);
    var mapperInputs =  [ mapperInput(0),  mapperInput(1),  mapperInput(2),  mapperInput(3)  ];
    var mapperOutputs = [ mapperOutput(0), mapperOutput(1), mapperOutput(2), mapperOutput(3) ];

    var bankRegsSubSlot3 = [ 0, 1, 0, 0 ];
    var selectedCard = 0;
    var sdCards = [ new SDCard(2), new SDCard(-1) ];          // SD card 1 = Hard Disk drive, SD card 2 = empty

    var flashState = 0, flashCmd = [], flashVppWpPinLow = true;
    var flashContentName, flashModif = false;

    this.rom = null;
    this.format = wmsx.SlotFormats.MegaFlashROMSCCPlusSD;

    var FLASH_SIZE = 0x800000;
    var MAPPER_MASK = 0x1f;             // 512KB

    var EN_NONE = 0, EN_SCC = 1, EN_SCCPLUS = 2;

    var FLASH_READ = 0, FLASH_AUTOSELECT = 1, FLASH_CFI = 2;
    var FLASH_CMD_ADDR = [ 0x555, 0x2aa, 0x555, 0x555, 0x2aa ];
    var FLASH_SEQ_LONG_RESET = [ 0xaa, 0x55, 0xf0 ];
    var FLASH_SEQ_AUTOSELECT = [ 0xaa, 0x55, 0x90 ];
    var FLASH_SEQ_ERASE =      [ 0xaa, 0x55, 0x80, 0xaa, 0x55 ];
    var FLASH_SEQ_PROGRAM =    [ 0xaa, 0x55, 0xa0 ];
    var FLASH_SEQ_BUFFER =     [ 0xaa, 0x55 ];
    var FLASH_BUFFER_SIZE = 32;

    // CFI query data (native 16-bit addresses)
    var FLASH_CFI = {
        0x00: 0x0020, 0x01: 0x227e, 0x02: 0x2210, 0x03: 0x2200,
        0x10: 0x51, 0x11: 0x52, 0x12: 0x59, 0x13: 0x02, 0x14: 0x00, 0x15: 0x40,
        0x1b: 0x27, 0x1c: 0x36, 0x1d: 0xb5, 0x1e: 0xc5, 0x1f: 0x04, 0x20: 0x00, 0x21: 0x0a, 0x22: 0x00,
        0x23: 0x04, 0x24: 0x00, 0x25: 0x03, 0x26: 0x00,
        0x27: 0x17, 0x28: 0x02, 0x29: 0x00, 0x2a: 0x05, 0x2b: 0x00, 0x2c: 0x02,
        0x2d: 0x07, 0x2e: 0x00, 0x2f: 0x20, 0x30: 0x00,
        0x31: 0x7e, 0x32: 0x00, 0x33: 0x00, 0x34: 0x01,
        0x40: 0x50, 0x41: 0x52, 0x42: 0x49, 0x43: 0x31, 0x44: 0x33, 0x45: 0x00, 0x46: 0x02, 0x47: 0x04, 0x48: 0x01,
        0x49: 0x04, 0x4a: 0x00, 0x4b: 0x00, 0x4c: 0x01, 0x4d: 0xb5, 0x4e: 0xc5, 0x4f: 0x02, 0x50: 0x01
    };

    var SD_COMMAND = 0, SD_READ = 1, SD_MULTI_READ = 2, SD_WRITE = 3, SD_MULTI_WRITE = 4;
    var SD_DRT_ACCEPTED = 0x05, SD_DRT_WRITE_ERROR = 0x0d;
    var SD_START_BLOCK_TOKEN = 0xfe, SD_START_BLOCK_TOKEN_MBW = 0xfc, SD_STOP_TRAN_TOKEN = 0xfd;
    var SD_DATA_ERROR_TOKEN_ERROR = 0x01, SD_DATA_ERROR_TOKEN_OUT_OF_RANGE = 0x08;
    var SD_R1_BUSY = 0x00, SD_R1_IDLE = 0x01, SD_R1_ILLEGAL_COMMAND = 0x04, SD_R1_PARAMETER_ERROR = 0x80;


    // Savestate  -------------------------------------------

    this.saveState = function() {
        return {
            f: this.format.name,
            r: this.rom.saveState(),
            b: wmsx.Util.compressInt8BitArrayToStringBase64(bytes),
            fs: flashState, fc: flashCmd.slice(0), fm: flashModif,
            ss: subslotReg, cr: configReg, mr: mapperReg, or: offsetReg, b1: bankRegsSubSlot1.slice(0),
            scm: sccMode, scb: sccBanks.slice(0), scc: scc.saveState(), scn: sccConnected,
            pl: psgLatch, pr: psgRegister.slice(0), psg: psg.saveState(), psn: psgConnected,
            ram: wmsx.Util.compressInt8BitArrayToStringBase64(ram), mm: memMapperRegs.slice(0),
            b3: bankRegsSubSlot3.slice(0), sc: selectedCard, sd0: sdCards[0].saveState(), sd1: sdCards[1].saveState()
        };
    };

    this.loadState = function(s) {
        this.rom = wmsx.ROM.loadState(s.r);
        bytes = wmsx.Util.uncompressStringBase64ToInt8BitArray(s.b, bytes);
        this.bytes = bytes;
        flashState = s.fs; flashCmd = s.fc.slice(0); flashModif = s.fm;
        subslotReg = s.ss; mapperReg = s.mr; offsetReg = s.or; bankRegsSubSlot1 = s.b1.slice(0);
        disconnectPSGNormalPorts(); configReg = 3; updateConfigReg(s.cr);
        sccMode = s.scm; sccBanks = s.scb.slice(0); scc.loadState(s.scc); sccConnected = s.scn;
        psgLatch = s.pl; psgRegister = s.pr.slice(0); psg.loadState(s.psg); psgConnected = s.psn;
        ram = wmsx.Util.uncompressStringBase64ToInt8BitArray(s.ram, ram);
        memMapperRegs = s.mm.slice(0);
        bankRegsSubSlot3 = s.b3.slice(0); selectedCard = s.sc;
        sdCards[0].loadState(s.sd0); sdCards[1].loadState(s.sd1);

        if (sccConnected) scc.connectAudio();
        if (psgConnected) psg.connectAudio();
    };

    this.eval = function(str) {
        return eval(str);
    };


    if (rom) init();

};

wmsx.CartridgeMegaFlashROMSCCPlusSD.prototype = wmsx.Slot.base;

wmsx.CartridgeMegaFlashROMSCCPlusSD.recreateFromSaveState = function(state, previousSlot) {
    var cart = previousSlot || new wmsx.CartridgeMegaFlashROMSCCPlusSD();
    cart.loadState(state);
    return cart;
};
