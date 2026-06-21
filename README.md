# Side Room

사이드 프로젝트 팀이 아이디어, 질문, 결정, 공지를 비공개로 나누고 기록하는 작은 협업 공간입니다.

## 실행

Node.js 18 이상에서:

```powershell
npm start
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다.

기본 초대 코드는 `SIDE-TOGETHER`입니다. 실제 팀에서 사용할 때는 환경 변수로 변경하세요.

```powershell
$env:INVITE_CODE="우리팀만의-초대코드"
npm start
```

같은 네트워크의 팀원이 접속해야 한다면:

```powershell
$env:HOST="0.0.0.0"
$env:INVITE_CODE="우리팀만의-초대코드"
npm start
```

## 포함된 기능

- 초대 코드 기반 가입 및 이메일 로그인
- 비밀번호 해시 저장과 HttpOnly 세션 쿠키
- 아이디어, 질문, 결정 기록, 공지 작성
- 댓글, 공감, 진행 상태 관리
- 카테고리 및 상태 필터, 검색, 정렬
- 팀원 목록, 최근 활동, 주간 요약
- 반응형 모바일 화면

## 운영 환경 안내

현재 버전은 빠른 팀 내부 사용을 위한 MVP이며 데이터는 `data/store.json`에 저장됩니다. 인터넷에 배포할 때는 HTTPS를 적용하고, 세션 저장소와 데이터를 PostgreSQL 같은 운영용 데이터베이스로 옮기는 것이 좋습니다.

## 배포

팀원들이 인터넷에서 접속할 수 있게 배포하려면 GitHub에 코드를 올린 뒤 Node.js Web Service를 지원하는 플랫폼에 연결해야 합니다.

자세한 과정은 [DEPLOYMENT.md](./DEPLOYMENT.md)를 확인하세요.
