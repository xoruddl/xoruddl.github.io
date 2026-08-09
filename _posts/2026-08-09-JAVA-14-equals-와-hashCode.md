---
layout: post
title: "JAVA (14) - equals() 와 hashCode()"
date: 2026-08-09 16:03:01 +0900
categories: ["JAVA"]
tags: ["자바"]
---

## 1. 개요

자바의 최상위 클래스인 `Object`는 모든 클래스가 기본적으로 상속받는 메서드들을 제공한다. 그중 `equals()`와 `hashCode()`는 객체의 동일성(Identity)과 동등성(Equality)을 비교할 때 핵심적인 역할을 담당한다. 두 메서드는 올바른 객체 비교 및 컬렉션 프레임워크(특히 해시 기반 컬렉션)의 정상 동작을 위해 규칙에 맞게 함께 재정의(Override)해야 한다.

## 2. 동일성(Identity)과 동등성(Equality)

두 메서드의 역할을 이해하려면 먼저 동일성과 동등성의 차이를 구분해야 한다.

* **동일성 (`==` 연산자):** 두 객체가 메모리상에서 실제로 같은 인스턴스(주소)를 참조하고 있는지 비교한다.
* **동등성 (`equals()` 메서드):** 두 객체의 메모리 주소가 다르더라도, 내부적으로 가지고 있는 논리적 데이터가 같은지 비교한다.

```java
String str1 = new String("Java");
String str2 = new String("Java");

System.out.println(str1 == str2);      // false (주소값이 다름)
System.out.println(str1.equals(str2)); // true (논리적 문자열 내용이 같음)

```

## 3. equals() 메서드

`Object` 클래스에 정의된 기본 `equals()` 메서드는 내부적으로 `==` 연산자를 사용하여 객체의 주소값을 비교한다. 따라서 클래스 설계 시 논리적 동등성을 판단하려면 `equals()` 메서드를 재정의해야 한다.

### equals() 재정의 시 지켜야 할 규약

1. **반사성 (Reflexivity):** `x.equals(x)`는 항상 `true`여야 한다.
2. **대칭성 (Symmetry):** `x.equals(y)`가 `true`이면 `y.equals(x)`도 `true`여야 한다.
3. **추이성 (Transitivity):** `x.equals(y)`가 `true`이고 `y.equals(z)`가 `true`이면 `x.equals(z)`도 `true`여야 한다.
4. **일관성 (Consistency):** 객체가 수정되지 않았다면 `x.equals(y)`를 몇 번 호출하든 항상 같은 결과를 반환해야 한다.
5. **null-비교:** `x.equals(null)`은 항상 `false`여야 한다.

## 4. hashCode() 메서드

`hashCode()` 메서드는 객체의 해시 코드(정수값)를 반환하는 메서드다. 해시 기반 컬렉션(`HashSet`, `HashMap`, `Hashtable` 등)에서 객체를 저장하고 검색할 때 위치를 결정하는 기준으로 사용된다.

### hashCode() 규약

* `equals()` 비교에 사용되는 정보가 변경되지 않았다면, 애플리케이션 실행 동안 `hashCode()`는 항상 같은 정수값을 반환해야 한다.
* **`equals(Object)`가 두 객체를 같다고 판단했다면(`true`), 두 객체의 `hashCode()` 값은 반드시 같아야 한다.**
* 두 객체의 `equals()`가 다를지라도 `hashCode()` 값이 반드시 다를 필요는 없다. 다만 서로 다른 정수값을 반환해야 해시 테이블의 성능이 향상된다.

## 5. equals()와 hashCode()를 함께 재정의해야 하는 이유

`equals()`만 재정의하고 `hashCode()`를 재정의하지 않으면, 해시 기반 컬렉션에서 논리적으로 같은 객체가 서로 다른 객체로 취급되는 문제가 발생한다.

해시 컬렉션은 객체를 찾을 때 먼저 `hashCode()`를 비교한 후, 동일한 해시 값을 가진 객체들에 한해 `equals()`를 수행한다. 따라서 `equals()`가 `true`여도 `hashCode()`가 다르면 아예 `equals()` 비교조차 이루어지지 않는다.

```java
class Person {
    private String name;

    public Person(String name) {
        this.name = name;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Person person = (Person) o;
        return Objects.equals(name, person.name);
    }

    // hashCode()를 재정의하지 않으면 HashSet 등에서 정상 동작하지 않음
    @Override
    public int hashCode() {
        return Objects.hash(name);
    }
}

```

## 6. 정리

`equals()`는 두 객체의 논리적 동등성을 판단하고, `hashCode()`는 객체를 빠르게 식별하기 위한 해시 정수값을 제공한다. 논리적으로 동등한 객체는 동일한 해시 코드를 가져야 하므로, `equals()`를 재정의할 때는 반드시 `hashCode()`도 함께 재정의해야 한다. 이를 지키지 않으면 `HashSet`이나 `HashMap` 같은 컬렉션에서 데이터 누락이나 중복 저장 문제가 발생할 수 있다.
