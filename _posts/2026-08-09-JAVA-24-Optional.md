---
layout: post
title: "JAVA (24) - Optional"
date: 2026-08-09 21:11:52 +0900
categories: ["JAVA"]
tags: ["자바"]
---

## 1. 개요

자바 프로그래밍에서 가장 흔하게 발생하는 예외 중 하나는 `NullPointerException` (NPE)이다. NPE를 방지하기 위해 과거에는 코드 곳곳에 `if (obj != null)`과 같은 조건문을 가득 채워 넣어야 했고, 이는 코드의 가독성을 크게 떨어뜨렸다. Java 8에서는 이러한 문제를 해결하고 null 처리를 보다 안전하고 간결하게 다루기 위해 `java.util.Optional<T>` 클래스를 도입했다. 

## 2. Optional이란?

`Optional<T>`은 null이 될 수도 있는 객체를 감싸는 단일 값 래퍼(Wrapper) 클래스다. 객체가 null이더라도 직접 참조하는 대신 Optional이라는 상자에 담아 다룸으로써 `NullPointerException` 발생 가능성을 대폭 줄여준다.

* **NPE 방지**: 객체에 직접 접근하기 전 값이 존재하는지 명시적으로 확인하거나 대체값을 지정하도록 유도한다.
* **코드 가독성 향상**: 메서드의 반환 타입으로 Optional을 사용하면, 호출하는 쪽에 "이 메서드는 null을 반환할 수 있다"는 의도를 명확하게 전달한다.

## 3. Optional 객체 생성 방법

Optional 객체는 주로 다음 3가지 정적 팩토리 메서드를 사용하여 생성한다.

1. **`Optional.empty()`**: 빈 Optional 객체를 생성한다.
```java
Optional<User> emptyOpt = Optional.empty();

```


2. **`Optional.of(value)`**: null이 아닌 객체를 담은 Optional 객체를 생성한다. 만약 `value`가 null이면 즉시 `NullPointerException`이 발생한다.
```java
Optional<User> userOpt = Optional.of(user);

```


3. **`Optional.ofNullable(value)`**: null일 가능성이 있는 객체를 담은 Optional 객체를 생성한다. `value`가 null이면 빈 Optional 객체를 반환한다.
```java
Optional<User> nullableOpt = Optional.ofNullable(user);

```



## 4. Optional 값 꺼내기 및 활용 메서드

Optional 내부에 저장된 값에 접근하거나, 값이 없을 때의 동작을 정의하기 위해 다양한 메서드를 제공한다.

* **`orElse(T other)`**: 값이 존재하면 그 값을 반환하고, 없으면 기본값(`other`)을 반환한다. (값이 있어도 `other` 생성 인스턴스는 평가됨)
* **`orElseGet(Supplier<? extends T> supplier)`**: 값이 존재하면 그 값을 반환하고, 없으면 `Supplier`를 실행하여 결과를 반환한다. (값이 없을 때만 로직이 수행되어 성능상 유리)
* **`orElseThrow(Supplier<? extends X> exceptionSupplier)`**: 값이 존재하면 반환하고, 없으면 지정한 예외를 던진다.
* **`ifPresent(Consumer<? super T> action)`**: 값이 존재할 때만 전달된 람다식을 실행한다.
* **`map()` / `flatMap()` / `filter()**`: 스트림과 유사하게 Optional 내부 값을 변환하거나 조건에 맞는지 필터링한다.

```java
// 예시: 값이 없으면 기본 객체를 생성하거나 예외를 던짐
User user = userOpt.orElseGet(() -> new User("Guest"));
User validUser = userOpt.orElseThrow(() -> new IllegalArgumentException("유저가 존재하지 않습니다."));

```

## 예시 1: 조건문 중첩(NPE 체이닝) 해결하기

사용자 객체에서 주소 정보를 거쳐 도시(City) 이름을 가져오는 상황이다. 중간에 하나라도 null이 있으면 바로 `NullPointerException`이 발생하기 때문에 기존 방식에서는 복잡한 if 문 중첩이 필요했다.

