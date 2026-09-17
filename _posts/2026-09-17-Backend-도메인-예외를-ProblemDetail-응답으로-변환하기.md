---
layout: post
title: "도메인 예외를 ProblemDetail HTTP 응답으로 변환하기"
date: 2026-09-17 17:21:52 +0900
categories: ["Backend"]
tags: ["spring-boot", "exception-handling", "problem-detail", "rest-api", "domain"]
---

## 1. 개요

공연 예매 API의 `GET /schedules/{scheduleId}/seats`는 회차의 좌석 목록을 돌려준다. 그런데 없는 회차 ID로 요청하면 어떻게 응답해야 할까?

처음 구현에서는 서비스가 `IllegalArgumentException`을 던졌고, 이를 처리하는 곳이 없어 클라이언트는 `500 Internal Server Error`를 받았다. 클라이언트 입장에서는 "서버 버그"와 "없는 회차를 요청했다"를 구분할 수 없다.

이 글에서는 이 문제를 다음 세 조각으로 고친 코드를 보고, **각 조각을 왜 그렇게 나눴는지**를 정리한다.

| 조각 | 위치 | 하는 일 |
| --- | --- | --- |
| `ScheduleNotFoundException` | `booking.domain` | "회차가 없다"는 사실만 알린다 |
| `BookingErrorCode` | `booking.web` | 에러 종류별 HTTP 상태와 메시지를 정한다 |
| `BookingExceptionHandler` | `booking.web` | 예외를 에러 코드로 옮기고 `ProblemDetail` 응답을 만든다 |

> 환경: Spring Boot 4.1, Spring Framework 7.0.9, Jackson 3. Spring 내부 동작은 이 버전의 소스를 기준으로 설명한다.

---

## 2. 핸들러가 없으면 어떤 응답이 나가나

수정 전 서비스 코드는 다음과 같았다.

```java
public List<Seat> findSeats(Long scheduleId) {
    Schedule schedule =
        scheduleRepository
            .findById(scheduleId)
            .orElseThrow(() -> new IllegalArgumentException("회차가 없다: " + scheduleId));
    return seatRepository.findAllByPerformanceIdOrderByIdAsc(schedule.getPerformanceId());
}
```

`IllegalArgumentException`을 잡는 `@ExceptionHandler`가 없으면 예외는 서블릿 컨테이너까지 올라가고, Spring Boot의 기본 에러 처리(`BasicErrorController`)가 응답을 만든다.

```json
{
  "timestamp": "...",
  "status": 500,
  "error": "Internal Server Error",
  "path": "/schedules/999/seats"
}
```

문제는 두 가지다.

- **상태 코드가 틀렸다.** 요청한 자원이 없는 것이니 서버 오류(500)가 아니라 404가 맞다.
- **예외 타입이 의미를 담지 못한다.** `IllegalArgumentException`은 "인자가 이상하다"는 뜻이라, 엔티티 생성자의 불변식 위반(`좌석 가격은 음수일 수 없다`)과 "회차가 없다"가 같은 예외로 섞인다. 이 예외를 404로 바꾸면 불변식 위반까지 404가 되어 버린다.

그래서 먼저 "회차가 없다"를 뜻하는 전용 예외를 만든다.

---

## 3. 도메인 예외: 사실만 알리고 HTTP는 모른다

```java
package com.ticketing.booking.domain;

import lombok.Getter;

@Getter
public class ScheduleNotFoundException extends RuntimeException {

    /** 찾지 못한 회차 ID. 응답·로그에서 어느 회차였는지 보여줄 때 쓴다. */
    private final Long scheduleId;

    public ScheduleNotFoundException(Long scheduleId) {
        super("회차가 없다: " + scheduleId);
        this.scheduleId = scheduleId;
    }
}
```

### 3.1 `RuntimeException`을 상속하는 이유

