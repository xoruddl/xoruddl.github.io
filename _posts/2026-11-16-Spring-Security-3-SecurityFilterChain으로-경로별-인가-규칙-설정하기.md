---
layout: post
title: "Spring Security (3) - SecurityFilterChain으로 경로별 인가 규칙 설정하기"
date: 2026-11-16 09:53:17 +0900
categories: ["Spring", "Spring Security"]
tags: ["spring security", "securityfilterchain", "authorizehttprequests", "csrf", "stateless", "인가"]
---

Spring Security (2)에서는 `FilterChainProxy`가 요청에 맞는 `SecurityFilterChain`을 골라 그 안의 보안 필터를 순서대로 실행한다는 구조를 살펴봤다. 지금까지는 Spring Boot가 만들어 준 기본 체인을 그대로 썼다.

이번 글에서는 `SecurityFilterChain`을 직접 빈으로 등록한다. 예제 서버의 경로마다 누가 접근할 수 있는지 규칙을 정하고, 토큰으로 인증하는 API 서버에는 맞지 않는 기본 기능(세션, CSRF 방어, 폼 로그인)을 끈다.

---

## 1. 준비: 보호할 컨트롤러 두 개

1편에서 정한 예제의 나머지 API를 만든다. 관리자가 기기 목록을 조회하는 API와 기기가 측정값을 올리는 API다.

```java
@RestController
public class AdminDeviceController {

    @GetMapping("/api/admin/devices")
    public List<String> devices() {
        return List.of("device-1", "device-2");
    }
}
```

```java
@RestController
public class DeviceReadingController {

    public record ReadingRequest(String sensor, double value) {
    }

    @PostMapping("/api/devices/readings")
    public Map<String, Boolean> upload(@RequestBody ReadingRequest request) {
        return Map.of("accepted", true);
    }
}
```

두 컨트롤러에는 인증이나 권한에 관한 코드가 없다. 누가 호출할 수 있는지는 전부 보안 설정에서 정한다.

---

## 2. `SecurityFilterChain` 빈 등록하기

