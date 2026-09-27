---
layout: post
title: "Actuator와 Micrometer (2) - Micrometer로 메트릭 수집하고 Prometheus로 내보내기"
date: 2026-09-27 23:31:05 +0900
categories: ["Backend", "Monitoring"]
tags: ["spring", "spring-boot", "actuator", "micrometer", "prometheus", "metrics", "모니터링"]
---

## 1. 개요

1편에서는 Actuator의 `health`로 "서버가 살아 있는가"를 확인했다. 하지만 운영에서는 "좌석 조회 API가 요즘 느려지지 않았나?", "오늘 예매가 몇 건 성공했나?"처럼 **숫자로 답해야 하는 질문**도 많다.

이런 숫자를 **메트릭**(metric)이라고 하고, Spring Boot에서는 **Micrometer**가 메트릭 수집을 맡는다. 이 글에서는 기본 메트릭을 확인하고, 예매 건수와 처리 시간을 직접 기록한 뒤, Prometheus 형식으로 내보내는 과정까지 다룬다.

1편의 `spring-boot-starter-actuator` 의존성과 `metrics` 엔드포인트 노출 설정을 그대로 이어서 사용한다.

---

## 2. Micrometer란

모니터링 시스템은 Prometheus, Datadog, CloudWatch 등 여러 가지이고, 각자 데이터를 받는 형식이 다르다. 애플리케이션 코드가 특정 시스템의 API를 직접 쓰면, 모니터링 시스템을 바꿀 때 코드도 모두 고쳐야 한다.

Micrometer는 그 사이에 끼는 **공통 인터페이스**다. 로그에서 SLF4J가 Logback·Log4j2 같은 구현체를 감추듯, Micrometer는 모니터링 시스템을 감춘다. 코드는 Micrometer API로만 메트릭을 기록하고, 어느 시스템으로 보낼지는 의존성(레지스트리)으로 고른다.

메트릭은 **MeterRegistry**(메트릭 저장소)에 등록된 **Meter**(계측기)로 기록한다. 자주 쓰는 Meter는 네 가지다.

| Meter | 기록하는 것 | 예시 |
| --- | --- | --- |
| `Counter` | 계속 늘어나기만 하는 횟수 | 예매 성공 건수 |
| `Gauge` | 지금 이 순간의 값(오르내림) | 현재 대기열 길이 |
| `Timer` | 걸린 시간과 횟수 | 예매 처리 시간 |
| `DistributionSummary` | 시간이 아닌 값의 분포 | 한 번에 예매한 좌석 수 |

Actuator를 추가하면 Spring Boot가 `MeterRegistry` 빈을 만들고, JVM 메모리·HTTP 요청·DB 커넥션 풀 같은 기본 메트릭을 자동으로 채운다.

---

## 3. metrics로 기본 메트릭 보기

먼저 수집 중인 메트릭 이름 목록을 본다.

```bash
curl http://localhost:8080/actuator/metrics
```

```json
{
  "names": [
    "hikaricp.connections.active",
    "http.server.requests",
    "jvm.memory.used",
    "process.cpu.usage",
    "..."
  ]
}
```

이름을 경로 뒤에 붙여 호출하면 값이 나온다. 가장 많이 보는 것은 HTTP 요청 메트릭인 `http.server.requests`다. 좌석 조회 API를 몇 번 호출한 뒤 확인해 보자.

```bash
curl "http://localhost:8080/actuator/metrics/http.server.requests?tag=uri:/schedules/{scheduleId}/seats"
```

```json
{
  "name": "http.server.requests",
  "baseUnit": "seconds",
  "measurements": [
    { "statistic": "COUNT", "value": 5.0 },
    { "statistic": "TOTAL_TIME", "value": 0.231 },
    { "statistic": "MAX", "value": 0.087 }
  ],
  "availableTags": [
    { "tag": "method", "values": ["GET"] },
    { "tag": "status", "values": ["200"] },
    { "tag": "outcome", "values": ["SUCCESS"] }
  ]
}
```