### 기존 방식 (Null 체크 조건문 중첩)

```java
public String getCityOfUser(User user) {
    if (user != null) {
        Address address = user.getAddress();
        if (address != null) {
            String city = address.getCity();
            if (city != null) {
                return city;
            }
        }
    }
    return "Unknown"; // 중간에 하나라도 null이면 기본값 반환
}

```

### Optional 적용

`map()`과 `orElse()`를 체이닝하여 안전하게 들여쓰기 없이 단 한 줄로 처리할 수 있다.

```java
public String getCityOfUser(User user) {
    return Optional.ofNullable(user)
            .map(User::getAddress)
            .map(Address::getCity)
            .orElse("Unknown"); // 값이 없거나 중간에 null이 있으면 "Unknown" 반환
}

```

---

## 예시 2: 데이터가 없을 때 기본값 처리 (`orElse` vs `orElseGet`)

DB에서 회원 정보를 조회할 때 검색 결과가 없으면 기본 회원을 반환하거나 새로 생성해야 하는 상황이다.

### 기존 방식

```java
User user = userRepository.findByName("Hong");
if (user == null) {
    user = new User("Guest"); // null일 때만 기본값 생성
}

```

### Optional 적용

`orElseGet()`을 사용하면 **값이 존재하지 않을 때만** 람다식이 실행되어 효율적으로 기본 객체를 생성할 수 있다.

```java
// findByName이 Optional<User>를 반환한다고 가정
User user = userRepository.findByName("Hong")
        .orElseGet(() -> new User("Guest")); // Hong이 없을 때만 Guest 객체 생성

```

---

## 예시 3: 데이터가 없을 때 예외 던지기 (`orElseThrow`)

회원 조회를 시도했을 때 사용자가 존재하지 않으면 즉시 에러를 발생시켜 비즈니스 로직을 중단해야 하는 케이스다.

### 기존 방식

```java
User user = userRepository.findById(userId);
if (user == null) {
    throw new IllegalArgumentException("존재하지 않는 회원입니다. id: " + userId);
}

```

### Optional 적용

Optional의 `orElseThrow()`를 사용하면 의도가 명확하게 드러나는 한 줄의 코드로 작성할 수 있다.

```java
User user = userRepository.findById(userId)
        .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 회원입니다. id: " + userId));

```


## 5. Optional 사용 시 주의사항 (Best Practices)

Optional은 오용할 경우 오히려 코드가 복잡해지거나 성능이 저하될 수 있으므로 주의해서 사용해야 한다.

* **반환 타입으로만 사용**: Optional은 주로 메서드의 반환 타입으로 사용하도록 설계되었다. 필드(Field) 타입, 메서드 매개변수(Parameter), 컬렉션의 요소로 사용하는 것은 권장되지 않는다.
* **`get()` 직접 호출 자제**: 값이 없는 상태에서 `get()`을 호출하면 `NoSuchElementException`이 발생하므로 `orElseGet()`이나 `orElseThrow()`를 사용하는 것이 안전하다.
* **컬렉션이나 배열은 Optional로 감싸지 않기**: `List`, `Set`, `Map` 등은 그 자체로 비어있는 상태(Empty Collection)를 표현할 수 있으므로 Optional을 사용하지 않고 빈 컬렉션을 반환하는 것이 올바른 방식이다.

## 6. 정리

Java의 Optional은 null 다루기를 안전하게 만들고 `NullPointerException`을 효과적으로 예방하는 유용한 도구다. 단순한 조건문 중첩을 줄이고 메서드 반환 값에 대한 명시적인 의도를 표현할 수 있게 도와준다. 하지만 모든 곳에 남용하기보다는 주로 메서드의 반환 타입으로 제한하고, `orElseGet`이나 `orElseThrow` 등 적절한 대체 메서드와 함께 활용하는 것이 바람직하다.
