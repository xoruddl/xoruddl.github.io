---
layout: post
title: "토비의 스프링부트 정리 (6) - @Configuration과 proxyBeanMethods의 동작 원리"
date: 2026-09-22 08:18:10 +0900
categories: ["Spring", "토비의 스프링부트 - 이해와 원리"]
tags: ["spring", "spring-boot", "configuration", "proxy"]
---

## 1. 개요

앞 글에서 만든 `@MyAutoConfiguration`에는 `@Configuration(proxyBeanMethods = false)`가 들어 있다. `false` 하나가 무엇을 바꾸는지 알려면, `@Bean` 메서드가 일반 자바 메서드와 다르게 동작하는 이유부터 살펴봐야 한다.

`@Configuration`의 기본값은 같은 구성 클래스 안에서 다른 `@Bean` 메서드를 직접 호출해도 컨테이너가 관리하는 같은 빈을 돌려주는 것이다. 이 글에서는 그 동작을 테스트로 확인하고, 프록시가 필요 없는 자동 구성에서 `proxyBeanMethods = false`를 사용할 수 있는 조건을 정리한다.

---

## 2. `@Bean` 메서드 직접 호출의 문제

다음 구성 클래스에서 `bean1()`과 `bean2()`는 모두 `common()`을 직접 호출한다.

```java
@Configuration
class MyConfig {

    @Bean
    Common common() {
        return new Common();
    }

    @Bean
    Bean1 bean1() {
        return new Bean1(common());
    }

    @Bean
    Bean2 bean2() {
        return new Bean2(common());
    }
}
```

일반 자바 객체라면 `common()`이 호출될 때마다 `new Common()`이 실행된다. 그러면 `Bean1`과 `Bean2`는 서로 다른 `Common` 객체를 받는다. 하지만 스프링 컨테이너에 `MyConfig`를 등록하면 두 빈은 같은 `Common` 빈을 참조한다.

```java
@Test
void configurationClassReusesTheCommonBean() {
    AnnotationConfigApplicationContext context =
            new AnnotationConfigApplicationContext(MyConfig.class);

    Bean1 bean1 = context.getBean(Bean1.class);
    Bean2 bean2 = context.getBean(Bean2.class);

    assertThat(bean1.common).isSameAs(bean2.common);
}
```

`@Configuration`의 기본 설정은 이처럼 `@Bean` 메서드 사이의 직접 호출을 컨테이너가 가로채도록 처리한다. 따라서 자바 코드로 의존 관계를 표현하면서도 싱글톤 스코프의 빈을 일관되게 참조할 수 있다.

---

## 3. 구성 클래스 프록시는 무엇을 하는가

스프링은 기본 설정의 구성 클래스를 그대로 사용하지 않고, CGLIB 기반의 하위 프록시 클래스를 만들어 `@Bean` 메서드 호출을 제어한다. 개념적으로는 다음과 같은 동작이다.

```java
class MyConfigProxy extends MyConfig {

    private Common common;

    @Override
    Common common() {
        if (common == null) {
            common = super.common();
        }
        return common;
    }
}
```

실제 스프링 프록시의 구현은 더 복잡하지만, 핵심은 같다. `bean1()` 안에서 `common()`을 호출해도 새 객체를 만들지 않고 컨테이너가 관리하는 `Common` 빈을 반환한다. 이 동작 덕분에 같은 구성 클래스의 빈 메서드를 서로 호출하는 방식이 안전해진다.

---

## 4. `proxyBeanMethods = false`와 라이트 모드

다른 `@Bean` 메서드를 직접 호출하지 않는 구성 클래스라면, 구성 클래스 프록시가 필요하지 않다. 이때 `proxyBeanMethods = false`를 지정하면 `@Bean` 메서드는 일반 팩토리 메서드처럼 동작한다.

```java
@Configuration(proxyBeanMethods = false)
class MyAutoConfiguration {

    @Bean
    TomcatServletWebServerFactory servletWebServerFactory() {
        return new TomcatServletWebServerFactory();
    }

    @Bean
    DispatcherServlet dispatcherServlet() {
        return new DispatcherServlet();
    }
}
```

이 설정에서 `servletWebServerFactory()`와 `dispatcherServlet()`은 서로를 호출하지 않는다. 따라서 CGLIB 프록시를 만들 필요가 없고, 스프링은 이 구성 클래스를 라이트 모드로 처리할 수 있다.

| 구분 | 기본값: `true` | `false` |
| --- | --- | --- |
| 구성 클래스 처리 | 프록시를 만들어 `@Bean` 호출을 제어 | 일반 구성 클래스처럼 처리 |
| 다른 `@Bean` 메서드 직접 호출 | 컨테이너 빈을 재사용할 수 있다 | 일반 메서드 호출이므로 새 객체가 만들어질 수 있다 |
| 적합한 경우 | 빈 메서드끼리 직접 의존 관계를 만든다 | 각 빈을 독립적으로 만들거나 메서드 인자로 주입한다 |

---

## 5. 라이트 모드에서는 메서드 인자로 주입하기

프록시를 사용하지 않으면서 빈 사이의 의존 관계를 표현하려면, 다른 `@Bean` 메서드를 호출하지 말고 필요한 빈을 메서드 인자로 받는다.

```java
@Configuration(proxyBeanMethods = false)
class MyConfig {

    @Bean
    Common common() {
        return new Common();
    }

    @Bean
    Bean1 bean1(Common common) {
        return new Bean1(common);
    }

    @Bean
    Bean2 bean2(Common common) {
        return new Bean2(common);
    }
}
```

스프링은 `bean1(Common common)`과 `bean2(Common common)`을 호출할 때 컨테이너에서 `Common` 빈을 찾아 인자로 전달한다. `@Bean` 메서드가 서로를 직접 호출하지 않으므로 프록시가 없어도 두 빈은 같은 `Common` 인스턴스를 받는다.

자동 구성 클래스는 독립적인 인프라 빈을 선언하는 경우가 많다. 그래서 `@MyAutoConfiguration`에 `@Configuration(proxyBeanMethods = false)`를 넣어 프록시 생성 비용을 피하면서도, 필요할 때는 메서드 인자 주입으로 의존 관계를 표현할 수 있다.

---

## 6. 정리

기본 `@Configuration`은 구성 클래스를 프록시로 처리해 `@Bean` 메서드의 직접 호출도 컨테이너의 빈 생명주기를 따르도록 만든다. 이 방식은 자바 구성 코드에서 빈 사이 관계를 자연스럽게 표현하게 해 준다.

`proxyBeanMethods = false`는 이 프록시 처리를 끈다. 다른 `@Bean` 메서드를 호출하지 않는 자동 구성에는 적합하지만, 직접 호출로 의존 관계를 만들면 매번 새 객체가 생길 수 있다. 프록시를 끈 구성에서는 메서드 매개변수로 필요한 빈을 주입받는 방식을 사용한다.

---

## 참고 자료

- 토비의 스프링 부트 - 이해와 원리: 06 자동 구성 기반 애플리케이션
- [TobySpringBoot-1: `@Configuration`과 `proxyBeanMethods`](https://github.com/xoruddl/TobySpringBoot-1/commit/0962d679307f63e4c873a8c5523ef3d433415480)
- [Spring Framework: `@Bean`과 `@Configuration` 기본 개념](https://docs.spring.io/spring-framework/reference/core/beans/java/basic-concepts.html)
