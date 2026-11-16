---
layout: post
title: "Spring Security (1) - Spring Security가 하는 일과 기본 동작"
date: 2026-11-16 09:51:49 +0900
categories: ["Spring", "Spring Security"]
tags: ["spring security", "spring-boot", "인증", "인가", "authentication", "authorization"]
---

Spring MVC로 API를 만들다 보면 "이 요청을 보낸 사람이 누구인지", "이 사람이 이 API를 호출해도 되는지"를 확인해야 하는 순간이 온다. 컨트롤러마다 토큰을 꺼내 검사하는 코드를 넣을 수도 있지만, API가 늘어날수록 빠뜨리는 곳이 생기고 규칙이 흩어진다.

Spring Security는 이 확인 작업을 컨트롤러 바깥, 요청이 들어오는 길목에서 한꺼번에 처리하게 해 주는 프레임워크다. 이 시리즈는 Spring Boot 4.x와 Spring Security 7.x를 기준으로, 토큰으로 인증하는 API 서버를 만들면서 Spring Security의 구조를 순서대로 정리한다. 첫 글에서는 인증과 인가라는 두 용어를 구분하고, 의존성만 추가했을 때 무슨 일이 일어나는지 확인한다.

---

## 1. 시리즈에서 만들 예제

시리즈 전체에서 같은 예제를 사용한다. 기기가 측정값을 올리고, 관리자가 기기 목록을 조회하는 작은 API 서버다.

| API | 호출하는 쪽 | 필요한 것 |
| --- | --- | --- |
| `GET /api/health` | 누구나 | 없음 |
| `GET /api/admin/devices` | 관리자 | 관리자 토큰 |
| `POST /api/devices/readings` | 기기 | 기기 토큰 |

관리자와 기기는 서로 다른 토큰을 `Authorization: Bearer <토큰>` 헤더에 담아 보낸다. 관리자 토큰으로는 기기 API를 호출할 수 없고, 기기 토큰으로는 관리자 API를 호출할 수 없어야 한다.

이번 글에서는 가장 단순한 `GET /api/health`만 만들어 두고 시작한다.

```java
@RestController
public class HealthController {

    @GetMapping("/api/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
```

애플리케이션을 실행하고 `curl -i http://localhost:8080/api/health`를 호출하면 `200`과 `{"status":"ok"}`가 돌아온다. 아직 아무 보호도 없는 상태다.

---

## 2. 인증과 인가는 다른 질문이다

보안 설정을 읽을 때 가장 먼저 구분해야 하는 두 단어다.

- **인증(Authentication)**: 요청을 보낸 쪽이 **누구인지** 확인하는 일이다. 비밀번호나 토큰처럼 본인임을 증명하는 값을 검사한다.
- **인가(Authorization)**: 확인된 그 사용자가 **이 작업을 해도 되는지** 판단하는 일이다. 역할이나 권한을 보고 허용 여부를 결정한다.

회사 건물에 비유하면 출입증을 찍어 직원임을 확인하는 것이 인증이고, 그 직원이 서버실에 들어갈 수 있는지 따지는 것이 인가다. 출입증이 진짜여도 서버실 권한이 없으면 문은 열리지 않는다.

두 단계는 실패했을 때의 HTTP 응답도 다르다.

| 구분 | 확인하는 것 | 예제에서의 상황 | 실패 시 상태 코드 |
| --- | --- | --- | --- |
| 인증 | 누구인가 | 토큰이 없거나 틀렸다 | `401 Unauthorized` |
| 인가 | 해도 되는가 | 기기 토큰으로 관리자 API를 호출했다 | `403 Forbidden` |

`401`은 "누구인지 모르겠으니 증명하라"는 뜻이고, `403`은 "누구인지는 알지만 허용하지 않는다"는 뜻이다.

---

## 3. 의존성 추가하기

Spring Boot 프로젝트에서는 스타터 하나로 Spring Security를 추가한다. 버전은 Spring Boot가 관리하므로 적지 않는다.

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-webmvc'
    implementation 'org.springframework.boot:spring-boot-starter-security'
}
```

Maven을 사용한다면 다음과 같다.

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
```

Spring Boot 4에서는 Spring MVC 스타터의 이름이 `spring-boot-starter-webmvc`다. 예전 이름인 `spring-boot-starter-web`은 더 이상 권장되지 않는 이름으로 남아 있다.

