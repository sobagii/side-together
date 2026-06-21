# Ger 배포 가이드

이 문서는 Ger를 GitHub에 올리고, 팀원들이 링크로 접속할 수 있게 배포하는 과정을 정리한 안내서입니다.

## 먼저 알아둘 점

Ger는 정적 HTML만 있는 사이트가 아니라 로그인, 글 작성, 이미지 업로드를 처리하는 Node.js 서버 앱입니다. 그래서 GitHub Pages처럼 HTML만 올리는 방식으로는 전체 기능이 동작하지 않습니다.

현재 데이터는 서버의 파일 시스템에 저장됩니다.

- 글/회원/댓글: `data/store.json`
- 업로드 이미지: `data/uploads/`

따라서 배포 서비스에서는 이 `data` 폴더에 해당하는 저장 공간이 유지되어야 합니다. 저장 공간이 유지되지 않는 무료 임시 서버에 배포하면 서버가 재시작될 때 글과 이미지가 사라질 수 있습니다.

## 폴더에 포함해서 GitHub에 올릴 파일

올려야 하는 파일:

- `server.js`
- `package.json`
- `README.md`
- `DEPLOYMENT.md`
- `render.yaml`
- `.env.example`
- `.gitignore`
- `public/`

올리지 말아야 하는 파일:

- `data/`
- `.env`
- `node_modules/`
- `_asset/`

이미 `.gitignore`에 `data/`, `.env`, `node_modules/`가 들어가 있으므로 보통은 자동으로 제외됩니다.

## 추천 배포 방식: GitHub + Render

이 프로젝트는 Node.js 서버가 필요하므로 Render의 Web Service 방식이 가장 단순합니다.

Render 공식 문서 기준으로 Node 앱은 GitHub 저장소를 연결한 뒤 Web Service를 만들고, 시작 명령을 `npm start`처럼 지정하면 배포할 수 있습니다. Render는 배포가 끝나면 `onrender.com` 주소를 제공합니다.

참고:

- Render Node 배포 문서: https://render.com/docs/deploy-node-express-app
- Render Persistent Disk 문서: https://render.com/docs/disks
- Render Blueprint 문서: https://render.com/docs/blueprint-spec

## 1. GitHub에 코드 올리기

GitHub에서 새 저장소를 만든 뒤, 이 프로젝트 폴더의 파일을 업로드합니다.

GitHub 웹사이트에서 직접 올리는 방법:

1. GitHub에서 새 Repository를 만듭니다.
2. 저장소 공개 범위를 선택합니다.
   - 코드도 공개해도 괜찮으면 Public
   - 코드도 팀원에게만 보여주고 싶으면 Private
3. `Add file` > `Upload files`를 누릅니다.
4. 이 폴더의 파일을 업로드합니다.
5. 단, `data/`, `.env`, `node_modules/`는 올리지 않습니다.
6. `Commit changes`를 누릅니다.

명령줄로 올리는 방법:

```bash
git init
git add .
git commit -m "Deploy Ger"
git branch -M main
git remote add origin https://github.com/계정명/저장소명.git
git push -u origin main
```

## 2. Render에서 Web Service 만들기

1. https://render.com 에 로그인합니다.
2. `New` > `Web Service`를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. 아래처럼 설정합니다.

| 항목 | 값 |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Branch | `main` |

이 저장소에는 무료 테스트용 `render.yaml`도 들어 있습니다. 유료 저장 공간까지 같이 만들고 싶다면 `render-with-disk.yaml` 내용을 참고하세요.

## 3. 환경 변수 설정

Render의 Environment Variables에 아래 값을 넣습니다.

| 이름 | 값 | 설명 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 배포 환경 표시 |
| `HOST` | `0.0.0.0` | 외부 접속 허용 |
| `INVITE_CODE` | 팀 전용 초대 코드 | 가입할 때 필요한 코드 |
| `DATA_DIR` | `/var/data` | 글과 이미지 저장 위치 |

중요: `DATA_DIR=/var/data`는 Render에 Persistent Disk를 붙였을 때 사용하는 값입니다. 디스크를 붙이지 않은 상태에서 이 값을 넣으면 `EACCES: permission denied, mkdir '/var/data'` 오류가 날 수 있습니다.

무료 플랜으로 먼저 테스트만 할 경우에는 `DATA_DIR` 환경 변수를 빼고 배포하세요. 이 경우 앱은 실행되지만, 서버가 재시작되거나 재배포되면 작성한 글과 이미지가 사라질 수 있습니다.

중요: `INVITE_CODE`는 꼭 기본값이 아닌 팀 전용 코드로 바꿔주세요.

## 4. 저장 공간 설정

Ger는 글과 이미지를 파일로 저장하므로 Render에서 Persistent Disk를 붙이는 것을 권장합니다.

추천 설정:

| 항목 | 값 |
| --- | --- |
| Disk Name | `ger-data` |
| Mount Path | `/var/data` |
| Size | `1GB`부터 시작 |

주의:

- Render 문서 기준 Persistent Disk는 유료 Web Service에서 사용할 수 있습니다.
- 디스크 없이 배포하면 테스트는 가능하지만, 서버 재시작이나 재배포 후 데이터가 사라질 수 있습니다.
- 오래 운영할 계획이면 나중에 PostgreSQL 같은 데이터베이스로 옮기는 것이 더 안전합니다.

## 5. 배포 후 접속

배포가 완료되면 Render가 아래와 비슷한 주소를 줍니다.

```text
https://ger.onrender.com
```

이 링크를 팀원에게 보내면 됩니다.

팀원이 처음 들어올 때는:

1. 가입하기를 누릅니다.
2. 이름, 이메일, 비밀번호를 입력합니다.
3. Render 환경 변수에 설정한 `INVITE_CODE`를 입력합니다.
4. 가입 후 아이디어, 질문, 결정 기록, 공지를 작성할 수 있습니다.

## 6. 업데이트하는 방법

사이트를 수정한 뒤 GitHub에 다시 올리면 Render가 자동으로 새 버전을 배포합니다.

일반 흐름:

```bash
git add .
git commit -m "Update Ger"
git push
```

Render에서 자동 배포가 켜져 있다면 `main` 브랜치에 push될 때마다 다시 배포됩니다.

## 7. 운영 전에 확인할 체크리스트

- [ ] GitHub에 `data/` 폴더를 올리지 않았는지 확인
- [ ] GitHub에 `.env` 파일을 올리지 않았는지 확인
- [ ] Render 환경 변수 `INVITE_CODE`를 팀 전용 코드로 변경
- [ ] Render 환경 변수 `HOST=0.0.0.0` 설정
- [ ] 실제 운영할 경우에만 Render 환경 변수 `DATA_DIR=/var/data` 설정
- [ ] 실제 운영할 경우에만 Persistent Disk mount path가 `/var/data`인지 확인
- [ ] 배포 주소로 접속해서 가입, 로그인, 글 작성, 이미지 업로드 테스트
- [ ] 팀원에게 초대 코드와 접속 링크 공유

## 8. 보안과 한계

현재 버전은 작은 팀의 사이드 프로젝트용 MVP입니다.

지원하는 것:

- 초대 코드 가입
- 이메일/비밀번호 로그인
- 비밀번호 해시 저장
- HttpOnly 세션 쿠키
- 작성자만 수정/삭제 가능

아직 부족한 것:

- 비밀번호 재설정 기능
- 관리자 페이지
- 세션 영구 저장소
- 데이터베이스 백업 자동화
- 세밀한 권한 관리

팀 내부에서 가볍게 쓰는 용도로는 괜찮지만, 많은 사람이 오래 쓰는 서비스로 키우려면 데이터베이스, 백업, 관리자 권한, 파일 저장소를 추가하는 것을 추천합니다.

## 9. 자주 생기는 문제

### 배포 주소에 접속했는데 사이트가 안 열려요.

Render 로그에서 서버가 실행됐는지 확인하세요. `HOST`가 `0.0.0.0`이어야 외부에서 접속할 수 있습니다.

### 가입이 안 돼요.

Render 환경 변수의 `INVITE_CODE`와 사용자가 입력한 초대 코드가 같은지 확인하세요.

### 글이나 이미지가 사라졌어요.

Persistent Disk 없이 배포했거나, `DATA_DIR`가 디스크 mount path와 다를 가능성이 큽니다. `DATA_DIR=/var/data`와 디스크 mount path `/var/data`를 같이 맞춰주세요.

### `EACCES: permission denied, mkdir '/var/data'` 오류가 떠요.

`DATA_DIR=/var/data`를 넣었지만 Render에 Persistent Disk가 아직 연결되지 않았다는 뜻입니다.

해결 방법은 둘 중 하나입니다.

1. 실제 운영할 경우: Render 유료 Web Service에서 Persistent Disk를 추가하고 Mount Path를 `/var/data`로 설정합니다.
2. 무료 테스트만 할 경우: Render Environment Variables에서 `DATA_DIR` 줄을 삭제하고 다시 배포합니다.

무료 테스트 방식은 데이터가 영구 저장되지 않습니다. 팀원들이 실제로 사용할 예정이라면 Persistent Disk를 붙이는 방식을 추천합니다.

### GitHub에 코드를 올리면 데이터도 공개되나요?

현재 설정대로라면 `data/` 폴더는 `.gitignore`에 의해 제외됩니다. 단, GitHub 웹 업로드를 할 때 실수로 `data/`를 직접 끌어다 놓으면 올라갈 수 있으니 업로드 목록에서 꼭 제외하세요.
