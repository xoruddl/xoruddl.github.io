---
layout: post
title: "MDC와 OncePerRequestFilter로 요청마다 로그 ID 붙이기"
date: 2026-09-27 17:24:02 +0900
categories: ["Backend", "Logging"]
tags: ["spring", "mdc", "logback", "servlet-filter", "OncePerRequestFilter", "로깅"]
---

## 1. 개요

공연 예매 서비스에서 여러 사용자가 같은 좌석을 동시에 예매하면, 서버 로그에는 여러 요청의 로그가 한데 섞여 찍힌다. 이때 "이 로그 한 줄이 어느 요청에서 나왔는가"를 알 수 없으면 동시성 문제를 추적하기 어렵다.

이 글에서는 **요청마다 짧은 식별자(요청 ID)를 만들어 모든 로그 줄에 자동으로 찍히게 하는 필터**를 보고, 코드의 각 줄을 왜 그렇게 썼는지 정리한다.

| 요소 | 하는 일 |
| --- | --- |
| `OncePerRequestFilter` | 요청이 들어올 때 한 번 실행되어 요청 ID를 만든다 |
| MDC | 요청 ID를 현재 스레드에 보관해 로그 패턴이 꺼내 쓰게 한다 |
| `X-Request-Id` 응답 헤더 | 클라이언트에게 요청 ID를 알려 준다 |

---

## 2. 스레드 이름만으로는 왜 부족한가

로그에는 보통 스레드 이름이 찍힌다. 요청 하나를 스레드 하나가 처리하니 스레드 이름으로 요청을 구분할 수 있을 것 같지만, 그렇지 않다.

톰캣은 요청마다 스레드를 새로 만들지 않고 **스레드 풀**에서 꺼내 쓰고 돌려놓는다. 그래서 `http-nio-8080-exec-3` 같은 같은 이름이 시간을 두고 여러 요청에 걸쳐 나온다. 아래는 이해를 돕기 위한 예시다.

```text
INFO [exec-3] 좌석 선점 시도 seatId=12
INFO [exec-5] 좌석 선점 시도 seatId=12
INFO [exec-3] 좌석 선점 성공 seatId=12
INFO [exec-3] 좌석 선점 시도 seatId=12   ← 앞의 exec-3과 같은 요청일까, 다른 요청일까?
```

요청 ID를 함께 찍으면 구분이 확실해진다.

```text
INFO [exec-3] [3f9a1c2e] 좌석 선점 시도 seatId=12
INFO [exec-5] [b71d04aa] 좌석 선점 시도 seatId=12
INFO [exec-3] [3f9a1c2e] 좌석 선점 성공 seatId=12
INFO [exec-3] [e02c9f51] 좌석 선점 시도 seatId=12   ← 다른 요청
```

---

## 3. MDC란

**MDC(Mapped Diagnostic Context)** 는 SLF4J가 제공하는 "스레드마다 따로 쓰는 key-value 저장소"다. 내부적으로는 `ThreadLocal`을 사용하므로, 한 스레드에서 넣은 값은 다른 스레드에서 보이지 않는다.

```java
MDC.put("requestId", "3f9a1c2e");   // 현재 스레드에 값 저장
MDC.remove("requestId");            // 현재 스레드에서 값 제거
```

MDC에 넣은 값은 로그 패턴에서 `%X{키}`로 꺼낸다. 로그를 찍는 코드(`log.info(...)`)를 하나도 고치지 않아도, 패턴만 바꾸면 모든 로그 줄에 값이 붙는다.

Spring Boot에서는 기본 로그 패턴의 레벨 부분을 `logging.pattern.level` 속성으로 바꿀 수 있다. 레벨 옆에 요청 ID를 붙이는 설정 예시는 다음과 같다.

```yaml
# application.yml
logging:
  pattern:
    level: "%5p [%X{requestId:-}]"
```

패턴 문자열은 Logback 문법을 따르며, 조각별 뜻은 다음과 같다.

| 조각 | 뜻 |
| --- | --- |
| `%5p` | 로그 레벨(`INFO`, `WARN` 등)을 최소 5칸에 오른쪽 정렬해 찍는다. 가장 긴 레벨 이름이 5글자라 모든 줄이 가지런해진다 |
| `[`, `]` | 그대로 찍히는 일반 문자 |
| `%X{requestId}` | MDC에서 `requestId` 값을 꺼내 찍는다 |
| `:-` | 값이 없을 때 쓸 기본값. 뒤가 비어 있으니 빈 문자열을 찍는다 |

이 문자열이 Spring Boot 기본 패턴에서 원래 `%5p`가 있던 레벨 자리에 들어간다. 그래서 로그는 다음처럼 찍힌다.

