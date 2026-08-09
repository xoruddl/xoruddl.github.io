---
layout: post
title: "Spring (5) - Building an Application with Spring Boot"
date: 2026-08-07 10:57:48 +0900
categories: ["Spring"]
tags: ["Spring"]
---

https://spring.io/guides/gs/spring-boot

## [Spring Boot] 빠르게 웹 애플리케이션 시작하기: 자동 설정부터 Actuator까지

Spring Boot는 개발자가 오직 비즈니스 로직 구현에만 집중할 수 있는 환경을 제공한다. 

Spring Boot가 제공하는 핵심 기능과 웹 애플리케이션 구축 과정을 정리한다.

---

## 1. Spring Boot는 어떻게 작동할까?

Spring Boot의 핵심은 자동 설정(Auto-configuration)이다. 클래스패스(Classpath)에 존재하는 모듈과 기존에 설정된 빈(Bean)을 감지하여, 애플리케이션에 필요한 요소를 동적으로 판단하고 알아서 구성해 준다.

* **웹 환경 자동 구성**: 클래스패스에 `spring-boot-starter-webmvc`가 존재하면 필요한 핵심 빈들을 자동으로 추가하고 내장 서블릿 컨테이너인 Tomcat을 설정한다.
* **서블릿 컨테이너 교체**: Tomcat 대신 Jetty가 클래스패스에 올라와 있다면, 별도의 복잡한 설정 없이 Jetty를 기반으로 구동한다.
* **유연한 주도권 보장**: Spring Boot가 제공하는 자동 설정 빈이 있더라도, 개발자가 직접 해당 빈을 정의하면 자동 설정을 덮어쓰고 수동 설정을 우선 적용한다.

> Spring Boot는 소스 코드를 직접 생성하거나 파일을 수정하지 않는다. 애플리케이션 실행 시점에 동적으로 빈과 설정을 연결하여 ApplicationContext에 등록한다.

---

## 2. 애플리케이션 클래스 작성 및 실행

`Spring Web` 의존성을 추가한 뒤 애플리케이션 메인 클래스를 다음과 같이 작성한다.

```java
package com.example.springboot;

import java.util.Arrays;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @Bean
    public CommandLineRunner commandLineRunner(ApplicationContext ctx) {
        return args -> {
            System.out.println("Let's inspect the beans provided by Spring Boot:");
            String[] beanNames = ctx.getBeanDefinitionNames();
            Arrays.sort(beanNames);
            for (String beanName : beanNames) {
                System.out.println(beanName);
            }
        };
    }
}

```

### `@SpringBootApplication` 어노테이션의 역할

* **`@Configuration`**: 해당 클래스를 빈 정의의 출처로 지정한다.

Spring 컨테이너(ApplicationContext)에게 "이 클래스 안에 `@Bean` 어노테이션이 붙은 메서드들이 있으니, 실행할 때 생성해서 스프링 빈으로 관리해라" 라고 알려준다.

또한, `@Bean` 메서드를 여러 번 호출하더라도 매번 새로운 객체를 만들지 않고 싱글톤(Singleton)을 보장하도록 동작한다

* **`@EnableAutoConfiguration`**: 설정된 의존성 기반으로 자동 설정을 활성화한다.
* **`@ComponentScan`**: 해당 패키지 하위의 `@Controller`, `@Service` 등의 컴포넌트를 탐색하여 스캔한다.


XML 설정 파일이나 `web.xml` 없이 Pure Java 코드만으로 웹 애플리케이션 구동 준비가 완료된다.

* **`@Bean`**: `commandLineRunner` 메서드가 반환하는 객체를 스프링 컨테이너가 관리하는 **스프링 빈으로 등록**한다.
* **`CommandLineRunner`**: Spring Boot가 제공하는 특수 인터페이스로, **애플리케이션이 완전히 구동 완료된 직후 실행할 코드**를 작성할 때 사용한다. (람다식 `args -> { ... }` 형태로 구현됨)
* **`ApplicationContext ctx`**: 스프링 컨테이너 자신을 주입받아 등록된 빈 정보를 조회한다.
* **`ctx.getBeanDefinitionNames()`**: 자동 설정 및 사용자가 직접 정의하여 컨테이너에 등록된 **모든 빈의 이름을 배열로 반환**한다.
* **`Arrays.sort(beanNames)`**: 알파벳순으로 정렬한다.


---

## 3. 단위 테스트 작성하기

Spring Boot는 테스트를 위한 스타터 모듈(`spring-boot-starter-webmvc-test`)을 제공한다. 이를 통해 HTTP 요청 주기를 모킹(Mock)하거나 풀스택 통합 테스트를 쉽게 작성할 수 있다.

```java
@SpringBootTest
@AutoConfigureMockMvc
public class HelloControllerTest {

    @Autowired
    private MockMvc mvc;

    @Test
    public void getHello() throws Exception {
        mvc.perform(get("/").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().string(equalTo("Greetings from Spring Boot!")));
    }
}

```

* **`@SpringBootTest`**: 전체 ApplicationContext를 생성하여 실제 환경과 유사하게 테스트한다.
* **`MockMvc`**: 실제 서버를 띄우지 않고도 `DispatcherServlet`에 요청을 보내고 응답을 검증할 수 있게 지원한다.

1. **`mvc.perform(get("/").accept(MediaType.APPLICATION_JSON))`**
* **요청 전송**: 루트 경로(`/`)로 HTTP **GET** 요청을 보낸다.
* **Header 설정**: 클라이언트가 `APPLICATION_JSON` 형태의 응답을 수용한다는 `Accept` 헤더를 설정한다.


2. **`.andExpect(status().isOk())`**
* **상태 코드 검증**: 서버의 응답 HTTP 상태 코드가 **200 OK**인지 검증한다.


3. **`.andExpect(content().string(equalTo("Greetings from Spring Boot!")))`**
* **본문 검증**: 응답 바디(Body)의 문자열 데이터가 `"Greetings from Spring Boot!"`와 정확히 일치하는지 확인한다.

---

## 4. 운영 환경을 위한 Actuator 서비스 추가

실무 모니터링에 필수적인 헬스 체크, 메트릭 수집 등의 기능은 Actuator 모듈(`spring-boot-starter-actuator`)을 추가하여 해결한다.

Actuator를 추가하면 모니터링용 엔드포인트가 노출된다.

* `/actuator/health`: 애플리케이션 구동 상태 확인 (`{"status": "UP"}`)
* `/actuator`: 접근 가능한 엔드포인트 목록 조회

보안상 `/actuator/shutdown`과 같은 민감한 엔드포인트는 기본적으로 비활성화되어 있으며, 필요 시 `application.properties` 설정을 통해 선택적으로 노출시킬 수 있다.

---

## 요약

`Spring Boot`는 내장 서버, 자동 설정, 스타터 의존성, 모니터링 도구(Actuator)를 일관된 방식으로 제공한다. 

덕분에 초기 환경 구성 시간을 크게 단축하고 애플리케이션의 핵심 로직 개발에 집중할 수 있다.
