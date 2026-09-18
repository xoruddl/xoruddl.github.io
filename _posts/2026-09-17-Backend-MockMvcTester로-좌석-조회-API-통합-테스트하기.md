---
layout: post
title: "MockMvcTester로 좌석 조회 API 통합 테스트하기"
date: 2026-09-17 20:32:58 +0900
categories: ["Backend"]
tags: ["spring-boot", "integration-test", "mockmvc", "mockmvc-tester", "testcontainers", "problem-detail"]
---

## 1. 개요

`GET /schedules/{scheduleId}/seats`는 컨트롤러만 정상이라고 해서 충분하지 않다. 요청 경로가 컨트롤러에 연결되고, 서비스가 회차와 좌석을 조회하고, JPA가 DB에서 데이터를 읽고, 마지막으로 JSON 응답까지 만들어져야 한다.

이 글에서는 `SeatQueryTest`로 이 흐름을 한 번에 검증한다. 정상 조회에서는 좌석 배열을, 없는 회차 조회에서는 `ProblemDetail` 기반의 404 응답을 확인한다.

| 검증 대상 | 테스트가 확인하는 결과 |
| --- | --- |
| 요청 매핑 | `/schedules/{scheduleId}/seats`가 처리된다 |
| 조회 로직 | 픽스처가 저장한 좌석만 올바른 순서로 나온다 |
| JSON 직렬화 | `SeatPosition`이 API 필드로 풀려 나온다 |
| 예외 처리 | 없는 회차가 500이 아니라 404 ProblemDetail이 된다 |

---

## 2. `@SpringBootTest`로 실제 빈을 조립한다

테스트 클래스는 다음과 같이 시작한다.

```java
/** 회차 좌석 조회 API의 요청·DB 조회·응답 JSON을 함께 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, BookingFixture.class})
class SeatQueryTest {

    @Autowired
    MockMvcTester mvc;

    @Autowired
    BookingFixture fixture;
}
```

각 애너테이션과 주입받는 객체의 역할은 다음과 같다.

| 요소 | 역할 |
| --- | --- |
| `@SpringBootTest` | 애플리케이션의 `ApplicationContext`를 실제 구성한다 |
| `@AutoConfigureMockMvc` | 서버 포트를 열지 않고 `MockMvcTester`를 자동 구성한다 |
| `@Import(TestcontainersConfiguration.class)` | 테스트 DB 컨테이너 설정을 테스트 컨텍스트에 추가한다 |
| `@Import(BookingFixture.class)` | 테스트 데이터를 만드는 픽스처를 빈으로 등록한다 |
| `MockMvcTester` | HTTP 요청을 만들고 AssertJ 방식으로 응답을 검증한다 |

`@SpringBootTest`는 애플리케이션의 실제 빈을 사용하지만, 기본 웹 환경은 mock이므로 내장 서버를 실제 포트에 띄우지는 않는다. `@AutoConfigureMockMvc`를 함께 쓰면 `MockMvc`와 `MockMvcTester`를 주입받아 MVC 요청 처리를 검증할 수 있다. 이 조합은 컨트롤러부터 DB 접근, 예외 처리까지 함께 확인하면서도 네트워크 포트를 열지 않는 통합 테스트다. [Spring Boot 테스트 문서](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html)에서도 이 구성을 안내한다.

---

## 3. 픽스처로 테스트에 필요한 상태를 만든다

테스트는 기존 DB 데이터에 의존하면 실행 순서나 다른 테스트의 영향으로 깨지기 쉽다. 그래서 `BookingFixture`가 회차와 좌석을 직접 만들고, 테스트는 그 결과인 `Stage`만 사용한다.

```java
Stage stage = fixture.createStage(3);
```

이 호출은 테스트용 회차 하나와 좌석 세 개를 저장하고, 이후 검증에 필요한 ID를 `Stage`로 돌려준다. DB가 ID를 생성하므로 `101`, `102`처럼 특정 숫자를 테스트에 직접 쓰지 않는다. 대신 `stage.scheduleId()`와 `stage.seatId(0)`처럼 픽스처가 실제로 저장한 값을 사용한다.

이 방식의 장점은 테스트가 "세 개의 좌석을 만들었다"는 의도에 집중한다는 점이다. DB의 ID 생성 방식이나 이전 테스트가 사용한 ID에 결합되지 않는다.

---

