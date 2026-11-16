---
layout: post
title: "Spring Security (2) - 요청이 지나가는 필터 구조 이해하기"
date: 2026-11-16 09:52:31 +0900
categories: ["Spring", "Spring Security"]
tags: ["spring security", "servlet filter", "filterchainproxy", "securityfilterchain", "delegatingfilterproxy"]
---

Spring Security (1)에서는 의존성만 추가했는데도 `GET /api/health`가 `401`로 막히는 것을 확인했다. `HealthController`는 한 줄도 바뀌지 않았으니, 요청이 컨트롤러에 도착하기 전에 누군가 먼저 검사했다는 뜻이다.

이번 글에서는 그 검사가 어디에서 일어나는지 살펴본다. Spring Security의 설정 코드는 결국 "어떤 필터를 어떤 순서로 세울 것인가"를 정하는 일이라서, 이 구조를 먼저 알아 두면 3편 이후의 설정이 무엇을 바꾸는지 읽을 수 있다.

---

## 1. 서블릿 필터: 컨트롤러보다 먼저 요청을 받는 곳

Spring MVC 애플리케이션에서 HTTP 요청은 톰캣 같은 서블릿 컨테이너가 먼저 받는다. 컨테이너는 요청을 `DispatcherServlet`에 넘기고, `DispatcherServlet`이 경로에 맞는 컨트롤러 메서드를 찾아 호출한다.

**서블릿 필터(Filter)** 는 컨테이너와 서블릿 사이에 끼어드는 객체다. 요청이 서블릿에 도착하기 전에 먼저 실행되고, 여러 개를 줄 세워 **필터 체인(FilterChain)** 으로 만들 수 있다.

```
클라이언트 ──▶ 필터 1 ──▶ 필터 2 ──▶ ... ──▶ DispatcherServlet ──▶ 컨트롤러
```

필터 하나는 다음과 같은 모양이다.

```java
public class SampleFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        // 다음 단계로 넘기기 전에 할 일
        chain.doFilter(request, response); // 다음 필터(또는 서블릿)로 넘긴다
        // 다음 단계가 끝나고 돌아온 뒤에 할 일
    }
}
```

핵심은 `chain.doFilter(...)` 한 줄이다. 이 줄을 호출하면 요청이 다음 단계로 넘어가고, **호출하지 않으면 요청은 거기서 멈춘다.** 필터가 직접 응답을 쓰고 끝낼 수 있다는 뜻이다. 1편에서 `401`이 돌아온 것도 어떤 필터가 `DispatcherServlet`으로 넘기지 않고 응답을 끝냈기 때문이다.

필터 체인은 요청이 필터를 하나씩 "지나쳐 가는" 구조가 아니라 **안으로 겹겹이 들어가는** 구조다. `chain.doFilter(...)`는 뒤 단계 전체를 자기 안에서 호출하고, 뒤 단계가 모두 끝나야 돌아온다. 그래서 앞 필터가 이 호출을 `try-catch`로 감싸면 뒤에서 던진 예외를 받아 처리할 수 있다. 5장에서 이 성질이 다시 나온다.

---

## 2. Spring Security는 필터 하나로 들어온다

필터는 서블릿 컨테이너가 관리하는 객체이고, Spring의 빈은 Spring 컨테이너(`ApplicationContext`)가 관리하는 객체다. 서로 다른 세계에 있으므로 둘을 이어 줄 다리가 필요하다.

그 다리가 **`DelegatingFilterProxy`** 다. 서블릿 컨테이너에는 평범한 필터로 등록되지만, 요청이 오면 자신이 직접 일하지 않고 Spring 빈으로 등록된 필터에게 일을 넘긴다(delegate). 덕분에 보안 필터들은 Spring 빈으로 만들어져 다른 빈을 주입받을 수 있다.

`DelegatingFilterProxy`가 일을 넘기는 대상이 **`FilterChainProxy`** 다. Spring Security가 제공하는 특별한 필터로, Spring Security의 서블릿 지원이 시작되는 지점이다. 서블릿 컨테이너 입장에서 Spring Security는 이 필터 하나로 보인다.

