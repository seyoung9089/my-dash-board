# 오늘 한눈에

할 일(planning-web), 학교 날씨, 관점을 넓혀 줄 뉴스 요약을 한 화면에 보여 주는 대시보드입니다.
planning-web과는 별개 사이트이고, planning-web의 데이터는 **읽기만** 합니다.

| 영역 | 가져오는 곳 |
| --- | --- |
| 할 일·오늘 일정 | planning-web Supabase (같은 계정으로 로그인, 본인 데이터만 보임) |
| 날씨 | Open-Meteo, 충남 금산군 남일면 근처 좌표 |
| 뉴스 | 한겨레·경향신문(문화·과학), BBC 코리아 RSS → `functions/api/news.js`가 6개 고르고 Workers AI로 요약 (3시간마다 갱신) |

## 배포 (Cloudflare Pages)

1. Workers & Pages → 만들기 → Pages → Git에 연결 → 이 저장소 선택
2. 빌드 명령: 비워 두기 / 빌드 출력 디렉터리: `/`
3. 배포 후 **설정 → 바인딩 → 추가 → Workers AI**, 변수 이름 `AI` → 저장 후 다시 배포

AI 바인딩이 없어도 사이트는 동작하고, 뉴스는 기사 원문 요약문으로 보입니다.
