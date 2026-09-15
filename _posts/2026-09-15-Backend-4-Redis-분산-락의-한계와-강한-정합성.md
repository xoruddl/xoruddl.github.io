---
layout: post
title: "Redis 분산 락의 한계와 강한 정합성"
date: 2026-09-15 17:12:46 +0900
categories: ["Backend"]
tags: ["redis", "distributed-lock", "redlock", "fencing-token", "etcd", "zookeeper", "concurrency", "동시성"]
---

## 1. 락을 얻었다고 항상 안전한 것은 아니다

결제 승인, 리더 선출, 되돌릴 수 없는 외부 명령처럼 **두 번 실행되는 비용이 매우 큰 작업**은 "락을 얻었으니 안전하다"고 가정하면 안 된다. 이 글에서는 Redis 락이 실패할 수 있는 지점과, 오래된 작업자를 막는 펜싱 토큰(Fencing Token), 더 강한 조정 도구를 선택할 기준을 정리한다.

---

## 2. 복제와 failover에서는 락이 사라질 수 있다

Redis primary-replica 복제는 일반적으로 비동기다. primary에 기록한 락 정보가 replica에 전달되기 전에 primary가 장애로 멈추고, 아직 락을 받지 못한 replica가 새 primary로 승격될 수 있다.

```text
1. 요청 A가 기존 primary에서 lock:payment:1001을 획득한다.
2. 락 정보가 replica에 복제되기 전에 기존 primary가 장애로 멈춘다.
3. 락 정보가 없는 replica가 새 primary가 된다.
4. 요청 B가 새 primary에서 같은 락을 획득한다.
5. A와 B가 모두 자신이 락 소유자라고 생각할 수 있다.
```

Redis Sentinel이나 Cluster를 사용한다고 이 문제가 자동으로 사라지는 것은 아니다. 고가용성은 장애 뒤 서비스를 다시 제공하는 데 도움이 되지만, 장애 직전의 모든 락 쓰기가 새 primary에 전달됐다는 보증과는 다른 문제다.

Redisson은 기본 설정에서 `checkLockSyncedSlaves`를 활성화해 이 위험 구간을 줄인다. 락을 쓰자마자 애플리케이션에 성공을 돌려주는 대신, 대략 다음 순서로 동작한다.

```text
1. 요청 A가 primary에 락 쓰기를 요청한다.
2. primary가 락을 기록한다.
3. Redisson이 연결된 replica에 이 락이 전파됐는지 확인한다.
4. 확인에 성공한 뒤 요청 A에 락 획득 성공을 반환한다.
```

정해진 시간(`slavesSyncTimeout`, 기본 1초) 안에 replica 동기화를 확인하지 못하면 Redisson은 방금 잡은 락을 해제하고 락 획득을 실패로 처리한다. 즉 애플리케이션은 "아직 복제되지 않은 락"을 획득한 것처럼 작업을 시작하지 않는다.

하지만 이 확인은 복제 지연으로 생기는 창을 줄이는 보완책이다. 장애 감지와 failover 자체가 비동기로 진행되고, 이미 멈췄다가 다시 실행되는 오래된 작업자 문제까지 막지는 못한다. 실제 사용 중인 Redisson 버전, `checkLockSyncedSlaves`, `slavesSyncTimeout`, 복제 구조를 확인하고 중요한 데이터의 최종 검증은 DB 제약 조건이나 보호 대상 시스템에 맡겨야 한다.

---

## 3. TTL이 끝난 오래된 작업자를 막는 펜싱 토큰

락을 얻은 요청이 GC pause나 네트워크 단절 때문에 오랫동안 멈출 수 있다. 그 사이 TTL이 끝나면 다른 요청이 새 락을 얻고 작업을 끝낼 수 있다. 이후 멈췄던 요청이 다시 실행되면 이미 최신 상태로 바뀐 데이터를 오래된 값으로 덮어쓸 위험이 있다.

