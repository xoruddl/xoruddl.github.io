---
layout: post
title: "JAVA (26) - synchronized와 동기화"
date: 2026-08-09 22:05:37 +0900
categories: ["JAVA"]
tags: ["자바"]
---

## 1. 개요

멀티스레드(Multi-thread) 환경에서는 여러 스레드가 하나의 공유 자원에 동시에 접근하여 값을 읽거나 수정할 수 있다. 이때 적절한 제어가 이루어지지 않으면 데이터의 일관성이 깨지는 신뢰성 문제가 발생한다.

자바에서는 이러한 멀티스레드 환경에서 발생할 수 있는 스레드 간의 충돌을 방지하고, 하나의 스레드 작업이 끝나기 전까지 다른 스레드가 제어권을 빼앗지 못하도록 방어하는 기술을 동기화(Synchronization)라고 한다. 자바는 이를 구현하기 위해 `synchronized` 키워드와 Monitor(모니터) 메커니즘을 제공한다.

---

## 2. 프로세스 메모리와 임계 영역(Critical Section)

동기화를 이해하려면 먼저 멀티스레드 환경에서 메모리가 어떻게 공유되는지 이해해야 한다.

* **공유 영역**: Heap(힙) 영역과 Static(메서드) 영역은 모든 스레드가 공유한다.
* **독립 영역**: Stack(스택) 영역은 스레드마다 독립적으로 할당된다.

따라서 Heap 영역에 위치한 객체의 인스턴스 변수나 Static 변수는 모든 스레드가 동시에 접근할 수 있는 대상이다. 이때 **동시 접근 시 문제가 발생할 수 있는 코드 영역**을 임계 영역(Critical Section)이라고 부르며, 자바는 이 임계 영역에 Lock(락)을 걸어 동기화를 보장한다.

예를 들어 `++count`는 한 줄로 작성되지만, 실제로는 값을 읽고(Read), 증가시키고(Modify), 다시 저장하는(Write) 여러 단계로 실행된다. 따라서 여러 스레드가 동시에 수행하면 일부 증가 결과가 사라질 수 있으며, 그 자체로 원자적(Atomic)인 연산은 아니다.

---

## 3. synchronized 키워드의 사용법

자바에서 `synchronized` 키워드는 크게 두 가지 방식으로 사용된다.

### ① 메서드 전체 동기화

메서드 선언부에 `synchronized`를 붙이는 방식이다. 인스턴스 메서드와 정적 메서드 모두 한 번에 하나의 스레드만 실행하도록 제한하지만, 사용하는 락의 대상이 서로 다르다.

#### 인스턴스 synchronized 메서드

인스턴스 메서드에 `synchronized`를 붙이면 현재 객체인 `this`의 고유 락을 획득한다. 다음 `withdraw()`는 하나의 계좌 객체가 가진 `balance`를 보호한다.

```java
class Account {
    private int balance = 1000;

    public synchronized void withdraw(int money) {
        if (balance >= money) {
            balance -= money;
        }
    }
}
```

위 메서드는 다음과 같이 `synchronized (this)`를 사용한 것과 같다.

```java
public void withdraw(int money) {
    synchronized (this) {
        if (balance >= money) {
            balance -= money;
        }
    }
}
```

`account1`과 `account2`는 서로 다른 객체이므로 각자 별도의 락을 가진다. 따라서 한 스레드가 `account1.withdraw()`를 실행하는 동안 다른 스레드는 `account2.withdraw()`를 동시에 실행할 수 있다.

#### static synchronized 메서드

`static synchronized` 메서드는 특정 인스턴스가 아니라 해당 클래스의 `Class` 객체에 있는 고유 락을 획득한다. 다음 메서드는 모든 `Account` 객체가 공유하는 정적 변수 `accountCount`를 보호한다.

```java
class Account {
    private static int accountCount;

    public static synchronized void register() {
        accountCount++;
    }
}
```

위 메서드는 다음과 같이 `synchronized (Account.class)`를 사용한 것과 같다.

```java
public static void register() {
    synchronized (Account.class) {
        accountCount++;
    }
}
```

`Account.class` 객체는 클래스당 하나이므로 어떤 경로로 `register()`를 호출하더라도 모두 같은 락을 두고 경쟁한다. 다만 인스턴스 메서드는 `this`의 락을 사용하고 정적 메서드는 `Account.class`의 락을 사용하므로, 두 메서드는 서로 다른 락을 사용하며 상대방의 실행을 막지 않는다.

| 구분 | 인스턴스 `synchronized` | `static synchronized` |
| --- | --- | --- |
| 락 대상 | 호출 대상 객체인 `this` | 클래스 객체인 `클래스명.class` |
| 보호하기 적합한 데이터 | 인스턴스 변수 | `static` 변수 등 클래스 공유 데이터 |
| 객체를 여러 개 생성한 경우 | 객체마다 서로 다른 락 사용 | 모든 객체가 같은 클래스 락 사용 |