```
서블릿 컨테이너의 필터 체인

  필터 A ──▶ DelegatingFilterProxy ──▶ 필터 B ──▶ DispatcherServlet
                    │
                    ▼ (Spring 빈에게 위임)
              FilterChainProxy
                    │
                    ▼ (요청에 맞는 체인 선택)
              SecurityFilterChain
               ├─ 보안 필터 1
               ├─ 보안 필터 2
               └─ ...
```

Spring Boot를 사용하면 `DelegatingFilterProxy` 등록까지 자동으로 처리되므로 직접 등록할 일은 없다. 이름과 역할만 알아 두면 된다.

---

## 3. `FilterChainProxy`와 `SecurityFilterChain`

`FilterChainProxy`는 실제 검사를 직접 하지 않는다. 대신 **`SecurityFilterChain`** 이라는 묶음을 하나 이상 가지고 있다가, 요청이 들어오면 그 요청에 맞는 묶음을 골라 그 안의 보안 필터들을 순서대로 실행한다.

`SecurityFilterChain`은 두 가지 정보를 담는다.

- 이 체인이 **어떤 요청을 맡는지** (예: `/api/**`로 시작하는 요청)
- 그 요청에 **어떤 보안 필터를 어떤 순서로** 적용하는지

체인이 여러 개일 때는 순서대로 비교해서 **처음으로 일치한 체인 하나만** 실행한다. 예를 들어 `/api/**`를 맡는 체인과 모든 요청을 맡는 체인이 있을 때, `/api/admin/devices` 요청은 두 조건에 모두 맞지만 앞에 있는 `/api/**` 체인만 실행된다.

| 구성 요소 | 한 줄 역할 |
| --- | --- |
| `DelegatingFilterProxy` | 서블릿 컨테이너와 Spring 빈을 잇는 다리 |
| `FilterChainProxy` | 요청에 맞는 `SecurityFilterChain`을 골라 실행하는 진입점 |
| `SecurityFilterChain` | "어떤 요청에 어떤 보안 필터를 적용할지"를 담은 묶음 |
| 보안 필터 | 인증, 인가, CSRF 방어 등 실제 검사를 하나씩 맡는 필터 |

`FilterChainProxy`는 체인을 고르는 일 외에도 공통 작업을 맡는다. 비정상적인 형태의 요청을 걸러내는 방화벽(`HttpFirewall`)을 적용하고, 요청 처리가 끝나면 그 요청의 인증 정보를 지워 다음 요청에 남지 않게 한다.

이 시리즈의 예제는 체인을 하나만 쓴다. 3편에서 작성할 설정 클래스가 바로 이 `SecurityFilterChain` 하나를 빈으로 등록하는 코드다.

---

## 4. 체인 안에는 어떤 필터가 있을까

1편의 기본 상태에서 어떤 필터가 실행되는지 직접 확인해 보자. Spring Security는 애플리케이션이 시작될 때 체인에 들어 있는 필터 목록을 DEBUG 수준 로그로 남긴다. `application.properties`에 로그 수준을 추가한다.

```properties
logging.level.org.springframework.security=DEBUG
```

애플리케이션을 다시 시작하면 다음과 비슷한 형태의 줄이 출력된다. `with filters:` 뒤에 쉼표로 나열된 것이 실행 순서대로 정렬된 보안 필터다. 아래는 실제 실행 결과가 아니라 Spring Security 7.1 소스의 로그 형식과 필터 순서를 바탕으로 재구성한 예시이며, 보기 좋게 줄을 나눴다.

```
o.s.s.web.DefaultSecurityFilterChain : Will secure any request with filters: DisableEncodeUrlFilter,
WebAsyncManagerIntegrationFilter, SecurityContextHolderFilter, HeaderWriterFilter, CsrfFilter,
LogoutFilter, UsernamePasswordAuthenticationFilter, DefaultResourcesFilter,
DefaultLoginPageGeneratingFilter, DefaultLogoutPageGeneratingFilter, BasicAuthenticationFilter,
RequestCacheAwareFilter, SecurityContextHolderAwareRequestFilter, AnonymousAuthenticationFilter,
ExceptionTranslationFilter, AuthorizationFilter
```

목록은 설정에 따라 달라지므로 전부 외울 필요는 없다. 이 시리즈에서 계속 등장하는 필터만 짚어 두면 충분하다.

