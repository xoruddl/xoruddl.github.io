---
layout: post
title: "JAVA (6) - Wrapper 클래스와 오토박싱"
date: 2026-08-09 12:11:06 +0900
categories: ["JAVA"]
tags: ["자바"]
---

## 1. 개요

Java에는 `int`, `double`, `boolean`과 같은 기본 타입(Primitive Type)이 존재한다. 기본 타입은 성능상 이점이 있지만, 객체가 아니기 때문에 컬렉션 프레임워크(`ArrayList` 등)에 저장할 수 없고 `null`을 다룰 수도 없다는 한계가 있다.

이러한 기본 타입을 객체로 포장하여 다룰 수 있도록 제공되는 클래스가 바로 Wrapper 클래스(포장 클래스)다.

---

## 2. Wrapper 클래스의 종류

Java의 모든 기본 타입에 1:1로 대응되는 Wrapper 클래스가 존재한다. `java.lang` 패키지에 포함되어 있어 별도의 `import` 없이 바로 사용할 수 있다.

| 기본 타입 (Primitive) | Wrapper 클래스 |
| --- | --- |
| `byte` | `Byte` |
| `short` | `Short` |
| `int` | **`Integer`** |
| `long` | `Long` |
| `float` | `Float` |
| `double` | `Double` |
| `char` | **`Character`** |
| `boolean` | `Boolean` |

---

## 3. 박싱(Boxing)과 언박싱(Unboxing)

* **박싱(Boxing):** 기본 타입의 값을 Wrapper 클래스의 객체로 변환하는 과정이다.
* **언박싱(Unboxing):** Wrapper 클래스 객체에서 기본 타입의 값을 꺼내는 과정이다.

```java
// 박싱 (Primitive -> Wrapper)
Integer numObj = Integer.valueOf(100); 

// 언박싱 (Wrapper -> Primitive)
int num = numObj.intValue(); 

```

> **참고:** `new Integer(100)`과 같은 명시적 생성자 호출 방식은 Java 9 이후로 Deprecated 되었으므로 `valueOf()` 메서드를 사용하는 것이 권장된다.

---

## 4. 오토 박싱(Auto-boxing)과 오토 언박싱(Auto-unboxing)

Java 5부터는 컴파일러가 박싱과 언박싱 과정을 자동으로 처리해주는 **오토 박싱 / 오토 언박싱** 기능이 도입되었다.

```java
// 오토 박싱: int 값이 Integer 객체로 자동 변환된다.
Integer numObj = 100; // Integer.valueOf(100) 형태로 자동 처리

// 오토 언박싱: Integer 객체가 int 기본 타입으로 자동 변환된다.
int num = numObj;     // numObj.intValue() 형태로 자동 처리

// 연산 시에도 자동 언박싱이 진행된다.
int result = numObj + 50; // 150

```

---

## 5. Wrapper 클래스를 사용하는 이유

### 5.1 컬렉션 프레임워크 활용

`ArrayList`, `HashMap` 등 Java의 컬렉션은 객체 참조만 저장할 수 있다. 따라서 기본 타입 데이터를 담으려면 Wrapper 클래스를 사용해야 한다.

```java
// List<int> list = new ArrayList<>(); // 컴파일 에러 발생!
List<Integer> list = new ArrayList<>();
list.add(10); // 오토 박싱으로 Integer 객체가 저장된다.

```

### 5.2 `null` 값 처리

기본 타입에는 `null`을 대입할 수 없지만, Wrapper 클래스는 참조 타입이므로 `null`을 통해 "값이 없음" 상태를 표현할 수 있다. (예: DB 조회 결과 처리 등)

### 5.3 유용한 메서드 제공

Wrapper 클래스는 데이터 타입 변환이나 상한/하한값 조회 등의 정적(static) 메서드를 다수 제공한다.

```java
// 문자열을 정수로 변환 (자주 사용)
int parsedNum = Integer.parseInt("123");

// 타입의 최솟값/최댓값 확인
int min = Integer.MIN_VALUE;
int max = Integer.MAX_VALUE;

```

---

## 6. 주의사항: `NullPointerException`과 성능 문제

### 6.1 `NullPointerException` (NPE) 위험

오토 언박싱이 일어날 때 Wrapper 객체가 `null`이면 예외가 발생한다.

```java
Integer number = null;
int primitiveNum = number; // NullPointerException 발생!

```

### 6.2 성능 overhead

오토 박싱은 편리하지만 내부적으로 객체를 계속 생성하는 비용이 든다. 반복문 안에서 수백만 번의 오토 박싱이 일어나면 연산 속도가 크게 떨어질 수 있으므로, 대량의 단순 수치 계산 시에는 기본 타입을 사용하는 것이 바람직하다.

---

## 7. 정리

1. Wrapper 클래스는 기본 타입 데이터를 객체 형태로 다루기 위해 사용하는 클래스다.
2. Java 5부터 제공되는 오토 박싱/언박싱 덕분에 기본 타입과 Wrapper 클래스 간의 변환을 명시적 코드 없이 자연스럽게 처리할 수 있다.
3. 컬렉션 활용이나 `null` 처리가 필요한 상황에서는 Wrapper 클래스를 사용하되, 반복 연산에서의 성능 이슈와 NPE 제어에 주의해야 한다.