체크 예외로 만들면 서비스와 컨트롤러 시그니처마다 `throws`가 붙는다. 이 예외는 호출하는 쪽이 복구할 수 있는 상황이 아니라 요청 자체가 잘못된 경우라, 중간 계층이 알 필요 없이 웹 계층까지 올라가면 된다.

또 Spring의 `@Transactional`은 기본적으로 **언체크 예외에서만 롤백**한다. 조회 서비스라 여기서는 영향이 없지만, 같은 방식의 예외를 쓰기 작업에서 던질 때도 따로 설정하지 않아도 롤백된다.

### 3.2 메시지가 아니라 필드로 ID를 들고 있는 이유

`super("회차가 없다: " + scheduleId)`로 메시지에도 ID가 들어가지만, 따로 `scheduleId` 필드를 둔다. 웹 계층이 응답을 만들 때 메시지 문자열을 파싱하지 않고 **값을 그대로 꺼내 쓰기 위해서**다. 메시지는 로그를 읽는 사람을 위한 것이고, 필드는 코드를 위한 것이다.

### 3.3 `HttpStatus`를 들고 있지 않는 이유

예외 안에 `HttpStatus.NOT_FOUND`를 넣으면 핸들러의 매핑 코드가 사라져 코드는 더 짧아진다. 그런데도 넣지 않은 이유는 세 가지다.

**① 같은 사실이라도 API마다 알맞은 상태 코드가 다르다.**

| 요청 | 회차 999가 없을 때 자연스러운 응답 |
| --- | --- |
| `GET /schedules/999/seats` | 주소가 가리키는 자원이 없다 → `404` |
| `POST /reservations { "scheduleId": 999 }` | 주소는 맞고 본문 값이 틀렸다 → `400` 또는 `422`로도 볼 수 있다 |

예외가 404를 들고 다니면 이 차이를 표현할 곳이 없다. "회차가 없다"는 도메인의 사실이고, 그 사실을 어떤 HTTP 응답으로 보여줄지는 웹 계층의 결정이다.

**② 도메인은 HTTP가 아닌 곳에서도 호출된다.** 예를 들어 만료된 선점을 푸는 스케줄러나 메시지 소비자가 같은 도메인 코드를 부를 때, `HttpStatus`를 들고 있는 예외는 의미가 맞지 않는다.

**③ 의존 방향이 한쪽으로 정리된다.** 도메인이 `org.springframework.http`를 import하지 않으면 의존은 항상 `web → domain` 방향이다. 나중에 모듈 경계를 테스트로 강제할 때 이 방향이 깨끗할수록 규칙이 단순해진다.

물론 이 선택에도 대가가 있다. 예외를 하나 추가할 때마다 에러 코드와 핸들러 메서드를 함께 늘려야 한다. 이 비용은 6장에서 다시 본다.

---

## 4. 에러 코드: 상태와 메시지를 한곳에 모은다

```java
package com.ticketing.booking.web;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum BookingErrorCode {
    /** 요청한 회차가 없다. 대응 예외: ScheduleNotFoundException */
    SCHEDULE_NOT_FOUND(HttpStatus.NOT_FOUND, "회차를 찾을 수 없다");

    /** 응답 상태 코드. */
    private final HttpStatus status;

    /** 응답 본문에 담을 설명. 어떤 ID였는지 같은 요청별 값은 핸들러가 덧붙인다. */
    private final String message;
}
```

### 4.1 enum으로 모으는 이유

상태 코드와 메시지가 핸들러 메서드마다 흩어지면, "회차 없음은 몇 번이었지?"를 찾으려고 코드를 뒤져야 한다. enum 하나를 보면 이 모듈이 내보내는 에러 목록 전체가 보인다. 상수 이름(`SCHEDULE_NOT_FOUND`)은 그대로 응답의 `code` 필드가 된다.

### 4.2 메시지에 ID를 넣지 않는 이유

enum의 메시지는 **모든 요청에 같은 문구**만 담는다. `999` 같은 요청별 값은 enum이 만들어지는 시점에 알 수 없으므로, 응답을 만드는 핸들러가 붙인다.