```text
2026-09-27T17:39:58.101+09:00  INFO [] 12345 --- [ticketing] [           main] com.ticketing.TicketingApplication       : Started TicketingApplication in 2.3 seconds
2026-09-27T17:40:12.345+09:00  INFO [3f9a1c2e] 12345 --- [ticketing] [nio-8080-exec-3] c.t.booking.application.SeatService      : 좌석 선점 시도 seatId=12
```

첫 줄은 애플리케이션 시작 로그처럼 요청과 무관한 로그라 MDC가 비어 있어 `[]`만 남는다. 둘째 줄은 요청을 처리하는 중이라 요청 ID가 찍혔다.

---

## 4. 필터 코드

요청이 들어올 때마다 ID를 만들어 MDC와 응답 헤더에 넣는 필터다.

```java
@Component
// 다른 필터가 남기는 로그에도 ID가 찍히도록 가장 먼저 돈다.
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

  static final String MDC_KEY = "requestId";
  static final String HEADER = "X-Request-Id";
  private static final int ID_LENGTH = 8;

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String requestId = newRequestId();
    MDC.put(MDC_KEY, requestId);
    response.setHeader(HEADER, requestId);
    try {
      chain.doFilter(request, response);
    } finally {
      // 스레드가 풀로 돌아가 다음 요청을 받을 때 앞 요청의 ID가 남아 있으면 안 된다.
      MDC.remove(MDC_KEY);
    }
  }

  private String newRequestId() {
    return UUID.randomUUID().toString().substring(0, ID_LENGTH);
  }
}
```

흐름은 "ID 생성 → MDC 저장 → 응답 헤더 설정 → 다음 필터와 컨트롤러 실행 → MDC 정리" 순서다. 아래에서 한 부분씩 살펴본다.

### 4.1 `OncePerRequestFilter`를 상속하는 이유

서블릿 요청은 처리 도중 내부적으로 다시 필터를 거칠 수 있다. 예를 들어 예외가 나서 에러 페이지로 넘어가면(error dispatch) 필터 체인이 한 번 더 실행된다. 일반 `Filter`로 만들면 이때 요청 ID가 새로 만들어져, **한 요청의 로그가 두 개의 ID로 쪼개진다.**

`OncePerRequestFilter`는 한 요청 안에서 필터가 한 번만 실행되도록 보장한다. 그래서 요청 ID도 요청당 하나로 유지된다.

### 4.2 `@Component`와 `@Order(HIGHEST_PRECEDENCE)`

Spring Boot는 `Filter` 타입의 빈을 찾아 서블릿 필터로 자동 등록한다. 그래서 `@Component`만 붙이면 모든 요청에 필터가 걸린다.

`@Order(Ordered.HIGHEST_PRECEDENCE)`는 이 필터를 **가장 먼저** 실행하라는 뜻이다. 요청 ID 필터보다 앞에서 도는 필터(예: Spring Security 필터)가 로그를 남기면, 그 시점에는 MDC가 비어 있어 ID가 찍히지 않는다. 가장 앞에 두면 뒤에 오는 모든 필터와 컨트롤러의 로그에 ID가 붙는다.

### 4.3 `chain.doFilter` 전에 응답 헤더를 넣는 이유

응답 본문이 클라이언트로 전송되기 시작하면(응답이 **커밋**되면) 그 뒤에는 헤더를 추가할 수 없다. 컨트롤러가 응답을 다 쓴 뒤인 `chain.doFilter` 이후에 헤더를 넣으면 무시될 수 있으므로, 체인을 실행하기 전에 넣는다.

클라이언트는 이 헤더 값으로 "내 요청의 서버 로그"를 찾을 수 있다. 사용자가 오류를 신고할 때 이 ID만 알려 주면 서버 로그에서 해당 요청을 바로 골라낼 수 있다.

---

## 5. `finally`에서 MDC를 지우는 이유

이 필터에서 가장 중요한 줄은 `finally` 블록의 `MDC.remove(MDC_KEY)`다.

MDC는 `ThreadLocal`이라 값이 **스레드에** 붙어 있다. 요청이 끝나도 스레드는 사라지지 않고 풀로 돌아가, 다음 요청을 처리하는 데 다시 쓰인다. 지우지 않으면 다음과 같은 일이 생긴다.

1. 요청 A가 `exec-3` 스레드에서 MDC에 `3f9a1c2e`를 넣는다.
2. 요청 A가 끝나고 `exec-3`이 풀로 돌아간다. MDC 값은 그대로 남아 있다.
3. 요청 B가 `exec-3`을 받는다. 새 ID로 덮어쓰기 전에 찍히는 로그가 있다면, 그 로그에는 **요청 A의 ID**가 찍힌다.