## 4. 정상 조회는 배열의 모양과 값을 함께 검사한다

정상 요청의 테스트는 다음과 같다.

```java
@Test
void 회차의_좌석_목록을_조회한다() {
    Stage stage = fixture.createStage(3);

    // 응답은 좌석 객체의 배열이다. 루트가 배열이라 경로가 $[0].seatId 모양이 된다.
    // seatId는 DB가 매기므로 실행마다 다르다. 그래서 숫자 대신 stage.seatId(n)과 비교한다.
    // 200 application/json
    // [
    //   {"seatId":101,"section":"A","rowName":"1","seatNumber":1,"grade":"VIP","price":150000},
    //   {"seatId":102,"section":"A","rowName":"1","seatNumber":2,"grade":"VIP","price":150000},
    //   {"seatId":103,"section":"A","rowName":"1","seatNumber":3,"grade":"VIP","price":150000}
    // ]
    assertThat(mvc.get().uri("/schedules/{scheduleId}/seats", stage.scheduleId()))
        .hasStatusOk()
        .bodyJson()
        .satisfies(
            json -> {
                // 응답 루트는 배열이다. $[0]은 첫 번째 좌석을 뜻한다.
                assertThat(json).extractingPath("$.length()").isEqualTo(3);
                assertThat(json).extractingPath("$[0].seatId")
                    .isEqualTo(stage.seatId(0).intValue());
                assertThat(json).extractingPath("$[2].seatId")
                    .isEqualTo(stage.seatId(2).intValue());

                // SeatPosition은 API에서 위치 필드 세 개로 표현된다.
                assertThat(json).extractingPath("$[0].section").isEqualTo("A");
                assertThat(json).extractingPath("$[0].rowName").isEqualTo("1");
                assertThat(json).extractingPath("$[0].seatNumber").isEqualTo(1);
                assertThat(json).extractingPath("$[0].grade").isEqualTo("VIP");
                assertThat(json).extractingPath("$[0].price")
                    .isEqualTo((int) BookingFixture.SEAT_PRICE);
            });
}
```

응답은 다음과 같은 JSON 배열이다.

```json
[
  {"seatId": 101, "section": "A", "rowName": "1", "seatNumber": 1, "grade": "VIP", "price": 150000},
  {"seatId": 102, "section": "A", "rowName": "1", "seatNumber": 2, "grade": "VIP", "price": 150000},
  {"seatId": 103, "section": "A", "rowName": "1", "seatNumber": 3, "grade": "VIP", "price": 150000}
]
```

예시의 `seatId` 값은 설명을 위한 것이며 실제 테스트에서는 `stage.seatId(n)`으로 비교한다. 반면 구역, 열, 등급, 가격은 픽스처가 의도적으로 만든 값이므로 API 계약으로 검증한다.

`bodyJson()`은 응답 본문을 JSON으로 다루게 한다. `extractingPath()`에는 JSONPath를 전달한다. 루트가 배열이면 `$[0].seatId`처럼 첫 원소부터 시작하고, 루트가 객체이면 `$.code`처럼 필드 이름으로 바로 들어간다. `MockMvcTester`의 JSONPath 검증 방식은 [Spring Framework AssertJ 통합 문서](https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj/assertions.html)에서 확인할 수 있다.

---

## 5. 없는 회차는 404 ProblemDetail을 검증한다

없는 회차 요청도 API 계약의 일부다. 이 프로젝트의 IDENTITY 전략은 ID를 1부터 생성하므로, 데이터가 없는 `0L`을 없는 회차 ID로 사용한다.

```java
@Test
void 없는_회차의_좌석을_조회하면_404를_응답한다() {
    long missingScheduleId = 0L;

    // 응답은 ProblemDetail 객체 하나다. 루트가 객체라 경로가 $.code 모양이 된다.
    // code는 ProblemDetail의 properties 맵에 들어 있지만, 직렬화할 때 최상위 필드로 풀려 나온다.
    // 필드 순서는 의미가 없다. JSON 객체는 이름으로 값을 찾는다.
    // 404 application/problem+json
    // {
    //   "detail":"회차를 찾을 수 없다: 0",
    //   "instance":"/schedules/0/seats",
    //   "status":404,
    //   "title":"Not Found",
    //   "code":"SCHEDULE_NOT_FOUND"
    // }
    assertThat(mvc.get().uri("/schedules/{scheduleId}/seats", missingScheduleId))
        .hasStatus(HttpStatus.NOT_FOUND)
        .hasContentType(MediaType.APPLICATION_PROBLEM_JSON)
        .bodyJson()
        .satisfies(
            json -> {
                assertThat(json).extractingPath("$.code")
                    .isEqualTo("SCHEDULE_NOT_FOUND");
                assertThat(json).extractingPath("$.detail")
                    .isEqualTo("회차를 찾을 수 없다: 0");
                assertThat(json).extractingPath("$.instance")
                    .isEqualTo("/schedules/0/seats");
            });
}
```

