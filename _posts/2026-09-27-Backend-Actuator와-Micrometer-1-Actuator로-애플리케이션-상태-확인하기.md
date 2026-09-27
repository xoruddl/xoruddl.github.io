---
layout: post
title: "Actuator와 Micrometer (1) - Actuator로 애플리케이션 상태 확인하기"
date: 2026-09-27 23:30:34 +0900
categories: ["Backend", "Monitoring"]
tags: ["spring", "spring-boot", "actuator", "health-check", "모니터링"]
---

## 1. 개요

공연 예매 서비스를 운영하다 보면 "서버가 지금 살아 있나?", "DB 연결은 괜찮나?", "좌석 조회 API가 요즘 느려지지 않았나?" 같은 질문에 답해야 한다. 로그만으로는 이런 질문에 빠르게 답하기 어렵다.

Spring Boot는 이 문제를 두 도구로 푼다. **Actuator**는 애플리케이션 상태를 HTTP로 들여다보는 창구를 열어 주고, **Micrometer**는 요청 수·응답 시간 같은 숫자(메트릭)를 모아 준다.

| 도구 | 한 줄 설명 | 비유 |
| --- | --- | --- |
| Actuator | 애플리케이션 내부 정보를 `/actuator/*` 주소로 보여 준다 | 자동차 계기판 |
| Micrometer | 메트릭을 수집하고 여러 모니터링 시스템 형식으로 내보낸다 | 계기판 뒤의 센서 |

이 글에서는 Actuator를 켜고 상태를 확인하는 방법까지 다루고, 메트릭은 2편에서 이어서 다룬다.

---

## 2. Actuator 시작하기

Actuator는 스타터 의존성 하나만 추가하면 켜진다.

```groovy
// build.gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
}
```

애플리케이션을 다시 띄운 뒤 `/actuator`를 호출하면, 지금 열려 있는 **엔드포인트**(Actuator가 제공하는 조회용 주소) 목록이 나온다.

```bash
curl http://localhost:8080/actuator
```

```json
{
  "_links": {
    "self": { "href": "http://localhost:8080/actuator" },
    "health": { "href": "http://localhost:8080/actuator/health" },
    "health-path": { "href": "http://localhost:8080/actuator/health/{*path}" }
  }
}
```

기본 설정에서는 HTTP로 `health` 하나만 열려 있다. Actuator 엔드포인트는 애플리케이션 내부 정보를 드러내기 때문에, Spring Boot는 **꼭 필요한 것만 열어 두는 방식**을 기본값으로 삼았다.

---

## 3. 필요한 엔드포인트 열기

다른 엔드포인트를 보려면 `management.endpoints.web.exposure.include`에 이름을 적는다.

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health, metrics
  endpoint:
    health:
      show-details: always
```

이 설정으로 `health`와 `metrics` 두 엔드포인트가 HTTP로 열린다. `show-details: always`는 health 결과에 세부 항목까지 보여 달라는 뜻이다(4장에서 확인한다). `metrics`는 2편에서 사용한다.

자주 쓰는 엔드포인트는 다음과 같다.

| 엔드포인트 | 보여 주는 것 |
| --- | --- |
| `health` | 애플리케이션이 정상인지(UP/DOWN) |
| `info` | 애플리케이션 이름·버전 같은 정보 |
| `metrics` | 수집된 메트릭 목록과 값 |
| `prometheus` | Prometheus가 읽을 수 있는 형식의 메트릭 |
| `env`, `beans`, `loggers` | 환경 설정값, 등록된 빈, 로그 레벨 등 |

> `include: "*"`로 모든 엔드포인트를 열 수도 있지만, `env`처럼 설정값이 드러나는 엔드포인트까지 열린다. 학습용 로컬 환경이 아니라면 필요한 것만 나열하는 편이 안전하다.

설정을 바꾼 뒤 다시 `/actuator`를 호출하면 목록에 `metrics`가 추가된 것을 볼 수 있다.

---

## 4. health로 상태 확인하기

`health`는 "이 애플리케이션에 요청을 보내도 되는가"를 알려 주는 엔드포인트다.

```bash
curl http://localhost:8080/actuator/health
```

```json
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": { "database": "MySQL", "validationQuery": "isValid()" }
    },
    "diskSpace": {
      "status": "UP",
      "details": { "total": 494384795648, "free": 120034877440, "threshold": 10485760, "exists": true }
    },
    "ping": { "status": "UP" }
  }
}
```

`show-details`를 설정하지 않았다면 `{"status":"UP"}`만 보인다. 세부 항목을 켰기 때문에 `components`가 함께 나온다.

### 4.1 HealthIndicator

`components` 아래 항목 하나하나를 **HealthIndicator**(상태 검사기)라고 부른다. Spring Boot는 사용 중인 기술을 보고 검사기를 자동으로 붙인다.

| 검사기 | 자동으로 붙는 조건 | 확인하는 것 |
| --- | --- | --- |
| `db` | `DataSource` 빈이 있을 때 | DB에 연결할 수 있는지 |
| `diskSpace` | 기본 | 남은 디스크 공간이 기준(`threshold`)보다 많은지 |
| `ping` | 기본 | 애플리케이션이 응답하는지(항상 UP) |

Redis를 쓰면 `redis`, 메일 서버를 쓰면 `mail` 검사기가 생기는 식이다. 따로 코드를 쓰지 않아도 연결된 외부 자원의 상태가 모인다.

### 4.2 전체 status와 HTTP 상태 코드

전체 `status`는 검사기 결과를 모아 정해진다. 하나라도 `DOWN`이면 전체도 `DOWN`이 되고, 이때 HTTP 상태 코드는 `200`에서 `503 Service Unavailable`로 바뀐다.

DB를 잠시 꺼 보면 직접 확인할 수 있다.

```bash
curl -i http://localhost:8080/actuator/health
```

```text
HTTP/1.1 503
Content-Type: application/vnd.spring-boot.actuator.v3+json