### 4.3 전역이 아니라 모듈 안에 두는 이유

`ErrorCode` 하나에 모든 에러를 모으는 방식도 흔하다. 하지만 이 프로젝트는 예약·결제·티켓을 모듈로 나누고 모듈끼리 의존하지 못하게 할 계획이다. 전역 에러 코드 파일이 있으면 **모든 모듈이 그 파일 하나에 의존**하게 되고, 한 모듈의 에러를 추가할 때마다 공용 파일이 바뀐다. 그래서 `BookingErrorCode`처럼 모듈 이름을 붙여 모듈 안에 둔다.

### 4.4 `domain`이 아니라 `web`에 두는 이유

`HttpStatus`를 필드로 들고 있기 때문이다. 3.3절에서 도메인이 HTTP를 모르게 했는데, 에러 코드를 `domain` 패키지에 두면 결국 도메인 패키지가 `HttpStatus`를 import하게 된다.

---

## 5. 핸들러: 예외를 코드로 옮기고 응답을 만든다

```java
package com.ticketing.booking.web;

import com.ticketing.booking.domain.ScheduleNotFoundException;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class BookingExceptionHandler {

    @ExceptionHandler(ScheduleNotFoundException.class)
    public ProblemDetail handle(ScheduleNotFoundException e) {
        return problem(BookingErrorCode.SCHEDULE_NOT_FOUND, e.getScheduleId());
    }

    private ProblemDetail problem(BookingErrorCode code, Object value) {
        ProblemDetail problem =
            ProblemDetail.forStatusAndDetail(code.getStatus(), code.getMessage() + ": " + value);
        problem.setProperty("code", code.name());
        return problem;
    }
}
```

### 5.1 `@RestControllerAdvice`: 변환을 한곳에 모은다

컨트롤러마다 `try-catch`로 예외를 잡아 404를 만들면 같은 코드가 반복되고, 정상 흐름을 처리하는 코드와 에러를 번역하는 코드가 섞인다. `@RestControllerAdvice`를 붙인 클래스의 `@ExceptionHandler`는 모든 컨트롤러에 공통으로 적용되므로, 컨트롤러와 서비스에는 `try-catch`가 하나도 없다.

`@RestControllerAdvice`는 `@ControllerAdvice` + `@ResponseBody`다. 그래서 메서드의 반환값이 뷰 이름이 아니라 응답 본문으로 쓰인다.

예외가 이 메서드까지 오는 흐름은 다음과 같다.

```
DispatcherServlet
 └ SeatController.findSeats(999)
    └ SeatQueryService.findSeats(999)   → ScheduleNotFoundException
 ← 예외가 컨트롤러 밖으로 나온다
ExceptionHandlerExceptionResolver
 1) 컨트롤러 클래스 안의 @ExceptionHandler를 찾는다 → 없음
 2) @ControllerAdvice 빈의 @ExceptionHandler를 찾는다 → BookingExceptionHandler.handle
 3) handle(e)를 호출하고 반환값을 응답으로 쓴다
```

`@ExceptionHandler`는 **예외 타입**으로 짝을 찾는다. 메서드 이름은 상관없으므로, 예외가 늘어나면 `handle(SeatAlreadyReservedException e)`처럼 같은 이름으로 오버로딩해도 된다.

### 5.2 `handle()`: 도메인과 웹이 만나는 유일한 줄

```java
return problem(BookingErrorCode.SCHEDULE_NOT_FOUND, e.getScheduleId());
```

이 한 줄이 "`ScheduleNotFoundException`은 `SCHEDULE_NOT_FOUND`(404)로 보여준다"는 결정이다. 3.3절에서 도메인 예외에 `HttpStatus`를 넣지 않았기 때문에, 이 결정이 도메인이 아니라 여기에 있다. 3.2절에서 ID를 필드로 둔 덕분에 `e.getScheduleId()`로 값을 바로 꺼낸다.

### 5.3 `problem()`: 응답 형식을 한 곳에서 만든다

