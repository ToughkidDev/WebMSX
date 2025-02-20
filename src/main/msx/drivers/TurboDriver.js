// Copyright 2015 by Paulo Augusto Peccin. See license.txt distributed with this file.

// Turbo Control Driver
// Implements BIOS routines CHGCPU/GETCPU using the CPU extension protocol and the Panasonic MSX2+ Switched I/O Port for 1.5x CPU Turbo

wmsx.TurboDriver = function() {
"use strict";

    var self = this;

    this.connect = function(pBios, pMachine) {
        bios = pBios;
        biosSocket = pMachine.getBIOSSocket();
        machine = pMachine;
        ledsSocket = machine.getLedsSocket();
        this.turboModesUpdate();
    };

    this.disconnect = function(pBios, machine) {
        machine.bus.disconnectSwitchedDevice(0x08, this);
    };

    this.powerOff = function() {
        chgCpuValue = 0;
        softTurboON = false;
        this.turboModesUpdate();
    };

    this.reset = function() {
        if (WMSX.CPU_SOFT_TURBO_AUTO_ON) {
            chgCpuValue = 0x82;
            softTurboON = true;
        } else {
            chgCpuValue = 0;
            softTurboON = false;
        }
        this.turboModesUpdate();
    };

    this.turboModesUpdate = function() {
        if (WMSX.FAKE_TR) patchBIOS(); else unPatchBIOS();
        if (WMSX.FAKE_PANA) machine.bus.connectSwitchedDevice(0x08, this); else machine.bus.disconnectSwitchedDevice(0x08, this);

        var softTurbo = WMSX.FAKE_TR || WMSX.FAKE_PANA;
        var z80Mode = machine.getZ80ClockMode();
        var r800Mode = machine.getR800ClockMode();
        var vdpMode = machine.getVDPClockMode();

        var z80Multi = z80Mode === 0 && softTurbo && softTurboON ? WMSX.Z80_SOFT_TURBO_MULTI : z80Mode > 0 ? z80Mode : 1;
        machine.cpu.setZ80ClockMulti(z80Multi);
        machine.cpu.setR800ClockMulti(r800Mode);
        machine.vdp.setVDPTurboMulti(vdpMode === 0 && softTurbo && softTurboON ? WMSX.VDP_SOFT_TURBO_MULTI : vdpMode > 0 ? vdpMode : 1);

        var r800Multi = machine.cpu.getR800ClockMulti();
        ledsSocket.ledStateChanged(2, z80Multi !== 1);
        ledsSocket.ledInfoChanged(2, "" + z80Multi + "x");
        ledsSocket.ledInfoChanged(3, r800Multi !== 1 ? "" + r800Multi + "x" : "");

        // console.log("TurboDriver modes update. z80Multi:", z80Multi);
    };

    this.cpuExtensionBegin = function(s) {
        if (machine.machineType <= 1) return;           // Only for >= MSX2. Defensive
        switch (s.extNum) {
            case 0xee:
                return CHGCPU(s.A);
            case 0xef:
                return GETCPU();
        }
    };

    this.cpuExtensionFinish = function(s) {
        // No Finish operation
    };

    function patchBIOS() {
        var bytes = bios.bytes;

        if (bytes[0x190] === 0xed) return;      // already patched

        // CHGCPU routine JUMP
        bytes[0x0180] = 0xc3;
        bytes[0x0181] = 0x8d;
        bytes[0x0182] = 0x01;

        // GETCPU routine JUMP
        bytes[0x0183] = 0xc3;
        bytes[0x0184] = 0x90;
        bytes[0x0185] = 0x01;

        // CHGCPU routine (EXT e)
        bytes[0x018d] = 0xed;
        bytes[0x018e] = 0xee;
        bytes[0x018f] = 0xc9;

        // GETCPU routine (EXT f)
        bytes[0x0190] = 0xed;
        bytes[0x0191] = 0xef;
        bytes[0x0192] = 0xc9;

        // console.log("Turbo BIOS Patched");
    }

    function unPatchBIOS() {
        var bytes = bios.bytes;
        if (bytes[0x190] !== 0xed) return;      // already un-patched

        bytes[0x0180] = bytes[0x0181] = bytes[0x0182] =
        bytes[0x0183] = bytes[0x0184] = bytes[0x0185] =
        bytes[0x018d] = bytes[0x018e] = bytes[0x018f] =
        bytes[0x0190] = bytes[0x0191] = bytes[0x0192] = 0xc9;

        // console.log("Turbo BIOS UN-Patched");
    }

    function CHGCPU(A) {
        // console.log("CHGCPU: " + A.toString(16));

        chgCpuValue = A & 0x83;
        var newSoftON = (chgCpuValue & 0x03) > 0;
        if (softTurboON === newSoftON) return;

        softTurboON = newSoftON;

        if (machine.getZ80ClockMode() === 0) {
            self.turboModesUpdate();
            machine.showZ80ClockModeMessage();
        } else
            machine.showOSD("Could not set Z80 Turbo by software: mode is FORCED " + machine.getZ80ClockModeDesc(), true, true);
    }

    function GETCPU() {
        var res = chgCpuValue & 0x03;

        // console.log("GETCPU : " + res.toString(16));

        return { A: res };
    }

    this.switchedPortInput = function (port) {
        if (port !== 0x41) return 0xff;     // Only Panasonic MSX2+ Turbo port

        var res = softTurboON ? 0x00 : 0x01;

        // console.log("PANA Turbo read: " + res.toString(16));

        return res;
    };

    this.switchedPortOutput = function (val, port) {
        if (port !== 0x41) return;          // Only Panasonic MSX2+ Turbo port

        // console.log("PANA Turbo write: " + val.toString(16));

        CHGCPU((val & 0x01) === 0 ? 0x81 : 0x00);
    };


    // TODO Savestate  -------------------------------------------

    this.saveState = function() {
        return {
            st: softTurboON,
            cv: chgCpuValue
        };
    };

    this.loadState = function(s) {
        softTurboON = s ? s.st : false;
        chgCpuValue = s ? s.cv : 0;
    };


    var bios;
    var biosSocket, ledsSocket;
    var machine;

    var chgCpuValue = 0;
    var softTurboON = false;

};