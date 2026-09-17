---
layout: post
title: "도메인 예외를 ProblemDetail HTTP 응답으로 변환하기"
date: 2026-09-17 17:21:52 +0900
categories: ["Backend"]
tags: ["spring-boot", "exception-handling", "problem-detail", "rest-api", "domain"]
---

## 1. 개요

예매 API에서 존재하지 않는 회차를 조회하면, 서비스의 도메인 규칙상 `ScheduleNotFoundException`이 발생할 수 있다. 이 예외를 컨트롤러마다 직접 잡아 HTTP 404 응답으로 바꾸면 같은 코드가 반복되고, 도메인 코드가 HTTP 규칙을 알게 될 위험도 생긴다.

Spring의 `@RestControllerAdvice`와 RFC 9457 형식의 `ProblemDetail`을 사용하면 이 변환을 한곳에 모을 수 있다. 이 글에서는 도메인 예외는 도메인에 남기고, 웹 계층에서 HTTP 오류 응답으로 바꾸는 방법을 정리한다.

---

## 2. 도메인 예외와 HTTP 응답은 역할이 다르다

`ScheduleNotFoundException`은 "요청한 회차가 없다"는 업무상 실패를 표현한다. 반면 HTTP 상태 코드 `404 Not Found`는 이 실패를 웹 클라이언트에 전달하는 방법이다. 둘은 관련 있지만 같은 관심사가 아니다.

도메인 예외가 `HttpStatus`나 `ProblemDetail`을 직접 사용하면, 웹 API가 아닌 다른 진입점에서도 HTTP 의존성이 따라온다. 예를 들어 배치 작업이나 메시지 소비자가 같은 서비스를 호출할 때도 HTTP 표현 방식이 섞이게 된다.

따라서 책임을 다음처럼 나눈다.

| 위치 | 책임 | 예시 |
| --- | --- | --- |
| 도메인 | 어떤 업무 규칙이 실패했는지 표현 | `ScheduleNotFoundException` |
| 웹 계층 | 예외를 HTTP 상태와 응답 본문으로 변환 | `BookingExceptionHandler` |
| 클라이언트 | HTTP 상태와 오류 코드를 보고 후속 처리 | `404`, `SCHEDULE_NOT_FOUND` |

이 구조에서 도메인은 HTTP를 모르고, 웹 계층이 예외와 API 계약의 연결을 맡는다.

---

## 3. 오류 코드는 HTTP 상태와 메시지를 한곳에 둔다

예외를 HTTP 응답으로 바꾸기 전에, API에서 사용할 오류 코드의 공통 정보를 정의한다. 아래 `BookingErrorCode`는 상태 코드와 기본 메시지를 함께 관리하는 예시다.

```java
package com.ticketing.booking.web;

import org.springframework.http.HttpStatus;

public enum BookingErrorCode {

    SCHEDULE_NOT_FOUND(HttpStatus.NOT_FOUND, "회차를 찾을 수 없다");

    private final HttpStatus status;
    private final String message;

    BookingErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getMessage() {
        return message;
    }
}
```

`SCHEDULE_NOT_FOUND`처럼 기계가 읽기 좋은 이름을 코드로 둔다. 상태 코드와 기본 메시지가 여러 컨트롤러에 흩어지지 않으므로, 같은 종류의 오류를 일관되게 응답할 수 있다.

여기서는 웹 API의 오류 표현을 모으기 위해 `BookingErrorCode`를 `web` 패키지에 두었다. 중요한 점은 `ScheduleNotFoundException` 같은 도메인 예외가 이 열거형이나 HTTP 상태 코드를 알지 않는다는 것이다.

---

## 4. `@RestControllerAdvice`에서 예외를 한 번에 처리한다

`@RestControllerAdvice`는 모든 REST 컨트롤러에 적용할 공통 예외 처리기를 등록한다. `@ExceptionHandler` 메서드는 지정한 예외가 컨트롤러 처리 중 발생했을 때 호출된다.

다음 코드는 `ScheduleNotFoundException`을 `SCHEDULE_NOT_FOUND` 오류 코드와 연결한다.

```java
package com.ticketing.booking.web;

import com.ticketing.booking.domain.ScheduleNotFoundException;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * booking 도메인 예외를 HTTP 응답으로 바꾼다.
 * 도메인 예외는 HTTP를 모르므로, 예외와 BookingErrorCode의 매핑을 여기서 한다.
 *
 * <p>응답은 RFC 9457 ProblemDetail 형식이다.</p>
 */
@RestControllerAdvice
public class BookingExceptionHandler {

    @ExceptionHandler(ScheduleNotFoundException.class)
    public ProblemDetail handle(ScheduleNotFoundException e) {
        return problem(BookingErrorCode.SCHEDULE_NOT_FOUND, e.getScheduleId());
    }

    /**
     * 에러 코드의 공통 메시지 뒤에 요청별 값(예: 회차 ID)을 붙인다.
     * code 속성은 클라이언트가 detail 문구를 파싱하지 않고
     * 에러 종류를 구분할 수 있게 넣는다.
     */
    private ProblemDetail problem(BookingErrorCode code, Object value) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            code.getStatus(),
            code.getMessage() + ": " + value
        );
        problem.setProperty("code", code.name());
        return problem;
    }
}
```

