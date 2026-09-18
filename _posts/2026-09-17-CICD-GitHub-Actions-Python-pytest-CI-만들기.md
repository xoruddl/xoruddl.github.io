---
layout: post
title: "GitHub Actions (3) - Spring Boot JPA 통합 테스트를 CI에서 실행하기"
date: 2026-09-17 19:06:19 +0900
categories: ["CI/CD", "GitHub Actions"]
tags: ["github-actions", "ci", "java", "spring-boot", "jpa", "h2", "gradle"]
---

## 1. 개요

앞 글의 단위 테스트는 서비스 클래스 하나의 규칙을 빠르게 확인했다. Spring Data JPA 저장소를 사용할 때는 엔티티 매핑과 쿼리도 함께 검증해야 한다. 이 글에서는 H2 인메모리 데이터베이스를 사용하는 `@DataJpaTest`를 만들고 GitHub Actions에서 통합 테스트를 실행한다.

H2는 테스트가 끝나면 사라지는 메모리 데이터베이스라 별도 컨테이너 없이 빠르게 실행할 수 있다. 다만 운영 DB와 SQL 동작이 완전히 같지는 않으므로, 중요한 DB 고유 기능은 운영 DB와 같은 종류의 테스트 환경에서도 검증해야 한다.

---

## 2. JPA 테스트에 필요한 의존성을 추가한다

Spring Initializr에서 `Spring Data JPA`, `H2 Database` 의존성을 선택하거나 `build.gradle`의 `dependencies`에 다음 항목이 있는지 확인한다.

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    testRuntimeOnly 'com.h2database:h2'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

`testRuntimeOnly`는 H2를 테스트 실행 때만 클래스패스에 넣는다. 운영에서 MySQL이나 PostgreSQL을 사용한다면 그 드라이버와 연결 정보는 실제 구성에 맞게 별도로 둔다.

---

## 3. 저장소 동작을 `@DataJpaTest`로 검증한다

간단한 회원 엔티티와 저장소를 만든다.

```java
@Entity
public class Member {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String email;

    protected Member() {
    }

    public Member(String email) {
        this.email = email;
    }

    public String getEmail() {
        return email;
    }
}
```

```java
public interface MemberRepository extends JpaRepository<Member, Long> {

    Optional<Member> findByEmail(String email);
}
```

`src/test/java/com/example/cicd/MemberRepositoryTest.java`에서 저장과 조회를 검사한다.

```java
@DataJpaTest
class MemberRepositoryTest {

    @Autowired
    private MemberRepository memberRepository;

    @Test
    void 이메일로_저장한_회원을_조회한다() {
        memberRepository.save(new Member("member@example.com"));

        Member member = memberRepository.findByEmail("member@example.com").orElseThrow();

        assertThat(member.getEmail()).isEqualTo("member@example.com");
    }
}
```

`@DataJpaTest`는 JPA 관련 빈과 테스트 데이터베이스를 중심으로 구성하는 테스트 슬라이스다. 각 테스트는 기본적으로 트랜잭션 안에서 실행되고 끝난 뒤 롤백되므로, 테스트끼리 데이터를 직접 정리하는 부담을 줄일 수 있다.

---

## 4. 통합 테스트 워크플로 작성하기

`.github/workflows/jpa-test.yml` 파일을 만든다. 이 워크플로는 `MemberRepositoryTest`만 골라 실행한다.

```yaml
name: JPA Integration Test

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

      - name: Run JPA integration tests
        run: ./gradlew test --tests '*MemberRepositoryTest' --no-daemon
```

`--tests` 옵션은 대상 테스트 클래스만 골라 실행한다. 단위 테스트와 통합 테스트를 모두 실행하려면 2편처럼 `--tests` 없이 `./gradlew test`를 실행하면 된다.

---

## 5. H2만으로 충분하지 않은 경우

H2는 빠르고 설정이 간단하지만, 운영 DB의 모든 문법과 동작을 재현하지는 않는다. 특히 데이터베이스 고유 함수, 인덱스, JSON 타입, 락 동작을 사용한다면 H2 테스트만 통과해도 운영에서 문제가 생길 수 있다.

| 테스트 종류 | 예시 | CI에서 필요한 준비 |
| --- | --- | --- |
| 단위 테스트 | `DiscountService`의 할인 계산 | JDK, Gradle |
| H2 통합 테스트 | `MemberRepository` 저장·조회 | JDK, Gradle, H2 의존성 |
| 운영 DB 통합 테스트 | PostgreSQL 고유 쿼리 검증 | 테스트용 DB 컨테이너 또는 서비스 |

중요한 운영 DB 동작은 GitHub Actions의 서비스 컨테이너나 Testcontainers로 테스트용 DB를 띄워 검증할 수 있다. 실제 서비스용 데이터베이스 주소나 비밀번호를 테스트 코드와 YAML에 직접 넣지 않는 것도 중요하다.

---

## 6. 정리

JPA 통합 테스트 CI도 구조는 단순하다. 저장소를 체크아웃하고 JDK와 Gradle 환경을 준비한 뒤 `./gradlew test`를 실행한다. H2 의존성이 있으면 별도 데이터베이스 컨테이너 없이 저장소 동작을 확인할 수 있다.
