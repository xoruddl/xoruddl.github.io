---
layout: post
title: "GitHub Actions (1) - Workflow와 Spring Boot 첫 CI 만들기"
date: 2026-09-17 19:06:17 +0900
categories: ["CI/CD", "GitHub Actions"]
tags: ["github-actions", "ci", "java", "spring-boot", "gradle", "yaml"]
---

## 1. 개요

코드를 원격 저장소에 올린 뒤 매번 직접 빌드와 테스트를 실행하면 확인을 빼먹기 쉽다. GitHub Actions는 `push`, 풀 리퀘스트 같은 이벤트가 발생할 때 저장소의 작업을 자동으로 실행하는 도구다.

이 글에서는 GitHub Actions의 구성 요소를 구분하고, Gradle 기반 Spring Boot 프로젝트에서 `./gradlew test`를 실행하는 첫 CI(Continuous Integration) 워크플로를 만든다.

---

## 2. 워크플로는 이벤트에 반응해 작업을 실행한다

워크플로는 저장소에 함께 커밋하는 YAML 파일이다. 지정한 이벤트가 발생하면 GitHub가 러너(runner)를 준비하고, 파일에 정의한 Job을 실행한다. 워크플로 파일은 반드시 `.github/workflows` 디렉터리에 둔다.

| 구성 요소 | 하는 일 | 예시 |
| --- | --- | --- |
| Event | 워크플로를 시작시키는 사건 | `push`, `pull_request` |
| Workflow | 자동화 절차 전체를 정의한 YAML 파일 | `spring-ci.yml` |
| Job | 러너에서 실행할 작업 단위 | 테스트, 이미지 빌드 |
| Step | Job 안에서 순서대로 수행하는 한 단계 | JDK 준비, Gradle 실행 |
| Runner | Job을 실행하는 가상 머신 또는 자체 서버 | `ubuntu-latest` |
| Action | 재사용 가능한 Step 구현체 | `actions/setup-java` |

같은 Job의 Step은 같은 러너에서 순서대로 실행된다. 반면 Job끼리는 `needs`로 의존 관계를 정하지 않으면 독립적으로 실행될 수 있다. GitHub의 [워크플로 개요](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)에서도 워크플로를 이벤트, Job, Step의 조합으로 설명한다.

---

## 3. Spring Boot 첫 워크플로 만들기

먼저 Spring Initializr로 만든 Gradle 프로젝트의 `gradlew`, `gradle/`, `build.gradle` 또는 `build.gradle.kts`를 소스 코드와 함께 커밋한다. Gradle Wrapper를 사용하면 러너에 설치된 Gradle 버전에 기대지 않고 프로젝트가 정한 Gradle 버전으로 빌드할 수 있다.

그다음 `.github/workflows/spring-ci.yml` 파일을 만들고 다음 내용을 작성한다.

```yaml
name: Spring Boot CI

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
```

`actions/checkout`은 현재 커밋의 소스 코드를 러너로 가져온다. `actions/setup-java`는 Temurin JDK 21을 준비하고, `gradle/actions/setup-gradle`은 Gradle Wrapper 검증과 의존성 캐시 설정을 돕는다. 마지막 Step이 프로젝트의 모든 테스트를 실행한다.

JDK 버전은 프로젝트의 Java toolchain과 맞춰야 한다. 예를 들어 `build.gradle`에 Java 17을 지정했다면 YAML의 `java-version`도 `"17"`로 바꾼다.

---

## 4. 실행 결과 확인하기

워크플로 파일을 커밋하고 `main` 브랜치로 푸시한다.

```bash
git add .github/workflows/spring-ci.yml
git commit -m "ci: add Spring Boot workflow"
git push origin main
```

저장소의 **Actions** 탭에서 `Spring Boot CI` 실행을 열면 `test` Job과 각 Step의 성공 여부를 확인할 수 있다. 실패한 경우에는 해당 Step을 열어 Gradle의 테스트 결과와 오류 메시지를 확인한다.

`workflow_dispatch`를 넣었으므로, Actions 탭에서 **Run workflow**를 눌러 수동 실행도 할 수 있다. 배포처럼 외부에 영향을 주는 작업은 모든 브랜치에서 실행하지 않도록 `branches: [main]`처럼 대상을 제한하는 편이 안전하다.

---

## 5. 정리

GitHub Actions는 이벤트가 발생하면 워크플로의 Job을 러너에서 실행한다. 이 첫 CI는 소스 코드를 체크아웃하고 JDK와 Gradle을 준비한 뒤 `./gradlew test`를 실행한다.