응답을 만드는 코드를 `problem()`으로 모은 이유는, 예외가 늘어나도 **모든 에러 응답이 같은 모양**이 되게 하기 위해서다. 각 `handle()`은 "어떤 코드인지"와 "어떤 값을 붙일지"만 정한다.

**`ProblemDetail.forStatusAndDetail(status, detail)`**

`ProblemDetail`은 RFC 9457(Problem Details for HTTP APIs) 형식을 Spring이 구현한 클래스다. 에러 응답 모양을 직접 설계하지 않고 표준을 쓰면, 필드 이름을 두고 고민할 필요가 없고 표준을 아는 클라이언트·도구가 그대로 읽을 수 있다.

이 팩터리는 `status`와 `detail`만 채운다. `title`은 설정하지 않아도 되는데, `getTitle()`이 비어 있으면 상태 코드의 기본 문구를 돌려주기 때문이다.

```java
// Spring Framework 7.0.9 - ProblemDetail
public @Nullable String getTitle() {
    if (this.title == null) {
        HttpStatus httpStatus = HttpStatus.resolve(this.status);
        if (httpStatus != null) {
            return httpStatus.getReasonPhrase();   // 404 → "Not Found"
        }
    }
    return this.title;
}
```

**`setProperty("code", code.name())`**

표준 필드 외의 값을 넣는 방법이다. `detail`이 있는데 `code`를 따로 넣는 이유는 **클라이언트가 문구로 분기하지 않게 하기 위해서**다. 문구는 다듬거나 번역하면서 바뀔 수 있지만, `SCHEDULE_NOT_FOUND`라는 이름은 API 약속으로 유지할 수 있다. 반대로 말하면 **enum 상수 이름을 바꾸는 것은 API를 깨는 변경**이 된다.

### 5.4 `ProblemDetail`을 반환하면 Spring이 해주는 일

`ResponseEntity`로 감싸거나 `@ResponseStatus`를 붙이지 않았는데도 404가 나가는 이유는, 반환값을 처리하는 `HttpEntityMethodProcessor`가 `ProblemDetail`을 알고 있기 때문이다.

```java
// Spring Framework 7.0.9 - HttpEntityMethodProcessor.handleReturnValue()
else if (returnValue instanceof ProblemDetail detail) {
    httpEntity = ResponseEntity.of(detail).build();           // ① 상태 코드 = detail.getStatus()
}
...
if (httpEntity.getBody() instanceof ProblemDetail detail) {
    if (detail.getInstance() == null) {
        URI path = URI.create(inputMessage.getServletRequest().getRequestURI());
        detail.setInstance(path);                             // ② instance = 요청 경로
    }
    ...
}
```

1. `ProblemDetail`의 `status`로 HTTP 상태 코드를 정한다.
2. `instance`가 비어 있으면 요청 경로로 채운다.
3. JSON 변환기(`JacksonJsonHttpMessageConverter`)는 `ProblemDetail`에 `ProblemDetailJacksonMixin`을 붙여 직렬화하고, `Content-Type`을 `application/problem+json`으로 쓴다.

이 mixin에는 두 애노테이션이 있다.

- `@JsonInclude(NON_EMPTY)`: 값이 없는 필드는 JSON에서 뺀다. 그래서 설정하지 않은 `type`은 응답에 나오지 않는다.
- `@JsonAnyGetter`: `setProperty`로 넣은 맵을 `"properties": {...}`로 감싸지 않고 **최상위 필드로 풀어서** 내보낸다. 그래서 `code`가 `status`와 나란히 나온다.

### 5.5 최종 응답

위 내용을 합치면 회차 999를 요청했을 때 응답은 다음과 같다.

```
HTTP/1.1 404
Content-Type: application/problem+json
```

```json
{
  "title": "Not Found",
  "status": 404,
  "detail": "회차를 찾을 수 없다: 999",
  "instance": "/schedules/999/seats",
  "code": "SCHEDULE_NOT_FOUND"
}
```