5번 호출에 총 0.231초가 걸렸고, 가장 느린 요청은 0.087초였다는 뜻이다. 평균은 `TOTAL_TIME / COUNT`로 계산한다.

여기서 **태그**(tag)가 중요하다. 태그는 같은 메트릭을 나눠 보는 기준(key-value)이다. `uri`, `method`, `status` 태그 덕분에 "좌석 조회 API의 200 응답만" 같은 식으로 좁혀 볼 수 있다. `uri` 태그에는 실제 값(`/schedules/1/seats`)이 아니라 **경로 템플릿**(`{scheduleId}`)이 들어간다는 점도 눈여겨보자. 그 이유는 5장에서 다룬다.

---

## 4. 직접 메트릭 만들기

기본 메트릭은 "API가 몇 번 호출됐나"까지만 알려 준다. "예매가 몇 건 성공하고 몇 건 실패했나" 같은 **업무 메트릭**은 직접 기록해야 한다.

`MeterRegistry`를 주입받아 Counter와 Timer를 만든다. 실제 예매 로직은 `ReservationProcessor`에 있다고 가정하고, 서비스는 그 앞뒤로 메트릭만 기록한다.

```java
@Service
public class ReservationService {

  private final ReservationProcessor processor;
  private final MeterRegistry meterRegistry;
  private final Timer reservationTimer;

  public ReservationService(ReservationProcessor processor, MeterRegistry meterRegistry) {
    this.processor = processor;
    this.meterRegistry = meterRegistry;
    this.reservationTimer = Timer.builder("ticketing.reservation.duration")
        .description("예매 처리 시간")
        .register(meterRegistry);
  }

  public Long reserve(Long scheduleId, Long seatId, Long memberId) {
    try {
      Long reservationId = reservationTimer.record(
          () -> processor.reserve(scheduleId, seatId, memberId));
      countResult("success");
      return reservationId;
    } catch (RuntimeException e) {
      countResult("failure");
      throw e;
    }
  }

  private void countResult(String result) {
    Counter.builder("ticketing.reservations")
        .description("예매 시도 결과")
        .tag("result", result)
        .register(meterRegistry)
        .increment();
  }
}
```

코드에서 짚을 부분은 세 가지다.

- **Timer**: `record(...)`에 넘긴 작업을 실행하면서 걸린 시간을 잰다. 작업의 반환값은 그대로 돌려준다.
- **Counter**: `increment()`로 1씩 올린다. 성공과 실패를 메트릭 이름으로 나누지 않고 `result` 태그로 구분했다. 그래야 "전체 시도 수"와 "실패 비율"을 한 메트릭에서 계산할 수 있다.
- **`register`를 매번 불러도 되는 이유**: 이름과 태그가 같은 Meter가 이미 있으면 새로 만들지 않고 기존 것을 돌려준다.

메트릭 이름은 소문자 단어를 점(`.`)으로 잇는 것이 Micrometer 관례다. 이름 앞에 `ticketing.`을 붙여 기본 메트릭과 섞이지 않게 했다. 예매를 몇 번 해 본 뒤 확인한다.

```bash
curl "http://localhost:8080/actuator/metrics/ticketing.reservations?tag=result:success"
```

`COUNT` 값이 성공한 예매 건수와 같으면 Counter가 동작하는 것이다.

---

## 5. 태그에 넣으면 안 되는 값

태그 값이 달라질 때마다 Micrometer는 **별도의 시계열**(시간에 따라 쌓이는 숫자 한 줄)을 만든다. `result` 태그처럼 값이 `success`, `failure` 두 개뿐이면 시계열도 두 개다.

