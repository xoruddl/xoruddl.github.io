---
layout: post
title: "Redis 분산 락 기초와 Redisson 적용"
date: 2026-09-15 16:55:28 +0900
categories: ["Backend"]
tags: ["redis", "distributed-lock", "redisson", "concurrency", "동시성"]
---

## 1. 여러 서버에서는 JVM 락만으로 부족하다

쿠폰 발급, 선착순 구매, 재고 차감처럼 같은 자원을 동시에 변경하는 요청은 한 번만 처리되어야 할 때가 있다. 예를 들어 남은 수량이 1개인 쿠폰을 두 요청이 동시에 발급하면, 두 요청 모두 "아직 남아 있다"고 판단할 수 있다.

서버가 한 대라면 `synchronized`나 `ReentrantLock`으로 한 번에 하나만 실행해야 하는 코드 구간, 즉 **임계 구역(Critical Section)** 을 보호할 수 있다. 하지만 애플리케이션 인스턴스가 여러 대라면 각 JVM은 서로 다른 메모리를 사용하므로, 인스턴스 A의 락을 인스턴스 B는 알지 못한다.

이때 여러 프로세스가 공유해서 사용하는 조정 장치가 **분산 락(Distributed Lock)** 이다. 작업을 시작하기 전에 공통된 락을 획득하고, 획득한 작업자만 임계 구역을 실행하게 한다. Redis 분산 락은 이 공통 락 정보를 Redis에 저장하는 방식이다.

이 글은 Redis 분산 락의 기본 원리와 Spring에서 Redisson으로 적용하는 방법을 다룬다.

---

## 2. Redis 분산 락은 무엇을 보장하려는가

분산 락의 목표는 "같은 자원을 바꾸는 작업은 잠시 줄을 서게 하자"이다. 예를 들어 `couponId = 42`인 쿠폰의 발급 작업을 한 번에 하나만 수행하고 싶다면, 모든 인스턴스가 `lock:coupon:42`라는 **같은 Redis 키**를 사용한다.

Redis에서 키는 값을 저장할 때 붙이는 이름이다. 여기서 `lock:coupon:42`는 "42번 쿠폰을 위한 락"이라는 뜻의 이름일 뿐이며, 쿠폰 데이터 자체를 저장하는 키는 아니다. 락을 얻으려는 모든 요청이 이 이름을 공유해야 서로를 발견하고 기다릴 수 있다.

| 구성 요소 | 예시 | 뜻 |
| --- | --- | --- |
| 락 키 | `lock:coupon:42` | 어떤 자원을 잠글지 나타내는 공통 이름 |
| 소유자 값 | 임의의 UUID | 이번 락을 누가 얻었는지 구별하는 고유한 표식 |
| TTL | 10초 | 락이 자동으로 사라지는 최대 시간 |

락 획득은 키가 없을 때만 값을 쓰는 원자적 연산으로 처리한다. 다음 명령은 키가 비어 있다면 UUID 같은 무작위 소유자 값을 저장하고, 이미 다른 요청이 락을 갖고 있다면 실패한다.

```text
SET lock:coupon:42 {무작위-소유자-값} NX PX 10000
```

`NX`는 키가 없을 때만 저장하라는 뜻이고, `PX 10000`은 10,000밀리초(10초) 뒤 키를 자동으로 만료시키라는 뜻이다. 성공한 요청만 락 소유자가 되고, 실패한 요청은 기다렸다가 재시도하거나 즉시 실패 응답을 보낸다. TTL이 없다면 락을 잡은 프로세스가 비정상 종료했을 때 키가 영원히 남아 이후 요청이 모두 막힐 수 있다.

### 락은 왜 소유자 값을 확인하고 해제해야 할까

락 해제도 단순히 `DEL lock:coupon:42`를 호출하면 안 된다. 작업이 예상보다 오래 걸려 TTL이 끝난 뒤, 다른 요청이 **같은 키**로 새 락을 얻을 수 있기 때문이다. 이때 "같은 키"란 같은 쿠폰 42번을 잠그기 위해 모두가 사용하는 `lock:coupon:42`를 말한다.

