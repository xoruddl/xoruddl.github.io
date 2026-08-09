---
layout: post
title: "JAVA (27) - Executor 기초"
date: 2026-08-09 22:27:23 +0900
categories: ["JAVA"]
---

## 1. 개요

자바에서 멀티스레드 프로그래밍을 할 때 `new Thread()`를 통해 직접 스레드를 생성하고 관리하는 방식은 여러 한계를 지닌다. 스레드 생성과 파괴에 소요되는 오버헤드가 크고, 무분별한 스레드 생성은 시스템 자원 고갈로 이어질 수 있다.

자바 5부터 도입된 **Executor 프레임워크**는 이러한 스레드 생성 및 관리 작업을 캡슐화하여 개발자가 스레드를 직접 다루지 않고도 작업을 효율적으로 비동기 처리할 수 있도록 지원하는 표준 인프라다.

---

## 2. 기존 스레드 직접 관리의 문제점

`new Thread(() -> { ... }).start()` 방식을 사용할 때 발생하는 대표적인 문제점은 다음과 같다.

* **높은 생성 비용**: OS 스레드를 생성하고 메모리를 할당하는 작업은 비용이 크다. 요청마다 스레드를 생성하면 성능 저하가 발생한다.
* **자원 고갈 위험**: 사용자 요청이 급증하면 스레드가 무제한으로 생성되어 `OutOfMemoryError`가 발생하거나 CPU 컨텍스트 스위칭 오버헤드가 극대화된다.
* **작업과 스레드의 강한 결합**: 수행할 작업(Task)의 정의와 스레드의 생명주기 관리가 분리되지 않아 관리가 복잡해진다.

---

## 3. Executor 프레임워크의 개념과 구조

Executor 프레임워크는 작업 제출(Task Submission)과 작업 실행(Task Execution)을 분리하는 구조를 가진다. 개발자는 '수행할 작업'만 정의하여 제출하고, 작업의 실제 스레드 할당 및 실행은 프레임워크가 담당한다.

이름이 유사하여 헷갈리기 쉬운 **`Executor`**, **`ExecutorService`**, **`Executors`**의 관계와 역할을 정리하면 다음과 같다.

### 3종 비교 요약표

| 이름 | 종류 | 주요 역할 |
| --- | --- | --- |
| **`Executor`** | 인터페이스 | 최상위 인터페이스. `execute()` 메서드 하나만 갖고 있으며, 작업 실행의 기본 규격을 정의한다. |
| **`ExecutorService`** | 인터페이스 | `Executor`를 상속받은 확장 인터페이스. 작업 제출(`submit`), 스레드 풀 종료(`shutdown`) 등 실제 스레드 풀 관리와 제어를 담당한다. |
| **`Executors`** | 팩토리 클래스 (유틸리티) | 인터페이스가 아닌 **일반 클래스**다. `ExecutorService` 구현체 객체(`ThreadPoolExecutor` 등)를 쉽게 생성해 주는 **공장(Factory)** 역할을 한다. |

### 상속 및 관계도

```text
Executor (인터페이스)
   ▲ 상속(extends)
   │
ExecutorService (인터페이스)
   ▲ 구현(implements)
   │
ThreadPoolExecutor (구체 클래스) ◄── 생성(Factory) ── Executors (유틸리티 클래스)

```

1. **`Executor`**: 가장 기본이 되는 작업 실행 규격이다.
2. **`ExecutorService`**: `Executor`를 상속받아 완성된 스레드 풀 관리용 인터페이스다.
3. **`Executors`**: `ExecutorService`를 직접 구현한 것이 아니라, 실제 구현체인 `ThreadPoolExecutor` 같은 객체를 간편하게 만들어서 반환해 주는 팩토리 클래스다.

---

## 4. Executors를 통한 스레드 풀 생성

`Executors` 유틸리티 클래스가 제공하는 주요 팩토리 메서드는 다음과 같다.

```java
// 1. 고정 크기 스레드 풀 생성
ExecutorService fixedPool = Executors.newFixedThreadPool(4);

// 2. 가변 크기 스레드 풀 생성
ExecutorService cachedPool = Executors.newCachedThreadPool();

// 3. 단일 스레드 풀 생성
ExecutorService singlePool = Executors.newSingleThreadExecutor();

```