### ② 동기화 블록(Synchronized Block)

메서드 전체에 Lock을 걸면 성능 저하가 발생할 수 있다. 특정 코드 구간만 동기화가 필요한 경우 블록 단위로 지정할 수 있다.

```java
public void withdraw(int money) {
    // 동기화가 필요 없는 로직...

    synchronized(this) { // Lock을 걸 객체 지정
        if (balance >= money) {
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {}
            balance -= money;
        }
    }
}

```

---

## 4. 모니터(Monitor)와 락(Lock)의 작동 원리

자바의 모든 객체는 내부적으로 하나의 **고유 락(Intrinsic Lock)** 을 가진다. 고유 락은 모니터 락(Monitor Lock) 또는 모니터(Monitor)라고도 부르며, `synchronized`는 이 락을 이용해 여러 스레드의 접근을 제어한다.

1. 스레드가 `synchronized` 영역에 진입하려고 하면 해당 객체의 Lock을 요청한다.
2. 획득에 성공한 스레드만 임계 영역을 실행할 수 있다.
3. 다른 스레드가 이미 Lock을 선점하고 있다면, 나머지 스레드들은 Lock이 반환될 때까지 **BLOCKED(대기)** 상태로 전환된다.
4. 임계 영역의 코드가 끝난 스레드는 Lock을 반환하고 대기 중인 스레드 중 하나가 Lock을 가져간다.

### 어떤 객체의 고유 락을 사용하는가?

| 동기화 방식 | 사용하는 고유 락 |
| --- | --- |
| 인스턴스 `synchronized` 메서드 | 현재 인스턴스인 `this` |
| `static synchronized` 메서드 | 해당 클래스의 `Class` 객체 |
| `synchronized(this)` | 현재 인스턴스인 `this` |
| `synchronized(lock)` | 괄호 안에 지정한 `lock` 객체 |

모든 객체가 고유 락을 가지므로, 동기화만을 위한 별도의 객체를 만들 수도 있다.

```java
class Counter {
    private final Object lock = new Object();
    private int count;

    public int increase() {
        synchronized (lock) {
            return ++count;
        }
    }
}
```

여러 스레드가 **같은 락 객체**를 기준으로 동기화해야 상호 배제가 이루어진다. 각 스레드가 서로 다른 객체의 락을 획득하면 같은 공유 자원에 접근하는 것을 막을 수 없다.

### 고유 락의 재진입성(Reentrancy)

고유 락은 재진입이 가능하다. 이미 락을 획득한 스레드는 같은 락이 필요한 다른 `synchronized` 메서드를 호출할 때 스스로 락을 반납하고 다시 기다릴 필요가 없다.

```java
public synchronized void methodA() {
    methodB(); // 같은 스레드가 this의 락을 이미 보유하고 있으므로 호출 가능
}

public synchronized void methodB() {
    System.out.println("methodB 실행");
}
```

또한 `synchronized`는 블록 구조에 따라 락을 자동으로 획득하고 해제하는 **구조적 락(Structured Lock)** 이다. 더 유연한 획득과 해제, 락 획득 시도 등의 기능이 필요하면 `java.util.concurrent.locks.ReentrantLock`과 같은 명시적 락을 사용할 수 있다.

### 가시성(Visibility) 보장

멀티스레드 환경에서는 CPU 캐시나 명령 재배치의 영향으로 한 스레드가 변경한 값을 다른 스레드가 즉시 확인하지 못할 수 있다. 같은 락으로 보호된 `synchronized` 영역에서는 먼저 락을 해제한 스레드의 변경 결과를 이후 그 락을 획득한 스레드가 볼 수 있도록 가시성을 보장한다.

### 분산 락과의 차이

고유 락은 하나의 JVM 안에서 같은 객체에 접근하는 스레드만 제어한다. 여러 서버나 JVM이 하나의 자원을 공유하는 환경에서는 `synchronized`만으로 서로의 접근을 막을 수 없으므로, Redis나 데이터베이스 같은 외부 시스템을 이용하는 **분산 락(Distributed Lock)** 이 필요할 수 있다.

---

## 5. wait()와 notify()를 이용한 스레드 제어

동기화 영역 내부에서 스레드 간의 효율적인 순서 제어를 위해 `Object` 클래스의 `wait()`, `notify()`, `notifyAll()` 메서드를 사용한다.

* **`wait()`**: 현재 스레드가 획득한 Lock을 내려놓고 대기 상태(WAITING)로 들어간다.
* **`notify()`**: 대기 중인 스레드 중 하나를 깨워 실행 가능 상태(RUNNABLE)로 만든다.
* **`notifyAll()`**: 대기 중인 모든 스레드를 깨운다.

