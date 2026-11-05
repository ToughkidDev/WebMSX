# mucoMSX

WebMSX 6.0.8 기반 웹 MSX 에뮬레이터입니다. 페이지 장식 없이 에뮬레이터 화면만 표시합니다.

## 장착된 확장 카트리지

| 슬롯 | 카트리지 | 내용 |
|---|---|---|
| 카트리지 슬롯 1 | **MegaFlashROM SCC+ SD** | 8MB 플래시(프리플래시 펌웨어: Nextor, ROM 디스크, MultiMente), SCC-I, PSG, 512KB RAM 매퍼, SD 카드 2개 |
| 카트리지 슬롯 2 | **Makoto (YM2608 OPNA)** | FM 6채널, SSG 3채널, 리듬 6종, ADPCM-B(256KB RAM), I/O 포트 `0x14`-`0x17` |

- MegaFlashROM의 펌웨어는 `systemroms/extensions/mfrsd.rom.gz`에서 읽습니다.
- **SD 카드 1, 2**에는 기본으로 `sdcards/sd1.img`, `sdcards/sd2.img`가 꽂힙니다. Nextor 2.1 FDISK 형식(MBR + FAT16 파티션 1개, 타입 `0x06`)으로 포맷된 64MB 이미지입니다.
- SD 카드 1에는 플래시 ROM 디스크의 내용(Nextor, COMMAND2.COM, MultiMente 등)이 그대로 복사되어 있고, 루트의 `NEXTOR.DAT` 덕분에 **A: 드라이브로 잡혀 SD 카드 1에서 부팅**합니다. 드라이브 배치는 A: SD 카드 1, B: ROM 디스크, C: SD 카드 2(빈 디스크), D: 플로피입니다.
- SD 이미지에 쓴 내용은 브라우저 메모리에만 남고, 페이지를 다시 열면 초기화됩니다.
- 하단 바의 하드디스크 아이콘으로 이미지를 넣으면 SD 카드 1 대신 그 이미지를 씁니다.
- `sdcards/mknextorsd.py`로 같은 형식의 빈 이미지를 만들고(`python3 mknextorsd.py 64 sd1.img sd2.img`), `sdcards/copyromdisk.py`로 ROM 디스크 내용과 `NEXTOR.DAT`를 넣을 수 있습니다(`python3 copyromdisk.py ../systemroms/extensions/mfrsd.rom.gz sd1.img`).
- 플래시에 쓴 내용은 페이지를 다시 열면 초기화됩니다. 보존하려면 카트리지 메뉴의 Flash 저장 기능으로 파일로 받아 두세요.
- 설정 메뉴(톱니바퀴)의 확장 목록에서 두 카트리지를 켜고 끌 수 있습니다.

## Z80B CPU 스위치

Z80B 스위치를 켜면 항상 **Panasonic FS-A1WX**(Z80B 5.37MHz)로 부팅합니다.

- 하단 바의 톱니바퀴 → **Quick Options**의 **Z80B CPU** 항목에서 켜고 끕니다. 켜면 FS-A1WX로 바뀌어 다시 부팅하고, 끄면 켜기 전의 기종으로 돌아가 다시 부팅합니다.
- 설정은 브라우저에 저장되어, 켜 두면 다음에 열 때도 FS-A1WX로 부팅합니다.
- Machine Select에서 **Panasonic FS-A1WX (Z80B)**를 고르면 스위치가 켜지고, 다른 기종을 고르면 꺼집니다.
- MSX는 21.48MHz 마스터 클럭을 나눠 CPU 클럭을 만들기 때문에(÷6 = 3.58MHz, ÷4 = 5.37MHz), Z80B는 칩의 최대 정격인 6MHz가 아니라 5.37MHz로 동작합니다.
- Z80 CPU Clock을 2x(7.16MHz) 이상으로 직접 올리면 그 값이 우선합니다.
- 파나소닉 터보 포트(스위치드 I/O 장치 08, 포트 41H)의 bit 0은 실제 기계처럼 현재 CPU 속도를 돌려줍니다. Z80B는 항상 5.37MHz 이상으로 돌므로 소프트웨어가 터보를 켜지 않았어도 고속(0)으로 읽힙니다. 그래서 이 포트로 속도를 확인하는 프로그램(MUBScope, MUCScope `/N` 등)도 Z80B로 인식합니다.