* **`newFixedThreadPool(int nThreads)`**: 지정한 개수만큼의 스레드를 고정으로 생성하여 재사용한다. 작업이 몰리면 큐(Queue)에 쌓아두고 순차 처리한다.
* **`newCachedThreadPool()`**: 필요에 따라 스레드를 동적으로 생성한다. 놀고 있는 스레드가 있다면 재사용하고, 60초 동안 사용되지 않은 스레드는 제거한다.
* **`newSingleThreadExecutor()`**: 단 하나의 스레드로 모든 작업을 순차적으로(FIFO) 처리한다.

---

## 5. ExecutorService 사용 예시 및 콘솔 출력 결과

### 예시 코드

```java
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ExecutorExample {
    public static void main(String[] args) {
        // 스레드 2개를 가진 고정 스레드 풀 생성
        ExecutorService executor = Executors.newFixedThreadPool(2);

        // 5개의 작업 제출
        for (int i = 1; i <= 5; i++) {
            final int taskId = i;
            executor.execute(() -> {
                System.out.println(Thread.currentThread().getName() + " - 작업 " + taskId + " 수행 중");
            });
        }

        // 작업 완료 후 ExecutorService 종료
        executor.shutdown();
    }
}

```

### 실행 콘솔 출력 예시

```text
pool-1-thread-1 - 작업 1 수행 중
pool-1-thread-2 - 작업 2 수행 중
pool-1-thread-1 - 작업 3 수행 중
pool-1-thread-2 - 작업 4 수행 중
pool-1-thread-1 - 작업 5 수행 중

```

### 출력 결과의 중요한 특징

1. **스레드의 재사용**: 스레드 이름(`pool-1-thread-1`, `pool-1-thread-2`)을 확인해 보면 새로 스레드를 계속 만드는 대신, 스레드 풀에 등록된 **단 2개의 스레드가 5개의 작업을 나누어 교대로 처리**한 것을 볼 수 있다.
2. **실행 순서의 비결정성 (비동기)**: 동일한 코드를 실행하더라도 **작업이 출력되는 순서가 매번 달라질 수 있다.** OS의 스레드 스케줄링 및 동시성 작업 특성상 작업 제출 순서대로 완료된다는 보장이 없기 때문이다.


>참고: **execute() vs submit()**
위 예시에서 사용한 execute()는 반환값이 없는(Runnable) 작업 전달에 사용한다. 만약 작업 실행 후 결과값을 반환받아야 한다면 submit() 메서드를 사용하며, 이는 Callable과 Future 를 알아야한다.

---

## 6. ExecutorService의 종료

스레드 풀 내부의 스레드는 작업이 끝나도 기본적으로 대기 상태로 유지되므로, 애플리케이션이 종료되지 않고 계속 대기할 수 있다. 따라서 사용이 끝나면 반드시 종료 메서드를 호출해야 한다.

* **`shutdown()`**: 현재 진행 중인 작업 및 큐에 대기 중인 작업까지 모두 마친 후 스레드 풀을 안전하게 종료한다.
* **`shutdownNow()`**: 즉시 종료를 시도한다. 대기 중인 작업 목록을 반환하고 진행 중인 작업에는 `interrupt()`를 발생시킨다.

### 실무 필수 패턴: awaitTermination()
shutdown()은 "종료 명령"만 내리고 즉시 다음 코드로 넘어가기 때문에, 진행 중인 작업들이 실제로 모두 끝날 때까지 메인 스레드가 기다리게 하려면 **awaitTermination()**을 함께 사용하는 패턴이 자주 쓰인다.


```java
executor.shutdown(); // 추가 작업 받기를 중단하고 완료 후 종료 요청

// 최대 60초 동안 기존 작업들이 완수되기를 기다림
if (!executor.awaitTermination(60, TimeUnit.SECONDS)) {
    executor.shutdownNow(); // 시간 초과 시 강제 종료
}
```

---

## 7. 정리

1. **스레드 관리의 효율화**: Executor 프레임워크는 스레드 직접 생성의 오버헤드를 줄이고 자원을 효율적으로 관리할 수 있게 한다.
2. **역할의 분리**: 작업 내용과 스레드 생명주기 관리 로직을 분리하여 코드의 가독성과 유지보수성을 높인다.
3. **자원 보호**: 스레드 풀의 크기를 제한함으로써 과도한 동시 요청으로 인한 시스템 마비를 방지한다.
4. **명시적 종료 필수**: 스레드 풀을 사용한 후에는 프로세스가 종료되지 않는 현상을 막기 위해 반드시 `shutdown()`을 호출해야 한다.
