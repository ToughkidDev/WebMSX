# mucoMSX

WebMSX 6.0.8 기반 웹 MSX 에뮬레이터입니다. 아래 링크를 누르면 브라우저에서 바로 실행됩니다.

## ▶ 실행하기

- **[바로 실행 (GitHub Pages)](https://toughkiddev.github.io/WebMSX/ToughkidCSTPRV/mucoMSX/)**
- [바로 실행 (raw.githack, 설정 없이 동작)](https://raw.githack.com/ToughkidDev/WebMSX/toughkiddev/mucomsxAlly/ToughkidCSTPRV/mucoMSX/index.html)

## 실행 옵션

URL 뒤에 파라미터를 붙여 기종이나 미디어를 지정할 수 있습니다.

| 예시 | 설명 |
|---|---|
| `?MACHINE=MSX2PJ` | MSX2+ 일본판으로 실행 |
| `?MACHINE=MSXTRJ` | MSX turbo R 일본판으로 실행 |
| `?ROM=<URL>` | 카트리지 ROM 로드 |
| `?DISK=<URL>` | 디스크 이미지 로드 |

전체 옵션은 저장소 루트의 [README](../../README.md)를 참고하세요.

## 구성

- `index.html`: WebMSX standalone 빌드 (에뮬레이터, BIOS 포함)
- `manifest.webapp`, `cache.manifest`, `images/`: 웹앱 설치용 파일
