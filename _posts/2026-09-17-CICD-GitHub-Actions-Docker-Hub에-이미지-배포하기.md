---
layout: post
title: "GitHub Actions (4) - Docker Hub에 Spring Boot 이미지 배포하기"
date: 2026-09-17 19:06:20 +0900
categories: ["CI/CD", "GitHub Actions"]
tags: ["github-actions", "cd", "docker", "docker-hub", "secrets", "java", "spring-boot", "gradle"]
---

## 1. 개요

테스트가 통과한 Spring Boot 애플리케이션을 실행 가능한 형태로 전달하려면, JAR와 JRE를 함께 묶은 Docker 이미지가 편리하다. 이 글에서는 Gradle 테스트 Job이 성공했을 때만 Spring Boot 이미지를 빌드하고 Docker Hub에 푸시하는 워크플로를 만든다.

Docker Hub 비밀번호나 액세스 토큰을 YAML 파일에 직접 쓰면 안 된다. 민감한 값은 GitHub Secrets에 저장하고 워크플로에서는 `secrets` 컨텍스트로만 참조한다.

---

## 2. Spring Boot 이미지를 정의한다

프로젝트 루트에 `Dockerfile`을 만든다. 첫 번째 단계는 Gradle Wrapper로 실행 가능한 JAR를 만들고, 두 번째 단계에는 JRE와 JAR만 넣는다.

```dockerfile
FROM eclipse-temurin:21-jdk AS builder

WORKDIR /workspace

COPY gradlew ./
COPY gradle ./gradle
COPY build.gradle settings.gradle ./
RUN chmod +x gradlew

COPY src ./src
RUN ./gradlew bootJar --no-daemon

FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --from=builder /workspace/build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

`gradlew`, `gradle/`, 빌드 설정 파일을 소스 코드보다 먼저 복사하면 애플리케이션 코드만 바뀌었을 때 Docker가 앞선 레이어를 재사용할 여지가 생긴다. `COPY --from=builder`는 빌드 결과 JAR만 최종 이미지로 가져온다.

`EXPOSE 8080`은 컨테이너가 사용할 포트를 문서화할 뿐 외부에 포트를 공개하지는 않는다. 로컬에서 확인할 때는 다음처럼 `-p` 옵션을 지정한다.

```bash
docker build -t my-docker-id/ticket-api:latest .
docker run --rm -p 8080:8080 my-docker-id/ticket-api:latest
```

예제는 Gradle Groovy DSL의 `build.gradle`, `settings.gradle`을 기준으로 한다. Kotlin DSL을 사용한다면 Dockerfile의 파일명을 `build.gradle.kts`, `settings.gradle.kts`로 바꾼다. 실제 운영 환경에서는 프로필과 데이터베이스 연결 정보를 이미지에 하드코딩하지 말고 배포 환경에서 주입한다.

---

## 3. Docker Hub 자격 증명을 Secrets로 저장한다

Docker Hub에서 이미지 저장소를 만든 뒤, GitHub 저장소의 **Settings → Secrets and variables → Actions**에서 다음 저장소 Secret을 추가한다.

| Secret 이름 | 값 |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub 사용자 이름 |
| `DOCKERHUB_TOKEN` | Docker Hub 액세스 토큰 |
| `DOCKERHUB_REPOSITORY` | 이미지 저장소 이름. 예: `ticket-api` |

토큰은 이미지 푸시에 필요한 최소 권한으로 발급한다. GitHub는 Secret을 로그에서 마스킹하려 하지만, 값을 `echo`나 디버그 출력으로 노출하지 않는 것이 가장 안전하다. Secret은 워크플로에서 명시적으로 참조할 때만 러너에 전달된다. 자세한 제약은 [GitHub Secrets 문서](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)에서 확인할 수 있다.

---

## 4. 테스트 성공 뒤에만 이미지 빌드와 푸시를 실행한다

`build-and-push` Job의 `needs: test`는 `test` Job이 성공했을 때만 이미지 빌드를 시작하게 한다.

```yaml
name: Test and publish Docker image

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: "21"
      - uses: gradle/actions/setup-gradle@v6
      - run: ./gradlew test --no-daemon

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ secrets.DOCKERHUB_USERNAME }}/${{ secrets.DOCKERHUB_REPOSITORY }}:latest
```

`docker/login-action`은 Docker Hub 인증을 수행하고, `docker/build-push-action`은 Dockerfile로 이미지를 빌드해 `tags`에 지정한 저장소로 푸시한다. `test`와 `build-and-push`는 서로 다른 Job이므로 각각 체크아웃을 해야 한다. Dockerfile 안에서 다시 `bootJar`를 실행하므로 빌드 Job에 Gradle 설치 Step을 추가할 필요는 없다.

---

## 5. `latest`만 사용하지 않는다

`latest` 태그만 사용하면 어느 커밋으로 만든 이미지인지 바로 알기 어렵다. 운영에 배포할 이미지는 커밋 SHA나 릴리스 버전처럼 바뀌지 않는 태그도 함께 붙이는 편이 추적에 유리하다.

```yaml
      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ secrets.DOCKERHUB_REPOSITORY }}:latest
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ secrets.DOCKERHUB_REPOSITORY }}:${{ github.sha }}
```

`${{ github.sha }}`는 워크플로를 일으킨 커밋의 전체 SHA다. 실제 서버에는 이 불변 태그를 지정하면, 같은 버전을 다시 실행하거나 문제를 추적하기 쉽다.

---

## 6. 정리

이 워크플로는 `test` Job으로 Spring Boot 테스트를 먼저 실행하고, 성공했을 때만 `build-and-push` Job으로 JAR를 담은 Docker 이미지를 Docker Hub에 푸시한다. `needs`를 사용하면 테스트 실패 시 잘못된 코드의 이미지를 배포하지 않게 된다.

자격 증명은 GitHub Secrets에 두고 워크플로에서는 참조만 한다. 실제 서버 배포를 이어 붙이더라도, 이미지 태그와 Secret 관리 원칙은 그대로 유지하는 것이 좋다.