FS-A1WX 구성:

| 항목 | 내용 |
|---|---|
| BIOS, 서브 ROM, 한자 폰트 | FS-A1WX의 실제 ROM (WebMSX 내장 MSX2+ 일본판 ROM과 SHA1이 같음) |
| CPU | Z80B 5.37MHz |
| RAM | 64KB 메모리 매퍼 |
| 디스크 드라이브 | 1대 |
| 한자 BASIC, MSX-MUSIC | WebMSX 내장 ROM (FS-A1WX 전용 ROM 아님) |
| A1 Cockpit 내장 소프트웨어 | 없음 (ROM 파일 없음) |

## MSX++ OCM-PLD (1chipMSX) 모드

Machine Select에서 **MSX++ OCM-PLD (1chipMSX)**를 고르거나 URL에 `?MACHINE=OCM`을 붙이면, [OCM-PLD](https://github.com/ToughkidDev/ocm-pld-dev) v3.9.2 펌웨어를 올린 1chipMSX처럼 동작합니다.

- **스위치드 I/O 포트 `#40~#4F` (Revision 12)**: 장치 ID `#D4`(MSX++)와 `#08`(파나소닉 터보)를 OCM-PLD의 `swioports.vhd` 그대로 구현했습니다. 모든 레지스터 읽기/쓰기, 스마트 커맨드(`#00~#FF`), 잠금 마스크, 콜드/웜 리셋 규칙이 같습니다. 실제 `SETSMART.COM`으로 확인했습니다.
- **OCM-SDBIOS로 부팅**: `OCM/sdbios/`의 진짜 OCM-BIOS(OCM-SDBIOS Pack v3.8.4의 `n38msxpp.yen`: MSX++ 로고, Nextor, 일본 키보드)를 OCM-PLD IPL-ROM과 같은 슬롯에 넣어 부팅합니다. MSX++ 로고와 메모리 크기가 표시되고 내장 MegaSD(Nextor 커널 2.1.4)로 DOS가 뜹니다.
- **슬롯 구성**: 0-0 메인 BIOS, 0-2 MSX-MUSIC, 0-3 옵션 ROM(MSX++ 로고), 1/2 외부 카트리지 또는 내장 ESE-SCC, 3-0 메모리 매퍼 2048KB, 3-1 서브 ROM + 한자 BASIC, 3-2 내장 MegaSD, 3-3 XBASIC, 한자 ROM JIS1+JIS2. 플로피 드라이브는 없습니다.
- **내장 MegaSD (3-2)**: OCM-PLD의 `megasd.v`를 옮겼습니다. ESE-RAM 1024KB에 OCM-BIOS의 MegaSD 드라이버(블록 01~08)를 싣고, SPI로 SD 카드를 읽고 씁니다. SD 카드는 `sdcards/ocmsd.img`(Nextor FAT16 64MB)입니다. SDCREATE처럼 OCM-BIOS.DAT, MSX-DOS 2, Nextor, `HELP\`, `UTILS\`(SETSMART, OCMINFO, FIRMINFO, CPUSPEED 등 91개)를 담았습니다. 하단 바의 하드디스크 아이콘으로 이미지를 넣으면 그 이미지를 대신 씁니다.
- **mucoMSX에서 OCM을 고르면** MegaFlashROM SCC+ SD를 빼고 슬롯 1을 비웁니다(Makoto는 그대로). MegaFlashROM의 Nextor 커널(2.1.0 alpha 2)과 내장 MegaSD 드라이버를 함께 쓰면 부팅 중에 멈추기 때문입니다. MegaFlashROM과 함께 쓰려면 `?MACHINE=OCM&OCM_DIP_SW=0`으로 내장 MegaSD(DIP 스위치 8)를 끄고, 설정 메뉴에서 MegaFlashROM을 켜세요.
- **에뮬레이터에 실제로 적용되는 스마트 커맨드**

| 기능 | 명령 |
|---|---|
| CPU 클럭: 3.58MHz, 터보 파나 5.37MHz, 커스텀 4.10~8.06MHz, 터보 파나 리디렉션 | `#01~#0A`, `#3F~#41`, `#D5` |
| 내장 슬롯: SCC-I(ESE-MegaSCC+ 2048KB), ASCII-8K/16K(ESE-MegaRAM), 리니어 모드, 확장 MegaROM 읽기 | `#0D~#14`, `#83~#86`, `#58~#59` |
| VDP 고속 모드 | `#1B~#1C` |
| 내장 믹서: 마스터/PSG/SCC-I/OPLL 음량, 오디오 프리셋 (외부 카트리지 소리는 그대로) | `#24~#26`, `#44~#46`, `#B0~#CF` |
| NTSC/PAL 강제 | `#D0~#D2` |
| 매퍼 2048/4096KB, 내장 MegaSD 켜기/끄기 (웜 리셋 때 적용) | `#1D~#1E`, `#FC`, `#FE` |
| 콜드 리셋, 웜 리셋, 전체 기본값 복원 | `#FB`, `#FD`, `#FF` |

- 나머지 명령(비디오 출력 방식, 스캔라인, LED, 키보드 배열, 세로 오프셋 등)은 실제 기기처럼 상태가 저장되고 포트로 읽히지만, 화면이나 키보드에는 반영되지 않습니다.
- 물리 DIP 스위치는 URL 옵션 `OCM_DIP_SW`(비트 0~7 = DIP-SW1~8, 기본값 `0x80` = 내장 MegaSD만 ON)로 정합니다. F12, PRTSCR 같은 전환 키는 에뮬레이션하지 않습니다.
- 다른 OCM-BIOS를 쓰려면 `python3 OCM/makesdbios.py <OCM-BIOS.DAT> OCM/sdbios`로 다시 나눕니다(OCM-PLD v3.4 이후의 MSX-BIOS 구성). `OCM_SDBIOS_PATH`를 비우면(`?OCM_SDBIOS_PATH=`) 예전처럼 WebMSX 내장 MSX2+ BIOS와 Nextor로 부팅합니다.
- IPL-ROM(SD 카드에서 BIOS를 읽어 오는 과정), EPCS 플래시, 시스템 타이머, turbo R PCM, 엑스트라 매퍼(0-1), Slot-0 프라이머리 모드는 구현하지 않았습니다.

## ▶ 실행하기

- **[바로 실행 (GitHub Pages)](https://toughkiddev.github.io/WebMSX/ToughkidCSTPRV/mucoMSX/)**
- [바로 실행 (raw.githack, 설정 없이 동작)](https://raw.githack.com/ToughkidDev/WebMSX/toughkiddev/mucomsxAlly/ToughkidCSTPRV/mucoMSX/index.html)

## 다른 페이지에 넣기

`iframe`으로 다른 웹페이지 안에 에뮬레이터 화면만 넣을 수 있습니다.

```html
<iframe src="https://toughkiddev.github.io/WebMSX/ToughkidCSTPRV/mucoMSX/"
        width="700" height="560" style="border: 0;" allowfullscreen></iframe>
```

## 실행 옵션

URL 뒤에 파라미터를 붙여 기종이나 미디어를 지정할 수 있습니다.

| 예시 | 설명 |
|---|---|
| `?MACHINE=MSX2PJ` | MSX2+ 일본판으로 실행 |
| `?MACHINE=MSXTRJ` | MSX turbo R 일본판으로 실행 |
| `?ROM=<URL>` | 카트리지 ROM 로드 |
| `?DISK=<URL>` | 디스크 이미지 로드 |
| `?HARDDISK=<URL>` | SD 카드 1에 디스크 이미지 로드 |
| `?MEGAFLASHSD_SD1_URL=<URL>` | SD 카드 1 이미지 지정 (`.gz` 가능) |
| `?MEGAFLASHSD_SD2_URL=<URL>` | SD 카드 2 이미지 지정 (`.gz` 가능) |
| `?Z80B_MODE=1` | Z80B 스위치를 켜고 FS-A1WX로 실행 (`0`이면 끔. 저장된 설정보다 우선) |
| `?MACHINE=FSA1WX` | FS-A1WX로 실행 |
| `?MACHINE=OCM` | MSX++ OCM-PLD (1chipMSX)로 실행 |
| `?OCM_SD_URL=<URL>` | OCM 내장 MegaSD 카드 이미지 지정 (`.gz` 가능) |
| `?MACHINE=OCM&OCM_DIP_SW=0x81` | OCM 물리 DIP 스위치 지정 (예: DIP-SW1 커스텀 속도 + DIP-SW8 MegaSD) |
| `?EXTENSIONS.MAKOTO=0` | Makoto 빼고 실행 |
| `?EXTENSIONS.MEGAFLASHSD=0` | MegaFlashROM SCC+ SD 빼고 실행 |

전체 옵션은 저장소 루트의 [README](../../README.md)를 참고하세요.

## 구성

- `index.html`: 에뮬레이터 화면만 담은 페이지. 두 확장 카트리지를 기본 장착하도록 설정합니다.
- `wmsx.js`: Makoto와 MegaFlashROM SCC+ SD 지원을 추가해 다시 빌드한 WebMSX embedded 빌드 (에뮬레이터, BIOS 포함)
- `systemroms/`: 확장 카트리지용 시스템 ROM 파일
- `sdcards/`: SD 카드 이미지(`sd1.img`, `sd2.img`: MegaFlashROM SCC+ SD용, `ocmsd.img`: OCM 내장 MegaSD용)와 생성 스크립트(`mknextorsd.py`, `copyromdisk.py`, `addfiles.py`)
- `OCM/`: OCM-SDBIOS Pack, OCM-EXTRA Pack 원본과, OCM 기종이 쓰는 OCM-BIOS(`sdbios/`) 및 분할 스크립트(`makesdbios.py`)

## 원작 및 저작권

- 이 에뮬레이터는 **Paulo Augusto Peccin**이 만든 **[WebMSX](https://github.com/ppeccin/WebMSX)** 6.0.8을 기반으로 합니다.
- WebMSX: Copyright 2015 by Paulo Augusto Peccin. 모든 권리는 원작자에게 있습니다.
- `wmsx.js`는 WebMSX 소스에 확장 카트리지 지원을 추가해 다시 빌드한 것이며, 파일 머리말의 저작권 문구를 유지합니다.
- Makoto(YM2608)와 MegaFlashROM SCC+ SD 구현은 [openMSX](https://github.com/openMSX/openMSX)(GPL-2.0)의 코드를 이식한 것입니다. YM2608의 FM/ADPCM 엔진은 Aaron Giles의 [ymfm](https://github.com/aaronsgiles/ymfm)(BSD-3-Clause)에서 시작되었고, 리듬 샘플 데이터는 Jarek Burczynski, Tatsuyuki Satoh의 MAME fmopn 코어(GPL-2.0 이상)에서 재구성된 것입니다.
- MSX++ OCM-PLD 모드의 스위치드 I/O 포트와 ESE-SCC는 OCM-PLD의 `swioports.vhd`(Copyright (c) 2011-2025 KdL)와 `megaram.vhd`(Copyright (c) 2006 Kazuhiro Tsujikawa (ESE Artists' factory), modified by t.hara / KdL)를 JavaScript로 옮긴 것입니다. 원본 라이선스에 따라 다음 문구를 함께 배포합니다.
  > Redistribution and use of this source code or any derivative works, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. 3. Redistributions may not be sold, nor may they be used in a commercial product or activity without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
- OCM 내장 MegaSD는 OCM-PLD의 `megasd.v`(Copyright (c) 2022 t.hara)를 옮긴 것이며, 위와 같은 라이선스 조건을 따릅니다.
- `OCM/`의 OCM-SDBIOS Pack v3.8.4와 OCM-EXTRA Pack v3.1.1, 그리고 거기서 꺼낸 `OCM/sdbios/`와 `sdcards/ocmsd.img`의 내용은 KdL이 배포한 것입니다. 원 배포처의 안내에 따라 상업적 목적이 아닌 개인적 용도로만 쓸 수 있습니다. Nextor는 Konamiman, MSX-DOS 2는 ASCII, MegaSDHC 드라이버 패치는 Yuukun-OKEI 등 각 구성 요소와 유틸리티의 권리는 해당 저작자에게 있습니다.
- MegaFlashROM SCC+ SD 펌웨어(`mfrsd.rom.gz`)의 저작권은 Manuel Pazos 및 Nextor 저작자(Konamiman)에게 있습니다.
- 함께 포함된 MSX 시스템 ROM의 저작권은 각 권리자에게 있습니다.
- mucoMSX는 WebMSX 원작자 및 MSX Licensing Corporation과 관련이 없는 비공식 프로젝트입니다.
