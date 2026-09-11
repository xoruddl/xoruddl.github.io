# eta_kyung.blog

개발 과정에서 공부하고 확인한 내용을 정리하는 기술 블로그입니다.

**블로그:** [https://etakyung.com](https://etakyung.com)

## 기술 구성

- Astro 정적 사이트 생성
- Markdown 콘텐츠 컬렉션 (`_posts`)
- GitHub Actions 및 GitHub Pages 배포
- Giscus 댓글
- 자동 생성 사이트맵과 RSS

## 로컬 실행

```bash
npm install
npm run dev
```

배포 결과와 동일한 정적 빌드는 다음 명령으로 확인합니다.

```bash
npm run check
npm run build
```

새 글은 기존과 동일하게 `_posts/YYYY-MM-DD-제목.md`에 작성하고, 이미지는 `assets/img/posts/` 아래에 저장합니다. 빌드 전에 이미지가 Astro의 정적 파일 디렉터리로 자동 복사됩니다.

## 최근 글

- [Kubernetes (39) - Helm Chart를 직접 만들어 MariaDB 배포하기](https://etakyung.com/posts/Kubernetes-39-Helm-Chart%EB%A5%BC-%EC%A7%81%EC%A0%91-%EB%A7%8C%EB%93%A4%EC%96%B4-MariaDB-%EB%B0%B0%ED%8F%AC%ED%95%98%EA%B8%B0/)
- [Kubernetes (38) - Helm Chart로 Kubernetes 애플리케이션 설치와 설정 관리하기](https://etakyung.com/posts/Kubernetes-38-Helm-Chart%EB%A1%9C-Kubernetes-%EC%95%A0%ED%94%8C%EB%A6%AC%EC%BC%80%EC%9D%B4%EC%85%98-%EC%84%A4%EC%B9%98%EC%99%80-%EC%84%A4%EC%A0%95-%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/)
- [Kubernetes (37) - Kustomize로 환경별 매니페스트 구성 관리하기](https://etakyung.com/posts/Kubernetes-37-Kustomize%EB%A1%9C-%ED%99%98%EA%B2%BD%EB%B3%84-%EB%A7%A4%EB%8B%88%ED%8E%98%EC%8A%A4%ED%8A%B8-%EA%B5%AC%EC%84%B1-%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/)

전체 글은 블로그의 [카테고리](https://etakyung.com/categories/)와 [태그](https://etakyung.com/tags/)에서 확인할 수 있습니다.

## 댓글

댓글은 [Giscus](https://giscus.app/)를 사용하며, 각 글의 댓글과 반응은 이 저장소의 GitHub Discussions로 관리됩니다. 댓글 작성 전에는 GitHub 계정으로 Giscus를 인증해야 합니다.

글별 Discussion은 첫 댓글 또는 반응이 작성될 때 `Announcements` 카테고리에 생성됩니다. 저장소 관리자는 GitHub Discussions에서 댓글을 확인하고 관리할 수 있습니다.
