// Makoto Sound Cartridge (SuperSoniqs / Electric River Hardware)
// Controls a YM2608 OPNA sound chip: FM, SSG, internal rhythm sounds and 256KB ADPCM sample RAM
// NO memory mapped. Provides only access to device ports 0x14 - 0x17

wmsx.CartridgeMakoto = function(rom) {
"use strict";

    function init(self) {
        self.rom = rom;
    }

    this.connect = function(machine) {
        opna.connect(machine);
        machine.bus.connectInputDevice( 0x14, this.input14);
        machine.bus.connectOutputDevice(0x14, this.output14);
        machine.bus.connectInputDevice( 0x15, this.input15);
        machine.bus.connectOutputDevice(0x15, this.output15);
        machine.bus.connectInputDevice( 0x16, this.input16);
        machine.bus.connectOutputDevice(0x16, this.output16);
        machine.bus.connectInputDevice( 0x17, this.input17);
        machine.bus.connectOutputDevice(0x17, this.output17);
    };

    this.disconnect = function(machine) {
        opna.disconnect(machine);
        machine.bus.disconnectInputDevice( 0x14, this.input14);
        machine.bus.disconnectOutputDevice(0x14, this.output14);
        machine.bus.disconnectInputDevice( 0x15, this.input15);
        machine.bus.disconnectOutputDevice(0x15, this.output15);
        machine.bus.disconnectInputDevice( 0x16, this.input16);
        machine.bus.disconnectOutputDevice(0x16, this.output16);
        machine.bus.disconnectInputDevice( 0x17, this.input17);
        machine.bus.disconnectOutputDevice(0x17, this.output17);
    };

    this.powerOn = function() {
        opna.powerOn();
    };

    this.powerOff = function() {
        opna.powerOff();
    };

    this.reset = function() {
        opna.reset();
    };

    this.input14 = function() {
        return opna.readPort(0);
    };
    this.output14 = function(val) {
        opna.writePort(0, val);
    };

    this.input15 = function() {
        return opna.readPort(1);
    };
    this.output15 = function(val) {
        opna.writePort(1, val);
    };

    this.input16 = function() {
        return opna.readPort(2);
    };
    this.output16 = function(val) {
        opna.writePort(2, val);
    };

    this.input17 = function() {
        return opna.readPort(3);
    };
    this.output17 = function(val) {
        opna.writePort(3, val);
    };


    var opna = new wmsx.YM2608Audio("Makoto", 3);       // Fixed INT channel 3
    this.opna = opna;

    this.rom = null;
    this.format = wmsx.SlotFormats.Makoto;


    // Savestate  -------------------------------------------

    this.saveState = function() {
        return {
            f: this.format.name,
            r: this.rom.saveState(),
            o: opna.saveState()
        };
    };

    this.loadState = function(s) {
        this.rom = wmsx.ROM.loadState(s.r);
        opna.loadState(s.o);
    };


    if (rom) init(this);

};

wmsx.CartridgeMakoto.prototype = wmsx.Slot.base;

wmsx.CartridgeMakoto.recreateFromSaveState = function(state, previousSlot) {
    var cart = previousSlot || new wmsx.CartridgeMakoto();
    cart.loadState(state);
    return cart;
};