이 필터는 요청마다 `MDC.put`으로 덮어쓰기 때문에 3번이 드물 수 있다. 하지만 필터보다 앞에서 찍히는 로그나, 같은 스레드를 쓰는 다른 작업에서는 이전 요청의 ID가 그대로 보인다. 그래서 "넣었으면 반드시 지운다"를 `try-finally`로 강제한다. `finally`에 두어야 컨트롤러에서 예외가 나도 정리가 보장된다.

---

## 6. 설계 결정 정리

| 결정 | 이유 | 대가 |
| --- | --- | --- |
| 클라이언트가 보낸 헤더를 쓰지 않고 서버가 매번 생성 | 받은 값을 그대로 쓰면 같은 ID를 여러 요청에 실어 보내 로그를 섞을 수 있다 | 앞단 게이트웨이나 다른 서비스가 붙인 ID를 이어 받을 수 없다 |
| UUID 앞 8자만 사용 | 36자 UUID는 로그 한 줄에서 너무 많은 자리를 차지한다 | 전역으로 유일하지 않다 |
| `X-Request-Id` 응답 헤더 | 클라이언트가 받은 ID로 서버 로그를 찾을 수 있다 | — |
| 루트 패키지(`com.ticketing`)에 배치 | 특정 업무 모듈이 아니라 모든 요청에 걸리는 기술 장치다 | — |

### 6.1 8자로 충분한가

UUID 문자열의 앞 8자는 16진수 8자리, 즉 32비트다. 가능한 값은 약 43억 개지만, **생일 문제**(무작위로 뽑을 때 겹칠 확률이 생각보다 빨리 커지는 현상) 때문에 요청이 쌓일수록 충돌 확률이 빠르게 오른다.

| 요청 수 | 한 쌍 이상 ID가 겹칠 확률(근사) |
| --- | --- |
| 1만 건 | 약 1% |
| 약 6만 5천 건 | 약 39% |

그래서 이 ID는 "서비스 전체에서 유일한 식별자"가 아니라, **한 번의 테스트나 짧은 시간대의 로그 안에서 요청을 가르는 용도**로 범위를 좁혀 쓴다. 로그를 검색할 때 시간 범위를 함께 걸면 실제로 섞일 일은 거의 없다.

---

## 7. 동작 확인

서버를 띄우고 좌석 조회 API를 호출해 응답 헤더를 확인한다.

```bash
curl -i http://localhost:8080/schedules/1/seats
```

응답 헤더에 요청 ID가 있으면 필터가 동작하는 것이다.

```text
HTTP/1.1 200
X-Request-Id: 3f9a1c2e
Content-Type: application/json
...
```

이 값으로 서버 로그를 검색하면 해당 요청의 로그만 모인다.

```bash
grep 3f9a1c2e app.log
```

---

## 8. 한계와 주의점

- **스레드가 바뀌면 MDC가 따라가지 않는다.** `@Async`, `CompletableFuture.supplyAsync`처럼 작업을 다른 스레드로 넘기면 그 스레드의 MDC는 비어 있다. 이 경우 작업을 넘길 때 MDC 값을 복사해 주는 장치(예: Spring의 `TaskDecorator`)가 따로 필요하다.
- **서비스가 여러 개로 나뉘면 요청 ID만으로는 부족하다.** 한 요청이 여러 서비스를 거칠 때는 서비스 간에 ID를 전달해야 하는데, 이 필터는 일부러 외부 ID를 받지 않는다. 이런 환경에서는 Micrometer Tracing처럼 traceId를 전파하는 도구를 쓰는 편이 낫다. 이 글의 필터는 단일 애플리케이션에서 동시 요청 로그를 가르는 학습용·소규모 용도에 맞춘 것이다.

---

## 9. 정리

동시 요청의 로그를 구분하려면 요청마다 식별자를 붙여야 한다. 톰캣은 스레드를 재사용하므로 스레드 이름으로는 요청을 가를 수 없다. 대신 필터에서 요청 ID를 만들어 MDC에 넣으면, 로그 패턴의 `%X{requestId}`가 모든 로그 줄에 자동으로 찍어 준다.

`OncePerRequestFilter`는 한 요청에 ID가 하나만 생기게 하고, `@Order(HIGHEST_PRECEDENCE)`는 다른 필터의 로그에도 ID가 붙게 한다. 응답 헤더는 커밋 전에 넣어야 하고, MDC는 스레드 풀 재사용 때문에 `finally`에서 반드시 지워야 한다.

8자 ID는 전역으로 유일하지 않지만, 짧은 시간대의 로그 안에서 요청을 가르는 용도로는 충분하다. 비동기 작업이나 여러 서비스로 범위가 넓어지면 MDC 전달이나 분산 추적 도구를 함께 검토한다.