{"status":"DOWN","components":{"db":{"status":"DOWN", ...}, ...}}
```

로드 밸런서나 Kubernetes는 응답 본문을 해석하지 않고 **상태 코드만 보고** "이 서버로 요청을 보내지 말자"고 판단할 수 있다. health 엔드포인트가 상태 코드까지 바꿔 주는 이유가 여기에 있다.

### 4.3 Kubernetes의 liveness와 readiness

이 애플리케이션을 Kubernetes Pod로 배포하면, Spring Boot가 Kubernetes 환경임을 스스로 감지해 health 아래에 두 경로를 자동으로 만든다.

| 경로 | 질문 | 실패하면 |
| --- | --- | --- |
| `/actuator/health/liveness` | 애플리케이션이 살아 있는가 | 컨테이너를 재시작한다 |
| `/actuator/health/readiness` | 요청을 받을 준비가 됐는가 | 재시작하지 않고 Service 트래픽에서만 뺀다 |

각각 Pod의 liveness probe와 readiness probe에 연결해 쓴다. Kubernetes 밖에서도 `management.endpoint.health.probes.enabled: true`로 켤 수 있다.

---

## 5. 운영 환경에서의 주의점

- **노출 범위를 최소로 유지한다.** 이 글의 설정은 학습용이다. 실제 서비스에서는 외부에 필요한 엔드포인트만 열고, `show-details`도 `when-authorized`로 바꿔 인증된 사용자에게만 세부 정보를 보여 주는 것이 좋다. 세부 정보에는 사용 중인 DB 종류 같은 내부 구성이 드러나기 때문이다.
- **관리용 포트를 분리할 수 있다.** `management.server.port: 9090`처럼 설정하면 Actuator 엔드포인트가 서비스 포트(8080)와 다른 포트로 열린다. 외부에는 8080만 열고 9090은 내부 모니터링 시스템만 접근하게 하면, 엔드포인트가 인터넷에 노출될 위험이 줄어든다.

---

## 6. 정리

Actuator는 애플리케이션 상태를 `/actuator/*` 주소로 보여 주는 창구다. 의존성만 추가하면 켜지고, 기본으로는 `health`만 열려 있다. 다른 엔드포인트는 `management.endpoints.web.exposure.include`로 필요한 것만 하나씩 연다.

`health`는 DB·디스크 같은 구성 요소를 HealthIndicator로 검사해 UP/DOWN을 알려 준다. 하나라도 DOWN이면 HTTP 상태 코드가 503으로 바뀌므로, 로드 밸런서나 Kubernetes의 probe가 그대로 활용할 수 있다.

다음 글에서는 3장에서 열어 둔 `metrics` 엔드포인트와 Micrometer로 요청 수·응답 시간 같은 메트릭을 보고, 업무 메트릭을 직접 만들어 Prometheus 형식으로 내보낸다.