```text
요청 A: 락 획득, 토큰 1 → 작업 중 멈춤
요청 A의 락: TTL 만료
요청 B: 새 락 획득, 토큰 2 → 데이터 변경 성공
요청 A: 다시 실행되어 토큰 1로 데이터 변경 시도
```

**펜싱 토큰**은 락을 획득할 때마다 증가하는 번호표다. 보호 대상 시스템은 지금까지 받은 토큰보다 작은 번호를 가진 요청을 거절한다. 위 흐름에서 요청 A의 토큰 `1`은 요청 B의 `2`보다 작으므로, A는 더 이상 데이터를 변경할 수 없다.

| 역할 | 해야 하는 일 |
| --- | --- |
| 락 제공자 | 락을 얻을 때마다 단조 증가하는 토큰을 발급 |
| 작업 요청 | 데이터를 쓸 때 토큰을 함께 전달 |
| 보호 대상 DB·외부 시스템 | 이전에 처리한 토큰보다 작은 요청을 거절 |

Redisson의 `RFencedLock`은 토큰을 반환하는 락 API를 제공한다. 아래 코드는 토큰을 얻은 뒤에만 작업하도록 만든 예시다.

```java
RFencedLock lock = redissonClient.getFencedLock("lock:payment:1001");
Long token = lock.tryLockAndGetToken(2, 10, TimeUnit.SECONDS);

if (token == null) {
    throw new IllegalStateException("잠시 후 다시 시도해 주세요.");
}

try {
    paymentService.approve(paymentId, token);
} finally {
    lock.unlock();
}
```

코드는 결제 `1001`을 보호하는 `lock:payment:1001` 락을 대상으로 한다. 같은 결제를 처리하려는 모든 요청은 반드시 같은 락 이름을 사용해야 서로 경쟁한다.

| 코드 | 뜻 |
| --- | --- |
| `getFencedLock(...)` | 펜싱 토큰을 발급하는 락 객체를 가져온다. 아직 락을 획득한 것은 아니다. |
| `tryLockAndGetToken(2, 10, TimeUnit.SECONDS)` | 최대 2초 동안 락 획득을 기다린다. 성공하면 토큰을 받고, 실패하면 `null`을 받는다. 획득한 락은 최대 10초 뒤 자동 만료된다. |
| `paymentService.approve(paymentId, token)` | 발급받은 토큰을 보호 대상인 결제 처리로 함께 전달한다. |
| `finally`의 `unlock()` | 승인 처리의 성공·실패와 관계없이, 아직 보유 중인 락을 즉시 해제한다. |

여기서 `2초`는 요청을 얼마나 기다릴지, `10초`는 락을 최대로 얼마나 보유할지를 뜻한다. 승인 처리가 10초를 넘으면 락은 자동 만료되고 다른 요청이 새 토큰으로 작업할 수 있다. 따라서 이전 요청이 늦게 다시 실행되더라도 뒤의 SQL처럼 보호 대상이 토큰을 비교해야 오래된 쓰기를 거절할 수 있다.

`paymentService.approve`는 토큰을 단순히 로그에 남기는 것으로 끝내면 안 된다. 예를 들어 `last_fencing_token`을 가진 테이블이라면 다음처럼 더 큰 토큰일 때만 변경해야 한다.

```sql
UPDATE payment
SET status = 'APPROVED',
    last_fencing_token = :token
WHERE id = :paymentId
  AND last_fencing_token < :token;
```

영향받은 행이 `0`이면 이미 더 새로운 토큰이 처리됐거나 대상이 없다는 뜻이다. 펜싱 토큰은 보호 대상이 이 비교를 실제로 수행할 때만 효과가 있다.

---

## 4. Redlock은 별도의 알고리즘이다

일반 `RLock`과 **Redlock**은 같은 것이 아니다. Redlock은 서로 독립적인 여러 Redis master에서 과반수의 락을 얻어 성공으로 판단하는 알고리즘이다. 락 유효 시간 안에 과반수 획득에 성공해야 하며, 실패하면 부분적으로 얻은 락도 해제해야 한다.

