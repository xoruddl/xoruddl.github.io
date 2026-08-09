---
layout: post
title: "Spring (1) - Building a RESTful Web Service"
date: 2026-08-04 23:39:11 +0900
categories: ["Spring"]
tags: ["Spring"]
---

https://spring.io/guides/gs/rest-service


## [Spring Boot] RESTful 웹 서비스 구축하기 (Spring REST API)

Spring Boot를 활용하면 복잡한 설정 없이 몇 분 만에 간단한 RESTful Web Service를 개발할 수 있다. 

Spring 공식 가이드를 바탕으로 HTTP GET 요청을 받아 JSON 형태로 응답하는 웹 서비스를 구축해본다.

---

## 1. 구현할 서비스 요구사항

우리가 만들 서비스는 간단한 인사말 API.

* **요청 URL**: `http://localhost:8080/greeting`
* **기본 응답 (JSON)**:
```json
{
  "id": 1,
  "content": "Hello, World!"
}

```


* **파라미터 전달 시 (`?name=User`)**:
```json
{
  "id": 2,
  "content": "Hello, User!"
}

```



---

## 2. 프로젝트 환경 설정

[Spring Initializr](https://start.spring.io) 사이트에서 프로젝트를 아래와 같이 생성한다.

* **Project**: Gradle 또는 Maven
* **Language**: Java (또는 Kotlin)
* **Java Version**: 17 이상
* **Dependencies**: **Spring Web**

다운로드한 ZIP 파일의 압축을 풀고 선호하는 IDE(IntelliJ IDEA, Eclipse, VS Code 등)로 프로젝트를 열어준다.

---

## 3. 리소스 표현 클래스(Record) 작성

JSON 응답 데이터의 구조를 정의한다. Java 14 이상에서 지원하는 **Record**를 사용하면 필드, 게터(Getter), 생성자를 깔끔하게 정의할 수 있다.

`src/main/java/com/example/restservice/Greeting.java`

```java
package com.example.restservice;

public record Greeting(long id, String content) { }

```

- record를 안쓰게 될 경우, 아래처럼 코드가 길어짐
```java
public class Greeting {
    private final long id;
    private final String content;

    public Greeting(long id, String content) {
        this.id = id;
        this.content = content;
    }

    public long getId() { return id; }
    public String getContent() { return content; }

    @Override
    public boolean equals(Object o) { ... }

    @Override
    public int hashCode() { ... }

    @Override
    public String toString() { ... }
}
```

---
### Record가 자동으로 생성해 주는 것들
record 키워드를 사용해 헤더(컴포넌트 목록)를 정의하면, 컴파일러가 알아서 다음 요소들을 자동 생성한다.

- **private final 필드**: 헤더에 선언된 매개변수들은 모두 private final 필드로 지정된다.

- **전체 매개변수 생성자 (Canonical Constructor)**: 모든 필드를 초기화하는 생성자가 자동으로 만들어진다.

- **Getter 메서드**: 필드 이름과 동일한 이름의 Getter 메서드가 제공된다. (getId()가 아니라 id(), content() 형태이다.)

- **equals() & hashCode()**: 모든 필드의 값을 비교하도록 자동 구현된다.

- **toString()**: 클래스명과 모든 필드명을 포함한 문자열(Greeting[id=1, content=Hello])을 반환하도록 자동 구현된다.

---

## 4. 리소스 컨트롤러 (Controller) 구현

HTTP GET 요청을 받아 JSON 응답을 만드는 컨트롤러를 작성한다.

`src/main/java/com/example/restservice/GreetingController.java`

```java
package com.example.restservice;

import java.util.concurrent.atomic.AtomicLong;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GreetingController {

    private static final String template = "Hello, %s!";
    private final AtomicLong counter = new AtomicLong();

    @GetMapping("/greeting")
    public Greeting greeting(@RequestParam(defaultValue = "World") String name) {
        return new Greeting(counter.incrementAndGet(), String.format(template, name));
    }
}

```

### 핵심 키워드 정리

* **`@RestController`**: 해당 클래스가 뷰(View)를 반환하는 일반 MVC 컨트롤러가 아니라, 객체 데이터 자체를 HTTP 응답 본문(JSON)으로 반환하는 REST 컨트롤러임을 선언한다. (`@Controller` + `@ResponseBody` 조합)
* **`@GetMapping("/greeting")`**: `/greeting` 주소로 들어오는 HTTP GET 요청을 해당 메서드에 연결한다.
* **`@RequestParam`**: 쿼리 스트링의 `name` 값을 메서드 매개변수에 바인딩합니다. 요청 값이 없을 경우 기본값(`defaultValue`)인 `"World"`가 들어간다.
* **Jackson 라이브러리**: Spring Web 모듈에 포함된 Jackson이 `Greeting` 객체를 자동으로 JSON으로 변환해 주므로 별도의 직렬화 코드가 필요하지 않다.

---

## 5. 애플리케이션 실행 클래스

[Spring Initializr](https://start.spring.io)로 생성한 경우 아래 메인 클래스가 자동으로 작성되어 있다.

`src/main/java/com/example/restservice/Application.java`

```java
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {

	public static void main(String[] args) {
		SpringApplication.run(Application.class, args);
	}

}

```



- **`@SpringBootApplication`**은 개발자가 일일이 XML 설정이나 자바 설정 코드를 작성하지 않아도 
1) 컴포넌트 자동 탐색 및 빈 등록(@ComponentScan), 
2) 의존성에 맞춘 프레임워크 자동 구성(@EnableAutoConfiguration), 
3) 설정을 위한 기본 틀 제공(@Configuration)을 한 번에 처리해 주는 Spring Boot의 핵심 출발점이다.

---

## 6. 빌드 및 테스트

터미널에서 아래 명령어로 서비스를 바로 실행할 수 있다.

* **Gradle**: `./gradlew bootRun`
* **Maven**: `./mvnw spring-boot:run`

### 동작 확인

브라우저나 Postman에서 아래 URL에 접속해 본다.

1. **`http://localhost:8080/greeting` 접속**
* 응답: `{"id":1,"content":"Hello, World!"}`


2. **`http://localhost:8080/greeting?name=TaeKyung` 접속**
* 응답: `{"id":2,"content":"Hello, TaeKyung!"}`



`id` 값이 1에서 2로 증가하는 것을 통해 동일한 `GreetingController` 인스턴스가 요청을 처리하며 내부 상태를 유지하는 것도 확인할 수 있다.

---

## 마치며

Spring Boot를 활용하면 XML 설정 파일이나 `web.xml` 없이 **100% Java 코드**만으로 손쉽게 RESTful API를 구축할 수 있다.