> **주의**: `wait()`와 `notify()`는 반드시 `synchronized` 블록 내부에서만 호출할 수 있다.

---

## 6. 예시
### 1. 동기화가 필요한 이유 (동시성 문제 예시)

동기화를 적용하지 않았을 때 어떤 문제가 발생하는지 은행 계좌 출금 예제로 확인한다.

#### 동기화 미적용 코드

```java
class Account {
    private int balance = 1000;

    public int getBalance() {
        return balance;
    }

    // 동기화가 처리되지 않은 출금 메서드
    public void withdraw(int money) {
        if (balance >= money) {
            try {
                // 스레드 작업 지연을 가상으로 구현 (문제 발생 가능성 극대화)
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            balance -= money;
        }
    }
}

class ThreadExample implements Runnable {
    Account acc = new Account();

    @Override
    public void run() {
        while (acc.getBalance() > 0) {
            // 100원, 200원, 300원 중 랜덤으로 출금 시도
            int money = (int) (Math.random() * 3 + 1) * 100;
            acc.withdraw(money);
            System.out.println("현재 잔액: " + acc.getBalance());
        }
    }
}

```

위 코드를 두 개 이상의 스레드가 동시에 실행하면 잔액 검사(`if (balance >= money)`) 조건문을 통과한 후 다른 스레드가 먼저 출금을 진행하여 **잔액이 마이너스(`-`)가 되는 문제**가 발생한다.

---

### 2. synchronized 키워드 사용 예시

`synchronized` 키워드는 메서드에 적용하거나 코드 블록 단위로 적용하여 위의 문제를 해결한다.

#### ① 메서드 동기화 (Method Synchronization)

메서드 선언부에 `synchronized`를 작성하여 메서드 전체를 임계 영역으로 지정한다.

```java
public synchronized void withdraw(int money) {
    if (balance >= money) {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        balance -= money;
    }
}

```

#### ② 동기화 블록 (Synchronized Block)

메서드 전체에 Lock을 걸지 않고, 최소한의 공유 자원 접근 영역만 블록으로 감싸 성능 저하를 줄인다.

```java
public void withdraw(int money) {
    // 동기화가 필요 없는 일반 검증 로직
    System.out.println("출금 요청 금액: " + money);

    synchronized (this) { // this 객체의 Lock을 획득
        if (balance >= money) {
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            balance -= money;
        }
    }
}

```

---

### 3. wait()와 notify()를 이용한 생산자-소비자 패턴 예시

스레드가 조건이 맞지 않을 때 락을 계속 잡고 기다리는 대신, `wait()`로 락을 반납하고 `notify()`로 제어권을 넘겨주는 대표적인 사용예시다.

```java
class Table {
    private String dish;

    // 음식을 추가하는 메서드 (생산자)
    public synchronized void addDish(String dishName) {
        while (this.dish != null) {
            System.out.println("테이블에 음식이 이미 있습니다. 대기합니다.");
            try {
                wait(); // 음식이 비워질 때까지 대기 (Lock 반납)
            } catch (InterruptedException e) {}
        }

        this.dish = dishName;
        System.out.println("요리사가 음식을 올렸습니다: " + dishName);
        notify(); // 대기 중인 손님 스레드를 깨움
    }

    // 음식을 먹는 메서드 (소비자)
    public synchronized void removeDish() {
        while (this.dish == null) {
            System.out.println("음식이 아직 없습니다. 대기합니다.");
            try {
                wait(); // 음식이 나올 때까지 대기 (Lock 반납)
            } catch (InterruptedException e) {}
        }

        System.out.println("손님이 음식을 먹었습니다: " + this.dish);
        this.dish = null;
        notify(); // 대기 중인 요리사 스레드를 깨움
    }
}

```


## 7. 정리

1. 동기화(Synchronization)는 멀티스레드 환경에서 데이터 일관성을 지키기 위해 필수적인 기술이다.
2. **`synchronized`** 키워드는 객체의 고유 락을 기반으로 임계 영역의 상호 배제와 메모리 가시성을 보장한다.
3. 무분별한 메서드 동기화는 프로그램의 전체적인 성능 저하(병목 현상)를 유발하므로, 가능한 한 **동기화 블록**을 이용해 최적의 범위만 지정하는 것이 권장된다.
4. 인스턴스 동기화는 `this`의 락을, 정적 동기화는 클래스의 `Class` 객체 락을 사용하므로 어떤 객체를 락으로 사용하는지 구분해야 한다.

---

## 8. 참고 자료

* [Gyoogle - Java 고유 락(Intrinsic Lock)](https://gyoogle.dev/blog/computer-language/Java/Intrinsic%20Lock.html)