Redlock은 단일 Redis 장애에 대한 허용 범위를 넓히려는 설계지만, 시간 측정과 TTL에 의존한다. 오래 멈춘 작업자의 쓰기 문제까지 자동으로 해결하지도 않는다. Redis 노드를 여러 대 운영한다는 이유만으로 Redlock을 추가하는 것은 적절한 선택 기준이 아니다.

현재 Redisson 문서는 Redlock 구현을 사용 중단(deprecated) 대상으로 두고, 일반적인 경우에는 `RLock`, 오래된 작업자를 보호해야 할 때는 `RFencedLock`을 안내한다. 따라서 Redlock은 "Redis를 여러 대 쓰면 더 안전해지는 기본 설정"이 아니라, 장애 모델·운영 비용·보호 대상의 요구사항을 따져야 하는 별도 설계 선택으로 이해하는 편이 좋다.

---

## 5. 더 강한 조정이 필요할 때의 선택지

분산 락이 필요해 보이더라도 먼저 더 단순한 해결책이 있는지 확인해야 한다. 한 데이터베이스 안의 무결성 문제라면 DB가 마지막 상태를 직접 보장하는 방식이 가장 이해하기 쉽다.

| 방법 | 잘 맞는 상황 | 핵심 특징 |
| --- | --- | --- |
| 조건부 `UPDATE`·유니크 제약 | 한 DB 안의 재고, 중복 생성 방지 | DB가 최종 상태를 직접 보장 |
| 낙관적·비관적 락 | 한 DB의 트랜잭션 안에서 충돌 제어 | 충돌 빈도와 트랜잭션 길이를 기준으로 선택 |
| Redis `RLock` | 여러 인스턴스의 짧은 작업을 직렬화 | 빠르고 실용적이지만 DB 검증과 함께 사용 |
| Redis `RFencedLock` | 오래된 작업자가 외부 시스템을 변경할 위험 | 보호 대상이 펜싱 토큰을 검사해야 함 |
| etcd·ZooKeeper | 리더 선출, 클러스터 제어처럼 강한 조정이 필요한 작업 | 합의 기반으로 조정하되 별도 운영 비용 필요 |
| 큐의 단일 소비자 | 비동기 처리와 순서 보장이 가능한 작업 | 락 경쟁 자체를 없애고 멱등 소비자를 설계 |

"절대로 두 번 실행되면 안 되는가"가 중요한 질문이다. 중복 실행을 나중에 되돌리거나 DB 제약으로 차단할 수 있다면 Redis 락이 실용적일 수 있다. 반대로 중복 결제, 리더 선출, 되돌릴 수 없는 외부 시스템 명령이라면 펜싱 토큰, 해당 저장소의 트랜잭션 보장, 합의 기반 조정을 우선 검토해야 한다.

---

## 6. 정리

Redis 락은 요청 경쟁을 줄이는 훌륭한 조정 장치지만, 그 자체로 모든 장애 뒤의 정합성을 증명하지는 않는다. 복제 지연과 failover에서는 서로 다른 요청이 동시에 락을 가졌다고 판단할 여지가 있고, TTL 뒤에 다시 실행된 오래된 작업자도 문제가 될 수 있다.

따라서 데이터베이스의 유니크 제약·조건부 갱신으로 최종 상태를 지키고, 오래된 작업자가 실제 데이터를 바꾸면 안 되는 경우에는 펜싱 토큰을 보호 대상 시스템에서 검증해야 한다. Redis를 여러 대로 늘리는 것보다 먼저, 작업의 중복 실행 비용과 장애 모델을 기준으로 Redis·DB·큐·etcd·ZooKeeper 중 필요한 수준의 도구를 선택한다.

---

## 7. 참고 자료

* [Redis - Distributed Locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
* [Redisson - Locks and synchronizers](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/)
* [etcd - API reference: concurrency](https://etcd.io/docs/v3.7/dev-guide/api_concurrency_reference_v3/)
* [etcd - Why etcd](https://etcd.io/docs/v3.6/learning/why/)
* [J_hzlo - Redis 분산락을 깊게 다뤄보자](https://jhzlo.tistory.com/85)
