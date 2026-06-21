# Ger GitHub 업로드 체크리스트

이 폴더 안의 파일만 GitHub에 올리면 됩니다.

## 올릴 파일

- `public/`
- `server.js`
- `package.json`
- `README.md`
- `DEPLOYMENT.md`
- `GITHUB_UPLOAD_CHECKLIST.md`
- `render.yaml`
- `render-with-disk.yaml`
- `.env.example`
- `.gitignore`

## 올리지 말 것

아래 파일/폴더는 이 업로드용 폴더에 일부러 넣지 않았습니다.

- `data/`
- `.env`
- `node_modules/`
- `_asset/`

`data/`에는 로컬에서 작성한 글, 회원, 이미지가 들어갈 수 있습니다. GitHub에 올리지 마세요.

## Render 환경 변수

Render에는 처음 테스트할 때 아래 3개만 넣으세요.

```text
NODE_ENV     production
HOST         0.0.0.0
INVITE_CODE  원하는_초대코드
```

무료 테스트 단계에서는 `DATA_DIR`를 넣지 마세요.

팀원들이 실제로 오래 사용할 때만 유료 저장 공간을 붙이고 아래 값을 추가하세요.

```text
DATA_DIR     /var/data
```

유료 저장 공간까지 Render Blueprint로 만들 때는 `render-with-disk.yaml` 내용을 참고하세요.