```text
요청 A: lock:coupon:42에 소유자 값 A를 저장하고 작업 시작
        └─ 작업이 10초를 넘겨 A의 락이 자동 만료됨
요청 B: 비어 있는 lock:coupon:42에 소유자 값 B를 저장하고 작업 시작
요청 A: 작업을 마치고 DEL lock:coupon:42 실행
        └─ B가 가진 새 락까지 삭제됨
```

따라서 **현재 저장된 값이 내가 락을 얻을 때 저장한 소유자 값과 같을 때만 삭제**해야 한다. 키 조회와 삭제도 그 사이에 값이 바뀌면 안 되므로 하나의 원자적 연산으로 실행해야 한다.

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
return 0
```

이 스크립트를 실행할 때 애플리케이션은 락 키와 자신이 저장했던 소유자 값을 함께 전달한다.

| 스크립트 값 | 실제 전달값 | 역할 |
| --- | --- | --- |
| `KEYS[1]` | `lock:coupon:42` | 확인하고 필요하면 삭제할 락 키 |
| `ARGV[1]` | 요청 A가 저장한 UUID | "이 락은 요청 A의 것"임을 증명하는 값 |

`redis.call("get", KEYS[1])`은 현재 락의 값을 읽는다. 그 값이 `ARGV[1]`과 같으면 내 락이므로 `del`로 키를 지우고 `1`을 반환한다. 값이 다르거나 키가 이미 없다면 다른 요청의 락을 건드리지 않고 `0`을 반환한다. Lua 스크립트 전체는 Redis에서 하나의 명령처럼 실행되므로 확인과 삭제 사이에 다른 요청이 끼어들 수 없다.

즉, Redis 락의 기본 규칙은 다음 세 가지다.

1. 키가 없을 때만 획득한다.
2. 장애에 대비해 반드시 TTL을 둔다.
3. 자신이 획득한 락인지 확인한 뒤에만 해제한다.

---

## 3. Redis와 Redisson을 선택하는 이유

Redis 분산 락이 모든 시스템의 표준이라는 뜻은 아니다. **이미 Redis를 운영하고 있고, 여러 인스턴스에서 짧은 작업을 서로 배제해야 하는 경우**에 실용적인 선택이다.

| 관점 | Redis 분산 락이 주는 이점 |
| --- | --- |
| 접근 지연 시간 | 메모리 기반 Redis의 짧은 왕복 시간으로 락 획득·해제를 처리할 수 있다. |
| 도입 비용 | 캐시, 세션, 레이트 리밋 등에 이미 Redis가 있다면 별도 조정 시스템을 새로 운영하지 않아도 된다. |
| 적용 범위 | 서로 다른 JVM, 컨테이너, Pod에서 같은 락 키를 공유할 수 있다. |
| 기능 | Redisson은 재진입 락, 대기 시간 제한, TTL, Pub/Sub 기반 대기 알림을 제공한다. |
| 데이터베이스 보호 | 경쟁이 많은 요청을 DB 트랜잭션에 들어가기 전에 줄여 DB 락 대기와 충돌을 완화할 수 있다. |

특히 선착순 이벤트처럼 같은 자원에 요청이 순간적으로 몰리고, 임계 구역이 짧으며, 락 획득 실패에 재시도 또는 "다시 시도해 주세요" 응답을 줄 수 있는 작업과 잘 맞는다.

### 락을 얻지 못한 요청은 어떻게 기다릴까

Redis의 `SET ... NX`는 락을 주거나 실패를 반환할 뿐, 실패한 요청을 자동으로 줄 세우지는 않는다. 가장 단순한 직접 구현은 일정 시간마다 다시 락 획득을 시도하는 방식이다.

```java
while (!tryAcquireLock()) {
    Thread.sleep(100);
}
```

이 방식은 **스핀(폴링) 방식**이다. `sleep`을 넣으면 CPU를 계속 사용하는 바쁜 대기는 피할 수 있지만, 기다리는 요청마다 Redis에 반복 호출이 발생하고 웹 요청을 처리하던 스레드도 붙잡는다. 재시도 간격, 최대 대기 시간, 실패 응답을 정하지 않으면 락 경합이 Redis와 애플리케이션의 부하로 번질 수 있다.

일반적인 Redisson `RLock`은 락을 얻지 못한 요청이 락 해제 알림을 Pub/Sub 채널로 기다렸다가 다시 획득을 시도할 수 있게 한다. 직접 폴링 루프를 작성하는 경우보다 반복 요청을 줄이기 쉽다. 보통은 `tryLock`에 짧고 명확한 대기 시간을 두고, 획득 실패를 정상적인 응답 흐름으로 다루는 것이 먼저다.

---

## 4. Spring에서 Redisson 락 적용하기

다음 예제는 한 사용자에게 같은 쿠폰을 중복 발급하지 않도록, 쿠폰과 사용자 조합을 락 키로 사용한다. `couponId = 42`, `userId = 7`인 두 요청은 모두 `lock:coupon:42:user:7`을 두고 경쟁한다. 반면 사용자 8번의 요청은 다른 키를 사용하므로 이 락 때문에 기다리지는 않는다.

코드는 `락 이름 생성 → 2초 동안 획득 시도 → 실제 발급 → 반드시 해제` 순서로 동작한다. `leaseTime`을 지정하지 않으면 Redisson watchdog이 락 보유 클라이언트가 살아 있는 동안 만료 시간을 연장한다.

```java
@Service
@RequiredArgsConstructor
public class CouponIssueFacade {

