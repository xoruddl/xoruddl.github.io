---
layout: post
title: "Spring (*) - Spring mvc"
date: 2026-08-05 22:39:31 +0900
categories: ["Spring"]
---

**Spring MVC**는 Spring 프레임워크에서 제공하는 **웹 애플리케이션 개발용 서블릿 기반 MVC(Model-View-Controller) 프레임워크**이다.

웹 요청을 받아 적절히 처리하고, 그 결과를 클라이언트(브라우저, 앱 등)에게 응답으로 돌려주는 전체적인 웹 서버 구조를 만들어준다.

---

### 1. MVC 패턴이란?

애플리케이션의 역할을 크게 3가지로 나눈 소프트웨어 디자인 패턴이다.

* **Model (모델)**: 애플리케이션의 데이터 및 비즈니스 로직을 담당한다. (예: DB에서 조회해 온 회원 정보, Service/Repository 계층)
* **View (뷰)**: 사용자에게 보여줄 화면(UI)을 담당한다. (예: HTML, Thymeleaf, JSP 등)
* **Controller (컨트롤러)**: 사용자의 요청(Request)을 받아 Model을 호출하여 데이터를 처리하고, 처리된 결과를 어떤 View에 전달할지 결정한다.

---

### 2. Spring MVC의 핵심 동작 흐름

클라이언트가 URL을 통해 요청을 보냈을 때 Spring MVC 내부에서는 다음과 같은 과정이 일어난다.

```text
[Client] ──(HTTP 요청)──> [DispatcherServlet]
                                │
                                ├── (1) 요청을 처리할 Controller 찾기 (HandlerMapping)
                                ├── (2) Controller 메서드 실행 (HandlerAdapter)
                                └── (3) 응답 처리
                                         ├─ HTML 반환 시: ViewResolver를 통해 HTML 렌더링
                                         └─ REST API 시: HttpMessageConverter(Jackson)를 통해 JSON 반환

```

1. **`DispatcherServlet` (중앙 창구/프론트 컨트롤러)**
* 클라이언트의 모든 HTTP 요청을 가장 먼저 받아 처리하는 Spring MVC의 핵심 엔진이다.


2. **Controller (컨트롤러)**
* 우리가 직접 작성하는 코드 부분(`@Controller` 또는 `@RestController`)이다. 요청을 받아 필요한 로직을 수행한다.


3. **ViewResolver / MessageConverter**
* **`@Controller` 사용 시**: ViewResolver가 HTML 템플릿 파일 경로를 찾아 화면을 렌더링한다.
* **`@RestController` 사용 시**: HttpMessageConverter가 작동하여 데이터를 JSON 형태 문자열로 직렬화하여 반환한다.



---

### 3. 왜 Spring MVC를 사용하는가?

* **역할 분리**: 화면 코드(View)와 서버 로직(Model/Controller)이 분리되어 유지보수가 쉽다.
* **어노테이션 기반의 간편함**: `@Controller`, `@GetMapping`, `@RequestParam` 등 직관적인 어노테이션으로 매핑 및 데이터 파싱 작업을 수월하게 처리할 수 있다.
* **Spring 생태계와의 완전한 통합**: Spring Security(보안), Spring Data JPA(DB 연동) 등 다른 Spring 모듈들과 아무런 설정 마찰 없이 매끄럽게 연결된다.

---

### 요약

Spring MVC는 웹 요청을 받아 적절한 로직을 수행한 뒤, HTML 화면이나 JSON 데이터를 클라이언트에 응답하도록 도와주는 Spring의 표준 웹 개발 프레임워크다.