---

## 4. 의존성만 추가하면 벌어지는 일

설정 코드를 한 줄도 쓰지 않고 애플리케이션을 다시 실행한 뒤, 1장에서 성공했던 요청을 그대로 보내 본다.

```bash
curl -i http://localhost:8080/api/health
```

```
HTTP/1.1 401
...
```

방금 전까지 열려 있던 API가 `401`을 돌려준다. Spring Security가 클래스패스에 있으면 Spring Boot는 웹 애플리케이션을 **기본적으로 보호된 상태**로 만든다. 허용할 것을 직접 열어 주기 전까지는 전부 닫아 두는 방식이다.

시작 로그를 보면 다음과 같은 줄이 있다.

```
Using generated security password: 8e557245-73e2-4286-969a-ff57fe326336
```

Spring Boot가 이름이 `user`인 기본 사용자를 메모리에 하나 만들고, 무작위 비밀번호를 생성해 로그에 남긴 것이다. 비밀번호는 실행할 때마다 바뀐다. 이 사용자로 인증하면 요청이 통과한다.

```bash
curl -i -u user:8e557245-73e2-4286-969a-ff57fe326336 http://localhost:8080/api/health
```

`-u`는 HTTP Basic 방식으로 사용자 이름과 비밀번호를 보내는 옵션이다. 이번에는 `200`과 `{"status":"ok"}`가 돌아온다. 브라우저로 같은 주소를 열면 `401` 대신 로그인 페이지로 이동하고, 그 화면에 같은 계정을 입력해도 된다.

---

## 5. 기본 동작 정리

설정 없이 적용된 내용을 정리하면 다음과 같다.

| 기본 동작 | 설명 |
| --- | --- |
| 모든 요청에 인증 요구 | 컨트롤러 경로뿐 아니라 Spring Boot의 `/error` 경로도 포함된다 |
| 기본 사용자 등록 | 이름은 `user`, 비밀번호는 시작할 때 생성해 로그에 출력한다 |
| 폼 로그인과 HTTP Basic | 브라우저 요청은 로그인 페이지로 보내고, 그 외 요청에는 `401`을 응답한다 |
| CSRF 방어 | 공격 방어 기능이 켜져 있다 |
| 보안 응답 헤더 | `X-Content-Type-Options`, `X-Frame-Options`, 캐시 제어 헤더 등을 응답에 추가한다 |

여기서 눈여겨볼 점은 두 가지다.

첫째, 컨트롤러 코드는 한 줄도 바뀌지 않았다. `HealthController`는 인증에 대해 아무것도 모르는데 요청이 막혔다. 요청이 컨트롤러에 도착하기 **전에** 누군가 가로채서 검사했다는 뜻이다. 그 "누군가"가 **서블릿 필터**다.

둘째, 이 기본값은 사람이 브라우저로 로그인하는 웹 애플리케이션에 맞춰져 있다.

> 기본 사용자와 생성된 비밀번호는 동작을 확인하기 위한 출발점이다. 실제 서비스에서는 이 계정에 의존하지 않고, 서비스에 맞는 인증 방식을 직접 구성한다.

---

## 6. 정리

인증은 "누구인가"를, 인가는 "해도 되는가"를 확인하는 서로 다른 단계이고, 실패했을 때의 응답도 `401`과 `403`으로 나뉜다. Spring Security는 이 두 단계를 컨트롤러 바깥에서 처리한다.

`spring-boot-starter-security`를 추가하는 것만으로 모든 요청이 인증을 요구하게 되고, `user`라는 기본 사용자와 로그인 방식이 함께 구성된다. 닫아 두고 필요한 것만 여는 방식이 기본값이라는 점을 기억해 두면 이후 설정을 읽기 쉽다.

다음 글에서는 컨트롤러를 건드리지 않고도 요청을 막을 수 있었던 이유, 즉 요청이 컨트롤러에 닿기 전에 지나가는 필터 구조를 살펴본다.

---

참고:
- [Spring Security Reference - Hello Spring Security](https://docs.spring.io/spring-security/reference/servlet/getting-started.html)
- [Spring Security Reference - Getting Spring Security](https://docs.spring.io/spring-security/reference/getting-spring-security.html)
- [Spring Boot Reference - Spring Security](https://docs.spring.io/spring-boot/reference/web/spring-security.html)
- [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
