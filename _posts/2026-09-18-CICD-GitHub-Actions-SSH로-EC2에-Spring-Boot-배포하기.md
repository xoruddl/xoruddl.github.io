---
layout: post
title: "GitHub Actions (5) - SSH로 EC2에 Spring Boot 배포하기"
date: 2026-09-18 14:10:47 +0900
categories: ["CI/CD", "GitHub Actions"]
tags: ["github-actions", "cd", "docker", "docker-hub", "ssh", "ec2", "java", "spring-boot", "gradle"]
---

## 1. 개요

앞선 글에서는 테스트를 통과한 Spring Boot 애플리케이션을 Docker 이미지로 만들어 Docker Hub에 푸시했다. 이미지를 저장소에 올리는 것만으로는 EC2에서 실행 중인 컨테이너가 바뀌지 않는다.

이 글에서는 `main` 브랜치에 푸시하면 테스트, 이미지 빌드와 Docker Hub 푸시를 차례로 수행한 뒤, GitHub Actions가 SSH로 EC2에 접속해 새 이미지를 실행하도록 구성한다. 배포 흐름은 다음과 같다.

```text
GitHub push → Gradle 테스트 → Docker 이미지 빌드·푸시 → SSH로 EC2 접속 → 새 컨테이너 실행
```

---

## 2. EC2와 GitHub Secrets를 준비한다

배포 대상 EC2에는 Docker를 설치하고, SSH로 접속하는 사용자가 Docker 명령을 실행할 수 있어야 한다. 예를 들어 Ubuntu에서 현재 사용자를 `docker` 그룹에 추가했다면, 다시 로그인한 뒤 다음 명령이 `sudo` 없이 동작하는지 확인한다.

```bash
docker ps
```

Docker Hub에서 `ticket-api` 이미지 저장소를 만든다. 이어서 GitHub 저장소의 **Settings → Secrets and variables → Actions**에서 다음 repository secret을 등록한다.

| Secret 이름 | 값 |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub 사용자 이름 |
| `DOCKERHUB_TOKEN` | Docker Hub 액세스 토큰 |
| `DOCKERHUB_REPOSITORY` | 이미지 저장소 이름. 예: `ticket-api` |
| `EC2_HOST` | EC2의 퍼블릭 IP 또는 도메인 |
| `EC2_USERNAME` | EC2 로그인 사용자 이름. 예: `ubuntu` |
| `EC2_SSH_KEY` | EC2 접속용 PEM 개인 키의 전체 내용 |

액세스 토큰과 PEM 개인 키를 코드, Dockerfile, 노트에 직접 기록하면 안 된다. 워크플로에서는 `${{ secrets.이름 }}`으로만 참조한다. GitHub Secrets는 로그에서 값을 가리지만, `echo` 등으로 출력하지 않는 것이 안전하다.

이미지 저장소가 비공개라면 EC2도 Docker Hub 인증이 필요하다. 서버에서 한 번 `docker login`을 실행하거나, 별도의 배포용 읽기 전용 토큰으로 로그인해 둔다. 이 글의 워크플로는 공개 이미지를 기준으로 하므로 서버에서 Docker Hub 비밀번호를 전달하지 않는다.

---

## 3. Spring Boot 예제 프로젝트를 준비한다

Spring Initializr로 만든 Gradle 프로젝트에 웹 의존성과 테스트 의존성을 추가한다. `build.gradle`에는 다음과 같이 Java 21과 Spring Boot Web Starter를 설정할 수 있다.

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.5.0'
    id 'io.spring.dependency-management' version '1.1.7'
}

group = 'com.example'
version = '0.0.1-SNAPSHOT'

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}

tasks.named('test') {
    useJUnitPlatform()
}
```

간단한 상태 확인 엔드포인트를 만든다. 배포 뒤 컨테이너가 응답하는지 확인할 때 사용할 수 있다.

`src/main/java/com/example/ticketapi/TicketApiApplication.java`

```java
package com.example.ticketapi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TicketApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(TicketApiApplication.class, args);
    }
}
```

`src/main/java/com/example/ticketapi/HealthController.java`

```java
package com.example.ticketapi;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
```

`src/test/java/com/example/ticketapi/HealthControllerTest.java`

```java
package com.example.ticketapi;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(HealthController.class)
class HealthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void returnsOkStatus() throws Exception {
        mockMvc.perform(get("/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"));
    }
}
```

로컬에서 `./gradlew test --no-daemon`을 실행해 테스트가 통과하는지 확인한다. GitHub Actions도 같은 명령으로 이 테스트를 실행한다.

---

## 4. Spring Boot 이미지를 준비한다

프로젝트 루트의 `Dockerfile`은 Gradle로 JAR를 빌드하고, 실행 단계에는 JRE와 JAR만 담도록 작성한다. 다음 예제는 Java 21과 Gradle Groovy DSL을 기준으로 한다.

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

`COPY --from=builder`는 빌드 결과물인 JAR만 최종 이미지에 복사한다. 따라서 Gradle 캐시와 소스 코드가 실행 이미지에 들어가지 않는다. Kotlin DSL 프로젝트라면 `build.gradle`, `settings.gradle`을 각각 `build.gradle.kts`, `settings.gradle.kts`로 바꾼다.

배포 전에 로컬에서 애플리케이션이 실행되는지 확인한다.

```bash
docker build -t my-docker-id/ticket-api:local .
docker run --rm -p 8080:8080 --name ticket-api my-docker-id/ticket-api:local
```

브라우저 또는 `curl http://localhost:8080`으로 애플리케이션의 엔드포인트를 확인한 뒤 컨테이너를 종료한다. 데이터베이스 주소, 비밀번호처럼 환경마다 달라지는 값은 이미지에 넣지 말고 환경 변수나 Spring profile로 주입한다.

