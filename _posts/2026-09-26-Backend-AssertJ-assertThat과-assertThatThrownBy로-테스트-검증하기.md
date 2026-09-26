---
layout: post
title: "AssertJ assertThat과 assertThatThrownBy로 테스트 검증하기"
date: 2026-09-26 17:04:47 +0900
categories: ["Backend", "Test"]
tags: ["assertj", "junit5", "test", "assertThat", "assertThatThrownBy"]
---

## 1. 개요

테스트는 "코드를 실행한 결과가 기대와 같은가"를 확인하는 작업이다. 이 확인 단계를 **검증(assertion)** 이라고 부르고, 검증이 틀리면 테스트가 실패한다.

Java 테스트에서는 JUnit의 `assertEquals` 대신 **AssertJ**의 `assertThat`을 많이 쓴다. 검증 문장이 영어 문장처럼 읽히고, IDE 자동 완성으로 쓸 수 있는 검증 메서드를 바로 찾을 수 있기 때문이다. 예외가 발생해야 하는 상황은 `assertThatThrownBy`로 검증한다.

이 글에서는 [JpaRepository 글](/posts/Backend-JpaRepository로-공연-저장소-만들기/)에서 만든 `Performance` 엔티티를 예시로, 값 검증과 예외 검증을 차례로 정리한다.

---

## 2. AssertJ 준비하기

Spring Boot 프로젝트라면 `spring-boot-starter-test`에 AssertJ가 이미 포함되어 있다. 별도 의존성을 추가할 필요가 없다.

```groovy
dependencies {
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

테스트 클래스에서는 `Assertions`의 메서드를 static import 해서 쓴다.

```java
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
```

JUnit에도 `org.junit.jupiter.api.Assertions`라는 같은 이름의 클래스가 있다. IDE 자동 import가 JUnit 쪽을 가져오면 `assertThat`을 찾을 수 없으니, 패키지가 `org.assertj.core.api`인지 확인한다.

---

## 3. assertThat의 기본 구조

`assertThat`은 **검증할 실제 값**을 먼저 받고, 그 뒤에 **기대하는 조건**을 메서드로 이어 붙인다.

```java
@Test
void 공연을_생성하면_제목과_공연장이_저장된다() {
    Performance performance = new Performance("뮤지컬 위키드", "블루스퀘어");

    assertThat(performance.getTitle()).isEqualTo("뮤지컬 위키드");
    assertThat(performance.getVenue()).isEqualTo("블루스퀘어");
}
```

`assertThat(실제값).isEqualTo(기대값)`은 "실제값이 기대값과 같다고 단언한다"로 읽힌다. JUnit의 `assertEquals(기대값, 실제값)`과 비교하면 차이가 분명하다.

| 방식 | 코드 | 특징 |
| --- | --- | --- |
| JUnit | `assertEquals("뮤지컬 위키드", performance.getTitle())` | 인자 순서(기대값, 실제값)를 헷갈리기 쉽다 |
| AssertJ | `assertThat(performance.getTitle()).isEqualTo("뮤지컬 위키드")` | 실제값이 항상 앞에 오고 문장처럼 읽힌다 |

검증이 실패하면 AssertJ는 기대값과 실제값을 함께 보여 준다. 예를 들어 기대값을 `"레미제라블"`로 바꾸면 다음과 같은 메시지가 출력된다.

```text
expected: "레미제라블"
 but was: "뮤지컬 위키드"
