// Based on megaram.vhd, Mega-ROM emulation, SCC+/ASC8K(16Mbits), ASC16K(32Mbits), Revision 3.01
// Copyright (c) 2006 Kazuhiro Tsujikawa (ESE Artists' factory)
// All rights reserved.
// Modified by t.hara / KdL. JavaScript port for WebMSX by ToughkidDEV
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

// OCM-PLD Internal ESE-SCC (ESE-MegaSCC+ / ESE-MegaRAM). Ported from the OCM-PLD megaram.vhd (by KdL and the ESE MSX System 3 authors)
// RAM based MegaROM cartridge, used by the MSX++ (OCM-PLD) machine as Internal SCC-I on Cartridge Slot-1 / Slot-2
// Mapper types: SCC+ 2048 KB (full R/W), ASCII-8K 2048 KB (1024KB R/W + 1024KB R/-), ASCII-16K 4096 KB (2048KB R/W + 2048KB R/-)
// Optional Linear mode: 64 KB of the RAM visible at 0x0000 - 0xffff
// Not a regular Cartridge. Controlled and inserted by the OCM Switched I/O device

wmsx.SlotOCMESESCC = function(name, ramSizeKB) {
"use strict";

    function init(self) {
        ram = new Uint8Array(ramSizeKB * 1024);
        ramMask = ram.length - 1;
        scc = new wmsx.SCCIAudio(name);
        self.reset();
    }

    this.connect = function(pMachine) {
        machine = pMachine;
        scc.setAudioSocket(machine.getAudioSocket());
        if (sccConnected) connectSCC();     // needed in LoadStates
    };

    this.disconnect = function() {
        scc.disconnectAudio();
    };

    this.powerOn = function() {
        ram.fill(0);
        this.reset();
    };

    this.powerOff = function() {
        scc.disconnectAudio();
        sccConnected = false;
    };

    this.reset = function() {
        bankL = bankH = 0;
        bank0 = 0x00; bank1 = 0x01; bank2 = 0x02; bank3 = 0x03;
        modeA = modeB = 0;
        scc.reset();
        scc.setSCCIMode(false);
    };

    // mapsel: 0 or 2: SCC+, 1: ASCII-8K, 3: ASCII-16K
    this.setMapperType = function(pMapsel) {
        mapsel = pMapsel & 3;
    };

    this.setExtendedMegaROMReading = function(state) {
        xmrEna = !!state;
    };

    this.setLinear = function(state) {
        linear = !!state;
    };

    this.read = function(address) {
        if (linear) return ram[address];
        if (address < 0x4000 || address >= 0xc000) return 0xff;

        var sel = decode(address, false);
        if (sel === 2) {
            if (!sccConnected) connectSCC();
            return scc.read(address);
        }
        if (sel === 1) return ram[ramAddress(address, false) & ramMask];
        return 0xff;
    };

    this.write = function(address, value) {
        if (linear) { ram[address] = value; return; }
        if (address < 0x4000 || address >= 0xc000) return;

        var sel = decode(address, true);
        if (sel === 2) {
            if (!sccConnected) connectSCC();
            scc.write(address, value);
            return;
        }
        if (sel === 1) {
            ram[ramAddress(address, true) & ramMask] = value;
            return;
        }

        // MEGA-ROM bank register access
        var bankWrite = (modeA & 0x50) === 0 && (modeB & 0x10) === 0;
        if ((mapsel & 1) === 0) {
            switch (address & 0xf800) {
                case 0x5000: if (bankWrite) bank0 = value; break;
                case 0x7000: if (bankWrite) bank1 = value; break;
                case 0x9000: if ((modeB & 0x10) === 0) bank2 = value; break;
                case 0xb000: if (bankWrite) bank3 = value; break;
            }
            if ((address & 0x1ffe) === 0x1ffe) {
                if ((address >> 13) === 3 && (modeB & 0x30) === 0) modeA = value;                                  // 7FFE-7FFF
                else if ((address >> 13) === 5 && (modeA & 0x50) === 0) {                                          // BFFE-BFFF
                    modeB = value;
                    scc.setSCCIMode((modeB & 0x20) !== 0);
                }
            }
        } else {
            switch (address & 0xf000) {
                case 0x6000:
                    if ((mapsel & 2) === 0) {                                                                   // ASCII-8K
                        if (address & 0x0800) bank1 = value; else bank0 = value;
                    } else if ((address & 0x0800) === 0) {                                                      // ASCII-16K
                        bankL = (value >> 6) & 1;
                        bank0 = (value & 0x80) | ((value & 0x3f) << 1);
                        bank1 = bank0 | 1;
                    }
                    break;
                case 0x7000:
                    if ((mapsel & 2) === 0) {                                                                   // ASCII-8K
                        if (address & 0x0800) bank3 = value; else bank2 = value;
                    } else if ((address & 0x0800) === 0) {                                                      // ASCII-16K
                        bankH = (value >> 6) & 1;
                        bank2 = (value & 0x80) | ((value & 0x3f) << 1);
                        bank3 = bank2 | 1;
                    }
                    break;
            }
        }
    };

    // Returns 2: SCC wave memory, 1: RAM, 0: MEGA-ROM bank register access
    function decode(address, wrt) {
        var page = address >> 13;                                   // 2: 4000-5FFF, 3: 6000-7FFF, 4: 8000-9FFF, 5: A000-BFFF
        var asc = (mapsel & 1) !== 0;
        var dec1FFE = (address & 0x1ffe) === 0x1ffe;
        var decSccA = (address & 0xf800) === 0x9800 && (modeB & 0x20) === 0 && (bank2 & 0x3f) === 0x3f;
        var decSccB = (address & 0xf800) === 0xb800 && (modeB & 0x20) !== 0 && (bank3 & 0x80) !== 0;

        if ((address & 0x0100) === 0 && (modeB & 0x10) === 0 && !asc && (decSccA || decSccB)) return 2;

        if (asc) {
            if (!wrt) return 1;                                                                                 // 4000-BFFF (R/-, ASC8K/16K)
            if ((page === 2 && (bank0 & 0x80)) || (page === 4 && (bank2 & 0x80)) || (page === 5 && (bank3 & 0x80))) return 1;
        }
        if (!wrt) {
            if (page === 2 && (modeA & 0x40) === 0) return 1;                                                   // 4000-5FFF (R/-, SCC)
            if (page === 3) return 1;                                                                           // 6000-7FFF (R/-, SCC)
            if (page === 4 && !decSccA) return 1;                                                               // 8000-9FFF (R/-, SCC)
            if (page === 5 && (modeA & 0x40) === 0 && !decSccB) return 1;                                       // A000-BFFF (R/-, SCC)
        }
        if (modeA & 0x10) {                                                                                     // ESCC-RAM
            if (page === 2 || (page === 3 && !dec1FFE)) return 1;
        }
        if (modeB & 0x10) {                                                                                     // SNATCHER
            if (page === 2 || page === 3 || page === 4 || (page === 5 && !dec1FFE)) return 1;
        }
        return 0;
    }

    function ramAddress(address, wrt) {
        var b;
        switch (address >> 13) {
            case 2: b = bank0; break;
            case 3: b = bank1; break;
            case 4: b = bank2; break;
            default: b = bank3;
        }
        var anyWriteBank = ((bank0 | bank2 | bank3) & 0x80) !== 0;

        // Extended RAM address
        var a21 = 0;
        if (mapsel === 3 && xmrEna && !(anyWriteBank && wrt)) a21 = (address & 0x4000) ? (bank0 >> 7) : (bank2 >> 7);

        var a20;
        if (!xmrEna && mapsel === 1) a20 = 0;
        else if (anyWriteBank && wrt && mapsel === 1) a20 = 0;
        else if (mapsel === 3) a20 = (address & 0x4000) ? bankL : bankH;
        else a20 = b >> 7;

        return (a21 << 21) | (a20 << 20) | ((b & 0x7f) << 13) | (address & 0x1fff);
    }

    function connectSCC() {
        scc.connectAudio();
        sccConnected = true;
    }


    var machine;

    var ram, ramMask;
    var scc;
    var sccConnected = false;

    var mapsel = 0;
    var xmrEna = false;
    var linear = false;

    var bankL = 0, bankH = 0;
    var bank0 = 0, bank1 = 1, bank2 = 2, bank3 = 3;
    var modeA = 0, modeB = 0;

    this.format = wmsx.SlotFormats.Empty;      // Not saved as a regular Slot. Savestate handled by the OCM Switched I/O device


    // Savestate  -------------------------------------------

    this.saveState = function() {
        return {
            r: wmsx.Util.compressInt8BitArrayToStringBase64(ram),
            ms: mapsel, x: xmrEna, l: linear,
            bl: bankL, bh: bankH,
            b0: bank0, b1: bank1, b2: bank2, b3: bank3,
            ma: modeA, mb: modeB,
            scc: scc.saveState(),
            scn: sccConnected
        };
    };

    this.loadState = function(s) {
        ram = wmsx.Util.uncompressStringBase64ToInt8BitArray(s.r, ram);
        mapsel = s.ms; xmrEna = s.x; linear = s.l;
        bankL = s.bl; bankH = s.bh;
        bank0 = s.b0; bank1 = s.b1; bank2 = s.b2; bank3 = s.b3;
        modeA = s.ma; modeB = s.mb;
        scc.loadState(s.scc);
        scc.setSCCIMode((modeB & 0x20) !== 0);
        sccConnected = s.scn;
        if (sccConnected) connectSCC();
    };


    init(this);

};

wmsx.SlotOCMESESCC.prototype = wmsx.Slot.base;