`handle()`은 예외에서 회차 ID를 꺼내고, 어떤 오류 코드에 해당하는지만 결정한다. 실제 `ProblemDetail` 생성은 `problem()` 메서드로 모아 두었으므로, 이후 좌석 부족이나 이미 취소된 예매처럼 다른 예외를 추가할 때도 같은 응답 형식을 재사용할 수 있다.

---

## 5. `ProblemDetail`은 표준 필드와 확장 필드를 함께 제공한다

`ProblemDetail.forStatusAndDetail()`은 상태 코드와 상세 메시지를 바탕으로 문제 응답 객체를 만든다. 위 코드에서 `HttpStatus.NOT_FOUND`를 전달했으므로 응답의 `status`는 404가 된다. 상태 코드에 맞는 기본 제목도 설정되어 `title`은 일반적으로 `Not Found`가 된다.

`setProperty("code", ...)`는 표준 필드 외에 애플리케이션 전용 필드를 추가하는 방법이다. 따라서 회차 ID가 `999`일 때 응답 본문은 다음과 같은 형태가 된다.

```json
{
  "status": 404,
  "title": "Not Found",
  "detail": "회차를 찾을 수 없다: 999",
  "code": "SCHEDULE_NOT_FOUND"
}
```

각 필드의 용도는 다음과 같다.

| 필드 | 용도 | 클라이언트 사용 예 |
| --- | --- | --- |
| `status` | HTTP 상태 코드 | 404 여부 확인 |
| `title` | 상태의 짧은 요약 | 공통 오류 제목 표시 |
| `detail` | 이번 요청에 대한 사람이 읽는 설명 | "회차를 찾을 수 없다: 999" 표시 |
| `code` | 애플리케이션이 정한 안정적인 오류 식별자 | `SCHEDULE_NOT_FOUND`일 때 회차 선택 화면 유지 |

특히 클라이언트가 `detail` 문자열을 비교해 분기하지 않도록 주의해야 한다. 메시지는 문구 수정, 다국어 처리, 요청별 값에 따라 달라질 수 있지만 `code`는 API 계약으로 유지할 수 있다.

---

## 6. 새 예외는 매핑만 추가해 확장한다

예를 들어 이후에 좌석이 없는 상황을 도메인 예외로 표현한다면, 웹 계층에는 오류 코드와 처리 메서드를 추가한다. 공통 응답 생성 로직은 그대로 사용한다.

```java
@ExceptionHandler(SeatNotAvailableException.class)
public ProblemDetail handle(SeatNotAvailableException e) {
    return problem(BookingErrorCode.SEAT_NOT_AVAILABLE, e.getSeatId());
}
```

이때 `BookingErrorCode`에는 `SEAT_NOT_AVAILABLE`의 상태 코드와 기본 메시지도 함께 정의한다. 어떤 상태 코드를 선택할지는 API가 표현하려는 실패의 의미에 따라 정해야 한다. 존재하지 않는 회차는 `404`가 자연스럽지만, 이미 다른 사용자가 선점한 좌석처럼 상태가 충돌한 경우에는 별도의 응답 정책이 필요할 수 있다.

컨트롤러 단위의 `try-catch`는 제거하고, 예외가 서비스에서 컨트롤러까지 전파되도록 둔다. 그러면 정상 흐름을 처리하는 컨트롤러 코드와 오류를 번역하는 코드가 섞이지 않는다.

---

## 7. 정리

`ScheduleNotFoundException`은 도메인에서 "회차가 없다"는 사실만 표현하고, `BookingExceptionHandler`는 이를 HTTP 404와 `ProblemDetail` 응답으로 변환한다. 이렇게 두 계층의 책임을 분리하면 도메인 코드가 웹 기술에 묶이지 않는다.

응답에는 사람이 읽는 `detail`뿐 아니라 `SCHEDULE_NOT_FOUND` 같은 `code`를 넣는 것이 좋다. 클라이언트는 변경될 수 있는 문구 대신 안정적인 오류 코드로 처리 분기를 만들 수 있고, 서버는 일관된 오류 응답 형식을 유지할 수 있다.

---

## 8. 참고 자료

* [Spring Framework - ProblemDetail](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html)
* [RFC 9457 - Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
