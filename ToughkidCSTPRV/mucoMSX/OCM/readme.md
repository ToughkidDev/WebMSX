# OCM

MSX++ OCM-PLD (1chipMSX) 모드에서 쓰는 KdL의 OCM 파일입니다.

- `20261101 OCM-SDBIOS Pack v3.8.4 by KdL.7z`, `20261101 OCM-EXTRA Pack v3.1.1 by KdL.7z`: 원본 팩
- `sdbios/OCM-BIOS.DAT`: OCM 기종이 쓰는 OCM-BIOS. SDBIOS 팩의 `sdbios-n38-wifi/msxplusplus/n38msxpp.yen`(Nextor, MSX++ 로고, 일본 키보드)
- `sdbios/*.ROM`: OCM-BIOS.DAT를 슬롯별로 나눈 ROM (`makesdbios.py`로 생성)

| 파일 | 블록 | 슬롯 |
|---|---|---|
| `MEGASD.ROM` | 01-08 | 3-2 내장 MegaSD (ESE-RAM) |
| `MSX2P.ROM` | 09-10 | 0-0 메인 BIOS |
| `XBASIC.ROM` | 11 | 3-3 (4000h) |
| `MSX2PMUS.ROM` | 12 | 0-2 (4000h) MSX-MUSIC |
| `MSX2PEXT.ROM` | 13 | 3-1 (0000h) 서브 ROM |
| `MSXKANJI.ROM` | 14-15 | 3-1 (4000h) 한자 BASIC |
| `OPT.ROM` | 16 | 0-3 (4000h) 옵션 ROM (MSX++ 로고) |

한자 폰트(블록 17-32)는 WebMSX 내장 한자 ROM과 같아서 따로 나누지 않습니다.

다른 OCM-BIOS로 바꾸려면: `python3 makesdbios.py <OCM-BIOS.DAT> sdbios`

팩의 내용은 원 배포처의 안내에 따라 상업적 목적이 아닌 개인적 용도로만 쓸 수 있습니다.