그런데 태그에 회원 ID나 좌석 ID를 넣으면 회원 수만큼 시계열이 생긴다. 이렇게 태그 값의 종류가 많은 것을 **카디널리티(cardinality)가 높다**고 하며, 애플리케이션 메모리와 모니터링 시스템의 저장 공간을 빠르게 잡아먹는다. 3장에서 `uri` 태그에 실제 경로 대신 경로 템플릿이 들어간 것도 같은 이유다.

| 태그로 적합 | 태그로 부적합 |
| --- | --- |
| 결과(`success`/`failure`), HTTP 메서드, 상태 코드 | 회원 ID, 좌석 ID, 예매 번호, 요청 ID |

특정 요청 하나를 추적하는 정보는 메트릭이 아니라 로그에 남긴다. 요청 ID를 로그에 붙이는 방법은 "MDC와 OncePerRequestFilter로 요청마다 로그 ID 붙이기" 글에서 다뤘다.

---

## 6. Prometheus 형식으로 내보내기

`/actuator/metrics`는 사람이 가끔 확인하기엔 좋지만, 시간에 따른 변화를 그래프로 보려면 메트릭을 주기적으로 모아 저장하는 시스템이 필요하다. 대표적인 것이 **Prometheus**다. Prometheus는 정해진 주기마다 애플리케이션의 주소를 호출해 메트릭을 긁어 간다.

2장에서 말한 "레지스트리를 골라 끼우는" 부분이 여기다. Prometheus용 레지스트리 의존성을 추가한다.

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    runtimeOnly 'io.micrometer:micrometer-registry-prometheus'
}
```

그리고 1편의 노출 설정에 `prometheus`를 추가한다.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, metrics, prometheus
```

`/actuator/prometheus`를 호출하면 Prometheus가 읽는 텍스트 형식으로 메트릭이 나온다. 아래는 4장에서 만든 메트릭만 골라 본 예시다.

```bash
curl -s http://localhost:8080/actuator/prometheus | grep ticketing
```

```text
ticketing_reservations_total{result="success"} 12.0
ticketing_reservations_total{result="failure"} 3.0
ticketing_reservation_duration_seconds_count 15.0
ticketing_reservation_duration_seconds_sum 0.842
ticketing_reservation_duration_seconds_max 0.121
```

`ReservationService` 코드는 한 줄도 바꾸지 않았는데 새 형식으로 메트릭이 나온다. 이름도 Micrometer가 Prometheus 관례에 맞춰 바꿔 준다.

| Micrometer 이름 | Prometheus 이름 | 바뀐 점 |
| --- | --- | --- |
| `ticketing.reservations` (Counter) | `ticketing_reservations_total` | 점 → 밑줄, Counter에 `_total` |
| `ticketing.reservation.duration` (Timer) | `..._seconds_count`, `_sum`, `_max` | 단위 `_seconds`와 통계별 접미사 |

이후 Prometheus 서버에 이 주소를 수집 대상으로 등록하고, Grafana 같은 도구로 그래프를 그리는 것이 일반적인 구성이다. 1편에서 말했듯 운영 환경에서는 이 엔드포인트도 관리용 포트로 분리해 내부 모니터링 시스템만 접근하게 하는 것이 좋다.

---

## 7. 정리

Micrometer는 메트릭 기록용 공통 인터페이스다. Spring Boot가 HTTP 요청·JVM·커넥션 풀 같은 기본 메트릭을 채워 주고, `/actuator/metrics`에서 이름과 태그로 골라 볼 수 있다.

업무 메트릭은 `MeterRegistry`로 Counter·Timer를 만들어 직접 기록한다. 태그로 메트릭을 나눠 볼 수 있지만, 회원 ID처럼 값의 종류가 많은 정보는 태그가 아니라 로그에 남긴다.

모니터링 시스템은 레지스트리 의존성으로 고른다. `micrometer-registry-prometheus`를 추가하면 코드 변경 없이 `/actuator/prometheus`로 메트릭이 나오고, 이를 Prometheus와 Grafana로 수집해 시간에 따른 변화를 볼 수 있다.