| 필드 | 누가 채우나 | 용도 |
| --- | --- | --- |
| `title` | `ProblemDetail`이 상태 코드로 자동 계산 | 에러의 짧은 요약 |
| `status` | `BookingErrorCode.status` | HTTP 상태 코드와 같은 값 |
| `detail` | `BookingErrorCode.message` + 요청별 값 | 사람이 읽는 이번 요청의 설명 |
| `instance` | Spring이 요청 경로로 자동 설정 | 어느 요청에서 난 에러인지 |
| `code` | `setProperty`로 직접 추가 | 클라이언트가 분기에 쓰는 안정적인 식별자 |

> `instance` 필드는 코드에 없는데 응답에 나온다는 점이 헷갈리기 쉽다. 5.4절의 ②가 채운 것이다.

---

## 6. 이 설계의 비용과 한계

### 6.1 예외가 늘 때마다 두 곳을 고친다

좌석 선점 기능을 추가하면서 "이미 선점된 좌석" 예외가 생기면, 다음 두 곳을 함께 늘려야 한다.

```java
// BookingErrorCode
SEAT_ALREADY_RESERVED(HttpStatus.CONFLICT, "이미 선점된 좌석이다");

// BookingExceptionHandler
@ExceptionHandler(SeatAlreadyReservedException.class)
public ProblemDetail handle(SeatAlreadyReservedException e) {
    return problem(BookingErrorCode.SEAT_ALREADY_RESERVED, e.getSeatId());
}
```

예외에 `HttpStatus`를 직접 넣었다면 필요 없었을 코드다. 도메인을 HTTP에서 떼어 놓는 대가로 받아들였고, 예외가 수십 개로 늘어 매핑이 부담스러워지면 그때 다시 따져 볼 문제다.

### 6.2 붙일 값이 하나뿐이다

`problem(BookingErrorCode code, Object value)`는 요청별 값을 하나만 받는다. "회차 10의 좌석 5는 이미 선점됨"처럼 값이 여러 개 필요한 에러가 생기면 이 모양으로는 부족하다. 필요해질 때 바꾸기로 하고 지금은 단순하게 두었다.

### 6.3 모든 에러가 이 형식은 아니다

이 핸들러는 우리가 만든 도메인 예외만 처리한다. `/schedules/abc/seats`처럼 경로 변수 타입이 맞지 않는 경우는 Spring이 직접 예외를 던지고, 여전히 2장의 Boot 기본 형식으로 응답한다. `spring.mvc.problemdetails.enabled=true`를 켜면 Spring 기본 예외도 `ProblemDetail`로 바뀌지만, **우리 도메인 예외에는 영향이 없어서** 이 핸들러는 그대로 필요하다.

---

## 7. 정리

- 도메인 예외(`ScheduleNotFoundException`)는 **"회차가 없다"는 사실과 그 ID만** 들고 있다. HTTP 상태는 모른다. 같은 사실이라도 API마다 알맞은 상태 코드가 다르고, 도메인은 HTTP가 아닌 곳에서도 호출되기 때문이다.
- 에러 코드(`BookingErrorCode`)는 상태와 공통 메시지를 한곳에 모은다. 모듈끼리 묶이지 않게 **모듈 안에**, `HttpStatus`를 쓰므로 **`web` 패키지에** 둔다.
- 핸들러(`BookingExceptionHandler`)는 **예외 → 에러 코드 매핑**과 **응답 형식 만들기**를 맡는다. 컨트롤러와 서비스에는 `try-catch`가 없다.
- `ProblemDetail`을 반환하면 Spring이 상태 코드, `instance`, `application/problem+json`을 알아서 처리한다. 클라이언트는 문구가 아니라 `code`로 분기한다.

---

## 8. 참고 자료

* [RFC 9457 - Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
* [Spring Framework - ProblemDetail](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html)
* [Spring Framework Reference - Error Responses](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)
* [Spring Framework Reference - Exceptions (`@ExceptionHandler`)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-exceptionhandler.html)
