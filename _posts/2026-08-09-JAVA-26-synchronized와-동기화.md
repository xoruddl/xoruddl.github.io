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

---

## 3. synchronized 키워드의 사용법

자바에서 `synchronized` 키워드는 크게 두 가지 방식으로 사용된다.

### ① 메서드 전체 동기화

메서드 선언부에 `synchronized`를 붙이는 방식이다. 해당 메서드가 호출되면, 메서드가 속한 객체(Instance)의 Lock을 획득하게 된다.

```java
public synchronized void withdraw(int money) {
    if (balance >= money) {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {}
        balance -= money;
    }
}

```

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

자바의 모든 객체는 내부적으로 하나의 Lock(intrinsic lock 또는 monitor lock)을 가지고 있다.

1. 스레드가 `synchronized` 영역에 진입하려고 하면 해당 객체의 Lock을 요청한다.
2. 획득에 성공한 스레드만 임계 영역을 실행할 수 있다.
3. 다른 스레드가 이미 Lock을 선점하고 있다면, 나머지 스레드들은 Lock이 반환될 때까지 **BLOCKED(대기)** 상태로 전환된다.
4. 임계 영역의 코드가 끝난 스레드는 Lock을 반환하고 대기 중인 스레드 중 하나가 Lock을 가져간다.

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
2. **`synchronized`** 키워드를 사용하면 객체당 1개만 존재하는 Lock을 기반으로 임계 영역을 보호할 수 있다.
synchronized의 기준은 '클래스'가 아닌 '객체 인스턴스'다.
3. 무분별한 메서드 동기화는 프로그램의 전체적인 성능 저하(병목 현상)를 유발하므로, 가능한 한 **동기화 블록**을 이용해 최적의 범위만 지정하는 것이 권장된다.
