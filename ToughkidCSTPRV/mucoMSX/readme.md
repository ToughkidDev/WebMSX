# mucoMSX

WebMSX 6.0.8 기반 웹 MSX 에뮬레이터입니다. 페이지 장식 없이 에뮬레이터 화면만 표시합니다.

## 장착된 확장 카트리지

| 슬롯 | 카트리지 | 내용 |
|---|---|---|
| 카트리지 슬롯 1 | **MegaFlashROM SCC+ SD** | 8MB 플래시(프리플래시 펌웨어: Nextor, ROM 디스크, MultiMente), SCC-I, PSG, 512KB RAM 매퍼, SD 카드 2개 |
| 카트리지 슬롯 2 | **Makoto (YM2608 OPNA)** | FM 6채널, SSG 3채널, 리듬 6종, ADPCM-B(256KB RAM), I/O 포트 `0x14`-`0x17` |

- MegaFlashROM의 펌웨어는 `systemroms/extensions/mfrsd.rom.gz`에서 읽습니다.
- **SD 카드 1, 2**에는 기본으로 `sdcards/sd1.img`, `sdcards/sd2.img`가 꽂힙니다. Nextor 2.1 FDISK 형식(MBR + FAT16 파티션 1개, 타입 `0x06`)으로 포맷된 빈 64MB 이미지이며, 부팅하면 B:, C: 드라이브로 잡힙니다.
- SD 이미지에 쓴 내용은 브라우저 메모리에만 남고, 페이지를 다시 열면 초기화됩니다.
- 하단 바의 하드디스크 아이콘으로 이미지를 넣으면 SD 카드 1 대신 그 이미지를 씁니다.
- `sdcards/mknextorsd.py`로 같은 형식의 이미지를 다시 만들 수 있습니다.
- 플래시에 쓴 내용은 페이지를 다시 열면 초기화됩니다. 보존하려면 카트리지 메뉴의 Flash 저장 기능으로 파일로 받아 두세요.
- 설정 메뉴(톱니바퀴)의 확장 목록에서 두 카트리지를 켜고 끌 수 있습니다.

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
| `?EXTENSIONS.MAKOTO=0` | Makoto 빼고 실행 |
| `?EXTENSIONS.MEGAFLASHSD=0` | MegaFlashROM SCC+ SD 빼고 실행 |

전체 옵션은 저장소 루트의 [README](../../README.md)를 참고하세요.

## 구성

- `index.html`: 에뮬레이터 화면만 담은 페이지. 두 확장 카트리지를 기본 장착하도록 설정합니다.
- `wmsx.js`: Makoto와 MegaFlashROM SCC+ SD 지원을 추가해 다시 빌드한 WebMSX embedded 빌드 (에뮬레이터, BIOS 포함)
- `systemroms/`: 확장 카트리지용 시스템 ROM 파일
- `sdcards/`: MegaFlashROM SCC+ SD용 SD 카드 이미지와 생성 스크립트

## 원작 및 저작권

- 이 에뮬레이터는 **Paulo Augusto Peccin**이 만든 **[WebMSX](https://github.com/ppeccin/WebMSX)** 6.0.8을 기반으로 합니다.
- WebMSX: Copyright 2015 by Paulo Augusto Peccin. 모든 권리는 원작자에게 있습니다.
- `wmsx.js`는 WebMSX 소스에 확장 카트리지 지원을 추가해 다시 빌드한 것이며, 파일 머리말의 저작권 문구를 유지합니다.
- Makoto(YM2608)와 MegaFlashROM SCC+ SD 구현은 [openMSX](https://github.com/openMSX/openMSX)(GPL-2.0)의 코드를 이식한 것입니다. YM2608의 FM/ADPCM 엔진은 Aaron Giles의 [ymfm](https://github.com/aaronsgiles/ymfm)(BSD-3-Clause)에서 시작되었고, 리듬 샘플 데이터는 Jarek Burczynski, Tatsuyuki Satoh의 MAME fmopn 코어(GPL-2.0 이상)에서 재구성된 것입니다.
- MegaFlashROM SCC+ SD 펌웨어(`mfrsd.rom.gz`)의 저작권은 Manuel Pazos 및 Nextor 저작자(Konamiman)에게 있습니다.
- 함께 포함된 MSX 시스템 ROM의 저작권은 각 권리자에게 있습니다.
- mucoMSX는 WebMSX 원작자 및 MSX Licensing Corporation과 관련이 없는 비공식 프로젝트입니다.
