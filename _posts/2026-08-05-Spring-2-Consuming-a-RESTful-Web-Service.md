---
layout: post
title: "Spring (2) - Consuming a RESTful Web Service"
date: 2026-08-05 12:12:41 +0900
categories: ["Spring"]
tags: ["Spring"]
---

https://spring.io/guides/gs/consuming-rest

---


스프링 프레임워크 6.1 및 스프링 부트 3.2부터 기존의 `RestTemplate`을 대체할 수 있는 동기식 HTTP 클라이언트인 `RestClient`가 도입되었다. Fluent API 스타일을 지원하여 코드의 가독성을 높이고, JSON 응답 데이터를 자바 객체로 쉽게 매핑해 준다.

이번 글에서는 외부 REST API에서 응답을 받아 처리하는 클라이언트 애플리케이션을 구현하는 과정을 정리한다.

---

## 1. REST 리소스 규격 및 JSON 데이터 형태

호출할 REST API는 스프링 부트에 관한 무작위 인용구를 반환하는 엔드포인트(`/api/random`)이다. 해당 API에 요청을 보내면 아래와 같은 구조의 JSON 응답을 받아온다.

```json
{
  "type": "success",
  "value": {
    "id": 10,
    "quote": "Really loving Spring Boot, makes stand alone Spring apps easy."
  }
}

```

---

## 2. 응답 매핑을 위한 도메인 모델(Record) 정의

JSON 응답 데이터를 자바 객체로 바인딩하기 위해 도메인 클래스를 작성한다. Java 14 이상에서 제공하는 `record`를 활용하면 불필요한 보일러플레이트 코드를 줄일 수 있다.

이때 Jackson 라이브러리의 `@JsonIgnoreProperties(ignoreUnknown = true)` 어노테이션을 부착하여, DTO에 정의되지 않은 JSON 키값이 들어오더라도 예외가 발생하지 않도록 설정한다.

### `Quote.java` (루트 응답 객체)

> **주의:** 내부 필드의 `Value` 타입 참조 시 `org.springframework.beans.factory.annotation.Value` 어노테이션이 `import`되지 않도록 주의해야 한다.

```java
package com.example.consumingrest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Quote(String type, Value value) { }

```

### `Value.java` (내부 인용구 객체)

```java
package com.example.consumingrest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Value(Long id, String quote) { }

```

---

## 3. RestClient 구성 및 호출 코드 작성

스프링 부트 구동 시점에 REST API를 호출하도록 `ApplicationRunner` 빈을 등록한다. Auto-configuration된 `RestClient.Builder`를 주입받아 베이스 URL을 설정하고, HTTP GET 요청을 보낸다.

```java
package com.example.consumingrest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.web.client.RestClient;

@SpringBootApplication
public class ConsumingRestApplication {

  private static final Logger log = LoggerFactory.getLogger(ConsumingRestApplication.class);

  public static void main(String[] args) {
    SpringApplication.run(ConsumingRestApplication.class, args);
  }

  @Bean
  @Profile("!test")
  public ApplicationRunner run(RestClient.Builder builder) {
    // 1. RestClient 빌드
    RestClient restClient = builder.baseUrl("http://localhost:8080").build();

    // 2. 애플리케이션 시작 직후 REST API 호출
    return args -> {
      Quote quote = restClient
          .get()
          .uri("/api/random")
          .retrieve()
          .body(Quote.class);

      log.info(quote.toString());
    };
  }
}

```

---

## 4. 실행 및 결과 확인

백엔드 API 서버가 8080 포트에서 동작 중인 상태에서 애플리케이션을 구동한다. 클라이언트 애플리케이션과 포트가 충돌하지 않도록 `application.properties`에 `server.port=8081`과 같이 포트를 분리해 주는 것이 좋다.

정상적으로 API 수신 및 바인딩이 완료되면 콘솔 터미널에 다음과 같은 INFO 로그가 출력된다.

```text
2026-08-05T12:00:00.000+09:00  INFO 76846 --- [main] c.e.c.ConsumingRestApplication : Quote{type='success', value=Value{id=1, quote='Working with Spring Boot is like pair-programming with the Spring developers.'}}

```

---

## 요약 및 정리

* `RestClient`는 `RestTemplate`보다 현대적이고 유연한 Fluent API 방식을 제공한다.
* `@JsonIgnoreProperties(ignoreUnknown = true)`를 활용하면 매핑되지 않은 JSON 스키마 변동에 안전하게 대응할 수 있다.
* 외부 REST API 호출 테스트 시에는 대상 백엔드 서버의 동작 유무 및 서버 포트 충돌 여부를 먼저 점검해야 한다.