이 응답의 루트는 배열이 아니라 `ProblemDetail` 객체다.

```json
{
  "detail": "회차를 찾을 수 없다: 0",
  "instance": "/schedules/0/seats",
  "status": 404,
  "title": "Not Found",
  "code": "SCHEDULE_NOT_FOUND"
}
```

`hasStatus(HttpStatus.NOT_FOUND)`는 HTTP 상태를, `hasContentType(MediaType.APPLICATION_PROBLEM_JSON)`는 에러 응답의 미디어 타입을 검증한다. `code`는 `ProblemDetail.setProperty("code", ...)`로 넣은 확장 필드다. Spring은 Jackson으로 직렬화할 때 `properties` 맵의 값을 최상위 JSON 필드로 펼친다. `instance`는 별도로 설정하지 않으면 현재 요청 경로로 채워진다. 이 동작은 [Spring Framework의 ProblemDetail 문서](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html)에 설명되어 있다.

---

## 6. 무엇을 고정하고 무엇을 유연하게 둘까

통합 테스트는 응답의 모든 글자와 필드를 무조건 비교하는 테스트가 아니다. 클라이언트가 의존하는 계약은 단단히 고정하고, DB가 생성하는 값처럼 실행마다 바뀔 수 있는 값은 픽스처의 결과로 비교해야 한다.

| 구분 | 이 테스트의 선택 | 이유 |
| --- | --- | --- |
| 회차·좌석 ID | `stage.scheduleId()`, `stage.seatId(n)`과 비교 | DB가 만든 실제 ID를 사용 |
| 좌석 수·순서 | 정확히 `3`, 첫 번째·세 번째 좌석을 확인 | 조회 정렬과 누락을 발견 |
| 응답 필드 | 위치·등급·가격을 확인 | API JSON 계약을 보호 |
| 에러 상태·코드 | 404와 `SCHEDULE_NOT_FOUND`를 확인 | 클라이언트의 오류 처리 계약을 보호 |
| JSON 객체 필드 순서 | 검증하지 않음 | JSON 객체는 필드 순서에 의미가 없음 |

`0L`이 항상 없는 ID라는 전제는 현재 IDENTITY 생성 전략에 의존한다. 이 전략이나 테스트 DB 초기화 방식이 바뀐다면, "저장하지 않은 회차 ID"를 만들도록 픽스처와 테스트를 함께 고쳐야 한다.

---

## 7. 테스트 실행하기

클래스 하나만 실행하려면 프로젝트 루트에서 다음 명령을 사용한다.

```bash
./gradlew test --tests '*SeatQueryTest'
```

전체 테스트는 다음과 같이 실행한다.

```bash
./gradlew test
```

Testcontainers를 사용하는 테스트는 Docker 데몬이 실행 중이어야 한다. CI에서도 같은 테스트를 돌리려면 GitHub-hosted runner에서 Docker를 사용할 수 있는지와 테스트 컨테이너 설정을 함께 확인해야 한다.

---

## 8. 정리

`SeatQueryTest`는 단순히 컨트롤러 메서드를 호출하지 않는다. 실제 Spring 빈, Testcontainers DB, JPA 조회, 예외 핸들러, JSON 직렬화를 거친 응답을 검증한다. 그래서 경로 매핑 오류, 저장소 쿼리 오류, 응답 DTO 변경, 예외 응답 형식 변경을 한 테스트에서 발견할 수 있다.

정상 응답에서는 배열의 크기와 값·순서를, 실패 응답에서는 상태 코드·미디어 타입·ProblemDetail의 `code`를 확인했다. 이렇게 클라이언트가 실제로 의존하는 HTTP 계약을 테스트로 남겨 두면 API를 변경할 때 의도치 않은 호환성 깨짐을 빠르게 발견할 수 있다.