```

`assertThat(실제값)`을 입력한 뒤 `.`을 찍으면, 실제값의 타입(문자열, 숫자, 컬렉션 등)에 맞는 검증 메서드만 자동 완성 목록에 나타난다. 이것이 AssertJ를 쓰는 가장 실용적인 이유다.

---

## 4. 자주 쓰는 검증 메서드

타입별로 자주 쓰는 검증 메서드를 정리하면 다음과 같다.

| 대상 | 메서드 | 의미 |
| --- | --- | --- |
| 공통 | `isEqualTo(v)` / `isNotEqualTo(v)` | `equals()`로 비교해 같다 / 다르다 |
| 공통 | `isNull()` / `isNotNull()` | `null`이다 / 아니다 |
| 공통 | `isSameAs(v)` | `==`로 비교해 같은 객체다 |
| 공통 | `isInstanceOf(Type.class)` | 해당 타입의 인스턴스다 |
| boolean | `isTrue()` / `isFalse()` | 참이다 / 거짓이다 |
| 문자열 | `contains(s)` / `startsWith(s)` / `isBlank()` | 포함한다 / 시작한다 / 비어 있다 |
| 숫자 | `isGreaterThan(n)` / `isBetween(a, b)` | 크다 / 범위 안에 있다 |
| 컬렉션 | `hasSize(n)` / `isEmpty()` | 크기가 n이다 / 비어 있다 |
| 컬렉션 | `contains(...)` / `containsExactly(...)` | 포함한다 / 순서까지 정확히 같다 |

`isEqualTo`와 `isSameAs`는 헷갈리기 쉽다. `isEqualTo`는 값이 같은지(`equals()`), `isSameAs`는 같은 객체인지(`==`)를 본다. 스프링 빈이 싱글톤인지 확인할 때 `isSameAs`를 쓰는 이유가 이것이다.

검증 메서드는 체인으로 이어 붙일 수 있다. 앞의 검증이 모두 통과해야 다음 검증으로 넘어간다.

```java
assertThat(performance.getTitle())
        .isNotBlank()
        .startsWith("뮤지컬")
        .contains("위키드");
```

컬렉션에서 특정 필드만 뽑아 검증할 때는 `extracting`을 쓴다. 공연 목록에서 제목만 꺼내 순서대로 비교하는 예시다.

```java
List<Performance> performances = List.of(
        new Performance("뮤지컬 위키드", "블루스퀘어"),
        new Performance("레미제라블", "블루스퀘어")
);

assertThat(performances)
        .hasSize(2)
        .extracting(Performance::getTitle)
        .containsExactly("뮤지컬 위키드", "레미제라블");
