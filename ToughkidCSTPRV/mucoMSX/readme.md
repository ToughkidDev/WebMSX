# mucoMSX

WebMSX 6.0.8 기반 웹 MSX 에뮬레이터입니다. 페이지 장식 없이 에뮬레이터 화면만 표시합니다.

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

전체 옵션은 저장소 루트의 [README](../../README.md)를 참고하세요.

## 구성

- `index.html`: 에뮬레이터 화면만 담은 페이지
- `wmsx.js`: WebMSX embedded 빌드 (에뮬레이터, BIOS 포함)

## 원작 및 저작권

- 이 에뮬레이터는 **Paulo Augusto Peccin**이 만든 **[WebMSX](https://github.com/ppeccin/WebMSX)** 6.0.8을 기반으로 합니다.
- WebMSX: Copyright 2015 by Paulo Augusto Peccin. 모든 권리는 원작자에게 있습니다.
- `wmsx.js`는 원본 빌드를 수정 없이 사용하며, 파일 머리말의 저작권 문구를 유지합니다.
- 함께 포함된 MSX 시스템 ROM의 저작권은 각 권리자에게 있습니다.
- mucoMSX는 WebMSX 원작자 및 MSX Licensing Corporation과 관련이 없는 비공식 프로젝트입니다.
