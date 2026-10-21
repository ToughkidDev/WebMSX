// YM2608 OPNA Sound Chip: FM (6 channels), SSG (YM2149 compatible), ADPCM-A rhythm (6 channels, internal ROM), ADPCM-B (256KB RAM)
// Ported from the openMSX YM2608 core (FM and ADPCM engines originally from YMFM by Aaron Giles, BSD-3-Clause)
// Chip clock 8MHz. FM/ADPCM run at their native rate (clock / 144) and are resampled to the output rate
// Timers and status flags run on the emulated CPU time (audio clock pulses), audio on the sample generation

wmsx.YM2608Audio = function(pName, intChannel) {
"use strict";

    var self = this;

    function init() {
        name = pName || "YM2608";
        for (var c = 0; c < 6; ++c) channels[c] = new FmChannel();
        for (c = 0; c < 6; ++c) adpcmAChannels[c] = new AdpcmAChannel();
        createSSGVolumeTable();
    }

    this.connect = function(machine) {
        cpu = machine.cpu;
        audioSocket = machine.getAudioSocket();
        if (audioConnected) connectAudio();
    };

    this.disconnect = function(machine) {
        updateIRQ(false);
        disconnectAudio();
        audioSocket = null;
    };

    this.powerOn = function() {
        wmsx.Util.arrayFill(adpcmBRam, 0);
        this.reset();
    };

    this.powerOff = function() {
        updateIRQ(false);
        disconnectAudio();
    };

    this.reset = function() {
        connectAudio();

        // FM engine
        timerRunning[0] = timerRunning[1] = false;
        statusReg = 0;
        resetRegisters();
        modeWrite(0);
        for (var c = 0; c < 6; ++c) channels[c].reset();
        envCounter = 0;
        modified = true;

        // ADPCM-A
        wmsx.Util.arrayFill(adpcmARegs, 0);
        adpcmARegs[0x08] = adpcmARegs[0x09] = adpcmARegs[0x0a] = 0xdf;
        adpcmARegs[0x0b] = adpcmARegs[0x0c] = adpcmARegs[0x0d] = 0xdf;
        for (c = 0; c < 6; ++c) adpcmAChannels[c].reset();
        // Rhythm sounds start/end in the internal ROM
        setAdpcmAStartEnd(0, 0x0000, 0x01bf);       // bass drum
        setAdpcmAStartEnd(1, 0x01c0, 0x043f);       // snare drum
        setAdpcmAStartEnd(2, 0x0440, 0x1b7f);       // top cymbal
        setAdpcmAStartEnd(3, 0x1b80, 0x1cff);       // high hat
        setAdpcmAStartEnd(4, 0x1d00, 0x1f7f);       // tom tom
        setAdpcmAStartEnd(5, 0x1f80, 0x1fff);       // rim shot

        // ADPCM-B
        wmsx.Util.arrayFill(adpcmBRegs, 0);
        adpcmBRegs[0x0c] = adpcmBRegs[0x0d] = 0xff;
        adpcmBReset();

        setClockPrescale(6);

        addressLatch = 0;
        irqEnable = 0x1f;
        flagControl = 0x1c;
        irqMask = irqEnable & ~flagControl & 0x1f;
        syncAdpcmBStatus();

        ssgReset();

        busyEnd = 0;
        fmAcc = 0; fmPrevL = fmPrevR = fmCurL = fmCurR = 0;
    };

    // Ports: 0 = address (low), 1 = data (low), 2 = address (high), 3 = data (high)

    this.readPort = function(port) {
        switch (port & 3) {
            case 0:
                return (statusReg & (STATUS_TIMER_A | STATUS_TIMER_B)) | (isBusy() ? STATUS_BUSY : 0);
            case 1:
                if (addressLatch < 0x10) return ssgReadRegister(addressLatch);
                return addressLatch === 0xff ? 1 : 0;           // chip ID
            case 2:
                var status = statusHi();
                syncAdpcmBStatus();
                return status | (isBusy() ? STATUS_BUSY : 0);
            case 3:
                if ((addressLatch & 0xff) < 0x10) {
                    var res = adpcmBRead(addressLatch & 0x0f);
                    syncAdpcmBStatus();
                    return res;
                }
                return 0;
        }
    };

    this.writePort = function(port, val) {
        switch (port & 3) {
            case 0:
                addressLatch = val;
                // Special addresses change the clock prescaler
                if (addressLatch === 0x2d) setClockPrescale(6);
                else if (addressLatch === 0x2e && prescale === 6) setClockPrescale(3);
                else if (addressLatch === 0x2f) setClockPrescale(2);
                break;
            case 2:
                addressLatch = 0x100 | val;
                break;
            case 1:
                if (addressLatch & 0x100) break;                // ignore if paired with upper address
                writeRegister(addressLatch, val);
                break;
            case 3:
                if ((addressLatch & 0x100) === 0) break;        // ignore if paired with lower address
                writeRegister(addressLatch, val);
                break;
        }
    };

    // Emulated time: called at 49780 Hz (CPU clock / 72) by the AudioSignal
    this.audioClockPulse = function() {
        masterClockAcc += MASTER_CLOCKS_PER_PULSE;
        var period = 24 * prescale;
        if (masterClockAcc < period) return;
        var n = (masterClockAcc / period) | 0;
        masterClockAcc -= n * period;
        emuAdvance(n);
    };

    // Audio: called at 112005 Hz (CPU clock / 32)
    this.nextSample = function() {
        fmAcc += fmStep;
        while (fmAcc >= 1) {
            fmAcc -= 1;
            fmPrevL = fmCurL; fmPrevR = fmCurR;
            generateChipSample();
            fmCurL = chipOutL; fmCurR = chipOutR;
        }
        var ssg = ssgNextSample();
        sampleResult[0] = (fmPrevL + (fmCurL - fmPrevL) * fmAcc) * CHIP_SCALE + ssg;
        sampleResult[1] = (fmPrevR + (fmCurR - fmPrevR) * fmAcc) * CHIP_SCALE + ssg;
        return sampleResult;
    };

    function connectAudio() {
        if (audioSocket) {
            if (!audioSignal) audioSignal = new wmsx.AudioSignal(name, self, BASE_VOLUME, SAMPLE_RATE, true, CLOCK);
            audioSocket.connectAudioSignal(audioSignal);
        }
        audioConnected = true;
    }

    function disconnectAudio() {
        if (audioSocket && audioSignal) audioSocket.disconnectAudioSignal(audioSignal);
        audioConnected = false;
    }

    function isBusy() {
        return audioSocket ? audioSocket.getBUSCycles() < busyEnd : false;
    }

    function writeRegister(regNum, data) {
        if (regNum < 0x10) {
            ssgWriteRegister(regNum, data);                         // 00-0F: SSG
        } else if (regNum < 0x20) {
            adpcmAWriteReg(regNum & 0x0f, data);                    // 10-1F: ADPCM-A
        } else if (regNum === 0x29) {
            irqEnable = data;                                       // 29: IRQ mask and FM channels 3-5 enable
            setIrqMask(irqEnable & ~flagControl & 0x1f);
        } else if (regNum >= 0x100 && regNum < 0x110) {
            adpcmBWriteReg(regNum & 0x0f, data);                    // 100-10F: ADPCM-B
            syncAdpcmBStatus();
        } else if (regNum === 0x110) {                              // 110: IRQ flag control
            if (data & 0x80) setResetStatus(0, 0xff);
            else {
                flagControl = data;
                setIrqMask(irqEnable & ~flagControl & 0x1f);
            }
        } else {
            fmWriteReg(regNum, data);                               // everything else: FM
        }

        if (audioSocket) busyEnd = audioSocket.getBUSCycles() + BUSY_BUS_CYCLES_PER_PRESCALE * prescale;
    }

    function setClockPrescale(value) {
        prescale = value;
        fmStep = (((CHIP_CLOCK + 12 * prescale) / (24 * prescale)) | 0) / SAMPLE_RATE;
        ssgClocksPerSample = (8 * CHIP_CLOCK / (prescale === 6 ? 32 : prescale === 3 ? 16 : 8)) / SAMPLE_RATE;
    }


    // Status and IRQ  ---------------------------------------------

    function setResetStatus(set, reset) {
        statusReg = (statusReg | set) & ~reset & 0xff;
        updateIRQ((statusReg & irqMask) !== 0);
    }

    function setIrqMask(mask) {
        irqMask = mask;
        updateIRQ((statusReg & irqMask) !== 0);
    }

    function updateIRQ(state) {
        if (irqActive === state) return;
        irqActive = state;
        if (cpu) cpu.setINTChannel(intChannel, !state);        // INT channels are active low
    }

    function statusHi() {
        var status = statusReg & ~(STATUS_ADPCM_B_EOS | STATUS_ADPCM_B_BRDY | STATUS_ADPCM_B_PLAYING);
        if (adbStatus & ADB_EOS) status |= STATUS_ADPCM_B_EOS;
        if (adbStatus & ADB_BRDY) status |= STATUS_ADPCM_B_BRDY;
        if (adbStatus & ADB_PLAYING) status |= STATUS_ADPCM_B_PLAYING;
        return status & ~(flagControl & 0x1f) & 0xff;
    }

    function syncAdpcmBStatus() {
        var status = statusHi();
        setResetStatus(status, ~status & 0xff);
    }


    // Timers (emulated time, in chip samples)  ---------------------------------------------

    function emuAdvance(n) {
        totalClocks = (totalClocks + n) & 0xff;
        for (var t = 0; t < 2; ++t) {
            if (!timerRunning[t]) continue;
            timerRemaining[t] -= n;
            while (timerRunning[t] && timerRemaining[t] <= 0) timerExpired(t);
        }
        // Without synthesis PLAYING clears on the next clock
        if ((adbStatus & ADB_PLAYING) && !adpcmBSynthesizing()) {
            adbStatus &= ~ADB_PLAYING;
            syncAdpcmBStatus();
        }
    }

    function timerExpired(t) {
        if (t === 0 && enableTimerA()) setResetStatus(STATUS_TIMER_A, 0);
        else if (t === 1 && enableTimerB()) setResetStatus(STATUS_TIMER_B, 0);

        // Timer A overflow in CSM mode keys channel 2
        if (t === 0 && csm()) {
            modified = true;
            channels[2].keyOnOff(0xf, KEYON_CSM);
        }

        // Reload, keeping the overshoot
        var over = timerRemaining[t];
        timerRunning[t] = false;
        updateTimer(t, true, 0);
        timerRemaining[t] += over;
        if (timerRemaining[t] <= 0) timerRemaining[t] = 1;
    }

    function updateTimer(t, enable, deltaClocks) {
        if (enable && !timerRunning[t]) {
            var period = t === 0 ? 1024 - timerAValue() : 16 * (256 - timerBValue());
            timerRemaining[t] = period + deltaClocks;
            timerRunning[t] = true;
        } else if (!enable)
            timerRunning[t] = false;
    }

    function modeWrite(data) {
        regs[0x27] = data;
        var resetMask = 0;
        if (data & 0x20) resetMask |= STATUS_TIMER_B;
        if (data & 0x10) resetMask |= STATUS_TIMER_A;
        setResetStatus(0, resetMask);
        // Timer B *16 divider is free-running
        updateTimer(1, (data & 0x02) !== 0, -(totalClocks & 15));
        updateTimer(0, (data & 0x01) !== 0, 0);
    }

    function timerAValue() { return (regs[0x24] << 2) | (regs[0x25] & 3); }
    function timerBValue() { return regs[0x26]; }
    function csm()          { return ((regs[0x27] >> 6) & 3) === 2; }
    function multiFreq()    { return ((regs[0x27] >> 6) & 3) !== 0; }
    function enableTimerB() { return (regs[0x27] & 0x08) !== 0; }
    function enableTimerA() { return (regs[0x27] & 0x04) !== 0; }


    // Chip sample generation (FM + ADPCM-A + ADPCM-B)  ---------------------------------------------

    function generateChipSample() {
        var outL = 0, outR = 0;

        // Envelope counter: OPNA divides by 3, skipping values whose low two bits are 3
        envCounter = (envCounter + 1) >>> 0;
        if ((envCounter & 3) === 3) envCounter = (envCounter + 1) >>> 0;

        // LFO
        var pm = 0;
        if (regs[0x22] & 0x08) pm = clockLfo(LFO_MAX_COUNTS[regs[0x22] & 7]);
        else { lfoCounter = 0; lfoAm = 0x3f; }

        // FM channels. Bit 7 of register 0x29 enables channels 3-5
        var wasModified = modified;
        var chanMask = (irqEnable & 0x80) ? 0x3f : 0x07;
        for (var c = 0; c < 6; ++c) {
            var channel = channels[c];
            var audible = wasModified ? channel.prepare(c) : channel.audible();
            if (channel.finished()) {
                channel.quiesceFeedback();
                continue;
            }
            channel.clock(envCounter, pm);
            if (!audible || ((chanMask >> c) & 1) === 0) continue;
            var chOffs = channelOffset(c);
            var out = channel.output4Op(c, chOffs);
            var pan = regs[0xb4 + chOffs];
            if (pan & 0x80) outL += out;
            if (pan & 0x40) outR += out;
        }
        if (wasModified && channels[2].csmPendingRelease()) channels[2].endCsmPulse();
        modified = false;

        // ADPCM-B
        if (adbPlaying || adbAccumulator !== 0 || adbPrevAccum !== 0) {
            if (adpcmBDecoding()) {
                var delta = adpcmBDeltaN();
                if (delta !== 0) {
                    var nextPos = adbPosition + delta;
                    adbPosition = nextPos & 0xffff;
                    if (nextPos >= 0x10000) adpcmBConsumeNibble();
                }
            } else
                adbPlaying = false;
            var level = adpcmBRegs[0x0b];
            if (level !== 0) {
                var interp = adbPrevAccum + Math.floor((adbAccumulator - adbPrevAccum) * adbPosition / 65536);
                var bSample = (interp * level) >> 9;
                if (adpcmBRegs[0x01] & 0x80) outL += bSample;
                if (adpcmBRegs[0x01] & 0x40) outR += bSample;
            }
        }

        // ADPCM-A. Channels 0-3 clock on every ADPCM tick, channels 4-5 on every other tick
        var tick = (envCounter & 3) === 0;
        var tickHigh = tick && (envCounter & 4) === 0;
        var totalLevel = adpcmARegs[0x01] & 0x3f;
        for (c = 0; c < 6; ++c) {
            var ach = adpcmAChannels[c];
            if (!ach.playing && ach.accumulator === 0) continue;
            if (c < 4 ? tick : tickHigh) ach.clock(adpcmAChannelEnd(c));
            var chReg = adpcmARegs[0x08 + c];
            var vol = ((chReg & 0x1f) ^ 0x1f) + (totalLevel ^ 0x3f);
            if (vol >= 63) continue;
            var aSample = ach.sample(15 - (vol & 7), 4 + 1 + (vol >> 3));
            if (chReg & 0x80) outL += aSample;
            if (chReg & 0x40) outR += aSample;
        }

        chipOutL = outL;
        chipOutR = outR;
    }


    // FM Registers  ---------------------------------------------

    function resetRegisters() {
        wmsx.Util.arrayFill(regs, 0);
        // enable output on both channels by default
        regs[0x0b4] = regs[0x0b5] = regs[0x0b6] = 0xc0;
        regs[0x1b4] = regs[0x1b5] = regs[0x1b6] = 0xc0;
        lfoCounter = 0; lfoAm = 0;
    }

    function fmWriteReg(index, data) {
        modified = true;

        if (index === 0x27) return modeWrite(data);

        // writes in the 0xa0-af/0x1a0-af region are handled as latched pairs. Registers 0xb8-bf hold the latches
        if ((index & 0xf0) === 0xa0) {
            if ((index & 3) === 3) return;
            var latchIndex = 0xb8 | ((index >> 3) & 1);
            if (index & 4) regs[latchIndex] = data & 0x3f;
            else {
                regs[index] = data;
                regs[index | 4] = regs[latchIndex];
            }
            return;
        } else if ((index & 0xf8) === 0xb8) return;

        regs[index] = data;

        // Key on register
        if (index === 0x28) {
            var ch = data & 3;
            if (ch === 3) return;
            ch += ((data >> 2) & 1) * 3;
            channels[ch].keyOnOff((data >> 4) & 0x0f, KEYON_NORMAL);
        }
    }

    function channelOffset(chNum) {
        return (chNum % 3) + 0x100 * ((chNum / 3) | 0);
    }

    function operatorOffset(opNum) {
        return (opNum % 12) + (((opNum % 12) / 3) | 0) + 0x100 * ((opNum / 12) | 0);
    }

    function clockLfo(maxCount) {
        var subCount = lfoCounter & 0xff;
        lfoCounter = (lfoCounter + 1) >>> 0;
        if (subCount >= maxCount) lfoCounter = (lfoCounter + 0x101 - subCount) >>> 0;

        lfoAm = (lfoCounter >>> 8) & 0x3f;
        if (((lfoCounter >>> 14) & 1) === 0) lfoAm ^= 0x3f;

        var pm = (lfoCounter >>> 10) & 7;
        if ((lfoCounter >>> 13) & 1) pm ^= 7;
        return ((lfoCounter >>> 14) & 1) ? -pm : pm;
    }

    function lfoAmOffset(chOffs) {
        var amShift = (1 << (((regs[0xb4 + chOffs] >> 4) & 3) ^ 3)) - 1;
        return (lfoAm << 1) >> amShift;
    }

    function computePhaseStep(cache, lfoRawPm) {
        var fnum = (cache.blockFreq & 0x7ff) << 1;
        if (cache.lfoPmSens !== 0) {
            fnum += opnLfoPmPhaseAdjustment((cache.blockFreq >> 4) & 0x7f, cache.lfoPmSens, lfoRawPm);
            fnum &= 0xfff;
        }
        var block = (cache.blockFreq >> 11) & 7;
        var phaseStep = (fnum << block) >> 2;
        phaseStep += cache.detune;
        phaseStep &= 0x1ffff;
        return (phaseStep * cache.multiple) >> 1;
    }

    function opnLfoPmPhaseAdjustment(fnumBits, pmSensitivity, lfoRawPm) {
        var absPm = lfoRawPm < 0 ? -lfoRawPm : lfoRawPm;
        var shifts = LFO_PM_SHIFTS[pmSensitivity * 8 + (absPm & 7)];
        var adjust = (fnumBits >> (shifts & 0x0f)) + (fnumBits >> ((shifts >> 4) & 0x0f));
        if (pmSensitivity > 5) adjust <<= pmSensitivity - 5;
        adjust >>= 2;
        return lfoRawPm < 0 ? -adjust : adjust;
    }

    function cacheOperatorData(chOffs, opOffs, cache) {
        var blockFreq = ((regs[0xa4 + chOffs] & 0x3f) << 8) | regs[0xa0 + chOffs];

        // multi-frequency mode for channel 2
        if (multiFreq() && chOffs === 2) {
            if (opOffs === 2) blockFreq = multiBlockFreq(1);
            else if (opOffs === 10) blockFreq = multiBlockFreq(2);
            else if (opOffs === 6) blockFreq = multiBlockFreq(0);
        }
        cache.blockFreq = blockFreq;

        // 5-bit keycode
        var keycode = ((blockFreq >> 10) & 0x0f) << 1;
        keycode |= (0xfe80 >> ((blockFreq >> 7) & 0x0f)) & 1;

        var detune = (regs[0x30 + opOffs] >> 4) & 7;
        var det = DETUNE_TABLE[keycode * 4 + (detune & 3)];
        cache.detune = (detune & 4) ? -det : det;

        cache.multiple = (regs[0x30 + opOffs] & 0x0f) * 2;
        if (cache.multiple === 0) cache.multiple = 1;

        cache.lfoPmSens = regs[0xb4 + chOffs] & 7;
        cache.phaseStep = ((regs[0x22] & 0x08) === 0 || cache.lfoPmSens === 0) ? computePhaseStep(cache, 0) : PHASE_STEP_DYNAMIC;

        cache.totalLevel = (regs[0x40 + opOffs] & 0x7f) << 3;

        var sl = (regs[0x80 + opOffs] >> 4) & 0x0f;
        sl |= (sl + 1) & 0x10;
        cache.egSustain = sl << 5;

        var ksrVal = keycode >> (((regs[0x50 + opOffs] >> 6) & 3) ^ 3);
        cache.egRate[EG_ATTACK] =  effectiveRate((regs[0x50 + opOffs] & 0x1f) * 2, ksrVal);
        cache.egRate[EG_DECAY] =   effectiveRate((regs[0x60 + opOffs] & 0x1f) * 2, ksrVal);
        cache.egRate[EG_SUSTAIN] = effectiveRate((regs[0x70 + opOffs] & 0x1f) * 2, ksrVal);
        cache.egRate[EG_RELEASE] = effectiveRate((regs[0x80 + opOffs] & 0x0f) * 4 + 2, ksrVal);

        cache.ssgEgMode = regs[0x90 + opOffs] & 7;
        cache.ssgEgEnable = (regs[0x90 + opOffs] & 0x08) !== 0;
        cache.lfoAmEnable = (regs[0x60 + opOffs] & 0x80) !== 0;
    }

    function multiBlockFreq(num) {
        return ((regs[0xac + num] & 0x3f) << 8) | regs[0xa8 + num];
    }

    function effectiveRate(rawRate, ksr) {
        return rawRate === 0 ? 0 : Math.min(rawRate + ksr, 63);
    }

    function attenuationToVolume(input) {
        return POWER_TABLE[input & 0xff] >> (input >> 8);
    }

    function attenuationIncrement(rate, index) {
        return (INCREMENT_TABLE[rate] >>> (4 * index)) & 0x0f;
    }


    // FM Operator  ---------------------------------------------

    function FmOperator() {
        this.cache = {
            phaseStep: 0, totalLevel: 0, blockFreq: 0, egSustain: 0, detune: 0, multiple: 1,
            egRate: [ 0, 0, 0, 0 ], lfoPmSens: 0, ssgEgMode: 0, ssgEgEnable: false, lfoAmEnable: false
        };
        this.reset();
    }

    FmOperator.prototype.reset = function() {
        this.phaseAcc = 0;
        this.envAttenuation = 0x3ff;
        this.envState = EG_RELEASE;
        this.ssgInverted = false;
        this.keyState = false;
        this.keyOnLive = 0;
    };

    FmOperator.prototype.prepare = function(chOffs, opOffs) {
        cacheOperatorData(chOffs, opOffs, this.cache);
        this.clockKeystate(this.keyOnLive !== 0);
        this.keyOnLive &= ~(1 << KEYON_CSM);
        if (!this.cache.ssgEgEnable) this.ssgInverted = false;
        return this.envState !== EG_RELEASE || this.envAttenuation < EG_QUIET;
    };

    FmOperator.prototype.finished = function() {
        return this.envState === EG_RELEASE && this.envAttenuation >= 0x3ff;
    };

    FmOperator.prototype.audible = function() {
        return this.envState !== EG_RELEASE || this.envAttenuation < EG_QUIET;
    };

    FmOperator.prototype.clock = function(envCounter, lfoRawPm) {
        if (this.cache.ssgEgEnable) this.clockSsgEgState();
        if ((envCounter & 3) === 0) this.clockEnvelope(envCounter >>> 2);
        var phaseStep = this.cache.phaseStep;
        if (phaseStep === PHASE_STEP_DYNAMIC) phaseStep = computePhaseStep(this.cache, lfoRawPm);
        this.phaseAcc = (this.phaseAcc + phaseStep) >>> 0;
    };

    FmOperator.prototype.phase = function() {
        return this.phaseAcc >>> 10;
    };

    FmOperator.prototype.computeVolume = function(phase, amOffset) {
        if (this.envAttenuation > EG_QUIET) return 0;
        var sinAtt = WAVEFORM[phase & 0x3ff];
        var envAtt = this.envelopeAttenuation(amOffset) << 2;
        var result = attenuationToVolume((sinAtt & 0x7fff) + envAtt);
        return (sinAtt & 0x8000) ? -result : result;
    };

    FmOperator.prototype.keyOnOff = function(on, type) {
        this.keyOnLive = (this.keyOnLive & ~(1 << type)) | ((on ? 1 : 0) << type);
    };

    FmOperator.prototype.hasCsmKeyOn = function() {
        return (this.keyOnLive & (1 << KEYON_CSM)) !== 0;
    };

    FmOperator.prototype.csmPendingRelease = function() {
        return this.keyState && this.keyOnLive === 0;
    };

    FmOperator.prototype.endCsmPulse = function() {
        if (this.keyState && this.keyOnLive === 0) this.clockKeystate(false);
    };

    FmOperator.prototype.startAttack = function(isRestart) {
        if (this.envState === EG_ATTACK) return;
        this.envState = EG_ATTACK;
        if (!isRestart) {
            this.ssgInverted = this.cache.ssgEgEnable && (this.cache.ssgEgMode & 4) !== 0;
            this.phaseAcc = 0;
        }
        if (this.cache.egRate[EG_ATTACK] >= 62) this.envAttenuation = 0;
    };

    FmOperator.prototype.startRelease = function() {
        if (this.envState >= EG_RELEASE) return;
        this.envState = EG_RELEASE;
        if (this.ssgInverted) {
            this.envAttenuation = (0x200 - this.envAttenuation) & 0x3ff;
            this.ssgInverted = false;
        }
    };

    FmOperator.prototype.clockKeystate = function(on) {
        if (on !== this.keyState) {
            this.keyState = on;
            if (on) this.startAttack(false);
            else this.startRelease();
        }
    };

    FmOperator.prototype.clockSsgEgState = function() {
        if ((this.envAttenuation & 0x200) === 0) return;
        var mode = this.cache.ssgEgMode;
        if (mode & 1) {
            // hold modes (1/3/5/7)
            this.ssgInverted = (((mode >> 2) ^ (mode >> 1)) & 1) !== 0;
            if (this.envState !== EG_ATTACK) this.envAttenuation = this.ssgInverted ? 0x200 : 0x3ff;
        } else {
            // continuous modes (0/2/4/6)
            if (mode & 2) this.ssgInverted = !this.ssgInverted;
            if (this.envState === EG_DECAY || this.envState === EG_SUSTAIN) this.startAttack(true);
            if ((mode & 2) === 0) this.phaseAcc = 0;
        }
        if (this.envState === EG_RELEASE) this.envAttenuation = 0x3ff;
    };

    FmOperator.prototype.clockEnvelope = function(envCounter) {
        if (this.envState === EG_ATTACK && this.envAttenuation === 0) this.envState = EG_DECAY;
        if (this.envState === EG_DECAY && this.envAttenuation >= this.cache.egSustain) this.envState = EG_SUSTAIN;

        var rate = this.cache.egRate[this.envState];
        var rateShift = rate >> 2;
        envCounter = envCounter << rateShift;
        if ((envCounter & 0x7ff) !== 0) return;

        var relevantBits = (envCounter >>> (rateShift <= 11 ? 11 : rateShift)) & 7;
        var increment = attenuationIncrement(rate, relevantBits);

        if (this.envState === EG_ATTACK) {
            if (rate < 62) this.envAttenuation = (this.envAttenuation + (((~this.envAttenuation * increment) >>> 0) >>> 4)) & 0xffff;
        } else {
            if (!this.cache.ssgEgEnable) this.envAttenuation += increment;
            else if (this.envAttenuation < 0x200) this.envAttenuation += 4 * increment;
            if (this.envAttenuation >= 0x400) this.envAttenuation = 0x3ff;
        }
    };

    FmOperator.prototype.envelopeAttenuation = function(amOffset) {
        var result = this.envAttenuation;
        if (this.ssgInverted) result = (0x200 - result) & 0x3ff;
        if (this.cache.lfoAmEnable) result += amOffset;
        result += this.cache.totalLevel;
        return result > 0x3ff ? 0x3ff : result;
    };


    // FM Channel  ---------------------------------------------

    function FmChannel() {
        this.ops = [ new FmOperator(), new FmOperator(), new FmOperator(), new FmOperator() ];
        this.feedback0 = 0; this.feedback1 = 0; this.feedbackIn = 0;
    }

    FmChannel.prototype.reset = function() {
        this.feedback0 = this.feedback1 = this.feedbackIn = 0;
        for (var i = 0; i < 4; ++i) this.ops[i].reset();
    };

    FmChannel.prototype.keyOnOff = function(states, type) {
        for (var i = 0; i < 4; ++i) this.ops[i].keyOnOff(((states >> i) & 1) !== 0, type);
    };

    FmChannel.prototype.prepare = function(chNum) {
        var active = false;
        var chOffs = channelOffset(chNum);
        var map = OPERATOR_MAP[chNum];
        for (var slot = 0; slot < 4; ++slot)
            if (this.ops[slot].prepare(chOffs, operatorOffset(map[slot]))) active = true;
        return active;
    };

    FmChannel.prototype.finished = function() {
        var ops = this.ops;
        return ops[0].finished() && ops[1].finished() && ops[2].finished() && ops[3].finished();
    };

    FmChannel.prototype.audible = function() {
        var ops = this.ops;
        return ops[0].audible() || ops[1].audible() || ops[2].audible() || ops[3].audible();
    };

    FmChannel.prototype.quiesceFeedback = function() {
        this.feedback0 = this.feedback1;
        this.feedback1 = this.feedbackIn;
    };

    FmChannel.prototype.clock = function(envCounter, lfoRawPm) {
        this.feedback0 = this.feedback1;
        this.feedback1 = this.feedbackIn;
        for (var i = 0; i < 4; ++i) this.ops[i].clock(envCounter, lfoRawPm);
    };

    FmChannel.prototype.csmPendingRelease = function() {
        var ops = this.ops;
        return ops[0].csmPendingRelease() || ops[1].csmPendingRelease() || ops[2].csmPendingRelease() || ops[3].csmPendingRelease();
    };

    FmChannel.prototype.endCsmPulse = function() {
        for (var i = 0; i < 4; ++i) this.ops[i].endCsmPulse();
    };

    FmChannel.prototype.output4Op = function(chNum, chOffs) {
        var ops = this.ops;
        var alg = ALGORITHM_OPS[regs[0xb0 + chOffs] & 7];
        var fb = (regs[0xb0 + chOffs] >> 3) & 7;
        var amOffset = lfoAmOffset(chOffs);

        // operator 1 has optional self-feedback
        var opmod = 0;
        if (fb !== 0) opmod = (this.feedback0 + this.feedback1) >> (10 - fb);

        var op1value = this.feedbackIn = ops[0].computeVolume(ops[0].phase() + opmod, amOffset);

        opout[0] = 0;
        opout[1] = op1value;

        opmod = opout[alg[0]] >> 1;
        opout[2] = ops[1].computeVolume(ops[1].phase() + opmod, amOffset);
        opout[5] = opout[1] + opout[2];

        opmod = opout[alg[1]] >> 1;
        opout[3] = ops[2].computeVolume(ops[2].phase() + opmod, amOffset);
        opout[6] = opout[1] + opout[3];
        opout[7] = opout[2] + opout[3];

        opmod = opout[alg[2]] >> 1;
        var result = ops[3].computeVolume(ops[3].phase() + opmod, amOffset) >> 1;

        var carrierMask = alg[3];
        if (carrierMask & 1) result += opout[1] >> 1;
        if (carrierMask & 2) result += opout[2] >> 1;
        if (carrierMask & 4) result += opout[3] >> 1;
        return result;
    };


    // ADPCM-A  ---------------------------------------------

    function AdpcmAChannel() {
        this.reset();
    }

    AdpcmAChannel.prototype.reset = function() {
        this.playing = false;
        this.curNibble = 0;
        this.curByte = 0;
        this.curAddress = 0;
        this.accumulator = 0;
        this.stepIndex = 0;
    };

    AdpcmAChannel.prototype.keyOnOff = function(on, start) {
        this.playing = on;
        if (on) {
            this.curAddress = start;
            this.curNibble = 0;
            this.curByte = 0;
            this.accumulator = 0;
            this.stepIndex = 0;
        }
    };

    AdpcmAChannel.prototype.clock = function(end) {
        if (!this.playing) {
            this.accumulator = 0;
            return;
        }
        var data;
        if (this.curNibble === 0) {
            // end address is inclusive
            if (((this.curAddress ^ (end + 1)) & 0xfffff) === 0) {
                this.playing = false;
                this.accumulator = 0;
                return;
            }
            this.curByte = RHYTHM_ROM[this.curAddress & 0x1fff];
            this.curAddress++;
            data = this.curByte >> 4;
            this.curNibble = 1;
        } else {
            data = this.curByte & 0x0f;
            this.curNibble = 0;
        }

        var delta = ((2 * (data & 7) + 1) * ADPCM_A_STEPS[this.stepIndex] / 8) | 0;
        if (data & 8) delta = -delta;

        // the 12-bit accumulator wraps
        this.accumulator = (this.accumulator + delta) & 0xfff;

        var si = this.stepIndex + ADPCM_A_STEP_INC[data & 7];
        this.stepIndex = si < 0 ? 0 : si > 48 ? 48 : si;
    };

    AdpcmAChannel.prototype.sample = function(mul, shift) {
        var acc16 = (this.accumulator << 20) >> 16;         // 12-bit value shifted up to sign-extend
        return ((acc16 * mul) >> shift) & ~3;
    };

    function adpcmAWriteReg(regNum, data) {
        adpcmARegs[regNum] = data;
        if (regNum === 0x00) {
            for (var c = 0; c < 6; ++c)
                if ((data >> c) & 1) adpcmAChannels[c].keyOnOff((data & 0x80) === 0, adpcmAChannelStart(c));
        }
    }

    function adpcmAChannelStart(c) {
        return adpcmARegs[0x10 + c] | (adpcmARegs[0x18 + c] << 8);
    }

    function adpcmAChannelEnd(c) {
        return adpcmARegs[0x20 + c] | (adpcmARegs[0x28 + c] << 8);
    }

    function setAdpcmAStartEnd(c, start, end) {
        adpcmARegs[0x10 + c] = start & 0xff;
        adpcmARegs[0x18 + c] = start >> 8;
        adpcmARegs[0x20 + c] = end & 0xff;
        adpcmARegs[0x28 + c] = end >> 8;
    }


    // ADPCM-B  ---------------------------------------------

    function adpcmBReset() {
        adbStatus = ADB_BRDY;
        adbPlaying = false;
        emuAddress = 0;
        adbAddress = 0; adbPosition = 0; adbNibble = 0;
        adbCurByte = 0;
        adbDummyRead = 0;
        adbAccumulator = 0;
        adbPrevAccum = 0;
        adbStep = ADB_STEP_MIN;
        adbCpuWriteActive = false;
    }

    function adpcmBExecute()  { return (adpcmBRegs[0x00] & 0x80) !== 0; }
    function adpcmBRecord()   { return (adpcmBRegs[0x00] & 0x40) !== 0; }
    function adpcmBExternal() { return (adpcmBRegs[0x00] & 0x20) !== 0; }
    function adpcmBRepeat()   { return (adpcmBRegs[0x00] & 0x10) !== 0; }
    function adpcmBDeltaN()   { return adpcmBRegs[0x09] | (adpcmBRegs[0x0a] << 8); }

    function adpcmBSynthesizing() {
        return adpcmBExecute() && !adpcmBRecord();
    }

    function adpcmBDecoding() {
        return adpcmBSynthesizing() && adbPlaying;
    }

    function adpcmBAddressShift() {
        return (adpcmBRegs[0x01] & 0x03) ? 5 : 2;            // ROM or 8-bit DRAM: 5 bits, otherwise 2 bits
    }

    function adpcmBStart() { return adpcmBRegs[0x02] | (adpcmBRegs[0x03] << 8); }
    function adpcmBEndAddress() { return (((adpcmBRegs[0x04] | (adpcmBRegs[0x05] << 8)) + 1) << adpcmBAddressShift()) - 1; }
    function adpcmBLimitAddress() { return (((adpcmBRegs[0x0c] | (adpcmBRegs[0x0d] << 8)) + 1) << adpcmBAddressShift()) - 1; }

    function adpcmBRestartAddress() {
        return adpcmBExternal() ? (adpcmBStart() << adpcmBAddressShift()) : 0;
    }

    function adpcmBResetDecoder() {
        adbCurByte = 0;
        adbAccumulator = 0;
        adbPrevAccum = 0;
        adbStep = ADB_STEP_MIN;
    }

    function adpcmBLoadStart() {
        adbStatus = (adbStatus & ~ADB_EOS) | ADB_PLAYING;
        adbPlaying = true;
        emuAddress = adbAddress = adpcmBRestartAddress();
        adbPosition = 0; adbNibble = 0;
        adpcmBResetDecoder();
        adbCpuWriteActive = false;
    }

    function adpcmBConsumeNibble() {
        if (adbNibble === 0 && adpcmBExternal()) adbCurByte = adpcmBRam[adbAddress & 0x3ffff];

        var data = adbNibble === 0 ? adbCurByte >> 4 : adbCurByte & 0x0f;
        adbNibble ^= 1;

        if (adbNibble === 0) {
            if (adpcmBExternal()) {
                if (adbAddress === adpcmBEndAddress()) {
                    if (adpcmBRepeat()) {
                        adbAddress = adpcmBRestartAddress(); adbPosition = 0; adbNibble = 0;
                        adpcmBResetDecoder();
                    } else {
                        adbAccumulator = 0;
                        adbPrevAccum = 0;
                        adbPlaying = false;
                        adbStatus = (adbStatus & ~ADB_PLAYING) | ADB_EOS;
                        syncAdpcmBStatus();
                        return;
                    }
                } else if (adbAddress === adpcmBLimitAddress())
                    adbAddress = 0;
                else
                    adbAddress = (adbAddress + 1) & 0xffffff;
            } else {
                // CPU-driven: copy the next byte and request more data
                adbCurByte = adpcmBRegs[0x08];
                adbStatus |= ADB_BRDY;
                syncAdpcmBStatus();
            }
        }

        adbPrevAccum = adbAccumulator;

        var delta = ((2 * (data & 7) + 1) * adbStep / 8) | 0;
        if (data & 8) delta = -delta;
        var acc = adbAccumulator + delta;
        adbAccumulator = acc < -32768 ? -32768 : acc > 32767 ? 32767 : acc;

        var step = ((adbStep * ADB_STEP_SCALE[data & 7]) / 64) | 0;
        adbStep = step < ADB_STEP_MIN ? ADB_STEP_MIN : step > ADB_STEP_MAX ? ADB_STEP_MAX : step;
    }

    function adpcmBRead(regNum) {
        var result = 0;
        if (regNum === 0x08 && !adpcmBExecute() && !adpcmBRecord() && adpcmBExternal()) {
            if (adbCpuWriteActive) return adpcmBRegs[0x08];
            if (adbDummyRead !== 0) {
                // two dummy reads are consumed first
                adpcmBLoadStart();
                adbDummyRead--;
            } else {
                result = adpcmBRam[emuAddress & 0x3ffff];
                adbStatus = emuAddress === adpcmBEndAddress() ? ADB_EOS | ADB_BRDY : ADB_BRDY;
                if (emuAddress === adpcmBLimitAddress()) emuAddress = 0;
                else emuAddress++;
            }
        }
        return result;
    }

    function adpcmBWriteReg(regNum, data) {
        adpcmBRegs[regNum] = data;

        if (regNum === 0x00) {
            if (adpcmBExecute()) adpcmBLoadStart();
            else adbStatus &= ~ADB_EOS;
            if (data & 0x01) adpcmBReset();
            if (adpcmBExternal()) adbDummyRead = 2;
        } else if (regNum === 0x08) {
            if (adpcmBExecute() && !adpcmBRecord() && !adpcmBExternal()) {
                // writing from the CPU during execute clears the ready flag
                adbStatus &= ~ADB_BRDY;
            } else if (!adpcmBExecute() && adpcmBRecord() && adpcmBExternal()) {
                // writing during "record" passes through as data
                if (adbDummyRead !== 0) {
                    adpcmBLoadStart();
                    adbDummyRead = 0;
                }
                var end = adpcmBEndAddress() + 1;
                if (emuAddress !== end) {
                    adpcmBRam[emuAddress & 0x3ffff] = data;
                    emuAddress++;
                    adbCpuWriteActive = true;
                }
                if (emuAddress === end) {
                    adbCpuWriteActive = false;
                    adbStatus = ADB_EOS | ADB_BRDY;
                } else
                    adbStatus = ADB_BRDY;
            }
        }
    }


    // SSG (YM2149)  ---------------------------------------------

    function ssgReset() {
        wmsx.Util.arrayFill(ssgRegs, 0);
        ssgToneCount[0] = ssgToneCount[1] = ssgToneCount[2] = 0;
        ssgToneOut[0] = ssgToneOut[1] = ssgToneOut[2] = 0;
        ssgNoiseCount = 0; ssgNoiseOut = 0; ssgLfsr = 1;
        ssgEnvCount = 0; ssgEnvStep = 0; ssgEnvHolding = true; ssgEnvAttack = 0; ssgEnvAlternate = false; ssgEnvHold = false;
        ssgEnvVolume = 0;
    }

    function ssgReadRegister(reg) {
        if (reg >= 14) return 0xff;                         // I/O ports not connected
        return ssgRegs[reg] & SSG_REG_MASKS[reg];
    }

    function ssgWriteRegister(reg, val) {
        ssgRegs[reg] = val;
        if (reg === 13) {
            // Envelope restart
            ssgEnvHold = (val & 0x01) !== 0;
            ssgEnvAlternate = (val & 0x02) !== 0;
            ssgEnvAttack = (val & 0x04) ? 0x1f : 0;
            if ((val & 0x08) === 0) {           // continue = 0: hold after the first cycle, alternate = attack
                ssgEnvHold = true;
                ssgEnvAlternate = ssgEnvAttack !== 0;
            }
            ssgEnvCount = 0;
            ssgEnvStep = 0x1f;
            ssgEnvHolding = false;
            ssgEnvVolume = ssgEnvStep ^ ssgEnvAttack;
        }
    }

    function ssgNextSample() {
        var clocks = ssgClocksPerSample;
        var mixer = ssgRegs[7];
        var result = 0;

        // Noise: LFSR clocked at clock / (16 * period)
        var noisePeriod = (ssgRegs[6] & 0x1f) || 1;
        ssgNoiseCount += clocks;
        var noiseHalf = 16 * noisePeriod;
        while (ssgNoiseCount >= noiseHalf) {
            ssgNoiseCount -= noiseHalf;
            if ((ssgLfsr + 1) & 2) ssgNoiseOut ^= 1;        // toggle when bit0 xor bit1
            if (ssgLfsr & 1) ssgLfsr ^= 0x24000;
            ssgLfsr >>>= 1;
        }

        // Envelope: 32 steps, each step lasts 8 * period clocks
        if (!ssgEnvHolding) {
            var envPeriod = (ssgRegs[11] | (ssgRegs[12] << 8)) || 1;
            ssgEnvCount += clocks;
            var envStepLen = 8 * envPeriod;
            while (ssgEnvCount >= envStepLen && !ssgEnvHolding) {
                ssgEnvCount -= envStepLen;
                if (--ssgEnvStep < 0) {
                    if (ssgEnvHold) {
                        if (ssgEnvAlternate) ssgEnvAttack ^= 0x1f;
                        ssgEnvHolding = true;
                        ssgEnvStep = 0;
                    } else {
                        if (ssgEnvAlternate) ssgEnvAttack ^= 0x1f;
                        ssgEnvStep = 0x1f;
                    }
                }
            }
            ssgEnvVolume = ssgEnvStep ^ ssgEnvAttack;
        }

        for (var c = 0; c < 3; ++c) {
            var period = (ssgRegs[c * 2] | ((ssgRegs[c * 2 + 1] & 0x0f) << 8)) || 1;
            var half = 8 * period;
            ssgToneCount[c] += clocks;
            if (ssgToneCount[c] >= half) {
                var toggles = (ssgToneCount[c] / half) | 0;
                ssgToneCount[c] -= toggles * half;
                if (toggles & 1) ssgToneOut[c] ^= 1;
            }
            var toneOn = ((mixer >> c) & 1) !== 0 || ssgToneOut[c];
            var noiseOn = ((mixer >> (c + 3)) & 1) !== 0 || ssgNoiseOut;
            if (!toneOn || !noiseOn) continue;
            var volReg = ssgRegs[8 + c];
            var level = (volReg & 0x10) ? ssgEnvVolume : (volReg & 0x0f) ? ((volReg & 0x0f) << 1) | 1 : 0;
            result += ssgVolumeTable[level];
        }
        return result;
    }

    function createSSGVolumeTable() {
        ssgVolumeTable[0] = 0;
        for (var v = 1; v < 32; ++v) ssgVolumeTable[v] = Math.pow(2, -(31 - v) / 4) * SSG_CHANNEL_MAX_VOLUME;
    }


    var name;
    var cpu;
    var audioSocket, audioSignal;
    var audioConnected = false;

    // FM engine
    var regs = new Uint8Array(0x200);
    var channels = new Array(6);
    var opout = new Int16Array(8);
    var envCounter = 0;
    var lfoCounter = 0, lfoAm = 0;
    var modified = true;
    var statusReg = 0;
    var prescale = 6;
    var irqMask = 0x03;
    var irqActive = false;
    var timerRunning = [ false, false ];
    var timerRemaining = [ 0, 0 ];
    var totalClocks = 0;
    var masterClockAcc = 0;

    // ADPCM-A
    var adpcmARegs = new Uint8Array(0x30);
    var adpcmAChannels = new Array(6);

    // ADPCM-B
    var adpcmBRegs = new Uint8Array(0x11);
    var adpcmBRam = new Uint8Array(0x40000);
    var adbStatus = 0, adbPlaying = false;
    var emuAddress = 0;
    var adbAddress = 0, adbPosition = 0, adbNibble = 0;
    var adbCurByte = 0, adbDummyRead = 0;
    var adbAccumulator = 0, adbPrevAccum = 0, adbStep = 127;
    var adbCpuWriteActive = false;

    // SSG
    var ssgRegs = new Uint8Array(16);
    var ssgToneCount = [ 0, 0, 0 ], ssgToneOut = [ 0, 0, 0 ];
    var ssgNoiseCount = 0, ssgNoiseOut = 0, ssgLfsr = 1;
    var ssgEnvCount = 0, ssgEnvStep = 0, ssgEnvHolding = true, ssgEnvAttack = 0, ssgEnvAlternate = false, ssgEnvHold = false, ssgEnvVolume = 0;
    var ssgVolumeTable = new Array(32);
    var ssgClocksPerSample = 0;

    // Interface
    var addressLatch = 0;
    var irqEnable = 0x1f;
    var flagControl = 0x1c;
    var busyEnd = 0;

    // Output resampling
    var fmStep = 0, fmAcc = 0;
    var fmPrevL = 0, fmPrevR = 0, fmCurL = 0, fmCurR = 0;
    var chipOutL = 0, chipOutR = 0;
    var sampleResult = [ 0, 0 ];

    var RHYTHM_ROM = wmsx.YM2608RhythmROM;

    var CHIP_CLOCK = 8000000;
    var SAMPLE_RATE = 112005;                       // Main CPU clock / 32
    var CLOCK = 49780;                              // Main CPU clock / 72
    var MASTER_CLOCKS_PER_PULSE = 72 * CHIP_CLOCK / wmsx.Machine.BASE_CPU_CLOCK;
    var BUSY_BUS_CYCLES_PER_PRESCALE = 32 * wmsx.Machine.BASE_CPU_CLOCK / CHIP_CLOCK;

    var BASE_VOLUME = 0.66;
    var CHIP_SCALE = 0.25 / 4096;                   // full-scale FM carrier (~4084) = 0.25
    var SSG_CHANNEL_MAX_VOLUME = 0.22;

    var STATUS_TIMER_A = 0x01, STATUS_TIMER_B = 0x02;
    var STATUS_ADPCM_B_EOS = 0x04, STATUS_ADPCM_B_BRDY = 0x08, STATUS_ADPCM_B_PLAYING = 0x20;
    var STATUS_BUSY = 0x80;

    var ADB_EOS = 0x01, ADB_BRDY = 0x02, ADB_PLAYING = 0x04;
    var ADB_STEP_MIN = 127, ADB_STEP_MAX = 24576;
    var ADB_STEP_SCALE = [ 57, 57, 57, 57, 77, 102, 128, 153 ];

    var EG_ATTACK = 0, EG_DECAY = 1, EG_SUSTAIN = 2, EG_RELEASE = 3;
    var EG_QUIET = 0x380;
    var KEYON_NORMAL = 0, KEYON_CSM = 1;
    var PHASE_STEP_DYNAMIC = 1;

    var OPERATOR_MAP = [
        [  0,  6,  3,  9 ], [  1,  7,  4, 10 ], [  2,  8,  5, 11 ],
        [ 12, 18, 15, 21 ], [ 13, 19, 16, 22 ], [ 14, 20, 17, 23 ]
    ];

    // op2in, op3in, op4in, carrierMask (bit 0 = op1, bit 1 = op2, bit 2 = op3)
    var ALGORITHM_OPS = [
        [ 1, 2, 3, 0 ], [ 0, 5, 3, 0 ], [ 0, 2, 6, 0 ], [ 1, 0, 7, 0 ],
        [ 1, 0, 3, 2 ], [ 1, 1, 1, 6 ], [ 1, 0, 0, 6 ], [ 0, 0, 0, 7 ]
    ];

    var LFO_MAX_COUNTS = [ 109, 78, 72, 68, 63, 45, 9, 6 ];

    var LFO_PM_SHIFTS = [
        0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77,
        0x77, 0x77, 0x77, 0x77, 0x72, 0x72, 0x72, 0x72,
        0x77, 0x77, 0x77, 0x72, 0x72, 0x72, 0x17, 0x17,
        0x77, 0x77, 0x72, 0x72, 0x17, 0x17, 0x12, 0x12,
        0x77, 0x77, 0x72, 0x17, 0x17, 0x17, 0x12, 0x07,
        0x77, 0x77, 0x17, 0x12, 0x07, 0x07, 0x02, 0x01,
        0x77, 0x77, 0x17, 0x12, 0x07, 0x07, 0x02, 0x01,
        0x77, 0x77, 0x17, 0x12, 0x07, 0x07, 0x02, 0x01
    ];

    var DETUNE_TABLE = [
        0, 0, 1, 2,   0, 0, 1, 2,   0, 0, 1, 2,   0, 0, 1, 2,
        0, 1, 2, 2,   0, 1, 2, 3,   0, 1, 2, 3,   0, 1, 2, 3,
        0, 1, 2, 4,   0, 1, 3, 4,   0, 1, 3, 4,   0, 1, 3, 5,
        0, 2, 4, 5,   0, 2, 4, 6,   0, 2, 4, 6,   0, 2, 5, 7,
        0, 2, 5, 8,   0, 3, 6, 8,   0, 3, 6, 9,   0, 3, 7, 10,
        0, 4, 8, 11,  0, 4, 8, 12,  0, 4, 9, 13,  0, 5, 10, 14,
        0, 5, 11, 16, 0, 6, 12, 17, 0, 6, 13, 19, 0, 7, 14, 20,
        0, 8, 16, 22, 0, 8, 16, 22, 0, 8, 16, 22, 0, 8, 16, 22
    ];

    var INCREMENT_TABLE = [
        0x00000000, 0x00000000, 0x10101010, 0x10101010,
        0x10101010, 0x10101010, 0x11101110, 0x11101110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x10101010, 0x10111010, 0x11101110, 0x11111110,
        0x11111111, 0x21112111, 0x21212121, 0x22212221,
        0x22222222, 0x42224222, 0x42424242, 0x44424442,
        0x44444444, 0x84448444, 0x84848484, 0x88848884,
        0x88888888, 0x88888888, 0x88888888, 0x88888888
    ];

    var ADPCM_A_STEPS = [
         16,  17,   19,   21,   23,   25,   28,
         31,  34,   37,   41,   45,   50,   55,
         60,  66,   73,   80,   88,   97,  107,
        118, 130,  143,  157,  173,  190,  209,
        230, 253,  279,  307,  337,  371,  408,
        449, 494,  544,  598,  658,  724,  796,
        876, 963, 1060, 1166, 1282, 1411, 1552
    ];

    var ADPCM_A_STEP_INC = [ -1, -1, -1, -1, 2, 5, 7, 9 ];

    var SSG_REG_MASKS = [ 0xff, 0x0f, 0xff, 0x0f, 0xff, 0x0f, 0x1f, 0xff, 0x1f, 0x1f, 0x1f, 0xff, 0xff, 0x0f, 0xff, 0xff ];

    // 4.8 log attenuation of a quarter sine, extracted from the OPN die
    var SIN_TABLE = [
        0x859,0x6c3,0x607,0x58b,0x52e,0x4e4,0x4a6,0x471,0x443,0x41a,0x3f5,0x3d3,0x3b5,0x398,0x37e,0x365,
        0x34e,0x339,0x324,0x311,0x2ff,0x2ed,0x2dc,0x2cd,0x2bd,0x2af,0x2a0,0x293,0x286,0x279,0x26d,0x261,
        0x256,0x24b,0x240,0x236,0x22c,0x222,0x218,0x20f,0x206,0x1fd,0x1f5,0x1ec,0x1e4,0x1dc,0x1d4,0x1cd,
        0x1c5,0x1be,0x1b7,0x1b0,0x1a9,0x1a2,0x19b,0x195,0x18f,0x188,0x182,0x17c,0x177,0x171,0x16b,0x166,
        0x160,0x15b,0x155,0x150,0x14b,0x146,0x141,0x13c,0x137,0x133,0x12e,0x129,0x125,0x121,0x11c,0x118,
        0x114,0x10f,0x10b,0x107,0x103,0x0ff,0x0fb,0x0f8,0x0f4,0x0f0,0x0ec,0x0e9,0x0e5,0x0e2,0x0de,0x0db,
        0x0d7,0x0d4,0x0d1,0x0cd,0x0ca,0x0c7,0x0c4,0x0c1,0x0be,0x0bb,0x0b8,0x0b5,0x0b2,0x0af,0x0ac,0x0a9,
        0x0a7,0x0a4,0x0a1,0x09f,0x09c,0x099,0x097,0x094,0x092,0x08f,0x08d,0x08a,0x088,0x086,0x083,0x081,
        0x07f,0x07d,0x07a,0x078,0x076,0x074,0x072,0x070,0x06e,0x06c,0x06a,0x068,0x066,0x064,0x062,0x060,
        0x05e,0x05c,0x05b,0x059,0x057,0x055,0x053,0x052,0x050,0x04e,0x04d,0x04b,0x04a,0x048,0x046,0x045,
        0x043,0x042,0x040,0x03f,0x03e,0x03c,0x03b,0x039,0x038,0x037,0x035,0x034,0x033,0x031,0x030,0x02f,
        0x02e,0x02d,0x02b,0x02a,0x029,0x028,0x027,0x026,0x025,0x024,0x023,0x022,0x021,0x020,0x01f,0x01e,
        0x01d,0x01c,0x01b,0x01a,0x019,0x018,0x017,0x017,0x016,0x015,0x014,0x014,0x013,0x012,0x011,0x011,
        0x010,0x00f,0x00f,0x00e,0x00d,0x00d,0x00c,0x00c,0x00b,0x00a,0x00a,0x009,0x009,0x008,0x008,0x007,
        0x007,0x007,0x006,0x006,0x005,0x005,0x005,0x004,0x004,0x004,0x003,0x003,0x003,0x002,0x002,0x002,
        0x002,0x001,0x001,0x001,0x001,0x001,0x001,0x001,0x000,0x000,0x000,0x000,0x000,0x000,0x000,0x000
    ];

    // 10-bit mantissas with implied leading bit, reversed and pre-shifted (as in YMFM)
    var POWER_TABLE = (function() {
        var t = [
            0x3fa,0x3f5,0x3ef,0x3ea,0x3e4,0x3df,0x3da,0x3d4,0x3cf,0x3c9,0x3c4,0x3bf,0x3b9,0x3b4,0x3ae,0x3a9,
            0x3a4,0x39f,0x399,0x394,0x38f,0x38a,0x384,0x37f,0x37a,0x375,0x370,0x36a,0x365,0x360,0x35b,0x356,
            0x351,0x34c,0x347,0x342,0x33d,0x338,0x333,0x32e,0x329,0x324,0x31f,0x31a,0x315,0x310,0x30b,0x306,
            0x302,0x2fd,0x2f8,0x2f3,0x2ee,0x2e9,0x2e5,0x2e0,0x2db,0x2d6,0x2d2,0x2cd,0x2c8,0x2c4,0x2bf,0x2ba,
            0x2b5,0x2b1,0x2ac,0x2a8,0x2a3,0x29e,0x29a,0x295,0x291,0x28c,0x288,0x283,0x27f,0x27a,0x276,0x271,
            0x26d,0x268,0x264,0x25f,0x25b,0x257,0x252,0x24e,0x249,0x245,0x241,0x23c,0x238,0x234,0x230,0x22b,
            0x227,0x223,0x21e,0x21a,0x216,0x212,0x20e,0x209,0x205,0x201,0x1fd,0x1f9,0x1f5,0x1f0,0x1ec,0x1e8,
            0x1e4,0x1e0,0x1dc,0x1d8,0x1d4,0x1d0,0x1cc,0x1c8,0x1c4,0x1c0,0x1bc,0x1b8,0x1b4,0x1b0,0x1ac,0x1a8,
            0x1a4,0x1a0,0x19c,0x199,0x195,0x191,0x18d,0x189,0x185,0x181,0x17e,0x17a,0x176,0x172,0x16f,0x16b,
            0x167,0x163,0x160,0x15c,0x158,0x154,0x151,0x14d,0x149,0x146,0x142,0x13e,0x13b,0x137,0x134,0x130,
            0x12c,0x129,0x125,0x122,0x11e,0x11b,0x117,0x114,0x110,0x10c,0x109,0x106,0x102,0x0ff,0x0fb,0x0f8,
            0x0f4,0x0f1,0x0ed,0x0ea,0x0e7,0x0e3,0x0e0,0x0dc,0x0d9,0x0d6,0x0d2,0x0cf,0x0cc,0x0c8,0x0c5,0x0c2,
            0x0be,0x0bb,0x0b8,0x0b5,0x0b1,0x0ae,0x0ab,0x0a8,0x0a4,0x0a1,0x09e,0x09b,0x098,0x094,0x091,0x08e,
            0x08b,0x088,0x085,0x082,0x07e,0x07b,0x078,0x075,0x072,0x06f,0x06c,0x069,0x066,0x063,0x060,0x05d,
            0x05a,0x057,0x054,0x051,0x04e,0x04b,0x048,0x045,0x042,0x03f,0x03c,0x039,0x036,0x033,0x030,0x02d,
            0x02a,0x028,0x025,0x022,0x01f,0x01c,0x019,0x016,0x014,0x011,0x00e,0x00b,0x008,0x006,0x003,0x000
        ];
        var res = new Uint16Array(256);
        for (var i = 0; i < 256; ++i) res[i] = (t[i] | 0x400) << 2;
        return res;
    })();

    // 10-bit phase, sign in bit 15
    var WAVEFORM = (function() {
        var res = new Uint16Array(0x400);
        for (var i = 0; i < 0x400; ++i) {
            var input = (i & 0x100) ? ~i : i;
            res[i] = SIN_TABLE[input & 0xff] | (((i >> 9) & 1) << 15);
        }
        return res;
    })();


    // Savestate  -------------------------------------------

    function saveOperator(op) {
        return [ op.phaseAcc, op.envAttenuation, op.envState, op.ssgInverted ? 1 : 0, op.keyState ? 1 : 0, op.keyOnLive ];
    }

    function loadOperator(op, s) {
        op.phaseAcc = s[0]; op.envAttenuation = s[1]; op.envState = s[2]; op.ssgInverted = !!s[3]; op.keyState = !!s[4]; op.keyOnLive = s[5];
    }

    this.saveState = function() {
        var fmChans = [];
        for (var c = 0; c < 6; ++c) {
            var ch = channels[c];
            fmChans.push({ f0: ch.feedback0, f1: ch.feedback1, fi: ch.feedbackIn,
                o: [ saveOperator(ch.ops[0]), saveOperator(ch.ops[1]), saveOperator(ch.ops[2]), saveOperator(ch.ops[3]) ] });
        }
        var aChans = [];
        for (c = 0; c < 6; ++c) {
            var a = adpcmAChannels[c];
            aChans.push([ a.curAddress, a.accumulator, a.stepIndex, a.playing ? 1 : 0, a.curNibble, a.curByte ]);
        }
        return {
            n: name, ac: audioConnected,
            r: wmsx.Util.storeInt8BitArrayToStringBase64(regs),
            fc: fmChans, ec: envCounter, lc: lfoCounter, la: lfoAm,
            st: statusReg, ps: prescale, tr: timerRunning.slice(0), tm: timerRemaining.slice(0), tc: totalClocks, mc: masterClockAcc,
            ar: wmsx.Util.storeInt8BitArrayToStringBase64(adpcmARegs), aa: aChans,
            br: wmsx.Util.storeInt8BitArrayToStringBase64(adpcmBRegs),
            bm: wmsx.Util.compressInt8BitArrayToStringBase64(adpcmBRam),
            bs: [ adbStatus, adbPlaying ? 1 : 0, emuAddress, adbAddress, adbPosition, adbNibble, adbCurByte, adbDummyRead, adbAccumulator, adbPrevAccum, adbStep, adbCpuWriteActive ? 1 : 0 ],
            sr: wmsx.Util.storeInt8BitArrayToStringBase64(ssgRegs),
            al: addressLatch, ie: irqEnable, fl: flagControl
        };
    };

    this.loadState = function(s) {
        this.reset();
        name = s.n;
        audioConnected = s.ac;
        regs = wmsx.Util.restoreStringBase64ToInt8BitArray(s.r, regs);
        for (var c = 0; c < 6; ++c) {
            var ch = channels[c], cs = s.fc[c];
            ch.feedback0 = cs.f0; ch.feedback1 = cs.f1; ch.feedbackIn = cs.fi;
            for (var o = 0; o < 4; ++o) loadOperator(ch.ops[o], cs.o[o]);
        }
        envCounter = s.ec; lfoCounter = s.lc; lfoAm = s.la;
        statusReg = s.st; setClockPrescale(s.ps);
        timerRunning = s.tr.slice(0); timerRemaining = s.tm.slice(0); totalClocks = s.tc; masterClockAcc = s.mc;
        adpcmARegs = wmsx.Util.restoreStringBase64ToInt8BitArray(s.ar, adpcmARegs);
        for (c = 0; c < 6; ++c) {
            var a = adpcmAChannels[c], as = s.aa[c];
            a.curAddress = as[0]; a.accumulator = as[1]; a.stepIndex = as[2]; a.playing = !!as[3]; a.curNibble = as[4]; a.curByte = as[5];
        }
        adpcmBRegs = wmsx.Util.restoreStringBase64ToInt8BitArray(s.br, adpcmBRegs);
        adpcmBRam = wmsx.Util.uncompressStringBase64ToInt8BitArray(s.bm, adpcmBRam);
        var b = s.bs;
        adbStatus = b[0]; adbPlaying = !!b[1]; emuAddress = b[2]; adbAddress = b[3]; adbPosition = b[4]; adbNibble = b[5];
        adbCurByte = b[6]; adbDummyRead = b[7]; adbAccumulator = b[8]; adbPrevAccum = b[9]; adbStep = b[10]; adbCpuWriteActive = !!b[11];
        ssgRegs = wmsx.Util.restoreStringBase64ToInt8BitArray(s.sr, ssgRegs);
        addressLatch = s.al; irqEnable = s.ie; flagControl = s.fl;
        irqMask = irqEnable & ~flagControl & 0x1f;
        modified = true;
        setResetStatus(0, 0);
        if (audioConnected) connectAudio(); else disconnectAudio();
    };


    init();


    this.eval = function(str) {
        return eval(str);
    };

};