```

`extracting(Performance::getTitle)`은 목록의 각 공연에서 제목만 꺼내 새 목록을 만든다. 그 뒤의 `containsExactly`는 제목 목록이 순서까지 정확히 일치하는지 확인한다. 순서가 중요하지 않다면 `containsExactlyInAnyOrder`를 쓴다.

---

## 5. assertThatThrownBy로 예외 검증하기

`Performance` 생성자는 제목이 비어 있으면 `IllegalArgumentException`을 던진다.

```java
if (title == null || title.isBlank()) {
    throw new IllegalArgumentException("공연 제목은 비어 있을 수 없다");
}
```

이 규칙이 제대로 동작하는지 확인하려면 "예외가 발생하는 것"을 검증해야 한다. 그런데 `new Performance("", "블루스퀘어")`를 테스트 코드에 그대로 쓰면, 예외가 그 자리에서 발생해 검증 문장에 도달하기 전에 테스트가 실패한다.

그래서 `assertThatThrownBy`는 예외가 발생할 코드를 **람다**로 감싸서 받는다. AssertJ가 람다를 대신 실행하고, 발생한 예외를 잡아서 검증 대상으로 넘겨 준다.

```java
@Test
void 제목이_비어_있으면_공연을_만들_수_없다() {
    assertThatThrownBy(() -> new Performance("", "블루스퀘어"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("공연 제목은 비어 있을 수 없다");
}
```

`() -> new Performance("", "블루스퀘어")`는 "나중에 실행할 코드"를 값처럼 전달하는 람다식이다. 람다 문법은 [JAVA (23) - 람다와 스트림](/posts/JAVA-23-람다와-스트림/)에서 정리했다.

예외를 잡은 뒤에는 다음 메서드로 예외의 내용을 검증한다.

| 메서드 | 의미 |
| --- | --- |
| `isInstanceOf(Type.class)` | 예외가 해당 타입(또는 하위 타입)이다 |
| `isExactlyInstanceOf(Type.class)` | 예외가 정확히 해당 타입이다 (하위 타입은 실패) |
| `hasMessage(msg)` | 예외 메시지가 정확히 일치한다 |
| `hasMessageContaining(msg)` | 예외 메시지에 해당 문구가 포함된다 |
| `hasMessageStartingWith(msg)` | 예외 메시지가 해당 문구로 시작한다 |
| `hasCauseInstanceOf(Type.class)` | 원인 예외(cause)가 해당 타입이다 |

메시지 전체가 자주 바뀐다면 `hasMessageContaining("제목")`처럼 핵심 단어만 검증하는 편이 테스트를 덜 깨지게 만든다.

람다 안의 코드가 예외를 던지지 않으면 `assertThatThrownBy`는 실패한다. 제목을 정상 값으로 바꿔 실행하면 다음 메시지를 볼 수 있다.

```text
Expecting code to raise a throwable.
```

---

## 6. 예외를 검증하는 다른 방법

AssertJ에는 `assertThatThrownBy` 말고도 예외를 검증하는 방법이 있다. 같은 검증을 다른 순서로 쓰는 것이므로, 팀에서 읽기 편한 쪽을 고르면 된다.

```java
// 예외 타입을 먼저 정한다
assertThatExceptionOfType(IllegalArgumentException.class)
        .isThrownBy(() -> new Performance("", "블루스퀘어"))
        .withMessage("공연 제목은 비어 있을 수 없다");

// 자주 쓰는 예외는 전용 메서드가 있다
assertThatIllegalArgumentException()
        .isThrownBy(() -> new Performance("", "블루스퀘어"))
        .withMessageContaining("제목");
```

반대로 "예외가 발생하지 않아야 한다"를 명시적으로 검증할 때는 `assertThatCode`를 쓴다.

```java
assertThatCode(() -> new Performance("뮤지컬 위키드", "블루스퀘어"))
        .doesNotThrowAnyException();
```

JUnit의 `assertThrows`와 비교하면 다음과 같다.

| 방식 | 코드 형태 | 특징 |
| --- | --- | --- |
| AssertJ | `assertThatThrownBy(() -> ...).isInstanceOf(...)` | 타입·메시지 검증을 한 체인으로 이어 쓴다 |
| AssertJ | `assertThatExceptionOfType(...).isThrownBy(() -> ...)` | 예외 타입을 문장 앞에 드러낸다 |
| JUnit | `assertThrows(Type.class, () -> ...)` | 예외 객체를 반환하므로 메시지는 별도로 검증한다 |

---

## 7. 람다 안에는 예외가 날 코드만 넣는다

람다 안에 여러 줄을 넣으면, 어느 줄에서 예외가 발생했는지 테스트가 구분하지 못한다.

```java
// 나쁜 예: 준비 코드에서 예외가 나도 테스트가 통과할 수 있다
assertThatThrownBy(() -> {
    Performance performance = new Performance("뮤지컬 위키드", "");
    bookingService.reserve(performance.getId(), 1L);
}).isInstanceOf(IllegalArgumentException.class);
```

이 테스트의 의도는 `reserve()`의 예외를 확인하는 것이다. 하지만 공연장이 빈 문자열이라 생성자에서 먼저 `IllegalArgumentException`이 발생하고, 테스트는 엉뚱한 이유로 통과한다.

준비 코드는 람다 밖으로 빼고, 람다에는 검증하려는 호출 한 줄만 둔다.

```java
Performance performance = new Performance("뮤지컬 위키드", "블루스퀘어");

assertThatThrownBy(() -> bookingService.reserve(performance.getId(), 1L))
        .isInstanceOf(IllegalArgumentException.class);
```

예외 타입만 검증하면 같은 타입의 다른 예외도 통과할 수 있다. `hasMessageContaining`으로 메시지까지 확인하면 이런 실수를 더 잘 잡아낸다.

---

## 8. 정리

`assertThat(실제값)`은 검증할 값을 먼저 받고, `isEqualTo`, `contains`, `hasSize` 같은 조건을 체인으로 이어 붙인다. 실제값의 타입에 맞는 메서드만 자동 완성되고, 실패하면 기대값과 실제값을 나란히 보여 주기 때문에 JUnit의 `assertEquals`보다 읽고 쓰기 쉽다.

`assertThatThrownBy`는 예외가 발생할 코드를 람다로 감싸 전달하고, `isInstanceOf`와 `hasMessage`로 예외의 타입과 메시지를 검증한다. 람다에는 검증하려는 호출 한 줄만 넣어야 엉뚱한 예외로 테스트가 통과하는 일을 막을 수 있다.

---

## 9. 참고 자료

* [AssertJ Core - Features Highlight](https://assertj.github.io/doc/#assertj-core-highlights)
* [AssertJ Core - Exception Assertions](https://assertj.github.io/doc/#assertj-core-exception-assertions)
* [AssertJ Assertions API](https://www.javadoc.io/doc/org.assertj/assertj-core/latest/org/assertj/core/api/Assertions.html)