| 필터 | 하는 일 |
| --- | --- |
| `SecurityContextHolderFilter` | 저장된 인증 정보가 있으면 불러온다 |
| `CsrfFilter` | CSRF 공격을 막는 토큰을 검사한다 |
| `LogoutFilter` | 로그아웃 요청을 처리한다 |
| `UsernamePasswordAuthenticationFilter` | 로그인 폼으로 제출한 아이디·비밀번호를 인증한다 |
| `BasicAuthenticationFilter` | HTTP Basic 헤더로 인증한다 (1편의 `curl -u`) |
| `AnonymousAuthenticationFilter` | 인증되지 않은 요청에 "익명 사용자" 표시를 붙인다 |
| `ExceptionTranslationFilter` | 인증·인가 실패를 HTTP 응답으로 바꾼다 |
| `AuthorizationFilter` | 이 요청을 허용할지 최종 판단한다 |

---

## 5. 순서가 의미하는 것

위 목록에서 읽어 낼 수 있는 흐름은 단순하다. **앞쪽 필터들이 "누구인지"를 알아내고, 맨 마지막 필터가 "해도 되는지"를 판단한다.**

1. 인증을 맡은 필터들(`UsernamePasswordAuthenticationFilter`, `BasicAuthenticationFilter` 등)이 요청에서 자격 증명을 찾아 확인한다. 확인되면 인증 정보를 남겨 둔다.
2. 아무도 인증하지 못했다면 `AnonymousAuthenticationFilter`가 익명 사용자로 표시한다.
3. 기본 구성에서 체인의 마지막에 있는 `AuthorizationFilter`가 남겨진 인증 정보를 보고 요청을 허용할지 판단한다. 거부하면 예외를 던진다.
4. 그 바로 앞의 `ExceptionTranslationFilter`가 그 예외를 받아 `401`이나 `403` 응답으로 바꾼다. 앞에 있는 필터가 뒤의 예외를 받을 수 있는 것은 1장에서 본 대로 `chain.doFilter(...)` 호출을 `try-catch`로 감싸 두었기 때문이다.

1편에서 `curl -i http://localhost:8080/api/health`가 `401`을 받은 과정에 대입해 보자. 요청에 자격 증명이 없으니 인증 필터들은 그냥 지나가고, 요청은 익명 상태로 `AuthorizationFilter`에 도착한다. 기본 규칙은 "모든 요청에 인증 필요"이므로 거부되고, `ExceptionTranslationFilter`가 이를 `401`로 바꾼다. `DispatcherServlet`과 `HealthController`는 호출되지 않는다.

`-u user:비밀번호`를 붙였을 때는 `BasicAuthenticationFilter`가 헤더의 계정을 확인해 인증 정보를 남기고, `AuthorizationFilter`가 통과시켜 요청이 컨트롤러까지 도달한다.

이 순서에서 기억할 점이 하나 더 있다. `AuthorizationFilter`가 마지막에 있으므로, 인가 판단은 **요청이 `DispatcherServlet`에 들어가기 전**에 끝난다. Spring MVC가 경로에 맞는 컨트롤러를 찾기도 전이다.

---

## 6. 정리

Spring Security는 서블릿 필터로 동작한다. 서블릿 컨테이너에는 `DelegatingFilterProxy` 하나가 등록되고, 이 필터가 Spring 빈인 `FilterChainProxy`에 일을 넘긴다. `FilterChainProxy`는 요청에 맞는 `SecurityFilterChain`을 처음 일치하는 것 하나만 골라, 그 안의 보안 필터들을 순서대로 실행한다.

체인 안에서는 인증을 맡은 필터들이 먼저 실행되어 "누구인지"를 확인하고, 마지막의 `AuthorizationFilter`가 "해도 되는지"를 판단한다. 실패는 `ExceptionTranslationFilter`가 HTTP 응답으로 바꾼다. 이 모든 일이 컨트롤러에 닿기 전에 끝나기 때문에 컨트롤러 코드를 고치지 않고도 요청을 막을 수 있다.

다음 글에서는 `SecurityFilterChain`을 직접 빈으로 등록해, 예제 서버의 경로별 규칙을 정하고 토큰 기반 API 서버에 필요 없는 기본 기능을 끈다.

---

참고:
- [Spring Security Reference - Servlet Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
- [Spring Security Reference - Authorize HttpServletRequests](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html)