    private final RedissonClient redissonClient;
    private final CouponIssueService couponIssueService;

    public void issue(Long couponId, Long userId) throws InterruptedException {
        String lockName = "lock:coupon:%d:user:%d".formatted(couponId, userId);
        RLock lock = redissonClient.getLock(lockName);

        boolean acquired = lock.tryLock(2, TimeUnit.SECONDS);
        if (!acquired) {
            throw new IllegalStateException("요청이 많습니다. 잠시 후 다시 시도해 주세요.");
        }

        try {
            couponIssueService.issue(couponId, userId);
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

`tryLock(2, TimeUnit.SECONDS)`는 락이 이미 잡혀 있으면 최대 2초를 기다린다는 뜻이다. 그 안에 락을 얻지 못하면 `acquired`가 `false`가 되고, 실제 발급 로직은 실행하지 않는다. 락을 얻은 뒤에는 성공·예외 여부와 관계없이 `finally`에서 해제해야 다음 요청이 진행할 수 있다.

실제 데이터 변경은 별도 Spring 빈의 트랜잭션 메서드에서 처리한다. 같은 클래스 안에서 `this.issue()`처럼 호출하면 Spring의 `@Transactional` 프록시를 거치지 않아 트랜잭션이 적용되지 않을 수 있으므로 분리했다.

```java
@Service
@RequiredArgsConstructor
public class CouponIssueService {

    private final CouponRepository couponRepository;
    private final CouponIssueRepository couponIssueRepository;

    @Transactional
    public void issue(Long couponId, Long userId) {
        int updated = couponRepository.decreaseIfAvailable(couponId);
        if (updated == 0) {
            throw new IllegalStateException("쿠폰이 모두 소진되었습니다.");
        }

        couponIssueRepository.save(new CouponIssue(couponId, userId));
    }
}
```

`decreaseIfAvailable`은 "남은 쿠폰이 있을 때만 수량을 하나 줄인다"는 조건부 갱신이며, 반환값 `updated`는 실제로 변경된 행의 수다. `0`이면 이미 소진되어 발급 레코드를 저장하면 안 된다.

### Redis 락은 보조 장치이고 DB가 마지막 방어선이다

Redis 락은 요청을 직렬화하는 **보조 장치**다. 데이터베이스에는 여전히 `(coupon_id, user_id)` 유니크 제약 조건을 두고, 재고·수량은 조건부 `UPDATE` 같은 원자적 연산으로 검증해야 한다.

```sql
UPDATE coupon
SET stock = stock - 1
WHERE id = 42
  AND stock > 0;
```

이 쿼리는 재고가 있을 때만 수량을 줄인다. Redis 장애, 락 만료, 배포 중 일시적인 중복 실행이 있더라도 DB 제약 조건과 조건부 갱신이 중복 발급·마이너스 재고를 최종 차단한다.

---

## 5. Redis 락을 운영할 때 확인할 것

### 락의 범위와 키를 업무 규칙에 맞게 잡는다

키는 작을수록 좋은 것이 아니라, **동시에 처리하면 안 되는 범위와 정확히 같아야** 한다.

| 막고 싶은 일 | 알맞은 키 예시 | 이유 |
| --- | --- | --- |
| 쿠폰 42번의 전체 수량 동시 차감 | `lock:coupon:42` | 같은 쿠폰의 모든 요청이 함께 경쟁해야 함 |
| 사용자 7번의 쿠폰 42 중복 발급 | `lock:coupon:42:user:7` | 같은 사용자·같은 쿠폰 요청만 막으면 됨 |
| 모든 쿠폰 발급 작업 | `lock:coupon` | 대체로 범위가 너무 넓어 불필요한 대기를 만듦 |

앞의 코드가 사용자별 중복 발급만 막는 키를 쓰는 이유는, 전체 수량의 정확성은 조건부 `UPDATE`가 별도로 보장하기 때문이다.

### 대기 시간과 실패 정책을 정한다

무한 대기는 요청 스레드를 계속 점유한다. `tryLock`의 대기 시간, 실패했을 때의 HTTP 응답, 클라이언트 재시도 횟수와 지수 백오프를 정해 둔다. 락 획득 실패를 전부 즉시 재시도하면 경쟁이 더 심해질 수 있다.

### 임계 구역을 짧게 유지한다

락 안에서는 필요한 DB 변경만 수행하고, 긴 HTTP 호출·파일 처리·사용자 입력 대기는 밖으로 분리한다. watchdog을 사용해도 긴 GC pause, 네트워크 단절, 프로세스 멈춤 뒤에는 락의 유효성을 잃은 작업이 다시 실행될 수 있다. watchdog은 영구 락을 줄이는 도구이지, 모든 장애 상황에서 소유권을 증명하는 장치는 아니다.

### 관측 가능한 지표를 남긴다

락 획득 성공률, 획득까지의 대기 시간, 타임아웃 횟수, 임계 구역 실행 시간, DB 유니크 제약 위반을 함께 측정한다. 이 지표가 있어야 키 범위가 너무 넓은지, 대기 시간이 너무 짧은지, 애초에 큐나 DB 방식이 더 맞는지 판단할 수 있다.

---

## 6. 정리

Redis 분산 락은 여러 애플리케이션 인스턴스가 짧은 임계 구역을 공유할 때, 낮은 지연 시간과 쉬운 도입 비용으로 경쟁을 줄여 주는 실용적인 선택이다. Java/Spring에서는 Redisson을 사용하면 소유자 검증, TTL, 대기 시간, watchdog 같은 구현 세부 사항을 비교적 안전한 API로 다룰 수 있다.

하지만 Redis 락만으로 데이터 무결성을 보장해서는 안 된다. 유니크 제약 조건과 조건부 갱신으로 DB가 최종 상태를 검증하도록 설계하고, Redis는 그 전에 경쟁을 조절하는 계층으로 사용하면 좋다.
---

## 7. 참고 자료

* [Redis - Distributed Locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
* [Redisson - Locks and synchronizers](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/)
* [J_hzlo - Redis 분산락을 깊게 다뤄보자](https://jhzlo.tistory.com/85)
