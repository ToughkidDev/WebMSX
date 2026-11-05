// Based on swioports.vhd, Switched I/O ports ($40-$4F) MSX++ 1st Gen, Revision 12
// Copyright (c) 2011-2025 KdL
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

// MSX++ (OCM-PLD) Switched I/O Ports ($40-$4F) Revision 12. Ported from the OCM-PLD swioports.vhd (Copyright (c) 2011-2025 KdL)
// Device ID $D4 (MSX++ Computers and Compatibles) and ID $08 (MSX2+ FS-A1 Series Turbo 5.37MHz), with the 1chipMSX behavior
// All registers, Smart Commands, Lock Masks and Reset rules follow the OCM-PLD logic. Their effects are applied to the emulated machine:
// CPU Clock (3.58MHz, Turbo Pana 5.37MHz, Custom Speeds 4.10MHz to 8.06MHz), VDP Speed, Internal Audio Mixer (Master, PSG, SCC-I, OPLL),
// Internal SCC-I / ASCII-8K / ASCII-16K Slots (ESE-SCC), Linear modes, Extended MegaROM Reading, NTSC/PAL, Mapper Size, MegaSD, Cold and Warm Resets
// Settings without an emulated counterpart (Video Output, Scanlines, Leds, Keyboard Layout, etc.) only keep their states
// Physical DIP-SW are fixed by the OCM_DIP_SW parameter. Toggle keys (F12, PRTSCR, PGUP/PGDOWN, F9-F11, SCRLK) are not emulated