보안 설정은 `SecurityFilterChain` 타입의 빈을 등록하는 방식으로 작성한다. `HttpSecurity`는 체인을 조립하는 빌더이고, 마지막에 `build()`를 호출하면 `SecurityFilterChain`이 만들어진다.

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain apiSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers("/api/health").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/devices/**").hasRole("DEVICE")
                .anyRequest().denyAll()
            )
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .formLogin(form -> form.disable())
            .httpBasic(basic -> basic.disable())
            .logout(logout -> logout.disable());

        return http.build();
    }
}
```

`SecurityFilterChain` 빈을 직접 등록하면 Spring Boot는 1편에서 본 기본 웹 보안 구성을 더 이상 적용하지 않는다. 이제 이 체인 하나가 서버의 보안 규칙 전부다.

각 설정은 `csrf(csrf -> ...)`처럼 람다를 받는 형태로 쓴다. 오래된 자료에서 보이는 `WebSecurityConfigurerAdapter` 상속 방식이나 `.and()`로 이어 쓰는 방식, `authorizeRequests`는 Spring Security 7에 없다.

아래에서 이 설정을 두 부분으로 나눠 읽는다. 앞부분은 경로별 인가 규칙이고, 뒷부분은 기본 기능을 끄는 설정이다.

---

## 3. 경로별 인가 규칙 읽기

`authorizeHttpRequests`는 "어떤 요청에 → 어떤 조건을 요구할지"를 짝지어 나열한다. 이 규칙들은 2편에서 본 체인의 마지막 필터, `AuthorizationFilter`가 사용한다.

```java
.authorizeHttpRequests(authorize -> authorize
    .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
    .requestMatchers("/api/health").permitAll()
    .requestMatchers("/api/admin/**").hasRole("ADMIN")
    .requestMatchers("/api/devices/**").hasRole("DEVICE")
    .anyRequest().denyAll()
)
```

| 규칙 | 뜻 |
| --- | --- |
| `permitAll()` | 누구나 허용한다. 인증 정보를 확인하지 않는다 |
| `hasRole("ADMIN")` | `ADMIN` 역할을 가진 사용자만 허용한다 |
| `authenticated()` | 인증만 되어 있으면 허용한다 (예제에서는 쓰지 않는다) |
| `denyAll()` | 누구도 허용하지 않는다 |

`requestMatchers("/api/admin/**")`의 `**`는 하위 경로 전체를 뜻한다. `/api/admin/devices`도, 나중에 추가될 `/api/admin/users/1`도 이 규칙에 걸린다. 오래된 자료에서는 `new AntPathRequestMatcher(...)`를 넘기는 코드도 보이는데, Spring Security 7에서는 이 클래스가 제거되고 `PathPatternRequestMatcher`로 대체됐다. 문자열로 경로를 넘기면 내부에서 알맞은 매처를 만들어 주므로 예제처럼 문자열을 쓰면 된다.

`hasRole("ADMIN")`에서 한 가지 알아 둘 점이 있다. Spring Security는 역할 이름 앞에 `ROLE_`을 붙여 비교한다. 즉 `hasRole("ADMIN")`은 사용자가 `ROLE_ADMIN`이라는 권한을 가졌는지 확인한다. 5편에서 토큰을 검증한 뒤 사용자에게 권한을 줄 때 `ROLE_ADMIN`, `ROLE_DEVICE`라는 이름을 쓰는 이유가 이것이다.

### 규칙은 위에서부터, 처음 일치한 것 하나만

규칙은 적힌 순서대로 검사되고, **처음 일치한 규칙 하나만** 적용된다. 그래서 순서가 결과를 바꾼다. 다음처럼 쓰면 의도와 다르게 동작한다.

```java
// 잘못된 순서: 첫 줄이 모든 요청과 일치하므로 아래 규칙은 영영 검사되지 않는다
.anyRequest().denyAll()
.requestMatchers("/api/health").permitAll()
```

좁은 범위의 규칙을 위에, 넓은 범위의 규칙을 아래에 두고, `anyRequest()`는 항상 맨 마지막에 둔다.

### 마지막 줄을 `denyAll()`로 두는 이유

마지막 규칙은 위의 어떤 규칙에도 걸리지 않은 나머지 요청을 처리한다. 여기를 `denyAll()`로 두면 규칙 목록이 **허용 목록**이 된다. 명시적으로 연 경로만 열리고 나머지는 전부 닫힌다.

새 API를 추가하면서 규칙을 빠뜨렸을 때의 결과가 달라진다. 마지막 줄이 `permitAll()`이었다면 그 API는 아무 보호 없이 열려 버리지만, `denyAll()`이면 호출이 거부되어 개발 중에 바로 알아챌 수 있다. 안전한 쪽으로 실패하는 설정이다.

### 첫 줄의 `DispatcherType.ERROR`는 무엇인가

Spring Boot는 처리 중 오류가 나면 요청을 내부적으로 `/error` 경로로 한 번 더 보내(이를 `ERROR` 디스패치라고 한다) 오류 응답을 만든다. Spring Security는 이 내부 전달에도 인가 규칙을 적용한다. 첫 줄이 없으면 `/error`는 마지막의 `denyAll()`에 걸리고, 클라이언트는 원래 받아야 할 `404`나 `500` 대신 보안 오류 응답을 받을 수 있다.

첫 줄은 이 내부 전달을 통과시키는 규칙이다. 지금은 "오류 응답이 제대로 나가게 하는 줄" 정도로 이해하고 넘어가도 된다. 8편에서 실제 사례와 함께 다시 본다.

---

## 4. 토큰 기반 API 서버에서 끄는 기능

설정의 뒷부분은 기능을 끄는 코드다. 이 기능들이 나쁜 것은 아니다. 사람이 브라우저로 로그인하는 서비스를 위한 것이라 우리 예제와 맞지 않을 뿐이다. 하나씩 이유를 본다.

### 세션: `SessionCreationPolicy.STATELESS`

**세션**은 서버가 사용자별로 유지하는 저장 공간이다. 서버는 세션마다 번호를 매겨 그 번호를 쿠키로 브라우저에 주고, 브라우저는 이후 그 사이트로 보내는 모든 요청에 이 쿠키를 자동으로 붙인다. 브라우저 로그인 방식에서는 로그인에 성공하면 서버가 인증 정보를 세션에 저장해 두고, 쿠키에 담긴 번호로 "아까 로그인한 사람"임을 알아본다.

우리 예제의 클라이언트는 요청마다 `Authorization` 헤더에 인증 토큰(Bearer 토큰)을 담아 보낸다. 요청 하나하나가 스스로를 증명하므로 서버가 이전 요청을 기억할 필요가 없다. `STATELESS`로 설정하면 Spring Security는 인증 정보를 세션에 저장하지 않고, 세션을 만들지도 않는다.

### CSRF 방어: `csrf.disable()`

**CSRF**는 사용자가 로그인해 둔 브라우저를 악성 사이트가 이용해, 사용자 모르게 요청을 보내게 만드는 공격이다. 이 공격이 통하는 이유는 브라우저가 해당 사이트의 **쿠키를 요청에 자동으로 붙여 주기** 때문이다.

Spring Security는 기본적으로 `POST` 같은 변경 요청에 **CSRF 토큰**을 요구한다. CSRF 토큰은 인증 토큰과 다른 것으로, 서버가 만들어 자기 페이지에만 심어 두는 예측할 수 없는 값이다. 쿠키와 달리 브라우저가 자동으로 보내지 않으므로, 요청에 이 값이 들어 있으면 악성 사이트가 아니라 서버가 내려준 페이지에서 보낸 요청으로 볼 수 있다.

그런데 우리 예제에는 브라우저가 자동으로 붙여 주는 자격 증명이 없다. 인증 토큰(Bearer 토큰)은 클라이언트 코드가 `Authorization` 헤더에 직접 넣어야만 전송된다. 공식 문서도 브라우저가 아닌 클라이언트만 사용하는 서비스라면 CSRF 방어를 끄는 것을 고려할 수 있다고 안내한다.

끄지 않으면 `POST /api/devices/readings`는 올바른 기기 토큰을 보내도 CSRF 토큰이 없다는 이유로 `403`이 된다.

> 조건을 정확히 기억해야 한다. "API 서버라서" 끄는 것이 아니라 "브라우저가 자동으로 보내는 자격 증명에 의존하지 않아서" 끄는 것이다. 같은 API 서버라도 인증 토큰을 쿠키에 담아 브라우저에서 사용한다면 CSRF 방어가 다시 필요하다.

### 폼 로그인, HTTP Basic, 로그아웃

`formLogin`은 로그인 페이지와 아이디·비밀번호 인증을, `httpBasic`은 1편에서 `curl -u`로 사용한 HTTP Basic 인증을, `logout`은 세션을 정리하는 로그아웃 처리를 담당한다. 로그인 화면도 세션도 없는 서버에서는 쓸 일이 없다.

사실 `SecurityFilterChain`을 직접 만들 때 `formLogin`과 `httpBasic`은 호출하지 않으면 추가되지 않는다. 그럼에도 `disable()`을 적어 둔 것은 "이 서버는 이 인증 방식을 쓰지 않는다"는 의도를 설정에 드러내기 위해서다. `csrf`와 `logout`은 호출하지 않아도 기본으로 켜져 있으므로 끄려면 반드시 `disable()`이 필요하다.

| 기능 | 원래 용도 | 예제에서 끄는 이유 |
| --- | --- | --- |
| 세션 | 로그인 상태를 서버에 기억 | 요청마다 토큰으로 증명한다 |
| CSRF 방어 | 쿠키 자동 전송을 악용한 공격 차단 | 자동으로 전송되는 자격 증명이 없다 |
| 폼 로그인 | 로그인 페이지로 인증 | 사람이 로그인하는 화면이 없다 |
| HTTP Basic | 아이디·비밀번호 헤더로 인증 | Bearer 토큰만 사용한다 |
| 로그아웃 | 세션 종료 | 종료할 세션이 없다 |

---

## 5. 지금 상태 확인하기

애플리케이션을 다시 실행하고 세 경로를 호출해 본다.

```bash
curl -i http://localhost:8080/api/health          # 200
curl -i http://localhost:8080/api/admin/devices   # 403
curl -i http://localhost:8080/unknown             # 403
```

`/api/health`는 `permitAll()` 규칙에 따라 인증 없이 `200`을 돌려준다. `/api/admin/devices`는 `ADMIN` 역할이 필요하고, 존재하지 않는 `/unknown`은 `denyAll()`에 걸려 둘 다 거부된다.

두 가지가 아직 미완성이다.

- 올바른 토큰을 보내도 관리자 API는 열리지 않는다. 요청의 토큰을 확인해 "이 요청은 관리자다"라고 알려 주는 필터가 아직 없기 때문이다. 5편에서 만든다.
- 인증하지 않은 요청인데 `401`이 아니라 `403`이 나온다. 1편에서 정리한 기준과 다르다. 폼 로그인과 HTTP Basic을 껐더니 "인증을 요구하는 방법"이 남지 않아 생긴 현상이며, 6편에서 바로잡는다.

시작 로그에 `Using generated security password`가 여전히 보일 수 있다. `SecurityFilterChain` 빈을 등록해도 기본 사용자를 만드는 구성은 꺼지지 않기 때문이다. 이 체인에는 그 계정으로 로그인할 방법이 없으므로 동작에는 영향이 없다.

---

## 6. 정리

`SecurityFilterChain` 빈을 등록하면 Spring Boot의 기본 보안 구성 대신 직접 정한 규칙이 적용된다. `authorizeHttpRequests`의 규칙은 위에서부터 검사되어 처음 일치한 하나만 적용되므로 좁은 규칙을 위에 두고, 마지막은 `denyAll()`로 닫아 허용 목록으로 만든다.

토큰 기반 API 서버에서는 요청마다 토큰으로 인증하므로 세션을 쓰지 않고, 브라우저가 자동으로 보내는 자격 증명이 없으므로 CSRF 방어를 끄며, 로그인 화면이 없으므로 폼 로그인과 HTTP Basic을 쓰지 않는다. 각각 끄는 이유가 다르다는 점을 알아 두면, 조건이 달라졌을 때 무엇을 다시 켜야 하는지 판단할 수 있다.

다음 글에서는 규칙이 참조하는 "역할"이 어디에 담겨 있는지, 즉 Spring Security가 인증된 사용자 정보를 보관하는 구조를 살펴본다.

---

참고:
- [Spring Security Reference - Authorize HttpServletRequests](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html)
- [Spring Security Reference - Authentication Persistence and Session Management](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html)
- [Spring Security Reference - Cross Site Request Forgery (CSRF) for Servlet](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)
- [Spring Security Reference - CSRF: When to use CSRF protection](https://docs.spring.io/spring-security/reference/features/exploits/csrf.html)
- [Spring Security Reference - What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- [Spring Boot Reference - Spring Security](https://docs.spring.io/spring-boot/reference/web/spring-security.html)
