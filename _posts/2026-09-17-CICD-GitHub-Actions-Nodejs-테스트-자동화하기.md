---
layout: post
title: "GitHub Actions (2) - Spring Boot 단위 테스트 자동화하기"
date: 2026-09-17 19:06:18 +0900
categories: ["CI/CD", "GitHub Actions"]
tags: ["github-actions", "ci", "java", "spring-boot", "junit", "gradle"]
---

## 1. 개요

첫 워크플로가 실행되는 것을 확인했다면, 실제 Spring Boot 프로젝트의 테스트를 연결할 차례다. 이 글에서는 서비스 클래스의 JUnit 단위 테스트를 예시로, `main` 브랜치에 푸시하거나 풀 리퀘스트를 열 때마다 Gradle의 `test` 태스크를 실행한다.

단위 테스트는 Spring 애플리케이션 컨텍스트나 데이터베이스를 띄우지 않고, 클래스 하나의 규칙을 빠르게 확인한다. 빠른 피드백이 필요한 계산과 검증 규칙부터 단위 테스트로 만들기 좋다.

---

## 2. 서비스 규칙을 테스트로 만든다

Spring Initializr에서 Gradle, Java 21, Spring Web을 선택해 프로젝트를 만든다. Spring Boot 프로젝트에는 JUnit 5를 포함한 `spring-boot-starter-test`가 기본으로 포함되므로 별도 설정 없이 테스트를 작성할 수 있다.

예를 들어 할인 금액을 계산하는 `DiscountService`를 작성한다.

```java
public class DiscountService {

    public long calculate(long price, int discountRate) {
        if (price < 0) {
            throw new IllegalArgumentException("가격은 음수일 수 없다");
        }
        if (discountRate < 0 || discountRate > 100) {
            throw new IllegalArgumentException("할인율은 0에서 100 사이여야 한다");
        }

        return price * (100 - discountRate) / 100;
    }
}
```

`src/test/java/com/example/cicd/DiscountServiceTest.java`에서 정상 계산과 예외 처리를 각각 검증한다.

```java
class DiscountServiceTest {

    private final DiscountService discountService = new DiscountService();

    @Test
    void 할인율만큼_가격을_낮춘다() {
        assertEquals(8_000, discountService.calculate(10_000, 20));
    }

    @Test
    void 할인율이_범위를_벗어나면_예외를_던진다() {
        assertThrows(
            IllegalArgumentException.class,
            () -> discountService.calculate(10_000, 101)
        );
    }
}
```

로컬에서 먼저 테스트를 실행한다.

```bash
./gradlew test
```

Gradle의 Java 플러그인은 `src/test/java` 아래의 테스트를 찾아 `test` 태스크에서 실행한다. CI도 같은 명령을 실행하므로 로컬과 CI가 같은 테스트 진입점을 공유한다.

---

## 3. 단위 테스트 CI 워크플로 작성하기

`.github/workflows/java-ci.yml` 파일을 만든다.

```yaml
name: Spring Boot CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

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

`./gradlew`는 저장소의 Gradle Wrapper를 실행한다. 따라서 `gradlew`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties`를 저장소에 빠뜨리지 않아야 한다. GitHub의 [Gradle 빌드 가이드](https://docs.github.com/en/actions/tutorials/build-and-test-code/java-with-gradle)도 Wrapper로 빌드와 테스트를 실행하는 구성을 안내한다.

---

## 4. 실패를 병합 전에 발견한다

예를 들어 기대값을 일부러 잘못 고치면 테스트와 CI가 실패한다.

```java
assertEquals(9_000, discountService.calculate(10_000, 20));
```

풀 리퀘스트 화면에는 워크플로의 성공 또는 실패 상태가 표시된다. 저장소의 브랜치 보호 규칙에서 이 상태 검사를 병합 조건으로 지정하면, 테스트가 실패한 변경이 `main`에 병합되는 일을 막을 수 있다.

CI의 녹색 표시는 작성한 테스트 범위만 통과했다는 뜻이다. 중요한 규칙부터 테스트를 추가해 검사 범위를 넓혀야 한다.

---

## 5. 정리

Spring Boot 단위 테스트 CI의 흐름은 체크아웃, JDK와 Gradle 준비, `./gradlew test` 실행이다. 이 순서를 `.github/workflows/java-ci.yml`에 고정하면 새 커밋과 풀 리퀘스트마다 같은 환경에서 테스트할 수 있다.