wmsx.OCMSwitchedIO = function(machine) {
"use strict";

    var self = this;

    this.setActive = function(state) {
        state = !!state;
        if (active === state) return;
        active = state;
        var bus = machine.bus;
        if (active) {
            bus.connectSwitchedDevice(0x08, deviceID008);
            bus.connectSwitchedDevice(0xd4, deviceID212);
            machine.getAudioSocket().setVolumeFactorProvider(volumeFactor);
            powerOnStates();
            coldResetStates();
            applyStates();
        } else {
            bus.disconnectSwitchedDevice(0x08, deviceID008);
            bus.disconnectSwitchedDevice(0xd4, deviceID212);
            bus.setSlotOverride(1, null);
            bus.setSlotOverride(2, null);
            machine.getAudioSocket().setVolumeFactorProvider(null);
            resetPending = 0;
        }
    };

    this.isActive = function() {
        return active;
    };

    this.powerOn = function() {
        if (!active) return;
        powerOnStates();
        scc1.powerOn();
        scc2.powerOn();
    };

    this.powerOff = function() {
        if (!active) return;
        scc1.powerOff();
        scc2.powerOff();
    };

    // Called by every Machine Reset. Warm Reset if requested by a Smart Command, otherwise Cold Reset
    this.reset = function(fromState) {
        if (!active || fromState) return;

        var warm = resetPending === RESET_WARM;
        resetPending = 0;
        if (warm) warmResetStates(); else coldResetStates();
        warmMSXlogo = portF4Mode;                   // End of Warm Reset cycle
        scc1.reset();
        scc2.reset();
        applyStates();
        applyHardwareConfig();
    };

    // Perform requested Resets at frame boundaries
    this.videoClockPulse = function() {
        if (!resetPending) return;
        machine.reset();
    };

    this.getZ80ClockMulti = function() {
        if (io42 & 0x01) return CUSTOM_SPEED_MULTI[customSpeed] || CUSTOM_SPEED_MULTI[2];      // Custom Speed
        if (!io41Id008N) return 1.5;                                                            // Turbo Pana 5.37MHz
        return 1;                                                                               // Standard 3.58MHz
    };

    this.isVDPFast = function() {
        return vdpSpeedMode === 1;
    };


    // ID $08: MSX2+ FS-A1 Series Turbo 5.37MHz

    var deviceID008 = {
        switchedPortInput: function(port) {
            switch (port) {
                case 0x41: return 0xfa | io41Id008N;
                case 0x43: return 0x00;
                default:   return 0xff;
            }
        },
        switchedPortOutput: function(val, port) {
            if (port !== 0x41) return;
            if (!tPanaRedir) {
                io41Id008N = val & 1;                   // 3.58MHz  >>      << 5.37MHz
                io42 &= ~0x01;                          // 5.37MHz have priority over 3.58MHz
            } else {
                io41Id008N = 1;                         // Custom Speed
                io42 = (io42 & ~0x01) | (~val & 0x01);
            }
            applyStates();
        }
    };


    // ID $D4: MSX++ Computers and Compatibles

    var deviceID212 = {
        switchedPortInput: function(port) {
            switch (port) {
                case 0x41: return io41Id212N;
                case 0x42: return io42;
                case 0x43: return io43;
                case 0x44: return io44;
                case 0x45: return ((mstrVol === 7) << 7) | ((~mstrVol & 7) << 4) | ((psgVol === 0) << 3) | psgVol;
                case 0x46: return ((sccVol === 0) << 7) | (sccVol << 4) | ((opllVol === 0) << 3) | opllVol;
                case 0x47: return (megaSDReq << 7) | (mapperReq << 6) | (vdpSpeedMode << 5) | (tPanaRedir << 4) | (tMegaSD << 3) | ((1 - (customSpeed & 7)) & 7);
                case 0x48: return (blinkEna << 7) | (resetRequired() << 6) | (lastRstAck << 5) | (redState() << 4) | (lightsMode << 3) | (swioCmt << 2) | (swioKmap << 1) | (io41Id008N ^ 1);
                case 0x49: return (forcedVMode << 7) | (ntscPalType << 6) | (MACHINE_ID << 2) | (extclk3m << 1) | pseudoStereo;
                case 0x4a: return (iSlt2Linear << 7) | (iSlt1Linear << 6) | (legacySel << 5) | ((centerYJKR25N ^ 1) << 4) | (((~ratioMode + 1) & 7) << 1) | rightInverse;
                case 0x4b:
                    switch (io44) {        // Dynamic Port 4B
                        case 0x00: return (slot0Req << 7) | (mapper0Req << 6) | (biosReloadReq << 5) | (SDR_SIZE << 3) | (iPsg2Ena << 2) | vgaScanlines;
                        case 0x01: return (((offsetY - 12) & 0x0f) << 4) | (SDR_SIZE_AUX << 1) | xmrEna;
                        case 0x02: return (portF2Ena << 7) | (safeMode << 6) | (slot0Mode << 5) | (mapper0Ack << 4) | (cbiosMode << 3) | (LOW_SCALE_N << 2) | (vgaIntField << 1) | spMaxSpr;
                        default:   return 0xff;
                    }
                case 0x4c: return ffDipReq;
                case 0x4d: return vramSlotIds;
                case 0x4e: return OCM_PLD_XY;
                case 0x4f: return (DEF_KMAP << 7) | (OCM_PLD_Z << 5) | SWIO_REV;
                default:   return 0xff;
            }
        },
        switchedPortOutput: function(val, port) {
            switch (port) {
                case 0x41:
                    smartCommand(val);
                    break;
                case 0x42:                                      // Virtual DIP-SW (always unlocked)
                    io41Id008N = 1;                             // Custom Speed takes priority over 5.37MHz
                    io42 = (io42 & 0xc0) | (~val & 0x3f);
                    mapperReq = (~val >> 6) & 1;
                    megaSDReq = (~val >> 7) & 1;
                    iSlt1Linear = iSlt2Linear = 0;
                    break;
                case 0x43:                                      // Lock Mask
                    io43 = ~val & 0xff;
                    break;
                case 0x44:                                      // Green Leds Mask / Dynamic ID
                    io44 = ~val & 0xff;
                    break;
                case 0x45:                                      // Master / PSG Volume
                    psgVol = ~val & 7;
                    mstrVol = (val >> 4) & 7;
                    break;
                case 0x46:                                      // SCC-I / OPLL Volume
                    opllVol = ~val & 7;
                    sccVol = (~val >> 4) & 7;
                    break;
                case 0x4d:                                      // VRAM Slot IDs
                    vramSlotIds = ~val & 0xff;
                    break;
                // Ports $4C, $4E and $4F are Reserved for IPL-ROM
            }
            applyStates();
        }
    };

    function smartCommand(val) {
        io41Id212N = ~val & 0xff;

        // Custom Speeds
        if (val >= 0x04 && val <= 0x0a) {
            io41Id008N = 1;
            io42 |= 0x01;
            customSpeed = 0x0c - val;
            return;
        }
        // Internal Slots presets
        if (val >= 0x0d && val <= 0x14) {
            io42 = (io42 & ~0x38) | ((val - 0x0d) << 3);
            iSlt1Linear = iSlt2Linear = 0;
            return;
        }
        // Vertical Offsets 16 - 24
        if (val >= 0x47 && val <= 0x4f) {
            offsetY = val - 0x47 + 16;
            return;
        }
        // Master, PSG, SCC-I and OPLL Volumes
        if (val >= 0xb0 && val <= 0xb7) { mstrVol = 0xb7 - val; return; }
        if (val >= 0xb8 && val <= 0xbf) { psgVol =  val - 0xb8; return; }
        if (val >= 0xc0 && val <= 0xc7) { sccVol =  val - 0xc0; return; }
        if (val >= 0xc8 && val <= 0xcf) { opllVol = val - 0xc8; return; }

        switch (val) {
            case 0x01: tPanaRedir = 0; break;                                       // Turbo Pana Redirection OFF
            case 0x02: tPanaRedir = 1; break;                                       // Turbo Pana Redirection ON
            case 0x03: io41Id008N = 1; io42 &= ~0x01; break;                        // Standard Speed 3.58MHz
            case 0x0b: tMegaSD = 0; break;                                          // Turbo MegaSD OFF
            case 0x0c: tMegaSD = 1; break;                                          // Turbo MegaSD ON
            case 0x15: swioKmap = 0; break;                                         // Japanese Keyboard Layout
            case 0x16: swioKmap = 1; break;                                         // Non-Japanese Keyboard Layout
            case 0x17: io42 = (io42 & ~0x06) | 0x00; break;                         // Display Mode 15KHz Composite/S-Video
            case 0x18: io42 = (io42 & ~0x06) | 0x02; break;                         // Display Mode 15KHz RGB
            case 0x19: io42 = (io42 & ~0x06) | 0x04; break;                         // Display Mode 31KHz VGA
            case 0x1a: io42 = (io42 & ~0x06) | 0x06; break;                         // Display Mode 31KHz VGA+
            case 0x1b: vdpSpeedMode = 0; break;                                     // VDP Normal Mode
            case 0x1c: vdpSpeedMode = V9938_N; break;                               // VDP Fast Mode (V9958 only)
            case 0x1d: megaSDReq = 0; break;                                        // Reserve MegaSD OFF (warm reset to go)
            case 0x1e: megaSDReq = 1; break;                                        // Reserve MegaSD ON (warm reset to go)
            case 0x1f: blinkEna = 0; break;                                         // MegaSD Blink OFF
            case 0x20: blinkEna = 1; break;                                         // MegaSD Blink ON
            case 0x21: lightsMode = 0; break;                                       // Lights Mode OFF with Auto LEDs Control
            case 0x22: lightsMode = 1; redSta = 0; break;                           // Lights Mode ON + Red Led OFF
            case 0x23: lightsMode = 1; redSta = 1; break;                           // Lights Mode ON + Red Led ON
            case 0x24: setVolumes(4, 4, 4, 7); break;                               // Internal Audio Preset #1 "Mute Sound"
            case 0x25: setVolumes(4, 4, 4, 3); break;                               // Internal Audio Preset #2 "Middle Sound"
            case 0x26: setVolumes(4, 4, 4, 0); break;                               // Internal Audio Preset #3 "High Sound"
            case 0x27: if (portF4Mode === 0) swioCmt = 0; else io41Id212N = 0xff; break;     // CMT OFF (MSX turboR does not have CMT)
            case 0x28: if (portF4Mode === 0) swioCmt = 1; else io41Id212N = 0xff; break;     // CMT ON
            case 0x29: io43 |= 0x01; break;                                         // Lock   CPU Clock Toggles
            case 0x2a: io43 &= ~0x01; break;                                        // Unlock CPU Clock Toggles
            case 0x2b: io43 |= 0x02; break;                                         // Lock   Video Output Toggles
            case 0x2c: io43 &= ~0x02; break;                                        // Unlock Video Output Toggles
            case 0x2d: io43 |= 0x04; break;                                         // Lock   Audio Mixer & SCRLK Toggles
            case 0x2e: io43 &= ~0x04; break;                                        // Unlock Audio Mixer & SCRLK Toggles
            case 0x2f: io43 |= 0x08; break;                                         // Lock   Slot-1 Toggles
            case 0x30: io43 &= ~0x08; break;                                        // Unlock Slot-1 Toggles
            case 0x31: io43 |= 0x10; break;                                         // Lock   Slot-2 Toggles
            case 0x32: io43 &= ~0x10; break;                                        // Unlock Slot-2 Toggles
            case 0x33: io43 |= 0x18; break;                                         // Lock   Slot-1 & Slot-2 Toggles
            case 0x34: io43 &= ~0x18; break;                                        // Unlock Slot-1 & Slot-2 Toggles
            case 0x35: io43 |= 0x20; break;                                         // Lock   System Reset
            case 0x36: io43 &= ~0x20; break;                                        // Unlock System Reset
            case 0x37: io43 |= 0x40; break;                                         // Lock   Internal Mapper Toggle
            case 0x38: io43 &= ~0x40; break;                                        // Unlock Internal Mapper Toggle
            case 0x39: io43 |= 0x80; break;                                         // Lock   Internal MegaSD Toggle
            case 0x3a: io43 &= ~0x80; break;                                        // Unlock Internal MegaSD Toggle
            case 0x3b: io43 = 0xff; break;                                          // Lock   All Toggles
            case 0x3c: io43 = 0x00; break;                                          // Unlock All Toggles
            case 0x3d: pseudoStereo = 0; break;                                     // Pseudo-Stereo OFF
            case 0x3e: pseudoStereo = 1; break;                                     // Pseudo-Stereo ON
            case 0x3f: extclk3m = 0; break;                                         // Sync External Bus Clock to CPU Speed
            case 0x40:                                                              // External Bus Clock 3.58MHz
                extclk3m = 1;
                if (io42 & 0x01) { io41Id008N = 0; io42 &= ~0x01; }
                break;
            case 0x41: io41Id008N = 0; io42 &= ~0x01; break;                        // Turbo Pana 5.37MHz
            case 0x42: rightInverse = 0; break;                                     // Right Inverse Audio OFF
            case 0x43: rightInverse = 1; break;                                     // Right Inverse Audio ON
            case 0x44: setVolumes(5, 3, 3, 0); break;                               // Internal Audio Preset #4 "Emphasis PSG Sound"
            case 0x45: setVolumes(3, 5, 3, 0); break;                               // Internal Audio Preset #5 "Emphasis SCC-I Sound"
            case 0x46: setVolumes(3, 3, 5, 0); break;                               // Internal Audio Preset #6 "Emphasis OPLL Sound"
            case 0x50: case 0x51: case 0x52: case 0x53:
                vgaScanlines = val - 0x50; break;                                   // VGA Scanlines None, Light, Medium, Heavy
            case 0x56: if (SDR_SIZE !== 0) mapper0Req = 0; else io41Id212N = 0xff; break;    // Reserve Extra-Mapper 4096KB OFF
            case 0x57: if (SDR_SIZE !== 0) mapper0Req = 1; else io41Id212N = 0xff; break;    // Reserve Extra-Mapper 4096KB ON
            case 0x58: xmrEna = 0; break;                                           // Extended MegaROM Reading OFF
            case 0x59: xmrEna = 1; break;                                           // Extended MegaROM Reading ON
            case 0x5a: spMaxSpr = 0; break;                                         // Sprite Limit 4/8
            case 0x5b: spMaxSpr = 1; break;                                         // Sprite Limit 8/8
            case 0x5c: vgaIntField = 0; break;                                      // VGA Interlace Single Field
            case 0x5d: vgaIntField = 1; break;                                      // VGA Interlace Duplicate Field
            case 0x7e: warmMSXlogo = portF4Mode ^ 1; break;                         // Reserve System Logo ON (after a warm reset)
            case 0x7f: ratioMode = (ratioMode - 1) & 7; break;                      // Pixel Ratio 1:1 for LED Display
            case 0x80: break;                                                       // Null Command $80
            case 0x81: legacySel = 0; break;                                        // Assign Legacy Output to VGA
            case 0x82: legacySel = 1; break;                                        // Assign Legacy Output to VGA+
            case 0x83: iSlt1Linear = 0; break;                                      // Internal Slot-1 Linear OFF
            case 0x84: iSlt1Linear = (io42 >> 3) & 1; break;                        // Internal Slot-1 Linear ON (requires SCC-I preset)
            case 0x85: iSlt2Linear = 0; break;                                      // Internal Slot-2 Linear OFF
            case 0x86: iSlt2Linear = (io42 & 0x30) ? 1 : 0; break;                  // Internal Slot-2 Linear ON (requires SCC-I or ASCII preset)
            case 0xd0: ntscPalType = 0; forcedVMode = 0; break;                     // Force NTSC Mode
            case 0xd1: ntscPalType = 1; break;                                      // Standard NTSC/PAL Mode
            case 0xd2: ntscPalType = 0; forcedVMode = 1; break;                     // Force PAL Mode
            case 0xd3: swioKmap = DEF_KMAP; break;                                  // Restore Default Keyboard Layout
            case 0xd4: break;                                                       // Null Command $D4 (C-BIOS Mode only via IPL-ROM)
            case 0xd5:                                                              // Restore Default Turbo Modes
                io42 = (io42 & ~0x01) | (ffDipReq & 0x01);
                ffDipAck = (ffDipAck & ~0x01) | (ffDipReq & 0x01);
                customSpeed = 2;
                tMegaSD = 1;
                tPanaRedir = 0;
                io41Id008N = 1;
                extclk3m = 0;
                break;
            case 0xd6: centerYJKR25N = 1; break;                                    // Centering YJK Modes/R25 Mask OFF
            case 0xd7: centerYJKR25N = 0; break;                                    // Centering YJK Modes/R25 Mask ON
            case 0xf8: biosReloadReq = 1; break;                                    // Reserve OCM-BIOS Reloading
            case 0xf9: slot0Req = 0; break;                                         // Reserve Slot-0 Primary Mode (warm reset to go)
            case 0xfa: slot0Req = 1; break;                                         // Reserve Slot-0 Expanded Mode (warm reset to go)
            case 0xfb: requestReset(RESET_COLD); break;                             // Cold Reset
            case 0xfc: mapperReq = 0; requestReset(RESET_WARM); break;              // Warm Reset with Mapper 2048KB
            case 0xfd: requestReset(RESET_WARM); break;                             // Warm Reset
            case 0xfe: mapperReq = 1; requestReset(RESET_WARM); break;              // Warm Reset with Mapper 4096KB
            case 0xff: restoreAllDefaults(); break;                                 // Restore All Defaults + Reserve Default Mapper & MegaSD
            default:   io41Id212N = 0xff;                                           // Not available
        }
    }

    function setVolumes(psg, scc, opll, mstrInv) {
        psgVol = psg; sccVol = scc; opllVol = opll; mstrVol = mstrInv;
    }

    function requestReset(type) {
        if (type === RESET_WARM || !resetPending) resetPending = type;
    }

    function restoreAllDefaults() {
        ratioMode = 0;
        biosReloadReq = 0;
        io42 = (io42 & 0xc0) | (ffDipReq & 0x3f);
        ffDipAck = (ffDipAck & 0xc0) | (ffDipReq & 0x3f);
        io43 = 0x00;
        io44 = 0x00;
        setVolumes(4, 4, 4, 0);
        customSpeed = 2;
        tMegaSD = 1;
        tPanaRedir = 0;
        vdpSpeedMode = 0;
        mapperReq = (ffDipReq >> 6) & 1;
        megaSDReq = (ffDipReq >> 7) & 1;
        io41Id008N = 1;
        swioKmap = DEF_KMAP;
        swioCmt = 0;
        lightsMode = 0;
        blinkEna = 1;
        pseudoStereo = 0;
        extclk3m = 0;
        ntscPalType = 1;
        forcedVMode = 0;
        rightInverse = 0;
        centerYJKR25N = 1;
        legacySel = 1;
        iSlt1Linear = iSlt2Linear = 0;
        vgaScanlines = 0;
        iPsg2Ena = 0;
        mapper0Req = 0;
        slot0Req = 1;
        xmrEna = 0;
        offsetY = 19;
        spMaxSpr = 0;
        vgaIntField = 0;
        portF2Ena = USE_WIFI;
    }

    function resetRequired() {
        return (mapperReq !== ((io42 >> 6) & 1) || megaSDReq !== ((io42 >> 7) & 1) || slot0Req !== slot0Mode || mapper0Req !== mapper0Ack) ? 1 : 0;
    }

    function redState() {
        return lightsMode ? redSta : io41Id008N ^ 1;        // Red Led is Turbo 5.37MHz in Auto mode
    }

    function powerOnStates() {
        io41Id212N = 0x00;                  // Smart Commands will be zero at 1st boot
        vgaScanlines = 0;
        vdpId = 2;                          // Default VDP ID (V9958)
        jis2Ena = 1;
        portF4Mode = 0;                     // MSX2+ BIOS
        warmMSXlogo = 0;
        ffDipReq = WMSX.OCM_DIP_SW & 0xff;
    }

    function resetStates() {
        ratioMode = 0;
        biosReloadReq = 0;
        cbiosMode = 0;
        vramSlotIds = 0x10;
    }

    function coldResetStates() {
        resetStates();
        io42 = ffDipReq;                    // Virtual DIP-SW are DIP-SW
        ffDipAck = ffDipReq;
        io43 = 0x00;                        // Lock Mask is Full Unlocked
        io44 = 0x00;                        // Lights Mask is Full Off / d-ID = $00
        setVolumes(4, 4, 4, 0);
        customSpeed = 2;                    // Custom Speed #7 (aka "Turbo 10MHz")
        tMegaSD = 1;
        tPanaRedir = 0;
        vdpSpeedMode = 0;
        mapperReq = mapperAck = (ffDipReq >> 6) & 1;
        megaSDReq = megaSDAck = (ffDipReq >> 7) & 1;
        io41Id008N = 1;                     // CPU Clock is 3.58MHz
        swioKmap = DEF_KMAP;
        swioCmt = 0;
        lightsMode = 0;
        redSta = 0;
        lastRstSta = portF4Mode;
        lastRstAck = 0;                     // Cold Reset ack
        blinkEna = 1;
        pseudoStereo = 0;
        extclk3m = 0;
        ntscPalType = 1;
        forcedVMode = 0;
        rightInverse = 0;
        centerYJKR25N = 1;
        legacySel = 1;
        iSlt1Linear = iSlt2Linear = 0;
        iPsg2Ena = 0;
        mapper0Req = 0;
        slot0Req = 1;
        xmrEna = 0;
        offsetY = 19;
        spMaxSpr = 0;
        vgaIntField = 0;
        mapper0Ack = 0;
        slot0Mode = 1;
        safeMode = 0;
        portF2Ena = USE_WIFI;
    }

    function warmResetStates() {
        resetStates();
        io42 = (io42 & 0x3f) | (mapperReq << 6) | (megaSDReq << 7);     // Set Mapper and MegaSD states to last required
        mapperAck = mapperReq;
        megaSDAck = megaSDReq;
        lastRstSta = warmMSXlogo ^ 1;
        lastRstAck = 1;                     // Warm Reset ack
        mapper0Ack = mapper0Req;
        slot0Mode = slot0Req;
    }

    // Apply the states to the emulated machine
    function applyStates() {
        if (!active) return;

        machine.turboModesUpdate();         // CPU Clock and VDP Speed
        machine.getAudioSocket().refreshVolumeFactors();

        // Internal Slots
        var bus = machine.bus;
        var slot1Internal = (io42 & 0x08) !== 0;
        var slot2Mode = (((io42 >> 4) & 1) << 1) | ((io42 >> 5) & 1);          // 0: External, 1: ASCII-8K, 2: SCC+, 3: ASCII-16K
        scc1.setMapperType(2);
        scc1.setLinear(iSlt1Linear);
        scc2.setMapperType(slot2Mode);
        scc2.setExtendedMegaROMReading(xmrEna);
        scc2.setLinear(iSlt2Linear);
        bus.setSlotOverride(1, slot1Internal ? scc1 : null);
        bus.setSlotOverride(2, slot2Mode ? scc2 : null);

        // NTSC/PAL
        var videoMode = ntscPalType ? -1 : forcedVMode;
        if (videoMode !== appliedVideoMode) {
            appliedVideoMode = videoMode;
            machine.setVideoStandardMode(videoMode < 0 ? null : videoMode ? wmsx.VideoStandard.PAL : wmsx.VideoStandard.NTSC);
        }
    }

    // Internal Mapper size and MegaSD follow their acknowledged states. Machine is reset again if they change
    // Internal MegaSD is the OCM MegaSD Extension with the OCM-SDBIOS, otherwise the Hard Drive Extension (Nextor) at Slot 3-2
    function applyHardwareConfig() {
        var mapperSize = mapperAck ? 4096 : 2048;
        var ext = WMSX.EXTENSIONS_CONFIG.OCMMEGASD.URL ? "OCMMEGASD" : "HARDDISK";
        var megaSD = megaSDAck ? (ext === "HARDDISK" ? 2 : 1) : 0;
        if (WMSX.RAMMAPPER_SIZE === mapperSize && (WMSX.EXTENSIONS[ext] || 0) === megaSD) return;

        var extensionsSocket = machine.getExtensionsSocket();
        if (WMSX.RAMMAPPER_SIZE !== mapperSize) {
            WMSX.RAMMAPPER_SIZE = mapperSize;
            machine.getSlotSocket().insertSlot(null, WMSX.EXTENSIONS_CONFIG.RAMMAPPER.SLOT, true, true);       // Removed, will be recreated with new size
        }
        WMSX.EXTENSIONS[ext] = megaSD;
        var wasPaused = machine.systemPause(true);
        extensionsSocket.refreshSlotsFromConfig(function() {
            if (!wasPaused) machine.systemPause(false);
            resetPending = RESET_WARM;
            machine.reset();
        });
    }

    // Internal Audio Mixer. Relative volumes as the OCM-PLD amplitude ramps
    function volumeFactor(signalName) {
        switch (signalName) {
            case "PSG":                 return mixerGain(psgVol, 1) / mixerGain(4, 1);
            case "MSX-MUSIC":           return mixerGain(opllVol, 0) / mixerGain(4, 0);
            case SCC1_NAME:
            case SCC2_NAME:             return mixerGain(sccVol, 0) / mixerGain(4, 0);
            default:                    return 1;       // External cartridges are not affected
        }
    }

    function mixerGain(vol, xThrd) {
        if (vol === 0 || mstrVol === 7) return 0;
        var c = 8 + vol - mstrVol;
        if (c > 12) return vol - mstrVol - 1 + xThrd;
        if (c > 9 - xThrd) return (vol - mstrVol + 2 + xThrd) / 2;
        return (vol - mstrVol + 6 + xThrd) / 4;
    }


    var active = false;
    var resetPending = 0;
    var appliedVideoMode = -2;

    var SCC1_NAME = "SCC-I (Internal Slot-1)", SCC2_NAME = "SCC-I (Internal Slot-2)";
    var scc1 = new wmsx.SlotOCMESESCC(SCC1_NAME, 2048);         // ESE-SCC1: 2048 KB
    var scc2 = new wmsx.SlotOCMESESCC(SCC2_NAME, 4096);         // ESE-SCC2: 4096 KB with Extended MegaROM Reading

    // Registers and states. Names as the OCM-PLD signals
    var io41Id212N = 0, io42 = 0, io43 = 0, io44 = 0;
    var psgVol = 4, mstrVol = 0, opllVol = 4, sccVol = 4;           // mstrVol is inverted: 0 = max
    var customSpeed = 2, tMegaSD = 1, tPanaRedir = 0, vdpSpeedMode = 0;
    var mapperReq = 0, mapperAck = 0, megaSDReq = 1, megaSDAck = 1;
    var io41Id008N = 1, swioKmap = 0, swioCmt = 0, lightsMode = 0, redSta = 0;
    var lastRstSta = 0, lastRstAck = 0, blinkEna = 1;
    var pseudoStereo = 0, extclk3m = 0, ntscPalType = 1, forcedVMode = 0;
    var rightInverse = 0, ratioMode = 0, centerYJKR25N = 1, legacySel = 1, iSlt1Linear = 0, iSlt2Linear = 0;
    var vgaScanlines = 0, iPsg2Ena = 0, biosReloadReq = 0, mapper0Req = 0, slot0Req = 1;
    var xmrEna = 0, offsetY = 19;
    var spMaxSpr = 0, vgaIntField = 0, cbiosMode = 0, mapper0Ack = 0, slot0Mode = 1, safeMode = 0, portF2Ena = 0;
    var ffDipReq = 0x80, ffDipAck = 0x80;
    var vramSlotIds = 0x10, vdpId = 2, jis2Ena = 1, portF4Mode = 0, warmMSXlogo = 0;

    var RESET_COLD = 1, RESET_WARM = 2;

    var MACHINE_ID = 0;                 // 1chipMSX
    var OCM_PLD_XY = 39;                // OCM-PLD version 3.9
    var OCM_PLD_Z = 2;                  //                    .2
    var SWIO_REV = 12;                  // Switched I/O ports Revision 12
    var SDR_SIZE = 2;                   // 32 MB SDRAM
    var SDR_SIZE_AUX = 7;               // n/a
    var LOW_SCALE_N = 0;
    var V9938_N = 1;                    // TH9958 VDP core
    var DEF_KMAP = 0;                   // Default Keyboard Layout: Japanese (Japanese BIOS)
    var USE_WIFI = 0;

    var CUSTOM_SPEED_MULTI = [];        // Custom Speeds simulated by a slowdown of CPU Clock 10.74MHz
    CUSTOM_SPEED_MULTI[8] = 4.10 / 3.579545;
    CUSTOM_SPEED_MULTI[7] = 4.48 / 3.579545;
    CUSTOM_SPEED_MULTI[6] = 4.90 / 3.579545;
    CUSTOM_SPEED_MULTI[5] = 5.39 / 3.579545;
    CUSTOM_SPEED_MULTI[4] = 6.10 / 3.579545;
    CUSTOM_SPEED_MULTI[3] = 6.96 / 3.579545;
    CUSTOM_SPEED_MULTI[2] = 8.06 / 3.579545;


    // Savestate  -------------------------------------------

    this.saveState = function() {
        if (!active) return null;
        return {
            r: [ io41Id212N, io42, io43, io44, psgVol, mstrVol, opllVol, sccVol, customSpeed, tMegaSD, tPanaRedir, vdpSpeedMode,
                 mapperReq, mapperAck, megaSDReq, megaSDAck, io41Id008N, swioKmap, swioCmt, lightsMode, redSta, lastRstSta, lastRstAck, blinkEna,
                 pseudoStereo, extclk3m, ntscPalType, forcedVMode, rightInverse, ratioMode, centerYJKR25N, legacySel, iSlt1Linear, iSlt2Linear,
                 vgaScanlines, iPsg2Ena, biosReloadReq, mapper0Req, slot0Req, xmrEna, offsetY, spMaxSpr, vgaIntField, cbiosMode, mapper0Ack,
                 slot0Mode, safeMode, portF2Ena, ffDipReq, ffDipAck, vramSlotIds, vdpId, jis2Ena, portF4Mode, warmMSXlogo ],
            s1: scc1.saveState(),
            s2: scc2.saveState(),
            rp: resetPending
        };
    };

    this.loadState = function(s) {
        if (!s || !active) return;
        var r = s.r, i = 0;
        io41Id212N = r[i++]; io42 = r[i++]; io43 = r[i++]; io44 = r[i++]; psgVol = r[i++]; mstrVol = r[i++]; opllVol = r[i++]; sccVol = r[i++];
        customSpeed = r[i++]; tMegaSD = r[i++]; tPanaRedir = r[i++]; vdpSpeedMode = r[i++];
        mapperReq = r[i++]; mapperAck = r[i++]; megaSDReq = r[i++]; megaSDAck = r[i++]; io41Id008N = r[i++]; swioKmap = r[i++]; swioCmt = r[i++];
        lightsMode = r[i++]; redSta = r[i++]; lastRstSta = r[i++]; lastRstAck = r[i++]; blinkEna = r[i++];
        pseudoStereo = r[i++]; extclk3m = r[i++]; ntscPalType = r[i++]; forcedVMode = r[i++]; rightInverse = r[i++]; ratioMode = r[i++];
        centerYJKR25N = r[i++]; legacySel = r[i++]; iSlt1Linear = r[i++]; iSlt2Linear = r[i++];
        vgaScanlines = r[i++]; iPsg2Ena = r[i++]; biosReloadReq = r[i++]; mapper0Req = r[i++]; slot0Req = r[i++]; xmrEna = r[i++]; offsetY = r[i++];
        spMaxSpr = r[i++]; vgaIntField = r[i++]; cbiosMode = r[i++]; mapper0Ack = r[i++];
        slot0Mode = r[i++]; safeMode = r[i++]; portF2Ena = r[i++]; ffDipReq = r[i++]; ffDipAck = r[i++]; vramSlotIds = r[i++]; vdpId = r[i++];
        jis2Ena = r[i++]; portF4Mode = r[i++]; warmMSXlogo = r[i++];
        scc1.loadState(s.s1);
        scc2.loadState(s.s2);
        resetPending = s.rp || 0;
        appliedVideoMode = -2;
        applyStates();
    };

};