---

## 5. 테스트·이미지 푸시·SSH 배포 워크플로를 작성한다

`.github/workflows/deploy-ec2.yml` 파일을 만든다. 풀 리퀘스트에서는 테스트만 실행하고, `main` 브랜치에 실제로 푸시된 경우에만 이미지 푸시와 EC2 배포를 수행한다.

```yaml
name: Test, publish, and deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up JDK 21
        uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: "21"

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v6

      - name: Run tests
        run: ./gradlew test --no-daemon

  build-and-push:
    needs: test
    if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'
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
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ secrets.DOCKERHUB_REPOSITORY }}:latest
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ secrets.DOCKERHUB_REPOSITORY }}:${{ github.sha }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to EC2 over SSH
        uses: appleboy/ssh-action@v1.2.2
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USERNAME }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            IMAGE=${{ secrets.DOCKERHUB_USERNAME }}/${{ secrets.DOCKERHUB_REPOSITORY }}:${{ github.sha }}
            docker pull "$IMAGE"
            docker stop ticket-api 2>/dev/null || true
            docker rm ticket-api 2>/dev/null || true
            docker run -d \
              --name ticket-api \
              --restart unless-stopped \
              -p 8080:8080 \
              -e SPRING_PROFILES_ACTIVE=prod \
              "$IMAGE"
            docker image prune -f
```

Job은 `needs`로 앞 Job의 성공 여부에 연결했다. 따라서 테스트가 실패하면 이미지를 푸시하지 않고, 이미지 푸시가 실패하면 EC2 배포도 실행하지 않는다. 각 Job은 서로 다른 러너에서 실행되므로 `test`와 `build-and-push`에서 각각 저장소를 체크아웃한다.

`build-and-push` Job은 `latest`와 커밋 SHA 태그를 함께 만든다. EC2에서는 SHA 태그를 pull하므로, `latest`가 다른 배포로 갱신되더라도 현재 워크플로가 빌드한 정확한 이미지를 실행한다.

---

## 6. EC2에서 수행되는 배포 명령을 살펴본다

SSH Action의 `script`는 EC2에서 위에서 아래 순서대로 실행된다.

| 명령 | 역할 |
| --- | --- |
| `docker pull "$IMAGE"` | 커밋 SHA로 식별한 새 이미지를 내려받는다. |
| `docker stop` | 기존 `ticket-api` 컨테이너를 멈춘다. 없을 때도 다음 단계로 진행한다. |
| `docker rm` | 멈춘 기존 컨테이너를 제거해 같은 이름을 다시 쓸 수 있게 한다. |
| `docker run` | 포트 8080을 연결하고 새 컨테이너를 백그라운드에서 실행한다. |
| `docker image prune -f` | 더는 어떤 컨테이너도 참조하지 않는 이미지 레이어를 정리한다. |

`--restart unless-stopped`는 Docker 데몬 또는 EC2가 재시작되었을 때 컨테이너를 다시 실행하도록 한다. `-e SPRING_PROFILES_ACTIVE=prod`는 Spring Boot의 `prod` 프로필을 활성화한다. 해당 프로필을 사용하지 않는다면 이 줄은 제거해도 된다.

이 방식은 기존 컨테이너를 먼저 중지하므로 교체 순간에 짧은 서비스 중단이 발생한다. 학습용 또는 소규모 서비스에는 단순하지만, 무중단 배포가 필요한 환경에서는 리버스 프록시와 헬스 체크를 이용해 새 컨테이너가 정상 상태가 된 뒤 트래픽을 전환해야 한다.

---

## 7. 배포 결과를 확인한다

워크플로 파일을 커밋해 `main` 브랜치에 푸시한다.

```bash
git add .github/workflows/deploy-ec2.yml
git commit -m "ci: deploy Spring Boot app to EC2"
git push origin main
```

GitHub 저장소의 **Actions** 탭에서 `test`, `build-and-push`, `deploy` Job이 순서대로 성공했는지 확인한다. 배포 서버에 접속할 수 있다면 다음 명령으로 실행 상태와 애플리케이션 로그도 확인할 수 있다.

```bash
docker ps --filter name=ticket-api
docker logs --tail 100 ticket-api
```

외부에서 EC2의 `http://EC2_HOST:8080`에 접속하려면 EC2 보안 그룹 인바운드 규칙도 포트 8080에 맞게 설정되어 있어야 한다. 실제 공개 서비스에서는 애플리케이션 포트를 직접 열기보다 Nginx 같은 리버스 프록시를 앞에 두고 HTTPS를 구성하는 편이 일반적이다.

---

## 8. 정리

GitHub Actions는 Gradle 테스트가 성공한 뒤에만 Spring Boot 이미지를 Docker Hub에 푸시하고, SSH로 EC2에 접속해 새 컨테이너를 실행할 수 있다. `needs`로 Job의 의존 관계를 정의하면 실패한 빌드가 배포 단계까지 진행되는 일을 막을 수 있다.

Docker Hub 자격 증명과 EC2 접속 정보는 모두 GitHub Secrets에 보관하고, 서버는 커밋 SHA 태그로 특정된 이미지를 실행한다. 이 구성을 기반으로 다음에는 환경 변수 주입, 헬스 체크, 무중단 배포 같은 운영 요소를 추가할 수 있다.
