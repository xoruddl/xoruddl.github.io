---
layout: post
title: "JAVA (25) - Thread 와 Runnable"
date: 2026-08-09 21:20:12 +0900
categories: ["JAVA"]
tags: ["자바"]
---

## 1. 개요

자바(Java) 애플리케이션은 기본적으로 하나의 메인 스레드(Main Thread)에서 코드를 순차적으로 실행한다. 하지만 네트워크 통신, 파일 입출력, 복잡한 연산 등 시간이 오래 걸리는 작업을 처리할 때는 작업이 끝날 때까지 프로그램 전체가 대기하는 현상이 발생한다.

이러한 문제를 해결하고 프로그램의 처리 효율을 높이기 위해 **다중 스레드(Multi-Thread)** 환경을 사용한다. 자바에서 스레드를 생성하고 관리하는 가장 대표적인 방법은 `Thread` 클래스를 상속받는 방식과 `Runnable` 인터페이스를 구현하는 방식 두 가지가 있다.

---

## 2. Thread 클래스를 상속받는 방법

자바에서 제공하는 `java.lang.Thread` 클래스를 직접 상속(extends)받아 스레드를 구현할 수 있다.

```java
class MyThread extends Thread {
    @Override
    public void run() {
        // 스레드가 수행할 작업 작성
        System.out.println("Thread 상속 방식 실행 중: " + Thread.currentThread().getName());
    }
}

public class Main {
    public static void main(String[] args) {
        MyThread thread = new MyThread();
        thread.start(); // 새로운 스레드 생성 및 run() 실행
    }
}

```

* `Thread` 클래스를 상속받은 뒤 `run()` 메서드를 재정의(Override)하여 스레드가 실행할 로직을 작성한다.
* 실행 시에는 `run()`을 직접 호출하지 않고 `start()` 메서드를 호출한다. `start()`는 새로운 스레드를 위한 호출 스택(Call Stack)을 생성한 뒤 `run()`을 실행시킨다.

---

## 3. Runnable 인터페이스를 구현하는 방법

`java.lang.Runnable` 인터페이스를 구현(implements)하여 스레드 작업 로직을 정의할 수 있다.

```java
class MyRunnable implements Runnable {
    @Override
    public void run() {
        // 스레드가 수행할 작업 작성
        System.out.println("Runnable 구현 방식 실행 중: " + Thread.currentThread().getName());
    }
}

public class Main {
    public static void main(String[] args) {
        MyRunnable runnable = new MyRunnable();
        Thread thread = new Thread(runnable); // Runnable 객체를 Thread 생성자에 전달
        thread.start();
    }
}

```

* `Runnable` 인터페이스는 `run()` 추상 메서드 하나만 가지는 함수형 인터페이스다.
* 구현체 자체는 스레드가 아니므로, 작업 로직을 담은 `Runnable` 인스턴스를 `Thread` 객체의 생성자 매개변수로 전달한 뒤 `start()`를 호출해야 한다.
* 람다식(Lambda Expression)이나 익명 객체를 활용해 간결하게 작성할 수도 있다.

```java
Thread thread = new Thread(() -> {
    System.out.println("람다 표현식을 활용한 Runnable 실행");
});
thread.start();

```

---

## 4. Thread 상속 vs Runnable 구현 비교

두 방식 모두 멀티스레딩을 구현하는 목적은 동일하지만, 설계 측면에서 명확한 차이가 존재한다.

| 비교 항목 | Thread 상속 | Runnable 구현 |
| --- | --- | --- |
| **자바 상속 제약** | 단일 상속만 지원되므로 다른 클래스를 상속받을 수 없음 | 인터페이스 구현이므로 다른 클래스 상속 가능 |
| **코드 재사용성** | 스레드 클래스와 작업 로직이 결합됨 | 작업 로직과 스레드 객체가 분리되어 재사용성이 높음 |
| **유연성** | 낮은 유연성 | 객체 지향적 설계 및 람다식 활용에 유용 |

자바는 클래스의 단일 상속만 허용하므로 `Thread` 클래스를 상속받으면 다른 클래스를 상속받을 수 없게 된다. 반면 `Runnable` 인터페이스를 구현하면 필요한 다른 클래스를 자유롭게 상속받으면서도 스레드 기능을 사용할 수 있다.

또한 `Runnable` 방식은 수행할 작업(Task)과 작업을 실행하는 주체(Thread)를 분리하는 객체 지향적 구조를 가지므로 `ExecutorService`와 같은 스레드 풀(Thread Pool) 기술과 연동하기도 훨씬 용이하다.

---

## 5. 정리

* 자바에서 멀티스레드를 구현하는 방법은 `Thread` 클래스 상속과 `Runnable` 인터페이스 구현 두 가지가 있다.
* 두 방식 모두 실제 스레드를 동작시킬 때는 `run()`이 아닌 `start()` 메서드를 호출해야 한다.
* `Thread` 상속 방식은 다중 상속이 불가능하다는 제약이 있어 구조가 경직되는 단점이 있다.
* 따라서 실무에서는 코드의 재사용성과 유연성이 높고, 스레드 풀 등 고도화된 동기화 프레임워크와 쉽게 결합할 수 있는 **`Runnable` 인터페이스 구현 방식**을 주로 권장한다.
