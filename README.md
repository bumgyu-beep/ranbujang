# 란부장

란코 스타리아·사무실 비품 체크 사이트. 화면은 GitHub Pages, 데이터는 Firebase(Firestore), 구글 시트 '란코 비품 메뉴판 > 자체비품'과는 시트 쪽 Apps Script가 맞춥니다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html` | 사이트 전체 (맨 위에 파이어베이스 설정값, 시트 연동 주소) |
| `firestore.rules` | 팀 비밀번호로 들어온 기기만 읽고 쓰게 하는 규칙 |
| `apps-script/Code.gs` | 시트 ↔ 란부장 동기화, 팀 비밀번호 설정 |
| `apps-script/appsscript.json` | Apps Script 권한 설정 |

## 처음 설정

1. **Firestore 규칙**: 파이어베이스 콘솔 → Firestore Database → 규칙 탭 → `firestore.rules` 내용을 붙여넣고 게시
2. **시트 스크립트**: 시트에서 확장 프로그램 → Apps Script
   - `Code.gs` 내용을 붙여넣고 맨 위 `PROJECT_ID`, `TEAM_PASSWORD` 채우기
   - 왼쪽 톱니바퀴(프로젝트 설정) → "appsscript.json 매니페스트 파일 표시" 켜기 → `appsscript.json` 내용 붙여넣기
   - 위쪽 함수 목록에서 `setup` 선택 → 실행 → 권한 허용
   - 배포 → 새 배포 → 유형 '웹 앱' → 실행: 나, 액세스: 모든 사용자 → 배포 → 나온 웹 앱 URL을 `index.html`의 `SYNC_URL`에 넣기
3. **GitHub Pages**: 저장소 Settings → Pages → Branch `main` / `(root)` → Save

## 동기화 규칙

- 란부장에서 바꾼 수량·최소재고·비고는 시트 '기존 재고' 칸으로, 시트에서 바꾼 것은 란부장으로 들어갑니다.
- 시트에서 '촬영 후 재고'를 적으면 란부장에 반영되고 시트는 '기존 재고' 한 칸으로 정리됩니다.
- 양쪽에서 같은 칸을 다르게 고치면 란부장 값을 따릅니다.
- 란부장에서 새로 만든 비품은 시트 맨 아래에 붙습니다.
- 맞추는 시점: 란부장 저장 직후, 시트를 고친 직후, 그리고 5분마다.

## 비밀번호 바꾸기

Apps Script에서 `TEAM_PASSWORD`를 고치고 `changePassword` 실행. 이미 들어와 있는 기기는 계속 쓸 수 있습니다.
